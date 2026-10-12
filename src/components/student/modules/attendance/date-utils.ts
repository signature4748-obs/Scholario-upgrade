/**
 * attendance/date-utils — timezone-safe local date helpers for the Student
 * Attendance module (brief §39).
 *
 * Every date is handled as a LOCAL `YYYY-MM-DD` string (never
 * `toISOString()`, which shifts by UTC) so "11 September" can never render
 * as "10 September". Parsing uses `T00:00:00` local midnight.
 *
 * Month grids are Monday-first: the school week is MON–SAT with Sunday
 * off (Indian school convention; matches the DB Timetable DAY_ORDER and
 * the school-calendar helpers' staff rule — Saturdays are SCHOOL days,
 * so an unrecorded Saturday renders honestly as 'no record', never as a
 * blanket weekend).
 *
 * HOLIDAYS (real-data fix): callers pass the DB SchoolEvent map from
 * useSchoolHolidays (GET /api/events?type=HOLIDAY, tenant-scoped). The
 * bundled client mirror is the documented fallback while loading / on
 * fetch failure — never the primary source, never fabricated.
 */

import { getHoliday, type Holiday } from '@/lib/mock/school-calendar'
import type { StudentAttendanceRecord } from '@/lib/store/student-attendance-store'
import type { DayCell, DayKind } from './status-tokens'

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Local-timezone ISO date (YYYY-MM-DD) — the canonical storage format. */
export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse YYYY-MM-DD → local Date (no timezone shift). */
export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export interface MonthCursor {
  y: number
  m: number // 1-12
}

export function monthIndex(c: MonthCursor): number {
  return c.y * 12 + (c.m - 1)
}

export function shiftMonth(c: MonthCursor, delta: number): MonthCursor {
  const idx = monthIndex(c) + delta
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 }
}

export function monthLabel(c: MonthCursor): string {
  return new Date(c.y, c.m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export function daysInMonth(c: MonthCursor): number {
  return new Date(c.y, c.m, 0).getDate()
}

/* ── Day resolution (record → Sunday → holiday → future → no record) ── */

/** Holiday lookup for a date: DB events first, mirror as documented fallback. */
function holidayFor(iso: string, holidays?: Record<string, Holiday>): Holiday | null {
  if (holidays) return holidays[iso] ?? null
  return getHoliday(iso)
}

export function resolveDay(
  iso: string,
  byDate: Map<string, StudentAttendanceRecord>,
  todayIso: string,
  holidays?: Record<string, Holiday>,
): Omit<DayCell, 'day' | 'key'> {
  const record = byDate.get(iso)
  if (record) return { iso, kind: record.status as DayKind, record }
  const dow = parseIso(iso).getDay()
  // Sunday-only weekend (Mon–Sat school — see the module header).
  if (dow === 0) return { iso, kind: 'weekend' }
  const holiday = holidayFor(iso, holidays)
  if (holiday) return { iso, kind: 'holiday', holidayName: holiday.name }
  if (iso > todayIso) return { iso, kind: 'future' }
  return { iso, kind: 'norecord' }
}

/** Monday-first month grid (leading blanks are null days). */
export function buildMonthGrid(
  c: MonthCursor,
  byDate: Map<string, StudentAttendanceRecord>,
  todayIso: string,
  holidays?: Record<string, Holiday>,
): DayCell[] {
  const cells: DayCell[] = []
  const firstDow = new Date(c.y, c.m - 1, 1).getDay()
  const lead = (firstDow + 6) % 7 // Monday-first offset
  for (let i = 0; i < lead; i++) cells.push({ key: `blank-${i}`, day: null, iso: '', kind: 'norecord' })
  for (let d = 1; d <= daysInMonth(c); d++) {
    const iso = `${c.y}-${pad(c.m)}-${pad(d)}`
    cells.push({ key: iso, day: d, ...resolveDay(iso, byDate, todayIso, holidays) })
  }
  return cells
}

/**
 * Working (school) days in a calendar month: Mon–Sat minus the school's
 * real holidays (DB events when provided, mirror fallback) — the school
 * week runs Monday–Saturday.
 */
export function workingDaysInMonth(c: MonthCursor, holidays?: Record<string, Holiday>): number {
  let n = 0
  for (let d = 1; d <= daysInMonth(c); d++) {
    const iso = `${c.y}-${pad(c.m)}-${pad(d)}`
    const dow = parseIso(iso).getDay()
    if (dow === 0) continue // Sunday-only weekend
    if (holidayFor(iso, holidays) === null) n++
  }
  return n
}

/* ── Consistent display formatting (one format per grain, §39) ── */

/** "Friday, 11 September 2026" — day detail heading. */
export function formatLongDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** "11 Sep 2026" — record list rows. */
export function formatShortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Friday" — record list weekday. */
export function formatWeekday(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-IN', { weekday: 'long' })
}

/** "12 Aug – 11 Sep 2026" — overall records window. */
export function formatWindow(firstIso: string, lastIso: string): string {
  const a = parseIso(firstIso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const b = parseIso(lastIso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${a} – ${b}`
}

/** "9:05 AM" — from the record's local markedAt timestamp. */
export function formatRecordedAt(isoTimestamp: string): string {
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Default selected date for a month view: today when the cursor is the
 * current month, else the month's latest record, else null.
 */
export function defaultSelection(c: MonthCursor, byDate: Map<string, StudentAttendanceRecord>, todayIso: string): string | null {
  const todayMonth: MonthCursor = { y: Number(todayIso.slice(0, 4)), m: Number(todayIso.slice(5, 7)) }
  if (monthIndex(c) === monthIndex(todayMonth)) return todayIso
  const prefix = `${String(c.y).padStart(4, '0')}-${pad(c.m)}`
  const inMonth = [...byDate.keys()].filter((iso) => iso.startsWith(prefix)).sort()
  return inMonth.length > 0 ? inMonth[inMonth.length - 1] : null
}
