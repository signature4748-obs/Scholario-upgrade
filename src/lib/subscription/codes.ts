/**
 * subscription/codes — the activation-code engine.
 *
 * Codes are the OFFLINE delivery handshake between an operator-recorded
 * VERIFIED payment and the entitlement it buys (Model A school-wide and
 * Model B/C per-student).
 *
 * Security contract (docs/SUBSCRIPTION_ENTITLEMENT_SYSTEM.md §3–4):
 *   · Code = 100 bits of crypto randomness, Crockford-base32, grouped.
 *     Plaintext exists ONCE at issuance (returned to the operator, shown
 *     exactly once, never stored, never logged, never emailed).
 *   · At rest: sha256(code) only. publicRef (SCH-ACT-… ) is the
 *     support-safe identifier for lookup / revoke / reissue.
 *   · Claim: authenticated claimant, server-resolved student/school scope,
 *     one atomic transaction with a CONDITIONAL UPDATE on the code row
 *     (status ISSUED → CLAIMED) — concurrent claims are impossible; the
 *     partial unique index on StudentEntitlement backs the entitlement
 *     side (double activation impossible at the DB level).
 *   · Error responses are GENERIC (no oracle about code existence, scope,
 *     owner, or another tenant's state). Rejection REASON CLASSES are
 *     recorded in ActivationCodeEvent for the code's own diagnostics only.
 *   · Reissue = revoke old + issue replacement (one transaction).
 *   · School-wide codes activate the TENANT subscription once — they
 *     never mint per-member grants.
 */
import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { activateEntitlementInTx } from './student'

/** Prisma interactive-transaction client (the tx parameter type). */
type Tx = Prisma.TransactionClient
import { AppError } from '@/lib/security/errors'

// ── Code generation ────────────────────────────────────────────────────────

