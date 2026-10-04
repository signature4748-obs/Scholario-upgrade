import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getCurrentUser, type AuthUser } from './auth'
import { AppError, classifyError, newRequestId } from './security/errors'
import { runWithContext, patchRequestContext } from './observability/context'
import { log } from './observability/logger'
import { sanitizeRequestId } from './observability/http'
import { entitlementForUser } from './entitlement/server'
import { isEntitlementExemptRoute } from './entitlement/entitlement'

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
  opts?: { roles?: string[]; allowLockedSubscription?: boolean },
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
    // ── SaaS-HARDENING — tenant-subscription entitlement gate ──────────
    // Authentication NEVER depends on the subscription (login always
    // succeeds); THIS is where a restricted/suspended tenant is stopped:
    // every BUSINESS API rejects with SUBSCRIPTION_REQUIRED while the
    // exempt non-business surface (auth/session, profile, subscription
    // status, renewal, support, logout) stays reachable so the school
    // understands "Your SCHOLARIO subscription needs renewal."
    // Fail-closed: unknown routes are business; unknown states restrict.
    // UI lock screens are convenience only — THIS is the authority.
    if (user.role !== 'SUPER_ADMIN' && user.schoolId) {
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
    }
    if (opts?.roles && !opts.roles.includes(user.role)) {
      throw new AppError('FORBIDDEN', {
        internalDetail: `withUser: role ${user.role} not in ${opts.roles.join('|')}`,
      })
    }
    // Correlate the request with the authenticated identity (ids only —
    // never email/phone/PII).
    patchRequestContext({ userId: user.id, schoolId: user.schoolId ?? undefined })
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
