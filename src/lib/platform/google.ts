/**
 * ACCOUNT-RECOVERY — Google OIDC helpers for OPTIONAL PlatformAdmin
 * authentication (docs/PLATFORM_ACCOUNT_RECOVERY.md).
 *
 * ARCHITECTURE INVARIANTS:
 *   · Google is an IDENTITY PROVIDER, never an authorization source. A
 *     verified Google identity resolves to a PlatformAdmin ONLY through
 *     the explicit `PlatformAdmin.googleSub` link; there is NO
 *     account creation, NO email-match login, NO domain auto-join.
 *   · The OAuth client credentials are SERVER-ONLY env (never
 *     NEXT_PUBLIC_*, never committed). Unset ⇒ the feature is honestly
 *     off (google/status reports enabled:false; start returns
 *     GOOGLE_NOT_CONFIGURED).
 *   · Authorization Code flow + PKCE (S256) + CSRF `state` bound to an
 *     HttpOnly cookie. The code exchange and every token verification
 *     happen server-side; Google tokens never reach the browser.
 *   · id_token verification: RS256 signature against Google's JWKS
 *     (fetched + cached), `iss` allowlist, `aud` == our client id,
 *     `exp` freshness, `email_verified` when the claim is present.
 *   · We request the MINIMAL scope `openid email` — no profile, no
 *     offline access, no refresh tokens, no Google API calls.
 *
 * TESTING SEAMS: `verifyIdToken` is a PURE function over (token, jwks,
 * clientId) — tests inject their own RSA keypair + JWKS; the network
 * fetchers below are the only impure part.
 */

import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'crypto'

// ── configuration ────────────────────────────────────────────────────────

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

/** Live env reads (never memoized — tests/config reloads flip the feature). */
function googleClientId(): string | null {
  const v = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim()
  return v.length > 0 ? v : null
}
function googleClientSecret(): string | null {
  const v = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim()
  return v.length > 0 ? v : null
}

export function isGoogleAuthConfigured(): boolean {
  return googleClientId() !== null && googleClientSecret() !== null
}

/** The OAuth redirect URI: explicit env, else derived from the origin. */
export function googleRedirectUri(origin: string): string {
  const explicit = (process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '').trim()
  if (explicit) return explicit
  return `${origin.replace(/\/+$/, '')}/api/platform/auth/google/callback`
}

// ── PKCE + state ─────────────────────────────────────────────────────────

/** PKCE code_verifier (RFC 7636: 43-128 unreserved chars, base64url). */
export function newCodeVerifier(): string {
  return randomBytes(48).toString('base64url')
}

/** S256 code_challenge for the authorization request. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** Opaque CSRF state (64 hex chars). */
export function newState(): string {
  return randomBytes(32).toString('hex')
}

export const OAUTH_STATE_COOKIE = 'scholario_pf_oauth'
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export interface OAuthStatePayload {
  state: string
  verifier: string
  /** 'login' | 'link' */
  purpose: 'login' | 'link'
  /** For purpose=link: the admin the link is bound to. */
  adminId?: string
  exp: number
}

/** Serialize the state payload for the HttpOnly cookie (query format). */
export function encodeOAuthState(payload: OAuthStatePayload): string {
  const q = new URLSearchParams({
    s: payload.state,
    v: payload.verifier,
    p: payload.purpose,
    e: String(payload.exp),
  })
  if (payload.adminId) q.set('a', payload.adminId)
  return q.toString()
}

/** Parse + validate the cookie payload (exp freshness enforced). */
export function decodeOAuthState(cookieValue: string | undefined): OAuthStatePayload | null {
  if (!cookieValue) return null
  try {
    const q = new URLSearchParams(cookieValue)
    const state = q.get('s')
    const verifier = q.get('v')
    const purpose = q.get('p')
    const exp = Number(q.get('e'))
    const adminId = q.get('a') ?? undefined
    if (!state || !verifier || !purpose) return null
    if (purpose !== 'login' && purpose !== 'link') return null
    if (!Number.isFinite(exp) || exp < Date.now()) return null
    if (purpose === 'link' && !adminId) return null
    return { state, verifier, purpose, adminId, exp }
  } catch {
    return null
  }
}

/** Constant-time-ish state comparison (both are 64-hex strings). */
export function stateMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── authorization URL ────────────────────────────────────────────────────

