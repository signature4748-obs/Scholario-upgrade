'use client'

/**
 * EventsRow — 2 cards: Upcoming Events + Pending Reviews.
 *
 * Redesigned (DASH-1) from 3 cards:
 *   - KEPT: Upcoming Events (now with smaller 28×28 date chips, row click
 *     wired to navigate to the Calendar module)
 *   - DROPPED: Class 2-A Top Performers — was a duplicate of the Exams
 *     module's Session Top Performers section
 *   - REWRITTEN: Pending Reviews — was 2 hardcoded progress bars + a fake
 *     "23" admission applications count. Now flat list of 3 rows with REAL
 *     counts pulled from Zustand stores:
 *       · Admission Applications  → useAdmissionStore (Submitted/Under Review/Need Correction)
 *       · Fee Cash Approvals       → useFeeStore (Pending Principal Acceptance / Collected by Teacher)
 *       · Salary Adjustments       → useSalaryStore (Pending)
 *     Each row: small icon + label + count badge + "Review →" link that
 *     navigates to the relevant module via `onNavigate`.
 *
 * Both cards use the shared `Panel` (flat `rounded-xl border border-border
 * bg-card`), not the legacy `GlassCard`.
 */

import { motion } from 'framer-motion'
import {
  ArrowRight, FileText, IndianRupee, Wallet,
} from 'lucide-react'
import { Panel } from '../shared/panel'
import { upcomingEvents } from '@/lib/mock/operations'
import { useAdmissionStore } from '@/lib/store/admission-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { useSalaryStore } from '@/lib/store/salary-store'

export interface EventsRowProps {
  onNavigate?: (module: string) => void
}

// ─── Upcoming Events ──────────────────────────────────────────────────

function UpcomingEventsCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  return (
    <Panel title="Upcoming Events" subtitle="School calendar">
      <div className="space-y-1.5">
        {upcomingEvents.map((e, i) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onNavigate?.('calendar')}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors cursor-pointer"
          >
            {/* Small 28×28 date chip */}
            <div className="flex flex-col items-center justify-center h-7 w-7 shrink-0 rounded-md bg-muted/60 text-foreground">
              <span className="text-[11px] font-bold leading-none">
                {new Date(e.date).getDate()}
              </span>
              <span className="text-[8px] uppercase tracking-wider leading-none mt-0.5">
                {new Date(e.date).toLocaleDateString('en-IN', { month: 'short' })}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{e.title}</p>
              <p className="text-[11px] text-muted-foreground">{e.type} · {e.time}</p>
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 hidden sm:inline-block">
              {e.type}
            </span>
          </motion.div>
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
          <motion.div
            key={r.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onNavigate?.(r.navKey)}
            className="group flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
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
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
          </motion.div>
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
