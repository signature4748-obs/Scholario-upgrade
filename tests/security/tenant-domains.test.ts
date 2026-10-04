/**
 * PHASE 8B (§10–§13) + PRODUCT-DIRECTION RESET — multi-tenant custom-domain
 * architecture tests.
 *
 * Layer 1 (unit, pure): hostname normalization + validation.
 * Layer 2 (live HTTP + DB): the domain→tenant pipeline under the
 * PLATFORM-OWNED domain model (SaaS-HARDENING §4):
 *   · school-plane /api/school/domains is READ-ONLY STATUS (GET) —
 *     principal domain request/self-verify/DNS-instruction endpoints
 *     were REMOVED (mutation lives exclusively behind
 *     /api/platform/schools/[id]/domains with schools.manage + step-up);
 *   · an unverified TenantDomain mapping resolves NOTHING (404);
 *   · a VERIFIED mapping resolves THE school (over any fallback) and
 *     its www-variant too;
 *   · hostile hosts never resolve a foreign tenant; cache isolation
 *     between hosts holds;
 *   · role/auth boundaries (teacher 403, anonymous 401, school session
 *     can never reach the platform domain API).
 *
 * Fixture tenants: Hawkings High School (demo) + Green Valley (clean).
 * Domain rows are planted DIRECTLY (db) — simulating exactly what a
 * platform admin's verified mapping looks like — and cleaned up in
 * afterAll (`it-` hostname marker only).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { normalizeHostname, hostnameRejectionReason } from '../../src/lib/tenant/hostname'
import { hashSessionToken } from '../../src/lib/auth'
import { DEMO_PRINCIPAL_PASSWORD, DEMO_TEACHER_1_PASSWORD, TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

const DEMO_PRINCIPAL = 'principal@hawkingshigh.edu'
const GV_PRINCIPAL = 'principal@greenvalley.test'

// DB access via the SHARED test client (tests/helpers/db.ts — the
// Supavisor session-pool budget is 15 and every extra PrismaClient pool
// is a real cost; never $disconnect the singleton mid-suite).
import { db } from '../helpers/db'

const MARKER = `it-${Date.now().toString(36)}`
const TEST_HOSTNAME = `${MARKER}.example.org`

/** Established suite pattern (tenant-isolation): real login first; on a
 * 429 from rapid re-runs fall back to a DIRECT session row (auth fixture,
 * NOT an authorization bypass) riding the dev Bearer path. */
async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (r.status === 429) return directSession(email)
  const body = (await r.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null
  const token = body?.data?.sessionToken
  if (!r.ok || !token) throw new Error(`login failed for ${email}: ${r.status}`)
  return token
}

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function api(
  token: string,
  path: string,
  init: { method?: string; body?: unknown; host?: string } = {},
): Promise<{ status: number; json: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.host ? { Host: init.host } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  })
  const json = await r.json().catch(() => null)
  return { status: r.status, json }
}

describe('Phase 8B · hostname normalization + validation (unit)', () => {
  test('normalizeHostname: port, protocol, case, trailing dots, www', () => {
    expect(normalizeHostname('School-A.com:443')).toBe('school-a.com')
    expect(normalizeHostname('https://www.School-A.com/path?q=1')).toBe('school-a.com')
    expect(normalizeHostname('WWW.school-a.com.')).toBe('school-a.com')
    expect(normalizeHostname('www.school-a.com')).toBe('school-a.com')
    expect(normalizeHostname('school-a.com')).toBe('school-a.com')
    expect(normalizeHostname('')).toBe(null)
    expect(normalizeHostname(null)).toBe(null)
  })

  test('hostnameRejectionReason: rejects the hostile/invalid shapes', () => {
    expect(hostnameRejectionReason('school-a.com')).toBe(null)
    expect(hostnameRejectionReason('sub.school-a.co.in')).toBe(null)
    expect(hostnameRejectionReason('199.199.199.199')).toContain('IP')
    expect(hostnameRejectionReason('school')).toContain('dot')
    expect(hostnameRejectionReason('x.vercel.app')).toContain('deployment')
    expect(hostnameRejectionReason('-bad.com')).toContain('well-formed')
    expect(hostnameRejectionReason('localhost')).toContain('reserved')
    expect(hostnameRejectionReason('a'.repeat(64) + '.com')).toContain('label')
  })
})

