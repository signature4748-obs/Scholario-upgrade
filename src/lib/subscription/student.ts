/**
 * subscription/student — the per-student subscription DOMAIN SERVICE
 * (Model B/C): payments, entitlement activation/extension/renewal,
 * manual/complimentary assignment and revocation.
 *
 * INVARIANTS (docs/SUBSCRIPTION_ENTITLEMENT_SYSTEM.md):
 *   · Only a VERIFIED StudentSubscriptionPayment (operator-recorded
 *     offline/manual, or settled online order) or an operator manual /
 *     complimentary assignment creates/extends an entitlement. A browser
 *     report of payment success is NEVER sufficient.
 *   · Every mutation is transactional + audited by the caller.
 *   · ONE live entitlement per student (DB partial-unique backstop).
 *   · Revocation changes entitlement status ONLY — financial rows are
 *     immutable history.
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient
import { AppError } from '@/lib/security/errors'
import { addMonths } from './codes'

export const STUDENT_PAYMENT_MODES = [
  'ONLINE_PAYMENT',
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'OTHER',
  'COMPLIMENTARY',
] as const
export type StudentPaymentMode = (typeof STUDENT_PAYMENT_MODES)[number]

const CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED'])

export function studentReceiptNumber(seq: number): string {
  return `SCH-SSR-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`
}

async function nextStudentReceiptSeq(tx?: typeof db): Promise<number> {
  // Atomic DB sequence — race-free inside settlement transactions.
  const rows = await (tx ?? db).$queryRaw<Array<{ seq: number }>>`SELECT nextval('student_payment_receipt_seq')::int AS seq`
  return Number(rows[0]?.seq ?? 1)
}

// ── Record payment + activate/extend (offline/manual/complimentary) ─────────

export interface RecordStudentPaymentInput {
  schoolId: string
  studentId: string
  planId?: string | null
  planCode?: string | null
  interval?: string | null
  amount: number
  currency: string
  mode: StudentPaymentMode
  paymentDate: Date
  validityMonths?: number
  /** Explicit validity (Model C date-picked) — overrides months. */
  validityStart?: Date | null
  validityEnd?: Date | null
  reference?: string | null
  notes?: string | null
  recordedById: string
  /** 'admin' offline/manual recording | 'verify'/'webhook' settled online. */
  source: 'ONLINE' | 'OFFLINE_CODE' | 'MANUAL' | 'COMPLIMENTARY'
  /** Online order linkage (settlement paths). */
  orderId?: string | null
  /** Skip entitlement creation (the offline CODE path activates later). */
  deferEntitlement?: boolean
}

export interface RecordStudentPaymentResult {
  paymentId: string
  receiptNo: string
  entitlementId: string | null
  validityStart: Date
  validityEnd: Date
  statusAfter: 'ACTIVE' | 'PENDING'
}

/**
 * Record a VERIFIED student payment and (unless deferred for the offline
 * code handshake) create/extend the student entitlement — ONE transaction.
 * COMPLIMENTARY requires amount 0 and is caller-permission-gated.
 */
export async function recordStudentPayment(
  input: RecordStudentPaymentInput,
): Promise<RecordStudentPaymentResult> {
  if (input.mode === 'COMPLIMENTARY' && input.amount !== 0) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Complimentary entitlements carry no amount — use a paid mode for paid assignments.',
      internalDetail: 'recordStudentPayment: complimentary with amount',
    })
  }
  if (input.mode !== 'COMPLIMENTARY' && !(input.amount > 0)) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Payment amount must be greater than zero.',
      internalDetail: 'recordStudentPayment: non-positive amount',
    })
  }
  if (!CURRENCIES.has(input.currency)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Unsupported currency' })
  }

  const student = await db.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, schoolId: true, userId: true },
  })
  if (!student || student.schoolId !== input.schoolId) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Student not found in this school',
      internalDetail: `recordStudentPayment: student ${input.studentId} not in school ${input.schoolId}`,
    })
  }

  const seq = await nextStudentReceiptSeq()
  const receiptNo = studentReceiptNumber(seq)
  return db.$transaction(async (tx) => {
        const payment = await tx.studentSubscriptionPayment.create({
          data: {
            schoolId: input.schoolId,
            studentId: input.studentId,
            planId: input.planId ?? null,
            planCode: input.planCode ?? null,
            interval: input.interval ?? null,
            amount: input.amount,
            currency: input.currency,
            mode: input.mode,
            paymentDate: input.paymentDate,
            validityMonths: input.validityMonths ?? 12,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            recordedById: input.mode === 'ONLINE_PAYMENT' ? null : input.recordedById,
            verification: 'VERIFIED',
            verifiedAt: new Date(),
            orderId: input.orderId ?? null,
            receiptNo,
          },
        })

        if (input.deferEntitlement) {
          // Offline code handshake: the payment exists (immutable financial
          // record) but the entitlement activates at code claim time.
          const start = input.validityStart ?? new Date()
          const end = input.validityEnd ?? addMonths(start, Math.max(1, input.validityMonths ?? 12))
          return { paymentId: payment.id, receiptNo, entitlementId: null, validityStart: start, validityEnd: end, statusAfter: 'PENDING' as const }
        }

        const activated = await activateEntitlementInTx(tx, {
          schoolId: input.schoolId,
          studentId: input.studentId,
          planId: input.planId ?? null,
          planCode: input.planCode ?? null,
          source: input.source,
          paymentId: payment.id,
          validityMonths: input.validityMonths ?? 12,
          validityStartOverride: input.validityStart ?? null,
          validityEndOverride: input.validityEnd ?? null,
        })

        await tx.studentSubscriptionPayment.update({
          where: { id: payment.id },
          data: {
            entitlementId: activated.entitlementId,
            statusAfter: activated.statusAfter,
            validityEndAfter: activated.validityEnd,
          },
        })
      return { paymentId: payment.id, receiptNo, ...activated }
  }, { timeout: 15_000 })
}

