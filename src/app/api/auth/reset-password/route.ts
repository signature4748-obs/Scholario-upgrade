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
import { auditEvent } from '@/lib/security/audit'
import { isCanonicalSchoolRole } from '@/lib/security/permissions'
import {
  consumePasswordReset,
  invalidateUserResetTokens,
  clearSchoolAccountLockout,
  maskedEmailDomain,
} from '@/lib/school/password-reset'
import { sendEmail } from '@/lib/email'
import { isSupabaseAuthEnabled, provisionProviderPassword } from '@/lib/auth/supabase'
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
 * POST /api/auth/reset-password — PUBLIC (the user has no session by
 * definition of the flow). SCHOOL PLANE.
 *
 * Consumes a reset token through an ATOMIC single-use claim
 * (sha256 lookup + usedAt-guarded transition): sets the new scrypt
 * password hash (the SAME hash the school login verifies — the custom
 * authentication path is the only credential store; see
 * docs/AUTH_ARCHITECTURE.md §7 — Supabase Auth is an optional identity
 * provider, never the credential source of truth), clears the
 * forced-first-change bootstrap state (a completed recovery IS the
 * user establishing their own password), revokes EVERY live session
 * for the user (stolen pre-reset sessions die immediately), burns
 * every other outstanding token, clears the per-account login lockout
 * (verified-recovery supersession — the emailed single-use token is a
 * STRONGER identity proof than waiting out the failure counter; the
 * per-IP bucket is deliberately untouched), and audits the completion.
 *
 * Failure modes (unknown token / already used / expired / ineligible
 * account / token format) all surface as ONE generic 401 — no oracle
 * about which condition fired.
 *
 * SUPABASE AUTH PHASE 1 — staged-migration cutover parity with
 * /api/auth/change-password: when the provider flag is ON, the new
 * password is additionally provisioned to the identity provider
 * (guarded, conflict-safe; a provider failure is AUDITED, never
 * surfaced — the local change is already authoritative and the
 * account simply stays unlinked until the next change or the
 * exchange-link flow).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const body = await parseJsonBody(req, resetBodySchema)
    const ip = clientIpFromHeaders(req.headers)

    // Per-IP brake (this endpoint is anonymous and public).
    const ipVerdict = await checkRateLimitStrict(`rl:school-reset:ip:${ip}`, RATE_LIMITS.schoolResetPassword)
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: 'school reset-password ip bucket exhausted',
      })
    }

    const consumed = await consumePasswordReset(body.token)
    if (!consumed.ok || !consumed.userId) {
      await auditEvent({
        action: 'PASSWORD_RESET_FAILED',
        ip,
        requestId,
        detail: `School password reset rejected (${consumed.failure ?? 'unknown'})`,
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: `school reset-password: token rejected (${consumed.failure ?? 'unknown'})`,
      })
    }

    const user = await db.user.findUnique({ where: { id: consumed.userId } })
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !isCanonicalSchoolRole(user.role) ||
      !user.schoolId
    ) {
      // Ineligible between request and consume — generic refusal.
      await auditEvent({
        schoolId: user?.schoolId ?? null,
        userId: consumed.userId,
        action: 'PASSWORD_RESET_FAILED',
        ip,
        requestId,
        detail: 'School password reset refused — account missing or not eligible at consume time',
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: 'school reset-password: account not eligible at consume time',
      })
    }

    // ── Apply: new scrypt hash + bootstrap-state retirement + global
    // session revocation + burn of every OTHER outstanding token. The
    // presented token itself was already consumed ATOMICALLY by
    // consumePasswordReset — a replay races updateMany and loses.
    try {
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(body.newPassword),
            // CREDENTIAL-RESET — a completed recovery IS the account
            // establishing its own password: the forced first-change
            // flag clears and the bootstrap credential state retires.
            mustChangePassword: false,
            passwordChangedAt: new Date(),
          },
        })
      })
    } catch (txError) {
      await auditEvent({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'PASSWORD_RESET_FAILED',
        ip,
        requestId,
        detail: 'School password reset apply transaction failed',
      }).catch(() => {})
      log('warn', 'school_password_reset_apply_failed', {
        channel: 'auth',
        detail: 'school reset-password: apply transaction failed',
        requestId,
      })
      // Generic refusal — the token is already consumed (fail-closed).
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: GENERIC_RESET_FAILURE,
        internalDetail: 'school reset-password: apply transaction refused',
      })
    }

    const revoked = await db.session.deleteMany({ where: { userId: user.id } })
    await invalidateUserResetTokens(user.id)

    // ── Verified-recovery lockout supersession (docs/
    // PLATFORM_ACCOUNT_RECOVERY.md §3-A, mirrored): the applicable
    // per-account lockout state is cleared for the account email.
    clearSchoolAccountLockout(user.email)

    // ── Notify the account address that the password changed (never
    // the password itself; honest status — a notification failure does
    // NOT fail the reset, it is recorded in the EmailDelivery audit).
    // dedupeKey binds to the consumed reset row: one notification per
    // reset event, idempotent across pipeline retries.
    const notify = await sendEmail({
      to: user.email,
      template: 'school-password-changed',
      props: { userName: user.name || 'there' },
      schoolId: user.schoolId ?? undefined,
      dedupeKey: `school-password-changed:${consumed.resetId ?? user.id}`,
      requestId,
    })

    await auditEvent({
      schoolId: user.schoolId,
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      ip,
      requestId,
      detail: `School password reset completed (reset ${consumed.resetId ?? 'n/a'}); ${revoked.count} session(s) revoked; notification ${notify.status}; domain ${maskedEmailDomain(user.email)}`,
    }).catch(() => {})

    // ── SUPABASE AUTH PHASE 1 — staged-migration cutover parity (see
    // above). Guarded, conflict-safe, never surfaced as an app error.
    if (isSupabaseAuthEnabled()) {
      try {
        const outcome = await provisionProviderPassword({
          email: user.email,
          newPassword: body.newPassword,
          existingAuthUserId: user.authUserId,
        })
        await auditEvent({
          schoolId: user.schoolId,
          userId: user.id,
          action: 'PASSWORD_RESET_COMPLETED',
          requestId,
          detail: `provider cutover: ${outcome.state}`,
        }).catch(() => {})
      } catch {
        await auditEvent({
          schoolId: user.schoolId,
          userId: user.id,
          action: 'PASSWORD_RESET_COMPLETED',
          requestId,
          detail: 'provider cutover failed (audited; local change authoritative)',
        }).catch(() => {})
      }
    }

    return {
      message:
        'Password updated. All active sessions were signed out — sign in with your new password.',
    }
  })
}
