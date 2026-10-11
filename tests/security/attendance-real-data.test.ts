/**
 * PHASE B (real-data QA) — ATTENDANCE REAL-DATA REGRESSION SUITE.
 *
 * The invariants under test (the principal Attendance module's new
 * per-class surface + the hardened write APIs):
 *
 *   1. PER-CLASS OVERVIEW is database-backed and tenant-scoped:
 *      · ?classId= of the CALLER's class → 200 with the real shape
 *        (one summary row labeled with the Class row's name, a real
 *        per-student roster for the latest recorded day)
 *      · day NORMALIZATION: legacy rows with time-of-day components on
 *        the same student-day collapse to ONE record (last-write-wins)
 *        — in the day series, in the totals AND in the roster
 *      · a FOREIGN tenant's classId → safe 404 (no existence oracle)
 *      · an unknown classId → 404
 *      · unauthenticated → 401; STUDENT role → 403 (staff-only surface)
 *      · a class with ZERO rows → honest empty (all-zero today, empty
 *        arrays, no fabricated rates or roster)
 *   2. READ day normalization: GET /api/attendance?date=YYYY-MM-DD uses
 *      the UTC day window (legacy time-of-day rows are captured) and a
 *      malformed date is a 400, never a Prisma 500.
 *   3. WRITE duplicate prevention: POST /api/attendance upserts at the
 *      DAY level — a legacy row at 14:30 UTC and a new POST for the same
 *      student-day produce exactly ONE row (updated, never duplicated).
 *   4. STUDENT IDENTITY (canonical DB record): /api/auth/me returns the
 *      logged-in student's DB name + me.student.{classLabel, rollNo,
 *      admissionNo} matching the Student/Class rows — the server side
 *      of the sidebar/dashboard identity-mismatch fix.
 *
 * AUTH: direct session rows (the standard integration-test fixture —
 * bypasses ONLY the login rate limiter, never an authorization gate).
 *
 * FIXTURES: marker-namespaced class + students + attendance rows in
 * School A (hawkings-prithvipur, the demo tenant) + one class in
 * School B (green-valley) for the cross-tenant probe. Everything is
 * swept in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')

// ─── fixture state ───────────────────────────────────────────────────────

const dayKey = '2026-09-21' // a PAST day (IST future-guard safe)
const dayWithTime = new Date('2026-09-21T14:30:00.000Z') // legacy writer shape
const dayStart = new Date(`${dayKey}T00:00:00.000Z`)

interface Fixtures {
  schoolA: string
  schoolB: string
  classA: { id: string; name: string }
  classB: { id: string; name: string }
  students: { id: string; userId: string; name: string; rollNo: string }[]
}

let fx: Fixtures

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

let principalToken: string
let studentToken: string

async function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

async function envelope(res: Response): Promise<{ ok?: boolean; data?: Record<string, unknown>; error?: string }> {
  return (await res.json().catch(() => ({}))) as { ok?: boolean; data?: Record<string, unknown>; error?: string }
}

/**
 * The sandbox→Supavisor connection path is intermittently flaky
 * ("FATAL: (ENOTFOUND) tenant/user not found" on fresh connections — an
 * infrastructure artifact, NOT a code issue; production Vercel uses the
 * session pooler with proper TLS). Retry the whole setup: each attempt
 * sweeps any marker leftovers first, so re-running is idempotent.
 */
async function withSetupRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  throw lastError
}

