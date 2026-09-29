'use client'

/**
 * Attendance shared presentational pieces.
 *
 * CalendarLegend — compact color legend strip.
 * SelectedDayPanel — Brief §10 (connected to heatmap) + §19 (View full CTA)
 *   + Brief PART 8 (accepts dateStr + holiday for cross-month selection)
 *   + Brief PART 35 (distinguishes holiday from working day)
 */

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, CalendarOff } from 'lucide-react'
import type { Holiday } from '@/lib/mock/school-calendar'
import { formatNumber } from '@/lib/format'
import { ATTENDANCE_PALETTE } from './attendance-charts'

/** Real per-date school-wide breakdown (from GET /api/attendance/overview). */
export interface SelectedDayStats {
  present: number
  late: number
  absent: number
  leave: number
  rate: number
}

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] text-muted-foreground pt-2.5 mt-2.5 border-t border-border">
      <span className="font-medium">Legend:</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/85 border border-emerald-600" /> ≥95%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400/60 border border-emerald-500" /> 90–94%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-amber-400/70 border border-amber-500" /> 85–89%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-rose-400/70 border border-rose-500" /> &lt;85%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-violet-500/15 border border-violet-500/40" /> Holiday
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-muted/40 border border-border" /> Weekend
      </span>
    </div>
  )
}

/**
 * SelectedDayPanel — Brief §10 (connected to heatmap) + §19 (View full CTA).
 *
 * Brief PART 8: accepts `dateStr` (ISO date) + `holiday` (from school calendar)
 *   so it can correctly display the selected day across any month.
 *
 * Brief PART 35: when the selected day is a holiday, shows the holiday name
 *   instead of attendance counts.
 *
 * attendance-overview-real: the day's figures come from the caller as
 * `stats` (real recorded breakdown for that date, derived at the call
 * site from GET /api/attendance/overview). null ⇒ no attendance was
 * recorded on that day — shown honestly instead of fabricated numbers.
 */
export function SelectedDayPanel({
  selectedDay: _selectedDay,
  dateStr,
  holiday,
  stats,
  onViewFullAttendance,
}: {
  selectedDay: number
  dateStr: string
  holiday: Holiday | null
  /** real recorded breakdown for dateStr; null when the day has no rows */
  stats?: SelectedDayStats | null
  onViewFullAttendance?: () => void
}) {
  const reduce = useReducedMotion()

  // Parse dateStr (YYYY-MM-DD) → Date for label
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  // Brief PART 35: holiday display — no attendance counts
  if (holiday) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-violet-500/20 bg-violet-500/5">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-violet-600 dark:text-violet-400">
              Selected Day · School Holiday
            </p>
            <p className="text-xs font-semibold text-foreground truncate">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <CalendarOff className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
              {holiday.name}
            </span>
          </div>
        </div>
        <div className="px-3 py-2">
          <p className="text-[10px] text-muted-foreground italic">
            No attendance marked on school holidays.
          </p>
        </div>
      </motion.div>
    )
  }

  // attendance-overview-real: no recorded rows for this day — honest
  // empty state (same panel chrome, no fabricated rate/counts).
  if (!stats) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mt-3 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-primary/20 bg-primary/5">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-primary">Selected Day</p>
            <p className="text-xs font-semibold text-foreground truncate">{dateLabel}</p>
          </div>
          <div className="flex items-baseline gap-1 shrink-0">
            <span className="font-display text-2xl font-bold tabular-nums text-primary">—</span>
            <span className="text-[10px] text-muted-foreground">attendance</span>
          </div>
        </div>
        <div className="px-3 py-2">
          <p className="text-[10px] text-muted-foreground italic">
            No attendance was recorded on this day.
          </p>
        </div>
      </motion.div>
    )
  }

  // Real recorded breakdown for the selected date (passed from the caller).
  const rate = stats.rate
  const presentCount = stats.present
  const lateCount = stats.late
  const absentCount = stats.absent
  const leaveCount = stats.leave

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mt-3 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-primary/20 bg-primary/5">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-primary">Selected Day</p>
          <p className="text-xs font-semibold text-foreground truncate">{dateLabel}</p>
        </div>
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="font-display text-2xl font-bold tabular-nums text-primary">{rate}%</span>
          <span className="text-[10px] text-muted-foreground">attendance</span>
        </div>
      </div>

      <div className="grid grid-cols-4 divide-x divide-border">
        <StatTile label="Present" value={presentCount} color={ATTENDANCE_PALETTE.present} />
        <StatTile label="Late" value={lateCount} color={ATTENDANCE_PALETTE.late} />
        <StatTile label="Absent" value={absentCount} color={ATTENDANCE_PALETTE.absent} />
        <StatTile label="Leave" value={leaveCount} color={ATTENDANCE_PALETTE.leave} />
      </div>

      {/* Brief §19: View full attendance → CTA */}
      {onViewFullAttendance && (
        <div className="px-3 py-2 border-t border-primary/20 bg-primary/5">
          <button
            onClick={onViewFullAttendance}
            className="text-[11px] font-semibold text-primary hover:underline underline-offset-2 flex items-center gap-1 transition-colors"
          >
            View full attendance
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </motion.div>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="px-2 py-2 text-center">
      <p className="font-display text-sm sm:text-base font-bold tabular-nums" style={{ color }}>
        {formatNumber(value)}
      </p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}
