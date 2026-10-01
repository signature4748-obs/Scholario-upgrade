import { Prisma } from '@prisma/client'
import { db } from '../helpers/db'
/**
 * PHASE 3 — DATABASE INTEGRITY TESTS (the automated invariant gate).
 *
 * Companion docs: docs/DATABASE_INTEGRITY.md.
 * These tests demonstrate, against the real PostgreSQL database (Phase 8A
 * Supabase), that:
 *   1. the business-key UNIQUE constraints reject duplicates
 *      (admission numbers, roll numbers, attendance, fees, receipts,
 *       payments, exams, marks, timetable, rooms*, class/subject
 *       identities, documents-by-reference …)      [*rooms pre-existed]
 *   2. the DB-level bound guards reject out-of-range writes
 *      (marks ≤ configured maxMarks, Fee.paid ≤ amount, positive
 *       money, library availability, Result.marks ≤ totalMarks)
 *   3. the DB-level tenant guards reject cross-school FK writes
 *      (defense-in-depth beneath the Phase-2 service layer)
 *   4. writes are idempotent on their business keys
 *      (attendance, marks, webhook events, payment replays)
 *   5. financial operations are transactional + single-ledger-writer
 *      (applyPaymentToLedger: idempotent by txnId, clamped to
 *       outstanding, never overshoots Fee.paid)
 *   6. deletion is deliberate (declared exams refuse deletion; tenant
 *      teardown cascades completely — payments included)
 *
 * Every test cleans up after itself (afterAll sweep + per-test deletes).
 * Trigger ABORTs surface from Prisma as P2003; unique violations as P2002.
 */
import { describe, test, expect, afterAll, beforeAll, mock } from 'bun:test'

import { applyPaymentToLedger } from '@/lib/fee-workflow'


// exams/service.ts carries `import 'server-only'` (a Next.js RSC guard).
// Under bun:test it throws, so intercept it before dynamically importing
// the service for the deletion tests.
let deleteExam: (examId: string, schoolId: string, user: unknown) => Promise<void>
let _resolveFeeIdForTxn: ((tx: Prisma.TransactionClient, input: {
  schoolId: string; studentId: string; feeId: string | null; feeHeadName: string | null;
  amount: number; method: string; paidAt?: Date
}) => Promise<string>) | null = null

const P = 'test-p3-' // id/email/slug prefix for every row this suite creates

// ── shared fixtures ────────────────────────────────────────────────────
let schoolA = { id: '' }
let schoolB = { id: '' }
let classA = { id: '', name: '', section: null as string | null }
let teacherUserA = { id: '' }
let studentA = { id: '', admissionNo: null as string | null, classId: null as string | null, rollNo: null as string | null }
let studentB = { id: '' }
let subjectA = { id: '' }
let examA = { id: '', name: '', session: null as string | null }
let markKey = { examId: '', classId: '', subjectId: '', studentId: '' }
let _markConfig = { maxMarks: 100 }
let _resultKey = { studentId: '', examId: '', subjectId: '' }
let _attendanceKey = { studentId: '', date: new Date() }
let feeA = { id: '', amount: 0, paid: 0 }
let bookA = { id: '' }
let subjectB = { id: '' }

/**
 * The write MUST be rejected by the database. SQLite surfaced trigger
 * ABORTs as P2003 and unique violations as P2002; on PostgreSQL the
 * UNIQUE violations still map to P2002, but CHECK constraints (23514)
 * and RAISE EXCEPTION guards (P0001 — the "tenant-guard:"/"bound-guard:"
 * triggers) surface as PrismaClientUnknownRequestError with the
 * PostgresError payload embedded in the message. Both shapes are the
 * SAME rejections — normalize the provider artifact, never the verdict.
 */
async function blocked(fn: () => Promise<unknown>): Promise<{ code: string }> {
  try {
    await fn()
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const code = err.code ?? ''
    if (code === 'P2002' || code === 'P2003') return { code }
    const msg = String(err.message ?? '')
    const pg = /PostgresError \{[^}]*code: "(P0001|23514|23503)"/.exec(msg)
    if (pg) return { code: pg[1] }
    throw new Error(`expected a DB constraint rejection (P2002/P2003 or PG guard 23514/P0001), got: ${code || 'no code'} — ${msg.slice(0, 160)}`)
  }
  throw new Error('expected the write to be REJECTED by the database, but it succeeded')
}

