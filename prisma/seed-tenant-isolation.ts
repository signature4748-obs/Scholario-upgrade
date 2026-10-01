/**
 * Tenant-isolation test fixtures — PHASE 2, rearchitected for Phase 8A
 * (two-tenant acceptance corpus).
 *
 * The corpus is exactly two tenants:
 *
 *   School B (CLEAN) : Green Valley Public School (slug green-valley) —
 *                      bootstrap config + role users, ZERO business data.
 *                      Ensured here via seed-clean's ensureCleanSchool()
 *                      so a standalone run bootstraps it too.
 *   School A (DEMO)  : Sunrise Academy (slug sunrise-academy) — the full
 *                      demo corpus. THIS seed plants the cross-tenant test
 *                      identities + probe targets INSIDE School A:
 *
 *   Users     : tenant.principal/teacher/student/parent.a@sunrise.test
 *               (roles per account, env-driven fixture password from
 *               prisma/seed-credentials.ts) +
 *               tenant.superadmin@sunrise.test (schoolless) +
 *               tenant.student.probe@sunrise.test ('Aarav Mehta' — the
 *               probe student, equivalent of the legacy Bluebell 'Ira Rao'
 *               fixture, rebranded with a DIFFERENT name inside the demo
 *               tenant).
 *   Fixtures  : teacher row (TT-A-001) + student row for the .a identities,
 *               minimal probe corpus in School A — class 'Grade 5 - A',
 *               subject SR-MATH, CSA (teacher.a scope), probe student
 *               'Aarav Mehta', fee / notification / event / exam /
 *               question / room / study-material probes, homework probes
 *               (both A + B labels) — all owned by School A so cross-tenant
 *               test targets still exist while School B stays honest-zero.
 *
 * Passwords are FIXED test credentials (env-driven via
 * prisma/seed-credentials.ts; they never appear in the client bundle —
 * this file is server/test infrastructure only).
 *
 * Idempotent: re-running refreshes fixture hygiene (password/role/status)
 * and only creates rows that are missing, so canonical test state
 * survives repeated invocations.
 *
 * Run: bun prisma/seed-tenant-isolation.ts
 */
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, PROBE_MATERIAL_TITLE, PROBE_SUBJECT_CODE } from './seed-identity'
import { SEED_TENANT_FIXTURE_PASSWORD } from './seed-credentials'
import { ensureCleanSchool } from './seed-clean'

const db = new PrismaClient()

