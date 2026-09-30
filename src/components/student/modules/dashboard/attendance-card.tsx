'use client'

/**
 * AttendanceCard (SD-3 · PHASE 7) — overall attendance from the REAL
 * Attendance records (server aggregate), with the school's OWN
 * configured thresholds (School Settings → academics.attendanceThresholds
 * — never an invented number). A below-expectation record gets a quiet,
 * non-shaming note; a strong record gets a quiet nod. The weekly trend
 * line is the honest aggregation of weeks that actually have records.
 */

import { motion } from 'framer-motion'
import { CalendarCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { RadialGauge } from '@/components/shared/charts'
import type { DashboardData } from './types'

export function AttendanceCard({ data, onNavigate }: {
  data: DashboardData
  onNavigate: (key: string) => void
}) {
  const a = data.attendance
  // The school's own policy (School Settings) — no invented threshold.
  const thresholds = useSchoolSettingsStore((s) => s.academics?.attendanceThresholds)
  const needsAttention = thresholds?.needsAttention   // e.g. 85
  const excellent = thresholds?.excellent             // e.g. 95

  if (a.total === 0) {
    return (
      <section aria-label="Attendance" className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <CalendarCheck className="mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">No attendance recorded yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Your record builds as teachers mark daily attendance.</p>
        </div>
      </section>
    )
  }

  const pct = a.pct ?? 0
  const belowExpectation = needsAttention != null && pct < needsAttention
  const strong = excellent != null && pct >= excellent

  // Trend read — factual direction only. The "needs attention" judgement
  // belongs to the school-threshold line below, never to a single week.
  const trend =
    a.weekDelta == null ? null
    : a.weekDelta >= 2 ? { label: 'Improving', up: true }
    : a.weekDelta <= -2 ? { label: 'Dipped last week', up: false }
    : { label: 'Stable', up: null }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Attendance"
      className="flex flex-col rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4"
    >
      <Header />

      <div className="flex items-center justify-center py-1">
        <RadialGauge
          value={pct}
          label="attended"
          size={132}
          color={belowExpectation ? 'oklch(0.72 0.15 70)' : 'oklch(0.55 0.14 162)'}
        />
      </div>

      <p className="-mt-2 text-center text-[11px] text-muted-foreground">{a.windowLabel}</p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <Stat label="Present" value={a.present} tone="emerald" />
        <Stat label="Late" value={a.late} tone="amber" />
        <Stat label="Absent" value={a.absent} tone="rose" />
      </div>

      {/* School policy context — quiet, never shaming (PHASE 7) */}
      {belowExpectation ? (
        <p className="mt-3 rounded-lg bg-amber-500/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          Below the school&rsquo;s {needsAttention}% expectation ({a.absent} absence{a.absent === 1 ? '' : 's'} this term).
          Every day counts — your teachers can help you catch up.
        </p>
      ) : strong ? (
        <p className="mt-3 rounded-lg bg-emerald-500/[0.06] px-2.5 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          Excellent — above the school&rsquo;s {excellent}% benchmark.
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {trend ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {trend.up === true && <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />}
            {trend.up === false && <TrendingDown className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />}
            {trend.up === null && <Minus className="h-3 w-3" aria-hidden />}
            {trend.label}
            {a.weekDelta != null && <span className="tabular-nums">({a.weekDelta > 0 ? '+' : ''}{a.weekDelta}% last week)</span>}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Building your record</span>
        )}
        <button
          type="button"
          onClick={() => onNavigate('attendance')}
          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          Details
        </button>
      </div>
    </motion.section>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <CalendarCheck className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <h2 className="font-display text-sm font-bold tracking-tight">Attendance</h2>
        <p className="text-[11px] text-muted-foreground">Overall record</p>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  } as const
  return (
    <div className={cn('rounded-lg py-1.5', tones[tone])}>
      <p className="font-display text-base font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
