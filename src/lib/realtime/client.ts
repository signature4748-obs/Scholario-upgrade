'use client'

/**
 * PHASE 8B — CLIENT-SIDE REALTIME BRIDGE (Supabase Realtime broadcast).
 *
 * Replaces the app's dependency on the long-running socket.io
 * mini-service (mini-services/event-stream — still available as the
 * DEV-ONLY `event-stream` fallback) with a stateless, Vercel-/
 * serverless-compatible transport:
 *
 *   1. `getRealtimeConfig()` fetches /api/realtime/config (session cookie
 *      / Bearer) ONCE per identity, cached in-module with a 60s TTL and
 *      invalidated on 401 — the server hands the user their capability
 *      channel names after full authentication.
 *   2. `startRealtimeBridge()` dynamically imports @supabase/realtime-js,
 *      connects ONE RealtimeClient (public anon key — channels are the
 *      secret, not the key) and subscribes to every issued channel.
 *      Incoming broadcasts are mapped 1:1 onto the EXACT `school-event`
 *      frame shape the Phase-8A socket handlers + live-feed-store
 *      already consume (kind → title/detail/amount/method/at), so every
 *      existing consumer (bell, toasts, Live Activity ticker,
 *      timetableVersion) keeps working unchanged.
 *   3. Dedupe: a bounded FIFO set (cap 500) of payload ids absorbs
 *      duplicate/replayed broadcasts before dispatch.
 *   4. Reconnect: realtime-js's own channel rejoin (no custom reconnect
 *      storms). `stop()` removes the channels and closes the client —
 *      wired to the shell's auth-change effect cleanup exactly like the
 *      old socket.close().
 *
 * Realtime remains an OPTIONAL notification layer: the database is the
 * source of truth, every surface works without events, and no
 * authorization ever rides on this channel (all authorization is
 * enforced server-side on every request).
 */

import type {
  RealtimeChannel as RealtimeChannelT,
  RealtimeClient as RealtimeClientT,
} from '@supabase/realtime-js'

export type RealtimeMode = 'supabase' | 'event-stream' | 'disabled'

export interface RealtimeConfig {
  mode: RealtimeMode
  /** Supabase project origin (supabase mode only). */
  url?: string
  /** PUBLIC publishable key (supabase mode only). */
  anonKey?: string
  /** Capability channel names issued by the server (supabase mode only). */
  channels?: string[]
}

/**
 * Frame delivered to the shell — byte-compatible with the Phase-8A
 * socket.io `school-event` frames (mini-services/event-stream) the
 * live-feed-store and the app-shell dispatch already consume.
 */
export interface StreamEvent {
  kind: 'payment' | 'announcement' | 'message' | 'timetable'
  schoolId: string
  title: string
  detail: string
  /** payment events: rupee amount */
  amount?: number
  /** payment events: raw channel code (UPI/CARD/…) */
  method?: string
  /** message events: User.id of the addressee (recipient-side filter) */
  recipientId?: string | null
  /** UTC ISO timestamp of the underlying DB write */
  at: string
}

export interface RealtimeBridgeHandle {
  /** Removes every channel and closes the client (auth-change cleanup). */
  stop: () => void
}

/**
 * Stop a bridge returned by startRealtimeBridge — removes its channels
 * and closes the client. (Auth-change / logout cleanup entry point.)
 */
export function stopRealtimeBridge(handle: RealtimeBridgeHandle): void {
  handle.stop()
}

// ─── config fetch (identity-keyed, TTL cache, 401-invalidated) ──────────

const CONFIG_TTL_MS = 60_000

let configCache: { key: string; value: RealtimeConfig; at: number } | null = null

/** Drop the cached transport config (logout / forced refetch). */
export function invalidateRealtimeConfig(): void {
  configCache = null
}

/**
 * Fetch /api/realtime/config with session credentials. Cached in-module
 * for ~60s, keyed by the caller's identity (auth-store user id) so a
 * logout → tenant-switch can never be served the previous tenant's
 * channel names. A 401 invalidates the cache and answers `disabled`.
 * Never throws — failures degrade to `disabled` (realtime is optional).
 */
