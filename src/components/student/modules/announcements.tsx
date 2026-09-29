'use client'

/**
 * LR-1 — AnnouncementsModule (Notices · Announcements tab).
 *
 * REBUILT off static mock data onto the REAL school announcements feed
 * (GET /api/student/notices — Notification rows published by the school,
 * audience-scoped, per-user read state). Per the Scholario no-duplicate-
 * module-title rule there is NO big "Announcements" heading — the Notices
 * tab bar above already says where you are; this tab opens straight into
 * a scannable premium feed:
 *
 *   [All] [Unread] [Important]                    5 notices
 *   ─────────────────────────────────────────────────────
 *   ● Robotics Workshop Registration — open   [Important]
 *     Class 9 · Dr. Ananya Iyer · 2 Sep
 *     The school has published "Robotics Workshop…
 *
 * Every row: unread dot, title, audience chip (category), publisher,
 * date, priority, expandable details. Opening a row marks it read
 * (server-persisted NotificationRead — survives reloads).
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ChevronDown, RotateCcw, Megaphone, CheckCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useServerNotices, type ServerNotice } from '@/lib/store/server-notices-store'
import { formatDate } from '@/lib/format'

// ─── Filters ─────────────────────────────────────────────────────────

type FilterKey = 'all' | 'unread' | 'important'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'important', label: 'Important' },
]

function isImportant(n: ServerNotice): boolean {
  return n.priority === 'HIGH' || n.priority === 'URGENT'
}

// ─── Module ──────────────────────────────────────────────────────────

export function AnnouncementsModule() {
  const notices = useServerNotices((s) => s.notices)
  const _loading = useServerNotices((s) => s.loading)
  const error = useServerNotices((s) => s.error)
  const refresh = useServerNotices((s) => s.refresh)

  const [filter, setFilter] = useState<FilterKey>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Freshness on mount (the panel hydrate already warmed the cache).
  useEffect(() => {
    if (useServerNotices.getState().notices === null || useServerNotices.getState().error) {
      void refresh()
    }
  }, [refresh])

  const unreadCount = useMemo(() => (notices ?? []).filter((n) => !n.read).length, [notices])

  const filtered = useMemo(() => {
    if (!notices) return []
    switch (filter) {
      case 'unread': return notices.filter((n) => !n.read)
      case 'important': return notices.filter(isImportant)
      default: return notices
    }
  }, [notices, filter])

  // ── States: error → skeleton → empty → feed ───────────────────────
  if (error && !notices) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Something went wrong</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            We couldn&apos;t load your announcements right now.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
        </Button>
      </div>
    )
  }

  if (!notices) {
    // Skeleton matches the final feed layout (toolbar + rows).
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading announcements">
        <div className="flex items-center gap-2">
          {FILTERS.map((f) => <Skeleton key={f.key} className="h-7 w-16 rounded-full" />)}
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
        <div className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5">
              <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Compact toolbar — filters + honest count (no module title) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-0.5"
          role="group"
          aria-label="Announcement filters"
        >
          {FILTERS.map((f) => {
            const count =
              f.key === 'unread' ? unreadCount
              : f.key === 'important' ? notices.filter(isImportant).length
              : notices.length
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  filter === f.key
                    ? 'bg-background shadow-2xs text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                <span className={cn(
                  'ml-1.5 text-[10px] tabular-nums',
                  filter === f.key ? 'text-muted-foreground' : 'text-muted-foreground/60',
                )}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        {unreadCount > 0 && (
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {unreadCount} unread
          </span>
        )}
      </div>

      {/* ── The feed ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border bg-card/50 px-4 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
            <Megaphone className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-foreground">
            {filter === 'unread' ? 'You&apos;re all caught up' : 'No announcements yet'}
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {filter === 'unread'
              ? 'Every announcement has been read.'
              : filter === 'important'
                ? 'Nothing marked important right now.'
                : 'Your school&apos;s announcements will appear here.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
          {filtered.map((n, i) => (
            <NoticeRow
              key={n.id}
              notice={n}
              index={i}
              expanded={expandedId === n.id}
              onToggle={() => {
                const next = expandedId === n.id ? null : n.id
                setExpandedId(next)
                // Opening a row acknowledges it (server-persisted).
                if (next && !n.read) void useServerNotices.getState().markRead(n.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── One feed row ────────────────────────────────────────────────────

function NoticeRow({
  notice, index, expanded, onToggle,
}: {
  notice: ServerNotice
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const important = isImportant(notice)
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.2) }}
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors',
        !notice.read ? 'bg-primary/[0.025]' : 'bg-transparent',
        'hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
      )}
    >
      {/* Unread indicator — a quiet dot, only when unread */}
      <span className="mt-[7px] flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
        {!notice.read && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn(
            'truncate text-sm',
            notice.read ? 'font-medium text-foreground/90' : 'font-semibold text-foreground',
          )}>
            {notice.title}
          </span>
          {important && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" aria-hidden /> Important
            </span>
          )}
        </span>

        {/* Preview (clamped) or full details when expanded */}
        <span className={cn(
          'mt-0.5 block text-xs leading-relaxed text-muted-foreground',
          expanded ? '' : 'line-clamp-1',
        )}>
          {notice.message}
        </span>

        {/* Meta: category · publisher · date */}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {notice.audience}
          </span>
          <span className="truncate">{notice.sender}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDate(notice.createdAt)}</span>
          {notice.read && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                <CheckCheck className="h-3 w-3" aria-hidden /> Read
              </span>
            </>
          )}
        </span>
      </span>

      <ChevronDown
        className={cn(
          'mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200',
          expanded && 'rotate-180',
        )}
        aria-hidden
      />
    </motion.button>
  )
}
