/**
 * PHASE 8B (§10–§13) — multi-tenant custom-domain architecture tests.
 *
 * Layer 1 (unit, pure): hostname normalization + validation.
 * Layer 2 (live HTTP + DB): the full domain→tenant pipeline —
 *   request (school plane) → PENDING does NOT resolve → DNS verify fails
 *   honestly → VERIFIED mapping resolves THE school (over the demo
 *   fallback) → www-variant resolves → cross-tenant duplicate rejected
 *   (409) → cross-tenant verify rejected (404) → role/auth boundaries.
 *
 * Fixture tenants: Hawkings High School (demo) + Green Valley (clean). All
 * created rows are cleaned up in afterAll (TenantDomain rows with the
 * `it-` hostname marker only).
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

  test('principal requests a domain → PENDING + exact DNS instructions', async () => {
    const { status, json } = await api(gvCookie, '/api/school/domains', {
      method: 'POST',
      body: { hostname: `WWW.${TEST_HOSTNAME}` }, // normalization happens server-side
    })
    expect(status).toBe(200)
    expect(json?.data?.domain?.hostname).toBe(TEST_HOSTNAME)
    expect(json?.data?.domain?.status).toBe('PENDING')
    const inst = json?.data?.instructions
    expect(inst?.verificationTxt?.name).toBe(`_scholario-verify.${TEST_HOSTNAME}`)
    expect(String(inst?.verificationTxt?.value ?? '')).toMatch(/^scholario-verify=[0-9a-f]{32}$/)
    expect(['CNAME', 'A']).toContain(inst?.routing?.type)
    gvDomainId = json?.data?.domain?.id
    gvSchoolId = await db.school.findUniqueOrThrow({ where: { slug: 'green-valley' } }).then((s) => s.id)
    expect(gvDomainId).toBeTruthy()
  }, T)

  test('invalid hostnames are rejected with a reason (400)', async () => {
    for (const bad of ['school', '10.0.0.1', 'x.vercel.app', 'https://x']) {
      const { status, json } = await api(gvCookie, '/api/school/domains', {
        method: 'POST',
        body: { hostname: bad },
      })
      expect(status).toBe(422) // INVALID_INPUT taxonomy (validated rejects)
      expect(String(json?.error ?? '')).not.toBe('')
    }
  }, T)

  test('PENDING mapping does NOT resolve (falls back to demo school, never GV)', async () => {
    const r = await fetch(`${BASE}/api/schools/public`, { headers: { Host: TEST_HOSTNAME } })
    const j = (await r.json().catch(() => null)) as { data?: { slug?: string } } | null
    expect(r.status).toBe(200)
    expect(j?.data?.slug).not.toBe('green-valley')
  }, T)

  test('cross-tenant duplicate: demo principal requests the SAME hostname → 409', async () => {
    const { status, json } = await api(demoCookie, '/api/school/domains', {
      method: 'POST',
      body: { hostname: TEST_HOSTNAME },
    })
    expect(status).toBe(409)
    expect(String(json?.error ?? '')).toContain(TEST_HOSTNAME)
  }, T)

  test('cross-tenant verify: demo principal cannot verify GV domain (404, no oracle)', async () => {
    const { status } = await api(demoCookie, `/api/school/domains/${gvDomainId}/verify`, {
      method: 'POST',
    })
    expect(status).toBe(404)
  }, T)

  test('self-verify fails honestly while DNS records are absent (stays PENDING with summary)', async () => {
    const { status, json } = await api(gvCookie, `/api/school/domains/${gvDomainId}/verify`, {
      method: 'POST',
    })
    expect(status).toBe(200)
    expect(json?.data?.domain?.status).toBe('PENDING')
    expect(String(json?.data?.summary ?? '')).toContain('Pending')
  }, T)

  test('VERIFIED mapping resolves GREEN VALLEY on that host (overrides demo fallback)', async () => {
    // flip the row to VERIFIED exactly like a successful DNS TXT check would
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

  test('principal GET lists the school domains with instructions', async () => {
    const { status, json } = await api(gvCookie, '/api/school/domains')
    expect(status).toBe(200)
    const rows = (json?.data?.domains ?? []) as Array<{ hostname: string; status: string; instructions: unknown }>
    const mine = rows.find((d) => d.hostname === TEST_HOSTNAME)
    expect(mine?.status).toBe('VERIFIED')
    expect(mine?.instructions).toBeTruthy()
  }, T)

  test('platform boundary: school session cannot call the platform domain API (401)', async () => {
    const r = await fetch(`${BASE}/api/platform/schools/${gvSchoolId}/domains`, {
      headers: { Authorization: `Bearer ${gvCookie}` },
    })
    expect(r.status).toBe(401)
  }, T)
})
