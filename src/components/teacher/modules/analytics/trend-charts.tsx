'use client'

/**
 * analytics/trend-charts — the two real time-series charts. Each card
 * shows an honest empty state (never a zero-filled or one-point
 * chart) when the class has no data for it yet:
 *
 *   • PerformanceTrendCard — "Is performance changing over time?"
 *     One point per graded assessment (chronological, real exam start
 *     dates as labels). The chart is drawn only with ≥ 2 graded
 *     assessments; the single-assessment case is handled by the
 *     PERFORMANCE SNAPSHOT card in the composition, so this card only
 *     ever renders the chart or the "no marks yet" empty state.
 *   • AttendanceTrendCard  — "How has attendance moved?" Weekly rate,
 *     each label is the real Monday of that week. Drawn only with
 *     ≥ 2 weeks of records; fewer gets a compact honest empty state.
 */

import type { LucideIcon } from 'lucide-react'
import { CalendarCheck, LineChart as LineChartIcon } from 'lucide-react'
import { ChartCard, AreaTrend } from '@/components/shared/charts'
import type { ClassAnalytics } from './types'

const GREEN = 'oklch(0.55 0.14 162)'
const CYAN = 'oklch(0.7 0.15 200)'

/** Compact in-card empty state — icon, one line, one hint. */
function ChartEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ─── 1. Performance over time (≥ 2 graded assessments) ───────────────

export function PerformanceTrendCard({ a, className }: { a: ClassAnalytics; className?: string }) {
  const trend = a.examTrend
  const hasLine = trend.length >= 2

  return (
    <ChartCard
      title="Performance Trend"
      subtitle={`Class average per graded assessment · ${a.label}`}
      className={className}
      height={216}
    >
      {hasLine ? (
        <AreaTrend
          data={trend.map((p) => ({ name: p.dateLabel, value: p.avgPct }))}
          xKey="name"
          yKey="value"
          color={GREEN}
          height={216}
        />
      ) : (
        <ChartEmpty
          icon={LineChartIcon}
          title="No exam marks entered yet"
          hint="Each graded assessment adds a point to this trend."
        />
      )}
    </ChartCard>
  )
}

// ─── 2. Attendance over time (weekly, ≥ 2 weeks of records) ──────────

export function AttendanceTrendCard({ a, className }: { a: ClassAnalytics; className?: string }) {
  const weeks = a.attendance.weeklyTrend
  const hasLine = weeks.length >= 2

  return (
    <ChartCard
      title="Attendance Trend"
      subtitle={`Weekly rate · week beginning Monday · ${a.label}`}
      className={className}
      height={hasLine ? 216 : 150}
    >
      {hasLine ? (
        <AreaTrend
          data={weeks.map((w) => ({ name: w.label, value: w.value }))}
          xKey="name"
          yKey="value"
          color={CYAN}
          height={216}
        />
      ) : a.attendance.total > 0 ? (
        <ChartEmpty
          icon={CalendarCheck}
          title={`${a.attendance.pct ?? 0}% overall attendance`}
          hint={`Only ${a.attendance.total} recorded ${a.attendance.total === 1 ? 'entry' : 'entries'} so far — the weekly trend builds as more days are marked.`}
        />
      ) : (
        <ChartEmpty
          icon={CalendarCheck}
          title="No attendance recorded yet"
          hint="Weekly attendance appears once days are marked for this class."
        />
      )}
    </ChartCard>
  )
}
