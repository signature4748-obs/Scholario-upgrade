/**
 * calendar-store — Unified school calendar events source.
 *
 * Combines event sources into a single CalendarEvent[]:
 *
 *   1. Server events   — `GET /api/events` (SchoolEvent rows, DB truth):
 *                        school events + declared holidays for EVERY tenant,
 *                        hydrated once per session via refreshCalendarServerEvents().
 *                        Writes go through POST/DELETE /api/events — added or
 *                        removed events are cross-device, server-authoritative.
 *   2. School events   — `calendarEvents` static array (`@/lib/mock/operations`)
 *                        minus Holiday entries. DEMO TENANT ONLY (seed calendar).
 *   3. Holidays        — DB HOLIDAY rows (source #1) are canonical; the bundled
 *                        `getHoliday` mirror renders only for the demo tenant
 *                        overlay EXCEPT it no longer duplicates — see
 *                        getUnifiedEvents (DB wins, mirror holidays dropped
 *                        when server events are present).
 *   4. Exams           — `useMockExamsStore` schedule items (demo tenants only).
 *   5. User events     — LEGACY localStorage records (pre-server-wiring era).
 *                        Still rendered (they are the user's real local data)
 *                        but new events go to the server; removal of legacy
 *                        rows stays local.
 *
 * FINAL-GATE (EG-9F/R4+R6) — sources #2–#4 are ILLUSTRATIVE demo-tier
 * corpora (R4 register: mock/operations events + mock/school-calendar
 * holidays; R6: mock exams). `getUnifiedEvents` therefore takes an
 * `includeSeedCalendar` option: the shared Calendar module root passes
 * it ONLY for the demo tenant (School.isDemo) — a real production tenant
 * sees its real server events (DB) and an honest empty calendar otherwise.
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: ONLY the user-events slice is
 * persisted (per-school namespace) so pre-wiring events survive reload.
 * Server events are fetched — persisting them would freeze derived data.
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
  /** Present when the event came from GET /api/events — the SchoolEvent row
   *  id, used for server DELETE. Absent for demo corpora + legacy user rows. */
  serverId?: string
}

/** DB SchoolEvent row as returned by GET /api/events (subset we consume). */
export interface SchoolEventDTO {
  id: string
  title: string
  description?: string | null
  type: string
  startDate: string
  endDate?: string | null
  startTime?: string | null
  location?: string | null
}

// ─── DB ⇄ UI type vocabulary ─────────────────────────────────────────────

/** UI type pill → DB SchoolEvent.type (POST payload). */
export const UI_TO_DB_TYPE: Record<string, string> = {
  Event: 'EVENT',
  Holiday: 'HOLIDAY',
  Exam: 'EXAM',
  Meeting: 'MEETING',
  Competition: 'COMPETITION',
  Cultural: 'CULTURAL',
  General: 'EVENT',
}

/** DB SchoolEvent.type → UI type pill (GET mapping; unknown → 'Event'). */
export const DB_TO_UI_TYPE: Record<string, string> = {
  EVENT: 'Event',
  HOLIDAY: 'Holiday',
  EXAM: 'Exam',
  MEETING: 'Meeting',
  ACTIVITY: 'Event',
  COMPETITION: 'Competition',
  CULTURAL: 'Cultural',
}

/**
 * SchoolEvent row → CalendarEvent.
 *
 * · date: the UTC date slice of startDate ('YYYY-MM-DD') — matches the
 *   seed convention (dates stored as UTC midnights) and the shared
 *   holiday feed (`use-school-holidays.ts`).
 * · time: `startTime` ('HH:MM') or '—' (all-day).
 * · type: DB → UI vocabulary; source 'school' (DB HOLIDAY rows render as
 *   the same 'Holiday' pill the demo mirror used).
 */
export function schoolEventToCalendarEvent(ev: SchoolEventDTO): CalendarEvent {
  const date = String(ev.startDate).slice(0, 10)
  const time = ev.startTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(ev.startTime) ? ev.startTime : '—'
  const rawType = String(ev.type ?? 'EVENT').toUpperCase()
  const type = DB_TO_UI_TYPE[rawType] ?? 'Event'
  return {
    id: `server-${ev.id}`,
    serverId: ev.id,
    date,
    title: ev.title,
    type,
    time,
    location: ev.location ?? undefined,
    description: ev.description ?? undefined,
    source: type === 'Holiday' ? 'holiday' : 'school',
  }
}

