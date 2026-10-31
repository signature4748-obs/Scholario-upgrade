/**
 * PHASE 3 — ROLE-WISE FEATURE CONTROL — platform API contract.
 *
 * Walks the REAL configuration surface over live HTTP against the seeded
 * corpus (the harness convention — fixture platform sessions, NOT an
 * authorization bypass: every route still enforces its permission):
 *
 *   GET   /api/platform/schools/[id]/role-features   (schools.read)
 *   PATCH /api/platform/schools/[id]/role-features   (schools.manage)
 *
 * Covered here:
 *   · GET shape: three canonical roles, catalog cells, updatedAt token.
 *   · GET/PATCH authz: full admin vs schools.read-only (403 on write),
 *     anonymous (401), unknown school (fail-safe 404).
 *   · PATCH validation: unknown feature (422), unknown role (422), junk
 *     body (422), remove-only violation (422).
 *   · PATCH happy path: deny → re-enable; persistence after re-read;
 *     restrictedCount reflects the state.
 *   · Optimistic concurrency: stale baseUpdatedAt → typed CONFLICT (409),
 *     and the conflicting write must NOT partially apply.
 *   · Audit: platform.school.role_features_updated with per-cell
 *     {role, feature, from, to} metadata.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform/permissions'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

let fullToken = ''
let readOnlyToken = ''
let fullAdminId = ''
let gvId = ''
let phantomId = `ghost${randomBytes(8).toString('hex')}`
const cleanup: Array<() => Promise<unknown>> = []

async function dedicatedAdmin(label: string, keys: string[]): Promise<{ token: string; adminId: string }> {
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
  for (const key of keys) {
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
  return { token: raw, adminId: admin.id }
}

function platform(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': token, ...(init.headers ?? {}) },
  })
}

async function okData<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: T }
  expect(body.ok).toBe(true)
  return body.data
}

const URL = (id: string) => `/api/platform/schools/${id}/role-features`

beforeAll(async () => {
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id
  const full = await dedicatedAdmin('rolefeat-api-admin', [...PLATFORM_PERMISSION_KEYS])
  fullToken = full.token
  fullAdminId = full.adminId
  const ro = await dedicatedAdmin('rolefeat-ro-admin', ['schools.read'])
  readOnlyToken = ro.token
  // Fresh slate for the school under test.
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } })
}, 60_000)

afterAll(async () => {
  await db.roleFeatureOverride.deleteMany({ where: { schoolId: gvId } }).catch(() => {})
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

interface CellDTO { key: string; label: string; group: string; enabled: boolean; inherited: boolean; overridden: boolean; locked: boolean }
interface PayloadDTO { roles: Array<{ role: string; cells: CellDTO[]; restrictedCount: number }>; updatedAt: string | null }

describe('GET role-features — shape + authz', () => {
  test('full admin reads the full config: 3 canonical roles, catalog cells, token', async () => {
    const data = await okData<PayloadDTO>(await platform(URL(gvId), fullToken))
    expect(data.roles.map((r) => r.role).sort()).toEqual(['PRINCIPAL', 'STUDENT', 'TEACHER'])
    const teacher = data.roles.find((r) => r.role === 'TEACHER')!
    expect(teacher.cells.length).toBeGreaterThan(5)
    // Fresh school: nothing overridden, token null.
    expect(teacher.cells.every((c) => !c.overridden && c.inherited)).toBe(true)
    expect(data.updatedAt).toBeNull()
    // Locked cells exist (baseline refuses the role) and are honest.
    const locked = teacher.cells.filter((c) => c.locked)
    expect(locked.length).toBeGreaterThan(0)
    expect(locked.every((c) => !c.enabled))
  }, T)

  test('schools.read-only admin can READ but the school is real (no 404 confusion)', async () => {
    const data = await okData<PayloadDTO>(await platform(URL(gvId), readOnlyToken))
    expect(data.roles.length).toBe(3)
  }, T)

  test('anonymous caller → 401 (platform plane only)', async () => {
    const res = await fetch(`${BASE}${URL(gvId)}`)
    expect(res.status).toBe(401)
  }, T)

  test('unknown school → fail-safe 404 (no existence oracle)', async () => {
    const res = await platform(URL(phantomId), fullToken)
    expect(res.status).toBe(404)
  }, T)
})

describe('PATCH role-features — validation', () => {
  test('junk body → typed 422', async () => {
    const res = await platform(URL(gvId), fullToken, { method: 'PATCH', body: '{not json' })
    expect(res.status).toBe(422)
  }, T)

  test('unknown feature key → 422 (fail closed)', async () => {
    const res = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [{ role: 'TEACHER', featureKey: 'made.up', denied: true }] }),
    })
    expect(res.status).toBe(422)
  }, T)

  test('unknown role → 422', async () => {
    const res = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [{ role: 'PARENT', featureKey: 'attendance.mark', denied: true }] }),
    })
    expect(res.status).toBe(422)
  }, T)

  test('REMOVE-ONLY: denying a feature the baseline refuses → 422', async () => {
    const res = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [{ role: 'STUDENT', featureKey: 'attendance.mark', denied: true }] }),
    })
    expect(res.status).toBe(422)
  }, T)

  test('schools.read-only admin → 403 on write', async () => {
    const res = await platform(URL(gvId), readOnlyToken, {
      method: 'PATCH',
      body: JSON.stringify({ baseUpdatedAt: null, changes: [{ role: 'TEACHER', featureKey: 'attendance.mark', denied: true }] }),
    })
    expect(res.status).toBe(403)
    // And nothing was written.
    expect(await db.roleFeatureOverride.count({ where: { schoolId: gvId } })).toBe(0)
  }, T)
})

describe('PATCH role-features — happy path, concurrency, audit', () => {
  test('deny → persist → restrictedCount reflects → re-enable → clean', async () => {
    // 1. Deny two teacher features.
    const patchRes = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: null,
        changes: [
          { role: 'TEACHER', featureKey: 'attendance.mark', denied: true },
          { role: 'TEACHER', featureKey: 'people.students.read', denied: true },
        ],
      }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await okData<{ applied: number; updatedAt: string }>(patchRes)
    expect(patched.applied).toBe(2)
    expect(patched.updatedAt).toBeTruthy()

    // 2. Persistence — re-read shows overridden cells + token.
    const data = await okData<PayloadDTO>(await platform(URL(gvId), fullToken))
    const teacher = data.roles.find((r) => r.role === 'TEACHER')!
    expect(teacher.restrictedCount).toBe(2)
    const att = teacher.cells.find((c) => c.key === 'attendance.mark')!
    expect(att.enabled).toBe(false)
    expect(att.overridden).toBe(true)
    expect(att.inherited).toBe(false)
    const principal = data.roles.find((r) => r.role === 'PRINCIPAL')!
    expect(principal.restrictedCount).toBe(0)
    expect(data.updatedAt).toBe(patched.updatedAt)

    // 3. Stale token → typed CONFLICT and NO partial application.
    const stale = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: null, // stale: rows now exist
        changes: [{ role: 'PRINCIPAL', featureKey: 'school.finance.read', denied: true }],
      }),
    })
    expect(stale.status).toBe(409)
    const staleBody = (await stale.json()) as { code?: string }
    expect(staleBody.code).toBe('CONFLICT')
    const after = await db.roleFeatureOverride.findFirst({
      where: { schoolId: gvId, role: 'PRINCIPAL' },
    })
    expect(after).toBeNull()

    // 4. Fresh token → the conflicted change applies.
    const good = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: patched.updatedAt,
        changes: [{ role: 'PRINCIPAL', featureKey: 'school.finance.read', denied: true }],
      }),
    })
    expect(good.status).toBe(200)

    // 5. Re-enable (denied:false) removes the rows — inheritance restored.
    const reenable = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: (await okData<{ updatedAt: string }>(good)).updatedAt,
        changes: [
          { role: 'TEACHER', featureKey: 'attendance.mark', denied: false },
          { role: 'TEACHER', featureKey: 'people.students.read', denied: false },
        ],
      }),
    })
    expect(reenable.status).toBe(200)
    const final = await okData<PayloadDTO>(await platform(URL(gvId), fullToken))
    expect(final.roles.find((r) => r.role === 'TEACHER')!.restrictedCount).toBe(0)
  }, T)

  test('every applied change is audited with per-cell from/to metadata', async () => {
    const marker = `rf-audit-${randomBytes(3).toString('hex')}`
    // The current token (rows may exist from earlier tests — the lock is global per school).
    const cur = await okData<{ updatedAt: string | null }>(await platform(URL(gvId), fullToken))
    const patchRes = await platform(URL(gvId), fullToken, {
      method: 'PATCH',
      body: JSON.stringify({
        baseUpdatedAt: cur.updatedAt,
        reason: marker,
        changes: [{ role: 'TEACHER', featureKey: 'messaging.send', denied: true }],
      }),
    })
    expect(patchRes.status).toBe(200)
    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId: gvId, action: 'platform.school.role_feature_updated', reason: marker },
    })
    expect(audit).not.toBeNull()
    expect(audit!.adminId).toBe(fullAdminId)
    // metadata is stored as a JSON string (platformAuditEvent clips at 2,000 chars).
    const rawMeta = audit!.metadata as unknown
    const meta = (typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta) as {
      role: string
      feature: string
      from: boolean
      to: boolean
      batch: string
    }
    expect(meta.role).toBe('TEACHER')
    expect(meta.feature).toBe('messaging.send')
    expect(meta.from).toBe(true)
    expect(meta.to).toBe(false)
    expect(typeof meta.batch).toBe('string')
    // No secrets by construction — keys and booleans only.
    const raw = JSON.stringify(audit!.metadata)
    expect(raw).not.toMatch(/password|secret|token/i)
  }, T)
})
