/**
 * subscription/staff — the per-seat staff subscription DOMAIN SERVICE
 * (2026-10-30): payments, entitlement activation/extension/renewal,
 * manual/complimentary assignment and revocation for TEACHER accounts
 * under PER_SEAT staff coverage.
 *
 * This is the STAFF analogue of subscription/student.ts — SAME invariants,
 * SAME lifecycle rules, staff entities:
 *   · Only a VERIFIED StaffSubscriptionPayment (operator-recorded
 *     offline/manual) or an operator manual / complimentary assignment
 *     creates/extends a StaffEntitlement. A browser report of payment
 *     success is NEVER sufficient. (The online order lane is deliberately
 *     NOT wired for staff plans this phase — codes + operator assignment
 *     only; enabling staff checkout is an owner-gated product decision.)
 *   · ONE live entitlement per user (DB partial-unique backstop
 *     StaffEntitlement_one_live_per_user).
 *   · Revocation changes entitlement status ONLY — financial rows are
 *     immutable history.
 *   · SUSPENSION FREEZE (same approved product rule as the student side):
 *     a suspended staff entitlement receives payments by BANKING them in
 *     WINDOW time; the period starts counting only at the authorized
 *     reactivation. Dated grants onto a frozen clock are refused.
 *   · Eligibility is server-verified at EVERY write path: the target User
 *     must belong to the school and hold the CANONICAL TEACHER role.
 *     A principal's administrative privileges never qualify; a student
 *     identity never qualifies.
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient
import { AppError } from '@/lib/security/errors'
import { addMonths } from './codes'

export const STAFF_PAYMENT_MODES = [
  'ONLINE_PAYMENT',
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'OTHER',
  'COMPLIMENTARY',
] as const

export type StaffPaymentMode = (typeof STAFF_PAYMENT_MODES)[number]

/* ── STAFF ROLE COVERAGE (PHASE 5C — declarative, auditable) ─────────────
 * A staff plan MUST explicitly define which roles it covers; the tenant's
 * terms may override the plan's declaration. Enforcement (the withUser
 * per-seat gate, staff code claim, batch assignment, roster) derives the
 * EFFECTIVE set from: tenant override → plan declaration → legacy default.
 *
 * The canonical school-plane role invariant (withUser) admits exactly
 * PRINCIPAL | TEACHER | STUDENT sessions. PRINCIPAL is deliberately NEVER
 * seat-gated (administrative privileges are not a paid entitlement — see
 * the withUser comment) and STUDENT accounts are governed by billingModel,
 * so today the seat-eligible set is exactly ["TEACHER"]. The constant is
 * the single forward-compatibility point: if the canonical role set ever
 * grows (e.g. dedicated ACCOUNTANT sessions), widening THIS list widens
 * the policy surface everywhere consistently — never a stray string. */
export const STAFF_SEAT_ELIGIBLE_ROLES: readonly string[] = ['TEACHER']

/** The legacy default effective coverage — every existing tenant keeps
 *  today's behavior (teachers are the covered staff role). */
export const DEFAULT_STAFF_COVERED_ROLES: readonly string[] = ['TEACHER']

/**
 * Normalize a raw (JSON) role array into the safe effective set:
 * non-string and not-seat-eligible values are dropped; an empty or
 * fully-invalid array falls back to the DEFAULT (never an empty gate —
 * an empty set would mean "no role can ever hold a seat", which is a
 * misconfiguration, not a policy; clearing an override means null).
 */
export function normalizeStaffCoveredRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_STAFF_COVERED_ROLES]
  const kept = raw.filter(
    (r): r is string => typeof r === 'string' && (STAFF_SEAT_ELIGIBLE_ROLES as readonly string[]).includes(r),
  )
  return kept.length > 0 ? [...new Set(kept)] : [...DEFAULT_STAFF_COVERED_ROLES]
}

/**
 * The effective covered-role set for a tenant:
 * tenant override (staffCoverageRoles) → plan declaration (coveredRoles)
 * → legacy default. Every consumer (gate, claim, batch, roster) MUST
 * resolve through this helper — no path reads the raw columns directly.
 */
export function resolveStaffCoveredRoles(input: {
  tenantRoles?: unknown
  planRoles?: unknown
}): string[] {
  if (input.tenantRoles !== undefined && input.tenantRoles !== null) {
    return normalizeStaffCoveredRoles(input.tenantRoles)
  }
  if (input.planRoles !== undefined && input.planRoles !== null) {
    return normalizeStaffCoveredRoles(input.planRoles)
  }
  return [...DEFAULT_STAFF_COVERED_ROLES]
}

const CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED'])

export function staffReceiptNumber(seq: number): string {
  return `SCH-SSP-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`
}

async function nextStaffReceiptSeq(tx?: Tx): Promise<number> {
  // Atomic DB sequence — race-free inside settlement transactions.
  const rows = await (tx ?? db).$queryRaw<Array<{ seq: number }>>`SELECT nextval('staff_payment_receipt_seq')::int AS seq`
  return Number(rows[0]?.seq ?? 1)
}

/**
 * Server-side staff eligibility resolution — the ONLY way a target staff
 * member is resolved for a subscription write. Identity comes from the
 * server (route param → DB row), never from client-submitted role/school
 * fields. The target's role must be in the tenant's EFFECTIVE covered
 * role set (tenant override → plan declaration → ["TEACHER"] default);
 * PRINCIPAL administrative accounts are never paid staff seats; students
 * are governed by billingModel.
 */
export async function resolveStaffUser(
  userId: string,
  schoolId: string,
  coveredRoles: readonly string[] = DEFAULT_STAFF_COVERED_ROLES,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, schoolId: true, role: true, status: true, name: true, email: true, subscriptionStatus: true },
  })
  if (!user || user.schoolId !== schoolId) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Staff member not found in this school',
      internalDetail: `resolveStaffUser: user ${userId} not in school ${schoolId}`,
    })
  }
  if (!coveredRoles.includes(user.role)) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Staff entitlements apply only to the roles this school\u2019s staff plan covers.',
      internalDetail: `resolveStaffUser: user ${userId} role ${user.role} not in covered set [${coveredRoles.join(',')}]`,
    })
  }
  return user
}

// ── Record payment + activate/extend (offline/manual/complimentary) ────────

export interface RecordStaffPaymentInput {
  schoolId: string
  userId: string
  planId?: string | null
  planCode?: string | null
  interval?: string | null
  amount: number
  currency: string
  mode: StaffPaymentMode
  paymentDate: Date
  validityMonths?: number
  /** Explicit validity (Model C date-picked) — overrides months. */
  validityStart?: Date | null
  validityEnd?: Date | null
  reference?: string | null
  notes?: string | null
  recordedById: string
  /** 'MANUAL' | 'COMPLIMENTARY' for the operator path (ONLINE reserved). */
  source: 'MANUAL' | 'COMPLIMENTARY'
  /** Skip entitlement creation (the offline CODE path activates later). */
  deferEntitlement?: boolean
  /** The tenant's EFFECTIVE covered role set (resolveStaffCoveredRoles) —
   *  the target's role must be in it. Defaults to the legacy default
   *  (["TEACHER"]) when the caller has not resolved the tenant policy. */
  coveredRoles?: readonly string[]
  /** Caller-provided transaction client — when set, the payment (and
   *  activation) are written INSIDE the caller's transaction (used by the
   *  batch issuance route; the default runs its own transaction). */
  tx?: Prisma.TransactionClient
}

export interface RecordStaffPaymentResult {
  paymentId: string
  receiptNo: string
  entitlementId: string | null
  validityStart: Date
  validityEnd: Date
  statusAfter: 'ACTIVE' | 'PENDING' | 'SUSPENDED'
}

/**
 * Record a VERIFIED staff payment and (unless deferred for the offline
 * code handshake) create/extend the staff entitlement — ONE transaction.
 * COMPLIMENTARY requires amount 0 and is caller-permission-gated.
 */
