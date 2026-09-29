import { NextResponse } from 'next/server'
import { getCurrentUser, type AuthUser } from './auth'
import { AppError, classifyError, newRequestId } from './security/errors'

export type Ctx = { user: AuthUser }

/**
 * The central API envelope (Phase 1 hardening).
 *
 * Success → `{ ok: true, data }` (or raw Response passthrough for file
 * streams — those handlers already control their own headers).
 *
 * Failure → `{ ok: false, error }` where `error` is GUARANTEED safe:
 * typed security codes, legacy sentinels, or route-authored human copy
 * that passed the unsafe-message heuristics. Prisma internals, stack
 * traces, and filesystem paths stay in the server log. Every failure
 * carries an `X-Request-Id` correlation header; 429s carry `Retry-After`.
 */
export async function api(handler: () => Promise<unknown>) {
  const requestId = newRequestId()
  try {
    const data = await handler()
    // Raw Response passthrough — lets handlers stream files/CSVs with
    // custom headers instead of the standard { ok, data } JSON envelope.
    if (data instanceof Response) {
      data.headers.set('X-Request-Id', requestId)
      return data
    }
    const res = NextResponse.json({ ok: true, data })
    res.headers.set('X-Request-Id', requestId)
    return res
  } catch (e: unknown) {
    const classified = classifyError(e, requestId)
    if (classified.status >= 500) {
      // Internal failures: full detail to the server log only.
      console.error(
        JSON.stringify({
          channel: 'api',
          level: 'error',
          requestId,
          code: classified.code,
          detail: classified.internalDetail,
        }),
      )
    }
    const res = NextResponse.json(
      { ok: false, error: classified.publicMessage, code: classified.code },
      { status: classified.status },
    )
    for (const [k, v] of Object.entries(classified.headers ?? {})) {
      res.headers.set(k, v)
    }
    return res
  }
}

export async function withUser(
  handler: (user: AuthUser) => Promise<unknown>,
  opts?: { roles?: string[] },
) {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')
    if (opts?.roles && !opts.roles.includes(user.role)) throw new Error('FORBIDDEN')
    return handler(user)
  })
}

export function schoolScoped(user: AuthUser): string {
  if (user.role === 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'This resource is school-scoped and not available to platform administrators',
      internalDetail: 'schoolScoped(SUPER_ADMIN)',
    })
  }
  if (!user.schoolId) throw new Error('NO_SCHOOL')
  return user.schoolId
}

export { getCurrentUser }
