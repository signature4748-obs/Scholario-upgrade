/**
 * STUDENT-CONTACTS — student messaging contact resolution regression suite.
 *
 * The bug this pins (audit finding F1): student sessions could NEVER start
 * a conversation — `classContacts()` resolved teacher ids against
 * useTeacherRosterStore, which is hydrated from GET /api/teachers
 * (PRINCIPAL/MANAGEMENT-only → 403 for students → store stays empty →
 * the "new message" recipient picker was permanently empty on real
 * tenants).
 *
 * The fix: /api/students/roster (STUDENT-allowed) already ships the
 * school's active teachers (payload.teachers — USER-id space, exactly
 * what Class.classTeacherId / ClassSubjectAssignment.teacherUserId /
 * the timetable-derived subjectTeachers map carry). The students-store
 * now keeps them as `rosterTeachers` and the student Messages module
 * resolves names from that directory (staff-roster lookup remains a
 * preview-session fallback).
 *
 * Invariants under test:
 *
 *   1. ROSTER CONTRACT (live API, student session):
 *      · GET /api/students/roster → 200 {ok} with a non-empty `teachers`
 *        array for a school that has active teacher users
 *      · teachers[].id is the teacher's USER id (matches the User row —
 *        the thread key /api/messaging/threads/[userId])
 *      · the caller's own class payload carries classTeacherId and a
 *        subjectTeachers map whose values resolve against teachers[].id —
 *        the exact lookup classContacts performs; every contact id MUST
 *        resolve to a name
 *   2. ROLE SCOPING (why the directory matters):
 *      · GET /api/teachers with the SAME student session → 403 (the
 *        staff-only roster route is not a student-side source; the fix
 *        must never regress to depending on it)
 *   3. WIRING GUARDS (source contract, fail-closed on drift):
 *      · students-store/server-sync.ts maps payload.teachers into the
 *        store as `rosterTeachers` (and the StudentsState type carries it)
 *      · student Messages resolves contacts from the roster directory
 *        FIRST (the student-session path), staff roster only as fallback
 *
 * AUTH: direct session rows (the standard integration-test fixture —
 * bypasses ONLY the login rate limiter, never an authorization gate).
 *
 * FIXTURES: marker-namespaced class + teacher user + subject + timetable
 * row + student in School A (hawkings-prithvipur, the demo tenant).
 * Everything is swept in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { hashSessionToken } from '@/lib/auth'
import { REPO_ROOT } from '../helpers/repo-root'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')

// ─── fixture state ───────────────────────────────────────────────────────

interface Fixtures {
  schoolA: string
  classA: { id: string }
  teacher: { userId: string; name: string }
  student: { id: string; userId: string; email: string }
  subjectId: string
}

let fx: Fixtures
let studentToken: string

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

async function envelope(res: Response): Promise<{ ok?: boolean; data?: Record<string, unknown>; error?: string }> {
  return (await res.json().catch(() => ({}))) as { ok?: boolean; data?: Record<string, unknown>; error?: string }
}

/** Sandbox connection flakiness retry (see attendance-real-data.test.ts). */
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

interface RosterClassDto {
  id: string
  classTeacherId: string | null
  subjectTeachers: Record<string, string>
}
interface RosterPayload {
  classes: RosterClassDto[]
  teachers: { id: string; name: string }[]
  students: unknown[]
}

async function setupOnce(): Promise<void> {
  const schoolA = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!schoolA) throw new Error('tenant fixture school missing (run prisma/seed-demo.ts)')

  // A class whose Class Teacher is the fixture teacher (USER id convention).
  const teacherUser = await db.user.create({
    data: {
      email: `it-msg-${MARKER}-teacher@hawkings.test`,
      name: `IT Msg Teacher ${MARKER}`,
      role: 'TEACHER',
      schoolId: schoolA.id,
      status: 'ACTIVE',
      passwordHash: 'x',
    },
  })

  const subject = await db.subject.create({
    data: { schoolId: schoolA.id, name: `IT Msg Subject ${MARKER}`, code: `ITMSG${MARKER.slice(0, 6)}`, status: 'Active' },
  })

  const classA = await db.class.create({
    data: {
      schoolId: schoolA.id,
      name: `IT-MSG ${MARKER}`,
      gradeLevel: '6',
      section: 'A',
      classTeacherId: teacherUser.id,
    },
  })

  // A timetable row of that class taught by the fixture teacher — the
  // roster derives subjectTeachers from timetable.teacherName resolved
  // against the school's active teacher users (exact name match).
  await db.timetable.create({
    data: {
      schoolId: schoolA.id,
      classId: classA.id,
      subjectId: subject.id,
      day: 'Monday',
      period: 1,
      teacherName: teacherUser.name,
    },
  })

  const studentEmail = `it-msg-${MARKER}-student@hawkings.test`
  const studentUser = await db.user.create({
    data: { email: studentEmail, name: `IT Msg Student ${MARKER}`, role: 'STUDENT', schoolId: schoolA.id, status: 'ACTIVE', passwordHash: 'x' },
  })
  const student = await db.student.create({
    data: { schoolId: schoolA.id, userId: studentUser.id, classId: classA.id, rollNo: '01', admissionNo: `ITMSG${MARKER}` },
  })

  studentToken = await directSession(studentEmail)

  fx = {
    schoolA: schoolA.id,
    classA: { id: classA.id },
    teacher: { userId: teacherUser.id, name: teacherUser.name },
    student: { id: student.id, userId: studentUser.id, email: studentEmail },
    subjectId: subject.id,
  }
}

