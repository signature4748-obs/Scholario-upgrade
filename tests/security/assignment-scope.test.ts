import { db } from '../helpers/db'
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

import { randomBytes } from 'crypto'
import { getTeacherSubjectAssignments } from '@/lib/teacher-scope'
import { hashSessionToken } from '@/lib/auth'
import { DEMO_STUDENT_EMAIL } from '../helpers/credentials'
import { PROBE_SUBJECT_CODE } from '../../prisma/seed-identity'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000 // generous: first-hit dev compilation (tenant-isolation precedent)

const MARKER = randomBytes(4).toString('hex')

// ── resolved fixtures (DB truth, never hardcoded ids) ─────────────────────
let schoolId = ''
let teacher1 = { id: '', name: '', email: 'teacher1@hawkingshigh.edu' }
let principal = { id: '', email: 'principal@hawkingshigh.edu' }
let student1 = { id: '', email: DEMO_STUDENT_EMAIL, classTeacherId: '' }
let subjectOnly = { id: '', email: `pih5.subjectonly.${MARKER}@hawkings.test` }
let g9a = { id: '' } // NOT teacher1's class; MAT taught by a colleague (teacher9)
let g8a = { id: '' } // teacher11's class-teacher class; MAT is NOT teacher11's subject
let g1a = { id: '' } // teacher1's class-teacher class — MAT here IS teacher1's subject (positive control)
let mathId = ''
let pa1ExamId = ''
let g8aStudentId = ''
let teacherToken = ''
let teacher11Token = ''
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
  const [t1, p1, s1] = await Promise.all([
    byEmail(teacher1.email),
    byEmail(principal.email),
    byEmail(student1.email),
  ])
  teacher1 = { ...teacher1, id: t1.id, name: t1.name ?? '' }
  principal = { ...principal, id: p1.id }

  // student1's STUDENT row (the route takes the student id, not the user id).
  const s1row = await db.student.findFirst({ where: { schoolId, userId: s1.id }, include: { class: true } })
  if (!s1row) throw new Error('fixture student row missing for the featured student')
  student1 = { ...student1, id: s1row.id, classTeacherId: s1row.class?.classTeacherId ?? '' }

  const classBy = async (name: string) => {
    const c = await db.class.findFirst({ where: { schoolId, name } })
    if (!c) throw new Error(`fixture class missing: ${name}`)
    return c
  }
  // Final-acceptance corpus (Hawkings): teacher1 (Smt. Kavita Singh) is the
  // 1-A class teacher and owns ALL of 1-A's CSAs (ENG/HIN/MAT/EVS/DRW); 8-A's
  // class teacher is teacher11 (owns only 8-A ENG); 9-A MAT belongs to
  // teacher9. So: 9-A × MAT = a colleague's sheet (403 for teacher1);
  // 8-A × MAT = class-teacher class × not-their-subject (403 for teacher11);
  // 1-A × MAT = teacher1's own assignment (200 positive control).
  const [c9, c8, c1a] = await Promise.all([classBy('9-A'), classBy('8-A'), classBy('1-A')])
  g9a = { id: c9.id }
  g8a = { id: c8.id }
  g1a = { id: c1a.id }

  const subjectByCode = async (code: string) => {
    // Final-acceptance corpus: TWO subjects are named 'Mathematics' (the
    // canonical MAT and the tenant-isolation probe HH-PROBE-MATH) — resolve
    // by CODE so the sheet lookups are deterministic.
    const s = await db.subject.findFirst({ where: { schoolId, code } })
    if (!s) throw new Error(`fixture subject missing: ${code}`)
    return s.id
  }
  ;[mathId] = await Promise.all([subjectByCode('MAT')])

  // Phase 8A re-target: the legacy subject-only fixture (tenant.teacher.a)
  // became a class teacher via the roster-150 rotation (Grade 4-A/7-B), so
  // the "CSA scope but ZERO appointments" premise is staged as a THROWAWAY
  // teacher minted + swept by this suite (same invariant, self-contained
  // fixture — the export-policy/csv-injection throwaway convention).
  const throwawayTeacher = await db.user.create({
    data: {
      schoolId,
      email: subjectOnly.email,
      name: `PIH5 Subject-Only ${MARKER}`,
      role: 'TEACHER',
      status: 'ACTIVE',
    },
  })
  subjectOnly = { ...subjectOnly, id: throwawayTeacher.id }
  await db.teacher.create({
    data: { schoolId, userId: throwawayTeacher.id, employeeId: `PIH5-SO-${MARKER}`, department: 'Test', subjects: 'Test' },
  })
  // A REAL subject assignment (CSA) on a probe-free (class, subject) pair —
  // Grade 9-A × the seeded probe subject (PROBE_SUBJECT_CODE, unassigned there) — so the
  // teacher has subject scope but appointed class teacher of NOTHING.
  // Self-healing fixture (Phase 8A): if a prior crashed run left a CSA on
  // this pair, RE-BIND it to the throwaway teacher (and restore it to
  // teacher-less in cleanup) instead of colliding on (classId, subjectId).
  const probeSubjectId = (await db.subject.findFirstOrThrow({ where: { schoolId, code: PROBE_SUBJECT_CODE } })).id
  const existingProbeCsa = await db.classSubjectAssignment.findFirst({
    where: { schoolId, classId: g9a.id, subjectId: probeSubjectId },
  })
  if (existingProbeCsa) {
    await db.classSubjectAssignment.update({
      where: { id: existingProbeCsa.id },
      data: { teacherUserId: throwawayTeacher.id, isActive: true },
    })
    cleanup.push(() =>
      db.classSubjectAssignment.update({
        where: { id: existingProbeCsa.id },
        data: { teacherUserId: null },
      }))
  } else {
    await db.classSubjectAssignment.create({
      data: {
        schoolId,
        classId: g9a.id,
        subjectId: probeSubjectId,
        teacherUserId: throwawayTeacher.id,
        isActive: true,
      },
    })
  }
  cleanup.push(() => db.classSubjectAssignment.deleteMany({ where: { teacherUserId: throwawayTeacher.id } }))
  cleanup.push(() => db.teacher.deleteMany({ where: { userId: throwawayTeacher.id } }))
  cleanup.push(() => db.user.delete({ where: { id: throwawayTeacher.id } })) // sessions cascade

  const exam = await db.exam.findFirst({ where: { schoolId, name: 'Periodic Assessment 1' } })
  if (!exam) throw new Error('fixture exam missing: Periodic Assessment 1')
  pa1ExamId = exam.id

  const g8student = await db.student.findFirst({
    where: { classId: c8.id, user: { status: 'ACTIVE' } },
    orderBy: { rollNo: 'asc' },
  })
  if (!g8student) throw new Error('no ACTIVE student in 8-A')
  g8aStudentId = g8student.id

  // 8-A's class teacher (teacher11) — the "class-teacher status alone grants
  // nothing" fixture: she owns ONLY 8-A ENG; 8-A MAT is teacher9's CSA.
  const c8Row = await db.class.findUnique({ where: { id: g8a.id }, select: { classTeacherId: true } })
  if (!c8Row?.classTeacherId) throw new Error('8-A has no class teacher — seed state unexpected')
  const teacher11 = await db.user.findUnique({ where: { id: c8Row.classTeacherId } })
  if (!teacher11) throw new Error('8-A class teacher user missing')
  teacher11Token = randomBytes(32).toString('hex')

  // Direct-minted sessions (phase75 pattern) — bypasses ONLY the login
  // limiter; every authorization gate below is exercised for real.
  teacherToken = randomBytes(32).toString('hex')
  principalToken = randomBytes(32).toString('hex')
  subjectOnlyToken = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      // PHASE 8A — rows store sha256(token); the RAW tokens ride the
      // cookie jar below (createSession wire contract).
      { userId: t1.id, tokenHash: hashSessionToken(teacherToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: teacher11.id, tokenHash: hashSessionToken(teacher11Token), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: p1.id, tokenHash: hashSessionToken(principalToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: subjectOnly.id, tokenHash: hashSessionToken(subjectOnlyToken), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: {
        tokenHash: {
          in: [teacherToken, teacher11Token, principalToken, subjectOnlyToken].map(hashSessionToken),
        },
      },
    }),
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

  test('grid: the CLASS-TEACHER of a class on a subject they do NOT teach → 403 — class-teacher status alone grants nothing', async () => {
    // 8-A's classTeacherId is teacher11 (DB truth)…
    const cls = await db.class.findUnique({ where: { id: g8a.id }, select: { classTeacherId: true } })
    const teacher11User = await db.user.findUnique({ where: { id: cls?.classTeacherId ?? '' } })
    expect(teacher11User?.email).toBeDefined()
    expect(teacher11User?.email).not.toBe(teacher1.email) // teacher11, not teacher1
    // …teacher11 owns only 8-A ENG — the 8-A MAT CSA is a colleague's…
    const csa8mat = await db.classSubjectAssignment.findFirst({
      where: { classId: g8a.id, subjectId: mathId },
      include: { teacherUser: { select: { email: true } } },
    })
    expect(csa8mat?.teacherUser?.email).toBeDefined()
    expect(csa8mat?.teacherUser?.email).not.toBe(teacher11User?.email)
    // …the Mathematics sheet exists…
    const config = await db.examSubjectConfig.findFirst({
      where: { examId: pa1ExamId, classId: g8a.id, subjectId: mathId },
    })
    expect(config).not.toBeNull()

    const res = await as(teacher11Token, `/api/teacher/marks-entry/grid?examId=${pa1ExamId}&classId=${g8a.id}&subjectId=${mathId}`)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  }, T)

  test('grid: positive control — teacher1\'s OWN assigned subject (1-A Mathematics, her class) → 200 (guard is scope-driven, not a blanket 403)', async () => {
    const config = await db.examSubjectConfig.findFirst({
      where: { examId: pa1ExamId, classId: g1a.id, subjectId: mathId },
    })
    expect(config).not.toBeNull()

    const res = await as(teacherToken, `/api/teacher/marks-entry/grid?examId=${pa1ExamId}&classId=${g1a.id}&subjectId=${mathId}`)
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

  test('save: the class teacher on a subject they do NOT teach → 403 (CSA guard, teacherCanEnterMarks)', async () => {
    const res = await as(teacher11Token, '/api/teacher/marks-entry/save', {
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
    // Fixture: a THROWAWAY TEACHER with a real CSA assignment but appointed
    // class teacher of NOTHING (verified in DB) — the clean-school-era
    // equivalent of the legacy tenant.teacher.a premise.
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
    // Legacy-data guard: a (teacherName, teacherUserId=null) timetable row is
    // the pre-8B storage shape. The Hawkings corpus id-links every row, so
    // the legacy shape is STAGED here (self-contained fixture, swept in
    // cleanup) — the guard must still refuse a rename onto that name.
    let colleague = 'Shri Legacy Colleague'
    const staged = await db.timetable.create({
      data: {
        schoolId,
        classId: g9a.id,
        day: 'MONDAY',
        period: 8,
        teacherName: colleague,
        teacherUserId: null,
        room: 'Legacy Stage',
      },
    })
    cleanup.push(() => db.timetable.delete({ where: { id: staged.id } }).catch(() => {}))
    const rows = await db.timetable.findMany({
      where: { schoolId, teacherName: { not: null }, teacherUserId: null },
      select: { teacherName: true },
      take: 200,
    })
    colleague = rows.map((r) => r.teacherName!).find(
      (name) => name.toLowerCase() !== teacher1.name.toLowerCase(),
    ) ?? colleague
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
    const holder = await db.class.findFirst({ where: { schoolId, name: '12-A' }, select: { id: true, roomId: true } })
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
