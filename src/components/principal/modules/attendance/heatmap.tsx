'use client'

/**
 * AttendanceHeatmap — Brief PART 6-8 (Phase 5).
 *
 * Brief PART 6: Month navigation arrows ACTUALLY WORK — clicking ← loads
 *   the previous month's attendance heatmap; → loads the next month.
 * Brief PART 7: When month changes, ALL of the following update:
 *   month title, calendar dates, weekday alignment, attendance colors,
 *   attendance percentages, selected day, selected-day summary.
 * Brief PART 8: Clicking a day shows the selected-day summary; switching
 *   months clears the selected day if it's no longer valid.
 * Brief PART 9-13: Holidays + weekends come from the school calendar.
 * Brief PART 35: Heatmap distinguishes Working day / Holiday / Weekend.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import {
  buildMonthCalendar,
  rateColor,
  HOLIDAY_CELL_COLOR,
  formatMonthLabel,
  formatMonthLabelCompact,
  useSchoolHolidays,
} from './data'
import { CalendarLegend, SelectedDayPanel } from './shared'
import type { AttendanceDayRecord } from './use-attendance-overview'

type HeatmapProps = {
  selectedDay: number | null
  setSelectedDay: (d: number | null) => void
  /** Callback fired when user clicks "View full attendance →" (Brief §19). */
  onViewFullAttendance?: (dateStr: string) => void
  /** attendance-overview-real — every recorded date's school-wide breakdown
   *  (GET /api/attendance/overview `daily`). Cell colors + the selected-day
   *  panel render REAL rates; unrecorded days show "no attendance yet". */
  daily?: AttendanceDayRecord[]
  /** Month the calendar opens on — defaults to the latest recorded month
   *  when daily data is present (falls back to December 2025 legacy). */
  initialMonth?: { year: number; month: number }
}

interface MonthState {
  year: number
  month: number
}

