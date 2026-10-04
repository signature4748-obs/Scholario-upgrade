import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { parseJsonBody, strictBody, emailSchema } from '@/lib/security/validation'
import { enforceRateLimit, clientIpFromHeaders, RATE_LIMITS } from '@/lib/security/rate-limit'
import { totpAt, secondsIntoStep } from '@/lib/platform/totp'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'

export const runtime = 'nodejs'

const demoSchema = strictBody({ email: emailSchema })

/**
 * POST /api/platform/auth/demo-code — DEV PREVIEW ONLY.
 *
 * The sandbox has no external authenticator app; this endpoint powers
 * the "Demo authenticator" widget on /platform/login for the SEEDED
 * demo admins. Double-gated:
 *   · hard-disabled in production (404 before anything else);
 *   · only serves admins with isDemo=true (production admins are never
 *     isDemo → useless even if somehow re-enabled).
 *
 * It returns the CURRENT 30-second code — never the TOTP secret.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Not found',
        internalDetail: 'demo-code: production hard-disable',
      })
    }

    // PRODUCT-DIRECTION RESET (Part 1) — with platform TOTP stood down
    // (mfa-config) there is no authenticator code to demo. Answer
    // honestly instead of serving a code nobody will be asked for.
    if (!isPlatformTotpEnabled()) {
      throw new AppError('MFA_NOT_ENABLED', {
        publicMessage: 'Platform multi-factor authentication is currently disabled',
        internalDetail: 'demo-code: refused — platform TOTP policy is off (mfa-config)',
      })
    }

    const ip = clientIpFromHeaders(req.headers)
    enforceRateLimit(`rl:pf-democode:${ip}`, RATE_LIMITS.platformAnnouncementPublic)

    const body = await parseJsonBody(req, demoSchema)
    const admin = await db.platformAdmin.findUnique({ where: { email: body.email.toLowerCase() } })

    if (!admin || !admin.isDemo) {
      // No existence oracle: uniform "not available" response.
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'No demo authenticator is available for this account',
        internalDetail: 'demo-code: not a demo admin',
      })
    }

    return {
      code: totpAt(admin.totpSecret),
      secondsRemaining: 30 - secondsIntoStep(),
      requestId,
    }
  })
}