export async function getRealtimeConfig(cacheKey?: string): Promise<RealtimeConfig> {
  const key = cacheKey ?? 'anon'
  if (configCache && configCache.key === key && Date.now() - configCache.at < CONFIG_TTL_MS) {
    return configCache.value
  }
  try {
    const res = await fetch('/api/realtime/config', {
      credentials: 'include',
      cache: 'no-store',
    })
    if (res.status === 401) {
      configCache = null
      return { mode: 'disabled' }
    }
    if (!res.ok) return { mode: 'disabled' }
    const json = (await res.json().catch(() => null)) as { data?: RealtimeConfig } | null
    const data = json?.data
    if (
      !data ||
      (data.mode !== 'supabase' && data.mode !== 'event-stream' && data.mode !== 'disabled')
    ) {
      return { mode: 'disabled' }
    }
    configCache = { key, value: data, at: Date.now() }
    return data
  } catch {
    return { mode: 'disabled' }
  }
}

// ─── broadcast payload → legacy `school-event` frame mapping ────────────
//
// Server payloads (src/lib/realtime/publish.ts) are notification SIGNALS:
// { kind, id, at, ...kind-specific hints }. The mapper replicates the
// EXACT frame the retired event-stream service emitted for the same DB
// write (mini-services/event-stream/index.ts), so the shell's handlers
// and live-feed-store see byte-identical frames from either transport.

type BroadcastPayload = { [key: string]: unknown }

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v ? v : fallback)

/** 'salary' and future kinds have no legacy frame consumer — mapped to null. */
export function mapBroadcastToFrame(p: BroadcastPayload): StreamEvent | null {
  const at = typeof p.at === 'string' && p.at ? p.at : new Date().toISOString()
  const schoolId = str(p.schoolId)
  switch (p.kind) {
    case 'fee-payment': {
      const amount = typeof p.amount === 'number' ? p.amount : Number(p.amount)
      return {
        kind: 'payment',
        schoolId,
        // Same literal title the event-stream service emitted for
        // Payment status SUCCESS rows.
        title: 'Fee payment received',
        detail: `${str(p.student, 'Student')} · ${str(p.feeTitle, 'Fee')}`,
        ...(Number.isFinite(amount) ? { amount } : {}),
        ...(p.method != null ? { method: str(p.method) } : {}),
        at,
      }
    }
    case 'announcement':
      return {
        kind: 'announcement',
        schoolId,
        title: str(p.title, 'Announcement'),
        detail: str(p.detail),
        at,
      }
    case 'message': {
      const preview = str(p.preview)
      const senderName = str(p.senderName)
      return {
        kind: 'message',
        schoolId,
        title: str(p.title) || str(p.subject) || 'New message',
        detail:
          str(p.detail) ||
          (senderName && preview ? `From ${senderName} · ${preview}` : preview),
        ...(p.recipientId != null ? { recipientId: str(p.recipientId) } : { recipientId: null }),
        at,
      }
    }
    case 'timetable':
      return {
        kind: 'timetable',
        schoolId,
        title: 'Timetable updated',
        detail: str(p.detail, 'New schedule published') + (p.actor ? ` · by ${str(p.actor)}` : ''),
        at,
      }
    default:
      return null
  }
}

// ─── window hints for store modules ─────────────────────────────────────
//
// 'scholario:realtime-message' is the documented contract the messaging
// stores listen for (src/lib/store/messaging-sync.ts — a refetch hint,
// harmless if the tab never opened a thread). 'scholario:realtime-salary'
// is the same pattern for the payroll surfaces (no consumer yet).

function dispatchWindowHint(name: string): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(name))
  } catch {
    // dispatchEvent never throws in practice — defensive only.
  }
}

// ─── bridge lifecycle ───────────────────────────────────────────────────

const DEDUPE_CAP = 500

export interface StartRealtimeBridgeOptions {
  url: string
  anonKey: string
  channels: string[]
  /** Every mapped legacy frame (one per broadcast payload). */
  onFrame: (frame: StreamEvent) => void
  /** Live indicator: true while ≥1 channel is SUBSCRIBED. */
  onStatus?: (live: boolean) => void
}