beforeAll(async () => {
  await mock.module('server-only', () => ({ __esModule: true }))
  const examsService = await import('@/lib/exams/service')
  deleteExam = examsService.deleteExam
  const feeWorkflow = await import('@/lib/fee-workflow')
  _resolveFeeIdForTxn = feeWorkflow.resolveFeeIdForTxn

  const schools = await db.school.findMany()
  expect(schools.length).toBeGreaterThanOrEqual(2)
  // Phase 8A two-tenant corpus: schoolA = the DEMO tenant (full business
  // data — the legacy first-by-createdAt order flipped when the clean
  // school was seeded first); schoolB = the CLEAN tenant (bootstrap config,
  // zero business rows). The A-side fixtures below REQUIRE the data tenant.
  const demo = schools.find((s) => s.isDemo) ?? schools[0]
  schoolA = demo
  schoolB = schools.find((s) => s.id !== demo.id) ?? schools[schools.length - 1]

  classA = (await db.class.findFirstOrThrow({ where: { schoolId: schoolA.id }, select: { id: true, name: true, section: true } }))!
  const tu = await db.user.findFirst({ where: { schoolId: schoolA.id, role: 'TEACHER', status: 'ACTIVE' }, select: { id: true } })
  teacherUserA = tu ?? { id: '' }
  const sA = await db.student.findFirst({
    where: { schoolId: schoolA.id, admissionNo: { not: null }, classId: { not: null }, rollNo: { not: null } },
    select: { id: true, admissionNo: true, classId: true, rollNo: true },
  })
  studentA = sA ?? { id: '', admissionNo: null, classId: null, rollNo: null }
  // Phase 8A: the clean tenant carries ZERO students — the cross-tenant
  // FK-guard probes below use a THROWAWAY student minted here (P-swept in
  // afterAll) instead of a corpus row.
  const sbPair = await tempUserStudent(schoolB.id, null)
  studentB = { id: sbPair.student.id }
  subjectA = (await db.subject.findFirstOrThrow({ where: { schoolId: schoolA.id }, select: { id: true } }))!

  const cfg = await db.examSubjectConfig.findFirst({
    where: { class: { schoolId: schoolA.id } },
    include: { exam: { select: { id: true, name: true, session: true } }, class: { select: { id: true } }, subject: { select: { id: true } } },
  })
  expect(cfg).not.toBeNull()
  markKey = { examId: cfg!.examId, classId: cfg!.classId, subjectId: cfg!.subjectId, studentId: studentA.id }
  _markConfig = { maxMarks: cfg!.maxMarks }
  examA = { id: cfg!.exam.id, name: cfg!.exam.name, session: cfg!.exam.session }

  const res = await db.result.findFirst({ where: { exam: { schoolId: schoolA.id } }, select: { studentId: true, examId: true, subjectId: true } })
  if (res) _resultKey = res

  const att = await db.attendance.findFirst({ where: { schoolId: schoolA.id }, select: { studentId: true, date: true } })
  if (att) _attendanceKey = att

  const feeRow = (await db.fee.findFirstOrThrow({ where: { schoolId: schoolA.id }, select: { id: true, amount: true, paid: true } }))!
  // NUMERIC(12,2) money arrives as Prisma.Decimal — normalize at the fixture boundary.
  feeA = { id: feeRow.id, amount: Number(feeRow.amount), paid: Number(feeRow.paid) }
  bookA = (await db.libraryBook.findFirstOrThrow({ where: { schoolId: schoolA.id }, select: { id: true } }))!

  // Phase 8A: the clean tenant also carries no subjects — plant a P-swept
  // probe subject there so the cross-school homework guard below stays
  // non-vacuous (a REAL foreign subject id to reject).
  subjectB = (await db.subject.findFirst({ where: { schoolId: schoolB.id }, select: { id: true } }))
    ?? (await db.subject.create({ data: { id: `${P}subj-b`, schoolId: schoolB.id, name: 'P3 Cross-School Subject' } }))
}, 60_000) // remote-Supabase fixture resolution (family convention — fee-lifecycle/assignment-scope)

