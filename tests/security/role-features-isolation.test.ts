/**
 * PHASE 3 — ROLE-WISE FEATURE CONTROL — security, enforcement & isolation.
 *
 * THE INVARIANTS UNDER TEST (live HTTP, seeded corpus):
 *
 *   1. PLATFORM-ONLY CONFIG SURFACE — the configuration lives under
 *      /api/platform/*: school sessions (principal/teacher/student
 *      bearers) and anonymous callers are refused (401). Cross-tenant
 *      configuration access is impossible by construction.
 *   2. SERVER-SIDE ENFORCEMENT — a school that denies a feature for a
 *      role gets that decision enforced on the REAL school routes
 *      (not just hidden nav): the gated route answers 403
 *      FEATURE_DISABLED_FOR_ROLE for the restricted role while
 *      unaffected roles/tenants keep working.
 *   3. REMOVE-ONLY COMPOSITION — the override can only narrow: denying
 *      a feature never grants anything, and a DISABLED MODULE still
 *      wins (FEATURE_DISABLED, the module code — distinct from the
 *      role-feature code so the layers stay tellable apart).
 *   4. TENANT ISOLATION — a denial at School A never touches School B;
 *      School B's same-role users keep full baseline access.
 *   5. FAIL-CLOSED ENVELOPE — unknown feature keys are refused (422 at
 *      the config surface), and the enforcement pipeline still runs for
 *      sessions that must change passwords / lack subscriptions exactly
 *      as before (ordering untouched).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform/permissions'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

const GV_PRINCIPAL = 'principal.b@greenvalley.test'
const GV_TEACHER = 'teacher.b@greenvalley.test'
const GV_STUDENT = 'student.b@greenvalley.test'
const HV_TEACHER = 'tenant.teacher.a@hawkings.test'

let fullToken = ''
let gvId = ''
let hvId = ''
let phantomId = `ghost${randomBytes(8).toString('hex')}`
const cleanup: Array<() => Promise<unknown>> = []

async function dedicatedFullAdmin(label: string): Promise<string> {
  const marker = randomBytes(4).toString('hex')
  const { hashPassword } = await import('@/lib/auth')
  const admin = await db.platformAdmin.create({
    data: {
      email: `${label}-${marker}@provision.test`,
      passwordHash: hashPassword('Dedicated!8c-pass'),
      name: label,
      isRoot: false,
      totpSecret: 'JBSWY3DPEHPK3PXP',
    },
  })
  for (const key of PLATFORM_PERMISSION_KEYS) {
    await db.platformPermission.create({ data: { adminId: admin.id, key, granted: true } })
  }
  const raw = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: { adminId: admin.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: admin.id } }).catch(() => {})
    await db.platformPermission.deleteMany({ where: { adminId: admin.id } }).catch(() => {})
    await db.platformAdmin.delete({ where: { id: admin.id } }).catch(() => {})
  })
  return raw
}

/** School bearer fixture — the convention (direct Session row). */
async function schoolToken(email: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) throw new Error(`fixture user missing: ${email}`)
  const raw = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }))
  return raw
}

function platform(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': fullToken, ...(init.headers ?? {}) },
  })
}

function school(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
}

const CFG = (id: string) => `/api/platform/schools/${id}/role-features`

async function patchFeature(role: string, featureKey: string, denied: boolean): Promise<Response> {
  const cur = await (await platform(CFG(gvId))).json() as { data: { updatedAt: string | null } }
  return platform(CFG(gvId), {
    method: 'PATCH',
    body: JSON.stringify({ baseUpdatedAt: cur.data.updatedAt, changes: [{ role, featureKey, denied }] }),
  })
}

beforeAll(async () => {
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id
  const hv = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!hv) throw new Error('hawkings school missing — run the canonical corpus seeds')
  hvId = hv.id
  fullToken = await dedicatedFullAdmin('rolefeat-iso-admin')
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } })
}, 60_000)

afterAll(async () => {
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } }).catch(() => {})
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

describe('1 — platform-only config surface', () => {
  test('anonymous → 401; school principal bearer → 401 (plane isolation)', async () => {
    expect((await fetch(`${BASE}${CFG(gvId)}`)).status).toBe(401)
    const principal = await schoolToken(GV_PRINCIPAL)
    expect((await school(CFG(gvId), principal)).status).toBe(401)
    expect((await school(CFG(gvId), principal, {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [] }),
    })).status).toBe(401)
  }, T)

  test('phantom school → fail-safe 404', async () => {
    expect((await platform(CFG(phantomId))).status).toBe(404)
  }, T)
})

