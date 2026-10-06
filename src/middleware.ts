import { NextRequest, NextResponse } from 'next/server'
import {
  PLANE,
  platformPlaneApiAllowed,
  schoolPlanePlatformExempt,
} from '@/lib/plane'

/**
  * Middleware — request correlation (Phase 4) + PLATFORM BOUNDARY (Phase 6)
  * + DEPLOYMENT-PLANE GATE (two-Vercel-project architecture).
  *
  * ── Correlation (unchanged, Phase 4) ────────────────────────────────────
  * EVERY API and health request receives a request id (inbound
  * `X-Request-Id` honored only when it is a short opaque token; otherwise
  * a fresh UUID), carried to the handler via internal request headers,
  * echoed as the `X-Request-Id` response header.
  *
  * ── Deployment-plane gate (new) ────────────────────────────────────────
  * The SAME repository builds TWO Vercel projects:
  *   scholario-platform (SCHOLARIO_PLANE=platform) — control plane only
  *   scholario-app      (SCHOLARIO_PLANE=school)    — school ERP only
  *   'unified' (legacy project only, opt-in)         — both planes
  *
  * An invalid or missing plane value fails CLOSED in production
  * (src/lib/plane.ts refuses to load — no silent unified fallback).
  *
  * PLANE GATE = ROUTE EXISTENCE, not authorization:
  *   · school plane  → /platform/* and /api/platform/* (except the
  *     public announcements broadcast) simply DO NOT EXIST → 404.
  *   · platform plane → the school doors (/s/*, /login) and every
  *     school-plane API DO NOT EXIST → 404. Only /api/platform/*,
  *     /api/webhooks/*, /api/app-version and the /api heartbeat remain.
  *
  * Authorization inside each plane is UNCHANGED — withUser / withPlatform
  * still enforce session, role, tenant, permission on every handler.
  * The gate just makes the wrong plane's surface vanish from the wrong
  * deployment (no login door to phish on, no platform console to probe
  * from the school app).
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
// ACCOUNT-RECOVERY additions: the anonymous forgot/reset surface + the
// Google OAuth round-trip (status probe, consent redirect, callback).
const PLATFORM_API_PUBLIC = new Set<string>([
  '/api/platform/auth/login',
  '/api/platform/auth/demo-code',
  '/api/platform/auth/forgot-password',
  '/api/platform/auth/reset-password',
  '/api/platform/auth/google/status',
  '/api/platform/auth/google/start',
  '/api/platform/auth/google/callback',
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

/** Honest 404 for a route that does not exist on this plane. */
function json404(requestId: string): NextResponse {
  const res = NextResponse.json(
    { ok: false, error: 'Not found', code: 'NOT_FOUND', requestId },
    { status: 404 },
  )
  res.headers.set('x-request-id', requestId)
  return res
}

