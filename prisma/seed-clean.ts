/**
 * seed-clean — Green Valley Public School bootstrap (Phase 8A clean tenant).
 *
 * The CLEAN tenant of the two-tenant acceptance corpus: a real school
 * account with bootstrap configuration and ZERO business data — no
 * students, no classes, no fees/payments, no attendance, no exams/marks,
 * no messages, no probes. Every surface a Green Valley user opens shows
 * its honest empty state (this is a deliberate acceptance fixture: it
 * proves the product's zero-data experience, not a broken seed).
 *
 * What this seed creates (all idempotent — upsert/skip-if-exists):
 *   · School row (isDemo=false, slug `green-valley`)
 *   · Branding/website identity skeleton (shortName, tagline, affiliation,
 *     website, principalName, established + a minimal websiteContent CMS
 *     document) — enough for the public site/login to render an honest
 *     skeleton, no fabricated stats
 *   · Bootstrap configuration: GradeScale (7 CBSE boundaries),
 *     ExamTypeConfig ('Unit Test'), Room 101
 *   · Users: principal@greenvalley.test + the b@ tenant-fixture users
 *     (principal.b/teacher.b/student.b/parent.b@greenvalley.test) — the
 *     cross-tenant test identities, env-driven fixture password (the
 *     fixture convention, prisma/seed-credentials.ts). NO
 *     Teacher/Student rows — accounts exist, staff/student directories
 *     stay honest-empty.
 *
 * This is the ONLY seed allowed near production (it is purely additive —
 * it never deletes anything), but it is STILL GUARDED: seed-guard refuses
 * DATABASE_ENV=production outright (production starts clean, period).
 *
 * ensureCleanSchool() is exported so seed-tenant-isolation (the tenant
 * fixture pipeline step) can guarantee the clean tenant exists before
 * planting the Hawkings-side cross-tenant probes.
 *
 * Run: bun run seed:clean   (package.json script)
 */
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'
import { assertSeedable } from './seed-guard'
import { CLEAN_SCHOOL_CODE, CLEAN_SCHOOL_NAME, CLEAN_SCHOOL_SLUG } from './seed-identity'
import { SEED_TENANT_FIXTURE_PASSWORD } from './seed-credentials'

const db = new PrismaClient()

/** Fixed test-credential convention (env-driven, shared with the tenant fixtures). */
const CLEAN_PASSWORD = SEED_TENANT_FIXTURE_PASSWORD

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/** Branding/website identity skeleton (refreshed on every run — fixture school). */
const CLEAN_IDENTITY = {
  shortName: 'Green Valley',
  tagline: 'Rooted in community, growing with curiosity',
  affiliation: 'CBSE — affiliation registration in progress',
  website: 'https://greenvalley.test',
  principalName: 'Dr. Sandhya Menon',
  established: '2004',
}

/** Minimal website CMS skeleton — honest placeholders, no fabricated stats. */
const CLEAN_WEBSITE_CONTENT = {
  hero: {
    title: 'Green Valley Public School',
    description:
      'A welcoming neighbourhood school in Pune. Our website content is being prepared — please contact the school office for admissions enquiries.',
  },
  contact: { title: 'Visit us', subtitle: 'Contact the school office for details.' },
  seo: {
    title: 'Green Valley Public School',
    description: 'Green Valley Public School, Pune — contact the school office for admissions enquiries.',
  },
}

