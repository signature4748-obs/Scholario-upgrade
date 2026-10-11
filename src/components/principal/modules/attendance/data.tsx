// Attendance module: month-aware calendar helpers + color tokens.
//
// Brief PART 6-8 (Phase 5): Heatmap must build calendar for ANY month,
// not just December 2025. Month navigation arrows actually work + data
// changes with the selected month.
//
// Brief PART 9-13: weekends come from the school-calendar helpers (the
// shared date-rule library). Phase B (real-data QA): HOLIDAYS come from
// the AUTHORITATIVE DB source — SchoolEvent HOLIDAY rows via
// GET /api/events?type=HOLIDAY (see useSchoolHolidays below) — instead
// of the bundled client mirror. The mirror stays as the fallback for
// surfaces that have not fetched yet; NO duplicate holiday list lives
// here.
//
// attendance-overview-real: rates are ALWAYS the caller's REAL recorded
// per-date data (GET /api/attendance/overview `daily` — school-wide or
// per-class scope). The legacy deterministic Math.sin fabrication
// fallback is RETIRED (Phase B): a day without recorded rows renders
// "no attendance yet" — never a fabricated rate.

import { useEffect, useState } from 'react'
import { isWeekend, isHoliday as mirrorIsHoliday, getHoliday, type Holiday } from '@/lib/mock/school-calendar'

export type CalendarCell = {
  /** ISO date string (YYYY-MM-DD) — used for holiday lookups. */
  dateStr: string
  /** Day-of-month number (1-31), or null for empty leading/trailing cells. */
  day: number | null
  /** Attendance rate (%), or null for non-working/unrecorded days. */
  rate: number | null
  /** True if Saturday or Sunday (school-calendar rule). */
  isWeekend: boolean
  /** True if school holiday (DB SchoolEvent when fetched, mirror fallback). */
  isHoliday: boolean
  /** Holiday details (name + type), if applicable. */
  holiday: Holiday | null
}

/**
 * Build a calendar grid for a given month + year.
 *
 * Brief PART 6-7: the calendar grid aligns weekdays correctly (Sunday-first),
 * so different months render different leading null cells.
 *
 * Brief PART 7: calendar data (rates, holidays, weekend flags) is computed
 * for the actual selected month — never a static month.
 *
 * Brief PART 9: holidays come from `holidays` (the DB SchoolEvent map from
 * useSchoolHolidays) when provided, falling back to the bundled mirror.
 *
 * Brief PART 35: weekend cells show "Weekend" — clearly distinguished from
 * attendance intensity colors.
 *
 * attendance-overview-real: `recorded` (real per-date rates from
 * GET /api/attendance/overview) is REQUIRED for rates — a day's rate is
 * the REAL recorded rate and every unrecorded day renders "no attendance
 * yet" (null). No fabricated fallback exists anymore.
 */
export function buildMonthCalendar(
  year: number,
  month: number,
  recorded?: Record<string, number>,
  holidays?: Record<string, Holiday>,
): CalendarCell[] {
  const days: CalendarCell[] = []
  // First day of the month
  const firstDay = new Date(year, month - 1, 1)
  // Day-of-week of the 1st (0=Sun, 1=Mon, ..., 6=Sat)
  const firstDayOfWeek = firstDay.getDay()
  // Number of days in the month
  const daysInMonth = new Date(year, month, 0).getDate()

  const holidayFor = (dateStr: string): Holiday | null =>
    holidays ? (holidays[dateStr] ?? null) : getHoliday(dateStr)
  const isHolidayOn = (dateStr: string): boolean =>
    holidays ? dateStr in holidays : mirrorIsHoliday(dateStr)

  // Leading empty cells (Sunday-first grid)
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push({
      dateStr: '',
      day: null,
      rate: null,
      isWeekend: false,
      isHoliday: false,
      holiday: null,
    })
  }

  // Real day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const weekend = isWeekend(dateStr)
    const holiday = holidayFor(dateStr)
    let rate: number | null = null
    if (!weekend && !isHolidayOn(dateStr)) {
      // attendance-overview-real — REAL rate for recorded days only; every
      // other working day honestly shows "no attendance yet" (Phase B: the
      // deterministic fabrication fallback is retired).
      rate = recorded ? (recorded[dateStr] ?? null) : null
    }
    days.push({
      dateStr,
      day: d,
      rate,
      isWeekend: weekend,
      isHoliday: isHolidayOn(dateStr),
      holiday,
    })
  }

  return days
}

