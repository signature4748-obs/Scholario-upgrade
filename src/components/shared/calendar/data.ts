'use client'

/**
 * calendar/data — canonical helpers + visual tokens for the shared
 * Calendar workspace (used by BOTH the Principal and Student panels).
 *
 * The event data layer itself stays in `@/lib/store/calendar-store`
 * (single source of truth — no duplicate calendar systems). This file
 * only provides presentation tokens (type colors, tints) and pure
 * month-grid helpers.
 *
 * "Today" anchors on the REAL clock (PIH-4c): CANONICAL_TODAY is the
 * current UTC day, so every tenant's calendar opens on its actual
 * current month. The demo tenant alone keeps the seed-corpus anchor
 * (`DEMO_SEED_ANCHOR_TODAY`, Dec 10 2025) — the illustrative events its
 * showcase is authored around — applied only where the demo seed corpus
 * is consumed (calendar-workspace).
 */

import { TODAY_STR } from '@/lib/mock/school-calendar'

export type { CalendarEvent, CalendarEventSource } from '@/lib/store/calendar-store'

// ─── Canonical "today" ────────────────────────────────────────────────

/** The REAL clock's current day (YYYY-MM-DD, UTC). */
function utcTodayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The app's canonical today (YYYY-MM-DD) — the REAL clock (UTC day). */
export const CANONICAL_TODAY = utcTodayISO()

/**
 * DEMO-TIER anchor (legacy TODAY_STR, Dec 10 2025) — the month the
 * illustrative school-events/exam seed corpus is authored around. Only
 * the demo seed consumers use it as "today"; real tenants always use
 * the real clock.
 */
export const DEMO_SEED_ANCHOR_TODAY = TODAY_STR

/** Parse a YYYY-MM-DD "today" anchor into calendar parts. */
export function todayParts(dateISO: string = CANONICAL_TODAY): { year: number; month: number; day: number } {
  const [y, m, d] = dateISO.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

// ─── Event type tokens ────────────────────────────────────────────────

/**
 * Per-type visual tokens. Colour is FUNCTIONAL ONLY — one restrained
 * accent per event type, appearing exclusively as small indicators
 * (dots, subtle chip tints, type badges). Never as large surfaces:
 *   - `solid` : oklch colour for dots (inline style)
 *   - `chip`  : ultra-subtle tint (~7%) for in-cell chips; the dot
 *               carries the meaning, the tint just groups it
 *   - `badge` : complete classes for the small type badge pill
 *               (bg + text + border, light and dark)
 * Matches the StatusBadge language used across Scholario-OS.
 * Competition uses teal per the spec's "blue/teal" (no indigo).
 */
export interface TypeToken {
  solid: string
  chip: string
  badge: string
}

export const TYPE_TOKENS: Record<string, TypeToken> = {
  Exam: {
    solid: 'oklch(0.58 0.19 20)',
    chip: 'bg-rose-500/[0.07] dark:bg-rose-400/15',
    badge:
      'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:text-rose-300',
  },
  Event: {
    solid: 'oklch(0.55 0.14 162)',
    chip: 'bg-emerald-500/[0.07] dark:bg-emerald-400/15',
    badge:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
  },
  Holiday: {
    solid: 'oklch(0.68 0.15 75)',
    chip: 'bg-amber-500/[0.09] dark:bg-amber-400/15',
    badge:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:text-amber-300',
  },
  Meeting: {
    solid: 'oklch(0.55 0.19 300)',
    chip: 'bg-purple-500/[0.07] dark:bg-purple-400/15',
    badge:
      'border-purple-500/25 bg-purple-500/10 text-purple-700 dark:border-purple-400/30 dark:text-purple-300',
  },
  Competition: {
    solid: 'oklch(0.6 0.11 187)',
    chip: 'bg-teal-500/[0.07] dark:bg-teal-400/15',
    badge:
      'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:border-teal-400/30 dark:text-teal-300',
  },
  Cultural: {
    solid: 'oklch(0.6 0.18 330)',
    chip: 'bg-fuchsia-500/[0.07] dark:bg-fuchsia-400/15',
    badge:
      'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-400/30 dark:text-fuchsia-300',
  },
  General: {
    solid: 'oklch(0.55 0.02 160)',
    chip: 'bg-muted',
    badge: 'border-border bg-muted text-muted-foreground',
  },
}

/** Solid dot color for an event type (falls back to General). */
export function typeColor(type: string): string {
  return TYPE_TOKENS[type]?.solid ?? TYPE_TOKENS.General.solid
}

export const ALL_TYPES = [
  'Exam',
  'Event',
  'Holiday',
  'Meeting',
  'Competition',
  'Cultural',
  'General',
] as const

export const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

// ─── Pure month-grid helpers ──────────────────────────────────────────

export interface MonthCell {
  /** Day of month. */
  day: number
  /** Full ISO date (YYYY-MM-DD). */
  dateISO: string
  /** True when the cell belongs to the visible month. */
  inMonth: boolean
  /** 0 = same month, -1 = previous, +1 = next (for adjacent-day clicks). */
  monthOffset: number
}

/** Pad 1 → '01'. */
export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function isoOf(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

/**
 * Build the 6×7 (42-cell) month matrix INCLUDING muted adjacent-month
 * days (like modern enterprise calendars) instead of blank spacers.
 * Clicking an adjacent day navigates to that month.
 */
export function buildMonthMatrix(year: number, month0: number): MonthCell[] {
  const firstWeekday = new Date(year, month0, 1).getDay() // 0 = Sunday
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const daysInPrev = new Date(year, month0, 0).getDate()

  const cells: MonthCell[] = []

  // Leading cells — tail of the previous month.
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrev - i
    cells.push({
      day,
      dateISO: month0 === 0 ? isoOf(year - 1, 11, day) : isoOf(year, month0 - 1, day),
      inMonth: false,
      monthOffset: -1,
    })
  }
  // Visible-month cells.
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateISO: isoOf(year, month0, d), inMonth: true, monthOffset: 0 })
  }
  // Trailing cells — head of the next month (fill to 42).
  let next = 1
  while (cells.length < 42) {
    cells.push({
      day: next,
      dateISO: month0 === 11 ? isoOf(year + 1, 0, next) : isoOf(year, month0 + 1, next),
      inMonth: false,
      monthOffset: 1,
    })
    next++
  }
  return cells
}