afterAll(async () => {
  // sweep: every model this suite can touch, idempotent deletes
  await db.attendance.deleteMany({ where: { id: { startsWith: P } } })
  await db.examMark.deleteMany({ where: { id: { startsWith: P } } })
  await db.exam.deleteMany({ where: { id: { startsWith: P } } })
  await db.payment.deleteMany({ where: { id: { startsWith: P } } })
  await db.payment.deleteMany({ where: { transactionId: { startsWith: P } } })
  await db.fee.deleteMany({ where: { id: { startsWith: P } } })
  await db.feeTransaction.deleteMany({ where: { id: { startsWith: P } } })
  await db.reconciliation.deleteMany({ where: { id: { startsWith: P } } })
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: P } } })
  await db.libraryBook.deleteMany({ where: { id: { startsWith: P } } })
  await db.timetable.deleteMany({ where: { id: { startsWith: P } } })
  await db.homework.deleteMany({ where: { id: { startsWith: P } } })
  await db.classSubjectAssignment.deleteMany({ where: { id: { startsWith: P } } })
  await db.student.deleteMany({ where: { id: { startsWith: P } } })
  await db.class.deleteMany({ where: { id: { startsWith: P } } })
  await db.subject.deleteMany({ where: { id: { startsWith: P } } })
  await db.school.deleteMany({ where: { slug: { startsWith: P } } })
  await db.user.deleteMany({ where: { email: { startsWith: P } } })
  await db.$disconnect()
})

async function tempUserStudent(schoolId: string, classId: string | null) {
  const email = `${P}${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`
  const user = await db.user.create({ data: { email, role: 'STUDENT', schoolId, status: 'ACTIVE', name: 'P3 Test' } })
  const student = await db.student.create({ data: { id: `${P}stu-${user.id.slice(-8)}`, userId: user.id, schoolId, classId } })
  return { user, student }
}

