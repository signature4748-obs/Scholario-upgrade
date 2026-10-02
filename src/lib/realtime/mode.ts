/**
 * PHASE 8B — Realtime mode configuration.
 *
 * Two transports exist:
 *
 *  1. `supabase` (default, Vercel-compatible) — Supabase Realtime
 *     broadcast channels. Clients subscribe with the PUBLIC anon key to
 *     capability-named channels (`t:<schoolId>:<audience>:<sig>`); the
 *     server publishes through the Realtime REST broadcast endpoint with
 *     the SERVICE-ROLE key (src/lib/realtime/publish.ts). Channel names
 *     embed an HMAC derived from REALTIME_CHANNEL_SECRET, so membership
 *     is a capability: only authenticated members of a tenant can learn
 *     their tenant's channel names (issued server-side via
 *     /api/realtime/config), and cross-tenant subscription requires
 *     guessing an unguessable signature.
 *
 *  2. `event-stream` (DEV-ONLY fallback) — the Phase-8A socket.io
 *     mini-service on port 3003 with its 4s PostgreSQL poller. Kept for
 *     local sandbox development; it requires a long-running process and
 *     the Caddy XTransformPort gateway and is NEVER used when
 *     REALTIME_MODE=supabase (the Vercel deployment).
 *
 * Realtime is an OPTIONAL notification layer in both modes: the database
 * stays the single source of truth, every surface works without it, and
 * realtime is never an authorization mechanism (all authorization is
 * enforced server-side on every request).
 */

export type RealtimeMode = 'supabase' | 'event-stream' | 'disabled'

export function realtimeMode(): RealtimeMode {
  const raw = process.env.REALTIME_MODE?.trim().toLowerCase()
  if (raw === 'supabase' || raw === 'event-stream' || raw === 'disabled') {
    return raw
  }
  // Default: Supabase Realtime whenever the Supabase platform env is
  // present; otherwise disabled (local dev without Supabase env, or
  // event-stream explicitly configured via .env).
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return 'supabase'
  }
  return 'disabled'
}

/** Server can publish only when the service key is configured. */
export function realtimePublishEnabled(): boolean {
  return (
    realtimeMode() === 'supabase' &&
    Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}
