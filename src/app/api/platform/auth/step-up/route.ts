import { NextRequest } from 'next/server'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { parseJsonBody, strictBody, passwordInputSchema } from '@/lib/security/validation'
import { RATE_LIMITS, enforceRateLimitStrict } from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { getPlatformSession, markStepUp, STEP_UP_WINDOW_MS } from '@/lib/platform/auth'
import { verifyTotp } from '@/lib/platform/totp'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'

export const runtime = 'nodejs'

const stepUpSchema = strictBody({ code: passwordInputSchema })

/**
 * POST /api/platform/auth/step-up — re-verify TOTP to (re)open the
 * destructive-action window (10 minutes).
 *
 * Every destructive control-plane action (suspend/delete school, plan
 * changes, permission changes, support sessions) rejects with
 * STEP_UP_REQUIRED when the window is stale; the console shows the
 * step-up dialog and retries.
 *
 * PRODUCT-DIRECTION RESET (Part 1) — while platform TOTP is stood down
 * (lib/platform/mfa-config.ts) there is no second factor, so this route
 * answers honestly instead of pretending: MFA is off. The verification
 * path below is the intact re-enable path.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const auth = await getPlatformSession()
    if (!auth) {
      throw new AppError('AUTH_REQUIRED', { internalDetail: 'step-up: no platform session' })
    }

    if (!isPlatformTotpEnabled()) {
      throw new AppError('MFA_NOT_ENABLED', {
        publicMessage: 'Platform multi-factor authentication is currently disabled.',
        internalDetail: 'step-up: refused — platform TOTP policy is off (mfa-config)',
      })
    }

    // Brake-force on code guessing (per admin + per session).
    // PHASE 8B (§21) — strict shared-budget gate (MFA step-up guessing brake).
    await enforceRateLimitStrict(`rl:pf-stepup:${auth.admin.id}`, RATE_LIMITS.platformStepUp)

    const body = await parseJsonBody(req, stepUpSchema)
    const code = /^\d{6}$/.test(body.code) ? body.code : body.code.replace(/\D/g, '')

    if (!/^\d{6}$/.test(code) || !verifyTotp(code, auth.admin.totpSecret)) {
      await platformAuditEvent({
        adminId: auth.admin.id,
        action: 'platform.step_up.failed',
        targetType: 'AUTH',
        targetId: auth.session.id,
        requestId,
        reason: 'invalid authenticator code',
      }).catch(() => {})
      throw new AppError('MFA_INVALID', {
        publicMessage: 'Invalid authenticator code',
        internalDetail: 'step-up: totp verification failed',
      })
    }

    await markStepUp(auth.session.id)
    await platformAuditEvent({
      adminId: auth.admin.id,
      action: 'platform.step_up.granted',
      targetType: 'AUTH',
      targetId: auth.session.id,
      requestId,
    }).catch(() => {})

    return {
      stepUpUntil: new Date(Date.now() + STEP_UP_WINDOW_MS).toISOString(),
    }
  })
}
