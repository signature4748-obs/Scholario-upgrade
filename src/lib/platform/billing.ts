/**
 * platform/billing — SCHOLARIO SUBSCRIPTION BILLING domain service.
 *
 * DOMAIN SEPARATION (§3 of the hardening directive): this module is the
 * A-domain — the SCHOOL PAYS SCHOLARIO ledger. It is completely disjoint
 * from the B-domain (a school's own student-fee gateway: SchoolPaymentGateway
 * + FeeTransaction + lib/payments/provider). The two never share tables,
 * code paths, or providers.
 *
 * INVARIANT: a SchoolSubscription may ONLY reach ACTIVE through a
 * VERIFIED PlatformPayment row — an offline payment recorded by a
 * platform admin (this module) or a signature-verified webhook
 * (/api/webhooks/platform-subscription). A browser report of payment
 * success is NEVER sufficient; there is no client-driven activation.
 *
 * Every mutation is transactional (payment + subscription + snapshots
 * commit atomically) and audited by the caller (platformAuditEvent).
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { AppError } from '@/lib/security/errors'

export const PAYMENT_MODES = ['ONLINE_PAYMENT', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export const SUBSCRIPTION_STATES = ['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED'] as const
export type SubscriptionOverrideState = (typeof SUBSCRIPTION_STATES)[number]

const CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED'])

export interface RecordPaymentInput {
  schoolId: string
  amount: number
  currency: string
  mode: PaymentMode
  paymentDate: Date
  periodMonths: number
  reference?: string | null
  notes?: string | null
  recordedById?: string | null
  /** 'webhook' for signature-verified online payments, 'admin' offline. */
  source: 'admin' | 'webhook'
}

export interface RecordPaymentResult {
  paymentId: string
  receiptNo: string
  statusAfter: string
  periodEndAfter: Date
}

function receiptNumber(seq: number): string {
  const year = new Date().getFullYear()
  return `SCH-RCP-${year}-${String(seq).padStart(5, '0')}`
}

/** Next receipt sequence: year-scoped count + 1 (unique index is the
 *  race backstop — a collision throws CONFLICT, honestly retried). */
async function nextReceiptSeq(): Promise<number> {
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const count = await db.platformPayment.count({ where: { createdAt: { gte: yearStart } } })
  return count + 1
}

/**
 * Record a VERIFIED platform payment and activate/extend the tenant's
 * subscription — ONE transaction:
 *
 *   PlatformPayment (VERIFIED, snapshot) ⊕ SchoolSubscription
 *   (status ACTIVE · override cleared · period extended from
 *   max(now, current periodEnd) by periodMonths)
 *
 * The entitlement thereafter computes ACTIVE from the new periodEnd —
 * the tenant unlocks automatically, with this row as the audited cause.
 */
