'use client'

/**
 * EventsRow — 2 cards: Upcoming Events + Pending Reviews.
 *
 * PHASE 7 — REAL DATA CONTRACT:
 *   - Upcoming Events reads the canonical SchoolEvent table via
 *     `GET /api/events?upcoming=1` (was: 5 hardcoded Dec-2025 mock
 *     events). Loading → skeletons; none → honest empty state.
 *   - Pending Reviews counts stay store-backed (admission/fee/salary
 *     queues are in-session workspace data — fee cash approvals and
 *     salary change requests start honest-empty; admission counts
 *     follow the admission store's honest-empty contract, see
 *     docs/DATA_SOURCE_MAP.md for the classification).
 *
 * Both cards use the shared `Panel` (flat `rounded-xl border border-border
 * bg-card`), not the legacy `GlassCard`.
 */

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  ArrowRight, FileText, IndianRupee, Wallet, CalendarDays,
} from 'lucide-react'
import { Panel } from '../shared/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdmissionStore } from '@/lib/store/admission-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { useSalaryStore } from '@/lib/store/salary-store'

export interface EventsRowProps {
  onNavigate?: (module: string) => void
}

// ─── Upcoming Events ──────────────────────────────────────────────────

interface ServerEvent {
  id: string
  title: string
  type: string
  startDate: string
}

function UpcomingEventsCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  // PHASE 7 — REAL SchoolEvent rows (GET /api/events?upcoming=1).
  const [events, setEvents] = useState<ServerEvent[] | null>(null)
  useEffect(() => {
    let alive = true
    void fetch('/api/events?upcoming=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { ok?: boolean; data?: ServerEvent[] } | null) => {
        if (alive) setEvents(body?.ok && Array.isArray(body.data) ? body.data.slice(0, 5) : [])
      })
      .catch(() => {
        if (alive) setEvents([])
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <Panel title="Upcoming Events" subtitle="School calendar">
      <div className="space-y-1.5">
        {events === null && (
          <div className="space-y-1.5" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}
        {events !== null && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-1.5 text-center">
            <div className="h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center">
              <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-foreground">No upcoming events</p>
            <p className="text-xs text-muted-foreground max-w-[260px]">
              Events created in the Calendar module appear here.
            </p>
          </div>
        )}
        {events?.map((e, i) => (
          <motion.button
            key={e.id}
            type="button"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onNavigate?.('calendar')}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors cursor-pointer text-left focus-ring"
          >
            {/* Small 28×28 date chip */}
            <div className="flex flex-col items-center justify-center h-7 w-7 shrink-0 rounded-md bg-muted/60 text-foreground" aria-hidden="true">
              <span className="text-[11px] font-bold leading-none">
                {new Date(e.startDate).getDate()}
              </span>
              <span className="text-[8px] uppercase tracking-wider leading-none mt-0.5">
                {new Date(e.startDate).toLocaleDateString('en-IN', { month: 'short' })}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{e.title}</p>
              <p className="text-[11px] text-muted-foreground">{e.type}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </Panel>
  )
}

// ─── Pending Reviews ──────────────────────────────────────────────────

interface ReviewRow {
  label: string
  count: number
  icon: React.ReactNode
  navKey: string
  tone: string
}

function PendingReviewsCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  // Real counts from Zustand stores
  const pendingAdmissions = useAdmissionStore((s) =>
    s.applications.filter((a) =>
      a.status === 'Submitted' || a.status === 'Under Review' || a.status === 'Need Correction'
    ).length
  )
  const pendingFeeApprovals = useFeeStore((s) =>
    s.cashRequests.filter((r) =>
      r.status === 'Pending Principal Acceptance' || r.status === 'Collected by Teacher'
    ).length
  )
  const pendingSalaryAdjustments = useSalaryStore((s) =>
    s.changeRequests.filter((r) => r.status === 'Pending').length
  )

  const reviews: ReviewRow[] = [
    {
      label: 'Admission Applications',
      count: pendingAdmissions,
      icon: <FileText className="h-3.5 w-3.5" />,
      navKey: 'admission',
      tone: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
    },
    {
      label: 'Fee Cash Approvals',
      count: pendingFeeApprovals,
      icon: <IndianRupee className="h-3.5 w-3.5" />,
      navKey: 'fees',
      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Salary Approvals',
      count: pendingSalaryAdjustments,
      icon: <Wallet className="h-3.5 w-3.5" />,
      navKey: 'salary',
      tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    },
  ]

  return (
    <Panel title="Pending Reviews" subtitle="Queues needing your attention">
      <div className="space-y-1.5">
        {reviews.map((r, i) => (
          <motion.button
            key={r.label}
            type="button"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onNavigate?.(r.navKey)}
            className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors cursor-pointer text-left focus-ring"
          >
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${r.tone}`}>
              {r.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{r.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.count > 0 ? `${r.count} pending review` : 'No pending items'}
              </p>
            </div>
            <span className="font-display text-base font-bold tabular-nums text-foreground">
              {r.count}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
          </motion.button>
        ))}
      </div>
    </Panel>
  )
}

// ─── Composition ─────────────────────────────────────────────────────

export function EventsRow({ onNavigate }: EventsRowProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <UpcomingEventsCard onNavigate={onNavigate} />
      <PendingReviewsCard onNavigate={onNavigate} />
    </div>
  )
}
