/**
 * CALENDAR-SERVER-EVENTS — the calendar grid is DB-backed regression suite.
 *
 * The bug this pins (this session's module audit, Calendar):
 * the shared Calendar workspace rendered localStorage user events +
 * demo-tier mock corpora while a hardened, tenant-scoped, DB-backed
 * events API existed with ZERO client consumers:
 *   · the grid never fetched GET /api/events — a real tenant saw an
 *     honest-but-empty grid even when the school's events/holidays
 *     lived in SchoolEvent rows;
 *   · Add Event wrote ONLY this browser's localStorage — no
 *     cross-device truth, no permission check, no audit;
 *   · the dashboard "Upcoming Events" card copy claimed events created
 *     in the Calendar module appear there (they never could — the card
 *     read the DB, the module wrote localStorage).
 *
 * Invariants under test:
 *   1. MAPPING: SchoolEvent rows map losslessly to CalendarEvent
 *      (date slice, startTime wall-clock, DB⇄UI type vocabulary,
 *      serverId retained for DELETE).
 *   2. UNIFICATION: server events render for EVERY tenant; the demo
 *      overlay keeps its seed corpora but never duplicates DB holidays.
 *   3. WIRING: the workspace hydrates the feed and passes serverEvents;
 *      Add/Remove go through POST/DELETE /api/events; NO local fallback
 *      event is created on failure.
 *   4. API CONTRACT (live): POST persists time + COMPETITION/CULTURAL
 *      types; GET returns startTime; validation rejects bad time;
 *      DELETE removes tenant-scoped rows (cross-tenant ids 404).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashSessionToken } from '@/lib/auth'
import { REPO_ROOT } from '../helpers/repo-root'

import {
  getUnifiedEvents,
  schoolEventToCalendarEvent,
  UI_TO_DB_TYPE,
  DB_TO_UI_TYPE,
  type SchoolEventDTO,
  type CalendarEvent,
} from '@/lib/store/calendar-store'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

// ─── 1. mapping ───────────────────────────────────────────────────────────

describe('CALENDAR-SERVER · SchoolEvent → CalendarEvent mapping', () => {
  test('date is the UTC slice; startTime is the wall-clock; null time = all-day', () => {
    const ev: SchoolEventDTO = {
      id: 'cuid-1',
      title: 'Annual Day',
      type: 'EVENT',
      startDate: '2026-10-15T00:00:00.000Z',
      startTime: '09:30',
      location: 'Main Ground',
      description: 'All parents invited',
    }
    const c = schoolEventToCalendarEvent(ev)
    expect(c.date).toBe('2026-10-15')
    expect(c.time).toBe('09:30')
    expect(c.title).toBe('Annual Day')
    expect(c.location).toBe('Main Ground')
    expect(c.description).toBe('All parents invited')
    expect(c.serverId).toBe('cuid-1')
    expect(c.source).toBe('school')
    expect(c.type).toBe('Event')
  })

  test('all-day events (startTime null) render time —', () => {
    const c = schoolEventToCalendarEvent({
      id: 'cuid-2', title: 'Winter Break', type: 'HOLIDAY',
      startDate: '2026-12-23T00:00:00.000Z', startTime: null,
    })
    expect(c.time).toBe('—')
    expect(c.type).toBe('Holiday')
    expect(c.source).toBe('holiday')
  })

  test('the full type vocabulary round-trips (UI → DB → UI)', () => {
    for (const ui of ['Event', 'Holiday', 'Exam', 'Meeting', 'Competition', 'Cultural', 'General']) {
      const dbType = UI_TO_DB_TYPE[ui] ?? 'EVENT'
      const c = schoolEventToCalendarEvent({ id: 'x', title: 't', type: dbType, startDate: '2026-01-01T00:00:00.000Z' })
      // 'General' intentionally normalizes to 'Event' (no DB general type)
      if (ui === 'General') expect(c.type).toBe('Event')
      else expect(c.type).toBe(ui)
    }
    // unknown DB types degrade honestly to 'Event', never crash
    const c = schoolEventToCalendarEvent({ id: 'x', title: 't', type: 'WEIRD', startDate: '2026-01-01T00:00:00.000Z' })
    expect(c.type).toBe('Event')
    expect(DB_TO_UI_TYPE['ACTIVITY']).toBe('Event')
  })

  test('a malformed startTime degrades to all-day (never crashes the grid)', () => {
    const c = schoolEventToCalendarEvent({
      id: 'x', title: 't', type: 'EVENT',
      startDate: '2026-01-01T00:00:00.000Z', startTime: '25:99',
    })
    expect(c.time).toBe('—')
  })
})

// ─── 2. unification ───────────────────────────────────────────────────────

const noExams: never[] = []
const noUserEvents: CalendarEvent[] = []

describe('CALENDAR-SERVER · unification (every tenant sees DB rows)', () => {
  test('server events render for a REAL tenant (seed calendar excluded)', () => {
    const server = [schoolEventToCalendarEvent({
      id: 'srv-1', title: 'Science Fair', type: 'EVENT',
      startDate: '2026-10-05T00:00:00.000Z', startTime: '10:00',
    })]
    const events = getUnifiedEvents(2026, 9, noExams, noUserEvents, {
      includeSeedCalendar: false,
      serverEvents: server,
    })
    expect(events.some((e) => e.title === 'Science Fair' && e.serverId === 'srv-1')).toBe(true)
    // no mock corpora leak for a real tenant
    expect(events.every((e) => !e.id.startsWith('holiday-') && !e.id.startsWith('exam-'))).toBe(true)
  })

  test('demo overlay: DB holidays win — mock mirror holidays are dropped, no duplicates', () => {
    // A DB HOLIDAY row for 2026-10-02 (Gandhi Jayanti)…
    const server = [schoolEventToCalendarEvent({
      id: 'srv-h', title: 'Gandhi Jayanti', type: 'HOLIDAY',
      startDate: '2026-10-02T00:00:00.000Z', startTime: null,
    })]
    // …rendered WITH the demo seed calendar on:
    const events = getUnifiedEvents(2026, 9, noExams, noUserEvents, {
      includeSeedCalendar: true,
      serverEvents: server,
    })
    const holidayTitles = events.filter((e) => e.type === 'Holiday').map((e) => e.title)
    // exactly one row for the declared holiday (the DB one, not mirror + DB)
    expect(holidayTitles.filter((t) => t === 'Gandhi Jayanti').length).toBe(1)
    // and no OTHER mirror holidays sneak in alongside the DB feed
    expect(events.filter((e) => e.type === 'Holiday' && !e.serverId).length).toBe(0)
  })

  test('demo overlay: mirror holidays still render while the DB feed has none (loading/empty)', () => {
    const events = getUnifiedEvents(2026, 9, noExams, noUserEvents, {
      includeSeedCalendar: true,
      serverEvents: [],
    })
    // 2026-10-02 Gandhi Jayanti is in the bundled mirror
    expect(events.some((e) => e.type === 'Holiday' && e.date === '2026-10-02')).toBe(true)
  })
})

// ─── 3. wiring (source contract) ─────────────────────────────────────────

describe('CALENDAR-SERVER · client wiring (no more orphan API)', () => {
  test('the store exposes the server slice + the refresh helper', () => {
    const src = read('src/lib/store/calendar-store.ts')
    expect(src).toContain('serverEvents: CalendarEvent[]')
    expect(src).toContain('export async function refreshCalendarServerEvents')
    expect(src).toContain("fetch('/api/events'")
    // the persisted slice is ONLY legacy user events — server rows are fetched
    expect(src).toContain('partialize: (s) => ({ userEvents: s.userEvents })')
  })

  test('the workspace hydrates the feed and passes serverEvents through', () => {
    const src = read('src/components/shared/calendar/calendar-workspace.tsx')
    expect(src).toContain('refreshCalendarServerEvents')
    expect(src).toMatch(/const serverEvents = useCalendarStore\(\(s\) => s\.serverEvents\)/)
    expect(src).toContain('serverStatus === \'error\'') // honest failure banner
    expect(src).toMatch(/serverEvents,\s*\n\s*\}\)\)/)
  })

  test('Add Event posts to the server — no local fallback on failure', () => {
    const src = read('src/components/shared/calendar/add-event-dialog.tsx')
    expect(src).toContain("fetch('/api/events', {\n        method: 'POST'")
    expect(src).toContain('UI_TO_DB_TYPE[type]')
    // fail-closed: the failure branch sets an error, never a store addEvent
    expect(src).not.toMatch(/addEvent\(/)
  })

  test('Event detail removes server events via DELETE (legacy user rows stay local)', () => {
    const src = read('src/components/shared/calendar/event-detail-dialog.tsx')
    expect(src).toContain('handleServerDelete')
    expect(src).toMatch(/\/api\/events\?id=\$\{encodeURIComponent\(event\.serverId\)\}/)
    expect(src).toContain('handleLocalDelete')
    // a failed server delete must NOT remove locally
    expect(src).toContain('Event not removed')
  })
})

// ─── 4. API contract (live) ───────────────────────────────────────────────

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')
let principalToken: string
let schoolId: string | null = null
let createdIds: string[] = []

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

function authed(token: string, init?: RequestInit): RequestInit {
  return { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` } }
}

beforeAll(async () => {
  schoolId = (await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } }))?.id ?? null
  if (!schoolId) throw new Error('demo tenant missing (run prisma/seed-demo.ts)')
  principalToken = await directSession('tenant.principal.a@hawkings.test')
})

afterAll(async () => {
  if (schoolId && createdIds.length) {
    await db.schoolEvent.deleteMany({ where: { schoolId, id: { in: createdIds } } })
  }
  await db.session.deleteMany({ where: { user: { email: 'tenant.principal.a@hawkings.test' } } })
})

describe('CALENDAR-SERVER · POST/GET/DELETE contract', () => {
  test('GET /api/events (principal) → 200 envelope with rows (the grid feed)', async () => {
    const res = await fetch(`${BASE}/api/events`, authed(principalToken))
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  }, 30_000)

  test('POST persists time + COMPETITION type; GET returns startTime', async () => {
    const res = await fetch(
      `${BASE}/api/events`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `IT-CAL Science Fair ${MARKER}`,
          type: 'COMPETITION',
          startDate: '2026-11-05',
          time: '10:30',
          location: 'Main Ground',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { id?: string; startTime?: string | null; type?: string } }
    expect(body.ok).toBe(true)
    expect(body.data?.id).toBeTruthy()
    createdIds.push(body.data!.id!)

    // read back through the SAME endpoint the grid uses
    const get = await fetch(`${BASE}/api/events`, authed(principalToken))
    const list = (await get.json()) as { data?: SchoolEventDTO[] }
    const row = list.data?.find((e) => e.id === body.data?.id)
    expect(row?.startTime).toBe('10:30')
    expect(row?.type).toBe('COMPETITION')
    expect(String(row?.startDate).slice(0, 10)).toBe('2026-11-05')
  }, 45_000)

  test('POST rejects a malformed time (422) — no row created', async () => {
    const res = await fetch(
      `${BASE}/api/events`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `IT-CAL bad time ${MARKER}`, type: 'EVENT', startDate: '2026-11-06', time: '25:99' }),
      }),
    )
    expect([400, 422]).toContain(res.status)
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
    expect(body.ok).not.toBe(true)
  }, 30_000)

  test('POST without time persists an all-day row (startTime null)', async () => {
    const res = await fetch(
      `${BASE}/api/events`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `IT-CAL holiday ${MARKER}`, type: 'HOLIDAY', startDate: '2026-11-12' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => ({}))) as { data?: { id?: string; startTime?: string | null } }
    createdIds.push(body.data!.id!)
    expect(body.data?.startTime ?? null).toBeNull()
  }, 30_000)

  test('DELETE removes the row tenant-scoped; a foreign id answers 404', async () => {
    // create + delete round-trip
    const post = await fetch(
      `${BASE}/api/events`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `IT-CAL to-delete ${MARKER}`, type: 'MEETING', startDate: '2026-11-07', time: '14:00' }),
      }),
    )
    const created = (await post.json()) as { data?: { id?: string } }
    const id = created.data?.id ?? ''
    expect(id).toBeTruthy()

    const del = await fetch(`${BASE}/api/events?id=${id}`, authed(principalToken, { method: 'DELETE' }))
    expect(del.status).toBe(200)
    // gone
    const get = await fetch(`${BASE}/api/events`, authed(principalToken))
    const list = (await get.json()) as { data?: { id?: string }[] }
    expect(list.data?.some((e) => e.id === id)).toBe(false)
    // replay → 404 (fail-safe, no oracle)
    const del2 = await fetch(`${BASE}/api/events?id=${id}`, authed(principalToken, { method: 'DELETE' }))
    expect(del2.status).toBe(404)
    // foreign tenant's event id → 404 (cross-tenant isolation)
    const other = await db.schoolEvent.findFirst({
      where: { schoolId: { not: schoolId! }, type: 'HOLIDAY' },
      select: { id: true },
    })
    if (other) {
      const foreign = await fetch(`${BASE}/api/events?id=${other.id}`, authed(principalToken, { method: 'DELETE' }))
      expect(foreign.status).toBe(404)
      // …and the row survives
      const still = await db.schoolEvent.findUnique({ where: { id: other.id }, select: { id: true } })
      expect(still?.id).toBe(other.id)
    }
  }, 45_000)
})