export async function recordPlatformPayment(
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  if (!(input.amount > 0)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Payment amount must be greater than zero' })
  }
  if (!CURRENCIES.has(input.currency)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Unsupported currency' })
  }
  if (!(input.periodMonths >= 1 && input.periodMonths <= 60)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Subscription period must be 1–60 months' })
  }

  const school = await db.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, status: true, subscription: true },
  })
  if (!school) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
  }

  const current = school.subscription
  const base =
    current?.periodEnd && current.periodEnd.getTime() > Date.now() ? current.periodEnd : new Date()
  const periodEndAfter = new Date(
    base.getTime() + input.periodMonths * 30 * 24 * 60 * 60 * 1000,
  )
  const periodStart = current?.periodEnd && current.periodEnd.getTime() > Date.now()
    ? current.periodEnd
    : new Date()
  let seq = await nextReceiptSeq()

  // Receipt uniqueness: the count-based sequence can collide (ledger rows
  // are deletable for test hygiene; concurrent recordings race). Retry
  // with incremented sequence — the unique index is the authority.
  for (let attempt = 0; attempt < 10; attempt++) {
    const receiptNo = receiptNumber(seq + attempt)
    try {
      return await db.$transaction(async (tx) => {
        const payment = await tx.platformPayment.create({
          data: {
            schoolId: input.schoolId,
            amount: input.amount,
            currency: input.currency,
            mode: input.mode,
            paymentDate: input.paymentDate,
            periodMonths: input.periodMonths,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            recordedById: input.recordedById ?? null,
            verification: 'VERIFIED',
            verifiedAt: new Date(),
            statusAfter: 'ACTIVE',
            periodEndAfter,
            receiptNo,
            subscriptionId: current?.id ?? null,
          },
        })

        // Idempotent upsert of the subscription row with the new period.
        const subscription = await tx.schoolSubscription.upsert({
          where: { schoolId: input.schoolId },
          create: {
            schoolId: input.schoolId,
            status: 'ACTIVE',
            plan: current?.plan ?? 'STANDARD',
            periodStart,
            periodEnd: periodEndAfter,
            graceDays: current?.graceDays ?? 14,
          },
          update: {
            status: 'ACTIVE',
            plan: current?.plan ?? undefined,
            periodStart,
            periodEnd: periodEndAfter,
            // A verified payment clears any manual restriction override.
            overrideStatus: null,
          },
        })

        await tx.platformPayment.update({
          where: { id: payment.id },
          data: { subscriptionId: subscription.id },
        })

        // A platform suspension (School.status SUSPENDED) is NOT auto-lifted
        // by a payment — that is a separate platform decision (reactivate).

        return {
          paymentId: payment.id,
          receiptNo,
          statusAfter: 'ACTIVE',
          periodEndAfter,
        }
      })
    } catch (e: unknown) {
      const code = (e as { code?: string }).code
      if (code === 'P2002') continue // receipt collision — next sequence
      throw e
    }
  }
  throw new AppError('CONFLICT', {
    publicMessage: 'Could not assign a unique receipt number — please retry.',
    internalDetail: 'recordPlatformPayment: receipt sequence exhausted',
  })
}

/**
 * Manual entitlement override (platform decision): set/clear
 * overrideStatus on the subscription row (e.g. goodwill unlock, manual
 * restriction, suspension posture independent of School.status).
 */
export async function applySubscriptionOverride(opts: {
  schoolId: string
  overrideStatus: SubscriptionOverrideState | null
  notes?: string | null
}): Promise<{ overrideStatus: string | null }> {
  const school = await db.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true, subscription: true },
  })
  if (!school) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
  }
  const current = school.subscription
  await db.schoolSubscription.upsert({
    where: { schoolId: opts.schoolId },
    create: {
      schoolId: opts.schoolId,
      status: opts.overrideStatus ?? 'ACTIVE',
      plan: current?.plan ?? 'STANDARD',
      overrideStatus: opts.overrideStatus,
      notes: opts.notes ?? null,
    },
    update: {
      overrideStatus: opts.overrideStatus,
      notes: opts.notes ?? undefined,
    },
  })
  return { overrideStatus: opts.overrideStatus }
}

/* ═══════════ SUBSCRIPTION & ENTITLEMENT SYSTEM (2026-10-13) ═════════════
 * Plan-driven school-subscription application — the ONE code path shared by
 * the online-order settlement and the school-wide activation-code
 * redemption. Mirrors recordPlatformPayment's verified-payment invariant
 * and receipt semantics, plus plan/interval snapshots and the calendar-
 * month period math. The legacy recordPlatformPayment above is untouched
 * (existing tests + admin flow keep their behavior).
 */

export interface ApplySchoolPeriodOpts {
  schoolId: string
  /** Plan-of-record snapshots (kept on the subscription row for history). */
  planId?: string | null
  planCode?: string | null
  interval?: string | null
  priceSnapshot?: number | null
  currency?: string
  amount: number
  mode: PaymentMode
  paymentDate: Date
  validityMonths: number
  reference?: string | null
  notes?: string | null
  recordedById?: string | null
  /** Online order this payment settles (webhook/verify). */
  orderId?: string | null
  /** The platform payment row created at code ISSUANCE (offline flow) —
   *  redemption snapshots it instead of creating a second row. */
  existingPaymentId?: string | null
}

function applyReceiptNumber(seq: number): string {
  const year = new Date().getFullYear()
  return `SCH-RCP-${year}-${String(seq).padStart(5, '0')}`
}

/** Calendar-month addition (day-of-month preserved, clamped). Shared with
 *  the subscription services — one period-math implementation. */
export function addCalendarMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, daysInMonth))
  return d
}