export async function recordStaffPayment(input: RecordStaffPaymentInput): Promise<RecordStaffPaymentResult> {
  if (input.mode === 'COMPLIMENTARY' && input.amount !== 0) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Complimentary entitlements carry no amount — use a paid mode for paid assignments.',
      internalDetail: 'recordStaffPayment: complimentary with amount',
    })
  }
  if (input.mode !== 'COMPLIMENTARY' && !(input.amount > 0)) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Payment amount must be greater than zero.',
      internalDetail: 'recordStaffPayment: non-positive amount',
    })
  }
  if (!CURRENCIES.has(input.currency)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Unsupported currency' })
  }
  await resolveStaffUser(input.userId, input.schoolId, input.coveredRoles)

  const seq = await nextStaffReceiptSeq(input.tx)
  const receiptNo = staffReceiptNumber(seq)
  const run = async (tx: Prisma.TransactionClient) => {
    const payment = await tx.staffSubscriptionPayment.create({
      data: {
        schoolId: input.schoolId,
        userId: input.userId,
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

    const activated = await activateStaffEntitlementInTx(tx, {
      schoolId: input.schoolId,
      userId: input.userId,
      planId: input.planId ?? null,
      planCode: input.planCode ?? null,
      source: input.source,
      paymentId: payment.id,
      validityMonths: input.validityMonths ?? 12,
      validityStartOverride: input.validityStart ?? null,
      validityEndOverride: input.validityEnd ?? null,
    })

    await tx.staffSubscriptionPayment.update({
      where: { id: payment.id },
      data: {
        entitlementId: activated.entitlementId,
        statusAfter: activated.statusAfter,
        validityEndAfter: activated.validityEnd,
      },
    })
    return { paymentId: payment.id, receiptNo, ...activated }
  }
  if (input.tx) {
    return run(input.tx)
  }
  return db.$transaction(run, { timeout: 15_000 })
}

// ── Entitlement activation core (shared by every activation cause) ─────────

export interface ActivateStaffEntitlementOpts {
  schoolId: string
  userId: string
  planId?: string | null
  planCode?: string | null
  source: 'OFFLINE_CODE' | 'MANUAL' | 'COMPLIMENTARY'
  paymentId?: string | null
  activationCodeId?: string | null
  validityMonths: number
  validityStartOverride?: Date | null
  validityEndOverride?: Date | null
}

/**
 * Create/extend the live staff entitlement inside the caller's
 * transaction. RENEWAL / BANKING / SUPERSEDE semantics are IDENTICAL to
 * activateEntitlementInTx (subscription/student.ts) — read there for the
 * full rationale. Concurrency is backed by the partial unique index
 * StaffEntitlement_one_live_per_user (P2002 → honest CONFLICT).
 */
export async function activateStaffEntitlementInTx(
  tx: Tx,
  opts: ActivateStaffEntitlementOpts,
): Promise<{ entitlementId: string; validityStart: Date; validityEnd: Date; statusAfter: 'ACTIVE' | 'PENDING' | 'SUSPENDED' }> {
  const now = new Date()
  let anchor = await tx.staffEntitlement.findFirst({
    where: { userId: opts.userId, status: { in: ['PENDING', 'ACTIVE'] } },
    orderBy: { validityEnd: 'desc' },
  })

  // ── SUSPENSION BANKING (same approved product rule as students) ──────
  if (!anchor) {
    const suspendedRow = await tx.staffEntitlement.findFirst({
      where: { userId: opts.userId, status: 'SUSPENDED' },
      orderBy: { validityEnd: 'desc' },
    })
    if (suspendedRow) {
      if (opts.validityStartOverride || opts.validityEndOverride) {
        throw new AppError('CONFLICT', {
          publicMessage:
            'This staff entitlement is suspended — reactivate it first, then apply dated grants. The paid period is reserved and starts at reactivation.',
          internalDetail: 'activateStaffEntitlementInTx: dated grant onto a SUSPENDED entitlement refused',
        })
      }
      let current = suspendedRow
      for (let attempt = 0; attempt < 4; attempt++) {
        const bankedEnd = addMonths(current.validityEnd, Math.max(1, opts.validityMonths))
        const banked = await tx.staffEntitlement.updateMany({
          where: { id: current.id, status: 'SUSPENDED', validityEnd: current.validityEnd },
          data: {
            validityEnd: bankedEnd,
            planId: opts.planId ?? current.planId,
            planCode: opts.planCode ?? current.planCode,
            paymentId: opts.paymentId ?? current.paymentId,
            activationCodeId: opts.activationCodeId ?? current.activationCodeId,
          },
        })
        if (banked.count === 1) {
          return {
            entitlementId: current.id,
            validityStart: current.validityStart,
            validityEnd: bankedEnd,
            statusAfter: 'SUSPENDED' as const,
          }
        }
        const reloaded = await tx.staffEntitlement.findUnique({ where: { id: current.id } })
        if (!reloaded) break
        current = reloaded
        if (reloaded.status === 'PENDING' || reloaded.status === 'ACTIVE') {
          anchor = reloaded
          break
        }
        if (reloaded.status !== 'SUSPENDED') break
      }
      if (!anchor && current.status === 'SUSPENDED') {
        throw new AppError('CONFLICT', {
          publicMessage: 'The subscription was updated by another payment at the same moment — please retry.',
          internalDetail: 'activateStaffEntitlementInTx: banking optimistic-concurrency retries exhausted',
        })
      }
    }
  }

  // ── Renewal: extend the live row in place (optimistic-concurrency). ──
  if (anchor && anchor.validityEnd.getTime() > now.getTime() && !opts.validityStartOverride && !opts.validityEndOverride) {
    let current: typeof anchor | null = anchor
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!current) break
      const extendedEnd = addMonths(current.validityEnd, Math.max(1, opts.validityMonths))
      const extended = await tx.staffEntitlement.updateMany({
        where: { id: current.id, status: current.status, validityEnd: current.validityEnd },
        data: {
          validityEnd: extendedEnd,
          planId: opts.planId ?? current.planId,
          planCode: opts.planCode ?? current.planCode,
          paymentId: opts.paymentId ?? current.paymentId,
          activatedAt: current.activatedAt ?? now,
          status: current.validityStart.getTime() <= now.getTime() ? 'ACTIVE' : 'PENDING',
        },
      })
      if (extended.count === 1) {
        return {
          entitlementId: current.id,
          validityStart: current.validityStart,
          validityEnd: extendedEnd,
          statusAfter: current.validityStart.getTime() <= now.getTime() ? 'ACTIVE' : 'PENDING',
        }
      }
      const reloaded = await tx.staffEntitlement.findFirst({
        where: { userId: opts.userId, status: { in: ['PENDING', 'ACTIVE'] } },
        orderBy: { validityEnd: 'desc' },
      })
      if (!reloaded || reloaded.id !== anchor.id || reloaded.validityEnd.getTime() <= now.getTime()) {
        current = null
        break
      }
      current = reloaded
    }
    if (current) {
      throw new AppError('CONFLICT', {
        publicMessage: 'The subscription was extended by another payment at the same moment — please retry.',
        internalDetail: 'activateStaffEntitlementInTx: renewal optimistic-concurrency retries exhausted',
      })
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
        internalDetail: 'activateStaffEntitlementInTx: end <= start',
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
    const superseded = await tx.staffEntitlement.updateMany({
      where: { id: anchor.id, status: anchor.status, validityEnd: anchor.validityEnd },
      data: {
        status: anchor.validityEnd.getTime() <= now.getTime() ? 'EXPIRED' : 'REVOKED',
        revokeReason: 'Superseded by a dated grant',
      },
    })
    if (superseded.count !== 1) {
      throw new AppError('CONFLICT', {
        publicMessage: 'This staff subscription changed while the grant was being applied — please retry.',
        internalDetail: 'activateStaffEntitlementInTx: supersede conditional update lost',
      })
    }
  }

  const startActive = validity.validityStart.getTime() <= now.getTime()
  try {
    const row = await tx.staffEntitlement.create({
      data: {
        schoolId: opts.schoolId,
        userId: opts.userId,
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
      throw new AppError('CONFLICT', {
        publicMessage: 'This staff member already has an active subscription — no second entitlement was created.',
        internalDetail: 'activateStaffEntitlementInTx: partial-unique guard (live row exists)',
      })
    }
    throw e
  }
}

// ── Operator lifecycle actions ──────────────────────────────────────────────

export type StaffEntitlementLifecycleAction = 'revoke' | 'suspend' | 'reactivate' | 'adjust-validity'

export interface StaffEntitlementLifecycleResult {
  status: string
  reanchored?: { validityStart: Date; validityEnd: Date }
}

/**
 * Lifecycle on the staff LIVE row — identical rules to the student
 * applyEntitlementLifecycle (revoke = status-only, reactivate =
 * frozen-clock resume, adjust = EXTEND-ONLY). See student.ts for the
 * full rationale of each rule.
 */
export async function applyStaffEntitlementLifecycle(opts: {
  entitlementId: string
  adminId: string
  action: StaffEntitlementLifecycleAction
  reason?: string
  validityEnd?: Date | null
}): Promise<StaffEntitlementLifecycleResult> {
  let row = await db.staffEntitlement.findUnique({ where: { id: opts.entitlementId } })
  if (!row) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Entitlement not found' })
  }
  const now = new Date()
  if (opts.action === 'revoke') {
    await db.staffEntitlement.update({
      where: { id: row.id },
      data: { status: 'REVOKED', revokedAt: now, revokedById: opts.adminId, revokeReason: opts.reason ?? 'Revoked by platform operator' },
    })
    return { status: 'REVOKED' }
  }
  if (opts.action === 'suspend') {
    await db.staffEntitlement.update({
      where: { id: row.id },
      data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: opts.reason ?? 'Suspended by platform operator' },
    })
    return { status: 'SUSPENDED' }
  }
  if (opts.action === 'reactivate') {
    if (row.status !== 'SUSPENDED') {
      if (row.validityEnd.getTime() <= now.getTime()) {
        throw new AppError('CONFLICT', {
          publicMessage: 'This entitlement has already expired — record a renewal payment instead of reactivating.',
          internalDetail: 'applyStaffEntitlementLifecycle: reactivate past validityEnd',
        })
      }
      return { status: row.status }
    }
    // ── FROZEN-CLOCK RESUME (same rule as the student side). ───────────
    let suspended = row
    for (let attempt = 0; attempt < 4; attempt++) {
      const frozenFrom = new Date(
        Math.max(suspended.validityStart.getTime(), suspended.suspendedAt?.getTime() ?? suspended.validityStart.getTime()),
      )
      const remainingMs = suspended.validityEnd.getTime() - frozenFrom.getTime()
      if (remainingMs <= 0) {
        throw new AppError('CONFLICT', {
          publicMessage: 'This entitlement has no remaining validity — record a renewal payment instead of reactivating.',
          internalDetail: 'applyStaffEntitlementLifecycle: reactivate with no remaining window',
        })
      }
      const newStart = new Date()
      const newEnd = new Date(newStart.getTime() + remainingMs)
      try {
        const updated = await db.staffEntitlement.updateMany({
          where: { id: suspended.id, status: 'SUSPENDED', validityEnd: suspended.validityEnd },
          data: { status: 'ACTIVE', validityStart: newStart, validityEnd: newEnd, suspendedAt: null, suspendReason: null },
        })
        if (updated.count === 1) {
          return { status: 'ACTIVE', reanchored: { validityStart: newStart, validityEnd: newEnd } }
        }
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002') {
          throw new AppError('CONFLICT', {
            publicMessage: 'This staff member already has a live entitlement — the suspended row cannot be reactivated.',
            internalDetail: 'applyStaffEntitlementLifecycle: reactivate hit one-live-per-user index',
          })
        }
        throw e
      }
      const reloaded = await db.staffEntitlement.findUnique({ where: { id: suspended.id } })
      if (!reloaded || reloaded.status !== 'SUSPENDED') {
        return { status: reloaded?.status ?? suspended.status }
      }
      suspended = reloaded
    }
    throw new AppError('CONFLICT', {
      publicMessage: 'The subscription changed while reactivation was being applied — please retry.',
      internalDetail: 'applyStaffEntitlementLifecycle: reactivate optimistic-concurrency retries exhausted',
    })
  }
  // adjust-validity — EXTEND-ONLY on live rows (same rule as students).
  if (!opts.validityEnd) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'A new validity end is required.' })
  }
  if (opts.validityEnd.getTime() <= row.validityStart.getTime()) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Validity end must remain after the start.' })
  }
  if (
    row.status !== 'REVOKED' &&
    opts.validityEnd.getTime() <= Math.max(now.getTime(), row.validityEnd.getTime())
  ) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage:
        'Validity adjustments can only EXTEND the current end date. To end access early, revoke the entitlement instead — financial records are preserved either way.',
      internalDetail: 'applyStaffEntitlementLifecycle: adjust-validity would not extend the live window',
    })
  }
  await db.staffEntitlement.update({
    where: { id: row.id },
    data: { validityEnd: opts.validityEnd },
  })
  return { status: 'ADJUSTED' }
}

// ── Status projection ───────────────────────────────────────────────────────

/** Load the live (PENDING|ACTIVE) staff entitlement for a user — null when
 *  none exists. History rows are excluded by status filter. */
export async function loadLiveStaffEntitlement(userId: string) {
  return db.staffEntitlement.findFirst({
    where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
    orderBy: { validityEnd: 'desc' },
    include: { plan: { select: { code: true, name: true } } },
  })
}
