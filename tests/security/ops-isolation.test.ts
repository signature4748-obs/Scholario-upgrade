import { db } from '../helpers/db'
/**
 * PLATFORM OPERATIONS CENTER — ISOLATION & AUTHORIZATION SUITE.
 *
 * THE INVARIANTS UNDER TEST (mission §14):
 *
 *   1. Root admin (ops.read implicit) CAN access the operations center.
 *   2. A NON-ROOT platform admin WITHOUT ops.read CANNOT (403 — the
 *      permission key fails closed; OPS_DEFAULT_PERMISSIONS deliberately
 *      excludes ops.read). The fixture admin is created BY THIS SUITE
 *      (ACTIVE, explicitly granted schools.read only) so the verdict
 *      depends on the permission model, not on seeded account state.
 *   3. NO school credential (Principal) can reach ANY
 *      /api/platform/operations/* route (401 — the platform API
 *      boundary; school transports are never consulted).
 *   4. An unauthenticated request cannot reach the center (401).
 *   5. School usage is attributed to the CORRECT tenant: an
 *      authenticated school API call by the Hawkings principal
 *      materializes as an apiOperations count attributed to the
 *      Hawkings school (server-derived identity — never a
 *      client-supplied id).
 *
 * LIVE HTTP integration suite against the dev server
 * (http://localhost:3000) — same fixture style as the Phase-6
 * platform-isolation suite. Logins go through the REAL auth APIs with
 * a direct-session fixture fallback (bypassing ONLY the login
 * rate limiter, never an authorization gate). The non-root admin is
 * suite-owned and cleaned up in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes, createHash, randomUUID } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import {
  DEMO_PRINCIPAL_EMAIL,
  PLATFORM_ROOT_PASSWORD,
  PLATFORM_ROOT_TOTP_SECRET,
} from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const ROOT_EMAIL = 'admin@scholario.cloud'

const RUN_IP = `10.242.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const OPS_ROUTES = [
  '/api/platform/operations/overview',
  '/api/platform/operations/usage',
  '/api/platform/operations/errors',
  '/api/platform/operations/health',
  '/api/platform/operations/school-usage',
  '/api/platform/operations/alerts',
  '/api/platform/operations/alerts/settings',
  '/api/platform/operations/diagnostics',
]

async function totpNow(secret: string): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  return mod.totpAt(secret)
}

/** Platform login → raw token; direct-session fallback on 429 or any
 * login refusal (fresh environments log in for real; the fixture only
 * bypasses the login limiter / any environment-local password state). */
async function platformSession(email: string, password?: string, totpSecret?: string): Promise<string> {
  try {
    const code = totpSecret ? await totpNow(totpSecret) : '000000'
    const res = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email, password: password ?? 'wrong-password-fixture', totpCode: code }),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null
    if (body?.ok && body.data?.sessionToken) return body.data.sessionToken
  } catch {
    /* fall through to the direct fixture */
  }
  return directPlatformSession(email)
}

