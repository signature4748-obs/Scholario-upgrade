import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  getCurrentUser,
  getCurrentSession,
  verifyPassword,
  hashPassword,
  rotateSession,
  setSessionCookie,
  isDevSessionBearerEnabled,
  burnPasswordTiming,
} from '@/lib/auth'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, passwordInputSchema, newPasswordSchema } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/auth/change-password
 *
 * Phase 1 hardening on top of the SS-1 flow:
 *   - strict schema validation (unknown fields rejected, new password
 *     policy: ≥ 8 chars, letter + digit)
 *   - rate limiting (5 attempts/hour per account — brute-force on the
 *     current-password field is throttled)
 *   - anti-enumeration timing equalization
 *   - SESSION ROTATION: the current session token is replaced (a token
 *     stolen before the change dies immediately), every OTHER session is
 *     revoked, and the new token is delivered via the same transports as
 *     login (Set-Cookie always; response body only in the dev preview
 *     bearer mode).
 *   - audit row (PASSWORD_CHANGED + SESSION_ROTATED)
 */
const changePasswordBodySchema = strictBody({
  currentPassword: passwordInputSchema,
  newPassword: newPasswordSchema,
  confirmPassword: passwordInputSchema,
})

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    // Task 4-d (fix #9) — mirror withUser semantics (ACTIVE accounts only).
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

    // Per-account throttle — wrong current-password attempts are limited.
    enforceRateLimit(`rl:pwchange:${user.id}`, RATE_LIMITS.passwordChange)

    const body = await parseJsonBody(req, changePasswordBodySchema)

    if (body.newPassword !== body.confirmPassword) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'New passwords do not match' })
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } })
    if (!dbUser) throw new Error('NOT_FOUND')

    const currentOk = dbUser.passwordHash
      ? verifyPassword(body.currentPassword, dbUser.passwordHash)
      : (burnPasswordTiming(), false)

    if (!currentOk) {
      await auditEvent({
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'PASSWORD_CHANGE_FAILED',
        requestId,
        detail: 'Change-password attempt failed (current password incorrect)',
      }).catch(() => {})
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Current password is incorrect',
        internalDetail: 'change-password: current password mismatch',
      })
    }

    if (body.currentPassword === body.newPassword) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'The new password must be different from the current one',
      })
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(body.newPassword) },
    })

    // Revoke every OTHER session (standard practice).
    const current = await getCurrentSession()
    const revoked = current
      ? await db.session.deleteMany({
          where: { userId: user.id, token: { not: current.token } },
        })
      : await db.session.deleteMany({ where: { userId: user.id } })

    // SESSION ROTATION — mint a fresh token for THIS device so the old
    // (possibly stolen) token stops working immediately.
    let rotatedToken: string | null = null
    if (current) {
      rotatedToken = await rotateSession(current.token)
      await setSessionCookie(rotatedToken)
    }

    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      requestId,
      detail: `Password changed; ${revoked.count} other session(s) revoked; current session rotated`,
    }).catch(() => {})
    if (rotatedToken) {
      await auditEvent({
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'SESSION_ROTATED',
        requestId,
        detail: 'Session token rotated after password change',
      }).catch(() => {})
    }

    return {
      ok: true,
      otherSessionsSignedOut: revoked.count,
      // DEV PREVIEW ONLY — same gating as login (never in production).
      ...(rotatedToken && isDevSessionBearerEnabled() ? { sessionToken: rotatedToken } : {}),
    }
  })
}