interface CalendarStoreState {
  userEvents: CalendarEvent[]
  addEvent: (input: Omit<CalendarEvent, 'id' | 'source'>) => CalendarEvent
  removeEvent: (id: string) => void
  clearUserEvents: () => void
  /** DB rows (GET /api/events) mapped to CalendarEvent — every tenant. */
  serverEvents: CalendarEvent[]
  /** 'idle' | 'loading' | 'ready' | 'error' — the server feed state. */
  serverStatus: 'idle' | 'loading' | 'ready' | 'error'
  hydrateServerEvents: (events: CalendarEvent[], status: 'ready' | 'error') => void
  setServerStatus: (status: 'idle' | 'loading' | 'ready' | 'error') => void
  removeServerEvent: (serverId: string) => void
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
 * for the demo tenant. `opts.serverEvents` (the DB rows) render for
 * EVERY tenant — they are the school's real calendar. When server events
 * are present the demo overlay DROPS its mock holiday entries so DB
 * HOLIDAY rows are not duplicated (DB wins; the attendance heatmap and
 * the student month grid already treat the DB feed as authoritative).
 */
export function getUnifiedEvents(
  year: number,
  month0: number,
  exams: ExamDTO[],
  userEvents: CalendarEvent[],
  opts: { includeSeedCalendar?: boolean; serverEvents?: CalendarEvent[] } = {},
): CalendarEvent[] {
  const includeSeed = opts.includeSeedCalendar !== false
  const serverEvents = opts.serverEvents ?? []
  const seedHolidays = includeSeed
    ? getHolidaysForMonth(year, month0).filter(() => {
        // DB wins: once server rows are loaded, mirror holidays would
        // duplicate every declared HOLIDAY row — keep the overlay only
        // while the server feed has not produced any holiday entry.
        return !serverEvents.some((s) => s.type === 'Holiday')
      })
    : []
  return [
    ...serverEvents,
    ...(includeSeed ? getSchoolEvents() : []),
    ...seedHolidays,
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
      serverEvents: [],
      serverStatus: 'idle',
      hydrateServerEvents: (events, status) =>
        set({ serverEvents: events, serverStatus: status }),
      setServerStatus: (status) => set({ serverStatus: status }),
      removeServerEvent: (serverId) =>
        set((s) => ({ serverEvents: s.serverEvents.filter((e) => e.serverId !== serverId) })),
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
      // QA-FIX-B — ONLY user-created events are persisted; server events
      // are fetched (derived), seed events are demo-only — neither must be
      // frozen by persistence.
      partialize: (s) => ({ userEvents: s.userEvents }),
    },
  ),
)

// ─── Server feed (GET /api/events) ─────────────────────────────────────

/**
 * Fetch the school's events (all types) and hydrate the store.
 * Fail-closed: on transport/HTTP failure the store keeps its previous
 * serverEvents and flips serverStatus to 'error' (the workspace shows an
 * honest retry banner — never fabricated data). Callers: the workspace on
 * mount, the Add/Remove dialogs after successful mutations.
 */
export async function refreshCalendarServerEvents(): Promise<CalendarEvent[]> {
  const store = useCalendarStore.getState()
  store.setServerStatus('loading')
  try {
    const res = await fetch('/api/events', { cache: 'no-store', credentials: 'same-origin' })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON body — handled below */
    }
    const envelope = json as { ok?: unknown; data?: SchoolEventDTO[] } | null
    if (!res.ok || !envelope || envelope.ok !== true || !Array.isArray(envelope.data)) {
      throw new Error(`events feed failed (${res.status})`)
    }
    const events = envelope.data.map(schoolEventToCalendarEvent)
    useCalendarStore.getState().hydrateServerEvents(events, 'ready')
    return events
  } catch {
    useCalendarStore.getState().setServerStatus('error')
    return useCalendarStore.getState().serverEvents
  }
}
