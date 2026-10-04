import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, burnPasswordTiming } from '@/lib/auth'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  resetRateLimit,
  clientIpFromHeaders,
  loginAccountKey,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, emailSchema, passwordInputSchema } from '@/lib/security/validation'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  createPlatformSession,
  setPlatformSessionCookie,
  PLATFORM_SESSION_TTL_MS,
} from '@/lib/platform/auth'
import { verifyTotp } from '@/lib/platform/totp'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import { loadEffectivePermissions } from '@/lib/platform/permissions'

export const runtime = 'nodejs'

const loginBodySchema = strictBody({
  email: emailSchema,
  password: passwordInputSchema,
  /// 6-digit authenticator code — only read while platform MFA is on
  /// (see lib/platform/mfa-config.ts; Part 1 reset: stood down for now).
  totpCode: passwordInputSchema.optional(),
})

/**
 * POST /api/platform/auth/login — the ONLY platform entry point.
 *
 * PRODUCT-DIRECTION RESET (Part 1) — sign-in is email + password for
 * now: the TOTP challenge is stood down through the single MFA policy
 * switch (lib/platform/mfa-config.ts). The TOTP architecture below is
 * preserved verbatim behind that flag so proper MFA can be reintroduced
 * later without code surgery. This is NOT a bypass — password checks,
 * dual rate limits, anti-enumeration and auditing are unchanged, and
 * school-user authentication is untouched.
 *
 * On success a PlatformAdminSession is created and the
 * `scholario_platform_session` HttpOnly cookie is set. In dev preview
 * the raw token is also returned (cross-site iframe cookie block — same
 * pattern/justification as the school login).
 *
 * Hardening: dual rate-limit buckets (IP + account), anti-enumeration
 * timing burn, generic failure messages, audited failures/lockouts.
 *
 * A SCHOOL identity can never authenticate here: this route reads only
 * the PlatformAdmin table (the migrated legacy User rows are suspended
 * and unreachable).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const body = await parseJsonBody(req, loginBodySchema)
    const email = body.email.toLowerCase()
    const ip = clientIpFromHeaders(req.headers)

    // ── Rate limits: stricter than the school plane (privileged) ──────
    // PHASE 8B (§21) — strict shared-budget gate (platform credential surface).
    const ipVerdict = await checkRateLimitStrict(`rl:pf-login:ip:${ip}`, RATE_LIMITS.platformLogin)
    if (!ipVerdict.allowed) {
      await platformAuditEvent({
        action: 'platform.login.locked',
        targetType: 'AUTH',
        ip,
        requestId,
        metadata: { bucket: 'ip', retryAfterSec: ipVerdict.retryAfterSec },
      }).catch(() => {})
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many sign-in attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `platform login ip bucket exhausted (${ip})`,
      })
    }

    const accountKey = loginAccountKey(email)
    const accountVerdict = await checkRateLimitStrict(accountKey, RATE_LIMITS.platformLoginAccount)
    if (!accountVerdict.allowed) {
      await platformAuditEvent({
        action: 'platform.login.locked',
        targetType: 'AUTH',
        ip,
        requestId,
        metadata: { bucket: 'account', emailLength: email.length, retryAfterSec: accountVerdict.retryAfterSec },
      }).catch(() => {})
      throw new AppError('ACCOUNT_LOCKED', {
        publicMessage: `Too many failed sign-ins for this account. Try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'platform login account bucket exhausted',
      })
    }

    // ── Identity + password (anti-enumeration) ────────────────────────
    const admin = await db.platformAdmin.findUnique({ where: { email } })
    const passwordOk = admin?.passwordHash
      ? verifyPassword(body.password, admin.passwordHash)
      : (burnPasswordTiming(), false)

    const fail = async (detail: string) => {
      await platformAuditEvent({
        action: 'platform.login.failed',
        targetType: 'AUTH',
        targetId: admin?.id ?? null,
        ip,
        requestId,
        metadata: { emailLength: email.length },
        reason: detail,
      }).catch(() => {})
    }

    if (!admin || !passwordOk) {
      await fail('invalid credentials')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'platform login: credential mismatch',
      })
    }
    if (admin.status !== 'ACTIVE') {
      await fail('account suspended')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'platform login: suspended account (generic response: no status disclosure)',
      })
    }

    // ── MFA (TOTP) — enforced ONLY while the platform MFA policy is on ──
    // (PRODUCT-DIRECTION RESET Part 1: password-only sign-in for now;
    // the challenge below is the intact re-enable path.)
    if (isPlatformTotpEnabled()) {
      if (!body.totpCode) {
        await fail('mfa missing')
        throw new AppError('MFA_REQUIRED', {
          publicMessage: 'Enter your authenticator code',
          internalDetail: 'platform login: no totp code supplied',
        })
      }
      if (!verifyTotp(body.totpCode, admin.totpSecret)) {
        await fail('mfa invalid')
        throw new AppError('MFA_INVALID', {
          publicMessage: 'Invalid authenticator code',
          internalDetail: 'platform login: totp verification failed',
        })
      }
    }

    // ── Success ───────────────────────────────────────────────────────
    resetRateLimit(accountKey)
    const forwarded = req.headers.get('x-forwarded-for')
    const { token } = await createPlatformSession(admin.id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: forwarded?.split(',')[0]?.trim() || null,
      // A fresh TOTP verification only opens a live step-up window when
      // the challenge actually ran (flag on). With MFA stood down there
      // is no second factor to step up with — the step-up policy gate is
      // disabled by the same switch (lib/platform/authz.ts).
      stepUp: isPlatformTotpEnabled(),
    })
    await setPlatformSessionCookie(token)

    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.login.success',
      targetType: 'AUTH',
      targetId: admin.id,
      ip,
      requestId,
      metadata: { root: admin.isRoot, mfa: isPlatformTotpEnabled() },
    }).catch(() => {})

    const permissions = await loadEffectivePermissions(admin.id, admin.isRoot)
    return {
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        isRoot: admin.isRoot,
      },
      permissions: [...permissions],
      sessionExpiresAt: new Date(Date.now() + PLATFORM_SESSION_TTL_MS).toISOString(),
      // DEV PREVIEW ONLY: iframe cookie fallback (mirrors school login;
      // never returned in production — the HttpOnly cookie is the only
      // session transport there).
      ...(process.env.NODE_ENV !== 'production' ? { sessionToken: token } : {}),
    }
  })
}