/** Minimal honest 404 page for plane-blocked page routes. */
function page404(requestId: string): NextResponse {
  const res = new NextResponse(
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 — Not Found</title></head>' +
      '<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a">' +
      '<div style="text-align:center;padding:2rem"><h1 style="font-size:1.5rem;margin:0 0 .5rem">404 — Page not found</h1>' +
      '<p style="margin:0;color:#64748b">This page does not exist on this deployment.</p></div></body></html>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
  res.headers.set('x-request-id', requestId)
  return res
}

// ── Canonical school-door slug cache (small, TTL-bounded) ────────────
// /s/<slug> and /s/<slug>/login get their slug validated against the
// REAL School table via the internal public-API probe BEFORE the root
// streaming shell flushes — so an unknown slug is an HONEST 404 status
// and a valid /s/<slug> is a CLEAN 307. The probe result is cached per
// slug for 60s (bounded map — these doors are low-frequency).
const slugCache = new Map<string, { ok: boolean; at: number }>()
const SLUG_CACHE_TTL_MS = 60_000
const SLUG_CACHE_MAX = 512

async function slugExists(origin: string, slug: string): Promise<boolean> {
  const now = Date.now()
  const hit = slugCache.get(slug)
  if (hit && now - hit.at < SLUG_CACHE_TTL_MS) return hit.ok
  try {
    const res = await fetch(
      `${origin}/api/schools/public?slug=${encodeURIComponent(slug)}`,
      { headers: { 'x-scholario-door-probe': '1' }, cache: 'no-store' },
    )
    const ok = res.ok
    if (slugCache.size >= SLUG_CACHE_MAX) {
      // Cheap eviction: drop the oldest ~quarter (insertion-ordered map).
      const drop = Math.ceil(SLUG_CACHE_MAX / 4)
      for (const k of slugCache.keys()) {
        if (slugCache.size <= SLUG_CACHE_MAX - drop) break
        slugCache.delete(k)
      }
    }
    slugCache.set(slug, { ok, at: now })
    return ok
  } catch {
    // Probe transport failure → fail-OPEN: the /s page components run
    // their own server-side validation (notFound()) — never take the
    // door down because the probe failed.
    return true
  }
}

export async function middleware(req: NextRequest) {
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
  const isSchoolDoorPage = pathname === '/login' || pathname.startsWith('/s/') || pathname === '/s'

  // ── Deployment-plane gate (two-project architecture) ────────────────
  // Route existence per plane. Runs BEFORE every other boundary —
  // the wrong plane's surface is unreachable at the edge.
  if (PLANE === 'school') {
    if (
      (isPlatformPage || isPlatformApi) &&
      !schoolPlanePlatformExempt(pathname)
    ) {
      return isApi ? json404(requestId) : page404(requestId)
    }
  } else if (PLANE === 'platform') {
    // School doors do not exist on the platform deployment.
    if (isSchoolDoorPage) return page404(requestId)
    // School-plane APIs do not exist either: only shared infra +
    // /api/platform/* remain.
    if (pathname.startsWith('/api/') && !platformPlaneApiAllowed(pathname)) {
      return json404(requestId)
    }
  }

  // ── Canonical school doors — honest statuses BEFORE the shell ──────
  // /s/<slug>        → validated slug → clean 307 to /?tenant=<slug>
  //                     (unknown slug → honest 404, never a guess)
  // /s/<slug>/login  → validated slug → renders the login door page
  //                     (which re-validates server-side as well)
  // ANY other /s/* shape — extra segments, percent-encoded traversal
  // (%2e%2e, %2f — decoded here and shape-checked), trailing junk — is
  // an honest 404 at the edge: the app defines exactly two door shapes.
  // Runs on school + unified planes (platform already 404'd above).
  if (PLANE !== 'platform' && (pathname.startsWith('/s/') || pathname === '/s')) {
    let decoded = pathname
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      decoded = pathname
    }
    const doorMatch =
      /^\/s\/([a-zA-Z0-9-]+)\/?$/.exec(decoded) ??
      /^\/s\/([a-zA-Z0-9-]+)\/login\/?$/.exec(decoded)
    if (!doorMatch) return page404(requestId)
    const slug = doorMatch[1].toLowerCase()
    const exists = await slugExists(req.nextUrl.origin, slug)
    if (!exists) return page404(requestId)
    // /s/<slug> (not the login door) → clean redirect to the tenant
    // website path (the login door falls through to its page).
    if (!decoded.endsWith('/login')) {
      const url = req.nextUrl.clone()
      url.pathname = '/'
      url.search = `?tenant=${encodeURIComponent(slug)}`
      const res = NextResponse.redirect(url, 307)
      res.headers.set('x-request-id', requestId)
      return res
    }
  }

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
  // ACCOUNT-RECOVERY: /platform/forgot-password + /platform/reset-password
  // are public recovery pages (same exemption shape as /platform/login).
  if (
    isPlatformPage &&
    !pathname.startsWith('/platform/login') &&
    !pathname.startsWith('/platform/forgot-password') &&
    !pathname.startsWith('/platform/reset-password') &&
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
  matcher: ['/api/:path*', '/health/:path*', '/platform/:path*', '/s/:path*', '/login'],
}