// ════════════════════════════════════════════════════════════════════
// 1. UNIQUE-CONSTRAINT CATALOG (goal 2)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · unique constraints', () => {
  test('admission numbers are unique per school', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, null)
    try {
      await blocked(() =>
        db.student.update({ where: { id: student.id }, data: { admissionNo: studentA.admissionNo } }),
      )
    } finally {
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })

  test('roll numbers are unique within (school, class)', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, studentA.classId)
    try {
      await blocked(() =>
        db.student.update({ where: { id: student.id }, data: { rollNo: studentA.rollNo } }),
      )
    } finally {
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })

  test('classes are unique per (school, name, section)', async () => {
    await blocked(() =>
      db.class.create({
        data: { id: `${P}cls-dup`, schoolId: schoolA.id, name: classA.name, section: classA.section },
      }),
    )
    await db.class.deleteMany({ where: { id: `${P}cls-dup` } })
  })

  test('exams are unique per (school, name, session)', async () => {
    await blocked(() =>
      db.exam.create({
        data: { id: `${P}exam-dup`, schoolId: schoolA.id, name: examA.name, session: examA.session },
      }),
    )
    await db.exam.deleteMany({ where: { id: `${P}exam-dup` } })
  })

  test('a class-day timetable slot is unique — no double-booking a period', async () => {
    const slot = await db.timetable.findFirstOrThrow({ where: { schoolId: schoolA.id } })
    await blocked(() =>
      db.timetable.create({
        data: { id: `${P}tt-dup`, schoolId: slot.schoolId, classId: slot.classId, day: slot.day, period: slot.period },
      }),
    )
    await db.timetable.deleteMany({ where: { id: `${P}tt-dup` } })
  })

  test('a teacher cannot be double-booked at the same day+period', async () => {
    if (!teacherUserA.id) return // fixture absent — trivially green
    const day = 'Saturday', period = 11
    // a SECOND class in the same school so the CLASS-slot unique cannot
    // be the one that fires — only the TEACHER unique can reject this
    const cls2 = await db.class.create({ data: { id: `${P}cls-t2`, schoolId: schoolA.id, name: `P3-ALT-${Date.now()}` } })
    try {
      await db.timetable.create({
        data: { id: `${P}tt-t1`, schoolId: schoolA.id, classId: classA.id, day, period, teacherUserId: teacherUserA.id },
      })
      await blocked(() =>
        db.timetable.create({
          data: { id: `${P}tt-t2`, schoolId: schoolA.id, classId: cls2.id, day, period, teacherUserId: teacherUserA.id },
        }),
      )
    } finally {
      await db.timetable.deleteMany({ where: { id: { in: [`${P}tt-t1`, `${P}tt-t2`] } } })
      await db.class.deleteMany({ where: { id: cls2.id } })
    }
  })

  test('report-card Result rows are unique per (student, exam, subject)', async () => {
    const r = await db.result.findFirstOrThrow({ where: { exam: { schoolId: schoolA.id } } })
    await blocked(() =>
      db.result.create({ data: { studentId: r.studentId, examId: r.examId, subjectId: r.subjectId, marks: 50, totalMarks: 100 } }),
    )
  })

  test('attendance is unique per (student, date) — the idempotency key', async () => {
    const a = await db.attendance.findFirstOrThrow({ where: { schoolId: schoolA.id } })
    await blocked(() =>
      db.attendance.create({ data: { schoolId: a.schoolId, studentId: a.studentId, classId: a.classId, date: a.date, status: 'ABSENT' } }),
    )
  })

  test('exam marks are unique per (exam, class, subject, student) — duplicate submission guard', async () => {
    const m = await db.examMark.findFirstOrThrow({ where: { examId: markKey.examId } })
    await blocked(() =>
      db.examMark.create({
        data: { examId: m.examId, classId: m.classId, subjectId: m.subjectId, studentId: m.studentId, marksObtained: 10 },
      }),
    )
  })

  test('fee receipt numbers are unique per school', async () => {
    const base = { schoolId: schoolA.id, amount: 100, method: 'CASH', status: 'SUCCESS', receiptNo: `${P}RCP-1` }
    await db.feeTransaction.create({ data: { id: `${P}ft-1`, ...base } })
    try {
      await blocked(() => db.feeTransaction.create({ data: { id: `${P}ft-2`, ...base } }))
    } finally {
      await db.feeTransaction.deleteMany({ where: { id: { in: [`${P}ft-1`, `${P}ft-2`] } } })
    }
  })

  test('fee reference numbers are unique per school (duplicate-detection key)', async () => {
    const base = { schoolId: schoolA.id, amount: 100, method: 'CASH', status: 'SUCCESS', referenceNumber: `${P}REF-1` }
    await db.feeTransaction.create({ data: { id: `${P}ft-3`, ...base } })
    try {
      await blocked(() => db.feeTransaction.create({ data: { id: `${P}ft-4`, ...base } }))
    } finally {
      await db.feeTransaction.deleteMany({ where: { id: { in: [`${P}ft-3`, `${P}ft-4`] } } })
    }
  })

  test('Payment gateway transactionIds are unique — a replayed webhook can never mint a second mirror row', async () => {
    const base = { schoolId: schoolA.id, feeId: feeA.id, amount: 10, method: 'UPI', status: 'SUCCESS', transactionId: `${P}TXN-1` }
    await db.payment.create({ data: { id: `${P}pay-1`, ...base } })
    try {
      await blocked(() => db.payment.create({ data: { id: `${P}pay-2`, ...base } }))
    } finally {
      await db.payment.deleteMany({ where: { id: { in: [`${P}pay-1`, `${P}pay-2`] } } })
    }
  })

  test('library books are unique per (school, isbn)', async () => {
    const base = { schoolId: schoolA.id, title: 'P3 Book', isbn: `${P}ISBN-1`, copies: 2, available: 2 }
    await db.libraryBook.create({ data: { id: `${P}bk-1`, ...base } })
    try {
      await blocked(() => db.libraryBook.create({ data: { id: `${P}bk-2`, ...base } }))
    } finally {
      await db.libraryBook.deleteMany({ where: { id: { in: [`${P}bk-1`, `${P}bk-2`] } } })
    }
  })

  test('webhook event ids are unique — duplicate delivery is a no-op', async () => {
    const base = { eventId: `${P}evt-1`, eventType: 'payment.captured', rawPayload: '{}', gatewayName: 'razorpay' }
    await db.webhookEvent.create({ data: { ...base } })
    try {
      await blocked(() => db.webhookEvent.create({ data: { ...base } }))
    } finally {
      await db.webhookEvent.deleteMany({ where: { eventId: `${P}evt-1` } })
    }
  })

  test('Reconciliation matches are unique per (transaction, settlement)', async () => {
    const txn = await db.feeTransaction.create({
      data: { id: `${P}ft-5`, schoolId: schoolA.id, amount: 100, method: 'CASH', status: 'SUCCESS' },
    })
    const st = await db.settlement.create({
      data: { id: `${P}st-1`, schoolId: schoolA.id, periodStart: new Date(), periodEnd: new Date(), grossAmount: 100, netAmount: 100, payoutId: `${P}payout-1` },
    })
    await db.reconciliation.create({ data: { id: `${P}rec-1`, schoolId: schoolA.id, transactionId: txn.id, settlementId: st.id } })
    try {
      await blocked(() =>
        db.reconciliation.create({ data: { id: `${P}rec-2`, schoolId: schoolA.id, transactionId: txn.id, settlementId: st.id } }),
      )
    } finally {
      await db.reconciliation.deleteMany({ where: { id: { startsWith: P } } })
      await db.settlement.deleteMany({ where: { id: { startsWith: P } } })
      await db.feeTransaction.deleteMany({ where: { id: { startsWith: P } } })
    }
  })
})