beforeAll(async () => {
  await withSetupRetry(async () => {
    await sweep()
    await setupOnce()
  })
})

async function sweep(): Promise<void> {
  const classes = await db.class.findMany({ where: { name: { startsWith: `IT-MSG ${MARKER}` } }, select: { id: true } })
  const classIds = classes.map((c) => c.id)
  if (classIds.length > 0) {
    await db.timetable.deleteMany({ where: { classId: { in: classIds } } })
    await db.student.deleteMany({ where: { classId: { in: classIds } } })
    await db.class.deleteMany({ where: { id: { in: classIds } } })
  }
  await db.session.deleteMany({ where: { user: { email: { startsWith: `it-msg-${MARKER}` } } } })
  await db.subject.deleteMany({ where: { code: { startsWith: `ITMSG${MARKER.slice(0, 6)}` } } })
  await db.user.deleteMany({ where: { email: { startsWith: `it-msg-${MARKER}` } } })
}

afterAll(async () => {
  await withSetupRetry(sweep)
})

// ─── 1. roster contract (the data the student contact picker needs) ──────

describe('STUDENT-CONTACTS · roster ships the teacher directory (student session)', () => {
  test('GET /api/students/roster → 200, teachers array is the active-teacher USER-id directory', async () => {
    const res = await as(studentToken, '/api/students/roster')
    expect(res.status).toBe(200)
    const body = await envelope(res)
    expect(body.ok).toBe(true)
    const data = (body.data ?? {}) as unknown as RosterPayload

    // The directory is present and contains the fixture teacher with the
    // USER id (the /api/messaging/threads/[userId] thread key).
    expect(Array.isArray(data.teachers)).toBe(true)
    const entry = data.teachers.find((t) => t.id === fx.teacher.userId)
    expect(entry).toBeDefined()
    expect(entry?.name).toBe(fx.teacher.name)

    // The caller's OWN class payload carries the class teacher + subject
    // teacher ids in the SAME id space the directory keys.
    const own = data.classes.find((c) => c.id === fx.classA.id)
    expect(own).toBeDefined()
    expect(own?.classTeacherId).toBe(fx.teacher.userId)
    expect(own?.subjectTeachers[fx.subjectId]).toBe(fx.teacher.userId)
  })

  test('every contact id the class payload carries resolves to a name in the directory (classContacts contract)', async () => {
    const res = await as(studentToken, '/api/students/roster')
    expect(res.status).toBe(200)
    const data = ((await envelope(res)).data ?? {}) as unknown as RosterPayload
    const own = data.classes.find((c) => c.id === fx.classA.id)
    expect(own).toBeDefined()

    const ids = [own!.classTeacherId ?? '', ...Object.values(own!.subjectTeachers ?? {})].filter(Boolean)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      // The exact lookup the student Messages module performs — no id
      // may dangle (a dangling id rendered an empty recipient picker).
      expect(data.teachers.some((t) => t.id === id)).toBe(true)
    }
  })
})

// ─── 2. role scoping (why the directory must exist) ──────────────────────

describe('STUDENT-CONTACTS · /api/teachers stays staff-only (the student path must not depend on it)', () => {
  test('GET /api/teachers with a student session → 403', async () => {
    const res = await as(studentToken, '/api/teachers')
    expect(res.status).toBe(403)
  })
})

// ─── 3. wiring guards (source contract — fail-closed on drift) ───────────

describe('STUDENT-CONTACTS · client wiring resolves from the roster directory', () => {
  const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

  test('students-store/server-sync.ts maps payload.teachers into the store as rosterTeachers', () => {
    const src = read('src/lib/store/students-store/server-sync.ts')
    // The payload type carries the directory…
    expect(src).toContain('teachers: { id: string; name: string }[]')
    // …mapRosterToRecords returns it…
    expect(src).toMatch(/return \{ students, classes, subjects, teachers: payload\.teachers \}/)
    // …and the sync writes it into the store under rosterTeachers.
    expect(src).toContain('rosterTeachers: teachers')
    // A real tenant's seed purge must also clear the directory.
    expect(src).toMatch(/rosterTeachers: \[\]/)
  })

  test('StudentsState + store declare and initialise rosterTeachers', () => {
    const types = read('src/lib/store/students-store/types.ts')
    expect(types).toMatch(/rosterTeachers:\s*\{\s*id: string;\s*name: string\s*\}\[\]/)
    const store = read('src/lib/store/students-store/store.ts')
    expect(store).toContain('rosterTeachers: []')
  })

  test('student Messages resolves contacts from the directory FIRST (staff roster only as fallback)', () => {
    const src = read('src/components/student/modules/messages/index.tsx')
    // Reactive subscription — contacts appear once the roster sync lands.
    expect(src).toContain('useStudentsStore((s) => s.rosterTeachers)')
    // The directory lookup is the PRIMARY name source…
    expect(src).toMatch(/rosterTeachers\.find\(\(t\) => t\.id === id\)/)
    // …with the staff roster as the preview-session fallback only.
    expect(src).toMatch(/directory\?\.name \?\? staff\?\.name/)
  })
})