/** DB SchoolEvent row subset (GET /api/events?type=HOLIDAY). */
export interface HolidayEvent {
  title: string
  startDate: string
  endDate?: string | null
}

/**
 * Expand DB HOLIDAY events (inclusive date ranges) into the per-date
 * Holiday map the calendar consumes. Type mapping: SchoolEvent HOLIDAY
 * rows carry no sub-type — 'school' keeps the neutral violet styling.
 */
export function holidaysFromEvents(events: HolidayEvent[]): Record<string, Holiday> {
  const map: Record<string, Holiday> = {}
  for (const ev of events) {
    const start = ev.startDate.slice(0, 10)
    const end = (ev.endDate ?? ev.startDate).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue
    // Guard against pathological ranges (bounded expansion, ≤370 days).
    let cursor = new Date(`${start}T00:00:00.000Z`)
    const last = new Date(`${end}T00:00:00.000Z`)
    let guard = 0
    while (cursor <= last && guard < 370) {
      const dateStr = cursor.toISOString().slice(0, 10)
      if (!(dateStr in map)) {
        map[dateStr] = { dateStr, name: ev.title, type: 'school' }
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
      guard++
    }
  }
  return map
}

/**
 * useSchoolHolidays — the authoritative DB holiday feed (Phase B):
 * GET /api/events?type=HOLIDAY (tenant-scoped SchoolEvent rows),
 * module-level cached for the window. Falls back to `undefined` while
 * loading / on failure — consumers then use the bundled mirror (the
 * documented fallback), never fabricated data.
 */
let cachedHolidays: Record<string, Holiday> | null = null
let holidaysInflight: Promise<Record<string, Holiday> | null> | null = null

function fetchHolidays(): Promise<Record<string, Holiday> | null> {
  if (cachedHolidays) return Promise.resolve(cachedHolidays)
  if (!holidaysInflight) {
    holidaysInflight = fetch('/api/events?type=HOLIDAY', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        let json: unknown = null
        try {
          json = await res.json()
        } catch {
          /* non-JSON body — treated as failure below */
        }
        const envelope = json as { ok?: unknown; data?: HolidayEvent[] } | null
        if (!res.ok || !envelope || envelope.ok !== true || !Array.isArray(envelope.data)) {
          return null
        }
        return holidaysFromEvents(envelope.data)
      })
      .then((map) => {
        if (map) cachedHolidays = map
        return map
      })
      .catch(() => null)
      .finally(() => {
        holidaysInflight = null
      })
  }
  return holidaysInflight
}

export function useSchoolHolidays(): Record<string, Holiday> | undefined {
  const [holidays, setHolidays] = useState<Record<string, Holiday> | undefined>(cachedHolidays ?? undefined)
  useEffect(() => {
    if (cachedHolidays) return
    let cancelled = false
    void fetchHolidays().then((map) => {
      if (!cancelled && map) setHolidays(map)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return holidays
}

export function rateColor(rate: number | null): string {
  if (rate === null) return 'bg-muted/40 border-border'
  if (rate >= 95) return 'bg-emerald-500/85 border-emerald-600 text-white'
  if (rate >= 90) return 'bg-emerald-400/60 border-emerald-500 text-emerald-950'
  if (rate >= 85) return 'bg-amber-400/70 border-amber-500 text-amber-950'
  return 'bg-rose-400/70 border-rose-500 text-rose-950'
}

/** Holiday cell color — distinct from attendance intensity (Brief PART 35). */
export const HOLIDAY_CELL_COLOR = 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300'

/** Format a (year, month) as a readable label. */
export function formatMonthLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

/** Compact "MON YYYY" label (e.g., "DEC 2025") for the heatmap header. */
export function formatMonthLabelCompact(year: number, month: number): string {
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }).toUpperCase()
}