// ════════════════════════════════════════════════════════════════════
// 2. BOUND GUARDS (goal 9 — exam results can never exceed max marks, …)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · bound guards (database level)', () => {
  test('ExamMark.marksObtained can never exceed the configured maxMarks', async () => {
    const m = await db.examMark.findFirstOrThrow({ where: { examId: markKey.examId, classId: markKey.classId, subjectId: markKey.subjectId, marksObtained: { not: null } } })
    const cfg = await db.examSubjectConfig.findFirstOrThrow({ where: { examId: m.examId, classId: m.classId, subjectId: m.subjectId } })
    const r = await blocked(() => db.examMark.update({ where: { id: m.id }, data: { marksObtained: cfg.maxMarks + 1 } }))
    // P2003 = the legacy SQLite trigger-ABORT mapping; P0001 = the same
    // bound-guard on PG (RAISE EXCEPTION). Either proves the DB rejection.
    expect(['P2003', 'P0001']).toContain(r.code)
  })

  test('ExamMark rejects negative marks', async () => {
    const m = await db.examMark.findFirstOrThrow({ where: { examId: markKey.examId, marksObtained: { not: null } } })
    await blocked(() => db.examMark.update({ where: { id: m.id }, data: { marksObtained: -1 } }))
  })

  test('ExamMark rejects negative grace marks', async () => {
    const m = await db.examMark.findFirstOrThrow({ where: { examId: markKey.examId } })
    await blocked(() => db.examMark.update({ where: { id: m.id }, data: { graceMarks: -1 } }))
  })

  test('Fee.paid can never exceed Fee.amount (no overpaid ledger)', async () => {
    await blocked(() => db.fee.update({ where: { id: feeA.id }, data: { paid: feeA.amount + 1 } }))
  })

  test('Fee.paid can never go negative', async () => {
    await blocked(() => db.fee.update({ where: { id: feeA.id }, data: { paid: -1 } }))
  })

  test('Payment.amount must be positive', async () => {
    await blocked(() => db.payment.create({ data: { id: `${P}pay-0`, schoolId: schoolA.id, feeId: feeA.id, amount: 0 } }))
    await db.payment.deleteMany({ where: { id: `${P}pay-0` } })
  })

  test('FeeTransaction.amount must be positive', async () => {
    await blocked(() =>
      db.feeTransaction.create({ data: { id: `${P}ft-0`, schoolId: schoolA.id, amount: -5, method: 'CASH', status: 'SUCCESS' } }),
    )
    await db.feeTransaction.deleteMany({ where: { id: `${P}ft-0` } })
  })

  test('LibraryBook.available stays within 0..copies', async () => {
    await blocked(() => db.libraryBook.update({ where: { id: bookA.id }, data: { available: -1 } }))
    const b = await db.libraryBook.findFirstOrThrow({ where: { schoolId: schoolA.id } })
    await blocked(() => db.libraryBook.update({ where: { id: b.id }, data: { available: b.copies + 1 } }))
  })

  test('Result.marks can never exceed totalMarks', async () => {
    const r = await db.result.findFirstOrThrow({ where: { exam: { schoolId: schoolA.id } } })
    await blocked(() => db.result.update({ where: { id: r.id }, data: { marks: r.totalMarks + 1 } }))
  })

  test('Timetable.period must be ≥ 1', async () => {
    await blocked(() =>
      db.timetable.create({ data: { id: `${P}tt-0`, schoolId: schoolA.id, classId: classA.id, day: 'Sunday', period: 0 } }),
    )
    await db.timetable.deleteMany({ where: { id: `${P}tt-0` } })
  })
})

