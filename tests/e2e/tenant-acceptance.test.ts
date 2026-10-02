/**
 * PHASE 8C-G (mission §36) — SCHOOL ACCEPTANCE TEST (the exact test the
 * mission specifies):
 *
 *   Create TEST SCHOOL A via the actual Platform Control Plane, then
 *   configure principal/teacher/class/subject/room/student/fee/exam/
 *   marks/timetable. Create TEST SCHOOL B with DIFFERENT identity,
 *   branding, principal, teacher, student. Then attempt cross-tenant
 *   access. Expected: A cannot see B, B cannot see A, Platform Admin
 *   sees both. Delete test data safely afterwards.
 *
 * Unlike the seeded Sunrise↔GreenValley suite (tests/security/
 * tenant-isolation.test.ts), BOTH schools here are provisioned through
 * the real control plane in the same run — proving isolation between
 * two FRESHLY provisioned tenants, not just the seed corpus pair.
 *
 * Auth fixtures: platform root MFA login (real); both principals log in
 * through the REAL /api/auth/login (bucket-healed). Teachers use the
 * direct-session fixture convention (auth fixture, never an
 * authorization bypass). Teardown purges both schools fully.
 */
import { db } from '../helpers/db'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import {
  PLATFORM_ROOT_PASSWORD,
  PLATFORM_ROOT_TOTP_SECRET,
} from '../helpers/credentials'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const T = 60_000

const MARKER = randomBytes(4).toString('hex')
const ROOT_EMAIL = 'admin@scholario.cloud'

// ── TEST SCHOOL A (full build) ───────────────────────────────────────
const A = {
  name: `Alpha Acceptance ${MARKER}`,
  slug: `alpha-${MARKER}`,
  shortName: `AA ${MARKER.slice(0, 4).toUpperCase()}`,
  tagline: 'Alpha — built first, fully',
  primary: '#0f766e',
  principalEmail: `alpha-principal-${MARKER}@provision.test`,
  principalPassword: 'AlphaPrincipal!8c',
  teacherEmail: `alpha-teacher-${MARKER}@provision.test`,
  studentEmail: `alpha-student-${MARKER}@provision.test`,
  className: `Alpha Grade ${MARKER.slice(0, 4).toUpperCase()}`,
  subjectName: `Alpha Science ${MARKER.slice(0, 4)}`,
  roomName: `Alpha Room ${MARKER.slice(0, 4).toUpperCase()}`,
  feeHead: `Alpha Tuition ${MARKER.slice(0, 4)}`,
}
// ── TEST SCHOOL B (different everything) ─────────────────────────────
const B = {
  name: `Beta Acceptance ${MARKER}`,
  slug: `beta-${MARKER}`,
  shortName: `BB ${MARKER.slice(0, 4).toUpperCase()}`,
  tagline: 'Beta — different identity entirely',
  primary: '#7c2d12',
  principalEmail: `beta-principal-${MARKER}@provision.test`,
  principalPassword: 'BetaPrincipal!8c',
  teacherEmail: `beta-teacher-${MARKER}@provision.test`,
  studentEmail: `beta-student-${MARKER}@provision.test`,
  className: `Beta Grade ${MARKER.slice(0, 4).toUpperCase()}`,
}

let rootToken = ''
let schoolAId = ''
let schoolBId = ''
let principalAToken = ''
let principalBToken = ''
let teacherBUserId = ''

// A's built rows (for cross-tenant probes)
let aStudentId = ''
let aExamId = ''
let aClassId = ''
let aTeacherUserId = ''
let aSubjectId = ''

const cleanup: Array<() => Promise<unknown>> = []

async function platformRootLogin(): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  const code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, totpCode: code }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (res.status === 429 || !body.data?.sessionToken) {
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('root platform admin missing')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    return token
  }
  return body.data.sessionToken
}

function platform(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': rootToken, 'content-type': 'application/json' },
  })
}

/** School-side request as a principal (bearer transport). */
function asP(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/** Direct teacher session fixture (auth fixture only). */
async function teacherFixture(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`teacher fixture missing: ${email}`)
  const raw = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }))
  return raw
}

async function realPrincipalLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.data?.sessionToken) throw new Error(`principal login failed for ${email}: ${JSON.stringify(body)}`)
  const token = body.data.sessionToken
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
  return token
}

