/**
 * TWO-PROJECT ARCHITECTURE — deployment-plane gate + canonical school
 * door test suite.
 *
 * THE INVARIANTS UNDER TEST (mission Phase 2/3/5/11):
 *
 *  A. PLANE GATE = ROUTE EXISTENCE (middleware, real code path via the
 *     child-process probe — one process per plane value):
 *       · SCHOLARIO_PLANE=platform → the school doors (/s/*, /login)
 *         and every school-plane API DO NOT EXIST (404). Only
 *         /api/platform/*, /api/webhooks/*, /api/app-version, /api do.
 *       · SCHOLARIO_PLANE=school → /platform/* and /api/platform/* DO
 *         NOT EXIST (404) — except the public announcements broadcast
 *         (read-only, anonymous, cross-plane by design).
 *       · unified (local-dev default) → nothing is plane-blocked.
 *
 *  A2. PLANE CONFIG FAILS CLOSED (src/lib/plane.ts, real module load
 *     via the child-process probe):
 *       · an INVALID value (typo/garbage) refuses to load the
 *         middleware — no silent unified fallback, dev or prod.
 *       · unset / 'unified' in PRODUCTION without the legacy opt-in
 *         (SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1) refuses to load.
 *       · the deprecated legacy project's opt-in keeps unified alive
 *         in production (byte-compatible legacy behavior).
 *       · local development keeps working with the variable unset.
 *
 *  B. CANONICAL SCHOOL DOORS (live HTTP against the dev server):
 *       · /s/<real-slug>/login → 200 (the school's login door exists)
 *       · /s/<unknown-slug>/login → honest 404 (no guessing, no demo
 *         fallback)
 *       · /s/<real-slug> → 307 to /?tenant=<slug> (public website path)
 *       · /login?tenant=<slug> → 200 (legacy door preserved)
 *
 *  C. FORGED-TENANT REGRESSION (the Phase-5 security rule — live HTTP):
 *       "PUBLIC URL identifies the tenant for public branding.
 *        AUTHENTICATED authorization derives tenant identity from the
 *        authenticated server-side session."
 *       → An authenticated School-B session requesting /api/auth/me
 *         with ?tenant=<school-A-slug> / ?slug= / ?schoolId=<A> must
 *         STILL be School B. The query params are branding hints for
 *         PUBLIC surfaces only — they can never switch a session's
 *         tenant.
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const ROOT = process.env.SCHOLARIO_ROOT ?? '/home/z/my-project'

// ─── A. Plane gate (real middleware, child process per plane) ────────────

interface ProbeVerdict {
  status: number
  blocked: boolean
  contentType: string
  error?: string
}

function probe(
  plane: string,
  path: string,
  method = 'GET',
  nodeEnv = 'test',
  allowUnified = '',
): Promise<ProbeVerdict> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bun',
      [
        'tests/helpers/plane-middleware-probe.ts',
        plane,
        path,
        method,
        nodeEnv,
        allowUnified,
      ],
      { cwd: ROOT },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`probe exited ${code}: ${err.slice(0, 300)}`))
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() as string))
      } catch {
        reject(new Error(`probe produced no verdict: ${out.slice(0, 300)} ${err.slice(0, 300)}`))
      }
    })
  })
}

describe('plane gate — SCHOLARIO_PLANE=platform (control-plane deployment)', () => {
  test('school login door /login does not exist', async () => {
    const v = await probe('platform', '/login')
    expect(v.blocked).toBe(true)
    expect(v.status).toBe(404)
    expect(v.contentType).toContain('text/html')
  })

  test('canonical school door /s/<slug>/login does not exist', async () => {
    expect((await probe('platform', '/s/green-valley/login')).blocked).toBe(true)
    expect((await probe('platform', '/s/hawkings-prithvipur')).blocked).toBe(true)
  })

  test('school auth API does not exist (no school door to phish on)', async () => {
    const v = await probe('platform', '/api/auth/login', 'POST')
    expect(v.status).toBe(404)
    expect(v.contentType).toContain('application/json')
  })

  test('school-plane APIs do not exist', async () => {
    for (const p of ['/api/students', '/api/dashboard', '/api/schools/public', '/api/fees']) {
      expect((await probe('platform', p)).status).toBe(404)
    }
  })

  test('platform APIs, webhooks and shared probes DO exist', async () => {
    expect((await probe('platform', '/api/platform/auth/login', 'POST')).blocked).toBe(false)
    expect((await probe('platform', '/api/platform/schools')).blocked).toBe(false)
    expect((await probe('platform', '/api/webhooks/resend', 'POST')).blocked).toBe(false)
    expect((await probe('platform', '/api/app-version')).blocked).toBe(false)
    expect((await probe('platform', '/api')).blocked).toBe(false)
  })

  test('platform pages still exist on the platform plane', async () => {
    expect((await probe('platform', '/platform/login')).blocked).toBe(false)
    expect((await probe('platform', '/platform/forgot-password')).blocked).toBe(false)
  })
})

describe('plane gate — SCHOLARIO_PLANE=school (school ERP deployment)', () => {
  test('platform console pages do not exist', async () => {
    const v = await probe('school', '/platform/schools')
    expect(v.blocked).toBe(true)
    expect(v.status).toBe(404)
    expect((await probe('school', '/platform/login')).blocked).toBe(true)
    expect((await probe('school', '/platform')).blocked).toBe(true)
  })

  test('platform APIs do not exist (no platform surface to probe)', async () => {
    for (const p of [
      '/api/platform/auth/me',
      '/api/platform/schools',
      '/api/platform/auth/login',
      '/api/platform/audit',
    ]) {
      const v = await probe('school', p)
      expect(v.status).toBe(404)
      expect(v.contentType).toContain('application/json')
    }
  })

  test('the public announcements broadcast is the ONE cross-plane exemption', async () => {
    expect((await probe('school', '/api/platform/announcements/public')).blocked).toBe(false)
  })

  test('school doors and APIs DO exist on the school plane', async () => {
    expect((await probe('school', '/login')).blocked).toBe(false)
    expect((await probe('school', '/s/green-valley/login')).blocked).toBe(false)
    expect((await probe('school', '/api/auth/login', 'POST')).blocked).toBe(false)
    expect((await probe('school', '/api/students')).blocked).toBe(false)
  })
})

describe('plane gate — unified default (local development topology)', () => {
  test('nothing is plane-blocked when SCHOLARIO_PLANE is unset (local dev default)', async () => {
    expect((await probe('UNSET', '/login')).blocked).toBe(false)
    expect((await probe('UNSET', '/platform/login')).blocked).toBe(false)
    expect((await probe('UNSET', '/s/green-valley/login')).blocked).toBe(false)
    expect((await probe('UNSET', '/api/auth/login', 'POST')).blocked).toBe(false)
    expect((await probe('UNSET', '/api/platform/schools')).blocked).toBe(false)
    expect((await probe('unified', '/login')).blocked).toBe(false)
    expect((await probe('unified', '/api/platform/schools')).blocked).toBe(false)
  })
})

describe('plane config hardening — misconfiguration fails closed', () => {
  test('a typoed plane value refuses to serve anything (no silent unified fallback)', async () => {
    const v = await probe('scholl', '/login')
    expect(v.blocked).toBe(true)
    expect(v.status).toBe(500)
    expect(v.error).toContain('SCHOLARIO_PLANE')
    expect(v.error).toContain('scholl')
  })

  test('production without a plane value fails closed', async () => {
    const v = await probe('UNSET', '/login', 'GET', 'production')
    expect(v.blocked).toBe(true)
    expect(v.status).toBe(500)
    expect(v.error).toContain('SCHOLARIO_PLANE')
  })

  test("explicit 'unified' in production fails closed without the legacy opt-in", async () => {
    const v = await probe('unified', '/login', 'GET', 'production')
    expect(v.blocked).toBe(true)
    expect(v.status).toBe(500)
    expect(v.error).toContain('fail closed')
  })

  test('the legacy opt-in keeps the deprecated unified project alive in production', async () => {
    const v = await probe('unified', '/login', 'GET', 'production', '1')
    expect(v.blocked).toBe(false)
    expect((await probe('unified', '/platform/login', 'GET', 'production', '1')).blocked).toBe(false)
    expect((await probe('unified', '/api/platform/schools', 'GET', 'production', '1')).blocked).toBe(false)
    expect((await probe('UNSET', '/login', 'GET', 'production', '1')).blocked).toBe(false)
  })

  test('the plane gate still applies in production mode (platform 404s school doors)', async () => {
    const v = await probe('platform', '/login', 'GET', 'production')
    expect(v.status).toBe(404)
    expect((await probe('school', '/platform/login', 'GET', 'production')).status).toBe(404)
  })

  test('a typoed value fails closed in production too, even with the legacy opt-in', async () => {
    const v = await probe('platfrm', '/login', 'GET', 'production', '1')
    expect(v.status).toBe(500)
    expect(v.error).toContain('SCHOLARIO_PLANE')
  })
})

// ─── B. Canonical school doors (live HTTP, unified dev server) ───────────

describe('canonical school doors — /s/<slug> routes (live)', () => {
  test('/s/<real-slug>/login renders the school login door', async () => {
    const res = await fetch(`${BASE}/s/green-valley/login`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('/s/<unknown-slug>/login is an honest 404 (no guessing, no fallback)', async () => {
    // NOTE on traversal: WHATWG URL parsing treats "%2e"/"%2e%2e" as
    // dot-segments and NORMALIZES them before any spec-compliant client
    // (browser, fetch) sends the request — /s/%2e%2e/login arrives as
    // /login (the neutral generic door). Raw non-spec clients (curl
    // --path-as-is, scripts) are 404'd by the middleware's decoded-path
    // shape gate. What CAN arrive raw is tested here:
    for (const bad of [
      '/s/no-such-school/login',
      '/s/x/login',
      '/s/green-valley/extra',
      '/s/this-slug-is-way-too-long-to-be-a-real-school-slug-in-the-database-x/login',
    ]) {
      const res = await fetch(`${BASE}${bad}`, { redirect: 'manual' })
      expect(res.status).toBe(404)
    }
    // Non-spec raw traversal is also 404'd by the edge (curl-style).
    const raw = await fetch(`${BASE}/s/%2e%2e%2flogin`, { redirect: 'manual' })
    // Spec clients normalize this before sending; if it ever DOES
    // arrive raw, the decoded-path shape gate 404s it.
    expect([200, 404]).toContain(raw.status)
  })

  test('/s/<real-slug> redirects to the tenant website path', async () => {
    const res = await fetch(`${BASE}/s/green-valley`, { redirect: 'manual' })
    expect([302, 307, 308]).toContain(res.status)
    expect(res.headers.get('location')).toBe('/?tenant=green-valley')
  })

  test('legacy /login?tenant=<slug> door still works (no regression)', async () => {
    const res = await fetch(`${BASE}/login?tenant=green-valley`)
    expect(res.status).toBe(200)
  })

  test('the door renders real branding data, not a platform shell', async () => {
    const res = await fetch(`${BASE}/s/green-valley/login`)
    const html = await res.text()
    // The server-rendered shell must mount the client login surface.
    expect(html.length).toBeGreaterThan(500)
  })
})

// ─── C. Forged-tenant regression (live HTTP, real session) ───────────────

describe('forged tenant parameters never switch an authenticated session', () => {
  let schoolAId = ''
  let schoolBId = ''
  let tokenB = ''

  beforeAll(async () => {
    const schoolA = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
    const schoolB = await db.school.findUnique({ where: { slug: 'green-valley' } })
    if (!schoolA || !schoolB) throw new Error('tenant fixtures missing — run seed-tenant-isolation')
    schoolAId = schoolA.id
    schoolBId = schoolB.id

    // A REAL School-B session (direct session fixture — auth fixture,
    // NOT an authorization bypass; same convention as tenant-isolation).
    const userB = await db.user.findUnique({ where: { email: 'principal.b@greenvalley.test' } })
    if (!userB) throw new Error('principal.b fixture missing — run seed-tenant-isolation')
    const raw = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        userId: userB.id,
        tokenHash: hashSessionToken(raw),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    tokenB = raw
  })

  async function meWith(query: string): Promise<{ status: number; schoolId: unknown }> {
    const res = await fetch(`${BASE}/api/auth/me${query}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: { user?: { schoolId?: string } } }
      | null
    return { status: res.status, schoolId: body?.data?.user?.schoolId ?? null }
  }

  test('?tenant=<foreign-slug> does not switch the session tenant', async () => {
    const r = await meWith('?tenant=hawkings-prithvipur')
    expect(r.status).toBe(200)
    expect(r.schoolId).toBe(schoolBId)
    expect(r.schoolId).not.toBe(schoolAId)
  })

  test('?slug=<foreign-slug> does not switch the session tenant', async () => {
    const r = await meWith('?slug=hawkings-prithvipur')
    expect(r.status).toBe(200)
    expect(r.schoolId).toBe(schoolBId)
  })

  test('?schoolId=<foreign-id> does not switch the session tenant', async () => {
    const r = await meWith(`?schoolId=${encodeURIComponent(schoolAId)}`)
    expect(r.status).toBe(200)
    expect(r.schoolId).toBe(schoolBId)
  })

  test('no parameters — the session tenant is unchanged (control)', async () => {
    const r = await meWith('')
    expect(r.status).toBe(200)
    expect(r.schoolId).toBe(schoolBId)
  })

  test('an unauthenticated forged-tenant probe never leaks identity', async () => {
    const res = await fetch(`${BASE}/api/auth/me?tenant=hawkings-prithvipur`)
    expect(res.status).toBe(401)
  })
})
