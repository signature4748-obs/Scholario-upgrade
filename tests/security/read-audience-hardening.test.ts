/**
 * READ-AUDIENCE & ESCALATION HARDENING (IMPL-1) — regression suite.
 *
 * The hardening this pins (one invariant per section):
 *
 *   1. MASTER-DATA READ GATES: GET /api/subjects is staff-gated
 *      (permission matrix school.masterdata.read — a STUDENT must not
 *      enumerate the catalog); the existing GET /api/classes staff gate
 *      is pinned so it cannot silently regress.
 *   2. EVENT READ AUDIENCE: GET /api/events enforces EVENT_READ_AUDIENCES
 *      server-side — a STAFF-audience event is invisible to a STUDENT
 *      session but visible to a TEACHER (the notices parity contract).
 *   3. ROSTER CLASSMATE PROJECTION: a student's classmates carry null
 *      userId/admissionNo/gender (PII) while the self row keeps its
 *      identity fields for the student panel's own profile resolution.
 *   4. PLATFORM ROOT-MINTING ESCALATION: an admins.manage holder that is
 *      NOT root cannot mint a root account (403) — privilege escalation
 *      via the create endpoint is closed; non-root creation still works,
 *      and self-permission modification (grant OR revoke) is refused.
 *   5. PROFILE-CHANGE-REQUESTS 404: a schools.manage session asking for a
 *      nonexistent school gets an honest RESOURCE_NOT_FOUND (previously
 *      the route answered 200 with school: null — a shape lie).
 *   6. MIGRATION SANITY: the FeeTransaction→Student FK migration keeps
 *      both the self-healing UPDATE (dangling legacy pointers) and the
 *      ADD CONSTRAINT (the actual FK).
 *
 * Live-HTTP suite against the dev server (default http://localhost:3000)
 * with REAL sessions — same style as student-holidays-real-events /
 * platform-isolation / tenant-isolation. Sessions are created as direct
 * rows (the standard auth fixture that bypasses ONLY the login limiter,
 * never an authorization gate).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createHash } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken, hashPassword } from '@/lib/auth'
import { generateTotpSecret } from '@/lib/platform/totp'
import { liveFetch } from '../helpers/live-http'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { REPO_ROOT } from '../helpers/repo-root'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')
const T = 30_000

// ─── Fixtures & session helpers ──────────────────────────────────────────

const SCHOOL_A_SLUG = 'hawkings-prithvipur'
const PRINCIPAL_A_EMAIL = 'tenant.principal.a@hawkings.test'
const TEACHER_A_EMAIL = 'tenant.teacher.a@hawkings.test'
const STUDENT_A_EMAIL = 'tenant.student.a@hawkings.test'

const createdSessionHashes: string[] = []
const eventTitleMarker = `RAH-${MARKER}`
let schoolId = ''

/** Direct school Session row (auth fixture — bypasses only the login limiter). */
async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashSessionToken(token)
  createdSessionHashes.push(tokenHash)
  await db.session.create({
    data: { userId: u.id, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

/** Direct PlatformAdminSession row (fresh step-up window, like platform-isolation). */
async function directPlatformSession(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  createdSessionHashes.push(tokenHash)
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash,
      stepUpAt: new Date(), // fresh MFA equivalence (destructive POSTs pass)
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

/** School-authenticated request (Authorization bearer — the school transport). */
async function asSchool(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/** Platform-authenticated request (x-platform-token — the platform transport). */
async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': token, 'content-type': 'application/json' },
  })
}

// ─── Platform escalation fixture (non-root admins.manage holder) ─────────

const FIXTURE_ADMIN_EMAIL = `rah-ops-${MARKER}@rahardening.test`
let fixtureAdminId = ''
let fixtureAdminToken = ''
/** Ids of admins minted through the REAL POST endpoint (cleaned up after). */
const createdAdminIds: string[] = []

// ─── Roster classmate fixture (only if the corpus lacks one) ─────────────

const CLASSMATE_EMAIL = `rah-classmate-${MARKER}@rahardening.test`
let classmateUserId: string | null = null
let classmateStudentId: string | null = null

beforeAll(async () => {
  const schoolA = await db.school.findUnique({ where: { slug: SCHOOL_A_SLUG } })
  if (!schoolA) throw new Error('demo tenant missing (run bun prisma/seed-tenant-isolation.ts)')
  schoolId = schoolA.id

  await resetLoginBuckets([PRINCIPAL_A_EMAIL, TEACHER_A_EMAIL, STUDENT_A_EMAIL])

  // Non-root admins.manage holder: the seeded ops@scholario.io deliberately
  // LACKS admins.manage (platform-isolation pins its 403), so mint the
  // escalation probe identity directly (same hashing as the real route:
  // scrypt hashPassword + a server-generated TOTP secret).
  const passwordHash = hashPassword(`Rah!Pass${MARKER}`)
  const fixtureAdmin = await db.platformAdmin.create({
    data: {
      email: FIXTURE_ADMIN_EMAIL,
      passwordHash,
      name: 'RAH Escalation Probe',
      isRoot: false,
      isDemo: false,
      totpSecret: generateTotpSecret(),
      status: 'ACTIVE',
    },
  })
  fixtureAdminId = fixtureAdmin.id
  await db.platformPermission.create({ data: { adminId: fixtureAdminId, key: 'admins.manage', granted: true } })
  fixtureAdminToken = await directPlatformSession(fixtureAdminId)
}, 60000)

afterAll(async () => {
  // Events (safety net — the in-test DELETEs usually already removed them).
  await db.schoolEvent.deleteMany({ where: { schoolId, title: { startsWith: eventTitleMarker } } })
  // Roster classmate fixture (only exists when the corpus lacked one).
  if (classmateStudentId) await db.student.deleteMany({ where: { id: classmateStudentId } })
  if (classmateUserId) await db.user.deleteMany({ where: { id: classmateUserId } })
  // Platform probe identities + every session this suite minted.
  for (const adminId of [...createdAdminIds, fixtureAdminId]) {
    await db.platformPermission.deleteMany({ where: { adminId } })
    await db.platformAdminSession.deleteMany({ where: { adminId } })
    await db.platformAdmin.deleteMany({ where: { id: adminId } })
  }
  await db.platformAdminSession.deleteMany({ where: { tokenHash: { in: createdSessionHashes } } })
  await db.session.deleteMany({ where: { tokenHash: { in: createdSessionHashes } } })
})

// ─── 1. Master-data read gates ───────────────────────────────────────────

describe('RAH · master-data read gates', () => {
  test('subjects read is staff-gated', async () => {
    const studentToken = await directSession(STUDENT_A_EMAIL)
    const denied = await asSchool(studentToken, '/api/subjects')
    expect(denied.status).toBe(403)

    const principalToken = await directSession(PRINCIPAL_A_EMAIL)
    const allowed = await asSchool(principalToken, '/api/subjects')
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  }, T)

  test('classes read is staff-gated (pin)', async () => {
    const studentToken = await directSession(STUDENT_A_EMAIL)
    const res = await asSchool(studentToken, '/api/classes')
    expect(res.status).toBe(403)
  }, T)
})

// ─── 2. Event read audience ──────────────────────────────────────────────

describe('RAH · event read audience (server-enforced)', () => {
  let staffEventId = ''
  let allEventId = ''

  test('as PRINCIPAL create a STAFF-audience and an ALL-audience event', async () => {
    const principalToken = await directSession(PRINCIPAL_A_EMAIL)
    const staffRes = await asSchool(principalToken, '/api/events', {
      method: 'POST',
      body: JSON.stringify({ title: `${eventTitleMarker}-staff`, audience: 'STAFF', type: 'EVENT' }),
    })
    expect(staffRes.status).toBe(200)
    const staffBody = (await staffRes.json()) as { ok: boolean; data?: { id?: string } }
    expect(staffBody.ok).toBe(true)
    staffEventId = staffBody.data?.id ?? ''

    const allRes = await asSchool(principalToken, '/api/events', {
      method: 'POST',
      body: JSON.stringify({ title: `${eventTitleMarker}-all`, audience: 'ALL', type: 'EVENT' }),
    })
    expect(allRes.status).toBe(200)
    const allBody = (await allRes.json()) as { ok: boolean; data?: { id?: string } }
    expect(allBody.ok).toBe(true)
    allEventId = allBody.data?.id ?? ''
  }, T)

  test('STUDENT sees the ALL-marker event but NOT the STAFF-marker event', async () => {
    const studentToken = await directSession(STUDENT_A_EMAIL)
    const res = await asSchool(studentToken, '/api/events')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { title: string }[] }
    expect(body.ok).toBe(true)
    const titles = (body.data ?? []).map((e) => e.title)
    expect(titles.some((t) => t === `${eventTitleMarker}-staff`)).toBe(false)
    expect(titles.some((t) => t === `${eventTitleMarker}-all`)).toBe(true)
  }, T)

  test('TEACHER sees the STAFF-marker event', async () => {
    const teacherToken = await directSession(TEACHER_A_EMAIL)
    const res = await asSchool(teacherToken, '/api/events')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { title: string }[] }
    expect(body.ok).toBe(true)
    const titles = (body.data ?? []).map((e) => e.title)
    expect(titles.some((t) => t === `${eventTitleMarker}-staff`)).toBe(true)
  }, T)

  test('cleanup: DELETE both probe events (tenant-scoped query-string id)', async () => {
    const principalToken = await directSession(PRINCIPAL_A_EMAIL)
    for (const id of [staffEventId, allEventId]) {
      if (!id) continue
      const res = await asSchool(principalToken, `/api/events?id=${id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    }
  }, T)
})

// ─── 3. Roster classmate projection ──────────────────────────────────────

describe('RAH · roster classmate PII projection', () => {
  test('own row keeps identity fields; classmates get null userId/admissionNo/gender', async () => {
    // Fixture heal: if the student's class has no ACTIVE classmate, mint one
    // (same pattern as prisma/seed-tenant-isolation.ts) so the projection is
    // observable; the row is swept in afterAll.
    const selfUser = await db.user.findUnique({ where: { email: STUDENT_A_EMAIL } })
    if (!selfUser) throw new Error(`no user ${STUDENT_A_EMAIL}`)
    const selfStudent = await db.student.findFirst({ where: { schoolId, userId: selfUser.id } })
    if (!selfStudent) throw new Error('fixture student A row missing (run bun prisma/seed-tenant-isolation.ts)')

    if (selfStudent.classId) {
      const classmates = await db.student.count({
        where: {
          schoolId,
          classId: selfStudent.classId,
          id: { not: selfStudent.id },
          user: { status: 'ACTIVE' },
        },
      })
      if (classmates === 0) {
        const classmateUser = await db.user.create({
          data: {
            email: CLASSMATE_EMAIL,
            name: 'RAH Classmate Probe',
            role: 'STUDENT',
            schoolId,
            status: 'ACTIVE',
            passwordHash: hashPassword(`Rah!Pass${MARKER}`),
          },
        })
        classmateUserId = classmateUser.id
        const classmateStudent = await db.student.create({
          data: {
            schoolId,
            userId: classmateUser.id,
            classId: selfStudent.classId,
            rollNo: '98',
            admissionNo: `RAH-${MARKER}-0998`,
            gender: 'female',
          },
        })
        classmateStudentId = classmateStudent.id
      }
    }

    const studentToken = await directSession(STUDENT_A_EMAIL)
    const res = await asSchool(studentToken, '/api/students/roster')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data: { students: { id: string; userId: string | null; admissionNo: string | null; gender: string | null }[] }
    }
    expect(body.ok).toBe(true)
    const students = body.data.students

    const self = students.find((s) => s.id === selfStudent.id)
    expect(self).toBeDefined()
    expect(self?.userId).not.toBeNull() // identity resolution for the own profile

    const classmates = students.filter((s) => s.id !== selfStudent.id)
    expect(classmates.length).toBeGreaterThan(0)
    for (const c of classmates) {
      expect(c.userId).toBeNull()
      expect(c.admissionNo).toBeNull()
      expect(c.gender).toBeNull()
    }
  }, T)
})

// ─── 4. Platform root-minting escalation ─────────────────────────────────

describe('RAH · platform root-minting + self-permission escalation', () => {
  const createdEmail = `rah-created-${MARKER}@rahardening.test`

  test('non-root admins.manage holder minting isRoot:true → 403', async () => {
    const res = await asPlatform(fixtureAdminToken, '/api/platform/admins', {
      method: 'POST',
      body: JSON.stringify({
        name: 'RAH Root Escalation Probe',
        email: createdEmail,
        password: `Rah!Pass${MARKER}`,
        isRoot: true,
        permissions: [],
      }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code?: string }
    expect(body.ok).toBe(false)
    // No account was actually minted by the refused request.
    const minted = await db.platformAdmin.findUnique({ where: { email: createdEmail } })
    expect(minted).toBeNull()
  }, T)

  test('non-root admins.manage holder minting a NON-root admin still succeeds (no over-block)', async () => {
    const res = await asPlatform(fixtureAdminToken, '/api/platform/admins', {
      method: 'POST',
      body: JSON.stringify({
        name: 'RAH Non-Root Probe',
        email: createdEmail,
        password: `Rah!Pass${MARKER}`,
        isRoot: false,
        permissions: ['schools.read'],
      }),
    })
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as { ok: boolean; data?: { id?: string; isRoot?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data?.isRoot).toBe(false)
    if (body.data?.id) createdAdminIds.push(body.data.id)
  }, T)

  test('an admins.manage holder cannot grant permissions to SELF (escalation refused)', async () => {
    const res = await asPlatform(fixtureAdminToken, `/api/platform/admins/${fixtureAdminId}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify({ key: 'billing.manage', granted: true }),
    })
    // Self-modification (grant OR revoke) is refused at the validation
    // layer — INVALID_INPUT, the house 400/422 envelope band.
    expect([400, 422]).toContain(res.status)
    const body = (await res.json()) as { ok: boolean; code?: string }
    expect(body.ok).toBe(false)
    // The grant never landed.
    const row = await db.platformPermission.findUnique({
      where: { adminId_key: { adminId: fixtureAdminId, key: 'billing.manage' } },
    })
    expect(row).toBeNull()
  }, T)
})

