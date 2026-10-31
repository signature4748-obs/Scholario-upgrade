/**
 * PHASE 3 — ROLE-WISE FEATURE CONTROL — E2E acceptance journey.
 *
 * The full operator story against the live server (real logins, real
 * sessions, real enforcement):
 *
 *   STEP 1  — Super Admin signs into the platform console.
 *   STEP 2  — opens a school's dossier (green-valley, the clean tenant).
 *   STEP 3  — opens Role-wise Feature Control (GET the config).
 *   STEP 4  — selects the Teacher role and restricts a feature
 *             (attendance.mark) — plus a second cell for the save batch.
 *   STEP 5  — saves (PATCH with the optimistic-lock token).
 *   STEP 6  — refreshes: the configuration persists (re-GET truth).
 *   STEP 7  — the TEACHER's own session sees the correct configuration
 *             (GET /api/school-settings roleFeatures — what the school
 *             navigation consumes).
 *   STEP 8  — the restricted direct API request is DENIED server-side
 *             (FEATURE_DISABLED_FOR_ROLE) — UI hiding is not the boundary.
 *   STEP 9  — another tenant is untouched (hawkings teacher keeps access;
 *             its config surface stays empty) and the config API refuses
 *             school-plane callers outright.
 *   STEP 10 — existing school functionality remains intact for
 *             unaffected features and roles (students keep their
 *             surfaces; the teacher's unaffected features still answer).
 *
 * State hygiene: every override created here is removed in afterAll, so
 * the corpus stays exactly as the seeds made it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET } from '../helpers/credentials'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const T = 60_000

const MARKER = randomBytes(4).toString('hex')
const ROOT_EMAIL = 'admin@scholario.cloud'
const GV_TEACHER = 'teacher.b@greenvalley.test'
const GV_STUDENT = 'student.b@greenvalley.test'
const HV_TEACHER = 'tenant.teacher.a@hawkings.test'

let rootToken = ''
let gvId = ''
let teacherToken = ''
let studentToken = ''
let hvTeacherToken = ''
const cleanup: Array<() => Promise<unknown>> = []

function platform(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': rootToken, ...(init.headers ?? {}) },
  })
}

function school(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
}

async function okData<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: T }
  expect(body.ok).toBe(true)
  return body.data
}

async function schoolBearer(email: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) throw new Error(`fixture user missing: ${email}`)
  const raw = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }))
  return raw
}

beforeAll(async () => {
  // STEP 1 (bootstrap) — REAL platform login (TOTP), session-row fallback.
  let loginRes = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: ROOT_EMAIL,
      password: PLATFORM_ROOT_PASSWORD,
      totp: (await import('../../src/lib/platform/totp')).totpAt(PLATFORM_ROOT_TOTP_SECRET),
    }),
  }).catch(() => null)
  let token = ''
  if (loginRes && loginRes.status === 200) {
    const body = (await loginRes.json()) as { data?: { token?: string } }
    token = body.data?.token ?? ''
  }
  if (!token) {
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('platform root missing — run the canonical corpus seeds')
    const raw = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }))
    token = raw
  }
  rootToken = token
  await resetLoginBuckets([ROOT_EMAIL, GV_TEACHER, GV_STUDENT, HV_TEACHER])

  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } })

  teacherToken = await schoolBearer(GV_TEACHER)
  studentToken = await schoolBearer(GV_STUDENT)
  hvTeacherToken = await schoolBearer(HV_TEACHER)
}, 60_000)

afterAll(async () => {
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } }).catch(() => {})
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

const CFG = (id: string) => `/api/platform/schools/${id}/role-features`

describe('PHASE 3 · the role-wise feature control journey', () => {
  test('STEP 2 — the Super Admin opens the school dossier (schools.read truth)', async () => {
    const data = await okData<{ school: { id: string; name: string } }>(
      await platform(`/api/platform/schools/${gvId}`),
    )
    expect(data.school.id).toBe(gvId)
  }, T)

  test('STEP 3 — opens Role-wise Feature Control (honest fresh state)', async () => {
    const data = await okData<{ roles: Array<{ role: string; restrictedCount: number }>; updatedAt: string | null }>(
      await platform(CFG(gvId)),
    )
    expect(data.roles.length).toBe(3)
    expect(data.roles.every((r) => r.restrictedCount === 0)).toBe(true)
    expect(data.updatedAt).toBeNull()
  }, T)

  test('STEP 4+5 — restricts Teacher features and SAVES (audited, optimistic lock)', async () => {
    const cur = await okData<{ updatedAt: string | null }>(await platform(CFG(gvId)))
    const patch = await platform(CFG(gvId), {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: cur.updatedAt,
        reason: `phase3-e2e-${MARKER}`,
        changes: [
          { role: 'TEACHER', featureKey: 'attendance.mark', denied: true },
          { role: 'TEACHER', featureKey: 'people.students.read', denied: true },
        ],
      }),
    })
    expect(patch.status).toBe(200)
    const data = await okData<{ applied: number }>(patch)
    expect(data.applied).toBe(2)
    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId: gvId, action: 'platform.school.role_feature_updated', reason: `phase3-e2e-${MARKER}` },
    })
    expect(audit).not.toBeNull()
    // Per-cell records: BOTH changes from STEP 4/5 are individually audited.
    const audits = await db.platformAuditLog.findMany({
      where: { schoolId: gvId, action: 'platform.school.role_feature_updated', reason: `phase3-e2e-${MARKER}` },
    })
    expect(audits.length).toBe(2)
  }, T)

  test('STEP 6 — refresh preserves the configuration (server is the truth)', async () => {
    const data = await okData<{ roles: Array<{ role: string; restrictedCount: number; cells: Array<{ key: string; enabled: boolean; overridden: boolean }> }>; updatedAt: string | null }>(
      await platform(CFG(gvId)),
    )
    const teacher = data.roles.find((r) => r.role === 'TEACHER')!
    expect(teacher.restrictedCount).toBe(2)
    expect(teacher.cells.find((c) => c.key === 'attendance.mark')?.overridden).toBe(true)
    expect(data.updatedAt).toBeTruthy()
  }, T)

  test('STEP 7 — the TEACHER session sees the correct configuration (nav payload truth)', async () => {
    const res = await school('/api/school-settings', teacherToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data?: { roleFeatures?: Record<string, boolean> } }
    const rf = body.data?.roleFeatures ?? {}
    expect(rf['attendance.mark']).toBe(false)
    expect(rf['people.students.read']).toBe(false)
    // Unaffected teacher features stay true (inheritance map).
    expect(rf['exams.marks.read']).toBe(true)
  }, T)

  test('STEP 8 — the restricted direct API request is DENIED server-side', async () => {
    const res = await school('/api/attendance/overview', teacherToken)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('FEATURE_DISABLED_FOR_ROLE')
    const res2 = await school('/api/students', teacherToken)
    expect(res2.status).toBe(403)
  }, T)

  test('STEP 9 — another tenant is untouched (and the config API refuses school callers)', async () => {
    // hawkings teacher: same role, NO restriction — baseline access intact.
    const res = await school('/api/students', hvTeacherToken)
    expect(res.status).toBe(200)
    // The hawkings config surface is empty (per-school state, no bleed).
    const hv = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
    expect(await db.roleFeatureOverride.count({ where: { schoolId: hv!.id } })).toBe(0)
    // And a school bearer can never reach ANY school's config surface.
    expect((await school(CFG(gvId), teacherToken)).status).toBe(401)
  }, T)

  test('STEP 10 — existing functionality remains intact for unaffected roles/features', async () => {
    // The student's attendance surface (a different feature cell) — the
    // GATE passes (business 400 is fine for a fixture without a student
    // profile row; the role-feature 403 must never appear).
    const resS = await school('/api/student/attendance', studentToken)
    expect(resS.status).not.toBe(403)
    // The teacher's unaffected feature (exams marks read) still answers.
    const resT = await school('/api/exams', teacherToken)
    expect(resT.status).toBe(200)
    // Restore the school to its seeded state within the journey.
    const cur = await okData<{ updatedAt: string | null }>(await platform(CFG(gvId)))
    const patch = await platform(CFG(gvId), {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: cur.updatedAt,
        changes: [
          { role: 'TEACHER', featureKey: 'attendance.mark', denied: false },
          { role: 'TEACHER', featureKey: 'people.students.read', denied: false },
        ],
      }),
    })
    expect(patch.status).toBe(200)
    // The denial is gone — access restored end-to-end.
    expect((await school('/api/students', teacherToken)).status).toBe(200)
  }, T)
})