// ── Entitlement activation core (shared by every activation cause) ─────────

export interface ActivateEntitlementOpts {
  schoolId: string
  studentId: string
  planId?: string | null
  planCode?: string | null
  source: 'ONLINE' | 'OFFLINE_CODE' | 'MANUAL' | 'COMPLIMENTARY'
  paymentId?: string | null
  activationCodeId?: string | null
  validityMonths: number
  validityStartOverride?: Date | null
  validityEndOverride?: Date | null
}

/**
 * Create/extend the live entitlement inside the caller's transaction.
 *
 * RENEWAL SEMANTICS (the acceptance-critical rule): when the student
 * already holds a live (PENDING|ACTIVE) entitlement, a new payment
 * EXTENDS that row — validityEnd = addMonths(max(now, current
 * validityEnd), months). The student never loses the current period by
 * pre-paying, and there is always exactly ONE live row (the partial
 * unique index). Financial history lives in the immutable payment rows
 * that link to the entitlement; REVOKED/EXPIRED rows only appear when an
 * entitlement is actually withdrawn or lapses.
 *
 * First activation: explicit validity dates (Model C date-picked) or
 * months from now (or from an explicit future start → PENDING).
 * Concurrent activation attempts are backed by the partial unique index
 * (P2002 → honest CONFLICT — never a double grant).
 */
export async function activateEntitlementInTx(
  tx: Tx,
  opts: ActivateEntitlementOpts,
): Promise<{ entitlementId: string; validityStart: Date; validityEnd: Date; statusAfter: 'ACTIVE' | 'PENDING' }> {
  const now = new Date()
  const anchor = await tx.studentEntitlement.findFirst({
    where: { studentId: opts.studentId, status: { in: ['PENDING', 'ACTIVE'] } },
    orderBy: { validityEnd: 'desc' },
  })

  // ── Renewal: extend the live row in place. ──
  if (anchor && anchor.validityEnd.getTime() > now.getTime() && !opts.validityStartOverride && !opts.validityEndOverride) {
    const extendedEnd = opts.validityEndOverride ?? addMonths(anchor.validityEnd, Math.max(1, opts.validityMonths))
    await tx.studentEntitlement.update({
      where: { id: anchor.id },
      data: {
        validityEnd: extendedEnd,
        planId: opts.planId ?? anchor.planId,
        planCode: opts.planCode ?? anchor.planCode,
        paymentId: opts.paymentId ?? anchor.paymentId,
        activatedAt: anchor.activatedAt ?? now,
        status: anchor.validityStart.getTime() <= now.getTime() ? 'ACTIVE' : 'PENDING',
      },
    })
    return {
      entitlementId: anchor.id,
      validityStart: anchor.validityStart,
      validityEnd: extendedEnd,
      statusAfter: anchor.validityStart.getTime() <= now.getTime() ? 'ACTIVE' : 'PENDING',
    }
  }

  // ── First activation (or an explicitly dated grant). ──
  const anchorEnd = anchor?.validityEnd && anchor.validityEnd.getTime() > now.getTime() ? anchor.validityEnd : null
  let validity: { validityStart: Date; validityEnd: Date }
  if (opts.validityEndOverride) {
    const start = opts.validityStartOverride ?? (anchorEnd ?? now)
    if (opts.validityEndOverride.getTime() <= start.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        publicMessage: 'Validity end must be after the validity start.',
        internalDetail: 'activateEntitlementInTx: end <= start',
      })
    }
    validity = { validityStart: start, validityEnd: opts.validityEndOverride }
  } else if (anchorEnd) {
    validity = { validityStart: anchorEnd, validityEnd: addMonths(anchorEnd, Math.max(1, opts.validityMonths)) }
  } else {
    const start = opts.validityStartOverride ?? now
    validity = { validityStart: start, validityEnd: addMonths(start, Math.max(1, opts.validityMonths)) }
  }

  if (anchor) {
    await tx.studentEntitlement.update({
      where: { id: anchor.id },
      data: {
        status: anchor.validityEnd.getTime() <= now.getTime() ? 'EXPIRED' : 'REVOKED',
        revokeReason: 'Superseded by a dated grant',
      },
    })
  }

  const startActive = validity.validityStart.getTime() <= now.getTime()
  try {
    const row = await tx.studentEntitlement.create({
      data: {
        schoolId: opts.schoolId,
        studentId: opts.studentId,
        planId: opts.planId ?? null,
        planCode: opts.planCode ?? null,
        status: startActive ? 'ACTIVE' : 'PENDING',
        validityStart: validity.validityStart,
        validityEnd: validity.validityEnd,
        source: opts.source,
        paymentId: opts.paymentId ?? null,
        activationCodeId: opts.activationCodeId ?? null,
        activatedAt: startActive ? now : null,
      },
    })
    return { entitlementId: row.id, validityStart: validity.validityStart, validityEnd: validity.validityEnd, statusAfter: startActive ? 'ACTIVE' : 'PENDING' }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') {
      const winner = await tx.studentEntitlement.findFirst({
        where: { studentId: opts.studentId, status: { in: ['PENDING', 'ACTIVE'] } },
        orderBy: { validityEnd: 'desc' },
      })
      throw new AppError('CONFLICT', {
        publicMessage: winner
          ? 'This student already has an active subscription — no second entitlement was created.'
          : 'The subscription could not be activated — please retry or contact SCHOLARIO support.',
        internalDetail: `activateEntitlementInTx: partial-unique guard (live row ${winner?.id ?? 'none'})`,
      })
    }
    throw e
  }
}

