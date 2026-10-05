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
} from '@/lib/platform/password-reset'

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
 * Failure modes (unknown token / already used / expired / suspended
 * admin / token format) all surface as ONE generic 401 — no oracle
 * about which condition fired.
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

    // ── Apply: new hash + global session revocation (the security
    // effect of a reset) + burn of every OTHER outstanding token.
    // (The presented token itself was already consumed ATOMICALLY by
    // consumePasswordReset — a replay races updateMany and loses.)
    await db.platformAdmin.update({
      where: { id: admin.id },
      data: { passwordHash: hashPassword(body.newPassword) },
    })
    const revoked = await revokeAllPlatformSessions(admin.id)
    await invalidateAdminResetTokens(admin.id)

    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.password_reset.completed',
      targetType: 'AUTH',
      targetId: admin.id,
      ip,
      requestId,
      metadata: { revokedSessions: revoked },
    }).catch(() => {})

    return { message: 'Password updated. All active sessions were signed out — sign in with your new password.' }
  })
}