// ─── 5. Profile-change-requests honest 404 ───────────────────────────────

describe('RAH · profile-change-requests 404 (nonexistent school)', () => {
  test('schools.manage session gets RESOURCE_NOT_FOUND, not a 200-with-null-school', async () => {
    const root = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
    if (!root) throw new Error('platform root fixture missing (run bun prisma/seed-platform.ts)')
    const rootToken = await directPlatformSession(root.id)
    const nonexistent = `c${randomBytes(11).toString('hex')}`
    const res = await asPlatform(rootToken, `/api/platform/schools/${nonexistent}/profile-change-requests`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: boolean; code?: string }
    expect(body.ok).toBe(false)
  }, T)
})

// ─── 6. Migration-file sanity ────────────────────────────────────────────

describe('RAH · FeeTransaction→Student FK migration sanity', () => {
  test('migration.sql keeps the self-healing UPDATE and the ADD CONSTRAINT', () => {
    const sql = read('prisma/migrations/20261013120000_fee_transaction_student_fk/migration.sql')
    // Self-heal first: dangling legacy student pointers are detached.
    expect(sql).toContain('UPDATE "FeeTransaction" SET "studentId" = NULL')
    // Then the constraint itself (financial immutability, ON DELETE SET NULL).
    expect(sql).toContain('ADD CONSTRAINT "FeeTransaction_studentId_fkey"')
    expect(sql).toContain('ON DELETE SET NULL')
  })
})