// ── Operator lifecycle actions ──────────────────────────────────────────────

export type EntitlementLifecycleAction = 'revoke' | 'suspend' | 'reactivate' | 'adjust-validity'

export async function applyEntitlementLifecycle(opts: {
  entitlementId: string
  adminId: string
  action: EntitlementLifecycleAction
  reason?: string
  validityEnd?: Date | null
}): Promise<{ status: string }> {
  const row = await db.studentEntitlement.findUnique({ where: { id: opts.entitlementId } })
  if (!row) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Entitlement not found' })
  }
  const now = new Date()
  if (opts.action === 'revoke') {
    // Never erase financial history: status + reason only.
    await db.studentEntitlement.update({
      where: { id: row.id },
      data: { status: 'REVOKED', revokedAt: now, revokedById: opts.adminId, revokeReason: opts.reason ?? 'Revoked by platform operator' },
    })
    return { status: 'REVOKED' }
  }
  if (opts.action === 'suspend') {
    await db.studentEntitlement.update({
      where: { id: row.id },
      data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: opts.reason ?? 'Suspended by platform operator' },
    })
    return { status: 'SUSPENDED' }
  }
  if (opts.action === 'reactivate') {
    if (row.validityEnd.getTime() <= now.getTime()) {
      throw new AppError('CONFLICT', {
        publicMessage: 'This entitlement has already expired — record a renewal payment instead of reactivating.',
        internalDetail: 'applyEntitlementLifecycle: reactivate past validityEnd',
      })
    }
    await db.studentEntitlement.update({
      where: { id: row.id },
      data: { status: row.validityStart.getTime() > now.getTime() ? 'PENDING' : 'ACTIVE', suspendedAt: null, suspendReason: null },
    })
    return { status: row.validityStart.getTime() > now.getTime() ? 'PENDING' : 'ACTIVE' }
  }
  // adjust-validity
  if (!opts.validityEnd) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'A new validity end is required.' })
  }
  if (opts.validityEnd.getTime() <= row.validityStart.getTime()) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Validity end must remain after the start.' })
  }
  await db.studentEntitlement.update({
    where: { id: row.id },
    data: { validityEnd: opts.validityEnd },
  })
  return { status: 'ADJUSTED' }
}

// ── Status projection (registry / school views) ─────────────────────────────

export interface StudentStatusRow {
  studentId: string
  schoolId: string
}

/** Load the live (PENDING|ACTIVE) entitlement snapshot for a student —
 *  null when none exists. History rows are excluded by status filter. */
export async function loadLiveEntitlement(studentId: string) {
  return db.studentEntitlement.findFirst({
    where: { studentId, status: { in: ['PENDING', 'ACTIVE'] } },
    orderBy: { validityEnd: 'desc' },
    include: { plan: { select: { code: true, name: true } } },
  })
}