export function googleAuthorizationUrl(opts: {
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const clientId = googleClientId()
  if (!clientId) throw new Error('google oauth not configured')
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    // Select-account: always let the user pick which Google identity —
    // never silently reuse a browser session's default account.
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`
}

// ── code exchange ────────────────────────────────────────────────────────

export interface TokenExchangeResult {
  idToken: string
}

/** Exchange the authorization code for tokens (server-to-server). */
export async function exchangeGoogleCode(opts: {
  code: string
  verifier: string
  redirectUri: string
}): Promise<TokenExchangeResult> {
  const clientId = googleClientId()
  const clientSecret = googleClientSecret()
  if (!clientId || !clientSecret) throw new Error('google oauth not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: opts.code,
        code_verifier: opts.verifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: opts.redirectUri,
      }).toString(),
      signal: controller.signal,
    })
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new Error(`google token endpoint HTTP ${res.status}: ${bodyText.slice(0, 200)}`)
    }
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null
    if (!body || typeof body.id_token !== 'string') {
      throw new Error('google token response missing id_token')
    }
    return { idToken: body.id_token }
  } finally {
    clearTimeout(timer)
  }
}

// ── JWKS fetch + cache ───────────────────────────────────────────────────

export interface Jwk {
  kid?: string
  kty?: string
  alg?: string
  use?: string
  n?: string
  e?: string
}
export interface Jwks {
  keys: Jwk[]
}

let jwksCache: { jwks: Jwks; at: number } | null = null
const JWKS_TTL_MS = 10 * 60 * 1000

/** Fetch (and cache) Google's public signing keys. */
export async function fetchGoogleJwks(): Promise<Jwks> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.jwks
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(GOOGLE_JWKS_URI, { signal: controller.signal })
    if (!res.ok) throw new Error(`google jwks HTTP ${res.status}`)
    const body = (await res.json().catch(() => null)) as Jwks | null
    if (!body || !Array.isArray(body.keys)) throw new Error('google jwks malformed')
    jwksCache = { jwks: body, at: Date.now() }
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** Test seam: reset the JWKS cache. */
export function __resetJwksCache(): void {
  jwksCache = null
}

// ── id_token verification (PURE — the security-critical primitive) ───────

export interface VerifiedGoogleIdentity {
  sub: string
  email: string | null
  emailVerified: boolean
}

export type IdTokenFailure =
  | 'MALFORMED'
  | 'BAD_HEADER'
  | 'UNKNOWN_KID'
  | 'BAD_SIGNATURE'
  | 'BAD_ISSUER'
  | 'BAD_AUDIENCE'
  | 'EXPIRED'
  | 'NO_SUB'
  | 'EMAIL_NOT_VERIFIED'

/** Safe base64url decode (no padding). */
function b64uDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * FULL id_token verification (RFC 7519 + Google OIDC):
 *   1. three dot-separated segments, decodable header/claims
 *   2. header alg=RS256 + kid matching a JWKS key
 *   3. RS256 signature over `${h}.${p}` verified with the JWK
 *      (crypto.createPublicKey JWK import + createVerify)
 *   4. iss ∈ Google's two accepted issuer forms
 *   5. aud === our client id
 *   6. exp not in the past (60s leeway)
 *   7. sub present
 *   8. email_verified true when the claim is present (Google omits it
 *      for some account types; when present it must be true)
 *
 * Pure: no network, no env — callers pass clientId + jwks explicitly
 * so tests can drive every failure branch with their own keypair.
 */
export function verifyIdToken(
  idToken: string,
  jwks: Jwks,
  clientId: string,
  nowMs: number = Date.now(),
): { ok: true; identity: VerifiedGoogleIdentity } | { ok: false; failure: IdTokenFailure } {
  const parts = idToken.split('.')
  if (parts.length !== 3) return { ok: false, failure: 'MALFORMED' }
  const [h, p, s] = parts as [string, string, string]

  let header: { alg?: string; kid?: string }
  let claims: {
    iss?: string
    aud?: string | string[]
    exp?: number
    sub?: string
    email?: string
    email_verified?: boolean
  }
  try {
    header = JSON.parse(b64uDecode(h).toString('utf8'))
    claims = JSON.parse(b64uDecode(p).toString('utf8'))
  } catch {
    return { ok: false, failure: 'MALFORMED' }
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    return { ok: false, failure: 'BAD_HEADER' }
  }

  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA')
  if (!jwk || !jwk.n || !jwk.e) return { ok: false, failure: 'UNKNOWN_KID' }

  try {
    const key = createPublicKey({ key: jwk as { kty: string; n: string; e: string }, format: 'jwk' })
    const signature = b64uDecode(s)
    const verified = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(key, signature)
    if (!verified) return { ok: false, failure: 'BAD_SIGNATURE' }
  } catch {
    return { ok: false, failure: 'BAD_SIGNATURE' }
  }

  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
    return { ok: false, failure: 'BAD_ISSUER' }
  }
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(clientId)
    : claims.aud === clientId
  if (!audOk) return { ok: false, failure: 'BAD_AUDIENCE' }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < nowMs - 60_000) {
    return { ok: false, failure: 'EXPIRED' }
  }
  if (typeof claims.sub !== 'string' || claims.sub.length < 1) {
    return { ok: false, failure: 'NO_SUB' }
  }
  if (claims.email !== undefined && claims.email_verified === false) {
    return { ok: false, failure: 'EMAIL_NOT_VERIFIED' }
  }

  return {
    ok: true,
    identity: {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
      emailVerified: claims.email_verified === true,
    },
  }
}
