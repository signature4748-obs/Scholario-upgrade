// ============================================================
// seed-student-dashboard — SD-1 demo seed for Student Dashboard V2
// (Demo School of Scholario).
//
// Seeds REAL rows through the actual database models so the student
// dashboard's server-side aggregation has a complete, realistic demo —
// the same data architecture a production school would use:
//
//   · 6 examinable subjects for Grade 9-A (3 exist; 3 added)
//   · a full Mon–Sat timetable for the class (Timetable rows with
//     period times, real teacher names, rooms)
//   · ~10 weeks of attendance for the authenticated demo student
//     (≈96%, one late, two absences — marked by the class teacher)
//   · the Mid-Term Examination declared (fixed to coherent 2026 dates)
//     with results for the demo student + 5 classmates → an HONEST
//     class rank; plus an upcoming Unit Test 2 for the Up Next queue
//   · a realistic fee ledger: two paid terms with Payment rows and two
//     upcoming dues with future due dates
//   · teacher→student messages (2 unread, 1 read)
//   · two student-relevant school notices (one HIGH priority)
//
// Idempotent: every section is replaced on each run for THIS school /
// THIS student only (other schools' rows are never touched).
//
// Run: bun run db:seed-dashboard   (or: bun prisma/seed-student-dashboard.ts)
// ============================================================

import { db } from '../src/lib/db'
import { mintReceiptNo } from '../src/lib/fee-workflow'

// ─── Helpers ────────────────────────────────────────────────────────

function gradeFor(marks: number, total: number): string {
  const pct = (marks / total) * 100
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B+'
  if (pct >= 60) return 'B'
  if (pct >= 50) return 'C'
  if (pct >= 33) return 'D'
  return 'F'
}

const DAY_MS = 86_400_000
const _iso = (d: Date) => d.toISOString()
const daysAgo = (n: number, h = 9) => new Date(new Date().getTime() - n * DAY_MS - (new Date().getHours() - h) * 3600_000)
const daysAhead = (n: number) => new Date(new Date().getTime() + n * DAY_MS)

// ─── Seed ───────────────────────────────────────────────────────────