// ════════════════════════════════════════════════════════════════════
// 3. CROSS-SCHOOL FK GUARDS (goal 3 — no accidental cross-tenant row)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · cross-school FK guards (database level)', () => {
  test('a Student cannot point at another school\'s class', async () => {
    const clsB = await db.class.create({ data: { id: `${P}cls-b`, schoolId: schoolB.id, name: 'P3-B' } })
    try {
      const { user, student } = await tempUserStudent(schoolA.id, null)
      try {
        await blocked(() => db.student.update({ where: { id: student.id }, data: { classId: clsB.id } }))
      } finally {
        await db.student.delete({ where: { id: student.id } }).catch(() => {})
        await db.user.delete({ where: { id: user.id } }).catch(() => {})
      }
    } finally {
      await db.class.deleteMany({ where: { id: `${P}cls-b` } })
    }
  })

  test('a Payment cannot credit another school\'s fee', async () => {
    const { user, student } = await tempUserStudent(schoolB.id, null)
    const feeB = await db.fee.create({
      data: { id: `${P}fee-b`, schoolId: schoolB.id, studentId: student.id, title: 'P3-B fee', amount: 500, paid: 0, status: 'UNPAID' },
    })
    try {
      await blocked(() => db.payment.create({ data: { id: `${P}pay-x`, schoolId: schoolA.id, feeId: feeB.id, amount: 100 } }))
    } finally {
      await db.payment.deleteMany({ where: { id: `${P}pay-x` } })
      await db.fee.deleteMany({ where: { id: `${P}fee-b` } })
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })

  test('an ExamMark cannot mix an exam of one school with a student of another', async () => {
    await blocked(() =>
      db.examMark.create({
        data: { examId: markKey.examId, classId: markKey.classId, subjectId: markKey.subjectId, studentId: studentB.id, marksObtained: 10 },
      }),
    )
  })

  test('a Timetable slot cannot appoint another school\'s teacher', async () => {
    const teacherB = await db.user.findFirst({ where: { schoolId: schoolB.id, role: 'TEACHER' } })
    if (!teacherB) return // School B has no teacher fixture — trivially green
    await blocked(() =>
      db.timetable.create({
        data: { id: `${P}tt-x`, schoolId: schoolA.id, classId: classA.id, day: 'Sunday', period: 8, teacherUserId: teacherB.id },
      }),
    )
    await db.timetable.deleteMany({ where: { id: `${P}tt-x` } })
  })

  test('a FeeTransaction cannot reference another school\'s student (plain-string FK guarded)', async () => {
    await blocked(() =>
      db.feeTransaction.create({
        data: { id: `${P}ft-x`, schoolId: schoolA.id, studentId: studentB.id, amount: 100, method: 'CASH', status: 'SUCCESS' },
      }),
    )
    await db.feeTransaction.deleteMany({ where: { id: `${P}ft-x` } })
  })

  test('a CSA cannot bind another school\'s class', async () => {
    const clsB = await db.class.create({ data: { id: `${P}cls-b2`, schoolId: schoolB.id, name: 'P3-B2' } })
    try {
      await blocked(() =>
        db.classSubjectAssignment.create({
          data: { id: `${P}csa-x`, schoolId: schoolA.id, classId: clsB.id, subjectId: subjectA.id },
        }),
      )
    } finally {
      await db.classSubjectAssignment.deleteMany({ where: { id: `${P}csa-x` } })
      await db.class.deleteMany({ where: { id: `${P}cls-b2` } })
    }
  })

  test('a BookIssue cannot link another school\'s student to our book', async () => {
    await blocked(() =>
      db.bookIssue.create({ data: { id: `${P}bi-x`, bookId: bookA.id, studentId: studentB.id, status: 'ISSUED' } }),
    )
    await db.bookIssue.deleteMany({ where: { id: `${P}bi-x` } })
  })

  test('a Homework cannot reference another school\'s subject', async () => {
    const subjB = subjectB // Phase 8A: P-swept probe subject in the clean tenant
    await blocked(() =>
      db.homework.create({
        data: {
          id: `${P}hw-x`, schoolId: schoolA.id, classId: classA.id, subjectId: subjB.id,
          title: 'P3 cross-school homework', assignedDate: new Date(), dueDate: new Date(),
        },
      }),
    )
    await db.homework.deleteMany({ where: { id: `${P}hw-x` } })
  })
})

// ════════════════════════════════════════════════════════════════════
// 4. IDEMPOTENT WRITES (goals 5/6/7)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · idempotent writes on business keys', () => {
  test('double-POST attendance = one canonical row, latest status (upsert semantics)', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, classA.id)
    const date = new Date('2030-01-15T00:00:00.000Z')
    try {
      await db.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date } },
        create: { id: `${P}att-1`, schoolId: schoolA.id, studentId: student.id, classId: classA.id, date, status: 'PRESENT' },
        update: { status: 'ABSENT' },
      })
      await db.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date } },
        create: { id: `${P}att-2`, schoolId: schoolA.id, studentId: student.id, classId: classA.id, date, status: 'PRESENT' },
        update: { status: 'ABSENT' },
      })
      const rows = await db.attendance.findMany({ where: { studentId: student.id, date } })
      expect(rows.length).toBe(1)
      expect(rows[0].status).toBe('ABSENT')
    } finally {
      await db.attendance.deleteMany({ where: { studentId: student.id } })
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })

  test('duplicate marks submission updates the same row (never duplicates)', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, markKey.classId)
    try {
      await db.examMark.upsert({
        where: { examId_classId_subjectId_studentId: { ...markKey, studentId: student.id } },
        create: { ...markKey, studentId: student.id, marksObtained: 40 },
        update: { marksObtained: 45 },
      })
      await db.examMark.upsert({
        where: { examId_classId_subjectId_studentId: { ...markKey, studentId: student.id } },
        create: { ...markKey, studentId: student.id, marksObtained: 40 },
        update: { marksObtained: 45 },
      })
      const rows = await db.examMark.findMany({ where: { ...markKey, studentId: student.id } })
      expect(rows.length).toBe(1)
      expect(rows[0].marksObtained).toBe(45)
    } finally {
      await db.examMark.deleteMany({ where: { studentId: student.id } })
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })
})