async function setupOnce(): Promise<void> {
  const schoolA = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  const schoolB = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!schoolA || !schoolB) throw new Error('tenant fixture schools missing (run prisma/seed-tenant-isolation.ts)')

  // Test classes in both schools (marker-namespaced).
  const classA = await db.class.create({
    data: { schoolId: schoolA.id, name: `IT-ATT ${MARKER} A`, gradeLevel: '9', section: 'A' },
  })
  const classB = await db.class.create({
    data: { schoolId: schoolB.id, name: `IT-ATT ${MARKER} B`, gradeLevel: '9', section: 'B' },
  })

  // A marker PRINCIPAL (school A) for authenticated API calls — self
  // contained, mustChangePassword defaults false (the shared tenant.*
  // fixture accounts carry the bootstrap must-change gate and would 403).
  const principal = await db.user.create({
    data: {
      email: `it-att-${MARKER}-principal@hawkings.test`,
      name: `IT Att Principal ${MARKER}`,
      role: 'PRINCIPAL',
      schoolId: schoolA.id,
      status: 'ACTIVE',
      passwordHash: 'x',
    },
  })

  // Two students in the A class with User rows (roster names). Student 0
  // doubles as the identity-test subject (/api/auth/me canonical record).
  const students: Fixtures['students'] = []
  for (const [i, rollNo] of ['01', '02'].entries()) {
    const email = `it-att-${MARKER}-${i}@hawkings.test`
    const u = await db.user.create({
      data: { email, name: `IT Att Student ${MARKER} ${i}`, role: 'STUDENT', schoolId: schoolA.id, status: 'ACTIVE', passwordHash: 'x' },
    })
    const s = await db.student.create({
      data: { schoolId: schoolA.id, userId: u.id, classId: classA.id, rollNo, admissionNo: `ITATT${MARKER}${i}` },
    })
    students.push({ id: s.id, userId: u.id, name: u.name, rollNo })
  }

  // Attendance rows: one row per (student, day). NOTE: the Attendance
  // column is PG native DATE (@db.Date) with @@unique([studentId, date])
  // — the DB itself guarantees day-level identity; a time-of-day value
  // (dayWithTime) is truncated to the calendar day on write. The API's
  // day-window logic is defense-in-depth ON TOP of that guarantee.
  // Student 1: a row written with a TIME component (exercises the
  // truncation + the read/write day windows); student 2: canonical.
  await db.attendance.createMany({
    data: [
      { schoolId: schoolA.id, studentId: students[0].id, classId: classA.id, date: dayWithTime, status: 'PRESENT', markedBy: 'IT-ATT canonical' },
      { schoolId: schoolA.id, studentId: students[1].id, classId: classA.id, date: dayStart, status: 'LATE', markedBy: 'IT-ATT canonical' },
    ],
  })

  principalToken = await directSession(principal.email)
  studentToken = await directSession(`it-att-${MARKER}-0@hawkings.test`)

  fx = {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    classA: { id: classA.id, name: classA.name },
    classB: { id: classB.id, name: classB.name },
    students,
  }
}

beforeAll(async () => {
  await withSetupRetry(async () => {
    // Sweep any leftovers from a crashed prior attempt first (the marker
    // namespace is exclusive to this suite — see afterAll for the sweep).
    await sweep()
    await setupOnce()
  })
})

async function sweep(): Promise<void> {
  // Sweep everything this suite created (crashed prior runs included —
  // the IT-ATT marker is this suite's exclusive namespace).
  const classes = await db.class.findMany({ where: { name: { startsWith: `IT-ATT ${MARKER}` } }, select: { id: true } })
  const classIds = classes.map((c) => c.id)
  if (classIds.length > 0) {
    await db.attendance.deleteMany({ where: { classId: { in: classIds } } })
    await db.student.deleteMany({ where: { classId: { in: classIds } } })
    await db.class.deleteMany({ where: { id: { in: classIds } } })
  }
  await db.session.deleteMany({ where: { user: { email: { startsWith: `it-att-${MARKER}` } } } })
  await db.user.deleteMany({ where: { email: { startsWith: `it-att-${MARKER}` } } })
  await db.attendance.deleteMany({ where: { markedBy: { startsWith: 'IT-ATT' } } })
}

afterAll(async () => {
  await withSetupRetry(sweep)
})

// ─── 1. per-class overview (database-backed, tenant-scoped) ──────────────

