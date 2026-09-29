/**
 * Request-scoped correlation context (Phase 4 — item 1).
 *
 * Every API request flows through ONE `api()` call (src/lib/api.ts), which
 * opens an AsyncLocalStorage scope carrying the correlation context:
 *
 *   requestId   — from middleware (x-request-id), else freshly minted
 *   userId      — patched in by withUser/withAuthz after authentication
 *   schoolId    — patched in after tenant resolution (session-derived only)
 *   route       — pathname (from middleware x-scholario-route)
 *   operation   — "METHOD /path" (from middleware x-scholario-op)
 *   startedAt   — wall-clock start for duration math
 *
 * Anything deeper in the call tree (Prisma query logging, job runner,
 * audit trail, webhook processing) can read the context WITHOUT threading
 * parameters — the correlation id follows the async chain.
 *
 * SECURITY: `schoolId` here is ALWAYS the authenticated session tenant.
 * Client-supplied values never enter this context (Phase-2 rule).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  /** Correlation id — also the X-Request-Id response header. */
  requestId: string
  /** Authenticated user id (id only — never email/phone/PII). */
  userId?: string
  /** Authenticated tenant (session User.schoolId — never client input). */
  schoolId?: string
  /** Route pathname, e.g. "/api/students". */
  route?: string
  /** "METHOD /path" label, e.g. "POST /api/attendance". */
  operation?: string
  /** Epoch-ms start. */
  startedAt?: number
}

const requestStorage = new AsyncLocalStorage<RequestContext>()

/** Run `fn` inside a request scope. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestStorage.run(ctx, fn)
}

/** The current request context (undefined outside a request scope). */
export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore()
}

/**
 * Enrich the CURRENT request scope (e.g. after authentication resolves the
 * user). No-op when called outside a scope (pure-function contexts, tests).
 */
export function patchRequestContext(patch: Partial<RequestContext>): void {
  const store = requestStorage.getStore()
  if (!store) return
  if (patch.userId !== undefined) store.userId = patch.userId
  if (patch.schoolId !== undefined) store.schoolId = patch.schoolId
  if (patch.route !== undefined) store.route = patch.route
  if (patch.operation !== undefined) store.operation = patch.operation
}

/** Test helper: run fn with an explicit context (no HTTP involved). */
export function runInTestContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return requestStorage.run(
    { requestId: ctx.requestId ?? 'test-request', ...ctx },
    fn,
  )
}
