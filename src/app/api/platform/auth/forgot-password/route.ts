import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { burnPasswordTiming } from '@/lib/auth'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  clientIpFromHeaders,
  loginAccountKey,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, emailSchema } from '@/lib/security/validation'
import { platformAuditEvent } from '@/lib/platform/audit'
import { issueAndEmailPasswordReset } from '@/lib/platform/password-reset'

export const runtime = 'nodejs'

const forgotBodySchema = strictBody({ email: emailSchema })

/**
 * POST /api/platform/auth/forgot-password — PUBLIC (no session).
 *
 * ANTI-ENUMERATION CONTRACT: the response is byte-identical whether
 * the email belongs to a PlatformAdmin or not:
 *   { ok: true, data: { message: 'If that address belongs to a platform administrator account, a password reset link has been sent.' } }
 * Same status, same body, same latency envelope (unknown addresses
 * burn a scrypt round so timing cannot distinguish either).
 *
 * Only ACTIVE admins receive an email (a suspended account cannot use
 * a reset; the response stays generic either way). A new request
 * supersedes previous pending tokens (single outstanding token).
 *
 * Rate limits: per-IP AND per-account buckets — both consulted before
 * any DB work; a rate-limited request reveals nothing (the limiter
 * throws the same generic RATE_LIMITED shape the login surface uses).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const body = await parseJsonBody(req, forgotBodySchema)
    const email = body.email
    const ip = clientIpFromHeaders(req.headers)

    // ── Rate limits (both gates; strict = throw on exhaustion) ────────
    const ipVerdict = await checkRateLimitStrict(
      `rl:pf-forgot:ip:${ip}`,
      RATE_LIMITS.platformForgotPassword,
    )
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset requests. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `platform forgot-password ip bucket exhausted (${ip})`,
      })
    }
    const accountVerdict = await checkRateLimitStrict(
      `rl:pf-forgot:acct:${loginAccountKey(email)}`,
      RATE_LIMITS.platformForgotPasswordAccount,
    )
    if (!accountVerdict.allowed) {
      // Same envelope as the IP bucket — no account existence signal.
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset requests. Please try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'platform forgot-password account bucket exhausted',
      })
    }

    // ── Lookup (silent; the response NEVER depends on the outcome) ────
    const admin = await db.platformAdmin.findUnique({ where: { email } })

    if (admin && admin.status === 'ACTIVE') {
      // The reset link origin: APP_URL (canonical origin) or the request
      // origin — identical pipeline for every issuance site.
      const origin =
        (process.env.APP_URL ?? '').trim() ||
        `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? 'localhost:3000'}`
      const { issued, emailStatus } = await issueAndEmailPasswordReset(
        { id: admin.id, email: admin.email, name: admin.name },
        { origin, requestIp: ip, userAgent: req.headers.get('user-agent'), requestId },
      )
      await platformAuditEvent({
        adminId: admin.id,
        action: 'platform.password_reset.requested',
        targetType: 'AUTH',
        targetId: admin.id,
        ip,
        requestId,
        // Counts only — never the token, never the email status of a
        // specific admin (the audit row already binds adminId).
        metadata: { resetId: issued.id, expiresAt: issued.expiresAt.toISOString(), emailStatus },
      }).catch(() => {})
    } else {
      // Timing equalizer: unknown/suspended accounts burn one scrypt
      // round so the response envelope is indistinguishable.
      burnPasswordTiming()
      await platformAuditEvent({
        action: 'platform.password_reset.requested',
        targetType: 'AUTH',
        ip,
        requestId,
        // Truth for the internal audit viewer only — never the response.
        reason: 'no active platform admin account for submitted address',
      }).catch(() => {})
    }

    // ── The ONE generic response (byte-identical in every branch) ─────
    return {
      message:
        'If that address belongs to a platform administrator account, a password reset link has been sent.',
    }
  })
}
