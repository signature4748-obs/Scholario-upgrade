import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { authorizePlatform } from '@/lib/platform/authz'
import { db } from '@/lib/db'
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
 * GET /api/platform/auth/google/link/start — AUTHENTICATED + STEP-UP.
 *
 * Starts the Google identity LINKING round-trip for the SIGNED-IN
 * admin (Settings → Account → Sign-in methods):
 *   · requires a live platform session AND a live step-up window
 *     (the suspend/reactivate pattern — enforced while platform MFA
 *     is on; while it is stood down the authenticated session is the
 *     gate, exactly like suspend/reactivate);
 *   · the OAuth state cookie is BOUND to this admin's id — the
 *     callback re-validates the session against that binding, so a
 *     link flow can never be redirected onto another account;
 *   · the admin must not already have a linked Google identity
 *     (unlink first — one identity per account, explicit state).
 *
 * This route NEVER auto-creates anything: linking attaches a verified
 * Google identity to an EXISTING account, period.
 */
export async function GET(req: NextRequest) {
  return api(async () => {
    // Session + (policy-gated) step-up + mutation rate brake.
    const ctx = await authorizePlatform({ stepUp: true })
    enforceRateLimit(`rl:platform-mut:${ctx.admin.id}`, RATE_LIMITS.platformMutation)

    if (!isGoogleAuthConfigured()) {
      throw new AppError('EXTERNAL_SERVICE_FAILURE', {
        publicMessage: 'Google sign-in is not configured on this deployment.',
        internalDetail: 'google link/start: GOOGLE_OAUTH_CLIENT_ID/SECRET not configured',
      })
    }

    const existing = await db.platformAdmin.findUnique({ where: { id: ctx.admin.id } })
    if (existing?.googleSub) {
      throw new AppError('CONFLICT', {
        publicMessage: 'This account already has a linked Google identity. Unlink it first.',
        internalDetail: 'google link/start: admin already linked',
      })
    }

    const state = newState()
    const verifier = newCodeVerifier()
    const payload = encodeOAuthState({
      state,
      verifier,
      purpose: 'link',
      adminId: ctx.admin.id,
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
