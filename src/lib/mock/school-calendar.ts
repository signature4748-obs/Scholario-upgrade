// school-calendar.ts — client-side mirror of the school's declared academic
// calendar.
//
// ⚠ MIRROR DISCIPLINE: the holiday list below mirrors `HOLIDAY_SEED` in
// prisma/holiday-data.ts (seeded into the DB as SchoolEvent HOLIDAY rows
// by prisma/seed-teacher-academics.ts) and MUST stay in sync with it.
// The AUTHORITATIVE source is the DB — modules that can fetch should use
// `GET /api/events?type=HOLIDAY` (schoolId-scoped SchoolEvent rows); this
// module is the bundled fallback + the shared date-helper library.
//
// Session 2026-27 declared holidays (all audience ALL):
//   Ambedkar Jayanti 2026-04-14 · Labour Day 2026-05-01 ·
//   Summer Break 2026-05-18 → 2026-06-14 · Independence Day 2026-08-15 ·
//   Janmashtami 2026-09-04 · Gandhi Jayanti 2026-10-02 ·
//   Dussehra Break 2026-10-19 → 2026-10-21 · Diwali Break 2026-11-07 →
//   2026-11-10 · Christmas 2026-12-25 · Republic Day 2027-01-26.
//
// NOTE on the weekend rule: the school's timetable runs Monday–Saturday
// (DB Timetable rows exist for every day except Sunday), so for TEACHING
// STAFF the weekend is Sunday ONLY — see `isStaffWeekend` / `isStaffWorkingDay`.
// The legacy `isWeekend` (Sat + Sun) semantics are kept for existing callers.
//
// Provides:
//   - isHoliday(dateStr) → boolean
//   - getHoliday(dateStr) → { name, type } | null   (date-RANGE aware)
//   - isWeekend(dateStr) → boolean                   (legacy: Sat + Sun)
//   - isWorkingDay(dateStr) → boolean                (legacy: Mon–Fri minus holidays)
//   - isStaffWeekend(dateStr) → boolean              (this school: Sunday only)
//   - isStaffWorkingDay(dateStr) → boolean           (Mon–Sat minus declared holidays)
//   - isFutureDate / isToday / isPastDate / getPreviousWorkingDay /
//     findPendingWorkingDays / categorizeDate

/**
 * Fixed national/religious holidays the school declares every year.
 * (The school declares these for 2026-27 too — kept recurring so legacy
 * out-of-session lookups keep working.)
 */
const FIXED_HOLIDAYS: { month: number; day: number; name: string; type: 'national' | 'religious' }[] = [
  { month: 1, day: 26, name: 'Republic Day', type: 'national' },
  { month: 8, day: 15, name: 'Independence Day', type: 'national' },
  { month: 10, day: 2, name: 'Gandhi Jayanti', type: 'national' },
  { month: 12, day: 25, name: 'Christmas Day', type: 'religious' },
]

/**
 * The school's declared session 2026-27 holidays — a 1:1 mirror of
 * HOLIDAY_SEED in prisma/holiday-data.ts (DB SchoolEvent HOLIDAY rows).
 * Date ranges are inclusive; a date inside a multi-day break is a holiday.
 * KEEP IN SYNC with prisma/holiday-data.ts.
 */
const DECLARED_SESSION_HOLIDAYS: {
  name: string
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD (inclusive)
  type: 'national' | 'religious' | 'school' | 'summer-break'
}[] = [
  { name: 'Ambedkar Jayanti', start: '2026-04-14', end: '2026-04-14', type: 'national' },
  { name: 'Labour Day', start: '2026-05-01', end: '2026-05-01', type: 'national' },
  { name: 'Summer Break', start: '2026-05-18', end: '2026-06-14', type: 'summer-break' },
  { name: 'Independence Day', start: '2026-08-15', end: '2026-08-15', type: 'national' },
  { name: 'Janmashtami', start: '2026-09-04', end: '2026-09-04', type: 'religious' },
  { name: 'Gandhi Jayanti', start: '2026-10-02', end: '2026-10-02', type: 'national' },
  { name: 'Dussehra Break', start: '2026-10-19', end: '2026-10-21', type: 'school' },
  { name: 'Diwali Break', start: '2026-11-07', end: '2026-11-10', type: 'school' },
  { name: 'Christmas', start: '2026-12-25', end: '2026-12-25', type: 'religious' },
  { name: 'Republic Day', start: '2027-01-26', end: '2027-01-26', type: 'national' },
]

export interface Holiday {
  dateStr: string
  name: string
  type: 'national' | 'religious' | 'school' | 'winter-break' | 'summer-break'
}

/** Format a date as YYYY-MM-DD (no timezone shift). */
function formatISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Parse YYYY-MM-DD → { year, month, day } */
function parseISO(dateStr: string): { year: number; month: number; day: number } | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) }
}

/** Day-of-week for a YYYY-MM-DD string (0 = Sunday … 6 = Saturday), local time. */
function dayOfWeek(dateStr: string): number | null {
  const parsed = parseISO(dateStr)
  if (!parsed) return null
  return new Date(parsed.year, parsed.month - 1, parsed.day).getDay()
}

