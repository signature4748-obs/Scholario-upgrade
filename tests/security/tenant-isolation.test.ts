import { db } from '../helpers/db'
/**
 * PHASE 2 — Cross-tenant isolation test suite.
 *
 * THE INVARIANT UNDER TEST:
 *   NO USER FROM SCHOOL A MAY READ, WRITE, MODIFY, DELETE, SEARCH, EXPORT,
 *   DOWNLOAD OR INFER SCHOOL B DATA (and vice versa).
 *
 * This is a LIVE HTTP integration suite: it runs against the dev server
 * (default http://localhost:3000) with REAL sessions, REAL fixture tenants
 * and REAL database rows. Fixtures are created by
 * `prisma/seed-tenant-isolation.ts` (idempotent). Phase 8A two-tenant
 * corpus layout:
 *
 *   School A — Sunrise Academy (slug sunrise-academy) — the DEMO tenant:
 *              full canonical corpus + the controlled test identities
 *              (tenant.*@sunrise.test) + the cross-tenant probe rows
 *              (probe student 'Aarav Mehta', Grade 5 - A, SR-MATH …).
 *   School B — Green Valley Public School (slug green-valley) — the CLEAN
 *              tenant: bootstrap config + principal/teacher/student/parent
 *              .b@greenvalley.test fixture accounts and ZERO business
 *              data — every School B surface shows its honest empty state.
 *
 * Roles exercised: SUPER_ADMIN, PRINCIPAL, TEACHER, STUDENT, PARENT.
 * Actions attempted across the tenant boundary: read, create, update,
 * delete, download, search, export — plus indirect leakage probes
 * (search, counts, dashboard metrics, notifications, file URLs, error
 * messages, ids). Every unauthorized attempt must FAIL SAFELY (401/403/404
 * with a sanitized envelope that does not confirm the foreign resource's
 * existence); a clean-tenant subject that no longer exists fails closed
 * ("does not exist" is the honest answer — never a leak).
 *
 * Authentication: real POST /api/auth/login for the first sessions (the
 * login mechanics themselves are covered by the Phase-1 suite); when the
 * dev-server login rate limiter has already consumed the IP budget
 * (repeated runs within 15 min), the suite falls back to inserting a
 * session row directly — a standard integration-test auth fixture that
 * bypasses ONLY the login limiter, never any authorization gate.
 */
