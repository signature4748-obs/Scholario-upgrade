import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, DEMO_STUDENT_POSITION } from './seed-identity'
import {
  buildStudentRoster,
  CSA_MATRIX,
  FACULTY,
  SUBJECTS,
  feeStageFor,
  feeShapeFor,
  facultyEmail,
  sr,
  pick,
  pickI,
} from './hawkings-corpus'
import { db } from '../src/lib/db'

/**
 * seed-roster-150 — v4: the HAWKINGS academic-history seed (final
 * acceptance). The filename is kept for pipeline/CI stability; the
 * corpus itself is the 80-student Hawkings roster (prisma/
 * hawkings-corpus.ts), not 150 students.
 *
 * DETERMINISTIC + IDEMPOTENT (top-up per natural key):
 *   · Attendance — the last 40 weekdays for every student (canonical
 *     CLASS+DATE+STUDENT identity, per (student, day) top-up so the
 *     teacher-academics baseline write for 7-A is preserved, never
 *     duplicated).
 *   · PA1 marks — every student × examinable subject of classes 1–12
 *     (students with existing PA1 rows keep them: the 9-A Mathematics
 *     in-progress draft state stays honest).
 *   · Half-Yearly Examination (21–30 September 2026, COMPLETED +
 *     Declared) — per-band max marks (1–5: 50, 6–12: 100), marks
 *     VERIFIED for most, SUBMITTED for a recent few, ABSENT for the
 *     odd student.
 *   · Periodic Assessment 2 (December, Scheduled) — future exam, no
 *     marks.
 *   · Fees — Term 1 tuition + annual + exam fee + Term 2 tuition per
 *     student with a realistic state mix (PAID / PARTIAL / UNPAID /
 *     UNDER_VERIFICATION) and full Payment + FeeTransaction ledger
 *     parity: SUM(FeeTransaction SUCCESS) == SUM(Fee.paid) from a
 *     fresh plant; receipts minted through the canonical
 *     school-year-sequential scheme.
 *   · Behavior + growth events (dedupeKey-gated, every 5th student).
 *   · Messaging — a handful of realistic role-pair threads with
 *     unread accounting.
 *
 * Run: bun run db:seed-roster
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function lastWeekdays(count: number): Date[] {
  const out: Date[] = []
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  while (out.length < count) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) out.push(new Date(d))
    d.setDate(d.getDate() - 1)
  }
  return out.reverse()
}

const daysAgoOf = (n: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setUTCHours(12, 0, 0, 0)
  return d
}

const hashOfString = (str: string): number => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-roster-150')

  const school = await db.school.findUnique({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) throw new Error(`${DEMO_SCHOOL_SLUG} not found — run \`bun run db:seed\` first`)

  console.log('🌱 seed-roster (Hawkings history): attendance, marks, exams, fees, ledger…')

  // ---- Runtime-resolved references ---------------------------------------
  const teacherRows = await db.teacher.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  const teacherByEmail = new Map(teacherRows.map((t) => [t.user.email, t]))
  const teacherOfN = (n: number) => {
    const t = teacherByEmail.get(facultyEmail(n))
    if (!t) throw new Error(`faculty #${n} row missing`)
    return t
  }
  const principal = await db.user.findFirst({
    where: { role: 'PRINCIPAL', schoolId: school.id, email: `principal@hawkingshigh.edu` },
  })
  const management = await db.user.findFirst({
    where: { role: 'MANAGEMENT', schoolId: school.id },
  })

  const classes = await db.class.findMany({ where: { schoolId: school.id } })
  const classByLevel = new Map(classes.map((c) => [c.gradeLevel ?? '', c]))
  const subjectByCode = new Map(
    (await db.subject.findMany({ where: { schoolId: school.id } })).map((s) => [s.code ?? '', s]),
  )
  const behaviorCats = await db.behaviorCategory.findMany({
    where: { schoolId: school.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  const roster = await db.student.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, email: true, name: true } }, class: { select: { id: true, gradeLevel: true, name: true } } },
    orderBy: { admissionNo: 'asc' },
  })
  const rosterDefByEmail = new Map(buildStudentRoster().map((s) => [s.studentEmail, s]))
  /** global deterministic sequence per student (stable across re-runs) */
  const seqOf = new Map(roster.map((s, i) => [s.id, i + 1]))

  // ---- Phase 1: attendance (40 weekdays, per-(student,day) top-up) --------
  console.log('· Phase 1: attendance (40 weekdays)')
  const dates = lastWeekdays(40)
  const existingAttendance = new Set(
    (await db.attendance.findMany({
      where: { schoolId: school.id, studentId: { in: roster.map((s) => s.id) }, date: { gte: dates[0] } },
      select: { studentId: true, date: true },
    })).map((a) => `${a.studentId}|${a.date.toISOString().slice(0, 10)}`),
  )
  const classTeacherNameByLevel = new Map<string, string>()
  for (const f of FACULTY) {
    const t = teacherOfN(f.n)
    classTeacherNameByLevel.set(f.classTeacherOf, t.user.name ?? 'Class Teacher')
  }
  const attendanceRows: { schoolId: string; studentId: string; classId: string; date: Date; status: string; markedBy: string }[] = []
  for (const s of roster) {
    const num = seqOf.get(s.id) ?? 1
    const rnd = sr(num * 104729)
    const rate = 0.8 + rnd() * 0.17 // 80–97%
    const level = s.class?.gradeLevel ?? '6'
    const markedBy = classTeacherNameByLevel.get(level) ?? 'Class Teacher'
    for (const d of dates) {
      const key = `${s.id}|${d.toISOString().slice(0, 10)}`
      if (existingAttendance.has(key)) continue
      const roll = rnd()
      let status = 'PRESENT'
      if (roll > rate) {
        const t = rnd()
        status = t < 0.3 ? 'LATE' : t < 0.8 ? 'ABSENT' : 'LEAVE'
      }
      attendanceRows.push({
        schoolId: school.id,
        studentId: s.id,
        classId: s.class?.id ?? s.classId ?? classes[0].id,
        date: d,
        status,
        markedBy,
      })
    }
  }
  if (attendanceRows.length) await db.attendance.createMany({ data: attendanceRows })
  console.log(`  +${attendanceRows.length} attendance rows (per-(student,day) top-up)`)

  // ---- Phase 2: PA1 marks for every student (skip in-progress students) --
  console.log('· Phase 2: PA1 marks (classes 1–12)')
  const pa1 = await db.exam.findFirst({ where: { schoolId: school.id, name: 'Periodic Assessment 1' } })
  if (!pa1) throw new Error('Periodic Assessment 1 not found — run db:seed-teacher-academics first')
  const escForPa1 = await db.examSubjectConfig.findMany({ where: { examId: pa1.id } })
  const escByClass = new Map<string, typeof escForPa1>()
  for (const e of escForPa1) {
    escByClass.set(e.classId, [...(escByClass.get(e.classId) ?? []), e])
  }
  const csaTeacherByClassSubject = new Map<string, string>() // `${classId}|${subjectId}` → teacher USER id
  for (const csa of await db.classSubjectAssignment.findMany({ where: { schoolId: school.id } })) {
    csaTeacherByClassSubject.set(`${csa.classId}|${csa.subjectId}`, csa.teacherUserId ?? '')
  }
  const markedStudentIds = new Set(
    (await db.examMark.groupBy({ by: ['studentId'], where: { examId: pa1.id } })).map((g) => g.studentId),
  )
  const pa1MarkRows: {
    examId: string; classId: string; subjectId: string; studentId: string
    marksObtained: number; status: string; workflowStatus: string
    enteredBy: string | null; enteredAt: Date
    verifiedBy: string | null; verifiedAt: Date | null
  }[] = []
  for (const s of roster) {
    if (markedStudentIds.has(s.id)) continue
    const classId = s.class?.id
    if (!classId) continue
    const numeric = Number(s.class?.gradeLevel)
    if (!Number.isFinite(numeric)) continue // pre-primary: no formal exams
    const rnd = sr(hashOfString(s.admissionNo ?? s.id))
    const bias = (rnd() - 0.5) * 0.2
    for (const esc of escByClass.get(classId) ?? []) {
      const pct = Math.min(0.98, Math.max(0.4, 0.72 + bias + (rnd() - 0.5) * 0.18))
      const final = rnd() < 0.9
      const enteredAt = new Date('2026-07-20T10:00:00Z')
      const teacherUserId = csaTeacherByClassSubject.get(`${classId}|${esc.subjectId}`)
      const teacherName = teacherRows.find((t) => t.userId === teacherUserId)?.user.name ?? null
      pa1MarkRows.push({
        examId: pa1.id,
        classId,
        subjectId: esc.subjectId,
        studentId: s.id,
        marksObtained: Math.round(pct * esc.maxMarks),
        status: 'PRESENT',
        workflowStatus: final ? 'VERIFIED' : 'SUBMITTED',
        enteredBy: teacherName,
        enteredAt,
        verifiedBy: final ? principal?.id ?? null : null,
        verifiedAt: final ? new Date('2026-07-25T09:00:00Z') : null,
      })
    }
  }
  if (pa1MarkRows.length) await db.examMark.createMany({ data: pa1MarkRows })
  console.log(`  +${pa1MarkRows.length} PA1 marks (entered by the CSA teacher, verified by the principal)`)

  // ---- Phase 3: Half-Yearly Examination (September, declared) ------------
  console.log('· Phase 3: Half-Yearly Examination + marks')
  const halfYearlyName = 'Half-Yearly Examination'
  let hy = await db.exam.findFirst({ where: { schoolId: school.id, name: halfYearlyName } })
  if (hy) {
    await db.examMark.deleteMany({ where: { examId: hy.id } })
    await db.examSubjectConfig.deleteMany({ where: { examId: hy.id } })
    await db.examClass.deleteMany({ where: { examId: hy.id } })
    await db.examScheduleItem.deleteMany({ where: { examId: hy.id } })
    await db.exam.delete({ where: { id: hy.id } })
  }
  hy = await db.exam.create({
    data: {
      schoolId: school.id,
      name: halfYearlyName,
      term: 'Term 1',
      type: 'Term Exam',
      session: '2026-2027',
      startDate: new Date('2026-09-21'),
      endDate: new Date('2026-09-30'),
      status: 'COMPLETED',
      resultStatus: 'Declared',
      passPercentage: 33,
      declaredAt: new Date('2026-10-01'),
      declaredBy: principal?.id ?? null,
      createdBy: principal?.id ?? null,
    },
  })
  const hyMarkRows: {
    examId: string; classId: string; subjectId: string; studentId: string
    marksObtained: number | null; status: string; workflowStatus: string
    enteredBy: string | null; enteredAt: Date
    verifiedBy: string | null; verifiedAt: Date | null
    remarks: string | null
  }[] = []
  let hyEscCount = 0
  const hyClasses = new Set<string>()
  for (const csa of CSA_MATRIX) {
    const numeric = Number(csa.level)
    if (!Number.isFinite(numeric)) continue
    const examinable = SUBJECTS.find((x) => x.code === csa.code)?.examinable ?? true
    if (!examinable) continue
    const cls = classByLevel.get(csa.level)
    const subj = subjectByCode.get(csa.code)
    if (!cls || !subj) continue
    if (!hyClasses.has(cls.id)) {
      hyClasses.add(cls.id)
      await db.examClass.create({ data: { examId: hy.id, classId: cls.id } })
    }
    const maxMarks = numeric <= 5 ? 50 : 100
    await db.examSubjectConfig.create({
      data: {
        examId: hy.id, classId: cls.id, subjectId: subj.id,
        maxMarks, passMarks: Math.round(maxMarks * 0.33), theoryMarks: maxMarks, practicalMarks: 0,
      },
    })
    hyEscCount++
    // Schedule items — one paper per subject, spread across the window
    const dayOffset = (hyEscCount * 3) % 8
    await db.examScheduleItem.create({
      data: {
        examId: hy.id, classId: cls.id, subjectId: subj.id,
        date: new Date(`2026-09-${String(21 + dayOffset).padStart(2, '0')}`),
        startTime: '09:30', endTime: '12:00',
        room: cls.room,
        invigilatorId: teacherOfN(csa.teacherN).userId,
        invigilatorName: teacherOfN(csa.teacherN).user.name,
      },
    })
    // Marks for every student of the class
    const studentsOfClass = roster.filter((s) => s.class?.gradeLevel === csa.level)
    for (const s of studentsOfClass) {
      const rnd = sr(hashOfString(`${s.admissionNo}|HY|${csa.code}`))
      const bias = (rnd() - 0.5) * 0.22
      const pct = Math.min(0.97, Math.max(0.33, 0.7 + bias + (rnd() - 0.5) * 0.16))
      const roll = rnd()
      const teacherUserId = csaTeacherByClassSubject.get(`${cls.id}|${subj.id}`)
      const teacherName = teacherRows.find((t) => t.userId === teacherUserId)?.user.name ?? null
      hyMarkRows.push({
        examId: hy.id, classId: cls.id, subjectId: subj.id, studentId: s.id,
        marksObtained: roll < 0.03 ? null : Math.round(pct * maxMarks),
        status: roll < 0.03 ? 'ABSENT' : 'PRESENT',
        workflowStatus: roll < 0.03 ? 'VERIFIED' : roll < 0.12 ? 'SUBMITTED' : 'VERIFIED',
        enteredBy: teacherName,
        enteredAt: new Date('2026-10-01T11:00:00Z'),
        verifiedBy: roll < 0.12 ? null : principal?.id ?? null,
        verifiedAt: roll < 0.12 ? null : new Date('2026-10-01T15:00:00Z'),
        remarks: roll < 0.03 ? 'Absent — medical leave on record' : null,
      })
    }
  }
  if (hyMarkRows.length) await db.examMark.createMany({ data: hyMarkRows })
  console.log(`  ${hyEscCount} subject configs; +${hyMarkRows.length} marks (≈3% absent, ≈9% awaiting verification)`)

  // ---- Phase 4: Periodic Assessment 2 (December, Scheduled) --------------
  const pa2 = await db.exam.findFirst({ where: { schoolId: school.id, name: 'Periodic Assessment 2' } })
  if (!pa2) {
    await db.exam.create({
      data: {
        schoolId: school.id,
        name: 'Periodic Assessment 2',
        term: 'Term 2',
        type: 'Class Test',
        session: '2026-2027',
        startDate: new Date('2026-12-14'),
        endDate: new Date('2026-12-18'),
        status: 'Ongoing',
        resultStatus: 'Not Started',
        passPercentage: 33,
        createdBy: principal?.id ?? null,
      },
    })
    console.log('  +Periodic Assessment 2 (December, Scheduled — no marks yet)')
  }

  // ---- Phase 5: fees + payments + ledger (parity by construction) --------
  console.log('· Phase 5: fees / payments / FeeTransaction ledger (deterministic reset)')
  // Crash-safe + re-run-safe: the demo tenant's fee slice is RESET (the
  // ledger parity invariant below can only hold from a clean plant — a
  // partially-planted state from an interrupted run must not survive).
  await db.feeTransaction.deleteMany({ where: { schoolId: school.id } })
  await db.payment.deleteMany({ where: { schoolId: school.id } })
  await db.fee.deleteMany({ where: { schoolId: school.id } })
  const feeStudentIds = new Set<string>()
  // Canonical receipt scheme: SCH-YYYY-NNNNNN, sequential per school-year
  // (same invariant mintReceiptNo enforces on live writes).
  const receiptPrefix = `SCH-2026-`
  let receiptSeq = 1
  for (const r of await db.feeTransaction.findMany({
    where: { schoolId: school.id, receiptNo: { startsWith: receiptPrefix } },
    select: { receiptNo: true },
  })) {
    const n = Number(r.receiptNo?.slice(receiptPrefix.length))
    if (Number.isFinite(n) && n >= receiptSeq) receiptSeq = n + 1
  }
  const nextReceiptNo = () => `${receiptPrefix}${String(receiptSeq++).padStart(6, '0')}`
  const methods = ['CASH', 'UPI', 'NET_BANKING'] as const

  let feesCreated = 0
  let ledgerCreated = 0
  const feeRow = async (
    student: typeof roster[number],
    title: string,
    amount: number,
    shape: 'PAID' | 'PARTIAL' | 'UNPAID' | 'PENDING_VERIFY',
    dueDate: Date,
    partialFraction: number,
    paidDate: Date,
    feeType: string,
  ) => {
    const seq = seqOf.get(student.id) ?? 1
    const rnd = sr(seq * 2038074743 + hashOfString(title))
    const paidAmount =
      shape === 'PAID' ? amount : shape === 'PARTIAL' ? Math.round(amount * partialFraction) : 0
  // Distinct reference per (student, fee head + term) — the Term 1 and
  // Term 2 tuition fees of the same student must never collide.
  const termCode = title.includes('Term 2') ? 'T2' : title.includes('Term 1') ? 'T1' : ''
  const txnRef = `HHS-${student.admissionNo}-${feeType.slice(0, 3).toUpperCase()}${termCode ? '-' + termCode : ''}`
    const fee = await db.fee.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        title,
        amount,
        paid: paidAmount,
        type: feeType,
        dueDate,
        status: shape === 'PAID' ? 'PAID' : shape === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
        method: paidAmount > 0 ? pick(rnd, [...methods]) : null,
        paidDate: paidAmount > 0 ? paidDate : null,
      },
    })
    feesCreated++
    if (paidAmount > 0) {
      const method = pick(rnd, [...methods])
      await db.payment.create({
        data: {
          schoolId: school.id,
          feeId: fee.id,
          amount: paidAmount,
          method,
          status: 'SUCCESS',
          transactionId: txnRef,
          note: `${title} collection`,
          createdAt: paidDate,
        },
      })
      await db.feeTransaction.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          className: student.class?.name ?? '',
          feeId: fee.id,
          feeHeadName: title,
          amount: paidAmount,
          method,
          status: 'SUCCESS',
          source: 'PRINCIPAL',
          collectedById: management?.id ?? principal?.id ?? null,
          collectedByName: management?.name ?? principal?.name ?? 'School Office',
          collectedAt: paidDate,
          verifiedById: management?.id ?? principal?.id ?? null,
          verifiedByName: management?.name ?? principal?.name ?? 'School Office',
          verifiedAt: paidDate,
          referenceNumber: txnRef,
          receiptNo: nextReceiptNo(),
        },
      })
      ledgerCreated++
    }
    return fee
  }

  for (const s of roster) {
    if (feeStudentIds.has(s.id)) continue
    const def = rosterDefByEmail.get(s.user?.email ?? '')
    const level = s.class?.gradeLevel ?? '6'
    const stage = feeStageFor(level)
    const seq = seqOf.get(s.id) ?? 1
    const shape = feeShapeFor(seq)
    const partialFraction = shape.partialFraction

    // Annual Charges — billed April, due 15 April (₹2,000–4,000)
    await feeRow(s, 'Annual Charges — 2026-27', stage.annual, shape.annual === 'PAID' ? 'PAID' : 'UNPAID', new Date('2026-04-15'), partialFraction, new Date('2026-04-12'), 'ANNUAL')
    // Tuition Fee — Term 1 (April–July), due 10 July
    await feeRow(s, 'Tuition Fee — Term 1', stage.tuitionTerm, shape.tuitionT1 === 'PAID' || shape.tuitionT1 === 'PARTIAL' ? shape.tuitionT1 : 'UNPAID', new Date('2026-07-10'), partialFraction, new Date('2026-07-08'), 'TUITION')
    // Examination Fee — Term 1, due 1 September
    await feeRow(s, 'Examination Fee — Term 1', stage.examTerm, shape.examT1 === 'PAID' ? 'PAID' : 'UNPAID', new Date('2026-09-01'), partialFraction, new Date('2026-08-28'), 'EXAM')
    // Tuition Fee — Term 2 (Aug–Nov), billed October, due 10 November
    await feeRow(s, 'Tuition Fee — Term 2', stage.tuitionTerm, shape.tuitionT2 === 'PARTIAL' ? 'PARTIAL' : 'UNPAID', new Date('2026-11-10'), partialFraction, new Date('2026-10-01'), 'TUITION')

    // The PENDING_VERIFY shape: a class-teacher cash collection awaiting
    // principal verification (linked to the student's oldest open fee so
    // the verify flow credits the ledger exactly).
    if (shape.examT1 === 'PENDING_VERIFY') {
      const openFee = await db.fee.findFirst({
        where: { studentId: s.id, status: { in: ['UNPAID', 'PARTIAL', 'PENDING'] } },
        orderBy: { createdAt: 'asc' },
      })
      const openOutstanding = openFee ? Number(openFee.amount) - Number(openFee.paid) : 0
      if (openFee && openOutstanding > 0) {
        const ctAmount = Math.min(Math.round(openOutstanding * 0.5), 2000)
        const classTeacherLevel = s.class?.gradeLevel ?? '6'
        const ctTeacherName = classTeacherNameByLevel.get(classTeacherLevel) ?? 'Class Teacher'
        const ctUser = teacherRows.find((t) => (t.user.name ?? '') === ctTeacherName)
        await db.feeTransaction.create({
          data: {
            schoolId: school.id,
            studentId: s.id,
            className: s.class?.name ?? '',
            feeId: openFee.id,
            feeHeadName: openFee.title,
            amount: ctAmount,
            method: 'CASH',
            status: 'UNDER_VERIFICATION',
            source: 'CLASS_TEACHER',
            collectedById: ctUser?.userId ?? null,
            collectedByName: ctUser?.user.name ?? ctTeacherName,
            collectedAt: new Date(Date.now() - 2 * 86400000),
            referenceNumber: `HHS-CT-${s.admissionNo}`,
          },
        })
      }
    }
    void def
  }
  console.log(`  +${feesCreated} fees, +${ledgerCreated} verified ledger transactions (+UNDER_VERIFICATION CT rows)`)

  // ---- Phase 6: behavior + growth (dedupeKey-gated) ----------------------
  console.log('· Phase 6: behavior records + growth events')
  if (behaviorCats.length) {
    const positives = behaviorCats.filter((c) => c.kind === 'positive')
    const concerns = behaviorCats.filter((c) => c.kind === 'concern')
    const neutrals = behaviorCats.filter((c) => c.kind === 'any')
    const hubTeacher = teacherOfN(1) // Mrs. Kavita Singh — the hub corpus teacher
    const existingGrowth = new Set(
      (await db.growthEvent.findMany({
        where: { schoolId: school.id, dedupeKey: { startsWith: 'r150:' } },
        select: { studentId: true },
      })).map((g) => g.studentId),
    )
    let behaviorCount = 0
    for (let i = 0; i < roster.length; i += 5) {
      const s = roster[i]
      if (existingGrowth.has(s.id)) continue
      const rnd = sr((seqOf.get(s.id) ?? 1) * 32452843)
      const roll = rnd()
      const type = roll < 0.5 ? 'positive' : roll < 0.8 ? 'observation' : 'concern'
      const cat =
        type === 'positive'
          ? pick(rnd, positives.length ? positives : behaviorCats)
          : type === 'concern'
            ? pick(rnd, concerns.length ? concerns : behaviorCats)
            : pick(rnd, neutrals.length ? neutrals : behaviorCats)
      const date = new Date(Date.now() - pickI(rnd, 3, 50) * 86400000)
      await db.behaviorRecord.create({
        data: {
          schoolId: school.id,
          studentId: s.id,
          recordedById: hubTeacher.userId,
          date,
          category: cat.key,
          type,
          description:
            type === 'positive'
              ? pick(rnd, [
                  'Helped organise the class science corner.',
                  'Outstanding participation in the inter-house quiz.',
                  'Volunteered for the library reading period.',
                  'Led the group project presentation confidently.',
                ])
              : type === 'concern'
                ? pick(rnd, [
                    'Repeatedly late to the first period this week.',
                    'Incomplete homework in Mathematics.',
                    'Distracting classmates during the practical.',
                  ])
                : pick(rnd, [
                    'Quiet in class; encouraging peer interaction.',
                    'Improving steadily in written expression.',
                  ]),
          actionTaken: type === 'concern' ? 'Spoke with the student; parent meeting suggested.' : null,
          followUpRequired: type === 'concern' && rnd() < 0.5,
          followUpDate: type === 'concern' ? new Date(Date.now() + 7 * 86400000) : null,
          status: type === 'concern' ? (rnd() < 0.5 ? 'monitoring' : 'resolved') : 'resolved',
          parentNotified: type === 'concern' && rnd() < 0.6,
        },
      })
      await db.growthEvent.create({
        data: {
          schoolId: school.id,
          studentId: s.id,
          createdById: hubTeacher.userId,
          points: type === 'positive' ? pickI(rnd, 2, 5) : type === 'concern' ? -2 : 1,
          category: type === 'positive' ? 'PARTICIPATION' : type === 'concern' ? 'CONDUCT' : 'IMPROVEMENT',
          reason: cat.label,
          source: 'MANUAL',
          dedupeKey: `r150:${s.id}`,
          effectiveAt: date,
          status: 'ACTIVE',
        },
      }).catch(() => {/* dedupeKey conflict — already exists */})
      behaviorCount++
    }
    console.log(`  +${behaviorCount} behavior records + growth events`)
  }

  // ---- Phase 6b: homework corpus (classes 1–12, CSA-teacher authored) --
  console.log('· Phase 6b: homework + submissions')
  const hwExisting = await db.homework.findMany({
    where: { schoolId: school.id, title: { startsWith: 'HW:' } },
    select: { id: true },
  })
  if (hwExisting.length === 0) {
    const HW_SPECS: { level: string; code: string; title: string; topic: string; daysAgo: number; dueInDays: number; maxMarks: number }[] = [
      { level: '1', code: 'ENG', title: 'HW: Alphabet practice — A to L', topic: 'Small letters writing practice', daysAgo: 2, dueInDays: 1, maxMarks: 10 },
      { level: '3', code: 'MAT', title: 'HW: Addition worksheet 4', topic: 'Two-digit addition with carry', daysAgo: 3, dueInDays: 0, maxMarks: 10 },
      { level: '5', code: 'EVS', title: 'HW: Our village — draw a map', topic: 'Mapping Prithvipur landmarks', daysAgo: 4, dueInDays: 2, maxMarks: 15 },
      { level: '7', code: 'SCI', title: 'HW: Nutrition in plants', topic: 'Photosynthesis diagram + questions', daysAgo: 2, dueInDays: 1, maxMarks: 20 },
      { level: '8', code: 'HIN', title: 'HW: निबंध — मेरा विद्यालय', topic: '150 शब्दों में निबंध लिखिए', daysAgo: 5, dueInDays: 1, maxMarks: 20 },
      { level: '9', code: 'MAT', title: 'HW: Polynomials — exercise 2.3', topic: 'Remainder theorem problems', daysAgo: 2, dueInDays: 1, maxMarks: 25 },
      { level: '10', code: 'SCI', title: 'HW: Light — reflection problems', topic: 'Mirror formula numericals', daysAgo: 3, dueInDays: 2, maxMarks: 25 },
      { level: '11', code: 'PHY', title: 'HW: Units and measurements', topic: 'Dimensional analysis set', daysAgo: 2, dueInDays: 1, maxMarks: 30 },
      { level: '12', code: 'CHE', title: 'HW: Solutions — colligative properties', topic: 'Raoult\'s law numericals', daysAgo: 4, dueInDays: 2, maxMarks: 30 },
    ]
    for (const spec of HW_SPECS) {
      const cls = classByLevel.get(spec.level)
      const subj = subjectByCode.get(spec.code)
      if (!cls || !subj) continue
      const csa = csaTeacherByClassSubject.get(`${cls.id}|${subj.id}`)
      const teacherUser2 = teacherRows.find((t) => t.userId === csa)
      const hw = await db.homework.create({
        data: {
          schoolId: school.id,
          title: spec.title,
          description: spec.topic,
          classId: cls.id,
          subjectId: subj.id,
          teacherId: teacherUser2?.userId ?? null,
          teacherName: teacherUser2?.user.name ?? null,
          topic: spec.topic,
          maxMarks: spec.maxMarks,
          gradingType: 'marks',
          assignedDate: daysAgoOf(spec.daysAgo),
          dueDate: daysAgoOf(-spec.dueInDays),
          status: 'PUBLISHED',
          publishedAt: daysAgoOf(spec.daysAgo),
          createdBy: teacherUser2?.userId ?? null,
        },
      })
      void hw
    }
    console.log(`  +${HW_SPECS.length} homework assignments (CSA teachers, classes 1–12)`)
  }

  // ---- Phase 7: messaging (role-pair threads with unread accounting) ----
  console.log('· Phase 7: messaging threads')
  const messageCount = await db.message.count({ where: { schoolId: school.id } })
  if (messageCount === 0) {
    const featured = roster.find(
      (s) => s.class?.gradeLevel === DEMO_STUDENT_POSITION.level && s.rollNo === '01',
    )
    const featuredGuardian = featured?.guardianId
      ? await db.user.findUnique({ where: { id: featured.guardianId } })
      : null
    const mathTeacher = teacherOfN(9) // Ajay — the featured student's Math teacher
    const hubTeacher = teacherOfN(1)
    const threads: { senderId: string; recipientId: string; subject: string; body: string; read: boolean; daysAgo: number }[] = []
    if (featured && featuredGuardian) {
      threads.push(
        {
          senderId: featuredGuardian.id, recipientId: mathTeacher.userId,
          subject: "Aman's Mathematics practice at home",
          body: 'Namaste Sir, Aman ke Maths mein sudhaar ho raha hai. Kuchh aur practice books ki salah dijiye.',
          read: true, daysAgo: 6,
        },
        {
          senderId: mathTeacher.userId, recipientId: featuredGuardian.id,
          subject: "Aman's Mathematics practice at home",
          body: 'Namaste. Aman is doing well. I have shared extra worksheets — 20 minutes of daily practice will be enough before the Half-Yearly.',
          read: true, daysAgo: 5,
        },
        {
          senderId: featuredGuardian.id, recipientId: mathTeacher.userId,
          subject: "Aman's Mathematics practice at home",
          body: 'Dhanyavaad Sir. Wo Half-Yearly ki taiyari kar raha hai.',
          read: false, daysAgo: 3,
        },
      )
    }
    // Parent → class teacher (1-A): leave note
    const classOneStudent = roster.find((s) => s.class?.gradeLevel === '1')
    if (classOneStudent?.guardianId) {
      const guardian = await db.user.findUnique({ where: { id: classOneStudent.guardianId } })
      if (guardian) {
        threads.push({
          senderId: guardian.id, recipientId: hubTeacher.userId,
          subject: 'Leave application for 2 days',
          body: 'Namaste, hamare ghar mein shadi hai isliye humare bachche ko 2 din (somvar-mangalwar) chhutti chahiye. Dhanyavaad.',
          read: false, daysAgo: 2,
        })
      }
    }
    // Teacher → principal: facilities
    const principalUser = await db.user.findFirst({ where: { role: 'PRINCIPAL', schoolId: school.id } })
    const sciTeacher = teacherOfN(10)
    if (principalUser) {
      threads.push({
        senderId: sciTeacher.userId, recipientId: principalUser.id,
        subject: 'Science lab equipment for Class 9-10 practicals',
        body: 'Ma\'am, the Class 9 and 10 Science practicals need a few new beakers and a microscope lamp before the December assessments. Requesting approval for purchase from the science fund.',
        read: false, daysAgo: 1,
      })
    }
    for (const t of threads) {
      await db.message.create({
        data: {
          schoolId: school.id,
          senderId: t.senderId,
          recipientId: t.recipientId,
          subject: t.subject,
          body: t.body,
          read: t.read,
          createdAt: new Date(Date.now() - t.daysAgo * 86400000),
        },
      })
    }
    console.log(`  +${threads.length} messages across 3 role-pair threads (unread accounting live)`)
  } else {
    console.log(`  ${messageCount} messages already present — skipped`)
  }

  // ---- Validation summary -------------------------------------------------
  const [students, classes2, attendance, marks, fees, txns, behavior, growth, messages] = await Promise.all([
    db.student.count({ where: { schoolId: school.id } }),
    db.class.count({ where: { schoolId: school.id } }),
    db.attendance.count({ where: { schoolId: school.id } }),
    db.examMark.count({ where: { exam: { schoolId: school.id } } }),
    db.fee.count({ where: { schoolId: school.id } }),
    db.feeTransaction.count({ where: { schoolId: school.id } }),
    db.behaviorRecord.count({ where: { schoolId: school.id } }),
    db.growthEvent.count({ where: { schoolId: school.id } }),
    db.message.count({ where: { schoolId: school.id } }),
  ])
  // Ledger parity — the invariant dashboards depend on.
  const [feePaidAgg, ledgerAgg] = await Promise.all([
    db.fee.aggregate({ where: { schoolId: school.id }, _sum: { paid: true } }),
    db.feeTransaction.aggregate({ where: { schoolId: school.id, status: 'SUCCESS' }, _sum: { amount: true } }),
  ])
  const feePaid = Number(feePaidAgg._sum.paid ?? 0)
  const ledgerSum = Number(ledgerAgg._sum.amount ?? 0)
  console.log('\n✅ Hawkings history ready:')
  console.log(`   students=${students} classes=${classes2} attendance=${attendance} marks=${marks}`)
  console.log(`   fees=${fees} ledger=${txns} behavior=${behavior} growth=${growth} messages=${messages}`)
  console.log(`   ledger parity: Fee.paid=${feePaid} vs SUCCESS ledger=${ledgerSum} ${feePaid === ledgerSum ? '✓ MATCH' : '✗ MISMATCH'}`)
}

main()
  .catch((e) => {
    console.error('seed-roster FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