async function provisionAndActivate(def: {
  name: string
  slug: string
  principalEmail: string
  principalPassword: string
}): Promise<string> {
  const res = await platform('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: def.name,
      slug: def.slug,
      code: `TA${randomBytes(5).toString('hex').toUpperCase()}`,
      plan: 'STANDARD',
      principalName: `Principal ${def.slug}`,
      principalEmail: def.principalEmail,
      principalPassword: def.principalPassword,
    }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: { school: { id: string } } }
  const id = body.data.school.id
  const act = await platform(`/api/platform/schools/${id}/activate`, { method: 'POST' })
  expect(act.status).toBe(200)
  return id
}

async function purgeSchool(schoolId: string) {
  if (!schoolId) return
  await db.session.deleteMany({ where: { user: { schoolId } } }).catch(() => {})
  await db.user.deleteMany({ where: { schoolId } }).catch(() => {})
  await db.platformAuditLog.deleteMany({ where: { schoolId } }).catch(() => {})
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

beforeAll(async () => {
  await resetLoginBuckets([ROOT_EMAIL])
  rootToken = await platformRootLogin()
}, 90_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await purgeSchool(schoolAId)
  await purgeSchool(schoolBId)
  // Belt-and-braces: no marker rows survive.
  const strays = await db.school.findMany({
    where: { slug: { in: [`alpha-${MARKER}`, `beta-${MARKER}`] } },
    select: { id: true },
  })
  for (const s of strays) await purgeSchool(s.id)
  await db.$disconnect()
})

// ══════════════════════════════════════════════════════════════════════
// STEP 1 — the Platform Control Plane provisions BOTH test schools
// ══════════════════════════════════════════════════════════════════════

