import { withUser } from '@/lib/api'
import { channelsForUser } from '@/lib/realtime/channels'
import { realtimeMode } from '@/lib/realtime/mode'

export const runtime = 'nodejs'

/**
 * GET /api/realtime/config — the CLIENT bootstrap for the Phase-8B
 * realtime transport (the socket.io replacement on Vercel/serverless).
 *
 * After full session + tenant authentication (withUser — including the
 * PHASE 7.5 school-access policy), the route answers with the transport
 * decision and, ONLY in `supabase` mode, the connection material:
 *
 *   {
 *     mode: 'supabase',
 *     url: SUPABASE_URL,          // https://<project>.supabase.co
 *     anonKey: SUPABASE_ANON_KEY, // PUBLIC publishable key (safe on the
 *                                 // client by design — channels are the
 *                                 // secret, not the key)
 *     channels: channelsForUser(role, schoolId, userId)
 *   }
 *
 * Channel names are CAPABILITIES (HMAC-signed with
 * REALTIME_CHANNEL_SECRET — see src/lib/realtime/channels.ts): they are
 * issued per authenticated identity and never guessable across tenants,
 * audiences or users. Payloads carried on them are notification SIGNALS
 * (ids/counts/short labels), never row data.
 *
 * Non-supabase modes answer `{ mode }` ONLY — the dev-only `event-stream`
 * fallback needs no configuration (the client keeps its legacy
 * /?XTransformPort=3003 URL) and `disabled` must never leak channel
 * names or keys.
 *
 * Envelope: the standard api() { ok, data } contract with Cache-Control:
 * no-store (per-request, session-scoped data — never cached).
 */
export async function GET() {
  return withUser(async (user) => {
    const mode = realtimeMode()
    if (mode !== 'supabase') {
      // event-stream (client uses its legacy URL) / disabled — no
      // channels, no keys.
      return { mode }
    }
    return {
      mode,
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      channels: channelsForUser(user.role, user.schoolId ?? '', user.id),
    }
  })
}