async function main() {
  const school = await db.school.findFirst({ where: { slug: 'demo-school' } })
  if (!school) throw new Error('Demo school not found — run the base seed first.')
  const user = await db.user.findFirst({ where: { email: 'student1@demoschool.edu' } })
  if (!user) throw new Error('Demo student user not found.')
  const student = await db.student.findUnique({ where: { userId: user.id }, include: { class: true } })
  if (!student || !student.class) throw new Error('Demo student has no class — run the base seed first.')
  const cls = student.class
  console.log(`Seeding dashboard demo for ${user.name} · ${cls.name} · roll ${student.rollNo}`)

  // Teacher users (real Teacher rows → their login users)
  const teacherRows = await db.teacher.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, name: true } } },
  })
  const teacherUsers = teacherRows.filter((t) => t.user)
  const classTeacherUser =
    (cls.classTeacherId ? await db.user.findUnique({ where: { id: cls.classTeacherId } }) : null) ??
    teacherUsers[0]?.user ?? null
  console.log(`Teachers available: ${teacherUsers.map((t) => t.user!.name).join(', ')}`)

  // ── 1. Subjects for the class (legacy classId linkage — same as the
  //       existing Mathematics/Physics/English rows) ─────────────────
  const WANTED_SUBJECTS = [
    'Mathematics', 'Physics', 'English', 'Chemistry', 'Biology', 'Social Science', 'Hindi',
  ] as const
  for (const name of WANTED_SUBJECTS) {
    const exists = await db.subject.findFirst({ where: { schoolId: school.id, name, classId: cls.id } })
    if (!exists) {
      await db.subject.create({ data: { schoolId: school.id, name, classId: cls.id } })
      console.log(`  + subject ${name}`)
    }
  }
  const subjects = await db.subject.findMany({ where: { schoolId: school.id, classId: cls.id } })
  const subjectId = (name: string) => subjects.find((s) => s.name === name)?.id ?? null

  // ── 2. Timetable (Mon–Sat × 7 teaching periods, canonical times) ──
  const PERIODS: { period: number; start: string; end: string }[] = [
    { period: 1, start: '08:30', end: '09:15' },
    { period: 2, start: '09:15', end: '10:00' },
    { period: 3, start: '10:00', end: '10:45' },
    { period: 4, start: '11:00', end: '11:45' },
    { period: 5, start: '11:45', end: '12:30' },
    { period: 6, start: '13:15', end: '14:00' },
    { period: 7, start: '14:00', end: '14:45' },
  ]
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
  // Teacher assignments per subject (real names of this school's staff)
  const STAFF: Record<string, string> = {
    Mathematics: 'Rohan Mehta',
    Physics: 'Mrs. Kavita Sharma',
    Chemistry: 'Mrs. Kavita Sharma',
    Biology: 'Ms. Priya Iyer',
    English: 'Ms. Priya Iyer',
    'Social Science': 'Mr. Arjun Nair',
    Hindi: 'Mr. Arjun Nair',
  }
  const ROOMS: Record<string, string> = {
    Mathematics: 'Room 101',
    Physics: 'Room 101',
    Chemistry: 'Chemistry Lab',
    Biology: 'Biology Lab',
    English: 'Room 102',
    'Social Science': 'Room 102',
    Hindi: 'Room 103',
  }
  // Weekly rotation: every day has Mathematics + English; the rest rotate.
  const GRID: Record<(typeof DAYS)[number], string[]> = {
    Monday: ['Mathematics', 'Physics', 'English', 'Mathematics', 'Chemistry', 'Social Science', 'Hindi'],
    Tuesday: ['Mathematics', 'English', 'Chemistry', 'Physics', 'Biology', 'Hindi', 'Social Science'],
    Wednesday: ['Mathematics', 'Biology', 'English', 'Social Science', 'Physics', 'Chemistry', 'Hindi'],
    Thursday: ['Mathematics', 'Chemistry', 'Social Science', 'English', 'Mathematics', 'Physics', 'Biology'],
    Friday: ['Mathematics', 'English', 'Hindi', 'Biology', 'Chemistry', 'Social Science', 'Physics'],
    Saturday: ['Mathematics', 'Physics', 'Social Science', 'Hindi', 'English', 'Biology', 'Chemistry'],
  }
  await db.timetable.deleteMany({ where: { schoolId: school.id, classId: cls.id } })
  const timetableData: {
    schoolId: string; classId: string; subjectId: string | null; day: string
    period: number; startTime: string; endTime: string; teacherName: string; room: string
  }[] = []
  for (const day of DAYS) {
    GRID[day].forEach((subject, i) => {
      timetableData.push({
        schoolId: school.id,
        classId: cls.id,
        subjectId: subjectId(subject),
        day,
        period: PERIODS[i].period,
        startTime: PERIODS[i].start,
        endTime: PERIODS[i].end,
        teacherName: STAFF[subject] ?? teacherUsers[0]?.user?.name ?? 'Faculty',
        room: ROOMS[subject] ?? 'Room 101',
      })
    })
  }
  await db.timetable.createMany({ data: timetableData })
  console.log(`  + timetable ${DAYS.length} days × ${PERIODS.length} periods`)

  // ── 3. Attendance — the last 10 school weeks (Mon–Sat, no Sundays) ─
  await db.attendance.deleteMany({ where: { studentId: student.id } })
  const today = new Date()
  const attendanceRows: { date: Date; status: string }[] = []
  // Start 10 weeks back on a Monday
  const start = new Date(today.getTime() - 70 * DAY_MS)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // back to Monday
  for (let d = new Date(start); d < today; d = new Date(d.getTime() + DAY_MS)) {
    if (d.getDay() === 0) continue // Sunday — no school
    // PIH-4b integrity: anchor every attendance date to midnight UTC (the
    // canonical day key) so the (studentId, date) day-level uniqueness
    // holds — never a time-of-day date.
    attendanceRows.push({ date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), status: 'PRESENT' })
  }
  // Honest imperfections: 1 LATE, 2 ABSENT spread across the window
  if (attendanceRows.length > 20) {
    attendanceRows[attendanceRows.length - 3].status = 'ABSENT'
    attendanceRows[Math.floor(attendanceRows.length / 2)].status = 'LATE'
    attendanceRows[Math.floor(attendanceRows.length / 3)].status = 'ABSENT'
  }
  for (const row of attendanceRows) {
    await db.attendance.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        classId: cls.id,
        date: row.date,
        status: row.status,
        // Canonical provenance convention: the class teacher's DISPLAY
        // NAME (same as /api/teacher/class-attendance baseline writes),
        // never a User id.
        markedBy: classTeacherUser?.name ?? null,
      },
    })
  }
  const pct = Math.round(
    ((attendanceRows.filter((r) => r.status !== 'ABSENT').length) / attendanceRows.length) * 1000,
  ) / 10
  console.log(`  + attendance ${attendanceRows.length} days (${pct}%)`)

  // ── 4. Exams + results (Mid-Term declared + Unit Test 2 upcoming) ──
  let midTerm = await db.exam.findFirst({ where: { schoolId: school.id, name: 'Mid-Term Examination' } })
  if (!midTerm) {
    midTerm = await db.exam.create({
      data: {
        schoolId: school.id,
        name: 'Mid-Term Examination',
        classId: cls.id,
        term: 'TERM1',
        type: 'Mid Term',
        session: '2026-2027',
      },
    })
  }
  await db.exam.update({
    where: { id: midTerm.id },
    data: {
      startDate: daysAgo(17),
      endDate: daysAgo(11),
      status: 'COMPLETED',
      resultStatus: 'Declared',
      declaredAt: daysAgo(6),
      declaredBy: teacherUsers[0]?.user?.id ?? null,
    },
  })
  // Upcoming assessment (real future exam → the Up Next queue's source).
  // A stale pre-existing "Unit Test 2" row (past dates) is UPDATED to a
  // coherent future schedule instead of being duplicated.
  const existingUT = await db.exam.findFirst({ where: { schoolId: school.id, name: 'Unit Test 2' } })
  if (existingUT) {
    await db.exam.update({
      where: { id: existingUT.id },
      data: {
        classId: cls.id,
        term: 'TERM1',
        type: 'Unit Test',
        session: '2026-2027',
        startDate: daysAhead(7),
        endDate: daysAhead(8),
        status: 'SCHEDULED',
        resultStatus: 'Not Started',
        declaredAt: null,
      },
    })
  } else {
    await db.exam.create({
      data: {
        schoolId: school.id,
        name: 'Unit Test 2',
        classId: cls.id,
        term: 'TERM1',
        type: 'Unit Test',
        session: '2026-2027',
        startDate: daysAhead(7),
        endDate: daysAhead(8),
        status: 'SCHEDULED',
        resultStatus: 'Not Started',
      },
    })
  }

  // Classmates (same class roster) — their results make the class rank
  // an HONEST derivation instead of a display constant.
  const classmates = await db.student.findMany({
    where: { schoolId: school.id, classId: cls.id, id: { not: student.id } },
    take: 5,
  })
  const MARKS: Record<string, number[]> = {
    //                       Math  Phy  Chem Eng  Bio  SocSci
    [student.id]: [94, 89, 87, 93, 90, 92], // → 90.8%
    ...(classmates[0] ? { [classmates[0].id]: [92, 93, 88, 94, 91, 90] } : {}), // 91.3%
    ...(classmates[1] ? { [classmates[1].id]: [95, 90, 89, 91, 93, 95] } : {}), // 92.2%
    ...(classmates[2] ? { [classmates[2].id]: [88, 85, 82, 90, 87, 89] } : {}), // 86.8%
    ...(classmates[3] ? { [classmates[3].id]: [90, 86, 84, 89, 86, 88] } : {}), // 87.2%
    ...(classmates[4] ? { [classmates[4].id]: [85, 82, 80, 86, 83, 84] } : {}), // 83.3%
  }
  const SUBJECT_ORDER = ['Mathematics', 'Physics', 'Chemistry', 'English', 'Biology', 'Social Science']
  await db.result.deleteMany({ where: { examId: midTerm.id } })
  for (const [sid, marks] of Object.entries(MARKS)) {
    for (let i = 0; i < SUBJECT_ORDER.length; i++) {
      const subject = subjectId(SUBJECT_ORDER[i])
      if (!subject) continue
      await db.result.create({
        data: {
          studentId: sid,
          examId: midTerm.id,
          subjectId: subject,
          marks: marks[i],
          totalMarks: 100,
          grade: gradeFor(marks[i], 100),
        },
      })
    }
  }
  console.log(`  + results: ${Object.keys(MARKS).length} students × ${SUBJECT_ORDER.length} subjects`)

  // ── 5. Fees — paid history + two upcoming dues ────────────────────
  const oldFees = await db.fee.findMany({ where: { studentId: student.id }, select: { id: true } })
  if (oldFees.length) {
    await db.payment.deleteMany({ where: { feeId: { in: oldFees.map((f) => f.id) } } })
    await db.fee.deleteMany({ where: { studentId: student.id } })
  }
  // PIH-4b parity: the ledger reset must clear this student's canonical
  // FeeTransaction rows too — otherwise a re-run leaves SUCCESS rows with
  // dangling fee links and SUM(FeeTransaction) drifts above SUM(Fee.paid).
  await db.feeTransaction.deleteMany({ where: { studentId: student.id } })
  const paid1 = await db.fee.create({
    data: {
      schoolId: school.id, studentId: student.id, title: 'Tuition Fee — Term 1',
      amount: 18000, paid: 18000, type: 'TUITION', status: 'PAID', method: 'UPI',
      dueDate: daysAgo(45), paidDate: daysAgo(42),
    },
  })
  await db.payment.create({
    // Phase 3: Payment.schoolId is required — derived from the fee.
    data: { schoolId: paid1.schoolId, feeId: paid1.id, amount: 18000, method: 'UPI', status: 'SUCCESS', transactionId: 'pay-demo-t1', note: 'Term 1 tuition' },
  })
  // PIH-4b parity: the canonical FeeTransaction mirror (server-minted
  // receipt, same as the live write paths) keeps Fee.paid and the ledger
  // equal from the first seed.
  await db.feeTransaction.create({
    data: {
      schoolId: paid1.schoolId, studentId: student.id, studentName: user.name,
      className: cls.name, feeId: paid1.id, feeHeadName: paid1.title,
      amount: 18000, method: 'UPI', status: 'SUCCESS', source: 'SCHOOL_OFFICE',
      collectedByName: 'School Office', collectedAt: paid1.paidDate ?? undefined,
      verifiedAt: paid1.paidDate ?? undefined,
      receiptNo: await mintReceiptNo(paid1.schoolId), note: 'Term 1 tuition',
      createdAt: paid1.paidDate ?? undefined, updatedAt: paid1.paidDate ?? undefined,
    },
  })
  const paid2 = await db.fee.create({
    data: {
      schoolId: school.id, studentId: student.id, title: 'Tuition Fee — Term 2',
      amount: 18000, paid: 18000, type: 'TUITION', status: 'PAID', method: 'BANK_TRANSFER',
      dueDate: daysAgo(15), paidDate: daysAgo(12),
    },
  })
  await db.payment.create({
    // Phase 3: Payment.schoolId is required — derived from the fee.
    data: { schoolId: paid2.schoolId, feeId: paid2.id, amount: 18000, method: 'BANK_TRANSFER', status: 'SUCCESS', transactionId: 'pay-demo-t2', note: 'Term 2 tuition' },
  })
  await db.feeTransaction.create({
    data: {
      schoolId: paid2.schoolId, studentId: student.id, studentName: user.name,
      className: cls.name, feeId: paid2.id, feeHeadName: paid2.title,
      amount: 18000, method: 'BANK_TRANSFER', status: 'SUCCESS', source: 'SCHOOL_OFFICE',
      collectedByName: 'School Office', collectedAt: paid2.paidDate ?? undefined,
      verifiedAt: paid2.paidDate ?? undefined,
      receiptNo: await mintReceiptNo(paid2.schoolId), note: 'Term 2 tuition',
      createdAt: paid2.paidDate ?? undefined, updatedAt: paid2.paidDate ?? undefined,
    },
  })
  await db.fee.create({
    data: {
      schoolId: school.id, studentId: student.id, title: 'Transport Fee — October',
      amount: 4500, paid: 0, type: 'TRANSPORT', status: 'UNPAID', dueDate: daysAhead(6),
    },
  })
  await db.fee.create({
    data: {
      schoolId: school.id, studentId: student.id, title: 'Examination Fee — Unit Test 2',
      amount: 900, paid: 0, type: 'EXAM', status: 'UNPAID', dueDate: daysAhead(13),
    },
  })
  console.log('  + fees: 2 paid (Payment + canonical FeeTransaction rows) + 2 due (₹5,400 outstanding)')

  // ── 6. Messages — teacher → student (2 unread, 1 read) ────────────
  await db.message.deleteMany({ where: { OR: [{ recipientId: user.id }, { senderId: user.id }] } })
  const mathTeacher = teacherUsers.find((t) => t.user!.name === 'Rohan Mehta')?.user ?? classTeacherUser
  if (mathTeacher) {
    await db.message.create({
      data: {
        schoolId: school.id, senderId: mathTeacher.id, recipientId: user.id,
        subject: 'Mathematics — pre-board revision plan',
        body: 'Hi Aarav, your Unit Test 2 revision plan is ready. Focus on chapters 4–6 (quadratics and coordinate geometry) first — your strongest areas are algebra, so lock those marks in early. I have shared practice sheets in the Learning section. Bring your doubts to Thursday\'s doubt-clearing session.',
        read: false, createdAt: daysAgo(2, 10),
      },
    })
  }
  if (classTeacherUser) {
    await db.message.create({
      data: {
        schoolId: school.id, senderId: classTeacherUser.id, recipientId: user.id,
        subject: 'Science fair — team confirmation',
        body: 'Your team\'s science fair registration is confirmed for the last Friday of this month. Please collect the project guidelines from the science lab and confirm your table requirements with me by Wednesday.',
        read: false, createdAt: daysAgo(1, 14),
      },
    })
    await db.message.create({
      data: {
        schoolId: school.id, senderId: classTeacherUser.id, recipientId: user.id,
        subject: 'Parent-teacher meeting — schedule',
        body: 'The term 1 parent-teacher meeting is scheduled for this Saturday, 10:00 AM – 1:00 PM. Your slot with me is 10:30 AM. Please inform your parents and bring your term 1 notebook set.',
        read: true, createdAt: daysAgo(6, 9),
      },
    })
  }
  console.log('  + messages: 2 unread + 1 read')

  // ── 7. School notices (student-relevant, one HIGH priority) ───────
  // Idempotency: exact titles (no visible markers — these rows also feed
  // the existing /api/student/notices route), plus a one-time cleanup of
  // the earlier marker-prefixed versions of this seed.
  const NOTICE_TITLES = [
    'Unit Test 2 — timetable released',
    'Science fair — registration closes Friday',
  ]
  const legacy = await db.notification.findMany({ where: { schoolId: school.id, title: { startsWith: 'SD-SEED:' } }, select: { id: true } })
  const toDelete = [
    ...legacy.map((r) => r.id),
    ...(await db.notification.findMany({ where: { schoolId: school.id, title: { in: NOTICE_TITLES } }, select: { id: true } })).map((r) => r.id),
  ]
  if (toDelete.length) {
    await db.notificationRead.deleteMany({ where: { notificationId: { in: toDelete } } })
    await db.notification.deleteMany({ where: { id: { in: toDelete } } })
  }
  await db.notification.create({
    data: {
      schoolId: school.id,
      title: 'Unit Test 2 — timetable released',
      message: 'Unit Test 2 begins next Monday. The detailed day-wise timetable is available with your class teacher. Syllabus: everything covered until last week. Students must reach their examination rooms by 8:15 AM.',
      audience: 'STUDENTS',
      priority: 'HIGH',
      senderId: classTeacherUser?.id ?? null,
      createdAt: daysAgo(2, 8),
    },
  })
  await db.notification.create({
    data: {
      schoolId: school.id,
      title: 'Science fair — registration closes Friday',
      message: 'Grade 9 teams: science fair registrations close this Friday. Confirm your team and project title with your class teacher. Project guidelines are available in the science lab.',
      audience: `CLASS:${cls.name}`,
      priority: 'NORMAL',
      senderId: classTeacherUser?.id ?? null,
      createdAt: daysAgo(1, 11),
    },
  })
  console.log('  + notices: 2 (1 HIGH, audience-scoped)')

  console.log('\nDashboard demo seed complete.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
