'use client'

/**
 * Student Timetable — time + day utilities.
 *
 * Everything here derives from the canonical configuration
 * (`@/lib/timetable/config` PERIODS + the school calendar's holiday source)
 * and the REAL clock. No hardcoded days, dates, or "today" labels.
 */
import { PERIODS, DAYS, type DayType, type TimetableSlot } from '@/lib/timetable/config'
import { getHoliday, type Holiday } from '@/lib/mock/school-calendar'

/* ─── Time parsing ─────────────────────────────────────────────────── */

/** "08:30 AM - 09:15 AM" → minutes since midnight. */
export function parsePeriodTime(time: string): { startMin: number; endMin: number } | null {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!m) return null
  const toMin = (h: string, min: string, mer?: string) => {
    let hour = Number(h)
    const mins = Number(min)
    if (mer) {
      const merU = mer.toUpperCase()
      if (merU === 'PM' && hour !== 12) hour += 12
      if (merU === 'AM' && hour === 12) hour = 0
    }
    return hour * 60 + mins
  }
  return {
    startMin: toMin(m[1], m[2], m[3]),
    endMin: toMin(m[4], m[5], m[6]),
  }
}

/** Compact start-time label, e.g. "08:30 AM - 09:15 AM" → "8:30 AM". */
export function startTimeLabel(time: string): string {
  const parsed = parsePeriodTime(time)
  if (!parsed) return time
  const h24 = Math.floor(parsed.startMin / 60)
  const min = parsed.startMin % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${mer}`
}

/** End-time label for a range string. */
export function endTimeLabel(time: string): string {
  const parsed = parsePeriodTime(time)
  if (!parsed) return time
  const h24 = Math.floor(parsed.endMin / 60)
  const min = parsed.endMin % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${mer}`
}

export function nowMinutes(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes()
}

/* ─── Day helpers ──────────────────────────────────────────────────── */

/** Real weekday as a timetable DayType ('Sunday' is not a school day). */
export function realTodayDay(d: Date = new Date()): DayType | 'Sunday' {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
  return names[d.getDay()]
}

export function isoDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function longDateLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function shortDateLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Next calendar occurrence of a weekday (today counts when it matches). */
export function nextOccurrenceOfDay(day: DayType, from: Date = new Date()): Date {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
  const target = names.indexOf(day)
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let guard = 0; guard < 8 && cursor.getDay() !== target; guard++) {
    cursor.setDate(cursor.getDate() + 1)
  }
  return cursor
}

/** "Friday, 11 September"-style label for a weekday's next occurrence. */
export function upcomingDayLabel(day: DayType, todayDay: DayType | 'Sunday', from: Date = new Date()): string {
  const d = nextOccurrenceOfDay(day, from)
  const label = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  return day === todayDay ? `Today · ${label}` : label
}

/** Holiday name for a date — DB SchoolEvent map first, mirror fallback. */
export function holidayName(d: Date, holidays?: Record<string, Holiday>): string | null {
  if (holidays) return holidays[isoDate(d)]?.name ?? null
  return getHoliday(isoDate(d))?.name ?? null
}

/**
 * Next school day AFTER `from` that has timetable slots for the class.
 * Skips Sundays + the school's real holidays (DB events when provided,
 * mirror fallback). Returns null when the class has no future scheduled
 * days in the weekly cycle (falls back to next weekday).
 */
export function nextScheduledDay(
  from: Date,
  scheduledDays: Set<DayType>,
  holidays?: Record<string, Holiday>,
): { day: DayType; date: Date } | null {
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  cursor.setDate(cursor.getDate() + 1)
  for (let guard = 0; guard < 21; guard++) {
    const dow = cursor.getDay()
    if (dow !== 0) {
      const dayName = DAYS[dow - 1] as DayType
      if (scheduledDays.has(dayName) && holidayName(cursor, holidays) === null) {
        return { day: dayName, date: new Date(cursor) }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

/* ─── Day schedule assembly ────────────────────────────────────────── */

/** One rendered row of a day's schedule — a class slot OR a structural break. */
export interface DayEntry {
  period: number
  name: string
  time: string
  isBreak: boolean
  breakType?: 'short' | 'lunch'
  slot?: TimetableSlot
}

/**
 * Merge a day's slots with the canonical PERIODS structure: teaching
 * periods render their slot; Short Break / Lunch Break render as neutral
 * structural rows BETWEEN the day's first and last scheduled period
 * (Saturday half-days never show a trailing lunch).
 *
 * `className` scopes the day's slots to ONE class — the student's "My
 * Class" view must never mix other classes' periods into the schedule
 * (Phase 11: the class comes from enrollment, and the day's schedule
 * comes from THAT class's canonical slots only).
 */
export function buildDayEntries(slots: TimetableSlot[], day: DayType, className?: string): DayEntry[] {
  const daySlots = slots
    .filter((s) => s.day === day && (className === undefined || s.className === className))
    .sort((a, b) => a.period - b.period)
  if (daySlots.length === 0) return []
  const min = daySlots[0].period
  const max = daySlots[daySlots.length - 1].period
  const byPeriod = new Map(daySlots.map((s) => [s.period, s]))
  const entries: DayEntry[] = []
  for (const p of PERIODS) {
    if (p.number < min || p.number > max) continue
    if (p.isBreak) {
      entries.push({ period: p.number, name: p.name, time: p.time, isBreak: true, breakType: p.breakType })
    } else {
      const slot = byPeriod.get(p.number)
      if (slot) entries.push({ period: p.number, name: p.name, time: slot.time, isBreak: false, slot })
    }
  }
  return entries
}

/** Days (in canonical order) that have at least one slot for a class. */
export function scheduledDaysForClass(slots: TimetableSlot[], className: string): DayType[] {
  const present = new Set(slots.filter((s) => s.className === className).map((s) => s.day))
  return DAYS.filter((d) => present.has(d))
}

/* ─── NOW / NEXT intelligence ──────────────────────────────────────── */

export type LiveSlotState = 'completed' | 'current' | 'upcoming'

/** Live state for a slot entry given minutes-since-midnight (null for breaks). */
export function liveState(entry: DayEntry, nowMin: number): LiveSlotState | null {
  if (!entry.slot) return null
  const parsed = parsePeriodTime(entry.time)
  if (!parsed) return null
  if (nowMin >= parsed.endMin) return 'completed'
  if (nowMin >= parsed.startMin) return 'current'
  return 'upcoming'
}

/** Whether the current time sits inside a break window. */
export function isBreakNow(entry: DayEntry, nowMin: number): boolean {
  if (!entry.isBreak) return false
  const parsed = parsePeriodTime(entry.time)
  if (!parsed) return false
  return nowMin >= parsed.startMin && nowMin < parsed.endMin
}
