'use client'

/**
 * comm-platform-broadcasts — live view of announcements that were really
 * published to the school database (Notification rows) via the compose
 * broadcast flow or the API.
 *
 * Data source: GET /api/announcements (server rows, newest first, includes
 * sender + acknowledgement counts + estimated audience size). This is the
 * authoritative cross-session history — the local demo store only knows
 * about this browser's drafts.
 *
 * Delivery analytics: each row shows a mini delivery-rate bar (acks ÷
 * estimated recipients); the detail modal opens a full acknowledgement feed
 * from GET /api/announcements/[id]/reads — WHO acknowledged and WHEN.
 *
 * UX states: skeleton rows while loading · graceful demo-mode strip when the
 * endpoint is unavailable · empty state · manual refresh · search-aware
 * filtering driven by the parent History search box · optional deep-link
 * auto-open when the command palette points at a notice.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, RefreshCw, CheckCheck, Server, Database, X,
  Megaphone, ShieldAlert, Users, Download, Loader2, TrendingUp, Crown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelativeTime, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

export interface PlatformAnnouncement {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  /** Lifecycle (PHASE 7.5): delivery analytics show PUBLISHED rows only. */
  status?: string
  sender: string
  createdAt: string
  acknowledgedBy: number
  /** Estimated audience size (DB counts) — powers delivery-rate visuals. */
  estimatedRecipients?: number | null
}

export interface AckRead {
  id: string
  name: string
  role: string
  readAt: string
}

// Canonical DB audience tag → human label (mirrors the composer mapping).
export function audienceLabel(a: string): string {
  if (a === 'ALL') return 'Whole School'
  if (a === 'PARENTS') return 'All Parents'
  if (a === 'STUDENTS') return 'All Students'
  if (a === 'TEACHERS') return 'All Teachers'
  if (a === 'STAFF') return 'All Staff'
  if (a.startsWith('CLASS:')) return `Class · ${a.slice(6).trim()}`
  return a
}

function priorityStyle(p: string): string {
  if (p === 'URGENT') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
  if (p === 'HIGH') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
  return 'bg-muted/40 text-muted-foreground border-border'
}

function priorityLabel(p: string): string {
  if (p === 'URGENT') return 'Emergency'
  if (p === 'HIGH') return 'Priority'
  return 'General'
}

