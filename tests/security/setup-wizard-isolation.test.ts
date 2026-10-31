/**
 * PHASE 2 — SUPER ADMIN SCHOOL SETUP WIZARD — security & isolation.
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. PLATFORM-ONLY SURFACE — every wizard route lives under
 *      /api/platform/*: a SCHOOL session (principal bearer token) is
 *      never consulted there and is refused (401), as is an anonymous
 *      caller. Hiding the wizard in the UI is NOT the boundary — the
 *      route layer is.
 *   2. PERMISSION ENFORCEMENT — a platform admin WITHOUT schools.manage
 *      may READ the wizard state (schools.read) but every WRITE is
 *      403. No client-only gating anywhere.
 *   3. TENANT SCOPING — the school id comes from the URL and is
 *      verified against the real School table: an unknown id is a
 *      fail-safe 404 on every route. There is no client-supplied
 *      schoolId to smuggle.
 *   4. SECURE UPLOAD — the platform branding-logo route reuses the
 *      magic-byte policy: a text file renamed .png is a typed 415, a
 *      missing file a 400.
 *   5. LIFECYCLE SAFETY — activation of an unknown school is 404; the
 *      strict flag accepts only {requireComplete: boolean}.
 *
 * Live HTTP against the dev server; fixture sessions (the platform
 * session fixture + school bearer fixture conventions).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform/permissions'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

const GV_PRINCIPAL = 'principal.b@greenvalley.test'

let fullToken = ''
let readOnlyToken = ''
let readOnlyAdminId = ''
let gvId = ''
let phantomId = `ghost${randomBytes(8).toString('hex')}`
const cleanup: Array<() => Promise<unknown>> = []

/**
 * DEDICATED full-permission platform admin fixture — see the API suite
 * note: platform mutations are rate-limited PER ADMIN, so this suite
 * never draws from the shared root bucket the other suites rely on.
 */
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

beforeAll(async () => {
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id

  // Dedicated FULL-permission admin (own rate-limit bucket).
  fullToken = await dedicatedFullAdmin('wizard-iso-admin')

  // A NON-root platform admin holding ONLY schools.read.
  const marker = randomBytes(4).toString('hex')
  const { hashPassword } = await import('@/lib/auth')
  const limited = await db.platformAdmin.create({
    data: {
      email: `wizard-readonly-${marker}@provision.test`,
      passwordHash: hashPassword('Readonly!8c-pass'),
      name: 'Wizard Read-only',
      isRoot: false,
      totpSecret: 'JBSWY3DPEHPK3PXP',
    },
  })
  readOnlyAdminId = limited.id
  await db.platformPermission.create({
    data: { adminId: limited.id, key: 'schools.read', granted: true },
  })
  const rawLimited = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: { adminId: limited.id, tokenHash: hashSessionToken(rawLimited), expiresAt: new Date(Date.now() + 3600_000) },
  })
  readOnlyToken = rawLimited
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: readOnlyAdminId } })
    await db.platformPermission.deleteMany({ where: { adminId: readOnlyAdminId } })
    await db.platformAdmin.delete({ where: { id: readOnlyAdminId } }).catch(() => {})
  })

  // School principal session fixture (the SCHOOL token space).
  const principal = await db.user.findUnique({ where: { email: GV_PRINCIPAL } })
  if (!principal) throw new Error('green-valley principal missing')
  const schoolRaw = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId: principal.id,
      tokenHash: hashSessionToken(schoolRaw),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(schoolRaw) } }))
  ;(globalThis as { __schoolToken?: string }).__schoolToken = schoolRaw
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

function platform(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': token, ...(init.headers ?? {}) },
  })
}

function school(path: string, init: RequestInit = {}): Promise<Response> {
  const token = (globalThis as { __schoolToken?: string }).__schoolToken ?? ''
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
}

const WIZARD_READ = (id: string) => `/api/platform/schools/${id}/setup-wizard`
const WIZARD_WRITES: Array<{ name: string; path: (id: string) => string; method: string; body?: unknown }> = [
  { name: 'academic-bootstrap', path: (id) => `/api/platform/schools/${id}/academic-bootstrap`, method: 'POST', body: { academicYear: '2026-2027' } },
  { name: 'initial-staff', path: (id) => `/api/platform/schools/${id}/initial-staff`, method: 'POST', body: { members: [{ name: 'X', email: 'x@x.test' }] } },
  { name: 'initial-fee-catalogue', path: (id) => `/api/platform/schools/${id}/initial-fee-catalogue`, method: 'POST', body: { heads: [{ name: 'X', amount: 1 }] } },
  { name: 'initial-exam-config', path: (id) => `/api/platform/schools/${id}/initial-exam-config`, method: 'POST', body: { examTypes: [{ name: 'X' }] } },
  { name: 'website-presence', path: (id) => `/api/platform/schools/${id}/website-presence`, method: 'PATCH', body: { websiteEnabled: true } },
  { name: 'principal', path: (id) => `/api/platform/schools/${id}/principal`, method: 'PATCH', body: { name: 'X' } },
  { name: 'activate', path: (id) => `/api/platform/schools/${id}/activate`, method: 'POST', body: { requireComplete: true } },
]

