/**
 * calendar-store — Unified school calendar events source.
 *
 * Combines event sources into a single CalendarEvent[]:
 *
 *   1. School events   — `calendarEvents` static array (`@/lib/mock/operations`)
 *                        minus any Holiday entries (those come from #2 below,
 *                        which is the canonical school-calendar source of
 *                        truth and resolves the Dec 23 vs Dec 24 inconsistency).
 *   2. Holidays        — `getHoliday(dateStr)` from `@/lib/mock/school-calendar`
 *                        (FIXED_HOLIDAYS + WINTER_BREAK + SUMMER_BREAK).
 *                        Multi-day breaks collapse to a single "Begins" event
 *                        on the first day of the break that falls in the
 *                        visible month (Dec 23 / Jan 1 / Apr 15).
 *   3. Exams           — `useMockExamsStore` schedule items + per-exam
 *                        "Begins" / "Ends" markers on startDate/endDate.
 *   4. User events     — added at runtime via `addEvent` mutation (these
 *                        now persist across reloads, tenant-scoped).
 *
 * FINAL-GATE (EG-9F/R4+R6) — sources #1–#3 are ILLUSTRATIVE demo-tier
 * corpora (R4 register: mock/operations events + mock/school-calendar
 * holidays; R6: mock exams). `getUnifiedEvents` therefore takes an
 * `includeSeedCalendar` option: the shared Calendar module root passes
 * it ONLY for the demo tenant (School.isDemo) — a real production tenant
 * sees its real user events and an honest empty calendar, never the
 * fabricated school/holiday/exam seeds. Exams additionally self-gate:
 * the mock-exams store boots empty for non-demo tenants.
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: ONLY the user-events slice is
 * persisted (per-school namespace) so added/removed events survive reload.
 * School events / holidays / exams are DERIVED from their canonical sources
 * on every render — persisting them would freeze derived data, so they are
 * deliberately excluded from partialize.
 *
 * No circular deps: this file imports `useMockExamsStore` (a Zustand store,
 * not a hook call) only to read its `.getState()` snapshot inside the pure
 * `getUnifiedEvents` helper. The component subscribes to exams reactively
 * and passes the latest `exams` array into the helper.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { calendarEvents } from '@/lib/mock/operations'
import { getHoliday } from '@/lib/mock/school-calendar'
import type { ExamDTO } from '@/lib/exams/types'
import { migrateLegacyScopedStore, createTenantScopedStorage } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-calendar-v1', DEFAULT_TENANT_ID)

// ─── Types ────────────────────────────────────────────────────────────

export type CalendarEventSource = 'school' | 'holiday' | 'exam' | 'user'

export interface CalendarEvent {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  /** Event type — drives the colored dot. See ALL_TYPES in `./data`. */
  type: string
  /** 'HH:MM' (24h) or '—' for all-day events like holidays. */
  time: string
  /** Optional location display (defaults to 'School Campus' in UI). */
  location?: string
  /** Optional notes/description (Add Event form, detail view). */
  description?: string
  source: CalendarEventSource
}

interface CalendarStoreState {
  userEvents: CalendarEvent[]
  addEvent: (input: Omit<CalendarEvent, 'id' | 'source'>) => CalendarEvent
  removeEvent: (id: string) => void
  clearUserEvents: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Format (year, month0, day) → 'YYYY-MM-DD' (no timezone shift). */
function iso(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

/**
 * Holidays for the visible month — derived from the canonical
 * `getHoliday` (single source of truth, see school-calendar.ts).
 *
 * Multi-day breaks (winter / summer) collapse to ONE event on the first
 * day of the break that is in the visible month:
 *   - December + Winter Break (Dec 23 → Jan 1) → Dec 23 "Winter Break Begins"
 *   - January  + Winter Break                → Jan 1 "Winter Break (continues)"
 *   - April    + Summer Break (Apr 15 → May 31) → Apr 15 "Summer Break Begins"
 *   - May      + Summer Break                → no marker (already shown in April)
 */
function getHolidaysForMonth(year: number, month0: number): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = iso(year, month0, day)
    const holiday = getHoliday(dateStr)
    if (!holiday) continue

    // Multi-day breaks — only render the first day that falls in this month.
    if (holiday.type === 'winter-break') {
      const isFirstInMonth =
        (month0 === 11 && day === 23) || // Dec 23 → "Begins"
        (month0 === 0 && day === 1) //     Jan 1 → "continues" (New Year's Day is also a fixed holiday, handled below)
      if (!isFirstInMonth) continue
      events.push({
        id: `holiday-winter-${year}-${month0}-${day}`,
        date: dateStr,
        title: month0 === 11 ? 'Winter Break Begins' : 'Winter Break (continues)',
        type: 'Holiday',
        time: '—',
        source: 'holiday',
      })
      continue
    }
    if (holiday.type === 'summer-break') {
      // Only show "Summer Break Begins" on Apr 15.
      if (!(month0 === 3 && day === 15)) continue
      events.push({
        id: `holiday-summer-${year}-${month0}-${day}`,
        date: dateStr,
        title: 'Summer Break Begins',
        type: 'Holiday',
        time: '—',
        source: 'holiday',
      })
      continue
    }

    // Single-day fixed holidays (Republic Day, Independence Day, Gandhi
    // Jayanti, Christmas, New Year, Karnataka Rajyotsava).
    events.push({
      id: `holiday-${dateStr}`,
      date: dateStr,
      title: holiday.name,
      type: 'Holiday',
      time: '—',
      source: 'holiday',
    })
  }