describe('PHASE-B attendance · per-class overview (real data)', () => {
  test('scoped overview → real summary row + real roster, day-normalized', async () => {
    const res = await as(principalToken, `/api/attendance/overview?classId=${fx.classA.id}`)
    expect(res.status).toBe(200)
    const body = await envelope(res)
    expect(body.ok).toBe(true)
    const data = body.data as Record<string, never>

    // Exactly ONE summary row, labeled with the CLASS row's own name.
    const byClass = (data as { byClass?: { class: string; rate: number; students: number; records: number }[] }).byClass ?? []
    expect(byClass.length).toBe(1)
    expect(byClass[0]?.class).toBe(fx.classA.name)

    // Day normalization: student 1's row was WRITTEN with a 14:30 time
    // component — the native DATE column truncates to the calendar day,
    // and the API's UTC day grouping counts it on the right day. Totals
    // reflect 2 distinct students.
    const today = (data as { today?: { present: number; absent: number; late: number; total: number; date: string | null } }).today
    expect(today?.date).toBe(dayKey)
    expect(today?.total).toBe(2)
    expect(today?.present).toBe(1) // student 1 (row written with a time component)
    expect(today?.late).toBe(1) // student 2

    // records = student-DAYS (2) — the dedupe contract.
    expect(byClass[0]?.records).toBe(2)
    expect(byClass[0]?.students).toBe(2)

    // The REAL roster: one entry per student, names from the User rows,
    // roll numbers from the Student rows.
    const roster = (data as { roster?: { rollNo: string; name: string; status: string }[] }).roster ?? []
    expect(roster.length).toBe(2)
    const byRoll = new Map(roster.map((r) => [r.rollNo, r]))
    expect(byRoll.get('01')?.name).toBe(fx.students[0].name)
    expect(byRoll.get('01')?.status).toBe('PRESENT')
    expect(byRoll.get('02')?.status).toBe('LATE')

    // Class scope metadata for the UI.
    const classInfo = (data as { class?: { id: string; name: string; teacher: string | null } }).class
    expect(classInfo?.id).toBe(fx.classA.id)
    expect(classInfo?.name).toBe(fx.classA.name)

    // The scoped daily series exists and the day's rate uses the same
    // honest denominator.
    const daily = (data as { daily?: { date: string; total: number }[] }).daily ?? []
    expect(daily.find((d) => d.date === dayKey)?.total).toBe(2)
  })

  test('foreign tenant classId → safe 404 (no existence oracle)', async () => {
    const res = await as(principalToken, `/api/attendance/overview?classId=${fx.classB.id}`)
    expect([403, 404]).toContain(res.status)
    const text = await res.clone().text()
    expect(text.toLowerCase()).not.toContain('prisma')
    expect(text).not.toContain(fx.classB.id)
    expect(text).not.toContain(fx.classB.name)
  })

  test('unknown classId → 404', async () => {
    const res = await as(principalToken, `/api/attendance/overview?classId=cls_${MARKER}_nonexistent`)
    expect(res.status).toBe(404)
    const body = await envelope(res)
    expect(body.ok).toBe(false)
  })

  test('unauthenticated → 401', async () => {
    const res = await fetch(`${BASE}/api/attendance/overview?classId=${fx.classA.id}`)
    expect(res.status).toBe(401)
  })

  test('STUDENT role → 403 (staff-only surface)', async () => {
    const res = await as(studentToken, `/api/attendance/overview?classId=${fx.classA.id}`)
    expect(res.status).toBe(403)
  })

  test('empty class → honest empty (all-zero today, no fabricated roster)', async () => {
    // A class in the caller's school with ZERO attendance rows.
    const emptyClass = await db.class.create({
      data: { schoolId: fx.schoolA, name: `IT-ATT ${MARKER} EMPTY`, gradeLevel: '10' },
    })
    try {
      const res = await as(principalToken, `/api/attendance/overview?classId=${emptyClass.id}`)
      expect(res.status).toBe(200)
      const body = await envelope(res)
      expect(body.ok).toBe(true)
      const data = body.data as {
        today?: { total: number; rate: number; date: string | null }
        byClass?: { records: number; students: number; rate: number }[]
        roster?: unknown[]
      }
      expect(data.today?.total).toBe(0)
      expect(data.today?.rate).toBe(0)
      expect(data.today?.date).toBeNull()
      expect(data.byClass?.[0]?.records).toBe(0)
      expect(data.byClass?.[0]?.students).toBe(0)
      expect(data.roster ?? []).toEqual([])
    } finally {
      await db.class.delete({ where: { id: emptyClass.id } })
    }
  })
})

