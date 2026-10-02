/**
 * PHASE 8B — Realtime capability channels (server-side derivation).
 *
 * Security model (see src/lib/realtime/mode.ts):
 * channel names are CAPABILITIES. A channel name embeds an HMAC signature
 * derived from REALTIME_CHANNEL_SECRET (server-only). The server hands a
 * user their allowed channel names only after full session+tenant
 * authentication (/api/realtime/config). Possession of the name is what
 * grants subscription; the signature makes cross-tenant (and
 * cross-audience) channel names unguessable.
 *
 * Event payloads deliberately carry NOTIFICATION SIGNALS (ids, counts,
 * "refresh" hints) — never row data — so a hypothetical future channel
 * leak cannot expose tenant content. Clients refetch through the
 * authorized APIs on every event.
 */

import { createHmac } from 'crypto'

const SIG_LENGTH = 16 // hex chars of the HMAC used in the channel name

function channelSecret(): string {
  // Stable across invocations: REALTIME_CHANNEL_SECRET is provisioned by
  // the environment (Vercel encrypted env / local .env). A random
  // per-process fallback would break signed-URL persistence across
  // instances, so we fail loud-and-early instead of silently degrading.
  const secret = process.env.REALTIME_CHANNEL_SECRET
  if (!secret || secret.length < 16) {
    throw new Error(
      'REALTIME_CHANNEL_SECRET must be set (>=16 chars) to derive realtime channels',
    )
  }
  return secret
}

function signature(payload: string): string {
  return createHmac('sha256', channelSecret()).update(payload).digest('hex').slice(0, SIG_LENGTH)
}

export type ChannelAudience = 'all' | 'staff' | 'user'

/**
 * School-scoped broadcast channel for an audience.
 *  - `all`: every authenticated member of the tenant
 *  - `staff`: PRINCIPAL / MANAGEMENT (and platform oversight) only
 */
export function schoolChannel(schoolId: string, audience: 'all' | 'staff'): string {
  return `t:${schoolId}:${audience}:${signature(`school:${schoolId}:${audience}`)}`
}

/** User-targeted channel — notifications for one recipient. */
export function userChannel(schoolId: string, userId: string): string {
  return `u:${schoolId}:${userId.slice(-8)}:${signature(`user:${schoolId}:${userId}`)}`
}

/**
 * Channels the given authenticated user is allowed to subscribe to.
 * Mirrors the room model of the retired event-stream service:
 * students → tenant-wide channel only; teachers → +staff; principal /
 * management → +staff (same as staff).
 *
 * Platform admins (and any identity without a tenant scope) get NO
 * channels: the Supabase capability model has no platform-wide broadcast
 * (nothing publishes to one), so an honest empty list is issued — their
 * notification surface stays the 60s polling feed.
 */
export function channelsForUser(role: string, schoolId: string, userId: string): string[] {
  if (role === 'SUPER_ADMIN' || !schoolId) return []
  const channels = [schoolChannel(schoolId, 'all'), userChannel(schoolId, userId)]
  if (role === 'PRINCIPAL' || role === 'MANAGEMENT' || role === 'TEACHER') {
    channels.push(schoolChannel(schoolId, 'staff'))
  }
  return channels
}