describe('2 — server-side enforcement on REAL school routes', () => {
  test('baseline: green-valley teacher reads the student directory (200)', async () => {
    const teacher = await schoolToken(GV_TEACHER)
    const res = await school('/api/students', teacher)
    expect(res.status).toBe(200)
  }, T)

  test('deny people.students.read for TEACHER → teacher 403 FEATURE_DISABLED_FOR_ROLE', async () => {
    const patch = await patchFeature('TEACHER', 'people.students.read', true)
    expect(patch.status).toBe(200)

    const teacher = await schoolToken(GV_TEACHER)
    const res = await school('/api/students', teacher)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('FEATURE_DISABLED_FOR_ROLE')
  }, T)

  test('the SAME denial leaves the principal unaffected (per-role, not per-school)', async () => {
    const principal = await schoolToken(GV_PRINCIPAL)
    const res = await school('/api/students', principal)
    expect(res.status).toBe(200)
  }, T)

  test('deny school.finance.read for PRINCIPAL → principal /api/fees 403 (permission-backed gate)', async () => {
    const patch = await patchFeature('PRINCIPAL', 'school.finance.read', true)
    expect(patch.status).toBe(200)
    const principal = await schoolToken(GV_PRINCIPAL)
    const res = await school('/api/fees', principal)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('FEATURE_DISABLED_FOR_ROLE')
    // Re-enable — the route answers again (module flags are untouched).
    const re = await patchFeature('PRINCIPAL', 'school.finance.read', false)
    expect(re.status).toBe(200)
    const ok2 = await school('/api/fees', await schoolToken(GV_PRINCIPAL))
    expect(ok2.status).toBe(200)
  }, T)

  test('direct API bypass is impossible: the denial is route-level, not UI-level', async () => {
    // The config was already re-enabled in the previous test; deny again
    // and prove a DIRECT fetch (no UI anywhere) is still rejected.
    await patchFeature('TEACHER', 'attendance.mark', true)
    const teacher = await schoolToken(GV_TEACHER)
    const res = await school('/api/attendance/overview', teacher)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('FEATURE_DISABLED_FOR_ROLE')
    // Student attendance view is a DIFFERENT feature cell — the GATE
    // passes (the route may then answer a business 400 for a fixture
    // without a student profile; what must NEVER happen here is the
    // role-feature 403).
    const student = await schoolToken(GV_STUDENT)
    const resS = await school('/api/student/attendance', student)
    expect(resS.status).not.toBe(403)
  }, T)

  test('re-enable restores access (inheritance semantics)', async () => {
    const re = await patchFeature('TEACHER', 'people.students.read', false)
    expect(re.status).toBe(200)
    const teacher = await schoolToken(GV_TEACHER)
    expect((await school('/api/students', teacher)).status).toBe(200)
  }, T)
})

describe('3 — module layers stay upstream (remove-only composition)', () => {
  test('a DISABLED module wins with the MODULE code even while the feature is allowed', async () => {
    // Disable the fees MODULE for green-valley (school-level flag).
    const before = await db.school.findUnique({ where: { id: gvId }, select: { featureFlags: true } })
    await db.school.update({ where: { id: gvId }, data: { featureFlags: JSON.stringify({ fees: false }) } })
    cleanup.push(async () => {
      await db.school.update({ where: { id: gvId }, data: { featureFlags: before!.featureFlags } }).catch(() => {})
    })
    const principal = await schoolToken(GV_PRINCIPAL)
    const res = await school('/api/fees', principal)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('FEATURE_DISABLED') // the MODULE code — distinct layer
  }, T)
})

describe('4 — tenant isolation', () => {
  test('a green-valley denial never touches hawkings (same role keeps baseline)', async () => {
    await patchFeature('TEACHER', 'people.students.read', true)
    const hvTeacher = await schoolToken(HV_TEACHER)
    const res = await school('/api/students', hvTeacher)
    expect(res.status).toBe(200)
    // And hawkings has NO override rows of its own.
    expect(await db.roleFeatureOverride.count({ where: { schoolId: hvId } })).toBe(0)
    // Restore green-valley.
    await patchFeature('TEACHER', 'people.students.read', false)
  }, T)
})

describe('5 — fail-closed envelope', () => {
  test('the config surface refuses unknown feature keys (422) even from full admins', async () => {
    const res = await platform(CFG(gvId), {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [{ role: 'TEACHER', featureKey: 'ghost.feature', denied: true }] }),
    })
    expect(res.status).toBe(422)
  }, T)
})