const TEST_PASSWORD = SEED_TENANT_FIXTURE_PASSWORD

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
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-tenant-isolation')

  // ── School B (clean tenant) ──────────────────────────────────────────
  // Green Valley Public School: bootstrap configuration + b@ fixture
  // users, ZERO business data. Delegated to seed-clean so the definition
  // lives in exactly one place.
  await ensureCleanSchool(db)
  const schoolB = await db.school.findUniqueOrThrow({ where: { slug: 'green-valley' } })
  console.log(`[tenant-fixtures] clean tenant ready: ${schoolB.name} (${schoolB.slug}) ${schoolB.id}`)

  // ── School A (demo tenant — Sunrise Academy) test identities ─────────
  const schoolA = await db.school.findFirst({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!schoolA) {
    console.log('[tenant-fixtures] School A (sunrise-academy) not found — skipping School A fixtures')
    return
  }
  const aid = schoolA.id

  const principalA = await upsertUser({ email: 'tenant.principal.a@sunrise.test', name: 'Tenant Test Principal A', role: 'PRINCIPAL', schoolId: aid })
  const teacherAUser = await upsertUser({ email: 'tenant.teacher.a@sunrise.test', name: 'Tenant Test Teacher A', role: 'TEACHER', schoolId: aid })
  const studentAUser = await upsertUser({ email: 'tenant.student.a@sunrise.test', name: 'Tenant Test Student A', role: 'STUDENT', schoolId: aid })
  const parentAUser = await upsertUser({ email: 'tenant.parent.a@sunrise.test', name: 'Tenant Test Parent A', role: 'PARENT', schoolId: aid })

  // SUPER_ADMIN rows are schoolless — managed directly (the platform
  // account must NEVER be bound to a tenant).
  let saUser = await db.user.findUnique({ where: { email: 'tenant.superadmin@sunrise.test' } })
  if (!saUser) {
    saUser = await db.user.create({
      data: {
        email: 'tenant.superadmin@sunrise.test',
        name: 'Tenant Test Super Admin',
        role: 'SUPER_ADMIN',
        schoolId: null,
        status: 'ACTIVE',
        passwordHash: hashPassword(TEST_PASSWORD),
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

  // ── Probe corpus INSIDE School A (moved from the legacy Bluebell
  //    tenant, rebranded Sunrise) ────────────────────────────────────────
  // The minimal fixtures that used to live in School B (class, probe
  // subject, CSA, probe student 'Ira Rao') now exist as Sunrise-owned
  // equivalents with DIFFERENT names, so cross-tenant test targets exist
  // while the clean school carries zero students/classes.
  let probeClass = await db.class.findFirst({ where: { schoolId: aid, name: 'Grade 5 - A' } })
  if (!probeClass) {
    probeClass = await db.class.create({ data: { schoolId: aid, name: 'Grade 5 - A', section: 'A' } })
    console.log(`[tenant-fixtures] created probe class ${probeClass.id} (Grade 5 - A, School A)`)
  }

  let probeSubject = await db.subject.findFirst({ where: { schoolId: aid, code: PROBE_SUBJECT_CODE } })
  if (!probeSubject) {
    probeSubject = await db.subject.create({
      data: { schoolId: aid, name: 'Mathematics', code: PROBE_SUBJECT_CODE, fullMarks: 100, passMarks: 35 },
    })
    console.log(`[tenant-fixtures] created probe subject ${probeSubject.id} (${PROBE_SUBJECT_CODE}, School A)`)
  }

  // Probe student 'Aarav Mehta' (the legacy 'Ira Rao' equivalent) + its
  // own fixture user, ward of the School A test parent.
  const probeStudentUser = await upsertUser({ email: 'tenant.student.probe@sunrise.test', name: 'Aarav Mehta', role: 'STUDENT', schoolId: aid })
  let probeStudent = await db.student.findFirst({ where: { schoolId: aid, userId: probeStudentUser.id } })
  if (!probeStudent) {
    probeStudent = await db.student.create({
      data: {
        schoolId: aid,
        userId: probeStudentUser.id,
        classId: probeClass.id,
        rollNo: '51',
        admissionNo: 'TT-2026-0501',
        guardianId: parentAUser.id,
        guardianName: 'Tenant Test Parent A',
        guardianPhone: '+91 90000 00003',
        gender: 'male',
      },
    })
    console.log(`[tenant-fixtures] created probe student ${probeStudent.id} (Aarav Mehta, School A)`)
  }

  // ── Cross-tenant probe targets owned by School A ─────────────────────
  const probes: Record<string, { id: string }> = {}

  let feeProbe = await db.fee.findFirst({ where: { schoolId: aid, studentId: probeStudent.id } })
  if (!feeProbe) {
    feeProbe = await db.fee.create({
      data: { schoolId: aid, studentId: probeStudent.id, title: 'Sunrise Term Fee', amount: 12000, paid: 0, status: 'UNPAID' },
    })
  }
  probes.fee = feeProbe

  let notifA = await db.notification.findFirst({ where: { schoolId: aid, title: 'Sunrise Winter Carnival' } })
  if (!notifA) {
    notifA = await db.notification.create({
      data: { schoolId: aid, title: 'Sunrise Winter Carnival', message: 'Sunrise school-only announcement', audience: 'ALL', priority: 'NORMAL' },
    })
  }
  probes.notification = notifA

  let eventA = await db.schoolEvent.findFirst({ where: { schoolId: aid, title: 'Sunrise Founders Day' } })
  if (!eventA) {
    eventA = await db.schoolEvent.create({
      data: { schoolId: aid, title: 'Sunrise Founders Day', type: 'EVENT', startDate: new Date('2026-12-01T09:00:00Z'), audience: 'ALL', createdBy: principalA.id },
    })
  }
  probes.event = eventA

  let examA = await db.exam.findFirst({ where: { schoolId: aid, name: 'Sunrise Unit Test 1' } })
  if (!examA) {
    examA = await db.exam.create({
      data: { schoolId: aid, name: 'Sunrise Unit Test 1', type: 'Unit Test', session: '2026-2027', status: 'Scheduled', resultStatus: 'Not Started', passPercentage: 35, createdBy: principalA.id },
    })
  }
  probes.exam = examA

  let questionA = await db.questionBank.findFirst({ where: { schoolId: aid, question: 'Sunrise probe question: simplify 2x+3?' } })
  if (!questionA) {
    questionA = await db.questionBank.create({
      data: {
        schoolId: aid,
        subjectId: probeSubject.id,
        question: 'Sunrise probe question: simplify 2x+3?',
        optionA: '2x+3', optionB: '5x', optionC: 'x', optionD: '6',
        answer: 'A', type: 'MCQ', difficulty: 'EASY', marks: 1,
      },
    })
  }
  probes.question = questionA

  let roomA5 = await db.room.findFirst({ where: { schoolId: aid, name: 'Sunrise Room 5A' } })
  if (!roomA5) {
    roomA5 = await db.room.create({
      data: { schoolId: aid, name: 'Sunrise Room 5A', code: 'SRA-5A', capacity: 30, type: 'Classroom', active: true },
    })
  }
  probes.room = roomA5

  // NOTE: seed-study-materials wipes the school's materials on every run —
  // it explicitly preserves this probe row (title match, see PROBE_MATERIAL_TITLE).
  let materialA = await db.studyMaterial.findFirst({ where: { schoolId: aid, title: PROBE_MATERIAL_TITLE } })
  if (!materialA) {
    materialA = await db.studyMaterial.create({
      data: {
        schoolId: aid,
        title: PROBE_MATERIAL_TITLE,
        description: 'Sunrise-only worksheet (tenant-isolation probe)',
        subjectId: probeSubject.id,
        className: probeClass.name,
        category: 'worksheet',
        fileName: 'sunrise-probe-worksheet.pdf',
        originalName: 'Sunrise Maths Worksheet 1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'published',
        publishedAt: new Date(),
        uploadedById: teacherA.id,
      },
    })
  }
  probes.material = materialA

  // CSA appointment (teacher A teaches probe Mathematics in Grade 5 - A) —
  // gives the School A test teacher a REAL server-side scope so
  // teacher-surface positive controls exercise the assignment-driven
  // permission model. (seed-teacher-academics rebuilds the CSA matrix and
  // explicitly preserves this probe appointment.)
  let csaA = await db.classSubjectAssignment.findFirst({
    where: { schoolId: aid, classId: probeClass.id, subjectId: probeSubject.id, teacherUserId: teacherAUser.id },
  })
  if (!csaA) {
    csaA = await db.classSubjectAssignment.create({
      data: { schoolId: aid, classId: probeClass.id, subjectId: probeSubject.id, teacherUserId: teacherAUser.id, isActive: true },
    })
    console.log(`[tenant-fixtures] created CSA ${csaA.id} (teacher A → Grade 5 - A probe Mathematics)`)
  }

  // Homework probes (the one route family with no pre-existing canonical
  // rows) — clearly-labeled DRAFT test artifacts, now BOTH inside School A
  // (the clean school carries none).
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
  let hwB = await db.homework.findFirst({ where: { schoolId: aid, title: hwTitleB } })
  if (!hwB) {
    hwB = await db.homework.create({
      data: {
        schoolId: aid,
        classId: probeClass.id,
        title: hwTitleB,
        description: 'Cross-tenant IDOR probe target (B)',
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
    console.log(`[tenant-fixtures] School A homework probe (B) ${hwB.id}`)
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

  console.log('[tenant-fixtures] School A probe targets:')
  for (const [k, v] of Object.entries(probes)) console.log(`  ${k}: ${v.id}`)
  console.log(`[tenant-fixtures] users: principal=${principalA.email} teacher=${teacherAUser.email} student=${studentAUser.email} parent=${parentAUser.email} probeStudent=${probeStudentUser.email}`)
  console.log('[tenant-fixtures] fixture password: env-driven (prisma/seed-credentials.ts — value not printed)')
  console.log('[tenant-fixtures] clean tenant (green-valley) users: principal@greenvalley.test + principal.b/teacher.b/student.b/parent.b@greenvalley.test')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