/** Day-of-month of the canonical today, if it falls in the given month. */
export function getTodayInMonth(year: number, month0: number): number | null {
  const t = todayParts()
  if (t.year === year && t.month === month0) return t.day
  return null
}

// ─── Date formatting (timezone-safe — parses ISO manually) ────────────

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

function parseISO(dateStr: string): { y: number; m: number; d: number } | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) - 1, d: parseInt(m[3], 10) }
}

/** "15 Dec 2025" */
export function formatDayMonthYear(dateStr: string): string {
  const p = parseISO(dateStr)
  if (!p) return dateStr
  return `${p.d} ${MONTH_NAMES[p.m].slice(0, 3)} ${p.y}`
}

/** "Monday" for a YYYY-MM-DD string. */
export function weekdayOf(dateStr: string): string {
  const p = parseISO(dateStr)
  if (!p) return ''
  const dow = new Date(p.y, p.m, p.d).getDay()
  return WEEKDAY_NAMES[dow]
}

/** "15" + "DEC" — compact tile label parts. */
export function formatDayMonth(dateStr: string): { day: string; month: string } {
  const p = parseISO(dateStr)
  if (!p) return { day: '–', month: '' }
  return { day: String(p.d), month: MONTH_NAMES[p.m].slice(0, 3).toUpperCase() }
}

/** "Mon, 15 December 2025" — full readable label. */
export function formatFullDate(dateStr: string): string {
  const p = parseISO(dateStr)
  if (!p) return dateStr
  const wd = weekdayOf(dateStr).slice(0, 3)
  return `${wd}, ${p.d} ${MONTH_NAMES[p.m]} ${p.y}`
}

/** Human time label: "09:00" → "9:00 AM", "—" → "All day". */
export function formatTimeLabel(time: string): string {
  if (!time || time === '—') return 'All day'
  const m = time.match(/^(\d{2}):(\d{2})$/)
  if (!m) return time
  const h = parseInt(m[1], 10)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${suffix}`
}

/** Source label for detail rows. */
export const SOURCE_META: Record<string, { label: string }> = {
  school: { label: 'School event' },
  exam: { label: 'Exam schedule' },
  holiday: { label: 'Official holiday' },
  user: { label: 'Added by you' },
}
