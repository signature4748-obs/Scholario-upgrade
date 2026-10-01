/**
 * PIH-5 — INVARIANT: in-tenant assignment scope (the RBAC/assignment matrix).
 *
 * THE INVARIANTS UNDER TEST (all inside ONE tenant — the demo school):
 *   1. MARKS ENTRY is granted by SUBJECT ASSIGNMENT (CSA appointment /
 *      timetable cell), NEVER by class-teacher status alone. A teacher
 *      requesting the grid or saving marks for a (class, subject) she has
 *      no assignment for is refused (403) even when the exam sheet exists
 *      — and she DOES get her own assigned subject (positive control, so
 *      the refusals prove scope, not missing data).
 *   2. FEE COLLECTION is granted by CLASS-TEACHER APPOINTMENT
 *      (Class.classTeacherId): GET lists exactly those classes, POST for
 *      a student outside them is 403, and a subject-only teacher (no
 *      appointment) honestly receives { classes: [] }.
 *   3. PROFILE RENAME cannot hijack a colleague's timetable scope: a
 *      rename to a colleague's timetable teacherName (rows not id-linked
 *      to the caller) is 409; a case-only rename of one's OWN name is
 *      allowed (200) and is restored.
 *   4. ROOM ARCHIVE is blocked while a class holds the room, and archived
 *      rooms drop out of the ?active=1 assignment picker (uniqueness
 *      lives in database-integrity.test.ts; this pins the lifecycle).
 *
 * Live-HTTP conventions match tests/security/tenant-isolation.test.ts and
 * tests/security/phase75-product.test.ts: dev server (TENANT_TEST_BASE,
 * default :3000) + real sessions. Sessions are minted as DIRECT ROWS (an
 * auth fixture that bypasses ONLY the login limiter — never an
 * authorization gate) so the suite is re-runnable inside the 5/15min
 * login rate-limit window. Requests ride the session COOKIE (the
 * production transport) via a manual cookie jar.
 *
 * Cleanup discipline: every row this suite creates (room, session) is
 * removed and every mutation (class roomId, teacher1 name) is restored —
 * a failing assertion must not leak state.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { getTeacherSubjectAssignments } from '@/lib/teacher-scope'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const db = new PrismaClient()
const T = 45_000 // generous: first-hit dev compilation (tenant-isolation precedent)

const MARKER = randomBytes(4).toString('hex')

// ── resolved fixtures (DB truth, never hardcoded ids) ─────────────────────
let schoolId = ''
let teacher1 = { id: '', name: '', email: 'teacher1@demoschool.edu' }
let principal = { id: '', email: 'principal@demoschool.edu' }
let student1 = { id: '', email: 'student1@demoschool.edu', classTeacherId: '' }
let subjectOnly = { id: '', email: 'tenant.teacher.a@scholario.test' }
let g9a = { id: '' } // NOT teacher1's class; Math taught by a colleague
let g8a = { id: '' } // teacher1's class-teacher class; Math NOT her subject
let g10a = { id: '' } // Science here IS teacher1's subject (positive control)
let mathId = ''
let scienceId = ''
let pa1ExamId = ''
let g8aStudentId = ''
let teacherToken = ''
let principalToken = ''
let subjectOnlyToken = ''

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing (run the canonical seeds)')
  schoolId = school.id

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`fixture user missing: ${email}`)
    return u
  }
  const [t1, p1, s1, so] = await Promise.all([
    byEmail(teacher1.email),
    byEmail(principal.email),
    byEmail(student1.email),
    byEmail(subjectOnly.email),
  ])
  teacher1 = { ...teacher1, id: t1.id, name: t1.name ?? '' }
  principal = { ...principal, id: p1.id }
  subjectOnly = { ...subjectOnly, id: so.id }

  // student1's STUDENT row (the route takes the student id, not the user id).
  const s1row = await db.student.findFirst({ where: { schoolId, userId: s1.id }, include: { class: true } })
  if (!s1row) throw new Error('fixture student row missing for student1@demoschool.edu')
  student1 = { ...student1, id: s1row.id, classTeacherId: s1row.class?.classTeacherId ?? '' }

  const classBy = async (name: string) => {
    const c = await db.class.findFirst({ where: { schoolId, name } })
    if (!c) throw new Error(`fixture class missing: ${name}`)
    return c
  }
  const [c9, c8, c10] = await Promise.all([classBy('Grade 9 - A'), classBy('Grade 8 - A'), classBy('Grade 10 - A')])
  g9a = { id: c9.id }
  g8a = { id: c8.id }
  g10a = { id: c10.id }

  const subjectBy = async (name: string) => {
    const s = await db.subject.findFirst({ where: { schoolId, name } })
    if (!s) throw new Error(`fixture subject missing: ${name}`)
    return s.id
  }
  ;[mathId, scienceId] = await Promise.all([subjectBy('Mathematics'), subjectBy('Science')])

  const exam = await db.exam.findFirst({ where: { schoolId, name: 'Periodic Assessment 1' } })
  if (!exam) throw new Error('fixture exam missing: Periodic Assessment 1')
  pa1ExamId = exam.id

  const g8student = await db.student.findFirst({
    where: { classId: c8.id, user: { status: 'ACTIVE' } },
    orderBy: { rollNo: 'asc' },
  })
  if (!g8student) throw new Error('no ACTIVE student in Grade 8 - A')
  g8aStudentId = g8student.id

  // Direct-minted sessions (phase75 pattern) — bypasses ONLY the login
  // limiter; every authorization gate below is exercised for real.
  teacherToken = randomBytes(32).toString('hex')
  principalToken = randomBytes(32).toString('hex')
  subjectOnlyToken = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: t1.id, token: teacherToken, expiresAt: new Date(Date.now() + 3600_000) },
      { userId: p1.id, token: principalToken, expiresAt: new Date(Date.now() + 3600_000) },
      { userId: so.id, token: subjectOnlyToken, expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({ where: { token: { in: [teacherToken, principalToken, subjectOnlyToken] } } }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

// ── helpers ───────────────────────────────────────────────────────────────

/** Manual cookie jar: one session token → Cookie header (the prod transport). */
function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 1. MARKS ENTRY — subject assignment is the ONLY grant
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · marks-entry scope (subject assignment, not class-teacher status)', () => {
  test('grid: teacher1 → a colleague\'s (class, subject) she has NO assignment for → 403 (sheet EXISTS)', async () => {
    // Prove the refusal is scope-driven, not data-driven: the exam sheet
    // (examSubjectConfig) for Periodic Assessment 1 × Grade 9-A × Mathematics
    // exists, and the CANONICAL resolver (CSA ∪ id-linked ∪ legacy name
    // fallback) grants teacher1 nothing on (Grade 9-A, Mathematics).
    const config = await db.examSubjectConfig.findFirst({
      where: { examId: pa1ExamId, classId: g9a.id, subjectId: mathId },
    })
    expect(config).not.toBeNull()
    const assignments = await getTeacherSubjectAssignments(teacher1, schoolId)
    expect(assignments.length).toBeGreaterThan(0)
    expect(
      assignments.some((a) => a.classId === g9a.id && a.subjectId === mathId),
    ).toBe(false)

    const res = await as(teacherToken, `/api/teacher/marks-entry/grid?examId=${pa1ExamId}&classId=${g9a.id}&subjectId=${mathId}`)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('grid: teacher1 → her CLASS-TEACHER class (Grade 8-A) but a subject she does NOT teach → 403 — class-teacher status alone grants nothing', async () => {
    // Grade 8-A's classTeacherId IS teacher1 (DB truth)…
    const cls = await db.class.findUnique({ where: { id: g8a.id }, select: { classTeacherId: true } })
    expect(cls?.classTeacherId).toBe(teacher1.id)
    // …the Mathematics sheet exists…
    const config = await db.examSubjectConfig.findFirst({
      where: { examId: pa1ExamId, classId: g8a.id, subjectId: mathId },
    })
    expect(config).not.toBeNull()

    const res = await as(teacherToken, `/api/teacher/marks-entry/grid?examId=${pa1ExamId}&classId=${g8a.id}&subjectId=${mathId}`)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  }, T)

  test('grid: positive control — teacher1\'s OWN assigned subject (Grade 10-A Science) → 200 (guard is scope-driven, not a blanket 403)', async () => {
    const config = await db.examSubjectConfig.findFirst({
      where: { examId: pa1ExamId, classId: g10a.id, subjectId: scienceId },
    })
    expect(config).not.toBeNull()

    const res = await as(teacherToken, `/api/teacher/marks-entry/grid?examId=${pa1ExamId}&classId=${g10a.id}&subjectId=${scienceId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { students?: unknown[] } }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data?.students)).toBe(true)
  }, T)

  test('save: teacher1 → colleague\'s (class, subject) → 403 and NO ExamMark rows are written', async () => {
    const marksBefore = await db.examMark.count({
      where: { examId: pa1ExamId, classId: g9a.id, subjectId: mathId },
    })
    const res = await as(teacherToken, '/api/teacher/marks-entry/save', {
      method: 'POST',
      body: JSON.stringify({
        examId: pa1ExamId,
        classId: g9a.id,
        subjectId: mathId,
        entries: [{ studentId: student1.id, marks: 10 }],
      }),
    })
    expect(res.status).toBe(403)
    const marksAfter = await db.examMark.count({
      where: { examId: pa1ExamId, classId: g9a.id, subjectId: mathId },
    })
    expect(marksAfter).toBe(marksBefore)
  }, T)

  test('save: teacher1 → her class-teacher class, unassigned subject → 403 (CSA guard, teacherCanEnterMarks)', async () => {
    const res = await as(teacherToken, '/api/teacher/marks-entry/save', {
      method: 'POST',
      body: JSON.stringify({
        examId: pa1ExamId,
        classId: g8a.id,
        subjectId: mathId,
        entries: [{ studentId: g8aStudentId, marks: 10 }],
      }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. FEE COLLECTION — class-teacher appointment is the ONLY grant
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · teacher fee-collection scope (class-teacher appointment)', () => {
  test('GET lists EXACTLY her appointed classes (server truth Class.classTeacherId), nothing more', async () => {
    const res = await as(teacherToken, '/api/teacher/fee-collection')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data?: { classes?: { classId: string; label: string }[] }
    }
    expect(body.ok).toBe(true)
    const classes = body.data?.classes ?? []
    expect(classes.length).toBeGreaterThan(0)

    const appointed = await db.class.findMany({
      where: { schoolId, classTeacherId: teacher1.id },
      select: { id: true },
    })
    expect(appointed.length).toBeGreaterThan(0)
    expect(new Set(classes.map((c) => c.classId))).toEqual(new Set(appointed.map((c) => c.id)))
  }, T)

  test('POST collection for a student NOT in her classes → 403, no transaction recorded', async () => {
    // student1 sits in Grade 9-A whose class teacher is a colleague (DB truth
    // resolved in beforeAll).
    expect(student1.classTeacherId).not.toBe(teacher1.id)

    const reference = `PIH5-FORBID-${MARKER}`
    const res = await as(teacherToken, '/api/teacher/fee-collection', {
      method: 'POST',
      body: JSON.stringify({ studentId: student1.id, feeId: 'any-fee-id', amount: 100, method: 'CASH', referenceNumber: reference }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')

    const leaked = await db.feeTransaction.findFirst({ where: { referenceNumber: reference } })
    expect(leaked).toBeNull()
  }, T)

  test('subject-only teacher (no class-teacher appointment) → honest { classes: [] }', async () => {
    // Fixture: tenant.teacher.a@scholario.test — a TEACHER with subject
    // assignments but appointed class teacher of NOTHING (verified in DB).
    const appointed = await db.class.findFirst({ where: { schoolId, classTeacherId: subjectOnly.id } })
    expect(appointed).toBeNull()

    const res = await as(subjectOnlyToken, '/api/teacher/fee-collection')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { classes?: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.data?.classes).toEqual([])
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. PROFILE RENAME — in-tenant scope-hijack guard (PIH-4a fix 5)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · profile rename vs timetable scope hijack', () => {
  test('rename to a colleague\'s timetable teacherName (null teacherUserId rows) → 409', async () => {
    // Pick a colleague with timetable rows NOT id-linked to teacher1 (all
    // demo timetable rows carry teacherUserId NULL today, so any teacher
    // OTHER than teacher1 is a hijack target).
    const rows = await db.timetable.findMany({
      where: { schoolId, teacherName: { not: null }, teacherUserId: null },
      select: { teacherName: true },
      take: 200,
    })
    const colleague = rows.map((r) => r.teacherName!).find(
      (name) => name.toLowerCase() !== teacher1.name.toLowerCase(),
    )
    expect(colleague).toBeTruthy()

    const res = await as(teacherToken, '/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ name: colleague }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('CONFLICT')

    // The name never changed.
    const still = await db.user.findUnique({ where: { id: teacher1.id }, select: { name: true } })
    expect(still?.name).toBe(teacher1.name)
  }, T)

  test('case-only rename of her OWN name → 200; name restored afterwards', async () => {
    const original = teacher1.name
    const caseVariant = original.toLowerCase()
    expect(caseVariant).not.toBe(original) // a real case change

    const res = await as(teacherToken, '/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ name: caseVariant }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { name?: string } }
    expect(body.ok).toBe(true)
    expect(body.data?.name).toBe(caseVariant)

    // Restore — leave the DB exactly as found.
    const restore = await as(teacherToken, '/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ name: original }),
    })
    expect(restore.status).toBe(200)
    const after = await db.user.findUnique({ where: { id: teacher1.id }, select: { name: true } })
    expect(after?.name).toBe(original)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. ROOM ARCHIVE — blocked while assigned; archived rooms leave the
//    ?active=1 assignment picker (no archived-room API test pre-exists).
//    NOTE: no API assigns roomId to a class (classes POST takes only the
//    display string `room`), so the assignment is staged directly in the
//    DB and the ARCHIVE + LIST behaviour is pinned through the API.
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · room archive lifecycle (assignment guard + active picker)', () => {
  test('archive is blocked while a class holds the room; free → archived; archived drops out of ?active=1', async () => {
    const roomName = `PIH5 Archive Probe ${MARKER}`
    const created = await as(principalToken, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: roomName, type: 'Classroom', capacity: 10 }),
    })
    expect(created.status).toBe(200)
    const createdBody = (await created.json()) as { ok: boolean; data?: { id?: string } }
    const roomId = createdBody.data?.id
    expect(roomId).toBeTruthy()
    cleanup.push(() => db.room.deleteMany({ where: { id: roomId! } }))
    cleanup.push(() =>
      db.activityLog.deleteMany({ where: { schoolId, detail: { contains: roomName } } }),
    )

    // Stage the assignment (DB — no assignment API exists) on a class this
    // suite never otherwise touches; restore in cleanup.
    const holder = await db.class.findFirst({ where: { schoolId, name: 'Grade 12 - B' }, select: { id: true, roomId: true } })
    expect(holder).not.toBeNull()
    const originalRoomId = holder!.roomId
    await db.class.update({ where: { id: holder!.id }, data: { roomId } })
    cleanup.push(() => db.class.update({ where: { id: holder!.id }, data: { roomId: originalRoomId } }))

    // (a) Archive while held → blocked (route-authored safe message → 400).
    const blocked = await as(principalToken, `/api/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    })
    expect(blocked.status).toBe(400)
    const blockedBody = (await blocked.json()) as { ok: boolean; error?: string }
    expect(blockedBody.ok).toBe(false)
    const roomStillActive = await db.room.findUnique({ where: { id: roomId }, select: { active: true } })
    expect(roomStillActive?.active).toBe(true)

    // (b) Clear the assignment → archive succeeds.
    await db.class.update({ where: { id: holder!.id }, data: { roomId: null } })
    const archived = await as(principalToken, `/api/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    })
    expect(archived.status).toBe(200)
    const archivedBody = (await archived.json()) as { ok: boolean; data?: { active?: boolean } }
    expect(archivedBody.data?.active).toBe(false)

    // (c) The assignment picker (?active=1) excludes it; the full registry
    //     still lists it (historical records stay queryable).
    const activeList = await as(principalToken, '/api/rooms?active=1')
    expect(activeList.status).toBe(200)
    const activeBody = (await activeList.json()) as { ok: boolean; data?: { id: string }[] }
    expect((activeBody.data ?? []).some((r) => r.id === roomId)).toBe(false)

    const fullList = await as(principalToken, '/api/rooms')
    expect(fullList.status).toBe(200)
    const fullBody = (await fullList.json()) as { ok: boolean; data?: { id: string; active: boolean }[] }
    const listed = (fullBody.data ?? []).find((r) => r.id === roomId)
    expect(listed).toBeDefined()
    expect(listed?.active).toBe(false)
  }, T)
})