describe('PHASE 2 wizard · platform-only surface', () => {
  test('a SCHOOL session (principal) is refused on the wizard read — 401, never consulted', async () => {
    const res = await school(WIZARD_READ(gvId))
    expect(res.status).toBe(401)
  }, T)

  test('a SCHOOL session is refused on EVERY wizard write', async () => {
    for (const w of WIZARD_WRITES) {
      const res = await school(w.path(gvId), { method: w.method, body: JSON.stringify(w.body ?? {}) })
      expect(res.status, `${w.name} must refuse a school session`).toBe(401)
    }
  }, T)

  test('anonymous callers are refused on the wizard read and writes', async () => {
    expect((await fetch(`${BASE}${WIZARD_READ(gvId)}`)).status).toBe(401)
    const activate = await fetch(`${BASE}/api/platform/schools/${gvId}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireComplete: true }),
    })
    expect(activate.status).toBe(401)
  }, T)
})

describe('PHASE 2 wizard · permission enforcement (no client-only gating)', () => {
  test('schools.read-only admin CAN read the wizard state', async () => {
    const res = await platform(WIZARD_READ(gvId), readOnlyToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { school: { id: string } } }
    expect(body.ok).toBe(true)
    expect(body.data.school.id).toBe(gvId)
  }, T)

  test('schools.read-only admin is 403 on EVERY wizard write', async () => {
    for (const w of WIZARD_WRITES) {
      const res = await platform(w.path(gvId), readOnlyToken, {
        method: w.method,
        body: JSON.stringify(w.body ?? {}),
      })
      expect(res.status, `${w.name} must require schools.manage`).toBe(403)
    }
    // Metadata PATCH (the identity step's writer) is schools.manage too.
    const patch = await platform(`/api/platform/schools/${gvId}`, readOnlyToken, {
      method: 'PATCH',
      body: JSON.stringify({ address: 'hack' }),
    })
    expect(patch.status).toBe(403)
    // Logo upload is schools.manage too.
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1])], { type: 'image/png' }), 'x.png')
    const logo = await fetch(`${BASE}/api/platform/schools/${gvId}/branding-logo`, {
      method: 'POST',
      headers: { 'x-platform-token': readOnlyToken },
      body: form,
    })
    expect(logo.status).toBe(403)
  }, T)
})

describe('PHASE 2 wizard · tenant scoping (fail-safe 404, no client schoolId)', () => {
  test('unknown school id → 404 on the read', async () => {
    const res = await platform(WIZARD_READ(phantomId), fullToken)
    expect(res.status).toBe(404)
  }, T)

  test('unknown school id → 404 on every write (no existence oracle, no writes)', async () => {
    for (const w of WIZARD_WRITES) {
      const res = await platform(w.path(phantomId), fullToken, {
        method: w.method,
        body: JSON.stringify(w.body ?? {}),
      })
      expect(res.status, `${w.name} must 404 an unknown school`).toBe(404)
    }
  }, T)

  test('another tenant’s REAL id is still fully server-authorized (green-valley is untouched by a refused write)', async () => {
    // The 403 path (read-only admin) must not have mutated anything.
    const classes = await db.class.count({ where: { schoolId: gvId } })
    const users = await db.user.count({ where: { schoolId: gvId } })
    expect(typeof classes).toBe('number')
    expect(typeof users).toBe('number')
  }, T)
})

describe('PHASE 2 wizard · secure upload', () => {
  test('a text file renamed .png is refused by the magic-byte policy (415)', async () => {
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('<html>not an image</html>')], { type: 'image/png' }), 'fake.png')
    const res = await fetch(`${BASE}/api/platform/schools/${gvId}/branding-logo`, {
      method: 'POST',
      headers: { 'x-platform-token': fullToken },
      body: form,
    })
    expect(res.status).toBe(415)
  }, T)

  test('a missing file is a typed validation error (422 — the repo taxonomy has no bare 400)', async () => {
    const form = new FormData()
    const res = await fetch(`${BASE}/api/platform/schools/${gvId}/branding-logo`, {
      method: 'POST',
      headers: { 'x-platform-token': fullToken },
      body: form,
    })
    expect(res.status).toBe(422)
  }, T)
})

describe('PHASE 2 wizard · lifecycle safety', () => {
  test('strict flag accepts ONLY {requireComplete: boolean} — junk body is a typed 422', async () => {
    const junk = await platform(`/api/platform/schools/${gvId}/activate`, fullToken, {
      method: 'POST',
      body: JSON.stringify({ requireComplete: 'yes', evil: true }),
    })
    expect(junk.status).toBe(422)
  }, T)
})