async function directPlatformSession(email: string): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email } })
  if (!admin) throw new Error(`no platform admin ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

async function schoolSession(email: string, password?: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password: password ?? 'wrong-password-fixture' }),
  }).catch(() => null)
  const body = res ? ((await res.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null) : null
  if (body?.ok && body.data?.sessionToken) return body.data.sessionToken
  return directSchoolSession(email)
}

async function directSchoolSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

const asPlatform = (token: string, path: string) =>
  fetch(`${BASE}${path}`, { headers: { 'x-platform-token': token, 'content-type': 'application/json' } })

const asSchool = (token: string, path: string) =>
  fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })

describe('Operations center — cross-tenant monitoring authorization', () => {
  let rootToken: string
  let limitedAdminToken: string
  let principalToken: string
  let hawkingsSchoolId: string | null = null
  const fixtureEmail = `ops-isolation-fixture-${randomUUID().slice(0, 8)}@scholario.test`
  let fixtureAdminId: string | null = null

  beforeAll(async () => {
    rootToken = await platformSession(ROOT_EMAIL, PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET)
    principalToken = await schoolSession(DEMO_PRINCIPAL_EMAIL)

    // Suite-owned fixture: ACTIVE non-root admin with schools.read ONLY
    // (ops.read deliberately NOT granted — the fail-closed case).
    const created = await db.platformAdmin.create({
      data: {
        email: fixtureEmail,
        // scrypt-format placeholder hash — this admin never logs in via
        // password (direct-session fixture only) and is deleted after.
        passwordHash: 'fixture:fixture',
        name: 'Ops Isolation Fixture',
        status: 'ACTIVE',
        isRoot: false,
        isDemo: false,
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    })
    fixtureAdminId = created.id
    await db.platformPermission.create({
      data: { adminId: created.id, key: 'schools.read', granted: true },
    })
    limitedAdminToken = await directPlatformSession(fixtureEmail)

    const principal = await db.user.findUnique({ where: { email: DEMO_PRINCIPAL_EMAIL } })
    hawkingsSchoolId = principal?.schoolId ?? null
  })

  afterAll(async () => {
    // Fixture cleanup (suite-owned rows only).
    if (fixtureAdminId) {
      await db.platformAdminSession.deleteMany({ where: { adminId: fixtureAdminId } })
      await db.platformPermission.deleteMany({ where: { adminId: fixtureAdminId } })
      await db.platformAdmin.deleteMany({ where: { id: fixtureAdminId } })
    }
  })

  test('root admin accesses every operations endpoint (ops.read implicit)', async () => {
    for (const route of OPS_ROUTES) {
      const res = await asPlatform(rootToken, route)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)
    }
  })

  test('non-root platform admin WITHOUT ops.read is FORBIDDEN on every route (fail-closed)', async () => {
    for (const route of OPS_ROUTES) {
      const res = await asPlatform(limitedAdminToken, route)
      expect(res.status).toBe(403)
      const body = (await res.json()) as { ok: boolean; code?: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('FORBIDDEN')
    }
  })

  test('mutations (sync / health-run / ack) are permission-gated, not UI-gated', async () => {
    for (const [path, method] of [
      ['/api/platform/operations/usage/sync', 'POST'],
      ['/api/platform/operations/health/run', 'POST'],
      ['/api/platform/operations/alerts/settings', 'PUT'],
      ['/api/platform/operations/errors/abc/resolve', 'POST'],
    ] as const) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'x-platform-token': limitedAdminToken, 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(403)
    }
  })

  test('NO school credential reaches the operations surface (401 for every route)', async () => {
    for (const route of OPS_ROUTES) {
      const res = await asSchool(principalToken, route)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { code?: string }
      expect(body.code).toBe('AUTH_REQUIRED')
    }
  })

  test('unauthenticated requests are refused (401)', async () => {
    const res = await fetch(`${BASE}/api/platform/operations/overview`)
    expect(res.status).toBe(401)
  })

  test('school usage metering attributes to the SERVER-derived tenant', async () => {
    // The principal exercises an authenticated school API (real usage).
    const me = await asSchool(principalToken, '/api/auth/me')
    expect(me.status).toBe(200)

    // The principal CANNOT read the usage surface (boundary first).
    const probe = await asSchool(principalToken, '/api/platform/operations/school-usage')
    expect(probe.status).toBe(401)

    // Root sees the usage attributed to the Hawkings school. Metering is
    // fire-and-forget — poll briefly for the atomic counter to land.
    expect(hawkingsSchoolId).toBeTruthy()
    let attributed = false
    for (let attempt = 0; attempt < 12 && !attributed; attempt++) {
      const res = await asPlatform(rootToken, `/api/platform/operations/school-usage?days=1`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: { rows: Array<{ schoolId: string; apiOperations: number }> }
      }
      const row = body.data.rows.find((r) => r.schoolId === hawkingsSchoolId)
      if (row && row.apiOperations > 0) attributed = true
      else await new Promise((r) => setTimeout(r, 400))
    }
    expect(attributed).toBe(true)
  })

  test('the error-detail drill-down answers 401 to school identities, never a data-shaped response', async () => {
    const res = await asSchool(principalToken, `/api/platform/operations/errors/${'a'.repeat(40)}`)
    expect(res.status).toBe(401)
  })

  test('the cron endpoint is not an unauthenticated backdoor', async () => {
    const res = await fetch(`${BASE}/api/cron/ops-sync`, { method: 'POST' })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; skipped?: boolean } | null
    // Unified/school plane answers the honest skip (200 {skipped});
    // the platform plane without a session/secret answers 401. BOTH safe.
    if (res.status === 200) {
      expect(body?.skipped).toBe(true)
    } else {
      expect([401, 403]).toContain(res.status)
    }
  })
})
