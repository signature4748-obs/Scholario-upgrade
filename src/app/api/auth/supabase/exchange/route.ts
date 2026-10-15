import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie, isDevSessionBearerEnabled } from '@/lib/auth'
import { SUBSCRIPTION_LEGACY_SELECT } from '@/lib/platform/subscription-schema'
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
import { auditEvent } from '@/lib/security/audit'
import { isCanonicalSchoolRole } from '@/lib/security/permissions'
import { evaluateTenantEntitlement, publicEntitlement } from '@/lib/entitlement/entitlement'
import {
  isSupabaseAuthEnabled,
  verifySupabaseAccessToken,
  resolveSchoolIdentity,
  linkSchoolAuthUser,
  proveSchoolPasswordOwnership,
} from '@/lib/auth/supabase'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * POST /api/auth/supabase/exchange — SUPABASE AUTH PHASE 1 (school plane).
 *
 * Exchanges a Supabase Auth access token for a SCHOLARIO school session.
 * This is the ONLY place the provider path mints an app session, and it
 * runs the FULL login invariant set from /api/auth/login (status, role
 * gates, school binding, entitlement, rate limits, audit, anti-
 * enumeration) — the provider proves IDENTITY, never authorization:
 *
 *   1. Feature flag down → FEATURE_DISABLED (the custom scrypt login is
 *      the compatibility path and is never disabled by this feature).
 *   2. Dual brute-force buckets (IP + account), same limits as login.
 *   3. The access token is verified SERVER-SIDE against the provider's
 *      own /auth/v1/user endpoint — never decoded or trusted locally.
 *   4. Identity → account resolution is server-only, by the linked
 *      pointer or a VERIFIED email/phone, and a first link ALWAYS
 *      requires proof of the account's current Scholario password
 *      (anti-takeover: a verified mailbox alone never links).
 *   5. The response contract mirrors /api/auth/login exactly, so the
 *      client post-login state machine (role panel, must-change screen,
 *      locked shells) is unchanged.
 */