// ─── 2. read day normalization + date validation ─────────────────────────

describe('PHASE-B attendance · GET date normalization + validation', () => {
  test('malformed date → honest 4xx (never a Prisma 500)', async () => {
    const res = await as(principalToken, '/api/attendance?date=not-a-date-at-all')
    // The bug this pins: a malformed date used to become an Invalid Date →
    // Prisma 500. Any honest 4xx (INVALID_INPUT maps to 422) is the fix.
    expect([400, 422]).toContain(res.status)
    const body = await envelope(res)
    expect(body.ok).toBe(false)
  })

  test('date=YYYY-MM-DD captures legacy time-of-day rows (day window)', async () => {
    const res = await as(principalToken, `/api/attendance?date=${dayKey}&classId=${fx.classA.id}`)
    expect(res.status).toBe(200)
    const body = await envelope(res)
    const rows = (body.data as unknown[] | undefined) ?? []
    // Both students' rows are returned — including the one WRITTEN with a
    // 14:30 time component (the day window captures it on its calendar day).
    expect(rows.length).toBe(2)
  })
})

// ─── 3. write duplicate prevention (day-level upsert) ─────────────────────

describe('PHASE-B attendance · POST day-level duplicate prevention', () => {
  test('re-marking an existing student-day UPDATES it — exactly one row after the write', async () => {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const countBefore = await db.attendance.count({
      where: { studentId: fx.students[0].id, date: { gte: dayStart, lt: dayEnd } },
    })
    expect(countBefore).toBe(1) // the pre-created row (written with a time component)

    const res = await as(principalToken, '/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        classId: fx.classA.id,
        date: dayKey,
        entries: [{ studentId: fx.students[0].id, status: 'LEAVE' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await envelope(res)
    expect(body.ok).toBe(true)

    // DAY-level invariant: the day window holds EXACTLY ONE row whose
    // status is the new write (updated, never duplicated — the DB unique
    // + the API's day-window upsert agree).
    const rowsAfter = await db.attendance.findMany({
      where: { studentId: fx.students[0].id, date: { gte: dayStart, lt: dayEnd } },
      select: { status: true },
    })
    expect(rowsAfter.length).toBe(1)
    expect(rowsAfter[0]?.status).toBe('LEAVE')
  })

  test('cross-tenant class write → safe 404, nothing written', async () => {
    const res = await as(principalToken, '/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        classId: fx.classB.id,
        date: dayKey,
        entries: [{ studentId: fx.students[0].id, status: 'PRESENT' }],
      }),
    })
    expect([403, 404]).toContain(res.status)
    const count = await db.attendance.count({ where: { classId: fx.classB.id } })
    expect(count).toBe(0)
  })
})

// ─── 4. student identity (canonical DB record) ───────────────────────────

describe('PHASE-B student identity · /api/auth/me is the canonical record', () => {
  test('me.name + me.student.{classLabel, rollNo, admissionNo} match the DB rows', async () => {
    const res = await as(studentToken, '/api/auth/me')
    expect(res.status).toBe(200)
    const body = await envelope(res)
    expect(body.ok).toBe(true)
    const me = (body.data as {
      user?: {
        name?: string
        student?: { classLabel?: string; rollNo?: string; admissionNo?: string } | null
      }
    })?.user
    // The canonical DB record (User → Student → Class) is the identity
    // the sidebar/dashboard must render — pinned here end-to-end.
    const dbUser = await db.user.findUnique({ where: { id: fx.students[0].userId }, select: { name: true } })
    expect(me?.name).toBe(dbUser?.name)
    expect(me?.student?.rollNo).toBe('01')
    expect(me?.student?.admissionNo).toBe(`ITATT${MARKER}0`)
    expect(me?.student?.classLabel).toBe(fx.classA.name)
  })
})
