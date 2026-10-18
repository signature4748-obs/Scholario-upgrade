/**
 * REGRESSION — student/teacher creation input contract (Principal-plane
 * E2E audit, 2026-10-18).
 *
 * THE SHIPPED DEFECTS this suite pins (POST /api/students, POST /api/teachers):
 *
 *   1. NUMERIC rollNo → 500. The Student model stores rollNo / guardianName /
 *      guardianPhone / dob / gender / bloodGroup / address as String?
 *      columns, but POST /api/students passed the JSON body straight into
 *      `prisma.student.create`. Any API consumer sending the natural JSON
 *      types (`rollNo: 1`, `guardianPhone: 9876543210`) crashed Prisma's
 *      argument validation — a PrismaClientValidationError has NO P-code,
 *      so classifyError fell through to the generic 500 INTERNAL_ERROR
 *      bucket. The transaction rolled back atomically (no orphaned User
 *      row — verified in the incident), but the admit flow was unusable
 *      for every non-UI client. The UI was unaffected because the
 *      add-student dialog trims form strings — which is exactly why the
 *      defect survived the UI smoke tests.
 *
 *   2. DUPLICATE login email → 500. Both POST /api/students and
 *      POST /api/teachers threw `new Error('Email already in use')` on the
 *      User.email global-unique clash — a message no classifier recognizes
 *      (not a legacy sentinel, not a P-code, not whitelisted as a safe
 *      client message) → 500. The canonical contract elsewhere in the code
 *      (admissions enrol route) is 409 CONFLICT / EMAIL_TAKEN; these two
 *      routes now match it.
 *
 * THE FIX UNDER TEST:
 *   · src/app/api/students/route.ts — strOrNull() coercion for every
 *     String? column (scalar input accepted, string-or-null stored, falsy
 *     → null), duplicate email → AppError('EMAIL_TAKEN') (409);
 *   · src/app/api/teachers/route.ts — duplicate email → EMAIL_TAKEN (409);
 *   · duplicate (schoolId, classId, rollNo) keeps failing CLOSED as 409
 *     CONFLICT via the existing P2002 classification (never a 500).
 *
 * COVERAGE CONTRACT (live HTTP against the dev server; isolated QA school):
 *   A numeric rollNo + numeric guardianPhone create the student (rollNo
 *      stored as the string "12")                            [live]
 *   B empty/absent rollNo stores null                        [live]
 *   C duplicate student login email → 409 EMAIL_TAKEN        [live]
 *   D duplicate (classId, rollNo) → 409 CONFLICT (not 500)   [live]
 *   E duplicate teacher login email → 409 EMAIL_TAKEN        [live]
 *   F foreign-tenant classId still fails safe 404            [live]
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { liveFetch } from '../helpers/live-http'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const RUN = Math.random().toString(36).slice(2, 10)
const RUN_IP = `10.245.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const SLUG = `qa-reg-input-${RUN}`
const PRINCIPAL_EMAIL = `qa.reg.principal.${RUN}@qafix.scholario.dev`
const PRINCIPAL_PW = 'QaFix!2026x'
const PRINCIPAL_PW2 = 'QaFix!2026y'
const TEACHER_EMAIL = `qa.reg.teacher.${RUN}@qafix.scholario.dev`

let platformToken = ''
let principalToken = ''
let classId = ''
let schoolId = ''
const cleanup: Array<() => Promise<unknown>> = []

const json = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})
// Platform plane authenticates with x-platform-token (the school plane's
// Authorization: Bearer is deliberately ignored there — plane isolation).
const pjson = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { 'x-platform-token': token } : {}),
})

async function platformLogin(): Promise<string> {
  const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: 'admin@scholario.cloud', password: process.env.SEED_PLATFORM_ROOT_PASSWORD ?? 'admin123' }),
  }, { deadlineMs: T })
  const body = await res.json().catch(() => ({}))
  expect(res.status).toBe(200)
  expect(body?.ok).toBe(true)
  return body.data.sessionToken as string
}

describe('student/teacher creation input contract', () => {
  beforeAll(async () => {
    resetLoginBuckets(['admin@scholario.cloud', PRINCIPAL_EMAIL])
    platformToken = await platformLogin()

    // Isolated, clearly-labeled QA school (same pattern as tenant-acceptance).
    const prov = await liveFetch(`${BASE}/api/platform/schools`, {
      method: 'POST',
      headers: pjson(platformToken),
      body: JSON.stringify({
        name: `QA Reg Input Contract ${RUN}`,
        slug: SLUG,
        code: `QRI-${RUN.toUpperCase()}`,
        board: 'CBSE',
        plan: 'STANDARD',
        billingModel: 'SCHOOL_WIDE',
        principalName: 'QA Reg Principal',
        principalEmail: PRINCIPAL_EMAIL,
        principalPassword: PRINCIPAL_PW,
        authMethod: 'PASSWORD',
        academicYear: '2026-2027',
        classes: [{ name: 'Grade 7', sections: ['A'] }],
      }),
    }, { deadlineMs: T })
    const provBody = await prov.json().catch(() => ({}))
    expect(prov.status).toBe(200)
    schoolId = provBody.data.school.id
    cleanup.push(() => db.school.deleteMany({ where: { id: schoolId } }))

    const act = await liveFetch(`${BASE}/api/platform/schools/${schoolId}/activate`, {
      method: 'POST', headers: pjson(platformToken),
    }, { deadlineMs: T })
    expect(act.status).toBe(200)

    // Principal bootstrap: rotate the seeded credential (dev returns the
    // rotated sessionToken — same flow as tenant-acceptance).
    const login = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PRINCIPAL_EMAIL, password: PRINCIPAL_PW }),
    }, { deadlineMs: T })
    const loginBody = await login.json().catch(() => ({}))
    expect(login.status).toBe(200)
    const ch = await liveFetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: json(loginBody.data.sessionToken),
      body: JSON.stringify({ currentPassword: PRINCIPAL_PW, newPassword: PRINCIPAL_PW2, confirmPassword: PRINCIPAL_PW2 }),
    }, { deadlineMs: T })
    const chBody = await ch.json().catch(() => ({}))
    expect(ch.status).toBe(200)
    principalToken = (chBody.data?.sessionToken as string) ?? loginBody.data.sessionToken

    // Class id for the fixtures.
    const cls = await liveFetch(`${BASE}/api/classes?counts=1`, { headers: json(principalToken) }, { deadlineMs: T })
    const clsBody = await cls.json().catch(() => ({}))
    const classes = clsBody.data?.classes ?? clsBody.data ?? []
    classId = classes[0]?.id
    expect(classId).toBeTruthy()
  }, T)

  test('A: numeric rollNo + numeric guardianPhone create the student (string coercion)', async () => {
    const res = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({
        name: 'QA Numeric Roll',
        email: `qa.reg.numroll.${RUN}@qafix.scholario.dev`,
        password: 'QaStud!2026',
        classId,
        rollNo: 12,            // JSON number — crashed with 500 before the fix
        guardianPhone: 9876543210, // JSON number — same class of failure
        guardianName: 'QA Guardian',
      }),
    }, { deadlineMs: T })
    const body = await res.json().catch(() => ({}))
    expect([200, 201]).toContain(res.status)
    expect(body?.data?.id).toBeTruthy()
    expect(body.data.rollNo).toBe('12')
    cleanup.push(() => db.user.deleteMany({ where: { email: `qa.reg.numroll.${RUN}@qafix.scholario.dev` } }))
  }, T)

  test('B: absent rollNo stores null', async () => {
    const res = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({
        name: 'QA Null Roll',
        email: `qa.reg.nullroll.${RUN}@qafix.scholario.dev`,
        password: 'QaStud!2026',
        classId,
      }),
    }, { deadlineMs: T })
    const body = await res.json().catch(() => ({}))
    expect([200, 201]).toContain(res.status)
    expect(body?.data?.rollNo ?? null).toBeNull()
    cleanup.push(() => db.user.deleteMany({ where: { email: `qa.reg.nullroll.${RUN}@qafix.scholario.dev` } }))
  }, T)

  test('C: duplicate student login email → 409 EMAIL_TAKEN (not 500)', async () => {
    const email = `qa.reg.dup.${RUN}@qafix.scholario.dev`
    const first = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ name: 'QA Dup One', email, password: 'QaStud!2026', classId }),
    }, { deadlineMs: T })
    expect([200, 201]).toContain(first.status)
    cleanup.push(() => db.user.deleteMany({ where: { email } }))

    const second = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ name: 'QA Dup Two', email, password: 'QaStud!2026', classId }),
    }, { deadlineMs: T })
    const body = await second.json().catch(() => ({}))
    expect(second.status).toBe(409)
    expect(body?.code).toBe('EMAIL_TAKEN')
  }, T)

  test('D: duplicate (classId, rollNo) → 409 CONFLICT (never a 500)', async () => {
    const second = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({
        name: 'QA Roll Clash',
        email: `qa.reg.rollclash.${RUN}@qafix.scholario.dev`,
        password: 'QaStud!2026',
        classId,
        rollNo: '12', // same class + roll as test A → P2002 path
      }),
    }, { deadlineMs: T })
    const body = await second.json().catch(() => ({}))
    expect(second.status).toBe(409)
    expect(body?.code).toBe('CONFLICT')
  }, T)

  test('E: duplicate teacher login email → 409 EMAIL_TAKEN (not 500)', async () => {
    const first = await liveFetch(`${BASE}/api/teachers`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ name: 'QA Reg Teacher', email: TEACHER_EMAIL, password: 'Teach@2026x' }),
    }, { deadlineMs: T })
    expect([200, 201]).toContain(first.status)
    cleanup.push(() => db.user.deleteMany({ where: { email: TEACHER_EMAIL } }))

    const second = await liveFetch(`${BASE}/api/teachers`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ name: 'QA Reg Teacher Two', email: TEACHER_EMAIL, password: 'Teach@2026x' }),
    }, { deadlineMs: T })
    const body = await second.json().catch(() => ({}))
    expect(second.status).toBe(409)
    expect(body?.code).toBe('EMAIL_TAKEN')
  }, T)

  test('F: foreign-tenant classId still fails safe 404 (no existence oracle)', async () => {
    // Any cuid-shaped id that does not belong to this school.
    const foreignId = `clforged${randomBytes(12).toString('hex')}`
    const res = await liveFetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({
        name: 'QA Foreign Class',
        email: `qa.reg.foreign.${RUN}@qafix.scholario.dev`,
        password: 'QaStud!2026',
        classId: foreignId,
      }),
    }, { deadlineMs: T })
    const body = await res.json().catch(() => ({}))
    expect(res.status).toBe(404)
    expect(body?.code).toBe('RESOURCE_NOT_FOUND')
  }, T)

  afterAll(async () => {
    for (const fn of cleanup) { try { await fn() } catch { /* best-effort */ } }
    await db.$disconnect()
  })
})
