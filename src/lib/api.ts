import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getCurrentUser, type AuthUser } from './auth'
import { db } from './db'
import { AppError, classifyError, newRequestId } from './security/errors'
import { runWithContext, patchRequestContext, getRequestContext } from './observability/context'
import { log } from './observability/logger'
import { meterSchoolApiOperation } from './ops/usage-meter'
import { sanitizeRequestId } from './observability/http'
import { entitlementForUser } from './entitlement/server'
import { isEntitlementExemptRoute } from './entitlement/entitlement'
import { evaluateStudentEntitlement } from './entitlement/student'
import { evaluateStaffEntitlement, requiresStaffEntitlement } from './entitlement/staff'
import { STAFF_SEAT_ELIGIBLE_ROLES, DEFAULT_STAFF_COVERED_ROLES } from './subscription/staff'
import { isCanonicalSchoolRole } from './security/permissions'

export type Ctx = { user: AuthUser }

/**
 * The central API envelope (Phase 1 hardening; Phase 4 observability).
 *
 * Success → `{ ok: true, data }` (or raw Response passthrough for file
 * streams — those handlers already control their own headers).
 *
 * Failure → `{ ok: false, error, code, requestId }` where `error` is a
 * GUARANTEED-safe message, `code` is the canonical AppErrorCode taxonomy
 * and `requestId` is the correlation id (also the X-Request-Id response
 * header — quote it in bug reports; it finds the request's log lines).
 * Prisma internals, stack traces, and filesystem paths stay in the server
 * log. 429s carry `Retry-After`.
 *
 * Phase 4: every call opens a request scope (AsyncLocalStorage) carrying
 * requestId/userId/schoolId/route/operation, and emits ONE structured
 * completion line (`http_request`) with duration + status (+ errorCode on
 * failure). Route/operation are injected by middleware; when middleware
 * did not run (direct handler invocation in tests) they fall back to
 * 'unknown' and a fresh request id is minted.
 */

interface RequestMeta {
  requestId: string
  route: string
  operation: string
}

async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers()
    return {
      requestId: sanitizeRequestId(h.get('x-request-id')) ?? newRequestId(),
      route: h.get('x-scholario-route') ?? 'unknown',
      operation: h.get('x-scholario-op') ?? 'unknown',
    }
  } catch {
    // Outside a Next request scope (unit tests, scripts) — degrade safely.
    return { requestId: newRequestId(), route: 'unknown', operation: 'unknown' }
  }
}

export async function api(handler: () => Promise<unknown>): Promise<Response> {
  const meta = await requestMeta()
  const startedAt = Date.now()
  return runWithContext({ ...meta, startedAt }, async () => {
    try {
      const data = await handler()
      const durationMs = Date.now() - startedAt
      const status = data instanceof Response ? data.status : 200
      log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http_request', {
        channel: 'http',
        durationMs,
        status,
      })
      // Raw Response passthrough — lets handlers stream files/CSVs with
      // custom headers instead of the standard { ok, data } JSON envelope.
      if (data instanceof Response) {
        data.headers.set('X-Request-Id', meta.requestId)
        return data
      }
      const res = NextResponse.json({ ok: true, data })
      res.headers.set('X-Request-Id', meta.requestId)
      // PIH-4c (§30) — the JSON envelope serves authenticated, per-request
      // data (session identity, scoped rosters, exports). No intermediary
      // or browser cache may store it — same no-store contract the raw
      // CSV/download responses already carry.
      res.headers.set('Cache-Control', 'no-store')
      return res
    } catch (e: unknown) {
      const classified = classifyError(e, meta.requestId)
      const durationMs = Date.now() - startedAt
      // One structured failure line — correlation fields come from the
      // request scope; internalDetail NEVER reaches the client.
      log(classified.status >= 500 ? 'error' : 'warn', 'http_request', {
        channel: 'http',
        durationMs,
        status: classified.status,
        errorCode: classified.code,
        detail: classified.internalDetail,
      })
      // PLATFORM OPERATIONS CENTER — operational-error capture for the
      // classes that mean incidents (5xx, cross-tenant denials,
      // external-service failures). Benign 4xx security surface (401/404/
      // 429) is deliberately NOT recorded (noise would bury signal; it is
      // still logged above + audited where applicable). Fire-and-forget:
      // capture never fails the request it observes.
      if (
        classified.status >= 500 ||
        classified.code === 'TENANT_MISMATCH' ||
        classified.code === 'EXTERNAL_SERVICE_FAILURE'
      ) {
        void (async () => {
          const { recordOperationalError } = await import('@/lib/ops/errors')
          const ctx = getRequestContext()
          const detail = (classified.internalDetail ?? classified.publicMessage ?? '').slice(0, 240)
          await recordOperationalError({
            category: 'http',
            severity: classified.status >= 500 ? 'error' : 'warning',
            message: `${classified.code}: ${detail}`,
            route: ctx?.route ?? 'unknown',
            method: ctx?.operation?.split(' ')[0] ?? null,
            statusCode: classified.status,
            schoolId: ctx?.schoolId ?? null,
            requestId: meta.requestId,
          })
        })().catch(() => null)
      }
      const res = NextResponse.json(
        {
          ok: false,
          error: classified.publicMessage,
          code: classified.code,
          requestId: meta.requestId,
        },
        { status: classified.status },
      )
      for (const [k, v] of Object.entries(classified.headers ?? {})) {
        res.headers.set(k, v)
      }
      // PIH-4c (§30) — error envelopes carry the same per-request semantics
      // (never cached) as the success path above.
      res.headers.set('Cache-Control', 'no-store')
      return res
    }
  })
}