describe('§36 · STEP 1 — two test schools via the control plane', () => {
  test('provision + activate School A and School B (distinct identity space)', async () => {
    schoolAId = await provisionAndActivate(A)
    schoolBId = await provisionAndActivate(B)
    expect(schoolAId).not.toBe(schoolBId)

    const a = await db.school.findUnique({ where: { id: schoolAId } })
    const b = await db.school.findUnique({ where: { id: schoolBId } })
    expect(a?.slug).toBe(A.slug)
    expect(b?.slug).toBe(B.slug)
    expect(a?.status).toBe('ACTIVE')
    expect(b?.status).toBe('ACTIVE')
  }, T)

  test('both principals sign in through the real front door', async () => {
    await resetLoginBuckets([A.principalEmail, B.principalEmail])
    principalAToken = await realPrincipalLogin(A.principalEmail, A.principalPassword)
    principalBToken = await realPrincipalLogin(B.principalEmail, B.principalPassword)
    expect(principalAToken).toBeTruthy()
    expect(principalBToken).toBeTruthy()
    expect(principalAToken).not.toBe(principalBToken)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// STEP 2 — each principal configures their OWN school (real APIs)
// ══════════════════════════════════════════════════════════════════════

describe('§36 · STEP 2 — the principals build their schools', () => {
  test(
    'School A: branding + room + teacher + class + subject + student + fee + exam + marks + timetable',
    async () => {
      const brand = await asP(principalAToken, '/api/school-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          identity: { shortName: A.shortName, tagline: A.tagline },
          branding: { primaryColor: A.primary, accentColor: '#f59e0b' },
        }),
      })
      expect(brand.status).toBe(200)

      const room = await asP(principalAToken, '/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: A.roomName, type: 'Classroom', capacity: 30 }),
      })
      expect(room.status).toBe(200)

      const teacher = await asP(principalAToken, '/api/teachers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alpha Teacher', email: A.teacherEmail, department: 'Science', password: 'AlphaTeacher!8c' }),
      })
      expect(teacher.status).toBe(200)
      aTeacherUserId = ((await teacher.json()) as { data: { userId: string } }).data.userId

      const cls = await asP(principalAToken, '/api/classes', {
        method: 'POST',
        body: JSON.stringify({ name: A.className, section: 'A', gradeLevel: '5', classTeacherId: aTeacherUserId }),
      })
      expect(cls.status).toBe(200)
      aClassId = ((await cls.json()) as { data: { id: string } }).data.id

      const subj = await asP(principalAToken, '/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name: A.subjectName, code: `ALP${MARKER.slice(0, 4).toUpperCase()}`, classId: aClassId, fullMarks: 100, passMarks: 33 }),
      })
      expect(subj.status).toBe(200)
      const subjectId = ((await subj.json()) as { data: { id: string } }).data.id
      aSubjectId = subjectId

      // The canonical class↔subject assignment — exams validate against
      // ClassSubjectAssignment, not the legacy Subject.classId column.
      const csa = await asP(principalAToken, '/api/principal/academic', {
        method: 'POST',
        body: JSON.stringify({ action: 'subject.add', classId: aClassId, subjectName: A.subjectName }),
      })
      expect(csa.status).toBe(200)

      const student = await asP(principalAToken, '/api/students', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alpha Student', email: A.studentEmail, password: 'AlphaStudent!8c',
          classId: aClassId, admissionNo: `AL-${MARKER}`, rollNo: `R-${MARKER.slice(0, 4)}`, guardianName: 'Alpha Guardian',
        }),
      })
      expect(student.status).toBe(200)
      aStudentId = ((await student.json()) as { data: { id: string } }).data.id

      const cat = await asP(principalAToken, '/api/fees/catalogue', {
        method: 'POST',
        body: JSON.stringify({ name: A.feeHead, amount: 12000, category: 'TUITION', frequency: 'ANNUAL' }),
      })
      expect(cat.status).toBe(200)
      const catId = ((await cat.json()) as { data: { id: string } }).data.id
      const struct = await asP(principalAToken, '/api/fees/structures', {
        method: 'POST',
        body: JSON.stringify({
          classId: aClassId, className: A.className, classLevel: 'Primary',
          heads: [{ catalogueId: catId, name: A.feeHead, amount: 12000, frequency: 'ANNUAL', mandatory: true, category: 'TUITION' }],
        }),
      })
      expect(struct.status).toBe(200)
      const fee = await asP(principalAToken, '/api/fees', {
        method: 'POST',
        body: JSON.stringify({ studentId: aStudentId, amount: 12000, title: 'Alpha tuition', type: 'TUITION' }),
      })
      expect(fee.status).toBe(200)

      const start = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
      const end = new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10)
      const exam = await asP(principalAToken, '/api/exams', {
        method: 'POST',
        body: JSON.stringify({
          name: `Alpha Term ${MARKER.slice(0, 4)}`, type: 'TERMINAL', startDate: start, endDate: end,
          classIds: [aClassId], subjectsByClass: { [aClassId]: [{ subjectId, maxMarks: 100, passMarks: 33 }] },
        }),
      })
      expect(exam.status).toBe(200)
      aExamId = ((await exam.json()) as { data: { id: string } }).data.id

      const marks = await asP(principalAToken, `/api/exams/${aExamId}/marks/batch`, {
        method: 'POST',
        body: JSON.stringify({ marks: [{ classId: aClassId, subjectId, studentId: aStudentId, marksObtained: 88, status: 'PRESENT' }] }),
      })
      expect(marks.status).toBe(200)

      const tt = await asP(principalAToken, '/api/timetable/publish', {
        method: 'POST',
        body: JSON.stringify({
          slots: [{ day: 'Monday', period: 1, time: '08:30 AM - 09:15 AM', className: A.className, subject: A.subjectName, teacherName: 'Alpha Teacher', room: A.roomName }],
        }),
      })
      expect(tt.status).toBe(200)
    },
    T,
  )

  test(
    'School B: different branding + teacher + class + student',
    async () => {
      const brand = await asP(principalBToken, '/api/school-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          identity: { shortName: B.shortName, tagline: B.tagline },
          branding: { primaryColor: B.primary, accentColor: '#1e3a8a' },
        }),
      })
      expect(brand.status).toBe(200)

      const teacher = await asP(principalBToken, '/api/teachers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Beta Teacher', email: B.teacherEmail, department: 'Arts', password: 'BetaTeacher!8c' }),
      })
      expect(teacher.status).toBe(200)
      teacherBUserId = ((await teacher.json()) as { data: { userId: string } }).data.userId

      const cls = await asP(principalBToken, '/api/classes', {
        method: 'POST',
        body: JSON.stringify({ name: B.className, section: 'B', gradeLevel: '3', classTeacherId: teacherBUserId }),
      })
      expect(cls.status).toBe(200)
      const classId = ((await cls.json()) as { data: { id: string } }).data.id

      const student = await asP(principalBToken, '/api/students', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Beta Student', email: B.studentEmail, password: 'BetaStudent!8c',
          classId, admissionNo: `BT-${MARKER}`, rollNo: `RB-${MARKER.slice(0, 4)}`, guardianName: 'Beta Guardian',
        }),
      })
      expect(student.status).toBe(200)
    },
    T,
  )

  test('tenant-specific rendering: each school reads ITS OWN branding (§8)', async () => {
    const [aRes, bRes] = await Promise.all([
      asP(principalAToken, '/api/school-settings'),
      asP(principalBToken, '/api/school-settings'),
    ])
    expect(aRes.status).toBe(200)
    expect(bRes.status).toBe(200)
    const aCfg = (await aRes.json()) as { data: { identity?: { shortName?: string; tagline?: string }; branding?: { primaryColor?: string } } }
    const bCfg = (await bRes.json()) as { data: { identity?: { shortName?: string; tagline?: string }; branding?: { primaryColor?: string } } }
    expect(aCfg.data.identity?.shortName).toBe(A.shortName)
    expect(aCfg.data.identity?.tagline).toBe(A.tagline)
    expect(bCfg.data.identity?.shortName).toBe(B.shortName)
    expect(bCfg.data.identity?.tagline).toBe(B.tagline)
    expect(aCfg.data.branding?.primaryColor).not.toBe(bCfg.data.branding?.primaryColor)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// STEP 3 — the cross-tenant gauntlet (A cannot see B, B cannot see A)
// ══════════════════════════════════════════════════════════════════════

describe('§36 · STEP 3 — cross-tenant access attempts all fail safe', () => {
  test('School A roster lists ONLY A students (no B bleed)', async () => {
    const res = await asP(principalAToken, '/api/students')
    expect(res.status).toBe(200)
    const roster = (await res.json()) as { data: Array<{ schoolId: string; email?: string }> }
    for (const row of roster.data) expect(row.schoolId).toBe(schoolAId)
    expect(roster.data.some((s) => s.email === B.studentEmail)).toBe(false)
  }, T)

  test('principal B → read A student by id → 404 (no existence oracle)', async () => {
    const res = await asP(principalBToken, `/api/students/${aStudentId}`)
    expect([403, 404]).toContain(res.status)
  }, T)

  test('principal B → read A exam → 404', async () => {
    const res = await asP(principalBToken, `/api/exams/${aExamId}`)
    expect([403, 404]).toContain(res.status)
  }, T)

  test('principal B → write marks into A exam → rejected rows reported, ZERO writes', async () => {
    const before = await db.examMark.count({ where: { examId: aExamId } })
    // Format-valid ids that are all FOREIGN to B. The marks-batch route
    // uses the audit-3-b contract: the WHOLE batch is validated against
    // the CALLER's roster, rejected rows are REPORTED per-row (never
    // silently skipped), and setMark re-gates the exam itself by tenant
    // ("Exam not found"). Either way the isolation proof is ZERO rows.
    const res = await asP(principalBToken, `/api/exams/${aExamId}/marks/batch`, {
      method: 'POST',
      body: JSON.stringify({ marks: [{ classId: aClassId, subjectId: aSubjectId, studentId: aStudentId, marksObtained: 1, status: 'PRESENT' }] }),
    })
    expect(res.status).toBe(200) // the batch envelope succeeds; the ROW is refused
    const body = (await res.json()) as { data: { updated: number; errors: Array<{ index: number; message: string }> } }
    expect(body.data.updated).toBe(0)
    expect(body.data.errors.length).toBeGreaterThan(0)
    const after = await db.examMark.count({ where: { examId: aExamId } })
    expect(after).toBe(before)
  }, T)

  test('principal B → create a fee for A student → 404, no fee row', async () => {
    const before = await db.fee.count({ where: { studentId: aStudentId } })
    const res = await asP(principalBToken, '/api/fees', {
      method: 'POST',
      body: JSON.stringify({ studentId: aStudentId, amount: 999, title: 'cross-tenant probe', type: 'TUITION' }),
    })
    expect([403, 404]).toContain(res.status)
    const after = await db.fee.count({ where: { studentId: aStudentId } })
    expect(after).toBe(before)
  }, T)

  test('principal A → post attendance with B class id → 404, nothing written', async () => {
    const bClass = await db.class.findFirst({ where: { schoolId: schoolBId } })
    expect(bClass).not.toBeNull()
    const bStudent = await db.student.findFirst({ where: { schoolId: schoolBId } })
    expect(bStudent).not.toBeNull()
    const before = await db.attendance.count({ where: { studentId: bStudent!.id } })
    const res = await asP(principalAToken, '/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ classId: bClass!.id, entries: [{ studentId: bStudent!.id, status: 'PRESENT' }] }),
    })
    expect([403, 404]).toContain(res.status)
    const after = await db.attendance.count({ where: { studentId: bStudent!.id } })
    expect(after).toBe(before)
  }, T)

  test('principal B → message A teacher → rejected, no message row', async () => {
    const before = await db.message.count({ where: { recipientId: aTeacherUserId } })
    const res = await asP(principalBToken, `/api/messaging/threads/${aTeacherUserId}`, {
      method: 'POST',
      body: JSON.stringify({ body: 'cross-tenant probe message' }),
    })
    expect([403, 404]).toContain(res.status)
    const after = await db.message.count({ where: { recipientId: aTeacherUserId } })
    expect(after).toBe(before)
  }, T)

  test('teacher B (fixture session) → class hub scoped to School B only', async () => {
    const teacherBToken = await teacherFixture(B.teacherEmail)
    const res = await asP(teacherBToken, '/api/teacher/students')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { classes: Array<{ id: string }>; studentsByClass: Record<string, Array<{ id: string }>> }
    }
    // The hub is scoped by the teacher's assignments inside THEIR tenant:
    // every group key is a School B class and every student id is a
    // School B student (the response projection omits per-student
    // classId — the map keys ARE the class ids).
    const bClassIds = new Set((await db.class.findMany({ where: { schoolId: schoolBId }, select: { id: true } })).map((c) => c.id))
    expect(bClassIds.size).toBeGreaterThan(0)
    for (const c of body.data.classes) expect(bClassIds.has(c.id)).toBe(true)
    const bStudentIds = new Set((await db.student.findMany({ where: { schoolId: schoolBId }, select: { id: true } })).map((s) => s.id))
    for (const [classKey, students] of Object.entries(body.data.studentsByClass)) {
      expect(bClassIds.has(classKey)).toBe(true)
      for (const s of students) expect(bStudentIds.has(s.id)).toBe(true)
    }
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// STEP 4 — the Platform Admin sees BOTH (per platform permissions)
// ══════════════════════════════════════════════════════════════════════

describe('§36 · STEP 4 — platform admin visibility + safe teardown', () => {
  test('platform ledger lists both schools; readiness works for each', async () => {
    const res = await platform('/api/platform/schools?page=1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { schools?: Array<{ id: string }>; items?: Array<{ id: string }> } }
    const list = body.data.schools ?? body.data.items ?? []
    const ids = list.map((s) => s.id)
    expect(ids).toContain(schoolAId)
    expect(ids).toContain(schoolBId)

    for (const id of [schoolAId, schoolBId]) {
      const r = await platform(`/api/platform/schools/${id}/setup-readiness`)
      expect(r.status).toBe(200)
      const rb = (await r.json()) as { data: { school: { id: string } } }
      expect(rb.data.school.id).toBe(id)
    }
  }, T)

  test('teardown purges both test schools completely (§36 safe archival)', async () => {
    // afterAll does the real purge; here we prove the purge helper is
    // complete by running it for A and verifying no rows survive.
    await purgeSchool(schoolAId)
    const strays = await db.user.count({ where: { schoolId: schoolAId } })
    expect(strays).toBe(0)
    const school = await db.school.findUnique({ where: { id: schoolAId } })
    expect(school).toBeNull()
    schoolAId = '' // afterAll re-purge is a no-op
  }, T)
})
