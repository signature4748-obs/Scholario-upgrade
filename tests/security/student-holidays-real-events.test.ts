/**
 * STUDENT-HOLIDAYS — real DB holiday feed + Mon–Sat week regression suite.
 *
 * The bugs this pins (audit F2, student side):
 *
 *   1. FROZEN MIRROR: student Attendance (date-utils) and Timetable
 *      (time-utils) resolved holidays ONLY from the bundled client mirror
 *      (mock/school-calendar DECLARED_SESSION_HOLIDAYS session 2026-27) —
 *      every tenant saw the same hardcoded holidays regardless of their
 *      real DB SchoolEvent rows, while the principal heatmap already used
 *      the Phase-B real feed (GET /api/events?type=HOLIDAY).
 *   2. SATURDAY: date-utils treated Sat+Sun as 'weekend' although the
 *      school's timetable runs Mon–Sat (DB Timetable DAY_ORDER; the
 *      module's own header says Mon–Sat) — Saturdays with classes
 *      rendered as 'weekend' and were excluded from workingDaysInMonth.
 *
 * Invariants under test:
 *
 *   1. SHARED FEED: one authoritative hook (src/lib/hooks/use-school-holidays)
 *      feeds BOTH planes; the principal module re-exports it (no duplicate
 *      copy); the holiday expansion logic is date-range aware.
 *   2. STUDENT WIRING: the student Attendance module and the Timetable
 *      class-view subscribe the shared hook and pass the map into the
 *      resolvers (grid/working-days/today-status/next-school-day).
 *   3. SEMANTICS (pure functions):
 *      · a DB-only holiday date renders 'holiday' with its real name;
 *        a mirror-only date does NOT render holiday when the DB map is
 *        provided (the map is authoritative once fetched)
 *      · Sunday renders 'weekend'; SATURDAY renders as a school day
 *        ('norecord' when unrecorded — honest), and Saturdays count in
 *        workingDaysInMonth
 *      · nextScheduledDay skips DB-known holidays
 *   4. API CONTRACT (live): GET /api/events?type=HOLIDAY (student session)
 *      answers 200 with SchoolEvent rows — the endpoint the shared feed
 *      fetches is student-accessible.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashSessionToken } from '@/lib/auth'
import { REPO_ROOT } from '../helpers/repo-root'

import { holidaysFromEvents, type HolidayEvent } from '@/lib/hooks/use-school-holidays'
import {
  resolveDay,
  workingDaysInMonth,
  buildMonthGrid,
} from '@/components/student/modules/attendance/date-utils'
import { nextScheduledDay, holidayName, type DayType } from '@/components/student/modules/timetable/time-utils'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

// ─── 1. shared feed ───────────────────────────────────────────────────────

describe('STUDENT-HOLIDAYS · one shared DB holiday feed for both planes', () => {
  test('the shared hook module exists with the expansion + cache + hook', () => {
    const src = read('src/lib/hooks/use-school-holidays.ts')
    expect(src).toContain("fetch('/api/events?type=HOLIDAY'")
    expect(src).toContain('export function useSchoolHolidays')
    expect(src).toContain('export function holidaysFromEvents')
  })

  test('the principal module re-exports the shared feed (no duplicate copy)', () => {
    const src = read('src/components/principal/modules/attendance/data.tsx')
    expect(src).toContain("from '@/lib/hooks/use-school-holidays'")
    expect(src).toMatch(/export \{ holidaysFromEvents, useSchoolHolidays/)
    // the duplicated local implementation is gone
    expect(src).not.toMatch(/let cachedHolidays/)
  })

  test('holidaysFromEvents expands inclusive ranges (bounded)', () => {
    const events: HolidayEvent[] = [
      { title: 'Founders Day', startDate: '2026-09-01', endDate: '2026-09-03' },
      { title: 'Single Day', startDate: '2027-03-05' },
    ]
    const map = holidaysFromEvents(events)
    expect(map['2026-09-01']?.name).toBe('Founders Day')
    expect(map['2026-09-02']?.name).toBe('Founders Day')
    expect(map['2026-09-03']?.name).toBe('Founders Day')
    expect(map['2026-09-04']).toBeUndefined()
    expect(map['2027-03-05']?.name).toBe('Single Day')
    // malformed dates are skipped, never crash
    expect(holidaysFromEvents([{ title: 'bad', startDate: 'nope' }])).toEqual({})
  })
})

// ─── 2. student wiring (source contract) ──────────────────────────────────

describe('STUDENT-HOLIDAYS · student surfaces consume the real feed', () => {
  test('student Attendance subscribes useSchoolHolidays and passes the map', () => {
    const src = read('src/components/student/modules/attendance/index.tsx')
    expect(src).toContain("import { useSchoolHolidays } from '@/lib/hooks/use-school-holidays'")
    expect(src).toMatch(/const holidays = useSchoolHolidays\(\)/)
    expect(src).toMatch(/buildMonthGrid\(cursor, byDate, todayIso, holidays\)/)
    expect(src).toMatch(/workingDaysInMonth\(cursor, holidays\)/)
    expect(src).toMatch(/resolveDay\(todayIso, byDate, todayIso, holidays\)/)
  })

  test('student Timetable class-view subscribes and passes the map', () => {
    const src = read('src/components/student/modules/timetable/class-view.tsx')
    expect(src).toContain("import { useSchoolHolidays } from '@/lib/hooks/use-school-holidays'")
    expect(src).toMatch(/holidayName\(new Date\(\), holidays\)/)
    expect(src).toMatch(/nextScheduledDay\(new Date\(\), new Set\(scheduledDays\), holidays\)/)
  })
})

// ─── 3. semantics (pure functions) ────────────────────────────────────────

describe('STUDENT-HOLIDAYS · resolver semantics (DB map authoritative, Mon–Sat week)', () => {
  const byDate = new Map<string, never>()
  const todayIso = '2026-09-30'
  const dbMap = holidaysFromEvents([{ title: 'School Foundation Day', startDate: '2026-09-10' }])

  test('a DB-only holiday renders holiday with the real name', () => {
    const cell = resolveDay('2026-09-10', byDate, todayIso, dbMap)
    expect(cell.kind).toBe('holiday')
    expect(cell.holidayName).toBe('School Foundation Day')
  })

  test('the DB map is authoritative once provided (mirror-only dates do NOT render holiday)', () => {
    // 2026-10-02 (Gandhi Jayanti) is in the bundled mirror. With the DB
    // map provided and NOT containing it, the resolver must trust the DB.
    const cell = resolveDay('2026-10-02', byDate, '2026-10-30', dbMap)
    expect(cell.kind).not.toBe('holiday')
  })

  test('mirror fallback still works while the DB map is loading (undefined)', () => {
    const cell = resolveDay('2026-10-02', byDate, '2026-10-30', undefined)
    expect(cell.kind).toBe('holiday')
  })

  test('Sunday renders weekend; SATURDAY is a school day (honest no-record)', () => {
    // 2026-09-12 is a Saturday; 2026-09-13 is a Sunday.
    const sat = resolveDay('2026-09-12', byDate, todayIso, dbMap)
    const sun = resolveDay('2026-09-13', byDate, todayIso, dbMap)
    expect(sat.kind).toBe('norecord') // was 'weekend' — the Saturday bug
    expect(sun.kind).toBe('weekend')
  })

  test('workingDaysInMonth counts Mon–Sat minus holidays', () => {
    // September 2026: 30 days, 4 Sundays (6,13,20,27), one DB holiday on
    // Thu 2026-09-10 → 30 - 4 - 1 = 25 working days with the DB map.
    expect(workingDaysInMonth({ y: 2026, m: 9 }, dbMap)).toBe(25)
    // Without the map the mirror's Sept holidays apply (Janmashtami
    // 2026-09-04): 30 - 4 - 1 = 25 as well but for the mirror's date —
    // assert the mirror path ALSO excludes Saturdays (the old code
    // returned 21: 30 - 8 weekend days - 1).
    expect(workingDaysInMonth({ y: 2026, m: 9 }, undefined)).toBe(25)
  })

  test('buildMonthGrid renders Saturdays as school cells (not weekend)', () => {
    const grid = buildMonthGrid({ y: 2026, m: 9 }, byDate, todayIso, dbMap)
    const satCell = grid.find((c) => c.iso === '2026-09-12')
    expect(satCell?.kind).not.toBe('weekend')
  })

  test('nextScheduledDay skips DB-known holidays', () => {
    const scheduled = new Set<DayType>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
    // From Wed 2026-09-09 with a holiday on Thu 2026-09-10 (DB map):
    // next school day must be Friday 2026-09-11.
    const next = nextScheduledDay(new Date(2026, 8, 9), scheduled, dbMap)
    expect(next?.day).toBe('Friday')
    expect(next?.date.getDate()).toBe(11)
  })

  test('holidayName prefers the DB map', () => {
    expect(holidayName(new Date(2026, 8, 10), dbMap)).toBe('School Foundation Day')
    expect(holidayName(new Date(2026, 8, 10), undefined)).toBeNull() // not in the mirror
  })
})

// ─── 4. API contract (live, student session) ──────────────────────────────

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')
let studentToken: string
let eventId: string | null = null
let schoolId: string | null = null

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

beforeAll(async () => {
  // Reuse the demo tenant's seeded student (tenant.student.a@hawkings.test)
  // and a real HOLIDAY SchoolEvent row (created if missing, swept after).
  schoolId = (await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } }))?.id ?? null
  if (!schoolId) throw new Error('demo tenant missing (run prisma/seed-demo.ts)')
  const iso = '2026-09-10'
  const existing = await db.schoolEvent.findFirst({ where: { schoolId, type: 'HOLIDAY', startDate: new Date(`${iso}T00:00:00.000Z`) }, select: { id: true } })
  if (!existing) {
    await db.schoolEvent.create({
      data: {
        schoolId,
        title: `IT-HOL Foundation Day ${MARKER}`,
        type: 'HOLIDAY',
        startDate: new Date(`${iso}T00:00:00.000Z`),
        audience: 'ALL',
      },
    })
  }
  studentToken = await directSession('tenant.student.a@hawkings.test')
})

afterAll(async () => {
  if (schoolId) {
    await db.schoolEvent.deleteMany({ where: { schoolId, title: { startsWith: `IT-HOL Foundation Day ${MARKER}` } } })
  }
  await db.session.deleteMany({ where: { user: { email: 'tenant.student.a@hawkings.test' } } })
})

describe('STUDENT-HOLIDAYS · the feed endpoint is student-accessible', () => {
  test('GET /api/events?type=HOLIDAY (student session) → 200 with rows', async () => {
    const res = await fetch(`${BASE}/api/events?type=HOLIDAY`, {
      headers: { authorization: `Bearer ${studentToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })
})
