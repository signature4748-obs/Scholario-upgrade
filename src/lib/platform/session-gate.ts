/**
 * Session-gate classification for GET /api/platform/auth/me results.
 *
 * WHY (2026-10-16 Stage B hardening — regression: "stuck skeleton"): the
 * console shell used to render its boot skeleton whenever `me` was null,
 * and a 5xx from auth/me (database down, control-plane failure) resolved
 * neither to a session nor to a 401 redirect — so operators saw an
 * unlabelled pulsing skeleton forever with no retry. The gate must
 * classify every outcome explicitly:
 *
 *   · 401                       → unauthenticated → redirect to login
 *   · 2xx + ok envelope         → authenticated
 *   · anything else (5xx, broken
 *     envelope, network error*) → unavailable — the control plane cannot
 *                                 serve the session RIGHT NOW; the shell
 *     renders an explicit, retryable error state (never a bare skeleton,
 *     never a fabricated empty state).
 *
 * (* network exceptions have no status: the caller passes 0.)
 *
 * Pure function — server and client importable, unit-tested in
 * tests/unit/platform-session-gate.test.ts.
 */
export type AuthMeOutcome = 'authenticated' | 'unauthenticated' | 'unavailable'

export function classifyAuthMe(status: number, envelopeOk: boolean): AuthMeOutcome {
  if (status === 401) return 'unauthenticated'
  if (status >= 200 && status < 300 && envelopeOk) return 'authenticated'
  return 'unavailable'
}