/** Bootstrap timetable configuration (same canonical ladder as the demo tenant). */
const CLEAN_SETTINGS = {
  timetable: {
    dayStart: '08:30 AM',
    dayEnd: '02:45 PM',
    periodMinutes: 45,
    shortBreakAfterPeriod: 3,
    shortBreakMinutes: 15,
    lunchAfterPeriod: 6,
    lunchMinutes: 30,
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  attendance: { lateAfterMinutes: 15, notifyGuardianOnAbsent: true },
}

/** The clean tenant's users: bootstrap principal + b@ tenant-fixture identities. */
const CLEAN_USERS: { email: string; name: string; role: string }[] = [
  { email: 'principal@greenvalley.test', name: 'Dr. Sandhya Menon', role: 'PRINCIPAL' },
  { email: 'principal.b@greenvalley.test', name: 'Dr. Meera Nair', role: 'PRINCIPAL' },
  { email: 'teacher.b@greenvalley.test', name: 'Sunil Rao', role: 'TEACHER' },
  { email: 'student.b@greenvalley.test', name: 'Ira Rao', role: 'STUDENT' },
  { email: 'parent.b@greenvalley.test', name: 'Vikram Rao', role: 'PARENT' },
]

/**
 * Idempotently ensure the clean tenant exists. Never deletes anything.
 * Returns the school id (null only if creation was impossible).
 */
export async function ensureCleanSchool(client: PrismaClient = db): Promise<string | null> {
  let school = await client.school.findUnique({ where: { slug: CLEAN_SCHOOL_SLUG } })
  if (!school) {
    school = await client.school.create({
      data: {
        name: CLEAN_SCHOOL_NAME,
        slug: CLEAN_SCHOOL_SLUG,
        code: CLEAN_SCHOOL_CODE,
        city: 'Pune',
        academicYear: '2026-2027',
        plan: 'STANDARD',
        status: 'ACTIVE',
        isDemo: false,
      },
    })
    console.log(`[seed-clean] created ${school.name} (${school.slug}) ${school.id}`)
  }

  // Refresh the branding/identity + bootstrap settings (fixture school →
  // canonical state on every run; never touches business data).
  await client.school.update({
    where: { id: school.id },
    data: {
      ...CLEAN_IDENTITY,
      settings: JSON.stringify(CLEAN_SETTINGS),
      websiteContent: JSON.stringify(CLEAN_WEBSITE_CONTENT),
    },
  })

  // Users — upsert semantics with fixture hygiene (password/role/status
  // reset to the canonical fixture values, mirroring the tenant-fixture
  // convention so a password drift can never break the suite).
  for (const u of CLEAN_USERS) {
    await client.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, schoolId: school.id, status: 'ACTIVE', passwordHash: hashPassword(CLEAN_PASSWORD) },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        schoolId: school.id,
        status: 'ACTIVE',
        passwordHash: hashPassword(CLEAN_PASSWORD),
      },
    })
  }

  // Bootstrap configuration — skip-if-exists.
  const gradeA1 = await client.gradeScale.findFirst({ where: { schoolId: school.id, grade: 'A1' } })
  if (!gradeA1) {
    await client.gradeScale.createMany({
      data: [
        { schoolId: school.id, grade: 'A1', minPct: 90, maxPct: 100, sortOrder: 1 },
        { schoolId: school.id, grade: 'A2', minPct: 80, maxPct: 89.99, sortOrder: 2 },
        { schoolId: school.id, grade: 'B1', minPct: 70, maxPct: 79.99, sortOrder: 3 },
        { schoolId: school.id, grade: 'B2', minPct: 60, maxPct: 69.99, sortOrder: 4 },
        { schoolId: school.id, grade: 'C1', minPct: 50, maxPct: 59.99, sortOrder: 5 },
        { schoolId: school.id, grade: 'C2', minPct: 33, maxPct: 49.99, sortOrder: 6 },
        { schoolId: school.id, grade: 'E', minPct: 0, maxPct: 32.99, sortOrder: 7 },
      ],
    })
    console.log('[seed-clean] grade scale seeded (7 boundaries)')
  }
  const examType = await client.examTypeConfig.findFirst({ where: { schoolId: school.id, name: 'Unit Test' } })
  if (!examType) {
    await client.examTypeConfig.create({
      data: { schoolId: school.id, name: 'Unit Test', code: 'UT', enabled: true, sortOrder: 1 },
    })
    console.log('[seed-clean] exam type "Unit Test" seeded')
  }
  const room = await client.room.findFirst({ where: { schoolId: school.id, name: 'Room 101' } })
  if (!room) {
    await client.room.create({
      data: { schoolId: school.id, name: 'Room 101', code: 'GVPS-101', capacity: 40, type: 'Classroom', active: true },
    })
    console.log('[seed-clean] Room 101 seeded')
  }

  return school.id
}

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement). This seed
  // is purely additive and the closest-to-production of the suite, but
  // production STILL starts clean: the guard refuses it there too.
  assertSeedable('seed-clean')

  const schoolId = await ensureCleanSchool()
  if (!schoolId) throw new Error('[seed-clean] failed to ensure the clean school')

  // Honest-zero verification: the clean tenant must carry no business data.
  const zeros = {
    students: await db.student.count({ where: { schoolId } }),
    classes: await db.class.count({ where: { schoolId } }),
    teachers: await db.teacher.count({ where: { schoolId } }),
    subjects: await db.subject.count({ where: { schoolId } }),
    fees: await db.fee.count({ where: { schoolId } }),
    payments: await db.payment.count({ where: { schoolId } }),
    attendance: await db.attendance.count({ where: { schoolId } }),
    exams: await db.exam.count({ where: { schoolId } }),
    messages: await db.message.count({ where: { schoolId } }),
    notifications: await db.notification.count({ where: { schoolId } }),
  }
  const nonZero = Object.entries(zeros).filter(([, n]) => n > 0)
  if (nonZero.length > 0) {
    console.warn(`[seed-clean] ⚠️ clean tenant carries business data: ${JSON.stringify(Object.fromEntries(nonZero))}`)
  } else {
    console.log('[seed-clean] ✅ honest-zero verified (no business data)')
  }

  const users = await db.user.findMany({ where: { schoolId }, select: { email: true, role: true } })
  console.log(`[seed-clean] users: ${users.map((u) => `${u.email} (${u.role.toLowerCase()})`).join(', ')}`)
  console.log('[seed-clean] fixture password: env-driven (prisma/seed-credentials.ts — value not printed)')
}

if (import.meta.main) {
  main()
    .catch((e) => {
      console.error('[seed-clean] FAILED:', e)
      process.exit(1)
    })
    .finally(() => db.$disconnect())
}