// ── Delivery-rate colour semantics (shared by row bars + modal ring) ──
function rateTone(ratePct: number): { bar: string; text: string; stroke: string } {
  if (ratePct >= 75) return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', stroke: '#10b981' }
  if (ratePct >= 40) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', stroke: '#f59e0b' }
  return { bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', stroke: '#f43f5e' }
}

// Deterministic avatar tint per acknowledgee name — same person always gets
// the same hue across sessions.
const AVATAR_TINTS = [
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-stone-500/15 text-stone-700 dark:text-stone-300',
]
function avatarTint(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface Props {
  /** Live search text from the History tab — platform rows filter along. */
  search: string
  /** Bumped whenever a new broadcast is composed, so the list refreshes. */
  refreshSignal?: number
  /** Deep-link request from the command palette (notice result). Carries the
   * palette result id — for live DB records this embeds the Notification id
   * (`ntf-<cuid>`), enabling exact opens; mock notices fall back to title
   * matching with an honest info toast when nothing matches. Cleared via
   * onNoticeConsumed so re-mounts never replay a stale deep-link. */
  focusNotice?: { id: string; title: string; ts: number } | null
  onNoticeConsumed?: () => void
}

export function PlatformBroadcasts({ search, refreshSignal, focusNotice, onNoticeConsumed }: Props) {
  const [rows, setRows] = useState<PlatformAnnouncement[] | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<PlatformAnnouncement | null>(null)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setBusy(true)
    try {
      const r = await fetch('/api/announcements', { cache: 'no-store' })
      if (!r.ok) throw new Error('unavailable')
      const j = await r.json().catch(() => null)
      const data = j && typeof j === 'object' && 'data' in j ? (j as { data?: { announcements?: PlatformAnnouncement[] } }).data : null
      const allRows = Array.isArray(data?.announcements) ? data!.announcements! : []
      // PHASE 7.5 — the staff GET now returns the FULL lifecycle (drafts,
      // scheduled, archived). This panel is DELIVERY analytics: only rows
      // actually published appear here (lifecycle management lives in the
      // Announcements tab).
      setRows(allRows.filter((a) => a.status === undefined || a.status === 'PUBLISHED'))
      setError(false)
    } catch {
      setError(true)
    } finally {
      if (showSpinner) setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshSignal])

  // Notice deep-link consumption — waits for rows to be loaded, then tries
  // to open the matching platform broadcast (exact → substring either way;
  // mock titles sometimes carry a class prefix that DB rows omit or vice
  // versa). No re-fire for the same focus request.
  const handledNoticeTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focusNotice || handledNoticeTs.current === focusNotice.ts || rows === null || error) return
    handledNoticeTs.current = focusNotice.ts
    const t = focusNotice.title.toLowerCase().trim()
    if (!t) return
    const match =
      rows.find((a) => a.title.toLowerCase().trim() === t) ??
      rows.find((a) => a.title.toLowerCase().includes(t) || t.includes(a.title.toLowerCase()))
    if (match) {
      setViewing(match)
      toast(`Opened “${match.title}”`, { description: 'Deep-linked from global search · live platform record' })
      onNoticeConsumed?.()
    } else {
      toast.info(`${focusNotice.title}`, { description: 'No matching platform record yet — history is search-synced below.' })
      onNoticeConsumed?.()
    }
  }, [focusNotice?.ts, focusNotice?.title, rows, error, onNoticeConsumed])

  const q = search.toLowerCase().trim()
  const visible = (rows ?? []).filter((a) =>
    !q || a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q) || a.sender.toLowerCase().includes(q)
  )

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header — always visible so the platform channel is discoverable */}
      <div className="px-3 py-2.5 border-b border-border/60 bg-gradient-to-r from-emerald-500/[0.06] via-transparent to-transparent flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
            <Radio className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-bold tracking-wide">Platform Broadcasts</p>
              {rows && (
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {rows.length}
                </span>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground truncate">Acknowledged records from the school database — visible to every session</p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={busy}
          aria-label="Refresh platform broadcasts"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        </button>
      </div>

      {/* Delivery insights strip — roll-up of the visible broadcasts.
          Shows: total acks, average delivery rate (audience-estimated rows
          only) and the current top-performing broadcast. Updates live with
          the search filter so it doubles as a filtered-set summary. */}
      {!error && rows !== null && rows.length > 0 && (
        <DeliveryInsights rows={visible} totalRows={rows.length} totalAcksAll={rows.reduce((s, a) => s + a.acknowledgedBy, 0)} onOpenTop={setViewing} />
      )}

      {/* Body */}
      {error ? (
        <div className="px-3 py-3 flex items-start gap-2 bg-amber-500/[0.06]">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Platform history unavailable</p>
            <p className="text-[10px] text-muted-foreground">Broadcasts composed in this session are still tracked below in demo mode.</p>
          </div>
        </div>
      ) : rows === null ? (
        /* Skeleton rows */
        <div className="divide-y divide-border/30" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-3 py-2.5 flex items-center gap-3">
              <div className="h-7 w-7 rounded-lg bg-muted animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 rounded bg-muted animate-pulse" style={{ width: `${58 - i * 9}%` }} />
                <div className="h-2 rounded bg-muted/70 animate-pulse" style={{ width: `${80 - i * 12}%` }} />
              </div>
              <div className="h-2.5 w-12 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="px-3 py-5 text-center">
          <Megaphone className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-[11px] font-medium text-muted-foreground">
            {rows.length === 0 ? 'No platform broadcasts yet' : 'No broadcasts match your search'}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {rows.length === 0 ? 'Announcements sent from the Compose tab appear here instantly.' : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/30 max-h-64 overflow-y-auto custom-scrollbar">
          {visible.map((a, i) => {
            // Delivery rate for this broadcast — only shown when we have a
            // real audience estimate; clamped for bar width safety.
            const est = typeof a.estimatedRecipients === 'number' && a.estimatedRecipients > 0 ? a.estimatedRecipients : null
            const ratePct = est ? Math.min(100, Math.round((a.acknowledgedBy / est) * 100)) : null
            const tone = ratePct !== null ? rateTone(ratePct) : null
            return (
              <motion.button
                key={a.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => setViewing(a)}
                className={cn(
                  'w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/25 transition-colors group',
                  /* priority accent strip on the left edge */
                  a.priority === 'URGENT' ? 'border-l-2 border-l-rose-500/70 hover:border-l-rose-500'
                  : a.priority === 'HIGH' ? 'border-l-2 border-l-amber-500/60 hover:border-l-amber-500'
                  : 'border-l-2 border-l-transparent hover:border-l-emerald-500/50'
                )}
              >
                <span className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                  a.priority === 'URGENT' ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                  : a.priority === 'HIGH' ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                )}>
                  <Megaphone className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-semibold truncate group-hover:text-primary transition-colors">{a.title}</p>
                    <span className={cn('shrink-0 px-1 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wide', priorityStyle(a.priority))}>
                      {priorityLabel(a.priority)}
                    </span>
                  </div>
                  <p className="text-[9.5px] text-muted-foreground truncate">{a.message}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-muted-foreground">
                    <span className="truncate">{audienceLabel(a.audience)}</span>
                    <span className="text-border">•</span>
                    <span className="truncate">by {a.sender}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right space-y-1">
                  <div
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/5 text-primary"
                    title={
                      est && ratePct !== null && tone
                        ? `${a.acknowledgedBy} of ~${est} recipients acknowledged · ${ratePct}% delivery rate`
                        : `${a.acknowledgedBy} recipient${a.acknowledgedBy === 1 ? '' : 's'} acknowledged`
                    }
                  >
                    <CheckCheck className="h-3 w-3" />
                    <span className="text-[10px] font-bold tabular-nums">
                      {est ? `${a.acknowledgedBy}/${est}` : a.acknowledgedBy}
                    </span>
                  </div>
                  {/* Mini delivery-rate bar — visual heartbeat of the broadcast */}
                  {est !== null && ratePct !== null && tone && (
                    <div className="ml-auto h-[3px] w-14 rounded-full bg-muted overflow-hidden" aria-hidden>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(4, ratePct)}%` }}
                        transition={{ duration: 0.6, delay: 0.15 + i * 0.03, ease: 'easeOut' }}
                        className={cn('h-full rounded-full', tone.bar)}
                      />
                    </div>
                  )}
                  <p className="text-[9px] text-muted-foreground">{formatRelativeTime(a.createdAt)}</p>
                </div>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Detail modal — with full acknowledgement feed */}
      <AnimatePresence>
        {viewing && (
          <PlatformViewModal announcement={viewing} onClose={() => setViewing(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// Delivery insights strip — aggregated analytics over the visible rows.
// Only audience-estimated rows participate in the rate average; the top
// broadcast is the highest-rate row with at least one ack. Clicking the
// top-broadcast cell opens that broadcast's detail modal.
function DeliveryInsights({ rows, totalRows, totalAcksAll, onOpenTop }: { rows: PlatformAnnouncement[]; totalRows: number; totalAcksAll: number; onOpenTop: (a: PlatformAnnouncement) => void }) {
  const totalAcks = rows.reduce((s, a) => s + a.acknowledgedBy, 0)
  const rated = rows.filter((a) => typeof a.estimatedRecipients === 'number' && a.estimatedRecipients > 0)
  const avgRate = rated.length > 0
    ? Math.round(rated.reduce((s, a) => s + Math.min(100, (a.acknowledgedBy / (a.estimatedRecipients || 1)) * 100), 0) / rated.length)
    : null
  const top = rated
    .filter((a) => a.acknowledgedBy > 0)
    .sort((x, y) => (y.acknowledgedBy / (y.estimatedRecipients || 1)) - (x.acknowledgedBy / (x.estimatedRecipients || 1)))[0]
  const topRate = top ? Math.min(100, Math.round((top.acknowledgedBy / (top.estimatedRecipients || 1)) * 100)) : null
  const tone = avgRate !== null ? rateTone(avgRate) : null
  const filtered = rows.length !== totalRows

  return (
    <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/40 bg-gradient-to-r from-primary/[0.04] via-transparent to-transparent">
      {/* Total acknowledgements */}
      <div className="px-3 py-2 min-w-0">
        <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
          <Users className="h-2.5 w-2.5" /> Acks {filtered && <span className="normal-case font-medium">· filtered</span>}
        </div>
        <motion.p
          key={totalAcks}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm font-bold tabular-nums leading-tight mt-0.5"
        >
          {totalAcks}
          {filtered && <span className="text-[10px] font-medium text-muted-foreground"> of {totalAcksAll}</span>}
        </motion.p>
      </div>
      {/* Average delivery rate */}
      <div className="px-3 py-2 min-w-0">
        <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-2.5 w-2.5" /> Avg Delivery
        </div>
        <p className={cn('text-sm font-bold tabular-nums leading-tight mt-0.5', tone?.text ?? 'text-muted-foreground')}>
          {avgRate !== null ? `${avgRate}%` : '—'}
        </p>
      </div>
      {/* Top-performing broadcast — clickable shortcut into the modal */}
      <div className="px-3 py-2 min-w-0">
        <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
          <Crown className="h-2.5 w-2.5" /> Top Broadcast
        </div>
        {top ? (
          <button
            type="button"
            onClick={() => onOpenTop(top)}
            title={`Open “${top.title}” acknowledgement details`}
            className="text-left w-full mt-0.5 rounded px-0.5 -mx-0.5 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 transition-colors"
          >
            <p className="text-[10px] font-semibold leading-tight truncate">
              <span className={cn('tabular-nums', rateTone(topRate ?? 0).text)}>{topRate}%</span>
              <span className="text-muted-foreground"> · {top.title}</span>
            </p>
          </button>
        ) : (
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">No acks yet</p>
        )}
      </div>
    </div>
  )
}

// SVG progress ring for the modal delivery-rate summary.
function RateRing({ ratePct, tone }: { ratePct: number; tone: { stroke: string } }) {
  const r = 24
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, ratePct))
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label={`${ratePct}% delivery rate`}>
      <circle cx="30" cy="30" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
      <motion.circle
        cx="30" cy="30" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
        stroke={tone.stroke}
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c - (c * clamped) / 100 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        transform="rotate(-90 30 30)"
      />
      <text x="30" y="29" textAnchor="middle" dominantBaseline="middle" className="fill-current text-[13px] font-bold" style={{ fontSize: 13, fontWeight: 700 }}>
        {ratePct}%
      </text>
      <text x="30" y="41" textAnchor="middle" className="fill-current text-muted-foreground" style={{ fontSize: 6 }}>
        DELIVERY RATE
      </text>
    </svg>
  )
}

function PlatformViewModal({ announcement: a, onClose }: { announcement: PlatformAnnouncement; onClose: () => void }) {
  // Escape closes the modal (backdrop click already does).
  useDismissOnEscape(onClose)
  // Acknowledgement feed — fetched once when the modal opens.
  const [reads, setReads] = useState<AckRead[] | null>(null)
  const [readsError, setReadsError] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    setReads(null)
    setReadsError(false)
    fetch(`/api/announcements/${a.id}/reads`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('unavailable')
        return r.json()
      })
      .then((j) => {
        if (!alive) return
        const data = j && typeof j === 'object' && 'data' in j ? j.data : j
        setReads(Array.isArray(data?.reads) ? data.reads : [])
      })
      .catch(() => {
        if (alive) setReadsError(true)
      })
    return () => { alive = false }
  }, [a.id])

  const est = typeof a.estimatedRecipients === 'number' && a.estimatedRecipients > 0 ? a.estimatedRecipients : null
  const ratePct = est ? Math.min(999, Math.round((a.acknowledgedBy / est) * 100)) : null
  const displayRate = ratePct !== null ? Math.min(100, ratePct) : null
  const tone = displayRate !== null ? rateTone(displayRate) : null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={a.title}
      >
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-500/[0.06] to-transparent">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
              <Server className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{a.title}</h3>
              <p className="text-[9px] text-muted-foreground">Delivered on the live event stream</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-7 w-7 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.message}</p>

          {/* Delivery analytics — ring + audience context */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-muted/40 to-transparent p-3 flex items-center gap-4">
            {displayRate !== null && tone ? (
              <>
                <div className={tone.text}>
                  <RateRing ratePct={displayRate} tone={tone} />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-bold flex items-center gap-1.5">
                    <CheckCheck className="h-3.5 w-3.5 text-primary" />
                    <span className="tabular-nums">{a.acknowledgedBy}</span>
                    <span className="font-normal text-muted-foreground">of ~{est} estimated recipients</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Audience: <span className="font-medium text-foreground">{audienceLabel(a.audience)}</span> — recipient count is a live estimate from school enrolment records.
                  </p>
                  {ratePct !== null && ratePct > 100 && (
                    <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Acknowledgements exceed the current enrolment estimate — audience may have shifted since publishing.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="min-w-0 flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-bold tabular-nums">{a.acknowledgedBy} acknowledgement{a.acknowledgedBy === 1 ? '' : 's'}</p>
                  <p className="text-[10px] text-muted-foreground">Audience size unavailable for this record ({audienceLabel(a.audience)}).</p>
                </div>
              </div>
            )}
          </div>

          {/* Acknowledgement feed */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 border-b border-border/60 bg-muted/20 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Acknowledgement Feed</p>
              {reads && !readsError && (
                <span className="text-[9px] text-muted-foreground tabular-nums">{reads.length} read receipt{reads.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {readsError ? (
              <div className="px-3 py-3 flex items-start gap-2 bg-amber-500/[0.06]">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[10.5px] text-muted-foreground">Read receipts unavailable right now — the count above is still live.</p>
              </div>
            ) : reads === null ? (
              <div className="divide-y divide-border/30" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2.5">
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2 rounded bg-muted animate-pulse" style={{ width: `${52 - i * 8}%` }} />
                    </div>
                    <div className="h-2 w-9 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : reads.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <CheckCheck className="h-4 w-4 text-muted-foreground/40 mx-auto mb-1" />
                <p className="text-[11px] font-medium text-muted-foreground">No acknowledgements yet</p>
                <p className="text-[10px] text-muted-foreground/70">Recipients appear here the moment they open this broadcast.</p>
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto custom-scrollbar divide-y divide-border/30">
                {reads.map((r, i) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold', avatarTint(r.name))}>
                      {initials(r.name)}
                    </span>
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <p className="text-[11px] font-medium truncate">{r.name}</p>
                      <span className="shrink-0 px-1 py-px rounded border border-border bg-muted/40 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {r.role}
                      </span>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] text-muted-foreground tabular-nums" title={`Acknowledged ${formatDate(r.readAt)}`}>
                      <CheckCheck className="h-3 w-3 text-emerald-500" />
                      {formatRelativeTime(r.readAt)}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Metadata grid */}
          <div className="rounded-md bg-muted/30 p-2.5 text-[11px] space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Sender</span><span className="font-medium">{a.sender}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Audience</span><span className="font-medium">{audienceLabel(a.audience)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Priority</span><span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase', priorityStyle(a.priority))}>{priorityLabel(a.priority)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Published</span><span className="font-medium">{formatDate(a.createdAt)}</span></div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">DB record</span>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground truncate max-w-[12rem]" title={a.id}>
                <Database className="h-3 w-3 shrink-0" /> {a.id}
              </span>
            </div>
          </div>

          <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2 text-[11px] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-emerald-700 dark:text-emerald-300 font-medium">Live platform record — persisted across sessions and pushed to every connected dashboard.</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between gap-2">
          {/* Export — CSV acknowledgement report (raw Response endpoint,
              blob → object URL download, payments-export pattern). */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={exporting}
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try {
                const r = await fetch(`/api/announcements/${a.id}/reads/export`, { cache: 'no-store' })
                if (!r.ok) throw new Error('unavailable')
                const blob = await r.blob()
                const dispo = r.headers.get('Content-Disposition') ?? ''
                const match = dispo.match(/filename="?([^";]+)"?/)
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = match?.[1] ?? `ack-report-${a.id}.csv`
                document.body.appendChild(link)
                link.click()
                link.remove()
                URL.revokeObjectURL(url)
                toast.success('Acknowledgement report downloaded', { description: `${reads?.length ?? 0} read receipts exported as CSV` })
              } catch {
                toast.error('Export failed', { description: 'The report could not be generated right now.' })
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export CSV
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
