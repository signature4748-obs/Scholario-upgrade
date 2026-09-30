'use client'

/**
 * LiveActivityTicker — realtime stream surface for the Principal dashboard.
 *
 * QA-R6 brought the socket.io event stream (:3003) live — but its only
 * dashboard-visible footprint was a transient toast. This card gives the
 * stream a PERMANENT home: payments, announcements and direct messages
 * arrive as animated rows that stay for the session.
 *
 * Data source: `live-feed-store` (mirrored frames from the AppShell's
 * single socket connection — no second subscription is opened here).
 * Relative timestamps tick every 30s. When the socket is down the card
 * degrades honestly ("Reconnecting…") instead of pretending.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { IndianRupee, Mail, Megaphone, Radio, CalendarCheck } from 'lucide-react'
import { Panel } from '../shared/panel'
import { useLiveFeedStore, type LiveFeedEvent } from '@/lib/store/live-feed-store'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'

const MAX_ROWS = 6

// Compact relative age ("now" → "42s" → "3m" → "14m", caps at 59m)
function relativeAge(seenAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - seenAt) / 1000))
  if (s < 10) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return '59m+'
}

const KIND_META: Record<LiveFeedEvent['kind'], { icon: typeof IndianRupee; tone: string; label: string }> = {
  payment: {
    icon: IndianRupee,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
    label: 'Payment',
  },
  announcement: {
    icon: Megaphone,
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/20',
    label: 'Notice',
  },
  message: {
    icon: Mail,
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20',
    label: 'Message',
  },
  timetable: {
    icon: CalendarCheck,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
    label: 'Timetable',
  },
}

export function LiveActivityTicker() {
  const events = useLiveFeedStore((s) => s.events)
  const connected = useLiveFeedStore((s) => s.connected)

  // Ticking clock for relative timestamps (30s cadence — cheap + smooth
  // enough for "now → 30s" transitions without a per-second re-render).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const rows = events.slice(0, MAX_ROWS)
  const overflow = Math.max(0, events.length - MAX_ROWS)

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          Live Activity
          {connected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
              <Radio className="h-2.5 w-2.5 animate-pulse" aria-hidden="true" /> Reconnecting
            </span>
          )}
        </span>
      }
      subtitle="Payments, notices and messages as they happen — streamed in realtime"
      bodyClassName="p-2.5"
    >
      <div className="max-h-64 overflow-y-auto" role="feed" aria-label="Live activity stream">
        {rows.length > 0 ? (
          <AnimatePresence initial={false}>
            {rows.map((e) => (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/40"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1',
                    KIND_META[e.kind].tone,
                  )}
                >
                  <RowIcon kind={e.kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-semibold leading-tight">{e.title}</p>
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">{e.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  {e.kind === 'payment' && e.amount != null && (
                    <p className="text-[11.5px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatINR(e.amount)}
                    </p>
                  )}
                  <p className="text-[9.5px] tabular-nums text-muted-foreground" aria-label="event age">
                    {relativeAge(e.seenAt, now)}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex items-center gap-3 px-2 py-4">
            {/* Radar pulse — idle state that promises life without faking it */}
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
              <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20" />
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Radio className="h-3.5 w-3.5" />
              </span>
            </span>
            <div>
              <p className="text-xs font-medium">Waiting for live events…</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Fee payments, notices and messages will appear here the moment they happen.
              </p>
            </div>
          </div>
        )}
        {overflow > 0 && rows.length > 0 && (
          <p className="px-2 pb-1 pt-1.5 text-[9.5px] text-muted-foreground">+{overflow} earlier this session</p>
        )}
      </div>
    </Panel>
  )
}

// Message rows carry Mail, not Megaphone (kept out of KIND_META to avoid a
// second import alias in the map above).
function RowIcon({ kind }: { kind: LiveFeedEvent['kind'] }) {
  const Ico = KIND_META[kind].icon
  return <Ico className="h-3.5 w-3.5" />
}
