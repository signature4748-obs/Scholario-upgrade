/**
 * ACCOUNT-RECOVERY — PlatformAdmin forgot-password tokens.
 *
 * SECURITY CONTRACT (docs/PLATFORM_ACCOUNT_RECOVERY.md):
 *   · Token = 32 crypto-random bytes, hex — 256 bits of entropy.
 *   · At rest ONLY sha256(token) (the platform session convention:
 *     a DB leak yields nothing replayable). The raw token appears
 *     EXACTLY once, inside the emailed reset link.
 *   · Single-use: consuming marks usedAt AND invalidates every other
 *     outstanding token for the admin.
 *   · Short-lived: 30-minute hard expiry.
 *   · Single outstanding token per admin: a new request supersedes
 *     (marks used) all previous pending tokens for that admin.
 *   · NEVER logged: audit metadata carries counts only; the token is
 *     never interpolated into a log line, audit row or error detail.
 *   · Anti-enumeration: the forgot-password ROUTE answers identically
 *     whether or not the email maps to an admin; this module is only
 *     reached after that decision, and its failures surface as one
 *     generic error to the caller.
 */

import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { sendEmail } from '@/lib/email'
import { hashToken } from './auth'

/** Hard expiry window for a reset token. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

export interface IssuedResetToken {
  /** Row id (audit / dedupe key material). */
  id: string
  /** The RAW token — exists only in the caller's memory → the email body. */
  token: string
  expiresAt: Date
}

/**
 * Mint a fresh reset token for an admin and supersede every previous
 * pending token for that admin (single outstanding token invariant).
 */
export async function issuePasswordReset(
  adminId: string,
  context?: { requestIp?: string | null; userAgent?: string | null },
): Promise<IssuedResetToken> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  // Supersede: previous pending tokens become used (they must never
  // consume later — the newest request is the only live path).
  await db.platformPasswordReset.updateMany({
    where: { adminId, usedAt: null },
    data: { usedAt: new Date() },
  })

  const row = await db.platformPasswordReset.create({
    data: {
      adminId,
      tokenHash: hashToken(token),
      expiresAt,
      requestIp: context?.requestIp?.slice(0, 60) ?? null,
      userAgent: context?.userAgent?.slice(0, 400) ?? null,
    },
  })
  return { id: row.id, token, expiresAt }
}

export type ConsumeFailure = 'NOT_FOUND' | 'USED' | 'EXPIRED'

export interface ConsumeResult {
  ok: boolean
  failure?: ConsumeFailure
  adminId?: string
}

/**
 * ATOMIC single-use claim: the ONLY transition that turns a pending
 * token into a consumed one — `updateMany` with `usedAt: null` in the
 * WHERE clause, so two concurrent replays can never both succeed (the
 * second sees 0 rows). Expiry is enforced inside the same WHERE.
 *
 * On a failed claim the row (if any) is read to classify the failure
 * for the INTERNAL audit trail — the ROUTE surfaces one generic
 * message for every mode (no oracle). A claimed token stays consumed
 * even if the caller's subsequent steps fail (fail-closed: a token is
 * spent the moment it is presented successfully).
 */
export async function consumePasswordReset(rawToken: string): Promise<ConsumeResult> {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return { ok: false, failure: 'NOT_FOUND' }
  const tokenHash = hashToken(rawToken)
  const claimed = await db.platformPasswordReset.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 1) {
    const row = await db.platformPasswordReset.findUnique({ where: { tokenHash } })
    return { ok: true, adminId: row?.adminId }
  }
  // Classify for the audit trail only.
  const row = await db.platformPasswordReset.findUnique({ where: { tokenHash } })
  if (!row) return { ok: false, failure: 'NOT_FOUND' }
  if (row.usedAt) return { ok: false, failure: 'USED' }
  return { ok: false, failure: 'EXPIRED' }
}

/** Invalidate every pending token for an admin (post password-change). */
export async function invalidateAdminResetTokens(adminId: string): Promise<void> {
  await db.platformPasswordReset.updateMany({
    where: { adminId, usedAt: null },
    data: { usedAt: new Date() },
  })
}

/**
 * Issue a reset token AND send the reset email (the shared pipeline
 * for every issuance site: self-service forgot-password, admin-
 * assisted reset, dual-control recovery execution). The send outcome
 * is a VALUE (never throws — sendEmail contract); callers decide how
 * to surface a failed delivery.
 */
export async function issueAndEmailPasswordReset(
  admin: { id: string; email: string; name: string },
  opts: {
    origin: string
    requestIp?: string | null
    userAgent?: string | null
    requestId?: string | null
  },
): Promise<{ issued: IssuedResetToken; emailStatus: 'sent' | 'skipped' | 'failed' }> {
  const issued = await issuePasswordReset(admin.id, {
    requestIp: opts.requestIp,
    userAgent: opts.userAgent,
  })
  const resetUrl = `${opts.origin.replace(/\/+$/, '')}/platform/reset-password?token=${issued.token}`
  const result = await sendEmail({
    to: admin.email,
    template: 'platform-password-reset',
    props: {
      adminName: admin.name,
      resetUrl,
      expiresInMinutes: Math.floor(RESET_TOKEN_TTL_MS / 60_000),
      requestIp: opts.requestIp ?? undefined,
    },
    dedupeKey: `platform-password-reset:${issued.id}`,
    requestId: opts.requestId ?? undefined,
  })
  return { issued, emailStatus: result.status }
}
