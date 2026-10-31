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
import type { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { sendEmail } from '@/lib/email'
import {
  loginAccountKey,
  platformLoginAccountKey,
  resetRateLimit,
} from '@/lib/security/rate-limit'
import { hashToken } from './auth'

/** Hard expiry window for a reset token. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

export interface IssuedResetToken {
  /** Row id (audit / dedupe key material). */
  id: string
  /** The RAW token — exists only in the caller's memory → the email body. */
  token: string
  expiresAt: Date
  /** The candidate email bound to this token (audited recovery only). */
  newEmail: string | null
}

/**
 * ROOT-ADMIN LOGIN REPAIR — clear the per-account login lockout for an
 * email on EVERY rate-limit namespace that can lock it (the platform
 * plane's `rl:pf-login:acct:` and the legacy shared `rl:login:acct:`,
 * belt and braces for rows minted before the namespace split).
 *
 * Called ONLY from verified-recovery completion (a CONSUMED single-use
 * token — proof of mailbox ownership — never from a mere request) per
 * the account-recovery contract: a locked-out administrator recovers
 * through the emailed link, not by asking. The per-IP login bucket is
 * deliberately NOT touched: it guards password guessing from one source
 * across MANY accounts and self-expires on its own window.
 */
export function clearAccountLockout(normalizedEmail: string): void {
  resetRateLimit(platformLoginAccountKey(normalizedEmail))
  resetRateLimit(loginAccountKey(normalizedEmail))
}

/** PII-minimal email form for audit metadata: local part length + domain. */
export function maskedEmailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return 'unknown-domain'
  return email.slice(at + 1).toLowerCase()
}

/**
 * Mint a fresh reset token for an admin and supersede every previous
 * pending token for that admin (single outstanding token invariant).
 *
 * `newEmail` (ROOT-ADMIN LOGIN REPAIR): binds a candidate account email
 * to the token — ONLY the audited recovery procedure (ops script) sets
 * it; ordinary self-service resets pass nothing. The candidate must
 * not belong to any other PlatformAdmin (uniqueness guard, fails
 * closed) and is adopted at consume time by the reset route — the
 * ownership proof being the emailed single-use token itself.
 */
export async function issuePasswordReset(
  adminId: string,
  context?: { requestIp?: string | null; userAgent?: string | null; newEmail?: string },
): Promise<IssuedResetToken> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  const newEmail = context?.newEmail?.trim().toLowerCase() || null
  if (newEmail) {
    const clash = await db.platformAdmin.findUnique({ where: { email: newEmail } })
    if (clash) {
      throw new Error(
        `candidate email already belongs to a platform admin (domain=${maskedEmailDomain(newEmail)})`,
      )
    }
  }

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
      newEmail,
      requestIp: context?.requestIp?.slice(0, 60) ?? null,
      userAgent: context?.userAgent?.slice(0, 400) ?? null,
    },
  })
  return { id: row.id, token, expiresAt, newEmail }
}

export type ConsumeFailure = 'NOT_FOUND' | 'USED' | 'EXPIRED'

export interface ConsumeResult {
  ok: boolean
  failure?: ConsumeFailure
  adminId?: string
  /** Consumed reset row id (notification dedupe key material). */
  resetId?: string
  /** The candidate email bound at issuance (audited recovery only). */
  newEmail?: string | null
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
    return {
      ok: true,
      adminId: row?.adminId,
      resetId: row?.id,
      newEmail: row?.newEmail ?? null,
    }
  }
  // Classify for the audit trail only.
  const row = await db.platformPasswordReset.findUnique({ where: { tokenHash } })
  if (!row) return { ok: false, failure: 'NOT_FOUND' }
  if (row.usedAt) return { ok: false, failure: 'USED' }
  return { ok: false, failure: 'EXPIRED' }
}

/**
 * Invalidate every pending token for an admin (post password-change).
 *
 * Runs on the GLOBAL client by default. Callers that already hold an
 * interactive transaction (`tx`) pass it so the burn participates in
 * THEIR atomic unit — the platform reset route requires this: the
 * password update, the session revocation and the token burn must
 * commit together or roll back together.
 */
export async function invalidateAdminResetTokens(
  adminId: string,
  tx: Prisma.TransactionClient = db,
): Promise<void> {
  await tx.platformPasswordReset.updateMany({
    where: { adminId, usedAt: null },
    data: { usedAt: new Date() },
  })
}

/**
 * Issue a reset token AND send the reset email (the shared pipeline
 * for every issuance site: self-service forgot-password, admin-
 * assisted reset, dual-control recovery execution). The send outcome
 * is a VALUE (never throws — sendEmail contract); callers decide how
 * to surface a failed delivery. emailStatus 'queued' means the
 * provider ACCEPTED the message (delivery unconfirmed — see
 * docs/EMAIL.md honest status semantics); only 'failed' means the
 * recipient will definitely NOT get the email.
 *
 * ROOT-ADMIN LOGIN REPAIR — `candidateEmail` (audited recovery only):
 * the recovery email is delivered TO the candidate mailbox (the
 * ownership proof IS the delivery + single-use click-through) using
 * the dedicated `platform-recovery-link` template, which explains
 * that consuming the link sets a new password AND designates the
 * candidate address as the account identity. The template stays
 * PII-neutral beyond the recipient's own address (no old address is
 * embedded — the recovery mail must be forwardable-safe).
 */
export async function issueAndEmailPasswordReset(
  admin: { id: string; email: string; name: string },
  opts: {
    origin: string
    requestIp?: string | null
    userAgent?: string | null
    requestId?: string | null
    candidateEmail?: string
  },
): Promise<{ issued: IssuedResetToken; emailStatus: 'sent' | 'queued' | 'skipped' | 'failed' }> {
  const issued = await issuePasswordReset(admin.id, {
    requestIp: opts.requestIp,
    userAgent: opts.userAgent,
    newEmail: opts.candidateEmail,
  })
  const resetUrl = `${opts.origin.replace(/\/+$/, '')}/platform/reset-password?token=${issued.token}`
  const isRecovery = Boolean(opts.candidateEmail)
  const result = await sendEmail({
    to: isRecovery ? opts.candidateEmail! : admin.email,
    template: isRecovery ? 'platform-recovery-link' : 'platform-password-reset',
    props: isRecovery
      ? {
          adminName: admin.name,
          resetUrl,
          expiresInMinutes: Math.floor(RESET_TOKEN_TTL_MS / 60_000),
        }
      : {
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