/**
 * Start the Supabase Realtime broadcast bridge. Synchronous start, async
 * internals: `stop()` may be called before the dynamic import resolves.
 *
 * Graceful reconnect: realtime-js rejoins channels itself (rejoinTimer
 * with stepped backoff); this bridge adds NO custom reconnect logic.
 */
export function startRealtimeBridge(opts: StartRealtimeBridgeOptions): RealtimeBridgeHandle {
  let stopped = false
  let client: RealtimeClientT | null = null
  const subscribedTopics = new Set<string>()
  // Bounded FIFO dedupe of payload ids (replays / duplicate joins).
  const seenIds = new Set<string>()

  const emitStatus = (): void => {
    opts.onStatus?.(subscribedTopics.size > 0)
  }

  const acceptPayload = (topic: string, payload: unknown): void => {
    if (stopped || payload == null || typeof payload !== 'object') return
    const p = payload as BroadcastPayload
    // Store-facing hints fire for kinds with a refetch contract, even
    // when no legacy frame exists ('salary').
    if (p.kind === 'message') dispatchWindowHint('scholario:realtime-message')
    if (p.kind === 'salary') dispatchWindowHint('scholario:realtime-salary')
    const frame = mapBroadcastToFrame(p)
    if (!frame) return
    const id = typeof p.id === 'string' && p.id ? p.id : null
    const dedupeKey = id ? `${topic}:${id}` : `${topic}:${JSON.stringify(p)}`
    if (seenIds.has(dedupeKey)) return
    seenIds.add(dedupeKey)
    if (seenIds.size > DEDUPE_CAP) {
      // Drop the oldest half — insertion-ordered Set = FIFO.
      const it = seenIds.values()
      const drop = Math.floor(DEDUPE_CAP / 2)
      for (let i = 0; i < drop; i++) {
        const v = it.next().value
        if (v === undefined) break
        seenIds.delete(v)
      }
    }
    opts.onFrame(frame)
  }

  void (async () => {
    try {
      // Dynamic import keeps realtime-js out of the initial bundle.
      const { RealtimeClient } = await import('@supabase/realtime-js')
      if (stopped) return
      const endpoint = `${opts.url.replace(/^http/, 'ws')}/realtime/v1`
      client = new RealtimeClient(endpoint, {
        params: { apikey: opts.anonKey },
        logLevel: 'warn',
      })
      for (const topic of opts.channels) {
        // Topic-format note (Phase 8C-N, verified against the live Supabase
        // Realtime service): realtime-js AUTO-PREFIXES the topic with
        // `realtime:` when it creates the phoenix channel, so the RAW
        // capability name (`t:…`/`u:…`) is the correct input here — the
        // server joins `realtime:t:…`. The server-side REST publisher
        // (publish.ts) keys its broadcast messages by the same raw subtopic,
        // and the server pushes deliveries on the full `realtime:`-prefixed
        // topic. (Do NOT pre-prefix here: that produces a double-prefixed
        // join channel which silently misses the server's deliveries.)
        // broadcast.self=false: a client never receives its own sends —
        // only server-side (REST) publishes reach this subscription.
        const ch: RealtimeChannelT = client.channel(topic, {
          config: { broadcast: { self: false } },
        })
        ch.on('broadcast', { event: '*' }, (message: unknown) => {
          acceptPayload(topic, (message as { payload?: unknown })?.payload)
        })
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') subscribedTopics.add(topic)
          else subscribedTopics.delete(topic)
          emitStatus()
        })
      }
    } catch {
      // Dynamic import / client construction failure — degrade silently
      // (polling surfaces still cover every consumer).
      subscribedTopics.clear()
      emitStatus()
    }
  })()

  return {
    stop() {
      if (stopped) return
      stopped = true
      const c = client
      client = null
      subscribedTopics.clear()
      seenIds.clear()
      emitStatus() // mirrors socket 'disconnect' → live indicator off
      if (c) {
        for (const ch of c.getChannels()) {
          void c.removeChannel(ch).catch(() => {})
        }
        void c.disconnect().catch(() => {})
      }
    },
  } satisfies RealtimeBridgeHandle
}