/**
 * Returns the holiday for a specific date, or null if it's a working day.
 * Handles multi-day ranges — a date inside a declared break is a holiday.
 */
export function getHoliday(dateStr: string): Holiday | null {
  const parsed = parseISO(dateStr)
  if (!parsed) return null
  const { month, day } = parsed

  // Fixed recurring holidays (Republic Day, Independence Day, Gandhi Jayanti,
  // Christmas) — the school declares these every year.
  for (const h of FIXED_HOLIDAYS) {
    if (h.month === month && h.day === day) {
      return { dateStr, name: h.name, type: h.type }
    }
  }

  // Declared session 2026-27 holidays (incl. multi-day breaks) — string
  // comparison is safe for zero-padded YYYY-MM-DD ranges.
  for (const h of DECLARED_SESSION_HOLIDAYS) {
    if (dateStr >= h.start && dateStr <= h.end) {
      return { dateStr, name: h.name, type: h.type }
    }
  }

  return null
}

/** Returns true if the date is a school holiday (working day = false). */
export function isHoliday(dateStr: string): boolean {
  return getHoliday(dateStr) !== null
}

/**
 * LEGACY weekend rule (Saturday + Sunday). Kept for backward compatibility
 * with existing callers. For THIS school's teaching staff the weekend is
 * Sunday only — use `isStaffWeekend`.
 */
export function isWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr)
  if (dow === null) return false
  return dow === 0 || dow === 6
}

/** LEGACY working day (Mon–Fri minus holidays). See `isStaffWorkingDay`. */
export function isWorkingDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !isHoliday(dateStr)
}

/**
 * THIS school's teaching-staff weekend rule: Sunday only. The school's
 * timetable runs Monday–Saturday (DB Timetable rows exist for Saturday),
 * so Saturday is a working day for teaching staff.
 */
export function isStaffWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr)
  if (dow === null) return false
  return dow === 0
}

/**
 * THIS school's teaching-staff working day: not a Sunday, not a declared
 * holiday (Mon–Sat minus the school's declared holiday list).
 */
export function isStaffWorkingDay(dateStr: string): boolean {
  return !isStaffWeekend(dateStr) && !isHoliday(dateStr)
}

/**
 * Returns the PREVIOUS working day before the given date (legacy Sat+Sun
 * weekend rule). Skips weekends + school holidays automatically.
 */
export function getPreviousWorkingDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  let date = new Date(y, m - 1, d)
  do {
    date.setDate(date.getDate() - 1)
    const prevStr = formatISO(date.getFullYear(), date.getMonth() + 1, date.getDate())
    if (isWorkingDay(prevStr)) {
      return prevStr
    }
  } while (true) // will always find a working day eventually
}

/**
 * Find all past working days (from today backward) that have unsubmitted
 * attendance. Legacy Sat+Sun weekend rule. Returns array of date strings.
 */
export function findPendingWorkingDays(
  todayStr: string,
  byDate: Record<string, { submitted: boolean; draft: any[] | null }>,
  maxDays: number = 30
): string[] {
  const pending: string[] = []
  const [ty, tm, td] = todayStr.split('-').map(Number)
  let date = new Date(ty, tm - 1, td)
  for (let i = 0; i < maxDays; i++) {
    date.setDate(date.getDate() - 1)
    const dateStr = formatISO(date.getFullYear(), date.getMonth() + 1, date.getDate())
    if (!isWorkingDay(dateStr)) continue
    const state = byDate[dateStr]
    if (!state || (!state.submitted && !state.draft)) {
      // No attendance record at all = pending
      pending.push(dateStr)
    } else if (!state.submitted && state.draft) {
      // Has draft but not submitted = pending
      pending.push(dateStr)
    }
    if (pending.length >= 10) break
  }
  return pending
}

/** Returns true if the date is in the future (after `todayStr`). */
export function isFutureDate(dateStr: string, todayStr: string): boolean {
  return dateStr > todayStr
}

/** Returns true if the date is today. */
export function isToday(dateStr: string, todayStr: string): boolean {
  return dateStr === todayStr
}

/** Returns true if the date is in the past (before today). */
export function isPastDate(dateStr: string, todayStr: string): boolean {
  return dateStr < todayStr
}

/**
 * The DEMO-SEED calendar anchor (YYYY-MM-DD, "Dec 10 2025") — the month
 * the illustrative school-events/exam seed corpus (mock/operations
 * calendarEvents + mock-exams) is authored around. It is NOT a real
 * "today": the shared Calendar anchors "today" on the REAL clock
 * (calendar/data.ts CANONICAL_TODAY, PIH-4c) and only the demo tenant
 * uses this constant as its showcase anchor.
 */
export const TODAY_STR = '2025-12-10'

/**
 * Categorize a date by its attendance state:
 *   - 'future' — disabled (not markable)
 *   - 'holiday' — disabled (no attendance)
 *   - 'working' — editable (if not submitted)
 *
 * Holiday takes precedence over future.
 */
export type DateCategory = 'future' | 'holiday' | 'working'

export function categorizeDate(dateStr: string, todayStr: string = TODAY_STR): DateCategory {
  if (isHoliday(dateStr)) return 'holiday'
  if (isFutureDate(dateStr, todayStr)) return 'future'
  return 'working'
}