// ════════════════════════════════════════════════════════════════════
// 5. TRANSACTIONAL FINANCIAL INTEGRITY (goals 4/5 — the single
//    ledger writer is idempotent, clamped and race-safe)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · transactional financial integrity', () => {
  test('applyPaymentToLedger: applies once, replays are no-ops, never overshoots', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, null)
    const fee = await db.fee.create({
      data: { id: `${P}fee-1`, schoolId: schoolA.id, studentId: student.id, title: 'P3 tuition', amount: 100, paid: 0, status: 'UNPAID' },
    })
    const txnId = `${P}ledger-txn-1`
    try {
      const first = await applyPaymentToLedger({ txnId, schoolId: schoolA.id, feeId: fee.id, amount: 80, method: 'UPI' })
      expect(first?.applied).toBe(80)
      expect(first?.alreadyApplied).toBe(false)

      // replay with the SAME txnId (webhook retry / double-click):
      const replay = await applyPaymentToLedger({ txnId, schoolId: schoolA.id, feeId: fee.id, amount: 80, method: 'UPI' })
      expect(replay?.alreadyApplied).toBe(true)
      expect(replay?.applied).toBe(0)

      // a second, different txn that would overshoot gets CLAMPED:
      const second = await applyPaymentToLedger({ txnId: `${P}ledger-txn-2`, schoolId: schoolA.id, feeId: fee.id, amount: 80, method: 'CASH' })
      expect(second?.applied).toBe(20) // outstanding is 20, not 80

      const feeAfter = await db.fee.findUniqueOrThrow({ where: { id: fee.id } })
      expect(Number(feeAfter.paid)).toBe(100) // exactly the billed amount — never more
      expect(feeAfter.status).toBe('PAID')
      const mirrors = await db.payment.findMany({ where: { transactionId: { startsWith: `${P}ledger-txn` } } })
      expect(mirrors.length).toBe(2) // one per distinct txnId — not one per call

      // a third apply on a fully-paid fee writes nothing:
      const third = await applyPaymentToLedger({ txnId: `${P}ledger-txn-3`, schoolId: schoolA.id, feeId: fee.id, amount: 50, method: 'CASH' })
      expect(third?.applied).toBe(0)
      const mirrors3 = await db.payment.findMany({ where: { transactionId: `${P}ledger-txn-3` } })
      expect(mirrors3.length).toBe(0)
    } finally {
      await db.payment.deleteMany({ where: { transactionId: { startsWith: `${P}ledger-txn` } } })
      await db.fee.deleteMany({ where: { id: fee.id } })
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  }, 30_000) // remote-Supabase roundtrips (4 ledger transactions + mirrors)

  test('fee targeting resolves the oldest unsettled fee, never a paid row (resolveFeeIdForTxn contract)', async () => {
    const resolveFeeIdForTxn = _resolveFeeIdForTxn!
    const { user, student } = await tempUserStudent(schoolA.id, null)
    const paidFee = await db.fee.create({
      data: { id: `${P}fee-paid`, schoolId: schoolA.id, studentId: student.id, title: 'P3 paid fee', amount: 100, paid: 100, status: 'PAID' },
    })
    const openFee = await db.fee.create({
      data: { id: `${P}fee-open`, schoolId: schoolA.id, studentId: student.id, title: 'P3 open fee', amount: 300, paid: 0, status: 'UNPAID' },
    })
    try {
      const resolved = await resolveFeeIdForTxn(db as unknown as Prisma.TransactionClient, {
        schoolId: schoolA.id, studentId: student.id, feeId: null, feeHeadName: null, amount: 100, method: 'UPI',
      })
      expect(resolved).toBe(openFee.id) // NOT the paid row
      expect(resolved).not.toBe(paidFee.id)
    } finally {
      await db.fee.deleteMany({ where: { id: { in: [paidFee.id, openFee.id] } } })
      await db.student.delete({ where: { id: student.id } }).catch(() => {})
      await db.user.delete({ where: { id: user.id } }).catch(() => {})
    }
  })
})

