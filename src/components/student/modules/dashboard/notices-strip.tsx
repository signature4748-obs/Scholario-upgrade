'use client'

/**
 * NoticesStrip (SD-3 · PHASE 10) — a compact preview of the latest
 * school announcements (REAL Notification rows, audience-scoped, with
 * per-user read state — the same source the Notices module reads).
 * Three latest; unread/important rows get restrained visual priority.
 */

import { motion } from 'framer-motion'
import { Megaphone, ArrowUpRight, BellDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardData } from './types'

export function NoticesStrip({ data, onNavigate }: {
  data: DashboardData
  onNavigate: (key: string) => void
}) {
  const notices = data.notices.latest
  if (notices.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label="School notices"
      className="flex flex-col rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold tracking-tight">School Notices</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {data.notices.unreadCount > 0
                ? `${data.notices.unreadCount} unread announcement${data.notices.unreadCount === 1 ? '' : 's'}`
                : 'You are all caught up'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('announcements')}
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          View all <ArrowUpRight className="h-3 w-3" aria-hidden />
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {notices.map((n, i) => {
          const important = n.priority === 'HIGH' || n.priority === 'URGENT'
          return (
            <motion.li
              key={n.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 + i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => onNavigate('announcements')}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !n.read && 'border-primary/25 bg-primary/[0.03]',
                  n.read && 'border-border/70 bg-background/40',
                )}
              >
                {!n.read ? (
                  <BellDot className={cn('mt-0.5 h-4 w-4 shrink-0', important ? 'text-rose-500' : 'text-primary')} aria-hidden />
                ) : (
                  <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn('truncate text-xs font-semibold', n.read && 'text-foreground/80')}>{n.title}</span>
                    {important && !n.read && (
                      <span className="rounded bg-rose-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                        Important
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {n.sender} · {new Date(n.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {n.audience ? ` · ${n.audience}` : ''}
                  </span>
                </span>
                {!n.read && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="unread" />
                )}
              </button>
            </motion.li>
          )
        })}
      </ul>
    </motion.section>
  )
}
