import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth'

async function main() {
  console.log('🌱 Seeding database...')

  // Clean (order matters for FK)
  await db.payment.deleteMany()
  await db.bookIssue.deleteMany()
  await db.libraryBook.deleteMany()
  await db.notification.deleteMany()
  await db.assignment.deleteMany()
  await db.result.deleteMany()
  await db.examPaper.deleteMany()
  await db.questionBank.deleteMany()
  await db.exam.deleteMany()
  await db.attendance.deleteMany()
  await db.timetable.deleteMany()
  await db.fee.deleteMany()
  await db.vehicle.deleteMany()
  await db.route.deleteMany()
  await db.driver.deleteMany()
  await db.teacher.deleteMany()
  await db.student.deleteMany()
  await db.subject.deleteMany()
  await db.class.deleteMany()
  await db.activityLog.deleteMany()
  await db.session.deleteMany()
  await db.message.deleteMany()
  await db.schoolEvent.deleteMany()
  await db.user.deleteMany()
  await db.school.deleteMany()
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
      passwordHash: hashPassword('admin123'),
      name: 'Platform Super Admin',
      role: 'SUPER_ADMIN',
      phone: '+91 90000 00000',
      status: 'ACTIVE',
    },
  })

  // ---------------- DEMO SCHOOL OF SCHOLARIO ----------------
  const demoSchool = await db.school.create({
    data: {
      name: 'Demo School of Scholario',
      slug: 'demo-school',
      code: 'DEMO',
      domain: 'demoschool.scholario.app',
      address: '100 Knowledge Parkway, Sector 47',
      city: 'Gurugram',
      phone: '+91 124 4567 800',
      email: 'office@demoschool.edu',
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
        passwordHash: hashPassword('password123'),
        name,
        role,
        phone: phone || '+91 98765 43210',
        status: 'ACTIVE',
      },
    })
  }

  // ---------------- DEMO SCHOOL USERS ----------------
  const demoPrincipal = await mkUser(demoSchool.id, 'principal@demoschool.edu', 'Dr. Sarah Jenkins', 'PRINCIPAL', '+91 124 1111 2222')
  const _demoMgmt = await mkUser(demoSchool.id, 'management@demoschool.edu', 'Mr. Rajesh Mehta', 'MANAGEMENT', '+91 124 3333 4444')
  const demoTeacher1 = await mkUser(demoSchool.id, 'teacher1@demoschool.edu', 'Mrs. Kavita Sharma', 'TEACHER', '+91 124 5555 6666')
  const demoTeacher2 = await mkUser(demoSchool.id, 'teacher2@demoschool.edu', 'Mr. Arjun Nair', 'TEACHER', '+91 124 7777 8888')
  const demoTeacher3 = await mkUser(demoSchool.id, 'teacher3@demoschool.edu', 'Ms. Priya Iyer', 'TEACHER', '+91 124 9999 0000')
  const demoDriver1 = await mkUser(demoSchool.id, 'driver1@demoschool.edu', 'Mr. Suresh Kumar', 'DRIVER', '+91 124 1212 3434')
  const demoParent1 = await mkUser(demoSchool.id, 'parent1@demoschool.edu', 'Mr. Vikram Desai', 'PARENT', '+91 124 2323 4545')

  // Teachers
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher1.id, employeeId: 'DEMO-T-001', department: 'Mathematics', qualification: 'M.Sc, B.Ed', subjects: 'MATH' } })
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher2.id, employeeId: 'DEMO-T-002', department: 'Science', qualification: 'M.Sc Physics, B.Ed', subjects: 'PHY' } })
  await db.teacher.create({ data: { schoolId: demoSchool.id, userId: demoTeacher3.id, employeeId: 'DEMO-T-003', department: 'English', qualification: 'M.A English, B.Ed', subjects: 'ENG' } })

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
    const email = `student${i + 1}@demoschool.edu`
    const parentEmail = `parent${i + 1}@demoschool.edu`
    const parentName = `${ln} Family`
    const parentUser = i === 0 ? demoParent1 : await mkUser(demoSchool.id, parentEmail, parentName, 'PARENT', '+91 124 9000 ' + (1000 + i))
    const u = await mkUser(demoSchool.id, email, name, 'STUDENT', '+91 124 8000 ' + (2000 + i))
    const s = await db.student.create({
      data: {
        schoolId: demoSchool.id,
        userId: u.id,
        classId: cls.id,
        rollNo: String(i + 1).padStart(2, '0'),
        admissionNo: 'DEMO-2026-' + String(i + 1).padStart(4, '0'),
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

  // Attendance for last 7 days
  const today = new Date()
  for (let d = 0; d < 7; d++) {
    const date = new Date(today)
    date.setDate(today.getDate() - d)
    for (const s of students) {
      const r = Math.random()
      const status = r > 0.9 ? 'ABSENT' : r > 0.85 ? 'LATE' : 'PRESENT'
      await db.attendance.create({
        data: { schoolId: demoSchool.id, studentId: s.id, classId: s.classId, date, status, markedBy: demoTeacher1.id },
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
  await db.activityLog.create({ data: { schoolId: demoSchool.id, userId: demoPrincipal.id, action: 'SCHOOL_SETUP', detail: 'Demo School of Scholario configured for demonstration.' } })

  // ---------------- SCHOLARIO-OS DEMO LOGIN USERS ----------------
  // These match the credentials exposed on the public login page (login-page.tsx).
  // They are additional to the @demoschool.edu accounts above so the demo role
  // cards work end-to-end with the real auth API.
  await db.user.upsert({
    where: { email: 'admin@scholario.cloud' },
    update: {},
    create: {
      email: 'admin@scholario.cloud',
      passwordHash: hashPassword('admin123'),
      name: 'Arjun Malhotra',
      role: 'SUPER_ADMIN',
      phone: '+91 90000 00001',
      status: 'ACTIVE',
    },
  })

  const greenwoodPrincipal = await db.user.upsert({
    where: { email: 'principal@greenwood.edu.in' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'principal@greenwood.edu.in',
      passwordHash: hashPassword('principal123'),
      name: 'Dr. Ananya Iyer',
      role: 'PRINCIPAL',
      phone: '+91 98100 10001',
      status: 'ACTIVE',
    },
  })

  const greenwoodTeacher = await db.user.upsert({
    where: { email: 'rohan.mehta@greenwood.edu.in' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'rohan.mehta@greenwood.edu.in',
      passwordHash: hashPassword('teacher123'),
      name: 'Rohan Mehta',
      role: 'TEACHER',
      phone: '+91 98100 10002',
      status: 'ACTIVE',
    },
  })
  await db.teacher.upsert({
    where: { userId: greenwoodTeacher.id },
    update: {},
    create: {
      schoolId: demoSchool.id,
      userId: greenwoodTeacher.id,
      employeeId: 'GWS-T-014',
      department: 'Mathematics',
      qualification: 'M.Sc Mathematics, B.Ed',
      subjects: 'MATH',
    },
  })

  const greenwoodStudent = await db.user.upsert({
    where: { email: 'aarav.sharma@greenwood.edu.in' },
    update: {},
    create: {
      schoolId: demoSchool.id,
      email: 'aarav.sharma@greenwood.edu.in',
      passwordHash: hashPassword('student123'),
      name: 'Aarav Sharma',
      role: 'STUDENT',
      phone: '+91 98100 10003',
      status: 'ACTIVE',
    },
  })
  await db.student.upsert({
    where: { userId: greenwoodStudent.id },
    update: {},
    create: {
      schoolId: demoSchool.id,
      userId: greenwoodStudent.id,
      classId: demoClass9.id,
      rollNo: '18',
      admissionNo: 'GWS2026018',
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
      userId: greenwoodPrincipal.id,
      action: 'SCHOOL_SETUP',
      detail: 'Greenwood demo credentials linked to Demo School of Scholario for the SCHOLARIO-OS public showcase.',
    },
  })

  console.log('✅ Seed complete!')
  console.log('   Super Admin (legacy): admin@erpsuite.io / admin123')
  console.log('   Super Admin (showcase): admin@scholario.cloud / admin123')
  console.log('   Demo Principal: principal@demoschool.edu / password123')
  console.log('   Demo Student1: student1@demoschool.edu / password123')
  console.log('   Demo Teacher1: teacher1@demoschool.edu / password123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
