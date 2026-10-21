import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { hashPassword } from '@/lib/auth'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, passwordInputSchema, newPasswordSchema } from '@/lib/security/validation'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokeAllPlatformSessions } from '@/lib/platform/auth'
import {
  consumePasswordReset,
  invalidateAdminResetTokens,
  clearAccountLockout,
  maskedEmailDomain,
} from '@/lib/platform/password-reset'
import { sendEmail } from '@/lib/email'
import { log } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const resetBodySchema = strictBody({
  token: passwordInputSchema,
  newPassword: newPasswordSchema,
})

/** One generic failure message for EVERY invalid/used/expired token. */
const GENERIC_RESET_FAILURE =
  'This password reset link is invalid or has expired. Request a new reset link and try again.'

/**
 * POST /api/platform/auth/reset-password — PUBLIC (the user has no
 * session by definition of the flow).
 *
 * Consumes a reset token through an ATOMIC single-use claim
 * (sha256 lookup + usedAt-guarded transition): sets the new scrypt
 * password hash, revokes EVERY live platform session for the admin
 * (stolen pre-reset sessions die immediately), burns every other
 * outstanding token, and audits the completion.
 *
 * ROOT-ADMIN LOGIN REPAIR — two verified-recovery guarantees:
 *   · LOCKOUT SUPERSESSION: a successful (verified) reset clears the
 *     per-account login lockout for the admin's email on every
 *     rate-limit namespace that can lock it. The emailed single-use
 *     token is a STRONGER identity proof than waiting out the failed-
 *     attempt counter, so the applicable lockout state is superseded
 *     at completion (docs/PLATFORM_ACCOUNT_RECOVERY.md). The per-IP
 *     bucket is deliberately untouched (it guards cross-account
 *     guessing from one source and self-expires).
 *   · EMAIL ADOPTION (audited recovery only): when the token was
 *     minted by the audited recovery procedure with a candidate email
 *     bound, consuming it ALSO designates that email as the account
 *     identity — atomically, in the same transaction as the password
 *     update, with a fresh uniqueness re-check (another admin may have
 *     claimed the address since issuance; on conflict the reset FAILS
 *     CLOSED: password unchanged, generic error, audited). The
 *     ownership proof is the token itself: the recovery link was only
 *     ever delivered to the candidate mailbox, and only its holder
 *     can present it.
 *
 * Failure modes (unknown token / already used / expired / suspended
 * admin / token format / email conflict) all surface as ONE generic
 * 401 — no oracle about which condition fired.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const body = await parseJsonBody(req, resetBodySchema)
    const ip = clientIpFromHeaders(req.headers)

    // Per-IP brake (this endpoint is anonymous and public).
    const ipVerdict = await checkRateLimitStrict(`rl:pf-reset:ip:${ip}`, RATE_LIMITS.platformResetPassword)
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: 'platform reset-password ip bucket exhausted',
      })
    }

    const consumed = await consumePasswordReset(body.token)
    if (!consumed.ok || !consumed.adminId) {
      await platformAuditEvent({
        action: 'platform.password_reset.failed',
        targetType: 'AUTH',
        ip,
        requestId,
        reason: `reset token rejected (${consumed.failure ?? 'unknown'})`,
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: `platform reset-password: token rejected (${consumed.failure ?? 'unknown'})`,
      })
    }

    const admin = await db.platformAdmin.findUnique({ where: { id: consumed.adminId } })
    if (!admin || admin.status !== 'ACTIVE') {
      // Suspended between request and consume — generic refusal.
      await platformAuditEvent({
        adminId: consumed.adminId,
        action: 'platform.password_reset.failed',
        targetType: 'AUTH',
        targetId: consumed.adminId,
        ip,
        requestId,
        reason: 'account missing or not ACTIVE at consume time',
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: 'platform reset-password: account not ACTIVE at consume time',
      })
    }

    // ── Apply: new hash (+ email adoption when a verified candidate is
    // bound) + global session revocation (the security effect of a
    // reset) + burn of every OTHER outstanding token. The presented
    // token itself was already consumed ATOMICALLY by
    // consumePasswordReset — a replay races updateMany and loses.
    const candidateEmail = consumed.newEmail?.trim().toLowerCase() || null
    const finalEmail = candidateEmail ?? admin.email

    try {
      await db.$transaction(async (tx) => {
        if (candidateEmail && candidateEmail !== admin.email) {
          // Fresh uniqueness re-check INSIDE the transaction (another
          // admin may have claimed the address since issuance). Fails
          // closed: nothing is written on conflict.
          const clash = await tx.platformAdmin.findUnique({ where: { email: candidateEmail } })
          if (clash && clash.id !== admin.id) {
            throw new Error('recovery candidate email claimed by another admin')
          }
          await tx.platformAdmin.update({
            where: { id: admin.id },
            data: { email: candidateEmail, passwordHash: hashPassword(body.newPassword) },
          })
        } else {
          await tx.platformAdmin.update({
            where: { id: admin.id },
            data: { passwordHash: hashPassword(body.newPassword) },
          })
        }
      })
    } catch (txError) {
      await platformAuditEvent({
        adminId: admin.id,
        action: 'platform.password_reset.failed',
        targetType: 'AUTH',
        targetId: admin.id,
        ip,
        requestId,
        reason: candidateEmail
          ? 'recovery email adoption refused (candidate address claimed by another admin)'
          : 'password update transaction failed',
        metadata: candidateEmail
          ? { candidateEmailDomain: maskedEmailDomain(candidateEmail) }
          : undefined,
      }).catch(() => {})
      log('warn', 'platform_password_reset_apply_failed', {
        channel: 'auth',
        detail: candidateEmail
          ? 'recovery email adoption refused — candidate address claimed by another admin'
          : 'password update transaction failed',
        requestId,
      })
      // Generic refusal — the token is already consumed (fail-closed).
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: 'platform reset-password: apply transaction refused',
      })
    }

    const emailUpdated = Boolean(candidateEmail && candidateEmail !== admin.email)
    const revoked = await revokeAllPlatformSessions(admin.id)
    await invalidateAdminResetTokens(admin.id)

    // ── Verified-recovery lockout supersession: the applicable per-
    // account lockout state is cleared for BOTH the previous and the
    // (possibly adopted) email on every namespace that can lock it.
    clearAccountLockout(admin.email)
    if (emailUpdated) clearAccountLockout(finalEmail)

    // ── Notify the registered address that the password changed (never
    // the password itself; honest status — a notification failure does
    // NOT fail the reset, it is recorded in the EmailDelivery audit).
    // dedupeKey binds to the consumed reset row: one notification per
    // reset event, idempotent across pipeline retries.
    const notify = await sendEmail({
      to: finalEmail,
      template: 'platform-password-changed',
      props: { adminName: admin.name },
      dedupeKey: `platform-password-changed:${consumed.resetId ?? admin.id}`,
      requestId,
    })

    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.password_reset.completed',
      targetType: 'AUTH',
      targetId: admin.id,
      ip,
      requestId,
      metadata: {
        revokedSessions: revoked,
        emailUpdated,
        // PII-minimal: domains only, never full addresses.
        ...(emailUpdated
          ? {
              previousEmailDomain: maskedEmailDomain(admin.email),
              newEmailDomain: maskedEmailDomain(finalEmail),
            }
          : {}),
        notificationStatus: notify.status,
      },
    }).catch(() => {})

    if (emailUpdated) {
      await platformAuditEvent({
        adminId: admin.id,
        action: 'platform.account_email.changed',
        targetType: 'ADMIN',
        targetId: admin.id,
        ip,
        requestId,
        reason: 'verified recovery link consumed (audited procedure; ownership proven by emailed single-use token)',
        metadata: {
          previousEmailDomain: maskedEmailDomain(admin.email),
          newEmailDomain: maskedEmailDomain(finalEmail),
        },
      }).catch(() => {})
    }

    return {
      message: emailUpdated
        ? 'Password updated and the account email was verified and set. All active sessions were signed out — sign in with your new password.'
        : 'Password updated. All active sessions were signed out — sign in with your new password.',
    }
  })
}
