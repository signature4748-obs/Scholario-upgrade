import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { getPlatformSession, setPlatformSessionCookie, hasLiveStepUp } from '@/lib/platform/auth'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import { linkGoogleIdentity, googleLogin } from '@/lib/platform/google-account'
import {
  isGoogleAuthConfigured,
  googleRedirectUri,
  exchangeGoogleCode,
  fetchGoogleJwks,
  verifyIdToken,
  decodeOAuthState,
  stateMatches,
  OAUTH_STATE_COOKIE,
} from '@/lib/platform/google'

export const runtime = 'nodejs'

function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

/** Terminal browser redirects (302, one error code, cookie cleared). */
function finish(req: NextRequest, url: string): NextResponse {
  const res = NextResponse.redirect(url, 302)
  // Expire the state cookie WITH its own path (a bare cookies.delete
  // would clear a '/'-scoped cookie and leave this one alive).
  res.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/platform/auth/google',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })
  return res
}
function loginError(req: NextRequest, origin: string, code: string): NextResponse {
  return finish(req, `${origin}/platform/login?error=${encodeURIComponent(code)}`)
}
function settingsError(req: NextRequest, origin: string, code: string): NextResponse {
  return finish(req, `${origin}/platform/settings?googleError=${encodeURIComponent(code)}`)
}

/**
 * GET /api/platform/auth/google/callback — PUBLIC (Google redirects
 * here after consent). Completes BOTH round-trips:
 *
 *   LOGIN mode (state.purpose === 'login'):
 *     state cookie ↔ query state match → code exchange (PKCE) →
 *     id_token FULL verification (RS256/JWKS, iss, aud, exp) →
 *     PlatformAdmin lookup BY googleSub (NEVER email, NEVER
 *     auto-create) → ACTIVE gate → session + cookie → /platform.
 *
 *   LINK mode (state.purpose === 'link'):
 *     same verification → the state cookie's adminId must match a
 *     LIVE platform session in THIS browser → (while MFA is on) live
 *     step-up re-check → the verified googleSub must not belong to a
 *     different admin → link → /platform/settings.
 *
 * EVERY failure path is a redirect with a safe, non-enumerating code
 * — raw Google/network errors are logged server-side only.
 */
export async function GET(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const origin = requestOrigin(req)
    const ip = clientIpFromHeaders(req.headers)
    const url = new URL(req.url)

    // ── 0. Configuration (deep-link belt-and-braces) ──────────────────
    if (!isGoogleAuthConfigured()) {
      return loginError(req, origin, 'GOOGLE_NOT_CONFIGURED')
    }

    // ── 1. Google-side error (user denied consent, etc.) ─────────────
    const googleError = url.searchParams.get('error')
    if (googleError) {
      await platformAuditEvent({
        action: 'platform.login.failed',
        targetType: 'AUTH',
        ip,
        requestId,
        reason: `google oauth error param: ${googleError.slice(0, 60)}`,
        metadata: { method: 'google' },
      }).catch(() => {})
      return loginError(req, origin, 'GOOGLE_SIGNIN_FAILED')
    }

    // ── 2. State cookie ↔ query state (CSRF) ──────────────────────────
    const payload = decodeOAuthState(req.cookies.get(OAUTH_STATE_COOKIE)?.value)
    const queryState = url.searchParams.get('state') ?? ''
    const code = url.searchParams.get('code') ?? ''
    if (
      !payload ||
      !code ||
      !queryState ||
      !stateMatches(payload.state, queryState)
    ) {
      await platformAuditEvent({
        action: 'platform.login.failed',
        targetType: 'AUTH',
        ip,
        requestId,
        reason: 'google oauth state cookie missing, expired or mismatched',
        metadata: { method: 'google' },
      }).catch(() => {})
      // Login-shaped failure for both purposes — no flow-shape oracle.
      return loginError(req, origin, 'GOOGLE_STATE_INVALID')
    }

    // ── 3. Rate limit (per-IP; same posture as platform login) ───────
    const verdict = await checkRateLimitStrict(`rl:pf-google:ip:${ip}`, RATE_LIMITS.platformGoogleLogin)
    if (!verdict.allowed) {
      await platformAuditEvent({
        action: 'platform.login.locked',
        targetType: 'AUTH',
        ip,
        requestId,
        metadata: { bucket: 'google-ip', retryAfterSec: verdict.retryAfterSec },
      }).catch(() => {})
      return loginError(req, origin, 'RATE_LIMITED')
    }

    // ── 4. Code exchange (PKCE verifier from the state cookie) ───────
    let idToken: string
    try {
      const exchanged = await exchangeGoogleCode({
        code,
        verifier: payload.verifier,
        redirectUri: googleRedirectUri(origin),
      })
      idToken = exchanged.idToken
    } catch (e) {
      // Exchange failure detail is server-side only.
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          channel: 'platform-audit',
          level: 'error',
          action: 'platform.login.failed',
          requestId,
          error: e instanceof Error ? e.message.slice(0, 200) : 'google token exchange failed',
        }),
      )
      return loginError(req, origin, 'GOOGLE_SIGNIN_FAILED')
    }

    // ── 5. FULL id_token verification ────────────────────────────────
    const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim()
    const jwks = await fetchGoogleJwks()
    const verified = verifyIdToken(idToken, jwks, clientId)
    if (!verified.ok) {
      await platformAuditEvent({
        action: 'platform.login.failed',
        targetType: 'AUTH',
        ip,
        requestId,
        reason: `google id_token rejected (${verified.failure})`,
        metadata: { method: 'google' },
      }).catch(() => {})
      return loginError(req, origin, 'GOOGLE_SIGNIN_FAILED')
    }
    const { sub, email } = verified.identity

    // ── 6a. LINK mode ─────────────────────────────────────────────────
    if (payload.purpose === 'link') {
      // The browser must STILL hold a live session for the SAME admin
      // the state cookie was bound to at link/start.
      const auth = await getPlatformSession()
      if (
        !auth ||
        auth.admin.id !== payload.adminId ||
        (isPlatformTotpEnabled() && !hasLiveStepUp(auth.session))
      ) {
        await platformAuditEvent({
          action: 'platform.admin.google_link_failed',
          targetType: 'ADMIN',
          targetId: payload.adminId ?? null,
          ip,
          requestId,
          reason: 'link callback: session lost, mismatched or step-up expired',
        }).catch(() => {})
        return settingsError(req, origin, 'SESSION_EXPIRED')
      }
      const linked = await linkGoogleIdentity(auth.admin.id, sub, email, { ip, requestId })
      if (!linked.ok) {
        return settingsError(req, origin, linked.failure === 'ALREADY_LINKED_OTHER' ? 'GOOGLE_ALREADY_LINKED' : 'GOOGLE_ALREADY_LINKED')
      }
      return finish(req, `${origin}/platform/settings?google=linked`)
    }

    // ── 6b. LOGIN mode ───────────────────────────────────────────────
    const result = await googleLogin(sub, { ip, requestId, userAgent: req.headers.get('user-agent') })
    if (!result.ok) {
      // NOT_LINKED → honest hint (a Google identity is not an account).
      // SUSPENDED → generic (no account-status disclosure).
      return loginError(req, origin, result.failure === 'NOT_LINKED' ? 'GOOGLE_NOT_LINKED' : 'GOOGLE_SIGNIN_FAILED')
    }
    await setPlatformSessionCookie(result.token!)
    return finish(req, `${origin}/platform`)
  })
}
