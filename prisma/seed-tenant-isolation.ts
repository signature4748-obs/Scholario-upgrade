/**
 * Tenant-isolation test fixtures — PHASE 2.
 *
 * Creates the SECOND tenant (School B) with a full set of role users and
 * cross-tenant probe targets, WITHOUT touching the canonical Greenwood
 * (School A) data:
 *
 *   School B  : Bluebell International Academy (slug bluebell-academy)
 *   Users     : principal / teacher / student / parent  (role per account)
 *   Data rows : class, subject, teacher, student, fee, notification, event,
 *               exam, question, room, study-material — all owned by School B
 *
 * Passwords are FIXED test credentials (they never appear in the client
 * bundle; this file is server/test infrastructure only).
 *
 * Idempotent: re-running refreshes nothing — it only creates rows that are
 * missing, so canonical test state survives repeated invocations.
 *
 * Run: bun prisma/seed-tenant-isolation.ts
 */
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'

const db = new PrismaClient()

const SCHOOL_B_SLUG = 'bluebell-academy'
const TEST_PASSWORD = 'ScholarioTest2026'
const SCHOOL_A_PASSWORD = TEST_PASSWORD

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function upsertUser(opts: {
  email: string
  name: string
  role: string
  schoolId: string
}) {
  const existing = await db.user.findUnique({ where: { email: opts.email } })
  if (existing) {
    // Fixture hygiene: keep role/school/status canonical AND reset the
    // password to the current fixture value (these are dedicated test
    // accounts — a password drift between seed versions must never
    // break the suite).
    return db.user.update({
      where: { id: existing.id },
      data: {
        role: opts.role,
        schoolId: opts.schoolId,
        status: 'ACTIVE',
        passwordHash: hashPassword(TEST_PASSWORD),
      },
    })
  }
  return db.user.create({
    data: {
      email: opts.email,
      name: opts.name,
      role: opts.role,
      schoolId: opts.schoolId,
      status: 'ACTIVE',
      passwordHash: hashPassword(TEST_PASSWORD),
    },
  })
}