import { describe, test, expect, beforeAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

// ─────────────────────────────────────────────────────────────────────────
// Fixture resolution (DB-direct: the tests KNOW the victim ids exist)
// ─────────────────────────────────────────────────────────────────────────

interface Fixtures {
  schoolA: { id: string }
  schoolB: { id: string }
  users: {
    principalA: { id: string; email: string }
    teacherA: { id: string; email: string }
    studentA: { id: string; email: string }
    parentA: { id: string; email: string }
    superadmin: { id: string; email: string }
    principalB: { id: string; email: string }
    teacherB: { id: string; email: string }
    studentB: { id: string; email: string }
    parentB: { id: string; email: string }
  }
  rows: {
    studentA: { id: string; userId: string }
    classA: { id: string; name: string }
    subjectA: { id: string }
    feeA: { id: string }
    examA: { id: string }
    homeworkA: { id: string }
    homeworkB: { id: string }
    materialA: { id: string }
    eventA: { id: string }
    questionA: { id: string }
    roomA: { id: string }
    gradeScaleA: { id: string; maxPct: number }
    examTypeA: { id: string }
    txnA: { id: string }
    libBookA: { id: string }
    notifTitlesA: string[]
    studentNameA: string
  }
}

const PW = 'ScholarioTest2026'
let fx: Fixtures
const tokens: Record<string, string> = {}

beforeAll(async () => {
  const schoolA = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
  const schoolB = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!schoolA || !schoolB) throw new Error('Fixtures missing — run: bun prisma/seed-tenant-isolation.ts')

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`Fixture user missing: ${email} — run: bun prisma/seed-tenant-isolation.ts`)
    return u
  }

  const [pA, tA, sA, paA, sa, pB, tB, sB, paB] = await Promise.all([
    byEmail('tenant.principal.a@sunrise.test'),
    byEmail('tenant.teacher.a@sunrise.test'),
    byEmail('tenant.student.a@sunrise.test'),
    byEmail('tenant.parent.a@sunrise.test'),
    byEmail('tenant.superadmin@sunrise.test'),
    byEmail('principal.b@greenvalley.test'),
    byEmail('teacher.b@greenvalley.test'),
    byEmail('student.b@greenvalley.test'),
    byEmail('parent.b@greenvalley.test'),
  ])

  // Phase 8A: the School B (clean tenant) carries ZERO business rows —
  // student/class/fee/exam/material/notification lookups there return null
  // by design. The cross-tenant probe rows (incl. BOTH homework probes)
  // live INSIDE School A (Sunrise) now.
  const studentA = await db.student.findFirst({ where: { schoolId: schoolA.id, userId: sA.id } })
  const classA = await db.class.findFirst({ where: { schoolId: schoolA.id }, orderBy: { name: 'asc' } })
  const subjectA = await db.subject.findFirst({ where: { schoolId: schoolA.id } })
  const feeA = await db.fee.findFirst({ where: { schoolId: schoolA.id } })
  const examA = await db.exam.findFirst({ where: { schoolId: schoolA.id } })
  const hwA = await db.homework.findFirst({ where: { schoolId: schoolA.id, title: { contains: 'Tenant Test Probe' } } })
  const hwB = await db.homework.findFirst({ where: { schoolId: schoolA.id, title: { contains: 'Tenant Test Probe Homework B' } } })
  const matA = await db.studyMaterial.findFirst({ where: { schoolId: schoolA.id } })
  const eventA = await db.schoolEvent.findFirst({ where: { schoolId: schoolA.id } })
  const qA = await db.questionBank.findFirst({ where: { schoolId: schoolA.id } })
  const roomA = await db.room.findFirst({ where: { schoolId: schoolA.id } })
  const gsA = await db.gradeScale.findFirst({ where: { schoolId: schoolA.id } })
  const etA = await db.examTypeConfig.findFirst({ where: { schoolId: schoolA.id } })
  const txnA = await db.feeTransaction.findFirst({ where: { schoolId: schoolA.id } })
  const bookA = await db.libraryBook.findFirst({ where: { schoolId: schoolA.id } })
  const notifTitlesA = (await db.notification.findMany({ where: { schoolId: schoolA.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { title: true } })).map((n) => n.title)
  const firstStudentA = await db.student.findFirst({ where: { schoolId: schoolA.id }, orderBy: { admissionNo: 'asc' }, include: { user: { select: { name: true } } } })

  if (!studentA || !classA || !hwA || !hwB) {
    throw new Error('Probe rows missing — run: bun prisma/seed-tenant-isolation.ts')
  }

  fx = {
    schoolA: { id: schoolA.id },
    schoolB: { id: schoolB.id },
    users: {
      principalA: { id: pA.id, email: pA.email },
      teacherA: { id: tA.id, email: tA.email },
      studentA: { id: sA.id, email: sA.email },
      parentA: { id: paA.id, email: paA.email },
      superadmin: { id: sa.id, email: sa.email },
      principalB: { id: pB.id, email: pB.email },
      teacherB: { id: tB.id, email: tB.email },
      studentB: { id: sB.id, email: sB.email },
      parentB: { id: paB.id, email: paB.email },
    },
    rows: {
      studentA: { id: studentA.id, userId: studentA.userId },
      classA: { id: classA.id, name: classA.name },
      subjectA: { id: subjectA?.id ?? '' },
      feeA: { id: feeA?.id ?? '' },
      examA: { id: examA?.id ?? '' },
      homeworkA: { id: hwA.id },
      homeworkB: { id: hwB.id },
      materialA: { id: matA?.id ?? '' },
      eventA: { id: eventA?.id ?? '' },
      questionA: { id: qA?.id ?? '' },
      roomA: { id: roomA?.id ?? '' },
      gradeScaleA: { id: gsA?.id ?? '', maxPct: gsA?.maxPct ?? 0 },
      examTypeA: { id: etA?.id ?? '' },
      txnA: { id: txnA?.id ?? '' },
      libBookA: { id: bookA?.id ?? '' },
      notifTitlesA,
      studentNameA: firstStudentA?.user?.name ?? 'Aarav Sharma',
    },
  }
}, 60000)

// ─────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────

