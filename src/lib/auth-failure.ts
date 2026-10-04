/**
 * Client-side authentication failure model (AUTH STABILIZATION GATE).
 *
 * WHY THIS EXISTS: the login forms previously surfaced raw `Error.message`
 * strings. When `fetch` itself rejects (offline, DNS failure, proxy/VPN
 * drop, request blocked by the browser), the message is the BROWSER'S
 * implementation detail — "Load failed" (WebKit) / "Failed to fetch"
 * (Chromium) — which told the user nothing and told support nothing.
 *
 * Two failure families, never conflated:
 *
 *  1. SERVER REJECTION — the API responded with the canonical envelope
 *     `{ ok: false, error, code, requestId }`:
 *       · `error`      guaranteed-safe public message (server classifier)
 *       · `code`       stable AppErrorCode (AUTH_REQUIRED, ACCOUNT_LOCKED,
 *                      RATE_LIMITED, SCHOOL_SUSPENDED, MFA_*, …)
 *       · `requestId`  correlation id — also the X-Request-Id response
 *                      header; quoting it finds the request's server log
 *                      lines and audit rows. Safe to display (opaque id).
 *
 *  2. TRANSPORT FAILURE — no response existed. Classified locally as
 *     AUTH_NETWORK_UNAVAILABLE with an actionable message. No code or
 *     ref can exist (the server was never reached); never invent one.
 *
 * Never rendered here or anywhere: passwords, TOTP secrets, session
 * tokens, stack traces, or the raw browser error string.
 */

export class AuthFailure extends Error {
  readonly code?: string
  readonly requestId?: string

  constructor(message: string, code?: string, requestId?: string) {
    super(message)
    this.name = 'AuthFailure'
    this.code = code
    this.requestId = requestId
  }
}

/** Parse a failed auth response body into the safe failure model. */
export function authFailureFromEnvelope(
  status: number,
  body: { ok?: boolean; error?: string; code?: string; requestId?: string } | null,
  fallbackMessage: string,
): AuthFailure {
  return new AuthFailure(
    body?.error || fallbackMessage,
    body?.code || (status === 401 ? 'AUTH_REQUIRED' : undefined),
    body?.requestId,
  )
}

/**
 * Classify anything thrown during an auth fetch. `AuthFailure` passes
 * through; every other throwable (fetch TypeError, AbortError, JSON
 * parse, …) is a transport-level failure — the raw message is noise.
 */
export function classifyAuthFetchError(e: unknown, fallbackMessage?: string): AuthFailure {
  if (e instanceof AuthFailure) return e
  return new AuthFailure(
    fallbackMessage ??
      'Could not reach the sign-in service. Check your connection and try again in a moment.',
    'AUTH_NETWORK_UNAVAILABLE',
  )
}

/** Short human ref for support: `AUTH_ACCOUNT_LOCKED · ref a1b2c3d4`. */
export function authFailureRefLine(f: AuthFailure): string | null {
  const parts: string[] = []
  if (f.code) parts.push(f.code)
  if (f.requestId) parts.push(`ref ${f.requestId.slice(0, 8)}`)
  return parts.length ? parts.join(' · ') : null
}