async function main() {
  // ── School B ────────────────────────────────────────────────────────
  let schoolB = await db.school.findUnique({ where: { slug: SCHOOL_B_SLUG } })
  if (!schoolB) {
    schoolB = await db.school.create({
      data: {
        name: 'Bluebell International Academy',
        slug: SCHOOL_B_SLUG,
        code: 'BBA',
        city: 'Pune',
        academicYear: '2025-2026',
        plan: 'STANDARD',
        status: 'ACTIVE',
        isDemo: false,
      },
    })
    console.log(`[tenant-fixtures] created School B ${schoolB.id} (${schoolB.name})`)
  } else {
    console.log(`[tenant-fixtures] School B exists: ${schoolB.id}`)
  }
  const sid = schoolB.id

  // ── Role users ───────────────────────────────────────────────────────
  const principal = await upsertUser({ email: 'principal.b@bluebell.test', name: 'Dr. Meera Nair', role: 'PRINCIPAL', schoolId: sid })
  const teacherUser = await upsertUser({ email: 'teacher.b@bluebell.test', name: 'Sunil Rao', role: 'TEACHER', schoolId: sid })
  const studentUser = await upsertUser({ email: 'student.b@bluebell.test', name: 'Ira Rao', role: 'STUDENT', schoolId: sid })
  const parentUser = await upsertUser({ email: 'parent.b@bluebell.test', name: 'Vikram Rao', role: 'PARENT', schoolId: sid })

  // ── Class + Subject + Teacher rows ───────────────────────────────────
  let classB = await db.class.findFirst({ where: { schoolId: sid, name: 'Grade 5 - A' } })
  if (!classB) {
    classB = await db.class.create({ data: { schoolId: sid, name: 'Grade 5 - A', section: 'A' } })
    console.log(`[tenant-fixtures] created class ${classB.id}`)
  }

  let subjectB = await db.subject.findFirst({ where: { schoolId: sid, code: 'BB-MATH' } })
  if (!subjectB) {
    subjectB = await db.subject.create({
      data: { schoolId: sid, name: 'Mathematics', code: 'BB-MATH', fullMarks: 100, passMarks: 35 },
    })
    console.log(`[tenant-fixtures] created subject ${subjectB.id}`)
  }

  let teacherB = await db.teacher.findFirst({ where: { schoolId: sid, userId: teacherUser.id } })
  if (!teacherB) {
    teacherB = await db.teacher.create({
      data: {
        schoolId: sid,
        userId: teacherUser.id,
        employeeId: 'BBA-T-001',
        department: 'Mathematics',
        qualification: 'M.Sc Mathematics',
        subjects: 'Mathematics',
      },
    })
    console.log(`[tenant-fixtures] created teacher row ${teacherB.id}`)
  } else if (!teacherUser) {
    console.log('[tenant-fixtures] teacher user missing')
  }

  // CSA appointment (teacher B teaches Mathematics in Grade 5 - A) — gives
  // the teacher a REAL server-side scope so teacher-surface positive
  // controls exercise the assignment-driven permission model.
  let csaB = await db.classSubjectAssignment.findFirst({
    where: { schoolId: sid, classId: classB.id, subjectId: subjectB.id, teacherUserId: teacherUser.id },
  })
  if (!csaB) {
    csaB = await db.classSubjectAssignment.create({
      data: { schoolId: sid, classId: classB.id, subjectId: subjectB.id, teacherUserId: teacherUser.id, isActive: true },
    })
    console.log(`[tenant-fixtures] created CSA ${csaB.id} (teacher B → Grade 5 - A Mathematics)`)
  }

  // ── Student (ward of parentB) ────────────────────────────────────────
  let studentB = await db.student.findFirst({ where: { schoolId: sid, userId: studentUser.id } })
  if (!studentB) {
    studentB = await db.student.create({
      data: {
        schoolId: sid,
        userId: studentUser.id,
        classId: classB.id,
        rollNo: '01',
        admissionNo: 'BBA-2026-0001',
        guardianId: parentUser.id,
        guardianName: 'Vikram Rao',
        guardianPhone: '+91 90000 00002',
        gender: 'female',
      },
    })
    console.log(`[tenant-fixtures] created student ${studentB.id}`)
  }

  // ── Cross-tenant probe targets owned by School B ─────────────────────
  const probes: Record<string, { id: string }> = {}

  let feeB = await db.fee.findFirst({ where: { schoolId: sid, studentId: studentB.id } })
  if (!feeB) {
    feeB = await db.fee.create({
      data: { schoolId: sid, studentId: studentB.id, title: 'Bluebell Term Fee', amount: 12000, paid: 0, status: 'UNPAID' },
    })
  }
  probes.fee = feeB

  let notifB = await db.notification.findFirst({ where: { schoolId: sid, title: 'Bluebell Winter Carnival' } })
  if (!notifB) {
    notifB = await db.notification.create({
      data: { schoolId: sid, title: 'Bluebell Winter Carnival', message: 'Bluebell school-only announcement', audience: 'ALL', priority: 'NORMAL' },
    })
  }
  probes.notification = notifB

  let eventB = await db.schoolEvent.findFirst({ where: { schoolId: sid, title: 'Bluebell Founders Day' } })
  if (!eventB) {
    eventB = await db.schoolEvent.create({
      data: { schoolId: sid, title: 'Bluebell Founders Day', type: 'EVENT', startDate: new Date('2026-12-01T09:00:00Z'), audience: 'ALL', createdBy: principal.id },
    })
  }
  probes.event = eventB

  let examB = await db.exam.findFirst({ where: { schoolId: sid, name: 'Bluebell Unit Test 1' } })
  if (!examB) {
    examB = await db.exam.create({
      data: { schoolId: sid, name: 'Bluebell Unit Test 1', type: 'Unit Test', session: '2025-2026', status: 'Scheduled', resultStatus: 'Not Started', passPercentage: 35, createdBy: principal.id },
    })
  }
  probes.exam = examB

  let questionB = await db.questionBank.findFirst({ where: { schoolId: sid, question: 'Bluebell probe question: simplify 2x+3?' } })
  if (!questionB) {
    questionB = await db.questionBank.create({
      data: {
        schoolId: sid,
        subjectId: subjectB.id,
        question: 'Bluebell probe question: simplify 2x+3?',
        optionA: '2x+3', optionB: '5x', optionC: 'x', optionD: '6',
        answer: 'A', type: 'MCQ', difficulty: 'EASY', marks: 1,
      },
    })
  }
  probes.question = questionB

  let roomB = await db.room.findFirst({ where: { schoolId: sid, name: 'Bluebell Room 5A' } })
  if (!roomB) {
    roomB = await db.room.create({
      data: { schoolId: sid, name: 'Bluebell Room 5A', code: 'BBA-5A', capacity: 30, type: 'Classroom', active: true },
    })
  }
  probes.room = roomB

  let materialB = await db.studyMaterial.findFirst({ where: { schoolId: sid, title: 'Bluebell Maths Worksheet 1' } })
  if (!materialB) {
    materialB = await db.studyMaterial.create({
      data: {
        schoolId: sid,
        title: 'Bluebell Maths Worksheet 1',
        description: 'Bluebell-only worksheet (tenant-isolation probe)',
        subjectId: subjectB.id,
        className: classB.name,
        category: 'worksheet',
        fileName: 'bluebell-probe-worksheet.pdf',
        originalName: 'Bluebell Maths Worksheet 1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'published',
        publishedAt: new Date(),
        uploadedById: teacherB.id,
      },
    })
  }
  probes.material = materialB

  console.log('[tenant-fixtures] School B probe targets:')
  for (const [k, v] of Object.entries(probes)) console.log(`  ${k}: ${v.id}`)
  console.log(`[tenant-fixtures] users: principal=${principal.email} teacher=${teacherUser.email} student=${studentUser.email} parent=${parentUser.email}`)
  console.log('[tenant-fixtures] password for all fixture users:', TEST_PASSWORD)

  // ─────────────────────────────────────────────────────────────────────
  // School A (Greenwood, the canonical demo tenant) TEST identities.
  // Additive only — no canonical row is modified. These accounts exist so
  // the cross-tenant test suite has controlled credentials in BOTH tenants
  // (positive controls) without depending on demo login data.
  // ─────────────────────────────────────────────────────────────────────
  const schoolA = await db.school.findFirst({ where: { slug: 'demo-school' } })
  if (!schoolA) {
    console.log('[tenant-fixtures] School A (demo-school) not found — skipping School A fixtures')
    return
  }
  const aid = schoolA.id

  const principalA = await upsertUser({ email: 'tenant.principal.a@scholario.test', name: 'Tenant Test Principal A', role: 'PRINCIPAL', schoolId: aid })
  const teacherAUser = await upsertUser({ email: 'tenant.teacher.a@scholario.test', name: 'Tenant Test Teacher A', role: 'TEACHER', schoolId: aid })
  const studentAUser = await upsertUser({ email: 'tenant.student.a@scholario.test', name: 'Tenant Test Student A', role: 'STUDENT', schoolId: aid })
  const parentAUser = await upsertUser({ email: 'tenant.parent.a@scholario.test', name: 'Tenant Test Parent A', role: 'PARENT', schoolId: aid })

  // SUPER_ADMIN rows are schoolless — managed directly (the platform
  // account must NEVER be bound to a tenant).
  let saUser = await db.user.findUnique({ where: { email: 'tenant.superadmin@scholario.test' } })
  if (!saUser) {
    saUser = await db.user.create({
      data: {
        email: 'tenant.superadmin@scholario.test',
        name: 'Tenant Test Super Admin',
        role: 'SUPER_ADMIN',
        schoolId: null,
        status: 'ACTIVE',
        passwordHash: hashPassword(SCHOOL_A_PASSWORD),
      },
    })
  } else if (saUser.schoolId !== null || saUser.role !== 'SUPER_ADMIN' || saUser.status !== 'ACTIVE') {
    saUser = await db.user.update({
      where: { id: saUser.id },
      data: { schoolId: null, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    })
  }

  const classA = await db.class.findFirst({ where: { schoolId: aid }, orderBy: { name: 'asc' } })
  let teacherA = await db.teacher.findFirst({ where: { schoolId: aid, userId: teacherAUser.id } })
  if (!teacherA) {
    teacherA = await db.teacher.create({
      data: { schoolId: aid, userId: teacherAUser.id, employeeId: 'TT-A-001', department: 'Test', subjects: 'Test' },
    })
  }

  let studentA = await db.student.findFirst({ where: { schoolId: aid, userId: studentAUser.id } })
  if (!studentA && classA) {
    studentA = await db.student.create({
      data: {
        schoolId: aid,
        userId: studentAUser.id,
        classId: classA.id,
        rollNo: '99',
        admissionNo: 'TT-2026-0999',
        guardianId: parentAUser.id,
        guardianName: 'Tenant Test Parent A',
      },
    })
    console.log(`[tenant-fixtures] School A test student ${studentA.id} (class ${classA.name})`)
  }

  // Homework probes for BOTH tenants (the one route family with no
  // pre-existing canonical rows) — clearly-labeled DRAFT test artifacts.
  const hwTitleA = 'ZZ Tenant Test Probe Homework (safe to ignore)'
  let hwA = await db.homework.findFirst({ where: { schoolId: aid, title: hwTitleA } })
  if (!hwA && classA) {
    hwA = await db.homework.create({
      data: {
        schoolId: aid,
        classId: classA.id,
        title: hwTitleA,
        description: 'Cross-tenant IDOR probe target',
        status: 'DRAFT',
        topic: 'Tenant probe',
        maxMarks: 10,
        assignedDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400_000),
        teacherId: teacherAUser.id,
        teacherName: 'Tenant Test Teacher A',
        createdBy: teacherAUser.id,
      },
    })
    console.log(`[tenant-fixtures] School A homework probe ${hwA.id}`)
  }
  const hwTitleB = 'ZZ Tenant Test Probe Homework B'
  let hwB = await db.homework.findFirst({ where: { schoolId: sid, title: hwTitleB } })
  if (!hwB) {
    hwB = await db.homework.create({
      data: {
        schoolId: sid,
        classId: classB.id,
        title: hwTitleB,
        description: 'Cross-tenant IDOR probe target (B)',
        status: 'DRAFT',
        topic: 'Tenant probe',
        maxMarks: 10,
        assignedDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400_000),
        teacherId: teacherUser.id,
        teacherName: 'Sunil Rao',
        createdBy: teacherUser.id,
      },
    })
    console.log(`[tenant-fixtures] School B homework probe ${hwB.id}`)
  }

  // School A probe rows the cross-tenant matrix reads (rooms / grade scale /
  // exam type). Historically these existed only via the iq3000 data
  // migration + live exam-settings usage — a fresh canonical seed (db:seed
  // + this file, exactly what CI provisions) must also carry them, or the
  // tenant-isolation suite's `?? ''` fixture fallbacks make
  // `not.toContain('')` assertions fail on empty ids. Values mirror the
  // exam settings-service defaults (src/lib/exams/types.ts) so the demo
  // tenant's configuration stays coherent.
  let roomA = await db.room.findFirst({ where: { schoolId: aid, name: 'Room 101' } })
  if (!roomA) {
    roomA = await db.room.create({
      data: { schoolId: aid, name: 'Room 101', code: 'RM-101', capacity: 40, type: 'Classroom', active: true },
    })
    console.log(`[tenant-fixtures] School A probe room ${roomA.id}`)
  }
  const gradeA1 = await db.gradeScale.findFirst({ where: { schoolId: aid, grade: 'A1' } })
  if (!gradeA1) {
    await db.gradeScale.createMany({
      data: [
        { schoolId: aid, grade: 'A1', minPct: 90, maxPct: 100, sortOrder: 1 },
        { schoolId: aid, grade: 'A2', minPct: 80, maxPct: 89.99, sortOrder: 2 },
        { schoolId: aid, grade: 'B1', minPct: 70, maxPct: 79.99, sortOrder: 3 },
        { schoolId: aid, grade: 'B2', minPct: 60, maxPct: 69.99, sortOrder: 4 },
        { schoolId: aid, grade: 'C1', minPct: 50, maxPct: 59.99, sortOrder: 5 },
        { schoolId: aid, grade: 'C2', minPct: 33, maxPct: 49.99, sortOrder: 6 },
        { schoolId: aid, grade: 'E', minPct: 0, maxPct: 32.99, sortOrder: 7 },
      ],
    })
    console.log('[tenant-fixtures] School A default grade scale seeded (7 boundaries)')
  }
  let examTypeRowA = await db.examTypeConfig.findFirst({ where: { schoolId: aid, name: 'Unit Test' } })
  if (!examTypeRowA) {
    examTypeRowA = await db.examTypeConfig.create({
      data: { schoolId: aid, name: 'Unit Test', code: 'UT', enabled: true, sortOrder: 1 },
    })
    console.log(`[tenant-fixtures] School A exam type ${examTypeRowA.id}`)
  }

  console.log(`[tenant-fixtures] School A users ready (password ${SCHOOL_A_PASSWORD}): principal=${principalA.email} teacher=${teacherAUser.email} student=${studentAUser.email} parent=${parentAUser.email} superadmin=tenant.superadmin@scholario.test`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