/**
 * Apply a paid period to the tenant's subscription INSIDE the caller's
 * transaction: VERIFIED PlatformPayment (created — online/manual — or
 * snapshotted — offline code redemption) + SchoolSubscription upsert
 * (status ACTIVE, override cleared, period extended from
 * max(now, current periodEnd) by validityMonths calendar months, plan
 * snapshots set when provided).
 */
export async function applySchoolSubscriptionPeriodInTx(
  tx: Prisma.TransactionClient,
  opts: ApplySchoolPeriodOpts,
): Promise<{ paymentId: string | null; receiptNo: string | null; subscriptionId: string; statusAfter: string; periodEndAfter: Date }> {
  const school = await tx.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true, subscription: true },
  })
  if (!school) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
  }
  const current = school.subscription
  const base = current?.periodEnd && current.periodEnd.getTime() > Date.now() ? current.periodEnd : new Date()
  const months = Math.max(1, Math.min(60, Math.round(opts.validityMonths)))
  const periodEndAfter = addCalendarMonths(base, months)

  let paymentId = opts.existingPaymentId ?? null
  let receiptNo: string | null = null
  if (!paymentId) {
    const yearStart = new Date(new Date().getFullYear(), 0, 1)
    const count = await tx.platformPayment.count({ where: { createdAt: { gte: yearStart } } })
    let seq = count + 1
    let created: { id: string; receiptNo: string | null } | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        created = await tx.platformPayment.create({
          data: {
            schoolId: opts.schoolId,
            amount: opts.amount,
            currency: opts.currency ?? 'INR',
            mode: opts.mode,
            paymentDate: opts.paymentDate,
            periodMonths: months,
            reference: opts.reference ?? null,
            notes: opts.notes ?? null,
            recordedById: opts.recordedById ?? null,
            verification: 'VERIFIED',
            verifiedAt: new Date(),
            statusAfter: 'ACTIVE',
            periodEndAfter,
            receiptNo: applyReceiptNumber(seq + attempt),
            subscriptionId: current?.id ?? null,
            orderId: opts.orderId ?? null,
          },
        })
        break
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002') continue
        throw e
      }
    }
    if (!created) {
      throw new AppError('CONFLICT', {
        publicMessage: 'Could not assign a unique receipt number — please retry.',
        internalDetail: 'applySchoolSubscriptionPeriodInTx: receipt sequence exhausted',
      })
    }
    paymentId = created.id
    receiptNo = created.receiptNo
  } else {
    const existing = await tx.platformPayment.findUnique({ where: { id: paymentId } })
    receiptNo = existing?.receiptNo ?? null
  }

  const subscription = await tx.schoolSubscription.upsert({
    where: { schoolId: opts.schoolId },
    create: {
      schoolId: opts.schoolId,
      status: 'ACTIVE',
      plan: opts.planCode ?? current?.plan ?? 'STANDARD',
      billingModel: current?.billingModel ?? 'SCHOOL_WIDE',
      planId: opts.planId ?? null,
      planCode: opts.planCode ?? null,
      interval: opts.interval ?? null,
      priceSnapshot: opts.priceSnapshot ?? null,
      currencySnapshot: opts.currency ?? 'INR',
      periodStart: base,
      periodEnd: periodEndAfter,
      graceDays: current?.graceDays ?? 14,
    },
    update: {
      status: 'ACTIVE',
      planId: opts.planId ?? undefined,
      planCode: opts.planCode ?? undefined,
      interval: opts.interval ?? undefined,
      priceSnapshot: opts.priceSnapshot ?? undefined,
      currencySnapshot: opts.currency ?? undefined,
      periodStart: base,
      periodEnd: periodEndAfter,
      // A verified payment clears any manual restriction override.
      overrideStatus: null,
    },
  })

  if (paymentId && !opts.existingPaymentId) {
    await tx.platformPayment.update({ where: { id: paymentId }, data: { subscriptionId: subscription.id } })
  }
  // Offline code redemption: snapshot the applied result on the payment row.
  if (opts.existingPaymentId) {
    await tx.platformPayment.update({
      where: { id: opts.existingPaymentId },
      data: { statusAfter: 'ACTIVE', periodEndAfter },
    }).catch(() => {})
  }

  return { paymentId, receiptNo, subscriptionId: subscription.id, statusAfter: 'ACTIVE', periodEndAfter }
}
