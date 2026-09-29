import { NextRequest, NextResponse } from 'next/server'

/**
  * Request correlation middleware (Phase 4 — item 1).
 *
 * EVERY API and health request:
 *   1. receives a request id — an inbound `X-Request-Id` is honored ONLY
 *      when it is a short opaque token (see observability/http.ts —
 *      anything else could be a log-injection vector); otherwise a fresh
 *      UUID is minted;
 *   2. carries it to the route handler via the internal request headers
 *      (`x-request-id`, `x-scholario-route`, `x-scholario-op`), where the
 *      central `api()` envelope reads it — ONE id per request end-to-end,
 *      echoed as the `X-Request-Id` response header and embedded in every
 *      structured log line for that request;
 *   3. gets the response header set here too, so even raw handlers that
 *      bypass `api()` (webhooks, health) are still correlated.
 *
 * Scope: `/api/*` and `/health/*` only — pages/static assets need no
 * correlation ids, and keeping the matcher tight avoids touching the
 * asset pipeline at all.
 */
export function middleware(req: NextRequest) {
  const incoming = req.headers.get('x-request-id')
  const SAFE_REQUEST_ID = /^[A-Za-z0-9:_-]{8,128}$/
  const requestId =
    incoming && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : crypto.randomUUID()

  const pathname = req.nextUrl.pathname
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-scholario-route', pathname)
  requestHeaders.set('x-scholario-op', `${req.method} ${pathname}`)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('x-request-id', requestId)
  return res
}

export const config = {
  matcher: ['/api/:path*', '/health/:path*'],
}
