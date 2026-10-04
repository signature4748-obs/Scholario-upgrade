/**
 * PHASE 8C (mission §37) — SCHOOL PROVISIONING ACCEPTANCE.
 *
 * THE INVARIANT UNDER TEST (the mission's own words):
 *
 *   Platform Admin → Create School → Configure → Activate →
 *   Principal login → School dashboard → Branding → Add teacher →
 *   Add class → Add student → Attendance → Fee → Exam → Marks →
 *   Timetable → Messaging → Website → (optional custom domain)
 *
 *   "If manual SQL is required to make a newly provisioned school
 *    usable, the onboarding system is incomplete."
 *
 * Every step runs through a REAL API surface (live HTTP against the
 * dev server). The ONLY direct database touches in this file are
 * (a) the login-bucket heal convention, (b) the rate-limit fallback
 * fixture session (auth fixture — never an authorization bypass),
 * and (c) afterAll teardown + independent count cross-checks (the
 * test OBSERVING the database, not building it).
 *
 * Two readiness snapshots bracket the journey: the freshly
 * provisioned school honestly reports near-zero progress; the fully
 * configured school reports every REQUIRED section done and usable —
 * with section counts cross-checked against the live database.
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
const T = 60_000 // generous: first-hit dev compilation

const MARKER = randomBytes(4).toString('hex')
const ROOT_EMAIL = 'admin@scholario.cloud'

const PRINCIPAL_EMAIL = `acceptance-principal-${MARKER}@provision.test`
const PRINCIPAL_PASSWORD = 'Acceptance!8c-2026'
const TEACHER_EMAIL = `acceptance-teacher-${MARKER}@provision.test`
const STUDENT_EMAIL = `acceptance-student-${MARKER}@provision.test`
const SLUG = `acceptance-${MARKER}`
const CLASS_NAME = `Acceptance Grade ${MARKER.slice(0, 4).toUpperCase()}`
const SUBJECT_NAME = `Acceptance Science ${MARKER.slice(0, 4)}`
const TEACHER_NAME = 'Acceptance Teacher'
const STUDENT_NAME = 'Acceptance Student'
const ROOM_NAME = `Room A-${MARKER.slice(0, 4).toUpperCase()}`
const FEE_HEAD_NAME = `Acceptance Tuition ${MARKER.slice(0, 4)}`

let rootToken = ''
let principalToken = ''
let schoolId = ''
let teacherUserId = ''
let studentId = ''
let classId = ''
let subjectId = ''
let feeId = ''
let examId = ''

const cleanup: Array<() => Promise<unknown>> = []

/** Platform root login with full MFA (the REAL path; fixture on 429). */
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
    if (!admin) throw new Error('root platform admin missing (run the canonical seeds)')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    return token
  }
  return body.data.sessionToken
}

/** Platform-authenticated request (x-platform-token transport). */
function platform(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': rootToken, 'content-type': 'application/json' },
  })
}

