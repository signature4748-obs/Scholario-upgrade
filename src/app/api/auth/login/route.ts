import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSession, setSessionCookie, burnPasswordTiming, isDevSessionBearerEnabled } from '@/lib/auth'
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
import { parseJsonBody, strictBody, emailSchema, passwordInputSchema } from '@/lib/security/validation'
import { auditEvent, auditRateLimit } from '@/lib/security/audit'
import { evaluateSchoolAccess } from '@/lib/access-policy'

export const runtime = 'nodejs'

const loginBodySchema = strictBody({
  email: emailSchema,
  password: passwordInputSchema,
})

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    // ── Input validation (strict: unknown fields rejected) ──────────────
    const body = await parseJsonBody(req, loginBodySchema)

    const ip = clientIpFromHeaders(req.headers)

    // ── Brute-force protection: IP bucket + account bucket ──────────────
    // PHASE 8B (§21): credential buckets use the STRICT shared-budget gate
    // (the atomic DB row is the decision — exact global enforcement under
    // concurrency; bounded fallback to the local budget on DB failure).
    const ipVerdict = await checkRateLimitStrict(loginIpKey(ip), RATE_LIMITS.login)
    if (!ipVerdict.allowed) {
      auditRateLimit('login-ip', ip, requestId)
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many sign-in attempts. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `login ip bucket exhausted (${ip})`,
      })
    }

    const accountKey = loginAccountKey(body.email)
    const accountVerdict = await checkRateLimitStrict(accountKey, RATE_LIMITS.loginAccount)
    if (!accountVerdict.allowed) {
      auditRateLimit('login-account', body.email, requestId)
      // Audit-persist account lockouts (lower frequency than blocks).
      await auditEvent({
        action: 'LOGIN_LOCKED',
        actorLabel: body.email,
        ip,
        requestId,
        detail: `Account bucket exhausted — ${accountVerdict.retryAfterSec}s lockout.`,
      }).catch(() => {})
      throw new AppError('ACCOUNT_LOCKED', {
        publicMessage: `Too many failed sign-ins for this account. Try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'login account bucket exhausted',
      })
    }

    // ── Credential verification ─────────────────────────────────────────
    const user = await db.user.findUnique({
      where: { email: body.email },
      include: { school: true },
    })

    // Anti-enumeration: burn one scrypt round when the user doesn't exist
    // so failure latency is indistinguishable from a wrong password.
    const passwordOk =
      user && user.passwordHash ? verifyPassword(body.password, user.passwordHash) : (burnPasswordTiming(), false)

    const fail = (reason: 'invalid' | 'inactive') => {
      // Audit the failure (with actor label; no password material).
      return auditEvent({
        schoolId: user?.schoolId ?? null,
        userId: user?.id ?? null,
        action: 'LOGIN_FAILED',
        actorLabel: body.email,
        ip,
        requestId,
        detail: reason === 'inactive' ? 'Account is not active' : 'Invalid credentials',
      })
    }

    if (!user || !passwordOk) {
      await fail('invalid')
      // Generic message — never reveal whether the account exists.
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'credential mismatch',
      })
    }
    if (user.status !== 'ACTIVE') {
      await fail('inactive')
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'account inactive (generic response: no status disclosure)',
      })
    }

    // ── PHASE 6 — platform/school boundary hardening ──────────────────
    // 1. The school authentication system NEVER issues a session for a
    //    platform identity. Legacy User rows with role SUPER_ADMIN are
    //    suspended by the platform migration, and this role gate is the
    //    belt-and-braces invariant (audited as an attack signal).
    if (user.role === 'SUPER_ADMIN') {
      await auditEvent({
        schoolId: null,
        userId: user.id,
        action: 'PLATFORM_LOGIN_BLOCKED',
        actorLabel: body.email,
        ip,
        requestId,
        detail: 'SUPER_ADMIN role attempted school login — platform identities use /platform/login only',
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Invalid email or password',
        internalDetail: 'school login refused a platform identity (Phase 6 invariant)',
      })
    }
    // 2. Suspended or not-yet-activated tenants cannot sign in (school
    //    suspension is a destructive platform action; activation is the
    //    second provisioning step). PHASE 7.5: the decision now flows
    //    through the domain-layer access policy (lib/access-policy.ts)
    //    — the same model every school API boundary uses.
    if (!user.schoolId || !user.school) {
      await auditEvent({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        actorLabel: body.email,
        ip,
        requestId,
        detail: 'School not active (no school binding)',
      }).catch(() => {})
      throw new AppError('SCHOOL_SUSPENDED', {
        publicMessage:
          "Your school's Scholario access is not active yet. Please contact your school administrator.",
        internalDetail: 'school login blocked: no school binding',
      })
    }
    const access = evaluateSchoolAccess(user.school)
    if (!access.allowed) {
      await auditEvent({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        actorLabel: body.email,
        ip,
        requestId,
        detail: `School ${access.status} (subscription access policy)`,
      }).catch(() => {})
      throw new AppError('SCHOOL_SUSPENDED', {
        publicMessage: access.reason,
        internalDetail: `school login blocked by access policy: tenant status ${access.status}`,
      })
    }

    // ── Success: reset the per-account failure bucket ───────────────────
    resetRateLimit(accountKey)

    // SS-1 — capture the sign-in device context for Settings → Devices.
    const forwarded = req.headers.get('x-forwarded-for')
    const token = await createSession(user.id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: forwarded?.split(',')[0]?.trim() || null,
    })
    await setSessionCookie(token)

    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      ip,
      requestId,
      detail: `Signed in as ${user.role}`,
    }).catch(() => {})

    return {
      id: user.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role,
      schoolId: user.schoolId,
      avatarUrl: user.avatarUrl,
      // DEV PREVIEW ONLY (isDevSessionBearerEnabled): the sandbox preview
      // renders this app inside a cross-site iframe where the browser
      // refuses the SameSite=Lax cookie — the client persists this token
      // per-origin and attaches it as a Bearer header. In production this
      // field is NEVER returned: the HttpOnly cookie is the only session
      // transport (Phase-0 baseline B-4 remediation).
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
