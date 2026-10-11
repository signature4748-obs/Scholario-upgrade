import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createPlatformSession, setPlatformSessionCookie, PLATFORM_SESSION_TTL_MS } from '@/lib/platform/auth'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import { verifyTotp } from '@/lib/platform/totp'
import { loadEffectivePermissions } from '@/lib/platform/permissions'
import { platformAuditEvent } from '@/lib/platform/audit'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  resetRateLimit,
  clientIpFromHeaders,
  loginIpKey,
  loginAccountKey,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, passwordInputSchema } from '@/lib/security/validation'
import { z } from 'zod'
import {
  isSupabaseAuthEnabled,
  verifySupabaseAccessToken,
  resolvePlatformIdentity,
  linkPlatformAdminAuthUser,
  provePlatformPasswordOwnership,
} from '@/lib/auth/supabase'

export const runtime = 'nodejs'

/**
 * POST /api/platform/auth/supabase/exchange — SUPABASE AUTH PHASE 1
 * (platform plane).
 *
 * Same contract as the school exchange, on the PLATFORM credential store
 * — the Phase-6 invariant is preserved end-to-end:
 *   · only PlatformAdmin rows resolve here (a school User identity is
 *     NEVER accepted — it simply has no PlatformAdmin row);
 *   · the platform session cookie/token space is its own;
 *   · the TOTP MFA policy applies IDENTICALLY to the provider path: when
 *     isPlatformTotpEnabled() the exchange also requires a valid TOTP
 *     code (the provider password alone never bypasses MFA);
 *   · the first link requires the admin's current Scholario password.
 *
 * The response mirrors /api/platform/auth/login exactly.
 */