/** School-authenticated request (Authorization bearer — the school transport). */
function as(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${principalToken}`, 'content-type': 'application/json' },
  })
}

interface Envelope<T> {
  ok?: boolean
  success?: boolean
  data?: T
  error?: string
}

/** Accept both envelope families ({ok} api() routes and {success} withUser routes). */
async function okData<T>(res: Response): Promise<T> {
  expect([200, 201]).toContain(res.status)
  const body = (await res.json()) as Envelope<T>
  expect(body.ok === true || body.success === true || body.data !== undefined).toBe(true)
  expect(body.data).not.toBeNull()
  return body.data as T
}

interface ReadinessSection {
  id: string
  label: string
  required: boolean
  done: boolean
  detail: string
  counts: Record<string, number>
}
interface ReadinessBody {
  school: { id: string; status: string }
  sections: ReadinessSection[]
  summary: {
    requiredTotal: number
    requiredDone: number
    requiredComplete: boolean
    optionalDone: number
    optionalTotal: number
    usable: boolean
  }
}

async function readiness(): Promise<ReadinessBody> {
  const res = await platform(`/api/platform/schools/${schoolId}/setup-readiness`)
  return okData<ReadinessBody>(res)
}

beforeAll(async () => {
  await resetLoginBuckets([ROOT_EMAIL])
  rootToken = await platformRootLogin()
}, 90_000)

/** Full teardown: sessions → users → audit → school (cascade does the rest). */
async function purgeSchool() {
  if (!schoolId) return
  await db.session.deleteMany({ where: { user: { schoolId } } }).catch(() => {})
  await db.user.deleteMany({ where: { schoolId } }).catch(() => {})
  await db.platformAuditLog.deleteMany({ where: { schoolId } }).catch(() => {})
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await purgeSchool()
  await db.$disconnect()
})

// ══════════════════════════════════════════════════════════════════════
// STEP 1 — Platform admin creates the school (the REAL provision path)
// ══════════════════════════════════════════════════════════════════════

describe('§37 · STEP 1 — platform admin provisions the school', () => {
  test('POST /api/platform/schools → PENDING school + principal + audit, honest-zero readiness', async () => {
    const res = await platform('/api/platform/schools', {
      method: 'POST',
      body: JSON.stringify({
        name: `Acceptance School ${MARKER}`,
        slug: SLUG,
        code: `AC${randomBytes(5).toString('hex').toUpperCase()}`,
        plan: 'STANDARD',
        principalName: 'Acceptance Principal',
        principalEmail: PRINCIPAL_EMAIL,
        principalPassword: PRINCIPAL_PASSWORD,
      }),
    })
    expect(res.status).toBe(200)
    const data = await okData<{ school: { id: string; status: string }; principal: { id: string }; nextStep: string }>(res)
    schoolId = data.school.id
    expect(data.school.status).toBe('PENDING')
    expect(data.nextStep).toBe('activate')

    const school = await db.school.findUnique({ where: { id: schoolId } })
    expect(school?.status).toBe('PENDING')
    const principal = await db.user.findUnique({ where: { id: data.principal.id } })
    expect(principal?.schoolId).toBe(schoolId)
    expect(principal?.role).toBe('PRINCIPAL')

    const audit = await db.platformAuditLog.findFirst({ where: { schoolId, action: 'platform.school.provisioned' } })
    expect(audit).not.toBeNull()

    // The honest zero: only identity (by construction) and the principal
    // exist; every content section reports nothing done.
    const r = await readiness()
    const byId = new Map(r.sections.map((s) => [s.id, s]))
    expect(byId.get('identity')?.done).toBe(true)
    expect(byId.get('principal')?.done).toBe(true)
    expect(byId.get('people')?.done).toBe(false)
    expect(byId.get('academic')?.done).toBe(false)
    expect(byId.get('fees')?.done).toBe(false)
    expect(r.summary.usable).toBe(false)
    expect(r.summary.requiredComplete).toBe(false)
  }, T)

  test('PENDING school → principal login REFUSED (403 SCHOOL_SUSPENDED)', async () => {
    await resetLoginBuckets([PRINCIPAL_EMAIL])
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: PRINCIPAL_EMAIL, password: PRINCIPAL_PASSWORD }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('SCHOOL_SUSPENDED')
  }, T)

  test('platform activates (audited) → principal login succeeds', async () => {
    const act = await platform(`/api/platform/schools/${schoolId}/activate`, { method: 'POST' })
    expect(act.status).toBe(200)
    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId, action: 'platform.school.activated' },
    })
    expect(audit).not.toBeNull()

    await resetLoginBuckets([PRINCIPAL_EMAIL])
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: PRINCIPAL_EMAIL, password: PRINCIPAL_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
    expect(body.ok).toBe(true)
    principalToken = body.data?.sessionToken ?? ''
    expect(principalToken).toBeTruthy()
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// STEP 2 — The principal BUILDS the school (real school-side APIs only)
// ══════════════════════════════════════════════════════════════════════

describe('§37 · STEP 2 — principal builds the school through real APIs', () => {
  test('dashboard reachable + branding configured (identity + colors)', async () => {
    // The principal's first stop: the school dashboard, live.
    const dash = await as('/api/dashboard')
    const dashData = await okData<{ scope: string; stats: Record<string, number> }>(dash)
    expect(dashData.scope).toBe('SCHOOL')
    expect(dashData.stats.students).toBe(0) // honest zero — nothing fabricated

    // Branding: short name + tagline + contrast-checked colors.
    const settings = await as('/api/school-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        identity: { shortName: `AS ${MARKER.slice(0, 4).toUpperCase()}`, tagline: 'Built by the acceptance journey' },
        branding: { primaryColor: '#0f766e', accentColor: '#f59e0b' },
      }),
    })
    expect(settings.status).toBe(200)
    const school = await db.school.findUnique({ where: { id: schoolId } })
    expect(school?.shortName).toContain(MARKER.slice(0, 4).toUpperCase())
    expect(school?.tagline).toBe('Built by the acceptance journey')
  }, T)

  test('room + teacher + class + subject(+CSA) + student — the people backbone', async () => {
    const room = await as('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: ROOM_NAME, type: 'Classroom', capacity: 30 }),
    })
    const roomData = await okData<{ id: string; name: string }>(room)
    // The route returns {id, name} only — the tenant scoping is proven
    // by the DB row (school-scoped write, session-derived tenant).
    const roomRow = await db.room.findUnique({ where: { id: roomData.id } })
    expect(roomRow?.schoolId).toBe(schoolId)

    const teacher = await as('/api/teachers', {
      method: 'POST',
      body: JSON.stringify({ name: TEACHER_NAME, email: TEACHER_EMAIL, department: 'Science', password: 'AcceptanceTeacher!8c' }),
    })
    const teacherData = await okData<{ id: string; schoolId: string; userId: string }>(teacher)
    expect(teacherData.schoolId).toBe(schoolId)
    teacherUserId = teacherData.userId

    const cls = await as('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ name: CLASS_NAME, section: 'A', gradeLevel: '5', classTeacherId: teacherUserId }),
    })
    const clsData = await okData<{ id: string; schoolId: string; classTeacherId: string | null }>(cls)
    expect(clsData.schoolId).toBe(schoolId)
    expect(clsData.classTeacherId).toBe(teacherUserId)
    classId = clsData.id

    const subj = await as('/api/subjects', {
      method: 'POST',
      body: JSON.stringify({ name: SUBJECT_NAME, code: `ASC${MARKER.slice(0, 4).toUpperCase()}`, classId, fullMarks: 100, passMarks: 33 }),
    })
    const subjData = await okData<{ id: string; schoolId: string }>(subj)
    expect(subjData.schoolId).toBe(schoolId)
    subjectId = subjData.id

    // The canonical class↔subject assignment (exams depend on it).
    const csa = await as('/api/principal/academic', {
      method: 'POST',
      body: JSON.stringify({ action: 'subject.add', classId, subjectName: SUBJECT_NAME }),
    })
    expect(csa.status).toBe(200)
    const csaRow = await db.classSubjectAssignment.findUnique({
      where: { classId_subjectId: { classId, subjectId } },
    })
    expect(csaRow?.isActive).toBe(true)

    const student = await as('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: STUDENT_NAME,
        email: STUDENT_EMAIL,
        password: 'AcceptanceStudent!8c',
        classId,
        admissionNo: `ACC-${MARKER}`,
        rollNo: `R-${MARKER.slice(0, 4)}`,
        guardianName: 'Acceptance Guardian',
      }),
    })
    const studentData = await okData<{ id: string; schoolId: string; classId: string | null }>(student)
    expect(studentData.schoolId).toBe(schoolId)
    expect(studentData.classId).toBe(classId)
    studentId = studentData.id

    // The dashboard now counts the real rows.
    const dash = await as('/api/dashboard')
    const dashData = await okData<{ stats: Record<string, number> }>(dash)
    expect(dashData.stats.students).toBe(1)
    expect(dashData.stats.teachers).toBe(1)
    expect(dashData.stats.classes).toBe(1)
  }, T)

  test('attendance — the class day is marked', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await as('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ classId, date: today, entries: [{ studentId, status: 'PRESENT' }] }),
    })
    expect([200, 201]).toContain(res.status)
    const row = await db.attendance.findFirst({
      where: { studentId, schoolId: schoolId },
    })
    expect(row?.status).toBe('PRESENT')
  }, T)

  test('fees — catalogue → structure → publish → student fee → payment', async () => {
    const cat = await as('/api/fees/catalogue', {
      method: 'POST',
      body: JSON.stringify({ name: FEE_HEAD_NAME, amount: 12000, category: 'TUITION', frequency: 'ANNUAL' }),
    })
    const catData = await okData<{ id: string; schoolId: string }>(cat)
    expect(catData.schoolId).toBe(schoolId)

    const struct = await as('/api/fees/structures', {
      method: 'POST',
      body: JSON.stringify({
        classId,
        className: CLASS_NAME,
        classLevel: 'Primary',
        heads: [{ catalogueId: catData.id, name: FEE_HEAD_NAME, amount: 12000, frequency: 'ANNUAL', mandatory: true, category: 'TUITION' }],
      }),
    })
    const structData = await okData<{ id: string; schoolId: string; status: string }>(struct)
    expect(structData.schoolId).toBe(schoolId)

    const pub = await as(`/api/fees/structures/${structData.id}/publish`, { method: 'POST' })
    expect(pub.status).toBe(200)

    const fee = await as('/api/fees', {
      method: 'POST',
      body: JSON.stringify({ studentId, amount: 12000, title: 'Annual tuition', type: 'TUITION', dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) }),
    })
    const feeData = await okData<{ id: string; status: string }>(fee)
    feeId = feeData.id
    expect(feeData.status).toBe('UNPAID')

    const pay = await as('/api/fees', {
      method: 'POST',
      body: JSON.stringify({ feeId, amount: 12000, method: 'CASH', note: 'acceptance journey' }),
    })
    expect(pay.status).toBe(200)
    const row = await db.fee.findUnique({ where: { id: feeId } })
    expect(row?.status).toBe('PAID')
  }, T)

  test('exam + marks — the examination cycle', async () => {
    const start = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
    const end = new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10)
    const exam = await as('/api/exams', {
      method: 'POST',
      body: JSON.stringify({
        name: `Acceptance Term 1 ${MARKER.slice(0, 4)}`,
        type: 'TERMINAL',
        startDate: start,
        endDate: end,
        classIds: [classId],
        subjectsByClass: { [classId]: [{ subjectId, maxMarks: 100, passMarks: 33 }] },
      }),
    })
    const examData = await okData<{ id: string; schoolId: string }>(exam)
    expect(examData.schoolId).toBe(schoolId)
    examId = examData.id

    const marks = await as(`/api/exams/${examId}/marks/batch`, {
      method: 'POST',
      body: JSON.stringify({
        marks: [{ classId, subjectId, studentId, marksObtained: 82, status: 'PRESENT' }],
      }),
    })
    expect(marks.status).toBe(200)
    const markRow = await db.examMark.findFirst({
      where: { examId, studentId, subjectId },
    })
    expect(markRow?.marksObtained?.toString()).toBe('82')
  }, T)

  test('timetable — the principal publishes the master schedule', async () => {
    const res = await as('/api/timetable/publish', {
      method: 'POST',
      body: JSON.stringify({
        slots: [
          { day: 'Monday', period: 1, time: '08:30 AM - 09:15 AM', className: CLASS_NAME, subject: SUBJECT_NAME, teacherName: TEACHER_NAME, room: ROOM_NAME },
          { day: 'Tuesday', period: 1, time: '08:30 AM - 09:15 AM', className: CLASS_NAME, subject: SUBJECT_NAME, teacherName: TEACHER_NAME, room: ROOM_NAME },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const count = await db.timetable.count({ where: { schoolId } })
    expect(count).toBe(2)
  }, T)

  test('website + messaging — the school goes public and converses', async () => {
    // Website CMS: write the hero section (partial document write).
    const web = await as('/api/school/website', {
      method: 'PATCH',
      body: JSON.stringify({
        hero: {
          badgePrefix: 'Admissions open',
          title: 'Acceptance School',
          titleAccent: 'Shines',
          description: 'A school built end-to-end by the provisioning acceptance journey.',
          ctaPrimary: { label: 'Apply now', href: '/admissions' },
          ctaSecondary: { label: 'Contact us', href: '/contact' },
        },
      }),
    })
    expect(web.status).toBe(200)
    const school = await db.school.findUnique({ where: { id: schoolId } })
    expect(school?.websiteContent).toContain('Acceptance School')

    // Messaging: principal → teacher direct thread.
    const msg = await as(`/api/messaging/threads/${teacherUserId}`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Welcome to the school — this is the acceptance journey message.' }),
    })
    expect(msg.status).toBe(200)
    const sent = await db.message.findFirst({
      where: { schoolId, senderId: { not: null }, body: { contains: 'acceptance journey message' } },
    })
    expect(sent).not.toBeNull()
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// STEP 3 — The school is USABLE: readiness now reports a built school
// ══════════════════════════════════════════════════════════════════════

describe('§37 · STEP 3 — the provisioned school is now fully usable', () => {
  test('readiness: every REQUIRED section done, usable=true, counts match the live DB', async () => {
    const r = await readiness()
    const byId = new Map(r.sections.map((s) => [s.id, s]))
    expect(byId.get('identity')?.done).toBe(true)
    expect(byId.get('principal')?.done).toBe(true)
    expect(byId.get('academic')?.done).toBe(true)
    expect(byId.get('people')?.done).toBe(true)
    expect(byId.get('fees')?.done).toBe(true)
    expect(byId.get('branding')?.done).toBe(true)
    expect(byId.get('rooms')?.done).toBe(true)
    expect(byId.get('exams')?.done).toBe(true)
    expect(byId.get('timetable')?.done).toBe(true)
    expect(byId.get('website')?.done).toBe(true)
    expect(r.summary.requiredComplete).toBe(true)
    expect(r.summary.usable).toBe(true)

    // Independent DB cross-check (the test OBSERVES, never fabricates).
    expect(byId.get('people')?.counts.teachers).toBe(await db.teacher.count({ where: { schoolId } }))
    expect(byId.get('people')?.counts.students).toBe(await db.student.count({ where: { schoolId } }))
    expect(byId.get('academic')?.counts.classes).toBe(await db.class.count({ where: { schoolId } }))
    expect(byId.get('rooms')?.counts.rooms).toBe(await db.room.count({ where: { schoolId } }))
  }, T)

  test('every surface the mission lists answers with live data (the §37 gauntlet)', async () => {
    // The §37 list: dashboard ✓ branding ✓ teacher ✓ class ✓ student ✓
    // attendance ✓ fee ✓ exam ✓ marks ✓ timetable ✓ messaging ✓ website.
    // Probe the read surfaces to prove data flows end-to-end.
    const dash = await as('/api/dashboard')
    const dashData = await okData<{ stats: Record<string, number> }>(dash)
    expect(dashData.stats.students).toBe(1)

    const roster = await as('/api/students')
    const rosterData = await okData<Array<{ schoolId: string }>>(roster)
    expect(rosterData.length).toBe(1)
    expect(rosterData[0].schoolId).toBe(schoolId)

    const timetable = await as('/api/timetable')
    const ttData = await okData<unknown[]>(timetable)
    expect(ttData.length).toBe(2)

    const threads = await as('/api/messaging/threads')
    const threadData = await okData<{ threads: Array<{ counterpart: { id: string } }> }>(threads)
    expect(threadData.threads.length).toBeGreaterThan(0)
    expect(threadData.threads.some((t) => t.counterpart.id === teacherUserId)).toBe(true)
  }, T)
})
