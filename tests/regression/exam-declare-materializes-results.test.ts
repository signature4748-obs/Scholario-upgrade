/**
 * REGRESSION — declareResults materializes the student-visible Result rows
 * (Student-panel functional audit, 2026-10-17).
 *
 * THE SHIPPED DEFECT this suite pins:
 *   The PHASE 3 contract (prisma/schema.prisma Result comment +
 *   src/lib/store/student-results-store.ts doc: "the staff publish/declare
 *   flow writes [the rows]") was NOT implemented by the declare flow:
 *   declareResults only flipped Exam.resultStatus to 'Result Declared' and
 *   wrote an ExamAuditLog row. The exam workspace then told the principal
 *   "Results declared — publish to notify students and parents", and
 *   publishResults sent the notification "Your results … are now
 *   available. Please check the portal." — while /api/results (the student
 *   Results module + dashboard academics card) had ZERO rows for that
 *   exam. Every notified student opened the portal to the honest-but-wrong
 *   "No published results yet" state.
 *
 * THE FIX UNDER TEST (src/lib/exams/service.ts declareResults):
 *   · declare materializes Result rows from the FINAL ExamMark set
 *     (marksObtained non-null AND workflowStatus ≠ DRAFT — a DRAFT row
 *     with a value can never leak into a student-visible report card);
 *   · rows are idempotent by the (studentId, examId, subjectId) business
 *     key (@@unique + skipDuplicates) — a re-run never duplicates;
 *   · totalMarks come from ExamSubjectConfig.maxMarks (fallback 100);
 *   · grade is stored with the canonical CBSE-style scale (informational
 *     column — the student store re-derives display grades);
 *   · the response reports { declared, resultsMaterialized }.
 *
 * COVERAGE CONTRACT:
 *   A before declare, a student sees no rows for the exam          [live]
 *   B declare materializes exactly the final marks                 [live]
 *   C each student sees ONLY their own rows (role scope)           [live]
 *   D re-declare is idempotent (no duplicated rows)                [live]
 *   E a DRAFT mark with a value is never materialized              [live]
 *   F declare is PRINCIPAL/MANAGEMENT only (student/teacher 403)   [live]
 *
 * Live part runs against the canonical demo corpus with a REAL principal
 * login (liveFetch) plus direct-session fixtures for QA students — the
 * same harness as tests/regression/exam-result-status.test.ts.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { liveFetch } from '../helpers/live-http'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { DEMO_PRINCIPAL_EMAIL, DEMO_PRINCIPAL_PASSWORD } from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const RUN_IP = `10.244.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const MARK = Math.random().toString(36).slice(2, 8)

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('declareResults materializes student-visible Result rows', () => {
  let schoolId = ''
  let principalToken = ''
  let studentAToken = ''
  let studentBToken = ''
  let studentCToken = ''

  // QA fixtures (FK-ordered cleanup in afterAll)
  const fx: {
    examId?: string
    classId?: string
    subjectId?: string
    studentA?: { id: string; userId: string }
    studentB?: { id: string; userId: string }
    studentC?: { id: string; userId: string } // the DRAFT-mark student
    sessions: string[]
  } = { sessions: [] }

  beforeAll(async () => {
    const school = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' } })
    if (!school) throw new Error('hawkings-prithvipur corpus missing — run seed:demo')
    schoolId = school.id

    // ── QA fixtures: class + 3 students + subject + Result-Ready exam ──
    const cls = await db.class.create({
      data: { schoolId, name: `QA-DCL-${MARK}`, capacity: 10 },
    })
    fx.classId = cls.id

    const mkStudent = async (n: string, roll: string) => {
      const email = `qa-dcl-${n}-${MARK}@hawkings.test`
      const u = await db.user.create({
        data: { email, name: `QA Declare ${n}`, role: 'STUDENT', schoolId, status: 'ACTIVE' },
      })
      const s = await db.student.create({
        data: {
          schoolId,
          userId: u.id,
          classId: cls.id,
          rollNo: roll,
          admissionNo: `QADCL-${MARK}-${n}`,
        },
      })
      // Direct session row (auth fixture — the canonical suite fallback;
      // NOT an authorization bypass: role scope is enforced server-side).
      const raw = randomBytes(32).toString('hex')
      await db.session.create({
        data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
      })
      fx.sessions.push(raw)
      return { id: s.id, userId: u.id, token: raw }
    }

    const a = await mkStudent('a', '01')
    const b = await mkStudent('b', '02')
    const c = await mkStudent('c', '03')
    fx.studentA = { id: a.id, userId: a.userId }
    fx.studentB = { id: b.id, userId: b.userId }
    fx.studentC = { id: c.id, userId: c.userId }
    studentAToken = a.token
    studentBToken = b.token
    studentCToken = c.token

    const subject = await db.subject.create({
      data: { schoolId, name: `QA Declaring ${MARK}`, fullMarks: 50, passMarks: 17 },
    })
    fx.subjectId = subject.id

    const exam = await db.exam.create({
      data: {
        schoolId,
        name: `QA Declare Exam ${MARK}`,
        type: 'Unit Test',
        session: '2026-2027',
        status: 'Completed',
        resultStatus: 'Result Ready', // the declare gate
      },
    })
    fx.examId = exam.id

    await db.examClass.create({ data: { examId: exam.id, classId: cls.id } })
    await db.examSubjectConfig.create({
      data: { examId: exam.id, classId: cls.id, subjectId: subject.id, maxMarks: 50, passMarks: 17 },
    })

    // FINAL marks: A and B LOCKED with values; C DRAFT WITH a value (E).
    await db.examMark.createMany({
      data: [
        { examId: exam.id, classId: cls.id, subjectId: subject.id, studentId: a.id, marksObtained: 45, workflowStatus: 'LOCKED' },
        { examId: exam.id, classId: cls.id, subjectId: subject.id, studentId: b.id, marksObtained: 28, workflowStatus: 'LOCKED' },
        { examId: exam.id, classId: cls.id, subjectId: subject.id, studentId: c.id, marksObtained: 50, workflowStatus: 'DRAFT' },
      ],
    })

    // Real principal login (rate-limit budget healed first).
    await resetLoginBuckets([DEMO_PRINCIPAL_EMAIL])
    const res = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: DEMO_PRINCIPAL_EMAIL, password: DEMO_PRINCIPAL_PASSWORD }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { sessionToken?: string } }
    if (body.ok && body.data?.sessionToken) {
      principalToken = body.data.sessionToken
    } else {
      // direct-session fallback (same convention as the canonical suites)
      const u = await db.user.findUnique({ where: { email: DEMO_PRINCIPAL_EMAIL } })
      if (!u) throw new Error(`no fixture user ${DEMO_PRINCIPAL_EMAIL}`)
      const raw = randomBytes(32).toString('hex')
      await db.session.create({
        data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
      })
      principalToken = raw
    }
  }, 90_000)

  afterAll(async () => {
    // FK-ordered cleanup: exam cascades marks/configs/classes/results/audit;
    // students cascade nothing user-side, so users go after students.
    if (fx.examId) await db.exam.deleteMany({ where: { id: fx.examId } }).catch(() => {})
    for (const s of [fx.studentA, fx.studentB, fx.studentC]) {
      if (s) {
        await db.student.deleteMany({ where: { id: s.id } }).catch(() => {})
        await db.user.deleteMany({ where: { id: s.userId } }).catch(() => {})
      }
    }
    if (fx.classId) await db.class.deleteMany({ where: { id: fx.classId } }).catch(() => {})
    if (fx.subjectId) await db.subject.deleteMany({ where: { id: fx.subjectId } }).catch(() => {})
    for (const raw of fx.sessions) {
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }).catch(() => {})
    }
    if (principalToken) {
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }).catch(() => {})
    }
    await db.$disconnect()
  })

  const myRows = async (token: string) => {
    const res = await liveFetch(`${BASE}/api/results`, { headers: auth(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])
    return (rows as Array<{ examId: string; studentId: string; marks: number; totalMarks: number; grade?: string | null }>).filter(
      (r) => r.examId === fx.examId,
    )
  }

  test(
    'A: before declare, the student honestly sees no rows for the exam',
    async () => {
      const rows = await myRows(studentAToken)
      expect(rows).toHaveLength(0)
    },
    T,
  )

  test(
    'B: declare materializes exactly the final (non-DRAFT) marks and reports the count',
    async () => {
      const res = await liveFetch(`${BASE}/api/exams/${fx.examId}/results/declare`, {
        method: 'POST',
        headers: { ...auth(principalToken), 'x-forwarded-for': RUN_IP },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok?: boolean; data?: { declared?: boolean; resultsMaterialized?: number } }
      expect(body.data?.declared).toBe(true)
      // A (45/50) + B (28/50) — the DRAFT C row must NOT count.
      expect(body.data?.resultsMaterialized).toBe(2)

      const exam = await db.exam.findUnique({ where: { id: fx.examId! } })
      expect(exam?.resultStatus).toBe('Result Declared')
      expect(exam?.declaredAt).toBeTruthy()

      const rows = await db.result.findMany({ where: { examId: fx.examId! } })
      expect(rows).toHaveLength(2)
      const byStudent = new Map(rows.map((r) => [r.studentId, r]))
      expect(byStudent.get(fx.studentA!.id)?.marks).toBe(45)
      expect(byStudent.get(fx.studentA!.id)?.totalMarks).toBe(50) // from ExamSubjectConfig.maxMarks
      expect(byStudent.get(fx.studentB!.id)?.marks).toBe(28)
      expect(byStudent.has(fx.studentC!.id)).toBe(false) // E, part 1: DRAFT never materialized

      // The declare is audited.
      const auditRows = await db.examAuditLog.findMany({ where: { examId: fx.examId!, action: 'RESULT_DECLARED' } })
      expect(auditRows.length).toBeGreaterThanOrEqual(1)
    },
    T,
  )

  test(
    'C: each student sees ONLY their own materialized row (role scope)',
    async () => {
      const rowsA = await myRows(studentAToken)
      expect(rowsA).toHaveLength(1)
      expect(rowsA[0].studentId).toBe(fx.studentA!.id)
      expect(rowsA[0].marks).toBe(45)
      expect(rowsA[0].totalMarks).toBe(50)

      const rowsB = await myRows(studentBToken)
      expect(rowsB).toHaveLength(1)
      expect(rowsB[0].studentId).toBe(fx.studentB!.id)
      expect(rowsB[0].marks).toBe(28)

      // The student-grade scale: 45/50 = 90% → 'A+'; 28/50 = 56% → 'C'.
      expect(rowsA[0].grade).toBe('A+')
      expect(rowsB[0].grade).toBe('C')
    },
    T,
  )

  test(
    'D: re-declare after a status reset is idempotent — no duplicated rows',
    async () => {
      // Simulate a re-run after partial failure: the exam is back at
      // Result Ready while the rows from the first run still exist.
      await db.exam.update({ where: { id: fx.examId! }, data: { resultStatus: 'Result Ready', declaredAt: null } })

      const res = await liveFetch(`${BASE}/api/exams/${fx.examId}/results/declare`, {
        method: 'POST',
        headers: { ...auth(principalToken), 'x-forwarded-for': RUN_IP },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data?: { resultsMaterialized?: number } }
      expect(body.data?.resultsMaterialized).toBe(0) // every business key already present

      const rows = await db.result.findMany({ where: { examId: fx.examId! } })
      expect(rows).toHaveLength(2) // no duplicates
      expect(rows.filter((r) => r.studentId === fx.studentA!.id)).toHaveLength(1)
    },
    T,
  )

  test(
    'E: the DRAFT mark (with a value) never materializes for its student',
    async () => {
      const rows = await myRows(studentCToken)
      expect(rows).toHaveLength(0)
    },
    T,
  )

  test(
    'F: declare is PRINCIPAL/MANAGEMENT only — student and teacher sessions are rejected',
    async () => {
      // A student session.
      const asStudent = await liveFetch(`${BASE}/api/exams/${fx.examId}/results/declare`, {
        method: 'POST',
        headers: { ...auth(studentAToken), 'x-forwarded-for': RUN_IP },
      })
      expect(asStudent.status).toBe(403)

      // A canonical teacher session (direct fixture, same fallback).
      const teacher = await db.user.findFirst({
        where: { email: 'teacher1@hawkingshigh.edu' },
      })
      expect(teacher).toBeTruthy()
      const raw = randomBytes(32).toString('hex')
      await db.session.create({
        data: { userId: teacher!.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
      })
      fx.sessions.push(raw)
      const asTeacher = await liveFetch(`${BASE}/api/exams/${fx.examId}/results/declare`, {
        method: 'POST',
        headers: { ...auth(raw), 'x-forwarded-for': RUN_IP },
      })
      expect(asTeacher.status).toBe(403)

      // No side effects: row count unchanged, exam stays declared.
      const rows = await db.result.findMany({ where: { examId: fx.examId! } })
      expect(rows).toHaveLength(2)
      const exam = await db.exam.findUnique({ where: { id: fx.examId! } })
      expect(exam?.resultStatus).toBe('Result Declared')
    },
    T,
  )
})