const exchangeBodySchema = strictBody({
  accessToken: z.string().min(20).max(4096),
  // Present (and mandatory) only for the FIRST-LINK exchange — proof of
  // ownership of the existing Scholario account. The server decides when
  // it is required; an unnecessary value is simply ignored.
  currentPassword: passwordInputSchema.optional(),
})

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    // ── 1. Controlled rollout: the exchange path is inert when the flag
    //    is down (default). Nothing else about authentication changes.
    if (!isSupabaseAuthEnabled()) {
      throw new AppError('FEATURE_DISABLED', {
        publicMessage: 'Provider sign-in is not enabled for this school plane yet.',
        internalDetail: 'supabase exchange: SCHOLARIO_SUPABASE_AUTH is not "on"',
      })
    }

    const body = await parseJsonBody(req, exchangeBodySchema)
    const ip = clientIpFromHeaders(req.headers)

    // ── 2. Brute-force buckets — the same dual IP + account gates as the
    //    custom login (the exchange is a login; it must be rate-limited
    //    like one). The account key uses the verified identity once
    //    known; before that, the token itself is the bucket key.
    const ipVerdict = await checkRateLimitStrict(loginIpKey(ip), RATE_LIMITS.login)
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many sign-in attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `supabase exchange ip bucket exhausted (${ip})`,
      })
    }

    // ── 3. Server-side token verification (the trust boundary) ─────────
    const identity = await verifySupabaseAccessToken(body.accessToken)

    const accountKey = loginAccountKey(identity.email ?? identity.phone ?? identity.id)
    const accountVerdict = await checkRateLimitStrict(accountKey, RATE_LIMITS.loginAccount)
    if (!accountVerdict.allowed) {
      await auditEvent({
        action: 'LOGIN_LOCKED',
        actorLabel: identity.email ?? identity.phone ?? identity.id,
        ip,
        requestId,
        detail: `Supabase exchange account bucket exhausted — ${accountVerdict.retryAfterSec}s lockout.`,
      }).catch(() => {})
      throw new AppError('ACCOUNT_LOCKED', {
        publicMessage: `Too many sign-in attempts for this account. Try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'supabase exchange account bucket exhausted',
      })
    }

    // ── 4. Identity → account resolution (server-only, anti-takeover) ─
    const resolution = await resolveSchoolIdentity(identity)

    if (resolution.state === 'none') {
      // Honest states: verified identity with no account mapping.
      // Either the identifier is unverified (must verify first), or no
      // account matches (signup never provisions accounts), or the
      // matched account is already linked to another identity.
      const unverified = Boolean(identity.email || identity.phone) &&
        !identity.emailVerified && !identity.phoneVerified
      await auditEvent({
        action: 'AUTH_SUPABASE_EXCHANGE_FAILED',
        actorLabel: identity.email ?? identity.phone ?? identity.id,
        ip,
        requestId,
        detail: unverified ? 'provider identity not verified' : 'no Scholario account for the verified identity',
      }).catch(() => {})
      if (unverified) throw new AppError('IDENTITY_UNVERIFIED', { internalDetail: 'supabase exchange: identity not verified' })
      throw new AppError('NO_SCHOLARIO_ACCOUNT', { internalDetail: 'supabase exchange: no account mapping' })
    }
    if (resolution.state === 'ambiguous-phone') {
      await auditEvent({
        action: 'AUTH_SUPABASE_EXCHANGE_FAILED',
        actorLabel: identity.phone ?? identity.id,
        ip,
        requestId,
        detail: 'verified phone matches multiple unlinked accounts (household number)',
      }).catch(() => {})
      throw new AppError('PHONE_AMBIGUOUS', { internalDetail: 'supabase exchange: phone matches multiple accounts' })
    }

    let userId = resolution.state === 'linked' ? resolution.userId : null
    let linkedNow = false

    if (resolution.state === 'linkable') {
      // FIRST LINK — the anti-takeover gate: the verified provider
      // identity narrows the candidate, but ONLY the account's current
      // Scholario password authorises writing the pointer.
      if (!body.currentPassword) {
        throw new AppError('LINK_PASSWORD_REQUIRED', {
          internalDetail: 'supabase exchange: first-link requires the current Scholario password',
        })
      }
      const owned = await proveSchoolPasswordOwnership(resolution.userId, body.currentPassword)
      if (!owned) {
        await auditEvent({
          userId: resolution.userId,
          action: 'AUTH_SUPABASE_LINK_FAILED',
          actorLabel: identity.email ?? identity.phone ?? identity.id,
          ip,
          requestId,
          detail: 'ownership proof failed (current password incorrect)',
        }).catch(() => {})
        throw new AppError('AUTH_REQUIRED', {
          publicMessage: 'Current password is incorrect',
          internalDetail: 'supabase exchange: ownership proof failed',
        })
      }
      const link = await linkSchoolAuthUser(resolution.userId, identity.id)
      if (!link.linked) {
        await auditEvent({
          userId: resolution.userId,
          action: 'AUTH_SUPABASE_LINK_FAILED',
          actorLabel: identity.email ?? identity.phone ?? identity.id,
          ip,
          requestId,
          detail: `link conflict (row already linked: ${link.existingAuthUserId ?? 'unknown'})`,
        }).catch(() => {})
        throw new AppError('AUTH_LINK_CONFLICT', { internalDetail: 'supabase exchange: link conflict' })
      }
      userId = resolution.userId
      linkedNow = true
      await auditEvent({
        userId,
        action: 'AUTH_SUPABASE_LINKED',
        actorLabel: identity.email ?? identity.phone ?? identity.id,
        ip,
        requestId,
        detail: 'provider identity linked after verified email/phone + account-password ownership proof',
      }).catch(() => {})
    }

    // ── 5. Full login invariant set (identical to /api/auth/login) ─────
    // SCHEMA-PENDING RESILIENCE — legacy-entitlement columns only (see
    // login route); provider exchange must not 500 on a pre-migration DB.
    const user = await db.user.findUnique({
      where: { id: userId! },
      include: {
        school: { include: { subscription: { select: { ...SUBSCRIPTION_LEGACY_SELECT } } } },
      },
    })
    if (!user) throw new AppError('AUTH_REQUIRED', { internalDetail: 'supabase exchange: account vanished after resolution' })

    const fail = (reason: string) =>
      auditEvent({
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'AUTH_SUPABASE_EXCHANGE_FAILED',
        actorLabel: user.email,
        ip,
        requestId,
        detail: reason,
      }).catch(() => {})

    if (user.status !== 'ACTIVE') {
      await fail('account inactive (generic response: no status disclosure)')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Your account is not active. Please contact your school administrator.',
        internalDetail: 'supabase exchange: account inactive',
      })
    }

    // FEE-ADMISSIONS bootstrap-credential expiry — the same contract as
    // the custom login (an expired bootstrap credential refuses auth).
    if (user.mustChangePassword && user.credentialExpiresAt && user.credentialExpiresAt.getTime() < Date.now()) {
      await fail('bootstrap credential expired')
      throw new AppError('CREDENTIAL_EXPIRED', { internalDetail: 'supabase exchange: bootstrap credential expired' })
    }

    // PHASE 6 boundary: platform identities NEVER get a school session.
    if (user.role === 'SUPER_ADMIN') {
      await fail('SUPER_ADMIN attempted school-plane exchange (Phase 6 invariant)')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid account for school sign-in.',
        internalDetail: 'supabase exchange: platform identity refused (Phase 6)',
      })
    }
    // Canonical school roles only — same fail-closed allowlist as login.
    if (!isCanonicalSchoolRole(user.role)) {
      await fail(`role ${user.role} outside the canonical school roles`)
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid account for school sign-in.',
        internalDetail: `supabase exchange refused role ${user.role}`,
      })
    }
    if (!user.schoolId || !user.school) {
      await fail('no school binding')
      throw new AppError('SCHOOL_SUSPENDED', {
        publicMessage: "Your school's Scholario access is not active yet. Please contact your school administrator.",
        internalDetail: 'supabase exchange: no school binding',
      })
    }
    const entitlement = evaluateTenantEntitlement({
      schoolStatus: user.school.status,
      accountSubscriptionStatus: user.subscriptionStatus,
      subscription: user.school.subscription
        ? {
            status: user.school.subscription.status,
            plan: user.school.subscription.plan,
            periodEnd: user.school.subscription.periodEnd,
            graceDays: user.school.subscription.graceDays,
            overrideStatus: user.school.subscription.overrideStatus,
          }
        : null,
    })
    if (!entitlement.loginAllowed) {
      await fail(`school ${user.school.status} (never activated)`)
      throw new AppError('SCHOOL_SUSPENDED', {
        publicMessage: entitlement.message ?? undefined,
        internalDetail: `supabase exchange: tenant not activated (status ${user.school.status})`,
      })
    }

    // ── Success ──────────────────────────────────────────────────────────
    resetRateLimit(accountKey)
    const forwarded = req.headers.get('x-forwarded-for')
    const token = await createSession(user.id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: forwarded?.split(',')[0]?.trim() || null,
    })
    await setSessionCookie(token)

    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'AUTH_SUPABASE_EXCHANGE_SUCCESS',
      ip,
      requestId,
      detail: `Provider sign-in as ${user.role}${linkedNow ? ' (first link — identity migrated)' : ''}`,
    }).catch(() => {})

    // Response contract mirrors /api/auth/login EXACTLY (the client
    // post-login state machine is shared).
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role,
      schoolId: user.schoolId,
      avatarUrl: user.avatarUrl,
      mustChangePassword: user.mustChangePassword,
      subscriptionStatus: user.subscriptionStatus ?? 'ACTIVE',
      entitlement: publicEntitlement(entitlement),
      ...(isDevSessionBearerEnabled() ? { sessionToken: token } : {}),
      school: user.school
        ? {
            id: user.school.id,
            name: user.school.name,
            slug: user.school.slug,
            code: user.school.code,
            themeColor: user.school.themeColor,
            accentColor: user.school.accentColor,
            logoUrl: user.school.logoUrl,
            academicYear: user.school.academicYear ?? '',
            plan: user.school.plan,
            featureFlags: user.school.featureFlags,
          }
        : null,
    }
  })
}