  return events
}

/**
 * Exam events for the visible month — derived from `useMockExamsStore`.
 * For each exam:
 *   - If startDate is in this month → "<Exam Name> Begins" on startDate
 *   - If endDate   is in this month → "<Exam Name> Ends"   on endDate
 *   - Each schedule item whose date is in this month → "<Exam Name> · <Subject>" on that date
 */
function getExamEventsForMonth(year: number, month0: number, exams: ExamDTO[]): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const exam of exams) {
    if (!exam.startDate || !exam.endDate) continue

    const start = new Date(exam.startDate)
    if (start.getFullYear() === year && start.getMonth() === month0) {
      events.push({
        id: `exam-start-${exam.id}`,
        date: exam.startDate,
        title: `${exam.name} Begins`,
        type: 'Exam',
        time: '09:00',
        location: 'Examination Hall',
        source: 'exam',
      })
    }

    const end = new Date(exam.endDate)
    if (end.getFullYear() === year && end.getMonth() === month0) {
      events.push({
        id: `exam-end-${exam.id}`,
        date: exam.endDate,
        title: `${exam.name} Ends`,
        type: 'Exam',
        time: '15:00',
        location: 'Examination Hall',
        source: 'exam',
      })
    }

    for (const item of exam.schedule) {
      const d = new Date(item.date)
      if (d.getFullYear() === year && d.getMonth() === month0) {
        events.push({
          id: `exam-sch-${item.id}`,
          date: item.date,
          title: `${exam.name} · ${item.subjectName}`,
          type: 'Exam',
          time: item.startTime,
          location: item.room ?? 'Examination Hall',
          source: 'exam',
        })
      }
    }
  }

  return events
}

/**
 * School events from `calendarEvents` — minus any Holiday entries, since
 * holidays come from `school-calendar.ts` (the canonical source of truth,
 * which resolves the Dec 23 vs Dec 24 winter-break date inconsistency).
 *
 * Events outside the visible month are filtered out by the caller via
 * `getUnifiedEvents` (we keep them in the schoolEvents list so the upcoming
 * events panel can show future events from any month).
 */
function getSchoolEvents(): CalendarEvent[] {
  return calendarEvents
    .filter((e) => e.type !== 'Holiday')
    .map((e) => ({
      ...e,
      location: 'School Campus',
      source: 'school' as const,
    }))
}

/**
 * Build the unified events list for the visible month.
 *
 * Pure function — re-runs whenever year/month/exams/userEvents change.
 * Returns events for ALL months (so the upcoming panel can show future
 * events); callers filter to the visible month for the grid.
 *
 * FINAL-GATE (EG-9F) — `opts.includeSeedCalendar` (default true for
 * backwards compatibility) gates the ILLUSTRATIVE school-events +
 * holidays corpora: the shared Calendar module root passes `true` only
 * for the demo tenant. Exam events arrive via the (demo-gated) mock
 * exams store; user events are always the tenant's own real records.
 */
export function getUnifiedEvents(
  year: number,
  month0: number,
  exams: ExamDTO[],
  userEvents: CalendarEvent[],
  opts: { includeSeedCalendar?: boolean } = {},
): CalendarEvent[] {
  const includeSeed = opts.includeSeedCalendar !== false
  return [
    ...(includeSeed ? getSchoolEvents() : []),
    ...(includeSeed ? getHolidaysForMonth(year, month0) : []),
    ...getExamEventsForMonth(year, month0, exams),
    ...userEvents,
  ]
}

/** Format a Date as 'YYYY-MM-DD' (no timezone shift). */
export function formatISODate(d: Date): string {
  return iso(d.getFullYear(), d.getMonth(), d.getDate())
}

// ─── Zustand store ────────────────────────────────────────────────────

export const useCalendarStore = create<CalendarStoreState>()(
  persist(
    (set) => ({
      userEvents: [],
      addEvent: (input) => {
        const event: CalendarEvent = {
          ...input,
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          source: 'user',
        }
        set((s) => ({ userEvents: [...s.userEvents, event] }))
        return event
      },
      removeEvent: (id) => set((s) => ({ userEvents: s.userEvents.filter((e) => e.id !== id) })),
      clearUserEvents: () => set({ userEvents: [] }),
    }),
    {
      name: 'scholario-calendar-v1',
      storage: createTenantScopedStorage('scholario-calendar-v1'),
      version: 1,
      // QA-FIX-B — ONLY user-created events are persisted; school/holiday/
      // exam events are derived from canonical sources at render time and
      // must not be frozen by persistence.
      partialize: (s) => ({ userEvents: s.userEvents }),
    },
  ),
)
