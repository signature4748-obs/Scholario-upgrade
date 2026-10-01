import { assertSeedable } from './seed-guard'
import { CLEAN_SCHOOL_SLUG, DEMO_SCHOOL_CODE, DEMO_SCHOOL_DOMAIN, DEMO_SCHOOL_SLUG } from './seed-identity'
import {
  SEED_DEMO_PASSWORD,
  SEED_SHOWCASE_PRINCIPAL_PASSWORD,
  SEED_SHOWCASE_STUDENT_PASSWORD,
  SEED_SHOWCASE_TEACHER_PASSWORD,
  SEED_SUPERADMIN_PASSWORD,
} from './seed-credentials'
import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth'
import { mintReceiptNo } from '../src/lib/fee-workflow'

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed')
  // PIH-4a — production hard gate (kept: belt & braces alongside the
  // shared guard): this seed DELETES every demo-tenant table and plants
  // demo credentials for the dev/QA tenant. It must never run against a
  // production environment.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[seed] Refusing to run: NODE_ENV=production. The seed suite wipes all data and installs demo credentials.',
    )
    process.exit(1)
  }
  console.log('🌱 Seeding database...')

  // ── Phase 8A: wipe is scoped to the DEMO tenant plane ────────────────
  // Deterministic re-run: everything EXCEPT the clean school (green-valley,
  // planted by seed-clean.ts) and its users is hard-wiped and recreated —
  // `bun run seed:demo` resets the demo tenant to canonical state while
  // the clean tenant keeps its honest zeros. When the clean school is
  // absent the wipe is the legacy full reset. School-scoped tables that
  // are not in the list below (study materials, rooms, grade scales,
  // conversations, exam marks, …) die via the School ON DELETE CASCADE
  // when the school rows go.
  const cleanSchool = await db.school.findUnique({ where: { slug: CLEAN_SCHOOL_SLUG } })
  const cleanUserIds = cleanSchool
    ? (await db.user.findMany({ where: { schoolId: cleanSchool.id }, select: { id: true } })).map((u) => u.id)
    : []
  const notCleanSchoolRows = cleanSchool ? { schoolId: { not: cleanSchool.id } } : {}
  // ActivityLog.schoolId is nullable — null rows (platform events) keep
  // the legacy wipe semantics (deleted).
  const notCleanActivity = cleanSchool ? { OR: [{ schoolId: { not: cleanSchool.id } }, { schoolId: null }] } : {}
  const notCleanUsers = cleanSchool ? { id: { notIn: cleanUserIds } } : {}
  const notCleanSessions = cleanSchool ? { userId: { notIn: cleanUserIds } } : {}
  const notCleanSchools = cleanSchool ? { id: { not: cleanSchool.id } } : {}

  // Clean (order matters for FK). FeeTransaction is the canonical ledger
  // mirror of Payment — the base seed now writes both (PIH-4b parity), so
  // the full reset clears both together.
  await db.feeTransaction.deleteMany({ where: notCleanSchoolRows })
  await db.payment.deleteMany({ where: notCleanSchoolRows })
  // BookIssue carries no schoolId (tenant-derived via book→school): the
  // clean school has no library books and therefore no issues — the
  // unscoped delete keeps the legacy full-wipe semantics.
  await db.bookIssue.deleteMany()
  await db.libraryBook.deleteMany({ where: notCleanSchoolRows })
  await db.notification.deleteMany({ where: notCleanSchoolRows })
  await db.assignment.deleteMany({ where: notCleanSchoolRows })
  await db.result.deleteMany()
  await db.examPaper.deleteMany({ where: notCleanSchoolRows })
  await db.questionBank.deleteMany({ where: notCleanSchoolRows })
  await db.exam.deleteMany({ where: notCleanSchoolRows })
  await db.attendance.deleteMany({ where: notCleanSchoolRows })
  await db.timetable.deleteMany({ where: notCleanSchoolRows })
  await db.fee.deleteMany({ where: notCleanSchoolRows })
  await db.vehicle.deleteMany({ where: notCleanSchoolRows })
  await db.route.deleteMany({ where: notCleanSchoolRows })
  await db.driver.deleteMany({ where: notCleanSchoolRows })
  await db.teacher.deleteMany({ where: notCleanSchoolRows })
  await db.student.deleteMany({ where: notCleanSchoolRows })
  await db.subject.deleteMany({ where: notCleanSchoolRows })
  await db.class.deleteMany({ where: notCleanSchoolRows })
  await db.activityLog.deleteMany({ where: notCleanActivity })
  await db.session.deleteMany({ where: notCleanSessions })
  await db.message.deleteMany({ where: notCleanSchoolRows })
  await db.schoolEvent.deleteMany({ where: notCleanSchoolRows })
  await db.user.deleteMany({ where: notCleanUsers })
  await db.school.deleteMany({ where: notCleanSchools })
  await db.platformSetting.deleteMany()

  // Initialize Platform Settings
  await db.platformSetting.create({
    data: {
      id: 'global',
      showDemoSchool: true,
    },
  })

  // ---------------- SUPER ADMIN ----------------
  const _superAdmin = await db.user.create({
    data: {
      email: 'admin@erpsuite.io',
      passwordHash: hashPassword(SEED_SUPERADMIN_PASSWORD),
      name: 'Platform Super Admin',
      role: 'SUPER_ADMIN',
      phone: '+91 90000 00000',
      status: 'ACTIVE',
    },
  })

  // ---------------- SUNRISE ACADEMY (demo tenant) ----------------
  const demoSchool = await db.school.create({
    data: {
      name: 'Sunrise Academy',
      slug: DEMO_SCHOOL_SLUG,
      code: DEMO_SCHOOL_CODE,
      domain: DEMO_SCHOOL_DOMAIN,
      address: '100 Knowledge Parkway, Sector 47',
      city: 'Gurugram',
      phone: '+91 124 4567 800',
      email: 'office@sunriseacademy.edu',
      themeColor: '#0f766e',
      accentColor: '#f59e0b',
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
      academicYear: '2026-2027',
      isDemo: true,
    },
  })

  // Helper to create a user
  const mkUser = async (schoolId: string | null, email: string, name: string, role: string, phone?: string) => {
    return db.user.create({
      data: {
        schoolId,
        email,
        passwordHash: hashPassword(SEED_DEMO_PASSWORD),
        name,
        role,
        phone: phone || '+91 98765 43210',
        status: 'ACTIVE',
      },
    })
  }

  // ---------------- DEMO SCHOOL USERS (Sunrise Academy) ----------------
  const demoPrincipal = await mkUser(demoSchool.id, 'principal@sunriseacademy.edu', 'Dr. Sarah Jenkins', 'PRINCIPAL', '+91 124 1111 2222')
  const _demoMgmt = await mkUser(demoSchool.id, 'management@sunriseacademy.edu', 'Mr. Rajesh Mehta', 'MANAGEMENT', '+91 124 3333 4444')
  const demoTeacher1 = await mkUser(demoSchool.id, 'teacher1@sunriseacademy.edu', 'Mrs. Kavita Sharma', 'TEACHER', '+91 124 5555 6666')
  const demoTeacher2 = await mkUser(demoSchool.id, 'teacher2@sunriseacademy.edu', 'Mr. Arjun Nair', 'TEACHER', '+91 124 7777 8888')
  const demoTeacher3 = await mkUser(demoSchool.id, 'teacher3@sunriseacademy.edu', 'Ms. Priya Iyer', 'TEACHER', '+91 124 9999 0000')
  const demoDriver1 = await mkUser(demoSchool.id, 'driver1@sunriseacademy.edu', 'Mr. Suresh Kumar', 'DRIVER', '+91 124 1212 3434')
  const demoParent1 = await mkUser(demoSchool.id, 'parent1@sunriseacademy.edu', 'Mr. Vikram Desai', 'PARENT', '+91 124 2323 4545')

  // Teachers
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher1.id, employeeId: 'SRA-T-001', department: 'Mathematics', qualification: 'M.Sc, B.Ed', subjects: 'MATH' } })
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher2.id, employeeId: 'SRA-T-002', department: 'Science', qualification: 'M.Sc Physics, B.Ed', subjects: 'PHY' } })
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher3.id, employeeId: 'SRA-T-003', department: 'English', qualification: 'M.A English, B.Ed', subjects: 'ENG' } })

  // Driver
  const demoDriverRec = await db.driver.create({ data: { schoolId: demoSchool.id, userId: demoDriver1.id, licenseNo: 'HR2620190001234', phone: '+91 124 1212 3434' } })

  // Routes & Vehicles
  const route1 = await db.route.create({ data: { schoolId: demoSchool.id, name: 'Route A - Cyber City', stops: 'MG Road|Cyber Hub|Sector 56|Golf Course Road', fare: 1500, startTime: '07:00', endTime: '08:00' } })
  const route2 = await db.route.create({ data: { schoolId: demoSchool.id, name: 'Route B - Sohna Road', stops: 'Subhash Chowk|Sohna Road|Badshahpur|Vatika City', fare: 1600, startTime: '07:00', endTime: '08:10' } })
  await db.vehicle.create({ data: { schoolId: demoSchool.id, number: 'HR-26-AB-1234', type: 'BUS', capacity: 40, driverId: demoDriverRec.id, routeId: route1.id } })
  await db.vehicle.create({ data: { schoolId: demoSchool.id, number: 'HR-26-CD-5678', type: 'BUS', capacity: 35, routeId: route2.id } })

  // Classes
  const demoClass9 = await db.class.create({ data: { schoolId: demoSchool.id, name: 'Grade 9 - A', gradeLevel: '9', section: 'A', capacity: 40, room: '101', classTeacherId: demoTeacher1.id } })
  const demoClass10 = await db.class.create({ data: { schoolId: demoSchool.id, name: 'Grade 10 - A', gradeLevel: '10', section: 'A', capacity: 40, room: '201', classTeacherId: demoTeacher2.id } })

  // Subjects
  const subjMath = await db.subject.create({ data: { schoolId: demoSchool.id, classId: demoClass9.id, name: 'Mathematics', code: 'MATH', fullMarks: 100, passMarks: 33 } })
  const subjPhy = await db.subject.create({ data: { schoolId: demoSchool.id, classId: demoClass9.id, name: 'Physics', code: 'PHY', fullMarks: 100, passMarks: 33 } })
  const subjEng = await db.subject.create({ data: { schoolId: demoSchool.id, classId: demoClass9.id, name: 'English', code: 'ENG', fullMarks: 100, passMarks: 33 } })
  const _subjChem = await db.subject.create({ data: { schoolId: demoSchool.id, classId: demoClass10.id, name: 'Chemistry', code: 'CHEM', fullMarks: 100, passMarks: 33 } })
  await db.subject.create({ data: { schoolId: demoSchool.id, classId: demoClass10.id, name: 'Biology', code: 'BIO', fullMarks: 100, passMarks: 33 } })

  // Students
  const studentFirstNames = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Aditya', 'Saanvi', 'Arjun', 'Ishita', 'Reyansh', 'Myra', 'Kabir', 'Aadhya', 'Veer', 'Anika', 'Riya', 'Dhruv', 'Pari', 'Arnav', 'Navya', 'Yash']
  const studentLastNames = ['Sharma', 'Patel', 'Reddy', 'Gupta', 'Singh', 'Nair', 'Iyer', 'Verma', 'Joshi', 'Mehta']
  const students: Awaited<ReturnType<typeof db.student.create>>[] = []
  for (let i = 0; i < 18; i++) {
    const fn = studentFirstNames[i % studentFirstNames.length]
    const ln = studentLastNames[i % studentLastNames.length]
    const name = `${fn} ${ln}`
    const cls = i < 10 ? demoClass9 : demoClass10
    const email = `student${i + 1}@sunriseacademy.edu`
    const parentEmail = `parent${i + 1}@sunriseacademy.edu`
    const parentName = `${ln} Family`
    const parentUser = i === 0 ? demoParent1 : await mkUser(demoSchool.id, parentEmail, parentName, 'PARENT', '+91 124 9000 ' + (1000 + i))
    const u = await mkUser(demoSchool.id, email, name, 'STUDENT', '+91 124 8000 ' + (2000 + i))
    const s = await db.student.create({
      data: {
        schoolId: demoSchool.id,
        userId: u.id,
        classId: cls.id,
        rollNo: String(i + 1).padStart(2, '0'),
        admissionNo: 'SRA-2026-' + String(i + 1).padStart(4, '0'),
        guardianId: parentUser.id,
        guardianName: parentName,
        guardianPhone: parentUser.phone,
        dob: `201${i % 5}-0${(i % 9) + 1}-1${i % 9}`,
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        bloodGroup: ['A+', 'B+', 'O+', 'AB+'][i % 4],
        address: `${i + 1} Knowledge Park, Sector 47, Gurugram`,
        routeId: i % 2 === 0 ? route1.id : route2.id,
      },
    })
    students.push(s)
  }

  // Attendance for last 7 days. PIH-4b integrity: dates are anchored to
  // midnight UTC (the canonical day key — a time-of-day date breaks the
  // (studentId, date) day-level uniqueness) and markedBy carries the
  // class teacher's DISPLAY NAME (the canonical provenance convention,
  // same as /api/teacher/class-attendance baseline writes).
  const today = new Date()
  for (let d = 0; d < 7; d++) {
    const date = new Date(today)
    date.setDate(today.getDate() - d)
    date.setUTCHours(0, 0, 0, 0)
    for (const s of students) {
      const r = Math.random()
      const status = r > 0.9 ? 'ABSENT' : r > 0.85 ? 'LATE' : 'PRESENT'
      const classTeacherName = s.classId === demoClass9.id ? demoTeacher1.name : demoTeacher2.name
      await db.attendance.create({
        data: { schoolId: demoSchool.id, studentId: s.id, classId: s.classId, date, status, markedBy: classTeacherName },
      })
    }
  }

  // Exams
  const exam1 = await db.exam.create({ data: { schoolId: demoSchool.id, name: 'Mid-Term Examination', term: 'TERM1', classId: demoClass9.id, startDate: new Date('2026-09-14'), endDate: new Date('2026-09-24'), status: 'COMPLETED' } })
  const _exam2 = await db.exam.create({ data: { schoolId: demoSchool.id, name: 'Unit Test 2', term: 'UNIT', classId: demoClass10.id, startDate: new Date('2026-10-12'), status: 'ONGOING' } })
  await db.exam.create({ data: { schoolId: demoSchool.id, name: 'Final Examination', term: 'FINAL', classId: demoClass9.id, startDate: new Date('2026-02-10'), endDate: new Date('2026-02-20'), status: 'SCHEDULED' } })

  // Results
  for (const s of students) {
    await db.result.create({ data: { studentId: s.id, examId: exam1.id, subjectId: subjMath.id, marks: 60 + Math.floor(Math.random() * 38), totalMarks: 100, grade: 'A' } })
    await db.result.create({ data: { studentId: s.id, examId: exam1.id, subjectId: subjPhy.id, marks: 55 + Math.floor(Math.random() * 40), totalMarks: 100, grade: 'A' } })
    await db.result.create({ data: { studentId: s.id, examId: exam1.id, subjectId: subjEng.id, marks: 65 + Math.floor(Math.random() * 33), totalMarks: 100, grade: 'A' } })
  }

  // Question bank (Math)
  const mathQs = [
    { q: 'The value of 7 × 8 is?', a: '54', b: '56', c: '64', d: '48', ans: 'B', diff: 'EASY' },
    { q: 'Solve: 144 ÷ 12 = ?', a: '10', b: '11', c: '12', d: '14', ans: 'C', diff: 'EASY' },
    { q: 'What is the square root of 169?', a: '11', b: '12', c: '13', d: '14', ans: 'C', diff: 'MEDIUM' },
    { q: 'The LCM of 4 and 6 is?', a: '12', b: '24', c: '8', d: '6', ans: 'A', diff: 'EASY' },
    { q: 'If x + 5 = 12, then x = ?', a: '5', b: '6', c: '7', d: '8', ans: 'C', diff: 'MEDIUM' },
  ]
  for (const q of mathQs) {
    await db.questionBank.create({
      data: { schoolId: demoSchool.id, subjectId: subjMath.id, classId: demoClass9.id, question: q.q, optionA: q.a, optionB: q.b, optionC: q.c, optionD: q.d, answer: q.ans, type: 'MCQ', difficulty: q.diff, marks: 2 },
    })
  }

  // Fees (with matching Payment transaction rows so platform revenue reflects collections).
  // Payment createdAt is spread across the last 6 months so the platform
  // "Monthly Collections by Channel" trend chart shows a realistic series.
  const feeMethods = ['UPI', 'CARD', 'NETBANKING', 'CASH']
  const paidStudents: Array<{ idx: number }> = []
  for (const [idx, s] of students.entries()) {
    const paid = Math.random() > 0.4
    if (paid) paidStudents.push({ idx })
    const fee = await db.fee.create({
      data: { schoolId: demoSchool.id, studentId: s.id, title: 'Tuition Fee Q1', amount: 25000, paid: paid ? 25000 : 0, type: 'TUITION', dueDate: new Date('2026-09-30'), status: paid ? 'PAID' : 'UNPAID', method: paid ? 'UPI' : null, paidDate: paid ? new Date('2026-09-20') : null },
    })
    if (paid) {
      const monthsBack = 5 - Math.floor((paidStudents.length - 1) / Math.max(1, students.length / 5))
      const when = new Date()
      when.setMonth(when.getMonth() - Math.max(0, Math.min(5, monthsBack)))
      when.setDate(3 + (idx % 25))
      when.setHours(9 + (idx % 8), (idx * 11) % 60, 0, 0)
      await db.payment.create({
        data: {
          // Phase 3: Payment.schoolId is required — derived from the fee.
          schoolId: fee.schoolId,
          feeId: fee.id,
          amount: 25000,
          method: feeMethods[idx % feeMethods.length],
          status: 'SUCCESS',
          transactionId: `TXN-${fee.id.slice(-8).toUpperCase()}`,
          note: 'Tuition Fee Q1 collection',
          createdAt: when,
        },
      })
      // PIH-4b ledger parity: every Payment mirror now gets its canonical
      // FeeTransaction row (status SUCCESS, source SCHOOL_OFFICE, receipt
      // minted through the SAME mintReceiptNo the live write paths use) so
      // a fresh DB has SUM(FeeTransaction SUCCESS) == SUM(Fee.paid) from
      // the start — the dashboard (Fee.paid/Payment) and the fees module
      // (FeeTransaction) can never diverge again.
      const seedMethod = feeMethods[idx % feeMethods.length]
      await db.feeTransaction.create({
        data: {
          schoolId: fee.schoolId,
          studentId: s.id,
          studentName: `${studentFirstNames[idx % studentFirstNames.length]} ${studentLastNames[idx % studentLastNames.length]}`,
          feeId: fee.id,
          feeHeadName: fee.title,
          amount: 25000,
          method: seedMethod === 'NETBANKING' ? 'NET_BANKING' : seedMethod,
          status: 'SUCCESS',
          source: 'SCHOOL_OFFICE',
          collectedByName: 'School Office',
          collectedAt: when,
          verifiedAt: when,
          receiptNo: await mintReceiptNo(fee.schoolId),
          note: 'Tuition Fee Q1 collection',
          createdAt: when,
          updatedAt: when,
        },
      })
    }
  }

  // Assignments
  await db.assignment.create({ data: { schoolId: demoSchool.id, classId: demoClass9.id, subjectId: subjMath.id, title: 'Algebra Worksheet 3', description: 'Solve problems 1-15 from chapter 4.', dueDate: new Date(Date.now() + 86400000 * 3), createdBy: demoTeacher1.id } })
  await db.assignment.create({ data: { schoolId: demoSchool.id, classId: demoClass9.id, subjectId: subjPhy.id, title: 'Motion Lab Report', description: 'Write a report on the pendulum experiment.', dueDate: new Date(Date.now() + 86400000 * 5), createdBy: demoTeacher2.id } })

  // Notifications
  await db.notification.create({ data: { schoolId: demoSchool.id, title: 'Mid-Term Results Published', message: 'The mid-term examination results are now available on the portal.', audience: 'ALL', priority: 'HIGH', senderId: demoPrincipal.id } })

  // Library Books
  const books = [
    ['The Wings of Fire', 'A.P.J. Abdul Kalam', 'Biography', 'Orient Longman', 5],
    ['A Brief History of Time', 'Stephen Hawking', 'Science', 'Bantam', 4],
    ['The Alchemist', 'Paulo Coelho', 'Fiction', 'HarperOne', 6],
    ['Mathematics for Class 9', 'R.D. Sharma', 'Textbook', 'Dhanpat Rai', 10],
  ]
  for (const [title, author, cat, pub, copies] of books) {
    await db.libraryBook.create({ data: { schoolId: demoSchool.id, title: String(title), author: String(author), category: String(cat), publisher: String(pub), copies: Number(copies), available: Number(copies) } })
  }

  // Activity Log
  await db.activityLog.create({ data: { schoolId: demoSchool.id, userId: demoPrincipal.id, action: 'SCHOOL_SETUP', detail: 'Sunrise Academy configured for demonstration.' } })

  // ---------------- SCHOLARIO-OS SHOWCASE USERS ----------------
  // Acceptance-testing identities for the demo tenant (env-driven
  // passwords from prisma/seed-credentials.ts). Phase 8A cleanup note:
  // these are NO longer surfaced on the login page — the quick-access
  // demo chips were removed from the public login surface; the accounts
  // remain for controlled development/acceptance testing.
  // (Phase 8A rebrand: the legacy Greenwood showcase identity is now Sunrise.)
  await db.user.upsert({
    where: { email: 'admin@scholario.cloud' },
    update: {},
    create: {
      email: 'admin@scholario.cloud',
      passwordHash: hashPassword(SEED_SUPERADMIN_PASSWORD),
      name: 'Arjun Malhotra',
      role: 'SUPER_ADMIN',
      phone: '+91 90000 00001',
      status: 'ACTIVE',
    },
  })

  const sunrisePrincipal = await db.user.upsert({
    where: { email: 'ananya.iyer@sunriseacademy.edu' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'ananya.iyer@sunriseacademy.edu',
      passwordHash: hashPassword(SEED_SHOWCASE_PRINCIPAL_PASSWORD),
      name: 'Dr. Ananya Iyer',
      role: 'PRINCIPAL',
      phone: '+91 98100 10001',
      status: 'ACTIVE',
    },
  })

  const sunriseTeacher = await db.user.upsert({
    where: { email: 'rohan.mehta@sunriseacademy.edu' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'rohan.mehta@sunriseacademy.edu',
      passwordHash: hashPassword(SEED_SHOWCASE_TEACHER_PASSWORD),
      name: 'Rohan Mehta',
      role: 'TEACHER',
      phone: '+91 98100 10002',
      status: 'ACTIVE',
    },
  })
  await db.teacher.upsert({
    where: { userId: sunriseTeacher.id },
    update: {},
    create: {
      schoolId: demoSchool.id,
      userId: sunriseTeacher.id,
      employeeId: 'SRA-T-014',
      department: 'Mathematics',
      qualification: 'M.Sc Mathematics, B.Ed',
      subjects: 'MATH',
    },
  })

  const sunriseStudent = await db.user.upsert({
    where: { email: 'aarav.sharma@sunriseacademy.edu' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'aarav.sharma@sunriseacademy.edu',
      passwordHash: hashPassword(SEED_SHOWCASE_STUDENT_PASSWORD),
      name: 'Aarav Sharma',
      role: 'STUDENT',
      phone: '+91 98100 10003',
      status: 'ACTIVE',
    },
  })
  await db.student.upsert({
    where: { userId: sunriseStudent.id },
    update: {},
    create: {
      schoolId: demoSchool.id,
      userId: sunriseStudent.id,
      classId: demoClass9.id,
      rollNo: '18',
      admissionNo: 'SRA2026018',
      guardianName: 'Rahul Sharma',
      guardianPhone: '+91 98100 12345',
      dob: '2015-04-12',
      gender: 'MALE',
      bloodGroup: 'B+',
      address: '24 DLF Phase 4, Gurugram',
      routeId: route1.id,
    },
  })

  await db.activityLog.create({
    data: {
      schoolId: demoSchool.id,
      userId: sunrisePrincipal.id,
      action: 'SCHOOL_SETUP',
      detail: 'Sunrise showcase credentials linked to Sunrise Academy for the SCHOLARIO-OS public showcase.',
    },
  })

  console.log('✅ Seed complete!')
  console.log('   Demo tenant: Sunrise Academy (isDemo) + platform/school identities planted.')
  console.log('   Demo & fixture credentials are env-driven (prisma/seed-credentials.ts;')
  console.log('   override via SEED_* vars — see .env.example). Values are intentionally')
  console.log('   NOT printed here: seed output must never disclose credentials.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