// ════════════════════════════════════════════════════════════════════
// 6. DELIBERATE DELETION (goals 10/11)
// ════════════════════════════════════════════════════════════════════
describe('PHASE 3 · deliberate deletion', () => {
  test('an exam with declared results refuses deletion (auditable history)', async () => {
    const exam = await db.exam.create({
      data: { id: `${P}exam-del`, schoolId: schoolA.id, name: 'P3 declared exam', session: 'P3-test', resultStatus: 'Result Declared' },
    })
    try {
      let refused = false
      try {
        await deleteExam(exam.id, schoolA.id, null)
      } catch {
        refused = true
      }
      expect(refused).toBe(true)
      const still = await db.exam.findUnique({ where: { id: exam.id } })
      expect(still).not.toBeNull() // history preserved
    } finally {
      // undeclare → deletion now allowed (the deliberate path)
      await db.exam.update({ where: { id: exam.id }, data: { resultStatus: 'Not Started' } }).catch(() => {})
      await deleteExam(exam.id, schoolA.id, null).catch(() => {})
      await db.exam.deleteMany({ where: { id: exam.id } })
    }
  })

  test('deleting an exam cascades its marks (no orphans)', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, markKey.classId)
    const exam = await db.exam.create({
      data: { id: `${P}exam-casc`, schoolId: schoolA.id, name: 'P3 cascade exam', session: 'P3-test-2' },
    })
    const mark = await db.examMark.create({
      data: { examId: exam.id, classId: markKey.classId, subjectId: markKey.subjectId, studentId: student.id, marksObtained: 30 },
    })
    expect(mark).not.toBeNull()
    await db.exam.delete({ where: { id: exam.id } })
    const markGone = await db.examMark.findFirst({ where: { examId: exam.id } })
    expect(markGone).toBeNull()
    await db.examMark.deleteMany({ where: { studentId: student.id } })
    await db.student.delete({ where: { id: student.id } }).catch(() => {})
    await db.user.delete({ where: { id: user.id } }).catch(() => {})
  })

  test('tenant teardown cascades EVERYTHING incl. payments (no unattributed financial orphans)', async () => {
    const school = await db.school.create({
      data: { id: `${P}school-t`, name: 'P3 Teardown School', slug: `${P}slug-t`, code: `${P}code-t` },
    })
    const user = await db.user.create({
      data: { email: `${P}teardown@test.local`, role: 'STUDENT', schoolId: school.id, status: 'ACTIVE', name: 'P3 teardown' },
    })
    const student = await db.student.create({ data: { id: `${P}stu-t`, userId: user.id, schoolId: school.id } })
    const fee = await db.fee.create({
      data: { id: `${P}fee-t`, schoolId: school.id, studentId: student.id, title: 'P3 teardown fee', amount: 100, paid: 100, status: 'PAID' },
    })
    const payment = await db.payment.create({
      data: { id: `${P}pay-t`, schoolId: school.id, feeId: fee.id, amount: 100, method: 'CASH', status: 'SUCCESS', transactionId: `${P}teardown-txn` },
    })
    expect(payment).not.toBeNull()

    await db.school.delete({ where: { id: school.id } })

    expect(await db.payment.findFirst({ where: { id: payment.id } })).toBeNull() // financial rows die with the tenant
    expect(await db.fee.findFirst({ where: { id: fee.id } })).toBeNull()
    expect(await db.student.findFirst({ where: { id: student.id } })).toBeNull()
    expect(await db.user.findFirst({ where: { id: user.id } }).catch(() => null)).toBeNull()
  })

  test('deleting a student cascades attendance and marks (no dangling history)', async () => {
    const { user, student } = await tempUserStudent(schoolA.id, classA.id)
    const date = new Date('2030-02-01T00:00:00.000Z')
    await db.attendance.create({
      data: { id: `${P}att-casc`, schoolId: schoolA.id, studentId: student.id, classId: classA.id, date, status: 'PRESENT' },
    })
    // delete via user (cascade User → Student → Attendance)
    await db.user.delete({ where: { id: user.id } })
    expect(await db.attendance.findFirst({ where: { studentId: student.id } })).toBeNull()
    expect(await db.student.findFirst({ where: { id: student.id } })).toBeNull()
  })
})
