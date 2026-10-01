import { db } from '../helpers/db'
/**
 * PHASE 8A — EMPTY SCHOOL (mission §48) API acceptance: honest zeros, then
 * the first building blocks.
 *
 * THE INVARIANTS UNDER TEST (Green Valley Public School — the CLEAN tenant,
 * bootstrap configuration only, ZERO business data):
 *   1. Every read surface shows its HONEST empty state — no fabricated
 *      numbers, no demo-tenant bleed: dashboard stats are all zero
 *      (students/teachers/classes/subjects/exams/fees collected...),
 *      /api/students is [], /api/exams is empty, /api/fees is [].
 *   2. "The Principal must be able to start building the school normally":
 *      the first teacher (POST /api/teachers), the first class
 *      (POST /api/classes), the first subject (POST /api/subjects) and
 *      the first student (POST /api/students) all succeed (2xx) and land
 *      SCHOOL-SCOPED to green-valley — and the dashboard counts then move
 *      from the honest zero to the real numbers.
 *
 * Live suite: dev server (default :3000), REAL login for
 * principal.b@greenvalley.test with resetLoginBuckets + unique
 * X-Forwarded-For RUN_IP (DB-backed login limiter, Phase 8A).
 *
 * Self-cleaning: every row the create flows write (User×2, Teacher,
 * Class, Subject, Student + the ACCOUNT_CREATED audit rows) is deleted in
 * afterAll — the clean school returns to its at-rest ZERO state.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000

const RUN_IP = `10.239.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const GV_PRINCIPAL = 'principal.b@greenvalley.test'
const PW = TENANT_FIXTURE_PASSWORD
const MARKER = randomBytes(4).toString('hex')

const teacherEmail = `first.teacher.${MARKER}@greenvalley.test`
const studentEmail = `first.student.${MARKER}@greenvalley.test`
const className = `Grade Probe ${MARKER}`
const admissionNo = `GV-PROBE-${MARKER}`

let gvId = ''
let token = ''
const testStart = new Date()
let created: { teacherId: string; teacherUserId: string; classId: string; subjectId: string; studentId: string; studentUserId: string } | null = null

beforeAll(async () => {
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id

  // Phase 8A — DB-backed login buckets persist across runs; heal them so
  // this run starts from clean limiter state (fixture account only).
  await resetLoginBuckets([GV_PRINCIPAL])

  // Real login (the honest-zero journey starts at the front door).
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: GV_PRINCIPAL, password: PW }),
  })
  if (res.status === 429) {
    // Rate-limited from repeated suite runs — fall back to a direct
    // session row (auth fixture, NOT an authorization bypass).
    const u = await db.user.findUnique({ where: { email: GV_PRINCIPAL } })
    if (!u) throw new Error(`no fixture user ${GV_PRINCIPAL}`)
    const raw = randomBytes(32).toString('hex')
    await db.session.create({
      data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
    })
    token = raw
  } else {
    const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
    if (!body.ok || !body.data?.sessionToken) throw new Error(`login failed for ${GV_PRINCIPAL}`)
    token = body.data.sessionToken
  }
}, 60_000)

afterAll(async () => {
  // ── leave the clean school exactly at rest: zero business rows ──────
  if (created) {
    await db.student.deleteMany({ where: { id: created.studentId } }).catch(() => {})
    await db.user.deleteMany({ where: { id: created.studentUserId } }).catch(() => {})
    await db.subject.deleteMany({ where: { id: created.subjectId } }).catch(() => {})
    await db.class.deleteMany({ where: { id: created.classId } }).catch(() => {})
    await db.teacher.deleteMany({ where: { id: created.teacherId } }).catch(() => {})
    await db.user.deleteMany({ where: { id: created.teacherUserId } }).catch(() => {})
  }
  // Account-provisioning audit rows naming the throwaway accounts.
  await db.activityLog
    .deleteMany({
      where: {
        schoolId: gvId,
        createdAt: { gte: testStart },
        OR: [{ detail: { contains: teacherEmail } }, { detail: { contains: studentEmail } }],
      },
    })
    .catch(() => {})
  // The session row this suite minted.
  if (token) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).catch(() => {})
  await db.$disconnect()
})

// ── helpers ────────────────────────────────────────────────────────────────

function as(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
}

interface DashboardBody {
  scope: string
  stats: Record<string, number>
  attendance: { present: number; absent: number; late: number }
  trend: unknown[]
  recentActivity: Array<{ schoolId?: string }>
  upcomingExams: unknown[]
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Honest zeros (the school carries NO business data)
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · clean-tenant reads are honest zeros (no fabricated numbers)', () => {
  test('GET /api/dashboard → every stat is 0, trend + upcoming exams empty', async () => {
    const res = await as('/api/dashboard')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<DashboardBody>
    expect(body.ok).toBe(true)
    expect(body.data!.scope).toBe('SCHOOL')
    const s = body.data!.stats
    expect(s.students).toBe(0)
    expect(s.teachers).toBe(0)
    expect(s.classes).toBe(0)
    expect(s.subjects).toBe(0)
    expect(s.exams).toBe(0)
    expect(s.vehicles).toBe(0)
    expect(s.routes).toBe(0)
    expect(s.books).toBe(0)
    expect(s.feesTotal).toBe(0)
    expect(s.feesPaid).toBe(0)
    expect(s.overdue).toBe(0)
    expect(s.attendanceRate).toBe(0)
    expect(body.data!.attendance).toEqual({ present: 0, absent: 0, late: 0 })
    expect(body.data!.trend).toEqual([])
    expect(body.data!.upcomingExams).toEqual([])
    // No demo-tenant bleed in the activity feed either.
    for (const row of body.data!.recentActivity ?? []) {
      expect(row.schoolId).toBe(gvId)
    }
  }, T)

  test('GET /api/students → empty roster', async () => {
    const res = await as('/api/students')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<unknown[]>
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  }, T)

  test('GET /api/exams → empty exam list', async () => {
    const res = await as('/api/exams')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<{ exams: unknown[]; classes: unknown[] }>
    expect(body.ok).toBe(true)
    expect(body.data!.exams).toEqual([])
  }, T)

  test('GET /api/fees → empty fee ledger', async () => {
    const res = await as('/api/fees')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<unknown[]>
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Building the school normally (the first rows — all school-scoped)
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · the Principal starts building the school normally (§48)', () => {
  test('POST /api/teachers → first teacher lands school-scoped to green-valley', async () => {
    const res = await as('/api/teachers', {
      method: 'POST',
      body: JSON.stringify({ name: `First Teacher ${MARKER}`, email: teacherEmail, department: 'Science', password: 'FirstTeacher2026' }),
    })
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as Envelope<{ id: string; schoolId: string; userId: string; user: { email: string } }>
    expect(body.ok).toBe(true)
    expect(body.data!.schoolId).toBe(gvId)
    expect(body.data!.user.email).toBe(teacherEmail)

    const row = await db.teacher.findUnique({ where: { id: body.data!.id } })
    expect(row?.schoolId).toBe(gvId)
    const user = await db.user.findUnique({ where: { id: row!.userId } })
    expect(user?.schoolId).toBe(gvId)
    expect(user?.role).toBe('TEACHER')
    expect(user?.status).toBe('ACTIVE')
    created = {
      teacherId: body.data!.id,
      teacherUserId: row!.userId,
      classId: '',
      subjectId: '',
      studentId: '',
      studentUserId: '',
    }
  }, T)

  test('POST /api/classes → first class, class-teacher = the new teacher', async () => {
    expect(created).not.toBeNull()
    const res = await as('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ name: className, section: 'A', gradeLevel: '1', classTeacherId: created!.teacherUserId }),
    })
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as Envelope<{ id: string; schoolId: string; classTeacherId: string | null }>
    expect(body.ok).toBe(true)
    expect(body.data!.schoolId).toBe(gvId)
    expect(body.data!.classTeacherId).toBe(created!.teacherUserId)

    const row = await db.class.findUnique({ where: { id: body.data!.id } })
    expect(row?.schoolId).toBe(gvId)
    created!.classId = body.data!.id
  }, T)

  test('POST /api/subjects → first subject for the new class', async () => {
    expect(created).not.toBeNull()
    const res = await as('/api/subjects', {
      method: 'POST',
      body: JSON.stringify({ name: `Probe Mathematics ${MARKER}`, code: `PRB${MARKER.toUpperCase()}`, classId: created!.classId, fullMarks: 100, passMarks: 33 }),
    })
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as Envelope<{ id: string; schoolId: string; classId: string | null }>
    expect(body.ok).toBe(true)
    expect(body.data!.schoolId).toBe(gvId)

    const row = await db.subject.findUnique({ where: { id: body.data!.id } })
    expect(row?.schoolId).toBe(gvId)
    created!.subjectId = body.data!.id
  }, T)

  test('POST /api/students → first student enrolled in the new class', async () => {
    expect(created).not.toBeNull()
    const res = await as('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: `First Student ${MARKER}`,
        email: studentEmail,
        password: 'FirstStudent2026',
        classId: created!.classId,
        admissionNo,
        rollNo: `R-${MARKER}`,
        guardianName: 'Probe Guardian',
      }),
    })
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as Envelope<{ id: string; schoolId: string; admissionNo: string | null; classId: string | null }>
    expect(body.ok).toBe(true)
    expect(body.data!.schoolId).toBe(gvId)
    expect(body.data!.admissionNo).toBe(admissionNo)

    const row = await db.student.findUnique({ where: { id: body.data!.id } })
    expect(row?.schoolId).toBe(gvId)
    expect(row?.classId).toBe(created!.classId)
    const user = await db.user.findUnique({ where: { id: row!.userId } })
    expect(user?.schoolId).toBe(gvId)
    expect(user?.role).toBe('STUDENT')
    created!.studentId = row!.id
    created!.studentUserId = row!.userId
  }, T)

  test('the school now reads its REAL numbers (roster 1, dashboard counts moved)', async () => {
    // Roster surface
    const students = await as('/api/students')
    expect(students.status).toBe(200)
    const rosterBody = (await students.json()) as Envelope<Array<{ schoolId: string }>>
    expect(rosterBody.data!.length).toBe(1)
    expect(rosterBody.data![0].schoolId).toBe(gvId)

    // Dashboard counts moved from the honest zero to the real numbers.
    const dash = await as('/api/dashboard')
    expect(dash.status).toBe(200)
    const dashBody = (await dash.json()) as Envelope<DashboardBody>
    const s = dashBody.data!.stats
    expect(s.students).toBe(1)
    expect(s.teachers).toBe(1)
    expect(s.classes).toBe(1)
    expect(s.subjects).toBe(1)
    expect(s.exams).toBe(0) // still zero — nothing fabricated
    expect(s.feesTotal).toBe(0)
    expect(s.feesPaid).toBe(0)
  }, T)
})
