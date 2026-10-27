/**
 * SCHOOL-PLANE ACCOUNT RECOVERY — school user (Student & Staff)
 * forgot-password tokens.
 *
 * Mirrors the platform plane's contract EXACTLY
 * (src/lib/platform/password-reset.ts, docs/PLATFORM_ACCOUNT_RECOVERY.md §1
 * → docs/SCHOOL_ACCOUNT_RECOVERY.md):
 *
 *   · Token = 32 crypto-random bytes, hex — 256 bits of entropy.
 *   · At rest ONLY sha256(token) (the session convention: a DB leak
 *     yields nothing replayable). The raw token appears EXACTLY once,
 *     inside the emailed reset link.
 *   · Single-use: consuming marks usedAt AND invalidates every other
 *     outstanding token for the user.
 *   · Short-lived: 30-minute hard expiry.
 *   · Single outstanding token per user: a new request supersedes
 *     (marks used) all previous pending tokens for that user.
 *   · NEVER logged: audit metadata carries counts only; the token is
 *     never interpolated into a log line, audit row or error detail.
 *   · Anti-enumeration: the forgot-password ROUTE answers identically
 *     whether or not the email maps to a school user; this module is
 *     only reached after that decision, and its failures surface as
 *     one generic error to the caller.
 *
 * PLANE RULE: school-plane authentication is the custom scrypt path —
 * this module is the ONLY recovery vehicle for a school account's
 * password and it writes the SAME hash the login route verifies
 * (lib/auth hashPassword). It deliberately does NOT touch Supabase
 * Auth (docs/AUTH_ARCHITECTURE.md §7 — Supabase is an optional,
 * flag-gated identity provider for the school plane, never the
 * credential store; the natural password-change cutover in
 * /api/auth/change-password is the only provisioning site).
 */

import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { sendEmail } from '@/lib/email'
import { loginAccountKey, resetRateLimit } from '@/lib/security/rate-limit'
import { createHash } from 'crypto'

/** Hard expiry window for a reset token. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

export interface IssuedResetToken {
  /** Row id (audit / dedupe key material). */
  id: string
  /** The RAW token — exists only in the caller's memory → the email body. */
  token: string
  expiresAt: Date
}

/** sha256(token) hex — the only at-rest form (same as the platform plane). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** PII-minimal email form for audit metadata: local part length + domain. */
export function maskedEmailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return 'unknown-domain'
  return email.slice(at + 1).toLowerCase()
}

/**
 * SCHOOL-LOGIN REPAIR — clear the per-account login lockout for an email
 * on the school-plane rate-limit namespace (`rl:login:acct:`).
 *
 * Called ONLY from verified-recovery completion (a CONSUMED single-use
 * token — proof of mailbox ownership — never from a mere request), per
 * the platform plane's lockout-supersession contract: a locked-out user
 * recovers through the emailed link, not by asking. The per-IP login
 * bucket is deliberately NOT touched: it guards password guessing from
 * one source across MANY accounts and self-expires on its own window.
 */
export function clearSchoolAccountLockout(normalizedEmail: string): void {
  resetRateLimit(loginAccountKey(normalizedEmail))
}

/**
 * Mint a fresh reset token for a school user and supersede every previous
 * pending token for that user (single outstanding token invariant).
 */
export async function issuePasswordReset(
  userId: string,
  context?: { requestIp?: string | null; userAgent?: string | null },
): Promise<IssuedResetToken> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  // Supersede: previous pending tokens become used (they must never
  // consume later — the newest request is the only live path).
  await db.schoolPasswordReset.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  const row = await db.schoolPasswordReset.create({
    data: {
      userId,
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
  userId?: string
  /** Consumed reset row id (notification dedupe key material). */
  resetId?: string
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
  const claimed = await db.schoolPasswordReset.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 1) {
    const row = await db.schoolPasswordReset.findUnique({ where: { tokenHash } })
    return {
      ok: true,
      userId: row?.userId,
      resetId: row?.id,
    }
  }
  // Classify for the audit trail only.
  const row = await db.schoolPasswordReset.findUnique({ where: { tokenHash } })
  if (!row) return { ok: false, failure: 'NOT_FOUND' }
  if (row.usedAt) return { ok: false, failure: 'USED' }
  return { ok: false, failure: 'EXPIRED' }
}

/** Invalidate every pending token for a user (post password-change). */
export async function invalidateUserResetTokens(userId: string): Promise<void> {
  await db.schoolPasswordReset.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })
}

/**
 * Issue a reset token AND send the reset email (the shared pipeline for
 * every issuance site). The send outcome is a VALUE (never throws —
 * sendEmail contract); callers decide how to surface a failed delivery.
 * emailStatus 'queued' means the provider ACCEPTED the message
 * (delivery unconfirmed — docs/EMAIL.md honest status semantics); only
 * 'failed' means the recipient will definitely NOT get the email. The
 * tenant branding resolves from the user's school row (schoolId).
 */
export async function issueAndEmailPasswordReset(
  user: { id: string; email: string; name: string; schoolId: string | null },
  opts: {
    origin: string
    requestIp?: string | null
    userAgent?: string | null
    requestId?: string | null
  },
): Promise<{ issued: IssuedResetToken; emailStatus: 'sent' | 'queued' | 'skipped' | 'failed' }> {
  const issued = await issuePasswordReset(user.id, {
    requestIp: opts.requestIp,
    userAgent: opts.userAgent,
  })
  // The reset link carries the user's OWN school door (`from`) so the
  // post-reset "sign in" step lands on the correct Student & Staff
  // login — on any device. The value comes from OUR database (the
  // school slug), never from client input, and the reset page re-
  // validates it against a strict allow-regex before use.
  let fromParam = ''
  if (user.schoolId) {
    const school = await db.school.findUnique({
      where: { id: user.schoolId },
      select: { slug: true },
    })
    if (school?.slug && /^[a-zA-Z0-9-]+$/.test(school.slug)) {
      fromParam = `&from=${encodeURIComponent(`/s/${school.slug}/login`)}`
    }
  }
  const resetUrl = `${opts.origin.replace(/\/+$/, '')}/reset-password?token=${issued.token}${fromParam}`
  const result = await sendEmail({
    to: user.email,
    template: 'school-password-reset',
    props: {
      userName: user.name || 'there',
      resetUrl,
      expiresInMinutes: Math.floor(RESET_TOKEN_TTL_MS / 60_000),
      requestIp: opts.requestIp ?? undefined,
    },
    schoolId: user.schoolId ?? undefined,
    dedupeKey: `school-password-reset:${issued.id}`,
    requestId: opts.requestId ?? undefined,
  })
  return { issued, emailStatus: result.status }
}