const exchangeBodySchema = strictBody({
  accessToken: z.string().min(20).max(4096),
  currentPassword: passwordInputSchema.optional(),
  totpCode: passwordInputSchema.optional(),
})

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    if (!isSupabaseAuthEnabled()) {
      throw new AppError('FEATURE_DISABLED', {
        publicMessage: 'Provider sign-in is not enabled for this platform yet.',
        internalDetail: 'platform supabase exchange: SCHOLARIO_SUPABASE_AUTH is not "on"',
      })
    }

    const body = await parseJsonBody(req, exchangeBodySchema)
    const ip = clientIpFromHeaders(req.headers)

    const ipVerdict = await checkRateLimitStrict(loginIpKey(ip), RATE_LIMITS.login)
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many sign-in attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `platform supabase exchange ip bucket exhausted (${ip})`,
      })
    }

    const identity = await verifySupabaseAccessToken(body.accessToken)

    const accountKey = loginAccountKey(identity.email ?? identity.id)
    const accountVerdict = await checkRateLimitStrict(accountKey, RATE_LIMITS.loginAccount)
    if (!accountVerdict.allowed) {
      await platformAuditEvent({
        adminId: null,
        action: 'platform.supabase_exchange.locked',
        targetType: 'AUTH',
        targetId: identity.email ?? identity.id,
        ip,
        requestId,
        metadata: { retryAfterSec: accountVerdict.retryAfterSec },
      }).catch(() => {})
      throw new AppError('ACCOUNT_LOCKED', {
        publicMessage: `Too many sign-in attempts for this account. Try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'platform supabase exchange account bucket exhausted',
      })
    }

    // ── Resolution on the PLATFORM store only (Phase 6) ────────────────
    const resolution = await resolvePlatformIdentity(identity)
    if (resolution.state === 'none') {
      const unverified = Boolean(identity.email) && !identity.emailVerified
      await platformAuditEvent({
        adminId: null,
        action: 'platform.supabase_exchange.failed',
        targetType: 'AUTH',
        targetId: identity.email ?? identity.id,
        ip,
        requestId,
        metadata: { reason: unverified ? 'identity-not-verified' : 'no-platform-account' },
      }).catch(() => {})
      if (unverified) throw new AppError('IDENTITY_UNVERIFIED', { internalDetail: 'platform exchange: identity not verified' })
      throw new AppError('NO_SCHOLARIO_ACCOUNT', { internalDetail: 'platform exchange: no PlatformAdmin mapping' })
    }

    let adminId: string
    let linkedNow = false

    if (resolution.state === 'linked') {
      adminId = resolution.adminId
    } else {
      // FIRST LINK — verified identity + admin password ownership proof.
      if (!body.currentPassword) {
        throw new AppError('LINK_PASSWORD_REQUIRED', {
          internalDetail: 'platform supabase exchange: first-link requires the current password',
        })
      }
      const owned = await provePlatformPasswordOwnership(resolution.adminId, body.currentPassword)
      if (!owned) {
        await platformAuditEvent({
          adminId: resolution.adminId,
          action: 'platform.supabase_link.failed',
          targetType: 'AUTH',
          targetId: identity.email ?? identity.id,
          ip,
          requestId,
          metadata: { reason: 'ownership-proof-failed' },
        }).catch(() => {})
        throw new AppError('AUTH_REQUIRED', {
          publicMessage: 'Current password is incorrect',
          internalDetail: 'platform supabase exchange: ownership proof failed',
        })
      }
      // MFA PRESERVED: a first link under an enabled TOTP policy ALSO
      // requires a valid TOTP code — linking is at least as sensitive as
      // login (it persists a sign-in method).
      if (isPlatformTotpEnabled()) {
        if (!body.totpCode) {
          throw new AppError('MFA_REQUIRED', { publicMessage: 'Enter your authenticator code' })
        }
        const adminRow = await db.platformAdmin.findUnique({ where: { id: resolution.adminId }, select: { totpSecret: true } })
        if (!adminRow || !verifyTotp(body.totpCode, adminRow.totpSecret)) {
          throw new AppError('MFA_INVALID', { publicMessage: 'Invalid authenticator code' })
        }
      }
      const link = await linkPlatformAdminAuthUser(resolution.adminId, identity.id)
      if (!link.linked) {
        throw new AppError('AUTH_LINK_CONFLICT', { internalDetail: 'platform supabase exchange: link conflict' })
      }
      adminId = resolution.adminId
      linkedNow = true
      await platformAuditEvent({
        adminId,
        action: 'platform.supabase_link.success',
        targetType: 'AUTH',
        targetId: identity.email ?? identity.id,
        ip,
        requestId,
        metadata: {},
      }).catch(() => {})
    }

    const admin = await db.platformAdmin.findUnique({ where: { id: adminId } })
    if (!admin) throw new AppError('AUTH_REQUIRED', { internalDetail: 'platform exchange: admin vanished after resolution' })

    const fail = (reason: string) =>
      platformAuditEvent({
        adminId: admin.id,
        action: 'platform.supabase_exchange.failed',
        targetType: 'AUTH',
        targetId: admin.id,
        ip,
        requestId,
        metadata: { reason },
      }).catch(() => {})

    if (admin.status !== 'ACTIVE') {
      await fail('account suspended (generic response: no status disclosure)')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'platform supabase exchange: suspended account (no status disclosure)',
      })
    }

    // ── MFA on the linked path too (the provider password NEVER
    //    bypasses the TOTP policy) ──────────────────────────────────────
    if (isPlatformTotpEnabled()) {
      if (!body.totpCode) {
        await fail('mfa missing')
        throw new AppError('MFA_REQUIRED', { publicMessage: 'Enter your authenticator code' })
      }
      if (!verifyTotp(body.totpCode, admin.totpSecret)) {
        await fail('mfa invalid')
        throw new AppError('MFA_INVALID', { publicMessage: 'Invalid authenticator code' })
      }
    }

    // ── Success ──────────────────────────────────────────────────────────
    resetRateLimit(accountKey)
    const forwarded = req.headers.get('x-forwarded-for')
    const { token } = await createPlatformSession(admin.id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: forwarded?.split(',')[0]?.trim() || null,
      stepUp: isPlatformTotpEnabled(),
    })
    await setPlatformSessionCookie(token)

    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.supabase_exchange.success',
      targetType: 'AUTH',
      targetId: admin.id,
      ip,
      requestId,
      metadata: { root: admin.isRoot, mfa: isPlatformTotpEnabled(), linkedNow },
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
      ...(process.env.NODE_ENV !== 'production' ? { sessionToken: token } : {}),
    }
  })
}