async function login(email: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  })
  if (res.status === 429) {
    // Rate-limited from repeated suite runs — fall back to a direct
    // session row (auth fixture, NOT an authorization bypass).
    console.warn(`[tenant-isolation] login rate-limited for ${email}; using direct session fixture`)
    const token = await directSession(email)
    tokens[email] = token
    return token
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string }; error?: string }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`)
  }
  tokens[email] = body.data.sessionToken
  return body.data.sessionToken
}

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  // PHASE 8A — the row stores the hash; the RAW token keeps riding the
  // Authorization header (identical to a server-minted session).
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(email: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await login(email)
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/**
 * A SAFE cross-tenant failure: 4xx, JSON envelope, ok:false, and the error
 * message must not confirm the foreign resource (no victim ids, no victim
 * school name, no internals).
 */
async function expectSafeFailure(res: Response, ctx: { victimIds: string[]; victimStrings: string[] }) {
  const text = await res.clone().text()
  expect([401, 403, 404, 422]).toContain(res.status)
  let body: { ok?: boolean; error?: string; code?: string } | null = null
  try { body = JSON.parse(text) } catch { /* CSV/plain */ }
  if (body && typeof body === 'object') {
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  }
  // No existence oracle, no internal leakage.
  for (const id of ctx.victimIds) if (id) expect(text).not.toContain(id)
  for (const s of ctx.victimStrings) if (s) expect(text.toLowerCase()).not.toContain(s.toLowerCase())
  expect(text.toLowerCase()).not.toContain('prisma')
  expect(text.toLowerCase()).not.toContain('sqlite')
  expect(text).not.toContain('/home/')
  return body
}

const T = 45000 // generous: first-hit dev compilation

// ─────────────────────────────────────────────────────────────────────────
// 1. AUTHENTICATION boundary
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · tenant isolation — authentication boundary', () => {
  test('anonymous cannot reach protected APIs', async () => {
    const res = await fetch(`${BASE}/api/students`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  }, T)

  test('anonymous cannot reach the dashboard', async () => {
    const res = await fetch(`${BASE}/api/dashboard`)
    expect(res.status).toBe(401)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. CROSS-TENANT READS (IDOR) — School B identities → School A resources
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · cross-tenant READ attempts must fail safely', () => {
  const victim = () => ({
    victimIds: [fx.rows.studentA.id, fx.schoolA.id],
    victimStrings: [fx.rows.studentNameA, 'Sunrise'],
  })

  test('principal B → GET /api/students/[A-student] → 404, no oracle', async () => {
    const res = await as(fx.users.principalB.email, `/api/students/${fx.rows.studentA.id}`)
    await expectSafeFailure(res, victim())
  }, T)

  test('principal B → GET /api/exams/[A-exam] → 404', async () => {
    const res = await as(fx.users.principalB.email, `/api/exams/${fx.rows.examA.id}`)
    await expectSafeFailure(res, victim())
  }, T)

  test('principal B → GET /api/exams/[A-exam]/marks → fail (foreign exam)', async () => {
    const res = await as(fx.users.principalB.email, `/api/exams/${fx.rows.examA.id}/marks?classId=${fx.rows.classA.id}`)
    await expectSafeFailure(res, victim())
  }, T)

  test('principal B → GET /api/exams/[A-exam]/audit → fail', async () => {
    const res = await as(fx.users.principalB.email, `/api/exams/${fx.rows.examA.id}/audit`)
    await expectSafeFailure(res, victim())
  }, T)

  test('principal B → GET /api/homework/[A-homework] → 404', async () => {
    const res = await as(fx.users.principalB.email, `/api/homework/${fx.rows.homeworkA.id}`)
    await expectSafeFailure(res, victim())
  }, T)

  test('student B → GET /api/study-materials/[A-material]/download → 404', async () => {
    const res = await as(fx.users.studentB.email, `/api/study-materials/${fx.rows.materialA.id}/download`)
    await expectSafeFailure(res, victim())
  }, T)

  test('principal B → GET /api/fees/receipts/[A-txn] → 404', async () => {
    const res = await as(fx.users.principalB.email, `/api/fees/receipts/${fx.rows.txnA.id}`)
    await expectSafeFailure(res, victim())
  }, T)

  test('teacher B → GET /api/teacher/students/[A-student] → 404 (scope+tenant)', async () => {
    await withBsideTeacherRecords(async () => {
      const res = await as(fx.users.teacherB.email, `/api/teacher/students/${fx.rows.studentA.id}`)
      await expectSafeFailure(res, victim())
    })
  }, T)

  test('principal B → GET /api/rooms lists ONLY School B rooms', async () => {
    const res = await as(fx.users.principalB.email, '/api/rooms')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(fx.rows.roomA.id)
  }, T)

  test('principal B → GET /api/schools/[A-school] → fail-safe, no other-school data', async () => {
    const res = await as(fx.users.principalB.email, `/api/schools/${fx.schoolA.id}`)
    await expectSafeFailure(res, { victimIds: [fx.schoolA.id], victimStrings: ['Sunrise'] })
  }, T)

  test('student B → GET /api/student/timetable has no School A cells', async () => {
    const res = await as(fx.users.studentB.email, '/api/student/timetable')
    // Fail-closed for the enrollment-less clean-tenant student (sanitized
    // 400 NO_STUDENT_RECORD) OR 200 with own-school payload — the school
    // scope is the invariant either way
    const text = await res.text()
    expect(text).not.toContain(fx.schoolA.id)
    expect(text).not.toContain(fx.rows.classA.id)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. CROSS-TENANT WRITES / DELETES — must fail AND leave victim data intact
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · cross-tenant WRITE/DELETE attempts must fail safely', () => {
  const victim = () => ({
    victimIds: [fx.rows.studentA.id, fx.rows.classA.id, fx.schoolA.id],
    victimStrings: [fx.rows.studentNameA, 'Sunrise'],
  })

  test('principal B → DELETE /api/events?id=[A-event] → 404, event survives', async () => {
    const res = await as(fx.users.principalB.email, `/api/events?id=${fx.rows.eventA.id}`, { method: 'DELETE' })
    await expectSafeFailure(res, victim())
    const still = await db.schoolEvent.findUnique({ where: { id: fx.rows.eventA.id } })
    expect(still).not.toBeNull()
  }, T)

  test('principal B → DELETE /api/questions?id=[A-question] → 404, row survives', async () => {
    const res = await as(fx.users.principalB.email, `/api/questions?id=${fx.rows.questionA.id}`, { method: 'DELETE' })
    await expectSafeFailure(res, victim())
    const still = await db.questionBank.findUnique({ where: { id: fx.rows.questionA.id } })
    expect(still).not.toBeNull()
  }, T)

  test('principal B → PATCH /api/exams/settings/grades/[A-grade] → 404, scale intact', async () => {
    const res = await as(fx.users.principalB.email, `/api/exams/settings/grades/${fx.rows.gradeScaleA.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ minPct: 1, maxPct: 99, grade: 'ZZ' }),
    })
    await expectSafeFailure(res, victim())
    const still = await db.gradeScale.findUnique({ where: { id: fx.rows.gradeScaleA.id } })
    expect(still).not.toBeNull()
    expect(still?.grade).not.toBe('ZZ')
  }, T)

  test('principal B → DELETE /api/exams/settings/types/[A-type] → 404, row survives', async () => {
    const res = await as(fx.users.principalB.email, `/api/exams/settings/types/${fx.rows.examTypeA.id}`, { method: 'DELETE' })
    await expectSafeFailure(res, victim())
    const still = await db.examTypeConfig.findUnique({ where: { id: fx.rows.examTypeA.id } })
    expect(still).not.toBeNull()
  }, T)

  test('principal B → POST /api/attendance with A class+students → 404, no attendance written', async () => {
    const before = await db.attendance.count({ where: { studentId: fx.rows.studentA.id } })
    const res = await as(fx.users.principalB.email, '/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        classId: fx.rows.classA.id,
        date: new Date().toISOString().slice(0, 10),
        entries: [{ studentId: fx.rows.studentA.id, status: 'PRESENT' }],
      }),
    })
    await expectSafeFailure(res, victim())
    const after = await db.attendance.count({ where: { studentId: fx.rows.studentA.id } })
    expect(after).toBe(before)
  }, T)

  test('principal B → POST /api/students with A classId → 404, no account created', async () => {
    const email = `probe.${Date.now()}@greenvalley.test`
    const res = await as(fx.users.principalB.email, '/api/students', {
      method: 'POST',
      body: JSON.stringify({ name: 'Cross Tenant Probe', email, classId: fx.rows.classA.id, password: 'Probe1234' }),
    })
    await expectSafeFailure(res, victim())
    const u = await db.user.findUnique({ where: { email } })
    expect(u).toBeNull()
  }, T)

  test('principal B → POST /api/messages to A-student user → rejected, no message row', async () => {
    const before = await db.message.count({ where: { recipientId: fx.rows.studentA.userId } })
    const res = await as(fx.users.principalB.email, '/api/messages', {
      method: 'POST',
      body: JSON.stringify({ recipientId: fx.rows.studentA.userId, subject: 'probe', body: 'cross-tenant probe', category: 'general' }),
    })
    await expectSafeFailure(res, victim())
    const after = await db.message.count({ where: { recipientId: fx.rows.studentA.userId } })
    expect(after).toBe(before)
  }, T)

  test('principal B → POST marks single on A exam/student → 404, no ExamMark', async () => {
    const before = await db.examMark.count({ where: { studentId: fx.rows.studentA.id } })
    const res = await as(fx.users.principalB.email, `/api/exams/${fx.rows.examA.id}/marks/single`, {
      method: 'POST',
      body: JSON.stringify({
        classId: fx.rows.classA.id,
        subjectId: fx.rows.subjectA.id,
        studentId: fx.rows.studentA.id,
        marksObtained: 50,
        maxMarks: 100,
      }),
    })
    await expectSafeFailure(res, victim())
    const after = await db.examMark.count({ where: { studentId: fx.rows.studentA.id } })
    expect(after).toBe(before)
  }, T)

  test('principal B → POST /api/fees for A student (spoofed schoolId) → 404, no fee row', async () => {
    const before = await db.fee.count({ where: { studentId: fx.rows.studentA.id } })
    const res = await as(fx.users.principalB.email, '/api/fees', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', studentId: fx.rows.studentA.id, title: `probe ${Date.now()}`, amount: 100, type: 'Tuition', schoolId: fx.schoolA.id }),
    })
    await expectSafeFailure(res, victim())
    const after = await db.fee.count({ where: { studentId: fx.rows.studentA.id } })
    expect(after).toBe(before)
  }, T)

  test('principal B → POST /api/library issue A book to A student → 404, no issue', async () => {
    const before = await db.bookIssue.count({ where: { studentId: fx.rows.studentA.id } })
    const res = await as(fx.users.principalB.email, '/api/library', {
      method: 'POST',
      body: JSON.stringify({ action: 'issue', bookId: fx.rows.libBookA.id, studentId: fx.rows.studentA.id }),
    })
    await expectSafeFailure(res, victim())
    const after = await db.bookIssue.count({ where: { studentId: fx.rows.studentA.id } })
    expect(after).toBe(before)
  }, T)

  test('teacher B → POST message-parent to A student → out of scope, no thread', async () => {
    const before = await db.parentMessage.count()
    const res = await as(fx.users.teacherB.email, '/api/teacher/communication/message-parent', {
      method: 'POST',
      body: JSON.stringify({ studentId: fx.rows.studentA.id, message: 'cross-tenant probe', category: 'general' }),
    })
    expect([400, 403, 404]).toContain(res.status)
    const after = await db.parentMessage.count()
    expect(after).toBe(before)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. INDIRECT LEAKAGE — search, counts, exports, notifications, metrics
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · indirect leakage probes', () => {
  test('principal B search for A student name → zero results', async () => {
    const res = await as(fx.users.principalB.email, `/api/search?q=${encodeURIComponent(fx.rows.studentNameA)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { results: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.data.results.length).toBe(0)
  }, T)

  test('student B search for A material title → zero results', async () => {
    await withBsideTeacherRecords(async () => {
      const res = await as(fx.users.studentB.email, `/api/search?q=${encodeURIComponent('Addition & Subtraction')}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: { results: unknown[] } }
      expect(body.ok).toBe(true)
      expect(body.data.results.length).toBe(0)
    })
  }, T)

  test('principal B → GET /api/contacts has no School A users', async () => {
    const res = await as(fx.users.principalB.email, '/api/contacts')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(fx.users.principalA.id)
    expect(text).not.toContain(fx.users.studentA.id)
    expect(text).not.toContain('Sunrise')
  }, T)

  test('principal B → CSV /api/export?type=students contains ONLY School B students (honest-empty)', async () => {
    // Phase 8A re-target: the clean tenant has ZERO students — its export
    // is the header row alone (every School B student row, all zero of
    // them, and NEVER a School A row). The old `toContain('Ira Rao')`
    // positive moved with the probe student ('Aarav Mehta') INTO Sunrise
    // and is asserted as invisible here instead.
    const res = await as(fx.users.principalB.email, '/api/export?type=students')
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv.trim().split('\n').length).toBe(1) // header only — zero data rows
    expect(csv).not.toContain(fx.rows.studentNameA) // School A canonical student
    expect(csv).not.toContain('Tenant Test Student A') // School A test student
    expect(csv).not.toContain('Aarav Mehta') // the migrated probe student stays Sunrise-only
  }, T)

  test('principal B → CSV /api/payments-export has no School A names', async () => {
    const res = await as(fx.users.principalB.email, '/api/payments-export')
    expect([200, 403]).toContain(res.status)
    if (res.status === 200) {
      const csv = await res.text()
      expect(csv).not.toContain(fx.rows.studentNameA)
      expect(csv).not.toContain('Tenant Test Student A')
    }
  }, T)

  test('principal B → GET /api/dashboard counts derive from School B only', async () => {
    const res = await as(fx.users.principalB.email, '/api/dashboard')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { scope: string; stats: { students: number; teachers: number } } }
    expect(body.data.scope).toBe('SCHOOL')
    expect(body.data.stats.students).toBe(0) // honest zero — the clean tenant's truth
    expect(body.data.stats.teachers).toBe(0)
    const text = JSON.stringify(body)
    expect(text).not.toContain(fx.rows.studentNameA)
    expect(text).not.toContain('Sunrise')
  }, T)

  test('student B → /api/notifications-feed carries no School A notices', async () => {
    const res = await as(fx.users.studentB.email, '/api/notifications-feed')
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const title of fx.rows.notifTitlesA) expect(text).not.toContain(title)
  }, T)

  test('principal B → GET /api/announcements shows only School B broadcasts (honest-empty)', async () => {
    // Phase 8A re-target: Green Valley has zero broadcasts — its own list
    // is exactly empty AND no Sunrise broadcast title leaks through.
    const res = await as(fx.users.principalB.email, '/api/announcements')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { announcements: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.data.announcements).toEqual([]) // zero rows IS School B's broadcast list
    const text = JSON.stringify(body)
    for (const title of fx.rows.notifTitlesA) expect(text).not.toContain(title)
  }, T)

  test('principal B → GET /api/exams lists only School B exams (honest-empty)', async () => {
    // Phase 8A re-target: Green Valley has zero exams — the list is exactly
    // empty AND the Sunrise exam id never appears.
    const res = await as(fx.users.principalB.email, '/api/exams')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { exams: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.data.exams).toEqual([]) // zero rows IS School B's exam list
    const text = JSON.stringify(body)
    expect(text).not.toContain(fx.rows.examA.id)
  }, T)

  test('spoofed body schoolId is ignored — event lands in the CALLER school', async () => {
    const title = `spoof-probe-${Date.now()}`
    const res = await as(fx.users.principalB.email, '/api/events', {
      method: 'POST',
      body: JSON.stringify({ title, type: 'EVENT', startDate: new Date().toISOString(), audience: 'ALL', schoolId: fx.schoolA.id }),
    })
    expect(res.status).toBe(200)
    const row = await db.schoolEvent.findFirst({ where: { title } })
    expect(row).not.toBeNull()
    expect(row?.schoolId).toBe(fx.schoolB.id) // session tenant, never the spoofed one
    await db.schoolEvent.delete({ where: { id: row!.id } }) // cleanup probe
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. SUPER_ADMIN boundary (platform role ≠ tenant access)
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2/6 · platform admin boundary', () => {
  // PHASE 6 — the legacy SUPER_ADMIN school identity is dead: school login
  // rejects the role outright (the platform identity migrated to the
  // separate /platform boundary — see platform-isolation.test.ts).
  test('legacy SUPER_ADMIN email is REFUSED at SCHOOL login (401, no session)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fx.users.superadmin.email, password: PW }),
    })
    const body = (await res.json()) as { ok: boolean; code?: string }
    expect(res.status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('school session CANNOT access the platform control plane (401)', async () => {
    const res = await as(fx.users.principalA.email, '/api/platform/schools')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('school session CANNOT read the platform audit trail (401)', async () => {
    const res = await as(fx.users.principalB.email, '/api/platform/audit')
    expect(res.status).toBe(401)
  }, T)

  test('school session CANNOT mint a platform session via step-up (401)', async () => {
    const res = await as(fx.users.teacherA.email, '/api/platform/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
    })
    expect(res.status).toBe(401)
  }, T)

  test('non-admin cannot read another school via /api/schools/[id]', async () => {
    const res = await as(fx.users.teacherB.email, `/api/schools/${fx.schoolA.id}`)
    await expectSafeFailure(res, { victimIds: [fx.schoolA.id], victimStrings: ['Sunrise'] })
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 6. ROLE boundaries (students/parents must not reach staff surfaces)
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · role boundaries (frontend hiding is not authorization)', () => {
  test('student B → /api/students (staff roster) → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/students')
    expect(res.status).toBe(403)
  }, T)

  test('student B → /api/teacher/students → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/teacher/students')
    expect(res.status).toBe(403)
  }, T)

  test('student B → /api/homework (staff surface) → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/homework')
    expect(res.status).toBe(403)
  }, T)

  test('student B → homework oversight (marks/feedback aggregates) → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/homework/oversight/grading-audit')
    expect(res.status).toBe(403)
  }, T)

  test('parent B → /api/students → 403', async () => {
    const res = await as(fx.users.parentB.email, '/api/students')
    expect(res.status).toBe(403)
  }, T)

  test('student B → school fee ledger /api/fees → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/fees')
    expect(res.status).toBe(403)
  }, T)

  test('student B → payments ledger export → 403', async () => {
    const res = await as(fx.users.studentB.email, '/api/payments-export')
    expect(res.status).toBe(403)
  }, T)

  test('student B (no enrollment record — clean tenant) self-service fails CLOSED; the enrolled School A student stays healthy and school-scoped', async () => {
    // Phase 8A re-target: Green Valley's student.b is an ACTIVE STUDENT user
    // with NO Student row (honest-zero corpus) — the self-service surface
    // must fail closed with a sanitized envelope and leak nothing. The
    // healthy 200-with-own-data case (the old 'Ira Rao' assertion's
    // invariant) is re-proven on the SAME surface via the ENROLLED School A
    // fixture student.
    const bRes = await as(fx.users.studentB.email, '/api/student/dashboard')
    expect([400, 404]).toContain(bRes.status) // fail-closed (NO_STUDENT_RECORD), never a leak
    const bText = await bRes.text()
    expect(bText).not.toContain(fx.rows.studentNameA)
    expect(bText).not.toContain('Sunrise')
    expect(bText).not.toContain(fx.schoolA.id)

    const aRes = await as(fx.users.studentA.email, '/api/student/dashboard')
    expect(aRes.status).toBe(200)
    const aText = await aRes.text()
    expect(aText).toContain('Tenant Test Student A') // own-tenant identity
    expect(aText).not.toContain('Green Valley')
    expect(aText).not.toContain(fx.schoolB.id)
  }, T)

  test('student A roster hides classmates\u2019 fees/marks/growth (projection guard)', async () => {
    const res = await as(fx.users.studentA.email, '/api/students/roster')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data: { students: { id: string; latestExam: unknown; fees: { totalBilled: number }; growthPoints: number | null }[] }
    }
    expect(body.ok).toBe(true)
    const self = body.data.students.find((s) => s.id === fx.rows.studentA.id)
    expect(self).toBeDefined()
    for (const s of body.data.students) {
      if (s.id === fx.rows.studentA.id) continue
      // Classmates: public fields only.
      expect(s.latestExam).toBeNull()
      expect(s.fees.totalBilled).toBe(0)
      expect(s.growthPoints).toBeNull()
    }
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 7. POSITIVE CONTROLS (the 404s above are tenant failures, not breakage)
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · positive controls — same-tenant access still works', () => {
  test('principal A reads their own student → 200', async () => {
    const res = await as(fx.users.principalA.email, `/api/students/${fx.rows.studentA.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  }, T)

  test('principal B reads their own student roster → 200 (honest-empty — the clean tenant truth)', async () => {
    // Phase 8A re-target: School B has no student rows, so the own-tenant
    // read positive is the ROSTER surface: healthy 200 + exactly zero
    // School B students (never a School A row).
    const res = await as(fx.users.principalB.email, '/api/students')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
    expect(JSON.stringify(body)).not.toContain(fx.rows.studentNameA)
  }, T)

  test('principal A reads their own homework probe → 200', async () => {
    const res = await as(fx.users.principalA.email, `/api/homework/${fx.rows.homeworkA.id}`)
    expect(res.status).toBe(200)
  }, T)

  test('principal B → /api/homework → 200 (honest-empty); the migrated B-labeled probe is Sunrise-owned and readable by principal A → 200', async () => {
    // Phase 8A re-target: the B-labeled homework probe moved INTO Sunrise
    // (Green Valley has none). B's list surface stays healthy + honestly
    // empty; the same probe row is positively readable by its NEW owner.
    const bList = await as(fx.users.principalB.email, '/api/homework')
    expect(bList.status).toBe(200)
    const bBody = (await bList.json()) as { ok: boolean; data: { homework: unknown[] } }
    expect(bBody.ok).toBe(true)
    expect(bBody.data.homework).toEqual([])
    expect(JSON.stringify(bBody)).not.toContain(fx.rows.homeworkB.id)

    const aRead = await as(fx.users.principalA.email, `/api/homework/${fx.rows.homeworkB.id}`)
    expect(aRead.status).toBe(200)
  }, T)

  test('teacher B lists their own school students → 200 (honest-empty scope); teacher A sees Sunrise students on the same surface', async () => {
    // Phase 8A re-target: the old positive (Bluebell's 'Ira Rao' visible to
    // teacher B) has no equivalent data in the clean tenant — teacher B's
    // scope is honestly EMPTY, and the data-visible positive is proven on
    // the same surface by teacher A (who sees the Sunrise probe student).
    const res = await as(fx.users.teacherB.email, '/api/teacher/students')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(fx.rows.studentNameA)
    expect(text).not.toContain('Aarav Mehta')

    const aRes = await as(fx.users.teacherA.email, '/api/teacher/students')
    expect(aRes.status).toBe(200)
    const aText = await aRes.text()
    expect(aText).toContain('Aarav Mehta') // own-tenant probe student — visible
  }, T)

  test('principal A → /api/schools/[A] → 200 (own school)', async () => {
    const res = await as(fx.users.principalA.email, `/api/schools/${fx.schoolA.id}`)
    expect(res.status).toBe(200)
  }, T)

  test('student B → /api/exams/school-context → 200 (own school)', async () => {
    const res = await as(fx.users.studentB.email, '/api/exams/school-context')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Green Valley')
    expect(text).not.toContain('Sunrise')
  }, T)

  test('own-tenant search: principal A finds Sunrise students (lowercase q — pins ILIKE parity); principal B sees NOTHING (cross-tenant invisible)', async () => {
    // Phase 8A re-target (was: principal B finds Bluebell's 'Ira Rao').
    // The clean tenant has no students to find, so the own-tenant
    // visibility positive is proven from the Sunrise side — with a
    // LOWERCASE q, which also pins the PG ILIKE case-insensitivity the
    // 8A-C2 wave restored — while the cross-tenant case stays invisible.
    const aRes = await as(fx.users.principalA.email, '/api/search?q=aarav')
    expect(aRes.status).toBe(200)
    const aBody = (await aRes.json()) as { data: { results: unknown[] } }
    expect(aBody.data.results.length).toBeGreaterThan(0)
    expect(JSON.stringify(aBody)).toContain('Aarav Mehta') // the Sunrise probe student

    const bRes = await as(fx.users.principalB.email, '/api/search?q=Aarav')
    expect(bRes.status).toBe(200)
    const bBody = (await bRes.json()) as { data: { results: unknown[] } }
    expect(bBody.data.results.length).toBe(0)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 8. SESSION teardown — the suite must not leave probe sessions behind
// ─────────────────────────────────────────────────────────────────────────

describe('PHASE 2 · cleanup', () => {
  test('purge fixture sessions created by this run', async () => {
    const emails = Object.values(fx.users).map((u) => u.email)
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    const res = await db.session.deleteMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        tokenHash: { in: Object.values(tokens).map(hashSessionToken) },
      },
    })
    expect(res.count).toBeGreaterThanOrEqual(0)
  }, T)
})

// Phase 8A — the clean tenant is honest-zero (mission §7). Two B-side
// probes need FUNCTIONAL teacher/student records mid-test; they are
// created and destroyed INSIDE those tests only, so every other
// assertion still sees the clean school at zero.
async function withBsideTeacherRecords(fn: () => Promise<void>): Promise<void> {
  const teacherExisted = !!(await db.teacher.findFirst({ where: { userId: fx.users.teacherB.id } }))
  const studentExisted = !!(await db.student.findFirst({ where: { userId: fx.users.studentB.id } }))
  if (!teacherExisted) await db.teacher.create({ data: { schoolId: fx.schoolB.id, userId: fx.users.teacherB.id } })
  if (!studentExisted) await db.student.create({ data: { schoolId: fx.schoolB.id, userId: fx.users.studentB.id, admissionNo: 'TI-B-FIXTURE' } })
  try {
    await fn()
  } finally {
    if (!studentExisted) await db.student.deleteMany({ where: { userId: fx.users.studentB.id } })
    if (!teacherExisted) await db.teacher.deleteMany({ where: { userId: fx.users.teacherB.id } })
  }
}
