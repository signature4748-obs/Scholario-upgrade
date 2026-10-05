import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  isGoogleAuthConfigured,
  googleAuthorizationUrl,
  googleRedirectUri,
  newCodeVerifier,
  newState,
  codeChallengeS256,
  encodeOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from '@/lib/platform/google'

export const runtime = 'nodejs'

function stateCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/api/platform/auth/google',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeSeconds,
  }
}

function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

/**
 * GET /api/platform/auth/google/start — PUBLIC.
 *
 * Starts the Google OIDC login round-trip for PLATFORM ADMINS:
 *   · CSRF `state` + PKCE S256 verifier, both bound into a 10-minute
 *     HttpOnly cookie scoped to /api/platform/auth/google (the raw
 *     values never reach the browser's JavaScript);
 *   · redirect to Google's consent screen with the MINIMAL scope
 *     (openid email) and prompt=select_account.
 *
 * Unconfigured deployments redirect back to the login page with an
 * honest GOOGLE_NOT_CONFIGURED error code (the UI normally hides the
 * button first — this is the deep-link belt-and-braces path).
 *
 * NOTE: this route NEVER touches the PlatformAdmin table — a Google
 * identity grants nothing until the callback resolves an explicit
 * googleSub link.
 */
export async function GET(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    // ── Capability gate (honest; no enumeration — no account data involved)
    if (!isGoogleAuthConfigured()) {
      return NextResponse.redirect(
        `${requestOrigin(req)}/platform/login?error=GOOGLE_NOT_CONFIGURED`,
        302,
      )
    }

    // ── Rate limit: same posture as the platform login surface (per-IP).
    const ip = clientIpFromHeaders(req.headers)
    const verdict = await checkRateLimitStrict(
      `rl:pf-google:ip:${ip}`,
      RATE_LIMITS.platformGoogleLogin,
    )
    if (!verdict.allowed) {
      await platformAuditEvent({
        action: 'platform.login.locked',
        targetType: 'AUTH',
        ip,
        requestId,
        metadata: { bucket: 'google-ip', retryAfterSec: verdict.retryAfterSec },
      }).catch(() => {})
      const res = NextResponse.redirect(`${requestOrigin(req)}/platform/login?error=RATE_LIMITED`, 302)
      res.headers.set('Retry-After', String(verdict.retryAfterSec))
      return res
    }

    // ── Issue state + PKCE verifier, bind them into the cookie.
    const state = newState()
    const verifier = newCodeVerifier()
    const payload = encodeOAuthState({
      state,
      verifier,
      purpose: 'login',
      exp: Date.now() + OAUTH_STATE_TTL_MS,
    })
    const authUrl = googleAuthorizationUrl({
      redirectUri: googleRedirectUri(requestOrigin(req)),
      state,
      codeChallenge: codeChallengeS256(verifier),
    })

    const res = NextResponse.redirect(authUrl, 302)
    res.cookies.set(
      OAUTH_STATE_COOKIE,
      payload,
      stateCookieOptions(Math.floor(OAUTH_STATE_TTL_MS / 1000)),
    )
    return res
  })
}