export function AttendanceHeatmap({ selectedDay, setSelectedDay, onViewFullAttendance, daily, initialMonth }: HeatmapProps) {
  const reduce = useReducedMotion()
  // Brief PART 6: month navigation state. Default = the latest recorded
  // month (real data) or December 2025 (legacy, no data yet).
  const [monthState, setMonthState] = useState<MonthState>(
    initialMonth ?? { year: 2025, month: 12 },
  )
  const { year, month } = monthState

  // attendance-overview-real — real per-date rates for the calendar cells.
  const recordedRates = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of daily ?? []) map[d.date] = d.rate
    return map
  }, [daily])
  // `daily` is always provided by the caller (the canonical overview —
  // school-wide or class-scoped); unrecorded days honestly show "no
  // attendance yet". The deterministic fabrication fallback is retired.

  // Phase B: holidays from the AUTHORITATIVE DB source —
  // GET /api/events?type=HOLIDAY (tenant-scoped SchoolEvent rows), fetched
  // once per window. While loading / on failure the bundled mirror applies
  // (the documented fallback — never fabricated rates).
  const dbHolidays = useSchoolHolidays()

  // Brief PART 7: rebuild the calendar for the current month.
  const calendar = useMemo(
    () => buildMonthCalendar(year, month, recordedRates, dbHolidays),
    [year, month, recordedRates, dbHolidays],
  )

  // Brief PART 8: when month changes, clear the selected day if it's no
  // longer valid (i.e., not in the current month).
  useEffect(() => {
    setSelectedDay(null)
  }, [year, month, setSelectedDay])

  // Brief PART 6: month navigation handlers.
  const goToPreviousMonth = () => {
    setMonthState((prev) => {
      let m = prev.month - 1
      let y = prev.year
      if (m < 1) {
        m = 12
        y -= 1
      }
      return { year: y, month: m }
    })
  }
  const goToNextMonth = () => {
    setMonthState((prev) => {
      let m = prev.month + 1
      let y = prev.year
      if (m > 12) {
        m = 1
        y += 1
      }
      return { year: y, month: m }
    })
  }

  // Brief PART 8: find the selected cell's ISO date string for the
  // selected-day panel.
  const selectedCell = selectedDay !== null
    ? calendar.find((c) => c.day === selectedDay)
    : null
  const selectedDateStr = selectedCell?.dateStr ?? ''

  // attendance-overview-real — the selected day's REAL recorded breakdown
  // (null when that date has no attendance rows).
  const selectedStats = useMemo(() => {
    if (!daily || !selectedDateStr) return null
    const rec = daily.find((d) => d.date === selectedDateStr)
    return rec ?? null
  }, [daily, selectedDateStr])

  // Brief PART 19: pass the date string (not just the day number) to the
  // "View full attendance" callback so History can pre-fill correctly.
  const handleViewFullAttendance = () => {
    if (onViewFullAttendance && selectedDateStr) {
      onViewFullAttendance(selectedDateStr)
    }
  }

  return (
    <GlassCard className="p-3 sm:p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-primary shrink-0" />
            {formatMonthLabel(year, month)} — Attendance Heatmap
          </h3>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
            Tap a day to view details · color intensity reflects attendance rate
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Brief PART 6: previous month arrow — actually works */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Previous month"
            onClick={goToPreviousMonth}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-semibold font-mono tabular-nums">
            {formatMonthLabelCompact(year, month)}
          </span>
          {/* Brief PART 6: next month arrow — actually works */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Next month"
            onClick={goToNextMonth}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Brief PART 7: calendar grid rebuilt for the selected month */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="text-center text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-1"
          >
            {d}
          </div>
        ))}
        {calendar.map((cell, idx) => {
          if (cell.day === null) {
            return <div key={`empty-${idx}`} className="h-8 sm:h-9" />
          }
          const isSelected = selectedDay === cell.day
          // Brief PART 35: distinguish Working day / Holiday / Weekend
          const isInteractive = !cell.isWeekend && !cell.isHoliday && cell.rate !== null
          return (
            <motion.button
              key={cell.dateStr || `day-${cell.day}`}
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(idx * 0.008, 0.3), duration: 0.3 }}
              whileHover={isInteractive && !reduce ? { scale: 1.06, zIndex: 2 } : undefined}
              whileTap={isInteractive && !reduce ? { scale: 0.96 } : undefined}
              onClick={() => isInteractive && setSelectedDay(cell.day)}
              aria-label={
                isInteractive
                  ? `${cell.dateStr}, ${cell.rate}% attendance`
                  : cell.isHoliday
                  ? `${cell.dateStr}, holiday${cell.holiday ? ` (${cell.holiday.name})` : ''}`
                  : cell.isWeekend
                  ? `${cell.dateStr}, weekend`
                  : cell.rate === null
                  ? `${cell.dateStr}, upcoming (no attendance yet)`
                  : `${cell.dateStr}`
              }
              aria-pressed={isSelected}
              className={`h-8 sm:h-9 rounded-md border flex items-center justify-center text-[10px] sm:text-[11px] font-semibold tabular-nums transition-all ${
                cell.isHoliday
                  ? HOLIDAY_CELL_COLOR
                  : rateColor(cell.rate)
              } ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''} ${
                isInteractive ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'
              }`}
              title={cell.isHoliday && cell.holiday ? cell.holiday.name : undefined}
            >
              <span>{cell.day}</span>
            </motion.button>
          )
        })}
      </div>

      <CalendarLegend />

      {/* Brief PART 8: selected day details — clears when month changes */}
      {selectedDay !== null && selectedCell && (
        <SelectedDayPanel
          selectedDay={selectedDay}
          dateStr={selectedDateStr}
          holiday={selectedCell.holiday}
          stats={selectedStats}
          onViewFullAttendance={handleViewFullAttendance}
        />
      )}
    </GlassCard>
  )
}
