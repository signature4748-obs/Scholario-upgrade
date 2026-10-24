/**
 * PHASE B — REGRESSION: POST /api/timetable/publish class RESOLUTION.
 *
 * Contract under test (src/app/api/timetable/publish/route.ts):
 *   · the timetable editor addresses classes by their DISPLAY LABEL —
 *     "Class 1 - A" is the label the roster (classLabelOf), the editor
 *     classOptions and the publish payload all carry for a wizard-shaped
 *     class row {name:"Class 1", section:"A"} (the provisioning wizard's
 *     canonical shape: name + SEPARATE section column);
 *   · pre-fix, the publish route resolved classes by NAME ONLY, so the
 *     label missed and the route CREATED a duplicate {name:"Class 1 - A"}
 *     row — timetable + CSA attached to the duplicate, every student
 *     enrolled in the ORIGINAL row lost their schedule (Phase A repro:
 *     audit evidence pack /home/z/phaseA-timetable-repro, 2026-10-23);
 *   · post-fix contract, scenario by scenario:
 *       1. exact-name lookup is PRESERVED (seeded shape "1-A" — the
 *          section EMBEDDED in the name — keeps hitting its own row);
 *       2. wizard shape resolves: label "Class 1 - A" → the EXISTING
 *          {name:"Class 1", section:"A"} row, zero duplicates;
 *       3. mixed shapes in one payload create no duplicates;
 *       4. a class NAME that itself looks like a label exact-hits its own
 *          row (the fallback never overrides an exact match);
 *       5. ambiguous candidates (case-colliding duplicates of the same
 *          base+section) fail SAFELY with INVALID_INPUT — never guess;
 *       6. the student enrolled in the ORIGINAL row sees the published
 *          slots (mySlots non-empty, rows on the original classId);
 *       7. re-publication is idempotent w.r.t. class creation;
 *       8. the stale-snapshot guard still refuses a payload whose classes
 *          match NOTHING (normalized lookup cannot bypass it) and the
 *          refusal leaves NO ghost class behind (guard runs BEFORE the
 *          creation phase);
 *       9. cross-tenant: school B's "Class 1 - A" resolves ONLY within
 *          school B (same name+section must exist in both schools);
 *      10. the seeded Hawkings corpus (read-only) keeps its 15
 *          embedded-shape classes and 396 timetable rows untouched;
 *      11. the en-dash variant of the canonical label ("Class 1 – A")
 *          resolves to the same wizard row — both dash forms supported;
 *      12. case-insensitive single-candidate resolution: a lowercase
 *          payload label ("class 1 - a") hits the stored row;
 *      13. CRITICAL partial-write pin: a genuinely-NEW class FIRST + an
 *          ambiguous label AFTER → the request fails 422 and NO class
 *          row was created by the failed request (resolution is
 *          side-effect-free; creation is a separate, later phase);
 *      14. the reversed order (ambiguous first, new class after) has
 *          the same safe outcome;
 *      15. legitimate new-class creation still works in a valid mixed
 *          payload (existing label + genuinely-new name → exactly one
 *          new row; the guard does not over-fire when at least one
 *          payload class exists).
 *
 * FIXTURE POLICY (Phase B approval §4): the reproduced wizard-repro
 * failure state is PRESERVED as evidence — this suite never touches it.
 * Every fixture here is a SEPARATE disposable tenant pair created
 * directly in the DB (marker-suffixed, unique per run) and removed
 * completely in afterAll. The seeded corpus is only ever READ.
 *
 * Live-server convention (tests/e2e + tests/regression): the dev server
 * (API_TEST_BASE, default http://localhost:3000) is ALREADY RUNNING.
 * Three real logins (principal A, student A, principal B) ride a private
 * X-Forwarded-For IP — the shared loopback login-IP bucket (5/15min)
 * stays clear — with the journeys-style direct-session fixture as the
 * 429 fallback (an auth fixture, never an authorization bypass).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { liveFetch } from '../helpers/live-http'
import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashPassword, hashSessionToken } from '@/lib/auth'
import type { PublishableSlot } from '@/lib/timetable/server-mapping'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const MARKER = randomBytes(4).toString('hex')
const FIXTURE_PASSWORD = `QaTt!${MARKER}x7` // test-local fixture password (per-file convention)
// Private egress IP for the suite's logins (conflict-suite convention).
const RUN_IP = `10.9.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 20}`

const SUBJECT = `QA Mathematics ${MARKER}`

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
  requestId?: string
}

interface ClassRow {
  id: string
  name: string
  section: string | null
}

// ── shared suite state (tests run sequentially in declaration order) ────
let cookieA = ''
let cookieStudent = ''
let cookieB = ''
let fixtureSessionTokens: string[] = [] // set only when the 429 fallback minted sessions
let schoolAId = ''
let schoolBId = ''
// School A classes (the ORIGINAL wizard/seeded-shape rows)
let classA1: ClassRow // {name:"Class 1",  section:"A"}  — the wizard core shape
let classA2: ClassRow // {name:"Class 2",  section:"B"}  — wizard shape, non-A section
let classA3: ClassRow // {name:"1-A",      section:"A"}  — seeded embedded shape
let classA4: ClassRow // {name:"QA Science - Lab", section:null} — name that LOOKS like a label
// School B class — SAME name+section as school A's wizard row (isolation probe)
let classB1: ClassRow
let principalAId = ''
let studentUserId = ''
let principalBId = ''

// ── helpers ─────────────────────────────────────────────────────────────

async function login(email: string): Promise<string> {
  const res = await liveFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
  })
  if (res.status === 429) {
    // Journeys convention: direct session fixture fallback (swept in afterAll).
    const user = await db.user.findUnique({ where: { email }, select: { id: true } })
    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        userId: user!.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    fixtureSessionTokens.push(token)
    return `erp_session=${token}`
  }
  expect(res.status).toBe(200)
  const body = (await res.json()) as Envelope<{ sessionToken?: string }>
  expect(body.ok).toBe(true)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const fromHeader = setCookie.includes('erp_session=')
    ? setCookie.split('erp_session=')[1].split(';')[0]
    : null
  return `erp_session=${fromHeader ?? body.data?.sessionToken ?? ''}`
}

function slot(day: string, period: number, time: string, className: string): PublishableSlot {
  return { day, period, time, className, subject: SUBJECT, teacherName: '', room: '' }
}

async function publish(cookie: string, slots: PublishableSlot[]): Promise<Response> {
  return liveFetch(`${BASE}/api/timetable/publish`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slots }),
  })
}

const MON1 = '08:30 AM - 09:15 AM'
const MON2 = '09:15 AM - 10:00 AM'
const MON3 = '10:00 AM - 10:45 AM'
const TUE1 = '08:30 AM - 09:15 AM'

async function classCount(schoolId: string): Promise<number> {
  return db.class.count({ where: { schoolId } })
}

async function timetableRows(schoolId: string) {
  return db.timetable.findMany({
    where: { schoolId },
    select: { classId: true, day: true, period: true },
    orderBy: [{ day: 'asc' }, { period: 'asc' }],
  })
}

// ── setup: the disposable fixture pair (never the Phase A evidence tenant) ──

beforeAll(async () => {
  // School A — mixed-shape tenant.
  const schoolA = await db.school.create({
    data: {
      name: `QA TT Resolution A ${MARKER}`,
      slug: `qa-tt-a-${MARKER}`,
      code: `QATA${MARKER.slice(0, 6)}`,
      status: 'ACTIVE',
      academicYear: '2026-2027',
    },
  })
  schoolAId = schoolA.id
  const principalA = await db.user.create({
    data: {
      schoolId: schoolAId,
      email: `qa-tt-a-principal-${MARKER}@qa.scholario.test`,
      passwordHash: hashPassword(FIXTURE_PASSWORD),
      name: 'QA TT Principal A',
      role: 'PRINCIPAL',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  })
  principalAId = principalA.id
  classA1 = await db.class.create({
    data: { schoolId: schoolAId, name: 'Class 1', section: 'A', capacity: 40 },
    select: { id: true, name: true, section: true },
  })
  classA2 = await db.class.create({
    data: { schoolId: schoolAId, name: 'Class 2', section: 'B', capacity: 40 },
    select: { id: true, name: true, section: true },
  })
  classA3 = await db.class.create({
    data: { schoolId: schoolAId, name: '1-A', section: 'A', gradeLevel: '1', capacity: 40 },
    select: { id: true, name: true, section: true },
  })
  classA4 = await db.class.create({
    data: { schoolId: schoolAId, name: 'QA Science - Lab', section: null, capacity: 40 },
    select: { id: true, name: true, section: true },
  })
  // The case-colliding ambiguity pair: same (base, section) modulo case —
  // distinct rows under the exact-case unique, ONE logical class twice.
  await db.class.create({ data: { schoolId: schoolAId, name: 'QA Amb Base', section: 'a', capacity: 40 } })
  await db.class.create({ data: { schoolId: schoolAId, name: 'qa amb base', section: 'A', capacity: 40 } })
  await db.subject.create({ data: { schoolId: schoolAId, name: SUBJECT, code: `QT${MARKER.slice(0, 2)}`, status: 'Active' } })
  // Student enrolled in the ORIGINAL Class 1 row (the Phase A victim shape).
  const studentUser = await db.user.create({
    data: {
      schoolId: schoolAId,
      email: `qa-tt-a-student-${MARKER}@qa.scholario.test`,
      passwordHash: hashPassword(FIXTURE_PASSWORD),
      name: 'QA TT Student',
      role: 'STUDENT',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  })
  studentUserId = studentUser.id
  await db.student.create({
    data: { schoolId: schoolAId, userId: studentUser.id, classId: classA1.id, rollNo: '01' },
  })

  // School B — the cross-tenant isolation probe (SAME class name+section as A).
  const schoolB = await db.school.create({
    data: {
      name: `QA TT Resolution B ${MARKER}`,
      slug: `qa-tt-b-${MARKER}`,
      code: `QATB${MARKER.slice(0, 6)}`,
      status: 'ACTIVE',
      academicYear: '2026-2027',
    },
  })
  schoolBId = schoolB.id
  const principalB = await db.user.create({
    data: {
      schoolId: schoolBId,
      email: `qa-tt-b-principal-${MARKER}@qa.scholario.test`,
      passwordHash: hashPassword(FIXTURE_PASSWORD),
      name: 'QA TT Principal B',
      role: 'PRINCIPAL',
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  })
  principalBId = principalB.id
  classB1 = await db.class.create({
    data: { schoolId: schoolBId, name: 'Class 1', section: 'A', capacity: 40 },
    select: { id: true, name: true, section: true },
  })

  // The three real logins (private IP keeps the shared bucket clear).
  cookieA = await login(`qa-tt-a-principal-${MARKER}@qa.scholario.test`)
  cookieStudent = await login(`qa-tt-a-student-${MARKER}@qa.scholario.test`)
  cookieB = await login(`qa-tt-b-principal-${MARKER}@qa.scholario.test`)
}, T)

// ── the contract ────────────────────────────────────────────────────────

describe('regression · Phase B timetable publish class resolution (wizard-shape label fallback)', () => {
  test(
    '1 — wizard shape: label "Class 1 - A" resolves to the EXISTING {name:"Class 1", section:"A"} row; zero duplicates; rows on the ORIGINAL id',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, 'Class 1 - A'),
        slot('Monday', 2, MON2, 'Class 2 - B'),
      ])
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number }>
      expect(body.ok).toBe(true)
      expect(body.data?.rowsWritten).toBe(2)

      // No new rows — the label RESOLVED, it did not create.
      expect(await classCount(schoolAId)).toBe(before)
      const dup = await db.class.findFirst({ where: { schoolId: schoolAId, name: 'Class 1 - A' } })
      expect(dup).toBeNull()
      const dup2 = await db.class.findFirst({ where: { schoolId: schoolAId, name: 'Class 2 - B' } })
      expect(dup2).toBeNull()

      // The timetable rows hang on the ORIGINAL ids.
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(2)
      expect(rows.map((r) => r.classId).sort()).toEqual([classA1.id, classA2.id].sort())
    },
    T,
  )

  test(
    '2 — seeded shape: exact name "1-A" (section embedded in the name) still resolves to its own row — the exact-name lookup is preserved',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [slot('Monday', 1, MON1, '1-A')])
      expect(res.status).toBe(200)
      expect(await classCount(schoolAId)).toBe(before)
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(1)
      expect(rows[0].classId).toBe(classA3.id)
    },
    T,
  )

  test(
    '3 — mixed shapes in ONE payload: embedded name + two wizard labels — no duplicates, every slot on its original row',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, '1-A'),
        slot('Monday', 2, MON2, 'Class 1 - A'),
        slot('Monday', 3, MON3, 'Class 2 - B'),
      ])
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number }>
      expect(body.data?.rowsWritten).toBe(3)
      expect(await classCount(schoolAId)).toBe(before)
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(3)
      expect(rows.map((r) => r.classId).sort()).toEqual([classA1.id, classA2.id, classA3.id].sort())
    },
    T,
  )

  test(
    '4 — a class NAME that itself looks like a label ("QA Science - Lab", section null) exact-hits its OWN row — the fallback never overrides an exact match',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [slot('Monday', 1, MON1, 'QA Science - Lab')])
      expect(res.status).toBe(200)
      expect(await classCount(schoolAId)).toBe(before)
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(1)
      expect(rows[0].classId).toBe(classA4.id)
    },
    T,
  )

  test(
    '5 — ambiguous case-colliding candidates ("QA Amb Base"/a + "qa amb base"/A): publish refuses with 422 INVALID_INPUT, never guesses, nothing written, nothing created',
    async () => {
      const rowsBefore = await db.timetable.count({ where: { schoolId: schoolAId } })
      const classesBefore = await classCount(schoolAId)

      const res = await publish(cookieA, [slot('Monday', 1, MON1, 'QA Amb Base - A')])
      expect(res.status).toBe(422)
      const body = (await res.json()) as Envelope<never>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('INVALID_INPUT')
      expect((body.error ?? '').toLowerCase()).toContain('ambiguous')

      // Fail-safe means fail-CLEAN: no rows written, no class created.
      expect(await db.timetable.count({ where: { schoolId: schoolAId } })).toBe(rowsBefore)
      expect(await classCount(schoolAId)).toBe(classesBefore)
      const ghost = await db.class.findFirst({ where: { schoolId: schoolAId, name: 'QA Amb Base - A' } })
      expect(ghost).toBeNull()
    },
    T,
  )

  test(
    '6 — student read: the student enrolled in the ORIGINAL Class 1 sees the published slots (mySlots non-empty; the empty-schedule defect is fixed)',
    async () => {
      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, 'Class 1 - A'),
        slot('Tuesday', 1, TUE1, 'Class 1 - A'),
      ])
      expect(res.status).toBe(200)

      const read = await liveFetch(`${BASE}/api/student/timetable`, { headers: { cookie: cookieStudent } })
      expect(read.status).toBe(200)
      const body = (await read.json()) as Envelope<{
        classLabel: string
        section: string | null
        mySlots: unknown[]
        masterSlots: unknown[]
      }>
      expect(body.ok).toBe(true)
      expect(body.data?.mySlots.length).toBe(2)
      expect(body.data?.masterSlots.length).toBe(2)
    },
    T,
  )

  test(
    '7 — re-publication idempotency: the same payload again creates NO further classes and stays on the SAME original ids',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, 'Class 1 - A'),
        slot('Tuesday', 1, TUE1, 'Class 1 - A'),
      ])
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number; rowsReplaced: number }>
      expect(body.data?.rowsWritten).toBe(2)
      expect(body.data?.rowsReplaced).toBe(2)
      expect(await classCount(schoolAId)).toBe(before)
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(2)
      expect(rows.every((r) => r.classId === classA1.id)).toBe(true)
    },
    T,
  )

  test(
    '8 — stale-snapshot guard intact: a payload whose classes match NOTHING is still refused (normalized lookup cannot bypass the guard) and leaves NO ghost class behind',
    async () => {
      const rowsBefore = await db.timetable.count({ where: { schoolId: schoolAId } })
      const classesBefore = await classCount(schoolAId)
      expect(rowsBefore).toBeGreaterThan(0)

      const res = await publish(cookieA, [slot('Monday', 1, MON1, `QA Ghost ${MARKER} - Z`)])
      expect(res.status).toBe(400)
      const body = (await res.json()) as Envelope<never>
      expect(body.ok).toBe(false)
      expect((body.error ?? '')).toContain('STALE_SNAPSHOT_REFUSED')

      // The refusal left the school's real rows untouched — AND created
      // NO ghost class: the guard runs before the creation phase, so a
      // refused (unhydrated) payload can never leave its classes behind.
      expect(await db.timetable.count({ where: { schoolId: schoolAId } })).toBe(rowsBefore)
      expect(await classCount(schoolAId)).toBe(classesBefore)
      const ghost = await db.class.findFirst({ where: { schoolId: schoolAId, name: `QA Ghost ${MARKER} - Z` } })
      expect(ghost).toBeNull()
    },
    T,
  )

  test(
    '9 — cross-tenant isolation: school B publishing "Class 1 - A" resolves ONLY within school B — school A is untouched, B rides its OWN row',
    async () => {
      const aRowsBefore = await timetableRows(schoolAId)
      const bClassesBefore = await classCount(schoolBId)
      expect(bClassesBefore).toBe(1) // B has its own {name:"Class 1", section:"A"}

      const res = await publish(cookieB, [slot('Monday', 1, MON1, 'Class 1 - A')])
      expect(res.status).toBe(200)

      // B: no duplicate created; B's row references B's OWN original class.
      expect(await classCount(schoolBId)).toBe(bClassesBefore)
      const bRows = await db.timetable.findMany({
        where: { schoolId: schoolBId },
        select: { classId: true },
      })
      expect(bRows.length).toBe(1)
      expect(bRows[0].classId).toBe(classB1.id)
      expect(classB1.id).not.toBe(classA1.id)

      // A: byte-identical timetable (count + classIds) across B's publish.
      const aRowsAfter = await timetableRows(schoolAId)
      expect(aRowsAfter.length).toBe(aRowsBefore.length)
      expect(aRowsAfter.map((r) => r.classId).sort()).toEqual(aRowsBefore.map((r) => r.classId).sort())
    },
    T,
  )

  test(
    '10 — seeded corpus (READ-ONLY): Hawkings keeps its 15 embedded-shape classes and 396 timetable rows — this suite never touches it',
    async () => {
      const school = await db.school.findFirst({ where: { name: { contains: 'Hawkings' } } })
      expect(school).toBeTruthy()
      const classes = await db.class.findMany({
        where: { schoolId: school!.id },
        select: { name: true, section: true },
      })
      expect(classes.length).toBe(15)
      // The embedded shape: every seeded name carries its own section.
      expect(classes.every((c) => /^(Nursery|LKG|IKG|1?[0-9])-A$/.test(c.name))).toBe(true)
      const rows = await db.timetable.count({ where: { schoolId: school!.id } })
      expect(rows).toBe(396)
      const orphans = await db.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "Timetable" t
        LEFT JOIN "Class" c ON c.id = t."classId"
        WHERE t."schoolId" = ${school!.id} AND c.id IS NULL
      `
      expect(orphans[0].n).toBe(0)
    },
    T,
  )

  test(
    '11 — en-dash canonical label "Class 1 – A" resolves to the EXISTING {name:"Class 1", section:"A"} row — both dash forms of the label format are supported',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [slot('Monday', 1, MON1, 'Class 1 – A')])
      expect(res.status).toBe(200)
      expect(await classCount(schoolAId)).toBe(before)
      const ghost = await db.class.findFirst({ where: { schoolId: schoolAId, name: 'Class 1 – A' } })
      expect(ghost).toBeNull()
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(1)
      expect(rows[0].classId).toBe(classA1.id)
    },
    T,
  )

  test(
    '12 — case-insensitive resolution: a lowercase payload label "class 1 - a" resolves to the stored {name:"Class 1", section:"A"} row (single candidate)',
    async () => {
      const before = await classCount(schoolAId)
      const res = await publish(cookieA, [slot('Monday', 1, MON1, 'class 1 - a')])
      expect(res.status).toBe(200)
      expect(await classCount(schoolAId)).toBe(before)
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(1)
      expect(rows[0].classId).toBe(classA1.id)
    },
    T,
  )

  test(
    '13 — CRITICAL partial-write: a genuinely-NEW class first + an AMBIGUOUS label after → 422 INVALID_INPUT and NO class row was created by the failed request',
    async () => {
      const rowsBefore = await timetableRows(schoolAId)
      const classesBefore = await classCount(schoolAId)

      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, `QA Brand New ${MARKER}`),
        slot('Monday', 2, MON2, 'QA Amb Base - A'),
      ])
      expect(res.status).toBe(422)
      const body = (await res.json()) as Envelope<never>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('INVALID_INPUT')
      expect((body.error ?? '').toLowerCase()).toContain('ambiguous')

      // The new class must NOT exist — the failed request created NOTHING.
      const ghost = await db.class.findFirst({ where: { schoolId: schoolAId, name: `QA Brand New ${MARKER}` } })
      expect(ghost).toBeNull()
      expect(await classCount(schoolAId)).toBe(classesBefore)

      // And the school's real timetable is byte-identical.
      const rowsAfter = await timetableRows(schoolAId)
      expect(rowsAfter.length).toBe(rowsBefore.length)
      expect(rowsAfter.map((r) => r.classId).sort()).toEqual(rowsBefore.map((r) => r.classId).sort())
    },
    T,
  )

  test(
    '14 — reversed order (AMBIGUOUS label first, genuinely-NEW class after) → same safe outcome: 422, nothing created, timetable untouched',
    async () => {
      const rowsBefore = await db.timetable.count({ where: { schoolId: schoolAId } })
      const classesBefore = await classCount(schoolAId)

      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, 'QA Amb Base - A'),
        slot('Monday', 2, MON2, `QA Brand New ${MARKER}`),
      ])
      expect(res.status).toBe(422)
      const body = (await res.json()) as Envelope<never>
      expect(body.code).toBe('INVALID_INPUT')

      const ghost = await db.class.findFirst({ where: { schoolId: schoolAId, name: `QA Brand New ${MARKER}` } })
      expect(ghost).toBeNull()
      expect(await classCount(schoolAId)).toBe(classesBefore)
      expect(await db.timetable.count({ where: { schoolId: schoolAId } })).toBe(rowsBefore)
    },
    T,
  )

  test(
    '15 — legitimate new-class creation still works: an EXISTING label + a GENUINELY new class in ONE valid payload → 200, exactly ONE new row (honest shape), timetable hangs on real ids',
    async () => {
      const before = await classCount(schoolAId)
      const newName = `QA Fresh ${MARKER}`

      const res = await publish(cookieA, [
        slot('Monday', 1, MON1, 'Class 1 - A'),
        slot('Monday', 2, MON2, newName),
      ])
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number }>
      expect(body.data?.rowsWritten).toBe(2)

      // Exactly one new class row, honest create shape: no trailing
      // single-letter section → section NULL, capacity default 40.
      expect(await classCount(schoolAId)).toBe(before + 1)
      const created = await db.class.findFirst({
        where: { schoolId: schoolAId, name: newName },
        select: { id: true, section: true, capacity: true },
      })
      expect(created).toBeTruthy()
      expect(created!.section).toBeNull()
      expect(created!.capacity).toBe(40)

      // The publish replaced the school's rows with the new universe and
      // every row hangs on a REAL id — the resolved ORIGINAL + the new row.
      const rows = await timetableRows(schoolAId)
      expect(rows.length).toBe(2)
      expect(rows.map((r) => r.classId).sort()).toEqual([classA1.id, created!.id].sort())
    },
    T,
  )
})

// ── teardown: remove the disposable fixture pair completely ─────────────

afterAll(async () => {
  // Best-effort API logouts first (the rest is the DB sweep).
  for (const cookie of [cookieA, cookieStudent, cookieB]) {
    if (!cookie) continue
    await liveFetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    }).catch(() => {})
  }
  try {
    for (const schoolId of [schoolAId, schoolBId]) {
      if (!schoolId) continue
      await db.activityLog.deleteMany({ where: { schoolId } })
      await db.timetable.deleteMany({ where: { schoolId } })
      await db.classSubjectAssignment.deleteMany({ where: { schoolId } })
      await db.student.deleteMany({ where: { schoolId } })
      await db.subject.deleteMany({ where: { schoolId } })
      await db.class.deleteMany({ where: { schoolId } })
    }
    for (const userId of [principalAId, studentUserId, principalBId]) {
      if (!userId) continue
      await db.session.deleteMany({ where: { userId } })
      await db.user.delete({ where: { id: userId } }).catch(() => {})
    }
    for (const token of fixtureSessionTokens) {
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).catch(() => {})
    }
    await db.school.deleteMany({ where: { id: { in: [schoolAId, schoolBId] } } })
    // The sweep must leave NOTHING behind.
    const left = await db.school.findMany({ where: { id: { in: [schoolAId, schoolBId] } } })
    expect(left.length).toBe(0)
  } catch {
    // Teardown must never mask a test failure — but the sweep's own
    // expectation failures propagate normally above.
  }
}, T)