/** Crockford base32 (no I/L/O/U — unambiguous for hand transcription). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Generate a fresh code: 20 chars (100 bits) in 4 groups of 5. */
function generateCode(): string {
  const bytes = randomBytes(20)
  let raw = ''
  for (let i = 0; i < 20; i++) raw += ALPHABET[bytes[i] % 32]
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`
}

/** Normalize a user-typed code (uppercase, strip spaces/dashes) then hash. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '')
}

export function hashCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex')
}

// ── Reference numbers (same year-scoped sequence pattern as receipts) ──────

function activationRef(seq: number): string {
  return `SCH-ACT-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`
}

async function nextActivationSeq(tx: typeof db): Promise<number> {
  // Atomic DB sequence — race-free inside issuance transactions (the
  // count-based variant collided under concurrent claims: P2002 aborted
  // the caller's transaction).
  const rows = await (tx ?? db).$queryRaw<Array<{ seq: number }>>`SELECT nextval('activation_code_ref_seq')::int AS seq`
  return Number(rows[0]?.seq ?? 1)
}

// ── Validity computation (explicit dates, never labels) ────────────────────

/** Calendar-month addition (date-of-month preserved, clamped to the month). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, daysInMonth))
  return d
}

export interface CodeValidity {
  validityStart: Date
  validityEnd: Date
}

/** Resolve the validity window a code grants when claimed:
 *  explicit overrides (Model C date-picked) win, else months from the
 *  claim time (or from an explicit future start). */
export function resolveValidity(opts: {
  validityMonths: number
  claimedAt: Date
  validityStartOverride?: Date | null
  validityEndOverride?: Date | null
}): CodeValidity {
  const start = opts.validityStartOverride ?? opts.claimedAt
  if (opts.validityEndOverride) {
    const end = new Date(opts.validityEndOverride)
    if (end.getTime() <= start.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        publicMessage: 'Validity end must be after the validity start.',
        internalDetail: 'resolveValidity: end <= start',
      })
    }
    return { validityStart: start, validityEnd: end }
  }
  return { validityStart: start, validityEnd: addMonths(start, Math.max(1, opts.validityMonths)) }
}

// ── Issuance ────────────────────────────────────────────────────────────────

export type CodeScope = 'SCHOOL_SUBSCRIPTION' | 'STUDENT_ENTITLEMENT'

export interface IssueCodeInput {
  scope: CodeScope
  schoolId: string
  studentId?: string | null
  planId?: string | null
  planCode?: string | null
  interval?: string | null
  validityMonths: number
  validityStartOverride?: Date | null
  validityEndOverride?: Date | null
  claimWindowDays: number
  issuedById: string
  /** Issuance authorization: the VERIFIED payment row this code delivers
   *  (platformPayment:<id> / studentPayment:<id>) — every offline code
   *  traces to a payment or an explicit operator authorization. */
  paymentRef?: string | null
  /** Transaction client — issuance participates in the caller's payment
   *  transaction so a failed payment rollback removes the code too. */
  tx?: Tx
}

export interface IssuedCode {
  codeId: string
  publicRef: string
  /** The plaintext code — the ONLY copy, returned once to the operator. */
  code: string
  expiresAt: Date
}

export async function issueActivationCode(input: IssueCodeInput): Promise<IssuedCode> {
  const client = input.tx ?? db
  if (input.scope === 'STUDENT_ENTITLEMENT' && !input.studentId) {
    throw new AppError('VALIDATION_FAILED', {
      publicMessage: 'Student-scoped codes require a student.',
      internalDetail: 'issueActivationCode: student scope without studentId',
    })
  }
  const claimWindow = Math.min(365, Math.max(1, Math.round(input.claimWindowDays)))
  const expiresAt = new Date(Date.now() + claimWindow * 24 * 60 * 60 * 1000)
  const code = generateCode()
  const codeHash = hashCode(normalizeCode(code))
  let seq = await nextActivationSeq(input.tx)

  // publicRef uniqueness: count-based sequence with the unique index as the
  // race backstop (same honest-retry pattern as receipt numbers).
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const row = await client.activationCode.create({
        data: {
          publicRef: activationRef(seq + attempt),
          codeHash,
          scope: input.scope,
          schoolId: input.schoolId,
          studentId: input.studentId ?? null,
          planId: input.planId ?? null,
          planCode: input.planCode ?? null,
          interval: input.interval ?? null,
          validityMonths: Math.max(1, Math.round(input.validityMonths)),
          validityStartOverride: input.validityStartOverride ?? null,
          validityEndOverride: input.validityEndOverride ?? null,
          status: 'ISSUED',
          issuedById: input.issuedById,
          claimWindowDays: claimWindow,
          expiresAt,
          paymentRef: input.paymentRef ?? null,
        },
      })
      await client.activationCodeEvent.create({
        data: {
          codeId: row.id,
          type: 'ISSUED',
          detail: JSON.stringify({ scope: input.scope, claimWindowDays: claimWindow, paymentRef: input.paymentRef ?? null }),
        },
      })
      return { codeId: row.id, publicRef: row.publicRef, code, expiresAt }
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2002') continue // ref collision
      throw e
    }
  }
  throw new AppError('CONFLICT', {
    publicMessage: 'Could not assign a unique activation-code reference — please retry.',
    internalDetail: 'issueActivationCode: sequence exhausted',
  })
}

// ── Rejection reason classes (recorded internally; responses stay generic) ─

export type ClaimRejection =
  | 'NOT_FOUND' // no such code hash (also covers malformed)
  | 'ALREADY_CLAIMED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'REPLACED'
  | 'SCOPE_MISMATCH' // code is of the other kind than the claim surface
  | 'SCHOOL_MISMATCH' // code belongs to another tenant
  | 'STUDENT_MISMATCH' // student code destined for a different student
  | 'RACE_LOST' // concurrent claim won the conditional update

export class CodeClaimError extends AppError {
  constructor(
    public readonly reason: ClaimRejection,
    publicDetail: string,
  ) {
    super('SUBSCRIPTION_REQUIRED', {
      publicMessage: publicDetail,
      internalDetail: `codeClaim: ${reason}`,
    })
  }
}

/** The generic, user-safe message for every student-claim rejection. */
const STUDENT_CLAIM_MESSAGE =
  'This activation code is not valid for your account. Check the code with your school office, or ask them to reissue it.'

// ── Student claim (Model B/C) ───────────────────────────────────────────────

export interface StudentClaimContext {
  /** The authenticated claimant (session-resolved; never client input). */
  userId: string
  schoolId: string
  studentId: string
  ip?: string | null
}

export interface StudentClaimResult {
  entitlementId: string
  validityStart: Date
  validityEnd: Date
  status: 'ACTIVE' | 'PENDING'
  planCode: string | null
  publicRef: string
}

/**
 * Claim a student-scoped activation code — ONE transaction:
 *   lookup by hash → scope/tenant/student checks → conditional UPDATE
 *   (ISSUED→CLAIMED, race-safe) → entitlement upsert (anchored at
 *   max(now, current validityEnd) for renewals) → claim event.
 *
 * The partial unique index `StudentEntitlement_one_live_per_student` is the
 * DB-level backstop: even two concurrent winning claims cannot produce two
 * live entitlements (the second transaction aborts with P2002 → honest
 * CONFLICT, never a double grant).
 */
export async function claimStudentActivationCode(
  codeInput: string,
  ctx: StudentClaimContext,
): Promise<StudentClaimResult> {
  const normalized = normalizeCode(String(codeInput ?? ''))
  if (normalized.length < 15) {
    // Malformed input — indistinguishable from not-found by design.
    throw new CodeClaimError('NOT_FOUND', STUDENT_CLAIM_MESSAGE)
  }
  const hash = hashCode(normalized)
  const now = new Date()

  return db.$transaction(async (tx) => {
    const code = await tx.activationCode.findUnique({ where: { codeHash: hash } })
    if (!code) throw new CodeClaimError('NOT_FOUND', STUDENT_CLAIM_MESSAGE)

    const reject = async (reason: ClaimRejection) => {
      await tx.activationCodeEvent.create({
        data: {
          codeId: code.id,
          type: 'CLAIM_REJECTED',
          userId: ctx.userId,
          studentId: ctx.studentId,
          ip: ctx.ip ?? null,
          detail: JSON.stringify({ reason }),
        },
      })
      throw new CodeClaimError(reason, STUDENT_CLAIM_MESSAGE)
    }

    if (code.scope !== 'STUDENT_ENTITLEMENT') await reject('SCOPE_MISMATCH')
    if (code.schoolId !== ctx.schoolId) await reject('SCHOOL_MISMATCH')
    if (!code.studentId || code.studentId !== ctx.studentId) await reject('STUDENT_MISMATCH')
    if (code.status === 'CLAIMED') await reject('ALREADY_CLAIMED')
    if (code.status === 'REVOKED') await reject('REVOKED')
    if (code.status === 'REPLACED') await reject('REPLACED')
    if (code.status === 'EXPIRED' || code.expiresAt.getTime() <= now.getTime()) await reject('EXPIRED')

    // Conditional claim: exactly one concurrent request wins.
    const claimed = await tx.activationCode.updateMany({
      where: { id: code.id, status: 'ISSUED' },
      data: {
        status: 'CLAIMED',
        claimedAt: now,
        claimedByUserId: ctx.userId,
      },
    })
    if (claimed.count !== 1) {
      await tx.activationCodeEvent.create({
        data: {
          codeId: code.id,
          type: 'CLAIM_REJECTED',
          userId: ctx.userId,
          studentId: ctx.studentId,
          ip: ctx.ip ?? null,
          detail: JSON.stringify({ reason: 'RACE_LOST' }),
        },
      })
      throw new CodeClaimError('RACE_LOST', STUDENT_CLAIM_MESSAGE)
    }

    // Entitlement activation through the SHARED core (renewal semantics:
    // a claim while a live entitlement exists EXTENDS it from its end —
    // the student never loses the current period by claiming early).
    const activated = await activateEntitlementInTx(tx, {
      schoolId: ctx.schoolId,
      studentId: ctx.studentId,
      planId: code.planId,
      planCode: code.planCode,
      source: 'OFFLINE_CODE',
      activationCodeId: code.id,
      validityMonths: code.validityMonths,
      validityStartOverride: code.validityStartOverride,
      validityEndOverride: code.validityEndOverride,
    })

    await tx.activationCode.update({
      where: { id: code.id },
      data: { entitlementId: activated.entitlementId },
    })
    await tx.activationCodeEvent.create({
      data: {
        codeId: code.id,
        type: 'CLAIM_SUCCESS',
        userId: ctx.userId,
        studentId: ctx.studentId,
        ip: ctx.ip ?? null,
        detail: JSON.stringify({ entitlementId: activated.entitlementId, validityEnd: activated.validityEnd.toISOString() }),
      },
    })

    return {
      entitlementId: activated.entitlementId,
      validityStart: activated.validityStart,
      validityEnd: activated.validityEnd,
      status: activated.statusAfter,
      planCode: code.planCode,
      publicRef: code.publicRef,
    }
  }, { timeout: 15_000 })
}

// ── School-wide redemption (Model A) ────────────────────────────────────────

export interface SchoolRedeemContext {
  userId: string
  schoolId: string
  ip?: string | null
}

export interface SchoolRedeemResult {
  subscriptionId: string
  statusAfter: string
  periodEndAfter: Date
  publicRef: string
}

/**
 * Redeem a school-scoped code: the tenant-level activation (one claim =
 * the whole-school entitlement — never per-member grants). The linked
 * VERIFIED payment was recorded at issuance; redemption APPLIES the
 * period, updates the payment snapshots and the subscription row in ONE
 * transaction with the same conditional-update race guard.
 */
export async function redeemSchoolActivationCode(
  codeInput: string,
  ctx: SchoolRedeemContext,
  applyPeriod: (tx: Tx, opts: { schoolId: string; validityMonths: number; codeId: string; paymentRef: string | null; planId: string | null; planCode: string | null; interval: string | null }) => Promise<{ subscriptionId: string; statusAfter: string; periodEndAfter: Date }>,
): Promise<SchoolRedeemResult> {
  const normalized = normalizeCode(String(codeInput ?? ''))
  if (normalized.length < 15) {
    throw new CodeClaimError('NOT_FOUND', 'This activation code is not valid for your school. Check the code with SCHOLARIO support.')
  }
  const hash = hashCode(normalized)
  const now = new Date()

  return db.$transaction(async (tx) => {
    const code = await tx.activationCode.findUnique({ where: { codeHash: hash } })
    if (!code) throw new CodeClaimError('NOT_FOUND', 'This activation code is not valid for your school. Check the code with SCHOLARIO support.')

    const reject = async (reason: ClaimRejection) => {
      await tx.activationCodeEvent.create({
        data: { codeId: code.id, type: 'CLAIM_REJECTED', userId: ctx.userId, ip: ctx.ip ?? null, detail: JSON.stringify({ reason }) },
      })
      throw new CodeClaimError(reason, 'This activation code is not valid for your school. Check the code with SCHOLARIO support.')
    }

    if (code.scope !== 'SCHOOL_SUBSCRIPTION') await reject('SCOPE_MISMATCH')
    if (code.schoolId !== ctx.schoolId) await reject('SCHOOL_MISMATCH')
    if (code.status === 'CLAIMED') await reject('ALREADY_CLAIMED')
    if (code.status === 'REVOKED') await reject('REVOKED')
    if (code.status === 'REPLACED') await reject('REPLACED')
    if (code.status === 'EXPIRED' || code.expiresAt.getTime() <= now.getTime()) await reject('EXPIRED')

    const claimed = await tx.activationCode.updateMany({
      where: { id: code.id, status: 'ISSUED' },
      data: { status: 'CLAIMED', claimedAt: now, claimedByUserId: ctx.userId },
    })
    if (claimed.count !== 1) {
      await tx.activationCodeEvent.create({
        data: { codeId: code.id, type: 'CLAIM_REJECTED', userId: ctx.userId, ip: ctx.ip ?? null, detail: JSON.stringify({ reason: 'RACE_LOST' }) },
      })
      throw new CodeClaimError('RACE_LOST', 'This activation code is not valid for your school.')
    }

    const applied = await applyPeriod(tx, {
      schoolId: ctx.schoolId,
      validityMonths: code.validityMonths,
      codeId: code.id,
      paymentRef: code.paymentRef,
      planId: code.planId,
      planCode: code.planCode,
      interval: code.interval,
    })

    await tx.activationCodeEvent.create({
      data: { codeId: code.id, type: 'CLAIM_SUCCESS', userId: ctx.userId, ip: ctx.ip ?? null, detail: JSON.stringify({ subscriptionId: applied.subscriptionId, periodEndAfter: applied.periodEndAfter.toISOString() }) },
    })
    return { ...applied, publicRef: code.publicRef }
  }, { timeout: 15_000 })
}

// ── Operator actions (revoke / reissue) ─────────────────────────────────────

export async function revokeActivationCode(opts: {
  codeId: string
  adminId: string
  reason: string
}): Promise<{ status: string }> {
  const now = new Date()
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.activationCode.updateMany({
      where: { id: opts.codeId, status: 'ISSUED' },
      data: { status: 'REVOKED', revokedAt: now, revokedById: opts.adminId, revokeReason: opts.reason },
    })
    if (updated.count !== 1) {
      // Already claimed / revoked / replaced — honest state, nothing to do.
      const code = await tx.activationCode.findUnique({ where: { id: opts.codeId } })
      return { status: code?.status ?? 'UNKNOWN' }
    }
    await tx.activationCodeEvent.create({
      data: { codeId: opts.codeId, type: 'REVOKED', detail: JSON.stringify({ reason: opts.reason }) },
    })
    return { status: 'REVOKED' }
  })
  return result
}

/** Reissue: revoke the old code FIRST, then issue the replacement — one
 *  transaction, linked via replacedByCodeId (audit chain). Returns the new
 *  plaintext code (shown once). */
export async function reissueActivationCode(opts: {
  codeId: string
  adminId: string
  reason: string
}): Promise<{ codeId: string; publicRef: string; code: string; expiresAt: Date; revokedStatus: string }> {
  return db.$transaction(async (tx) => {
    const old = await tx.activationCode.findUnique({ where: { id: opts.codeId } })
    if (!old) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Activation code not found' })
    }
    if (old.status === 'CLAIMED') {
      throw new AppError('CONFLICT', {
        publicMessage: 'This code has already been claimed — reissue is not possible. Use entitlement revocation instead if access must be withdrawn.',
        internalDetail: `reissueActivationCode: code ${old.publicRef} already claimed`,
      })
    }

    let revokedStatus = old.status
    if (old.status === 'ISSUED') {
      await tx.activationCode.update({
        where: { id: old.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: opts.adminId, revokeReason: opts.reason },
      })
      revokedStatus = 'REVOKED'
    }
    // codes that were already EXPIRED/REVOKED can still be replaced.

    const issued = await issueActivationCode({
      scope: old.scope as CodeScope,
      schoolId: old.schoolId,
      studentId: old.studentId,
      planId: old.planId,
      planCode: old.planCode,
      interval: old.interval,
      validityMonths: old.validityMonths,
      validityStartOverride: old.validityStartOverride,
      validityEndOverride: old.validityEndOverride,
      claimWindowDays: old.claimWindowDays,
      issuedById: opts.adminId,
      paymentRef: old.paymentRef,
      tx,
    })
    await tx.activationCode.update({
      where: { id: old.id },
      data: { replacedByCodeId: issued.codeId, reissuedById: opts.adminId },
    })
    await tx.activationCodeEvent.create({
      data: { codeId: old.id, type: 'REPLACED', detail: JSON.stringify({ reason: opts.reason, newCodeId: issued.codeId, newPublicRef: issued.publicRef }) },
    })
    return { ...issued, revokedStatus }
  }, { timeout: 15_000 })
}
