import { NextRequest, NextResponse } from 'next/server'

/**
  * Middleware — request correlation (Phase 4) + PLATFORM BOUNDARY (Phase 6).
  *
  * ── Correlation (unchanged, Phase 4) ────────────────────────────────────
  * EVERY API and health request receives a request id (inbound
  * `X-Request-Id` honored only when it is a short opaque token; otherwise
  * a fresh UUID), carried to the handler via internal request headers,
  * echoed as the `X-Request-Id` response header.
  *
  * ── Platform boundary (Phase 6) ────────────────────────────────────────
  * The control plane lives in the /platform/* namespace with its OWN
  * credential transports (`scholario_platform_session` cookie /
  * `x-platform-token` dev header — never the school `erp_session`
  * cookie or `Authorization` bearer). This middleware is the first,
  * cheapest enforcement layer:
  *
  *   /api/platform/*   · public exceptions (login, demo-code, public
  *                       announcements) pass through;
  *                     · support endpoints (overview/exit) require a
  *                       SUPPORT credential (support cookie/header);
  *                     · everything else requires a PLATFORM credential
  *                       → else 401 AUTH_REQUIRED JSON (the full
  *                       validation — live session, ACTIVE admin,
  *                       permission, step-up — happens in the route
  *                       handlers via lib/platform/authz.ts).
  *
  *   /platform/* pages · In PRODUCTION (first-party, cookies work): no
  *                       platform cookie → 307 to /platform/login. A hard
  *                       edge boundary before any HTML ships.
  *                     · In DEV PREVIEW the sandbox renders the app in a
  *                       cross-site iframe where browsers refuse the
  *                       SameSite=Lax cookie — page-route redirects are
  *                       disabled (they would loop); the boundary is the
  *                       /api/platform/* gate + the console's server
  *                       validated /api/platform/auth/me on mount +
  *                       per-route authorization. Identical to the
  *                       documented school-side bearer pattern.
  */

// Public /api/platform endpoints (no platform credential required).
const PLATFORM_API_PUBLIC = new Set<string>([
  '/api/platform/auth/login',
  '/api/platform/auth/demo-code',
  '/api/platform/announcements/public',
])
// Support-session endpoints: authenticated by the SUPPORT token space.
const PLATFORM_API_SUPPORT = new Set<string>([
  '/api/platform/support/overview',
  '/api/platform/support/exit',
])

const PLATFORM_COOKIE = 'scholario_platform_session'
const SUPPORT_COOKIE = 'scholario_support'
const PLATFORM_TOKEN_HEADER = 'x-platform-token'
const SUPPORT_TOKEN_HEADER = 'x-support-token'

function json401(requestId: string): NextResponse {
  const res = NextResponse.json(
    {
      ok: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      requestId,
    },
    { status: 401 },
  )
  res.headers.set('x-request-id', requestId)
  return res
}

export function middleware(req: NextRequest) {
  const incoming = req.headers.get('x-request-id')
  const SAFE_REQUEST_ID = /^[A-Za-z0-9:_-]{8,128}$/
  const requestId =
    incoming && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : crypto.randomUUID()

  const pathname = req.nextUrl.pathname
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/health/')
  const isPlatformApi = pathname.startsWith('/api/platform/')
  const isPlatformPage = pathname.startsWith('/platform')

  // ── Platform API boundary (dev AND production) ─────────────────────
  if (isPlatformApi && !PLATFORM_API_PUBLIC.has(pathname)) {
    const hasPlatform =
      req.cookies.has(PLATFORM_COOKIE) || req.headers.has(PLATFORM_TOKEN_HEADER)
    const hasSupport =
      req.cookies.has(SUPPORT_COOKIE) || req.headers.has(SUPPORT_TOKEN_HEADER)

    if (PLATFORM_API_SUPPORT.has(pathname)) {
      // Support endpoints authenticate with the SUPPORT token space.
      // (A platform credential alone is NOT sufficient — the support
      // token is the scoped, time-boxed authority.)
      if (!hasSupport) return json401(requestId)
    } else if (!hasPlatform) {
      // NOTE: a school `erp_session` cookie or `Authorization` bearer is
      // deliberately NOT consulted here — school credentials can never
      // satisfy the platform boundary (the Phase-6 invariant).
      return json401(requestId)
    }
  }

  // ── Platform page boundary (production first-party only) ───────────
  if (
    isPlatformPage &&
    !pathname.startsWith('/platform/login') &&
    process.env.NODE_ENV === 'production'
  ) {
    const hasPlatform =
      req.cookies.has(PLATFORM_COOKIE) || req.headers.has(PLATFORM_TOKEN_HEADER)
    const needsSupport = pathname.startsWith('/platform/support/view')
    const hasSupport =
      req.cookies.has(SUPPORT_COOKIE) || req.headers.has(SUPPORT_TOKEN_HEADER)
    if (needsSupport ? !hasSupport && !hasPlatform : !hasPlatform) {
      const url = req.nextUrl.clone()
      url.pathname = '/platform/login'
      url.search = `?next=${encodeURIComponent(pathname)}`
      const res = NextResponse.redirect(url, 307)
      res.headers.set('x-request-id', requestId)
      return res
    }
  }

  // ── Correlation headers for API/health requests ────────────────────
  if (!isApi) return NextResponse.next()

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-scholario-route', pathname)
  requestHeaders.set('x-scholario-op', `${req.method} ${pathname}`)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('x-request-id', requestId)
  return res
}

export const config = {
  matcher: ['/api/:path*', '/health/:path*', '/platform/:path*'],
}