export async function withUser(
  handler: (user: AuthUser) => Promise<unknown>,
  opts?: {
    roles?: string[]
    allowLockedSubscription?: boolean
    /**
     * PHASE 3 — Role-wise Feature Control: a ROLE_FEATURE_CATALOG key.
     * Checked AFTER the role gate for school-plane callers; a school that
     * explicitly disabled this feature for the caller's role gets a typed
     * 403 FEATURE_DISABLED_FOR_ROLE. Same resolver the authorize() policy
     * gate uses (src/lib/security/role-features.ts) — one layer, two
     * entry points, so withUser-only routes can declare feature gates too.
     */
    feature?: string
  },
) {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) {
      throw new AppError('AUTH_REQUIRED', { internalDetail: 'withUser: no session' })
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('AUTH_REQUIRED', {
        internalDetail: `withUser: account status ${user.status}`,
      })
    }
    // ── PHASE 1 (role-architecture audit) — canonical school-role invariant.
    // The school application has EXACTLY three user roles: PRINCIPAL,
    // TEACHER, STUDENT. Any other role value on a school identity
    // (PARENT, MANAGEMENT, ACCOUNTANT, DRIVER, SUPER_ADMIN, or a future
    // stray value) is refused here — fail-closed — so a legacy/forged
    // session for a non-canonical role can never reach a school API.
    // Parent User rows remain valid as contact/thread-anchor data for
    // teacher-side surfaces; they simply hold no school authorization.
    if (!isCanonicalSchoolRole(user.role)) {
      throw new AppError('FORBIDDEN', {
        internalDetail: `withUser: role ${user.role} is not a canonical school role (PRINCIPAL|TEACHER|STUDENT)`,
      })
    }
    // ── CREDENTIAL-RESET — forced first-password-change gate ──────────
    // The account authenticated (login ALWAYS succeeds — the auth
    // architecture is untouched), but it has not yet established its own
    // password (mustChangePassword: provisioned with a temp/bootstrap
    // credential, or flagged by the credential-neutralization migration
    // for accounts that never changed one). Business APIs reject with
    // PASSWORD_CHANGE_REQUIRED until /api/auth/change-password completes;
    // the SAME non-business exempt surface the subscription lock uses
    // (auth/session, profile, subscription, support, logout) stays
    // reachable so the forced-change screen can function. Fail-closed:
    // unknown routes are business. The UI screen is a courtesy — THIS is
    // the authority. Platform identities (no schoolId) never carry the
    // flag.
    if (user.mustChangePassword && user.schoolId) {
      const route = await currentRouteContext()
      if (!isEntitlementExemptRoute(route)) {
        throw new AppError('PASSWORD_CHANGE_REQUIRED', {
          publicMessage:
            'Set your own password to finish signing in. Your school workspace unlocks as soon as your new password is saved.',
          internalDetail: `withUser: mustChangePassword (route ${route ?? 'unknown'})`,
        })
      }
    }
    // ── SaaS-HARDENING — tenant-subscription entitlement gate ──────────
    // (The historical `user.role !== 'SUPER_ADMIN'` skip is gone: the
    // canonical-role invariant above already refuses platform identities,
    // so every school session reaching this gate is a school identity.)
    // Authentication NEVER depends on the subscription (login always
    // succeeds); THIS is where a restricted/suspended tenant is stopped:
    // every BUSINESS API rejects with SUBSCRIPTION_REQUIRED while the
    // exempt non-business surface (auth/session, profile, subscription
    // status, renewal, support, logout) stays reachable so the school
    // understands "Your SCHOLARIO subscription needs renewal."
    // Fail-closed: unknown routes are business; unknown states restrict.
    // UI lock screens are convenience only — THIS is the authority.
    if (user.schoolId) {
      const entitlement = entitlementForUser(user)
      const route = await currentRouteContext()
      const routeExempt = isEntitlementExemptRoute(route)
      const bypass =
        routeExempt ||
        // Legacy account-lock escape hatch preserved for identity surfaces.
        (opts?.allowLockedSubscription && !entitlement.businessAllowed)
      if (!entitlement.businessAllowed && !bypass) {
        throw new AppError('SUBSCRIPTION_REQUIRED', {
          publicMessage: entitlement.message ?? undefined,
          internalDetail: `withUser: entitlement ${entitlement.state} (route ${route ?? 'unknown'})`,
        })
      }

      // ── SUBSCRIPTION & ENTITLEMENT SYSTEM — per-student gate ────────────
      // (Model B/C: tenants billed PER_STUDENT/MIXED). Composes ON TOP of
      // the tenant state: a student on a school-wide plan is covered and
      // NEVER locked by a missing individual subscription; a student under
      // the per-student model needs an individual entitlement that is
      // evaluated LIVE from its explicit validity window (access never
      // depends on a scheduled job). The same exempt non-business surface
      // (auth/session, profile, subscription status + code claim, support,
      // logout) stays reachable so a locked student can always activate.
      // Fail-closed: unknown billing models map to SCHOOL_WIDE (the safe
      // legacy default) — per-student enforcement only engages when the
      // platform explicitly set the model.
      if (
        user.role === 'STUDENT' &&
        entitlement.businessAllowed &&
        (user.school?.subscription?.billingModel === 'PER_STUDENT' ||
          user.school?.subscription?.billingModel === 'MIXED')
      ) {
        const studentBypass = routeExempt
        if (!studentBypass) {
          const live = await db.studentEntitlement.findFirst({
            where: {
              student: { userId: user.id },
              schoolId: user.schoolId,
              // LIVE rows only: a SUSPENDED row must never shadow a live
              // entitlement (suspend → new payment creates a second row;
              // ordering by validityEnd could pick the stale suspended one
              // and lock a student who holds a valid ACTIVE grant). A
              // suspended-only student is correctly treated as not
              // subscribed (suspend = operator-withdrawn access).
              status: { in: ['PENDING', 'ACTIVE'] },
            },
            orderBy: { validityEnd: 'desc' },
            select: { status: true, validityStart: true, validityEnd: true, source: true },
          })
          const decision = evaluateStudentEntitlement({
            accountSubscriptionStatus: user.subscriptionStatus,
            tenant: entitlement,
            billingModel: user.school?.subscription?.billingModel,
            entitlement: live
              ? {
                  status: live.status,
                  validityStart: live.validityStart,
                  validityEnd: live.validityEnd,
                  source: live.source,
                }
              : null,
          })
          if (!decision.businessAllowed) {
            throw new AppError('SUBSCRIPTION_REQUIRED', {
              publicMessage: decision.message ?? undefined,
              internalDetail: `withUser: student entitlement ${decision.state} (route ${route ?? 'unknown'})`,
            })
          }
        }
      }

      // ── STAFF ENTITLEMENTS (2026-10-30) — per-seat staff gate ────────
      // (PER_SEAT staff coverage). Composes ON TOP of the tenant state:
      // a covered staff role on a TENANT-coverage school is covered and
      // NEVER locked by a missing individual subscription; a covered role
      // under PER_SEAT needs a live StaffEntitlement evaluated from its
      // explicit validity window. STAFF ROLE COVERAGE (PHASE 5C): only
      // roles in the tenant's EFFECTIVE covered set (session-resolved:
      // tenant override → plan declaration → ["TEACHER"] default, never
      // wider than the seat-eligible canonical set) are gate-eligible —
      // PRINCIPAL sessions are DELIBERATELY NEVER evaluated here
      // (administrative privileges are not a paid staff entitlement — a
      // principal can administer the school without holding a seat), and
      // STUDENT sessions are governed by billingModel above, never by
      // staffCoverage. The same exempt non-business surface (auth/session,
      // profile, subscription status + staff code claim, support, logout)
      // stays reachable so a locked teacher can always activate.
      // Fail-closed: unknown coverage values map to TENANT (the safe
      // legacy default) — per-seat enforcement only engages when the
      // platform explicitly set the policy.
      const coveredRoles = user.school?.subscription?.staffCoverageRoles ?? DEFAULT_STAFF_COVERED_ROLES
      if (
        (STAFF_SEAT_ELIGIBLE_ROLES as readonly string[]).includes(user.role) &&
        coveredRoles.includes(user.role) &&
        entitlement.businessAllowed &&
        requiresStaffEntitlement(user.school?.subscription?.staffCoverage)
      ) {
        const staffBypass = routeExempt
        if (!staffBypass) {
          const live = await db.staffEntitlement.findFirst({
            where: {
              userId: user.id,
              schoolId: user.schoolId,
              // LIVE rows only — the same SUSPENDED-shadow rule as the
              // student gate (a suspended-only teacher is not subscribed;
              // suspend = operator-withdrawn access).
              status: { in: ['PENDING', 'ACTIVE'] },
            },
            orderBy: { validityEnd: 'desc' },
            select: { status: true, validityStart: true, validityEnd: true, source: true },
          })
          const decision = evaluateStaffEntitlement({
            accountSubscriptionStatus: user.subscriptionStatus,
            tenant: entitlement,
            staffCoverage: user.school?.subscription?.staffCoverage,
            entitlement: live
              ? {
                  status: live.status,
                  validityStart: live.validityStart,
                  validityEnd: live.validityEnd,
                  source: live.source,
                }
              : null,
          })
          if (!decision.businessAllowed) {
            throw new AppError('SUBSCRIPTION_REQUIRED', {
              publicMessage: decision.message ?? undefined,
              internalDetail: `withUser: staff entitlement ${decision.state} (route ${route ?? 'unknown'})`,
            })
          }
        }
      }
    }
    if (opts?.roles && !opts.roles.includes(user.role)) {
      throw new AppError('FORBIDDEN', {
        internalDetail: `withUser: role ${user.role} not in ${opts.roles.join('|')}`,
      })
    }
    // PHASE 3 — Role-wise Feature Control gate (per-school override layer).
    // Runs after the role gate so the error surface matches the existing
    // FORBIDDEN ordering; fail-closed via the shared resolver.
    if (opts?.feature) {
      const { assertRoleFeatureAllowed } = await import('@/lib/security/role-features')
      await assertRoleFeatureAllowed(user.schoolId ?? '', user.role, opts.feature)
    }
    // Correlate the request with the authenticated identity (ids only —
    // never email/phone/PII).
    patchRequestContext({ userId: user.id, schoolId: user.schoolId ?? undefined })
    // PLATFORM OPERATIONS CENTER — per-school usage metering (SERVER-
    // derived tenant identity only; atomic upserts; failures never
    // break the request). Platform identities (no schoolId) are out of
    // scope for per-school usage by definition.
    if (user.schoolId) {
      void meterSchoolApiOperation(user.schoolId, user.id, user.role)
    }
    return handler(user)
  })
}

/** The middleware-injected route path (x-scholario-route) for the
 *  current request — the entitlement exemption matcher input. Falls
 *  back to null outside a request scope (fail-closed: business). */
async function currentRouteContext(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get('x-scholario-route')
  } catch {
    return null
  }
}

export function schoolScoped(user: AuthUser): string {
  if (user.role === 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'This resource is school-scoped and not available to platform administrators',
      internalDetail: 'schoolScoped(SUPER_ADMIN)',
    })
  }
  if (!user.schoolId) {
    throw new AppError('FORBIDDEN', {
      internalDetail: 'schoolScoped: identity has no school scope',
    })
  }
  return user.schoolId
}

export { getCurrentUser }