describe('Phase 8B · tenant domain pipeline (live HTTP + DB)', () => {
  let gvCookie: string // bearer session token
  let demoCookie: string
  let gvDomainId: string
  let gvSchoolId: string

  beforeAll(async () => {
    gvCookie = await login(GV_PRINCIPAL, TENANT_FIXTURE_PASSWORD)
    demoCookie = await login(DEMO_PRINCIPAL, DEMO_PRINCIPAL_PASSWORD)
    // clean any residue from an interrupted earlier run
    await db.tenantDomain.deleteMany({ where: { hostname: { startsWith: 'it-' } } })
    // The platform-owned pipeline simulation: a mapping a platform admin
    // created (PENDING, real token — exactly the wizard's shape).
    const gv = await db.school.findUniqueOrThrow({ where: { slug: 'green-valley' } })
    gvSchoolId = gv.id
    const row = await db.tenantDomain.create({
      data: {
        schoolId: gv.id,
        hostname: TEST_HOSTNAME,
        isPrimary: true,
        status: 'PENDING',
        verificationToken: randomBytes(16).toString('hex'),
      },
    })
    gvDomainId = row.id
  }, T)

  afterAll(async () => {
    await db.tenantDomain.deleteMany({ where: { hostname: { startsWith: 'it-' } } })
    for (const t of [gvCookie, demoCookie]) {
      if (t) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(t) } }).catch(() => {})
    }
    // NOTE: no db.$disconnect() — the shared client serves the whole suite.
  }, T)

  test('unauthenticated /api/school/domains → 401', async () => {
    const r = await fetch(`${BASE}/api/school/domains`)
    expect(r.status).toBe(401)
  }, T)

  test('teacher role is rejected from domain management (403)', async () => {
    const cookie = await login('teacher1@hawkingshigh.edu', DEMO_TEACHER_1_PASSWORD)
    const { status } = await api(cookie, '/api/school/domains')
    expect(status).toBe(403)
  }, T)

  test('principal domain REQUEST is retired: POST /api/school/domains → 405 (platform-owned)', async () => {
    // PRODUCT-DIRECTION RESET + SaaS-HARDENING §4: the school-plane
    // surface is GET-only status. DNS instructions, verification
    // tokens and routing control are NEVER exposed to school users.
    const { status, json } = await api(gvCookie, '/api/school/domains', {
      method: 'POST',
      body: { hostname: `WWW.${TEST_HOSTNAME}` },
    })
    expect([405, 404]).toContain(status) // no school-plane mutation exists
    expect(json?.data?.domain ?? null).toBe(null)
  }, T)

  test('removed school-plane verify endpoint → 404 for any caller', async () => {
    const { status } = await api(gvCookie, `/api/school/domains/${gvDomainId}/verify`, {
      method: 'POST',
    })
    expect(status).toBe(404)
    const cross = await api(demoCookie, `/api/school/domains/${gvDomainId}/verify`, {
      method: 'POST',
    })
    expect(cross.status).toBe(404)
  }, T)

  test('PENDING mapping does NOT resolve (nothing is served — no fallback, never GV)', async () => {
    const r = await fetch(`${BASE}/api/schools/public`, { headers: { Host: TEST_HOSTNAME } })
    const j = (await r.json().catch(() => null)) as { data?: { slug?: string } } | null
    // PRODUCT-DIRECTION RESET: the demo/single-school fallback is retired —
    // an unverified mapping resolves NOTHING (404). Strictly stronger than
    // the old "falls back to the demo school" behavior: no tenant data of
    // ANY kind is served for an unverified hostname.
    expect(r.status).toBe(404)
    expect(j?.data?.slug ?? null).toBe(null)
  }, T)

  test('cross-tenant duplicate request is retired with the POST surface (405, platform-owned)', async () => {
    // The duplicate-hostname CONFLICT logic still exists — on the
    // platform plane (covered by the saas-hardening suite). The school
    // plane no longer accepts hostname submissions at all.
    const { status } = await api(demoCookie, '/api/school/domains', {
      method: 'POST',
      body: { hostname: TEST_HOSTNAME },
    })
    expect([405, 404]).toContain(status)
  }, T)

  test('VERIFIED mapping (platform-verified) resolves GREEN VALLEY on that host', async () => {
    // flip the row to VERIFIED exactly like a successful platform-side
    // DNS TXT check would
    await db.tenantDomain.update({
      where: { id: gvDomainId },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    })
    const r = await fetch(`${BASE}/api/schools/public`, { headers: { Host: TEST_HOSTNAME } })
    const j = (await r.json().catch(() => null)) as { data?: { slug?: string; schoolId?: string } } | null
    expect(r.status).toBe(200)
    expect(j?.data?.slug).toBe('green-valley')
    expect(j?.data?.id).toBe(gvSchoolId)
  }, T)

  test('www variant of a verified mapping resolves the same tenant', async () => {
    const r = await fetch(`${BASE}/api/schools/public`, {
      headers: { Host: `www.${TEST_HOSTNAME}` },
    })
    const j = (await r.json().catch(() => null)) as { data?: { slug?: string } } | null
    expect(r.status).toBe(200)
    expect(j?.data?.slug).toBe('green-valley')
  }, T)

  test('hostile random host never resolves another tenant (demo fallback is safe)', async () => {
    const r = await fetch(`${BASE}/api/schools/public`, {
      headers: { Host: `${MARKER}-evil.example.org` },
    })
    const j = (await r.json().catch(() => null)) as { data?: { slug?: string } } | null
    expect(j?.data?.slug).not.toBe('green-valley')
  }, T)

  test('cache isolation: consecutive A/B/A host requests never mix tenant payloads', async () => {
    const fetchSlug = async (host: string) => {
      const r = await fetch(`${BASE}/api/schools/public`, { headers: { Host: host } })
      const j = (await r.json().catch(() => null)) as { data?: { slug?: string } } | null
      return j?.data?.slug
    }
    // A = verified GV host, B = unrouted host (demo fallback), A again
    const a1 = await fetchSlug(TEST_HOSTNAME)
    const b = await fetchSlug(`${MARKER}-b.example.org`)
    const a2 = await fetchSlug(TEST_HOSTNAME)
    expect(a1).toBe('green-valley')
    expect(b).not.toBe('green-valley')
    expect(a2).toBe('green-valley')
    expect(r => r.headers?.get?.('cache-control') ?? '') // placeholder no-op
    // explicit no-store assertion
    const rr = await fetch(`${BASE}/api/schools/public`, { headers: { Host: TEST_HOSTNAME } })
    expect((rr.headers.get('cache-control') ?? '')).toContain('no-store')
  }, T)

  test('principal GET lists the school domains WITHOUT infrastructure detail (platform-owned)', async () => {
    const { status, json } = await api(gvCookie, '/api/school/domains')
    expect(status).toBe(200)
    const rows = (json?.data?.domains ?? []) as Array<{
      hostname: string
      status: string
      verificationToken?: unknown
      instructions?: unknown
    }>
    const mine = rows.find((d) => d.hostname === TEST_HOSTNAME)
    expect(mine?.status).toBe('VERIFIED')
    // The read-only status surface must never carry DNS instructions or
    // verification tokens (infrastructure credentials).
    expect(mine?.verificationToken).toBeUndefined()
    expect(mine?.instructions).toBeUndefined()
    expect(String(json?.data?.note ?? '')).not.toBe('')
  }, T)

  test('platform boundary: school session cannot call the platform domain API (401)', async () => {
    const r = await fetch(`${BASE}/api/platform/schools/${gvSchoolId}/domains`, {
      headers: { Authorization: `Bearer ${gvCookie}` },
    })
    expect(r.status).toBe(401)
  }, T)
})
