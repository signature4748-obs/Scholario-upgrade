/**
 * PLATFORM ENTRY — private control-plane root + canonical login suite.
 *
 * THE CONTRACT UNDER TEST (platform-entry task, 2026-10):
 *
 *  The production platform domain (scholario-platform, SCHOLARIO_PLANE=
 *  platform) is the OPERATOR's surface — not a public marketing site.
 *  The school-root experience that src/app/page.tsx serves at '/' is a
 *  SCHOOL-plane surface: it depends on school-plane APIs
 *  (/api/schools/public, /api/admissions/public, /api/contacts, ...) that
 *  the plane gate 404s on the platform deployment, so the marketing page
 *  was already functionally dead there — a shared-root artifact of one
 *  repository building two Vercel projects, never a product decision.
 *
 *  A. PLATFORM ROOT REDIRECT (middleware, real code path via the
 *     child-process probe — one process per plane value):
 *       · SCHOLARIO_PLANE=platform  '/' → 307 Location /platform/login
 *         (query dropped — tenant hints are school-plane concepts),
 *         method preserved, production mode included.
 *       · SCHOLARIO_PLANE=school    '/' falls through untouched (the
 *         school ERP + public website keep their root experience).
 *       · unified (local-dev default, legacy) '/' falls through.
 *       · /platform/login remains reachable on the platform plane —
 *         the CANONICAL entry (no second login surface was created).
 *
 *  B. CANONICAL LOGIN STILL RENDERS (live HTTP, unified dev server):
 *       · /  → 200 HTML (school-root regression control: the redirect
 *         must NEVER leak onto the school/unified plane).
 *       · /platform/login → 200 HTML (the minimal platform sign-in).
 *
 *  C. AUTH LIFECYCLE THROUGH THE REAL FRONT DOOR (live HTTP — the SAME
 *     auth implementation is preserved; nothing here weakens it):
 *       · unauthenticated /api/platform/auth/me + /api/platform/overview
 *         → honest 401 (the dashboard boundary is SERVER-side; hiding
 *         the marketing page is UX, never the security boundary).
 *       · real platform login (root fixture) → session cookie minted;
 *         /me → identity; /overview → dashboard data (successful
 *         dashboard navigation).
 *       · logout → session revoked → /me 401 again.
 *       · a SCHOOL session (erp_session) can NEVER satisfy the platform
 *         boundary (401 on /api/platform/schools) — the role/credential
 *         space separation. (The deep role-permission matrix remains in
 *         tests/security/platform-isolation.test.ts; this is the entry
 *         regression.)
 *
 *  RATE-LIMIT HYGIENE: exactly ONE real platform login per run; the
 *  platform IP + shared account buckets are healed first (database-
 *  backed limiter persists across runs — same rationale as
 *  tests/helpers/login-buckets.ts, extended with the rl:pf-login:ip:*
 *  platform keys the shared helper does not cover).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawn } from 'child_process'
import { join, resolve } from 'node:path'
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'

import { db } from '../helpers/db'
import { liveFetch, type LiveFetchOpts } from '../helpers/live-http'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_ROOT_EMAIL, PLATFORM_ROOT_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const ROOT = process.env.SCHOLARIO_ROOT?.trim()
  ? resolve(process.env.SCHOLARIO_ROOT)
  : resolve(import.meta.dir, '../..')
const PROBE = join(import.meta.dir, '..', 'helpers', 'plane-middleware-probe.ts')

// Live-HTTP ceilings (same rationale as plane-architecture: cold
// compiles on the dev server ride out inside a retry deadline).
const T = 60_000
const LIVE: LiveFetchOpts = { deadlineMs: 50_000 }

// ─── A. Platform root redirect (real middleware, child process) ──────────

interface ProbeVerdict {
  status: number
  blocked: boolean
  contentType: string
  location?: string
  error?: string
}

/** The middleware's redirects use a CLONED nextUrl, so Location may be
 * an ABSOLUTE URL (matching the existing platform-page-boundary 307).
 * Resolve both forms and assert on the decoded path + query. */
function locationParts(loc: string | undefined): { path: string; search: string } {
  const u = new URL(loc ?? '', 'http://probe.invalid')
  return { path: u.pathname, search: u.search }
}

function probe(
  plane: string,
  path: string,
  method = 'GET',
  nodeEnv = 'test',
  allowUnified = '',
): Promise<ProbeVerdict> {
  return new Promise((resolveP, reject) => {
    const child = spawn('bun', [PROBE, plane, path, method, nodeEnv, allowUnified], { cwd: ROOT })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`probe exited ${code}: ${err.slice(0, 300)}`))
      try {
        resolveP(JSON.parse(out.trim().split('\n').pop() as string))
      } catch {
        reject(new Error(`probe produced no verdict: ${out.slice(0, 300)} ${err.slice(0, 300)}`))
      }
    })
  })
}

describe('platform root — SCHOLARIO_PLANE=platform redirects / to the canonical login', () => {
  test("platform '/' → 307 Location /platform/login (exact target)", async () => {
    const v = await probe('platform', '/')
    expect(v.status).toBe(307)
    const { path, search } = locationParts(v.location)
    expect(path).toBe('/platform/login')
    expect(search).toBe('')
    expect(v.error).toBeUndefined()
  })

  test("platform '/?tenant=<slug>' → 307 /platform/login (school tenant hints dropped)", async () => {
    const v = await probe('platform', '/?tenant=green-valley')
    expect(v.status).toBe(307)
    const { path, search } = locationParts(v.location)
    expect(path).toBe('/platform/login')
    expect(search).toBe('')
  })

  test("platform '/' → 307 in PRODUCTION mode too (redirect is not dev-only)", async () => {
    const v = await probe('platform', '/', 'GET', 'production')
    expect(v.status).toBe(307)
    expect(locationParts(v.location).path).toBe('/platform/login')
  })

  test("platform '/' POST → 307 as well (307 preserves the method)", async () => {
    const v = await probe('platform', '/', 'POST')
    expect(v.status).toBe(307)
    expect(locationParts(v.location).path).toBe('/platform/login')
  })

  test('platform /platform/login remains reachable — the CANONICAL entry', async () => {
    const v = await probe('platform', '/platform/login')
    expect(v.blocked).toBe(false)
    expect(v.status).toBe(200)
    expect(v.location ?? '').toBe('')
  })
})

describe('platform root — other planes are UNTOUCHED (no redirect leaks)', () => {
  test("school '/' falls through (school ERP + public website keep their root)", async () => {
    const v = await probe('school', '/')
    expect(v.blocked).toBe(false)
    expect(v.status).toBe(200)
    expect(v.location ?? '').toBe('')
  })

  test("school '/' in PRODUCTION mode falls through too", async () => {
    const v = await probe('school', '/', 'GET', 'production')
    expect(v.blocked).toBe(false)
    expect(v.status).toBe(200)
    expect(v.location ?? '').toBe('')
  })

  test("unified/local-dev (UNSET) '/' falls through — local development unchanged", async () => {
    const v = await probe('UNSET', '/')
    expect(v.blocked).toBe(false)
    expect(v.status).toBe(200)
    expect(v.location ?? '').toBe('')
  })

  test("explicit 'unified' '/' falls through (legacy topology unchanged)", async () => {
    const v = await probe('unified', '/')
    expect(v.blocked).toBe(false)
    expect(v.status).toBe(200)
    expect(v.location ?? '').toBe('')
  })
})

// ─── B/C. Live HTTP — school-root control + real auth lifecycle ─────────

let platformCookie = ''
let mintedSchoolSessionId: string | null = null

/** Delete the limiter rows this suite's single real login could touch. */
async function healPlatformLoginBuckets(): Promise<void> {
  const keys = [
    'rl:pf-login:ip:127.0.0.1',
    'rl:pf-login:ip:::1',
    'rl:pf-login:ip:unknown',
    `rl:login:acct:${PLATFORM_ROOT_EMAIL}`,
  ]
  try {
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${Prisma.join(keys)})`
  } catch {
    console.warn('[platform-entry] limiter heal query failed — limiter state left as-is')
  }
}

describe('platform entry — live surfaces on the unified dev server', () => {
  beforeAll(async () => {
    await healPlatformLoginBuckets()
  })

  afterAll(async () => {
    if (mintedSchoolSessionId) {
      await db.session.deleteMany({ where: { id: mintedSchoolSessionId } }).catch(() => {})
    }
    await db.$disconnect()
  })

  test("school-root control: '/' still renders 200 HTML on the unified plane", async () => {
    const res = await liveFetch(`${BASE}/`, undefined, LIVE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect((await res.text()).length).toBeGreaterThan(500)
  }, T)

  test('canonical /platform/login renders the minimal platform sign-in', async () => {
    const res = await liveFetch(`${BASE}/platform/login`, undefined, LIVE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect((await res.text()).length).toBeGreaterThan(500)
  }, T)

  test('unauthenticated dashboard identity probe is an honest 401', async () => {
    const res = await liveFetch(`${BASE}/api/platform/auth/me`, undefined, LIVE)
    expect(res.status).toBe(401)
    const body = (await res.json().catch(() => null)) as { code?: string } | null
    expect(body?.code).toBe('AUTH_REQUIRED')
  }, T)

  test('unauthenticated dashboard DATA api is an honest 401 (server-side boundary)', async () => {
    const res = await liveFetch(`${BASE}/api/platform/overview`, undefined, LIVE)
    expect(res.status).toBe(401)
  }, T)

  test(
    'platform login through the REAL front door (root fixture) mints a session',
    async () => {
      const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: PLATFORM_ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD }),
      }, LIVE)
      expect(res.status).toBe(200)
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        data?: { admin?: { email?: string; isRoot?: boolean }; sessionToken?: string }
      } | null
      expect(body?.ok).toBe(true)
      expect(body?.data?.admin?.email).toBe(PLATFORM_ROOT_EMAIL)
      expect(body?.data?.admin?.isRoot).toBe(true)
      const raw = res.headers.get('set-cookie') ?? ''
      expect(raw).toContain('scholario_platform_session=')
      const token = raw.split('scholario_platform_session=')[1]?.split(';')[0] ?? ''
      expect(token.length).toBeGreaterThan(20)
      platformCookie = `scholario_platform_session=${token}`
    },
    T,
  )

  test('with the platform session: /me returns the admin identity (dashboard navigation)', async () => {
    expect(platformCookie).not.toBe('')
    const res = await liveFetch(`${BASE}/api/platform/auth/me`, {
      headers: { cookie: platformCookie },
    }, LIVE)
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => null)) as {
      data?: { admin?: { email?: string; isRoot?: boolean }; permissions?: string[] }
    } | null
    expect(body?.data?.admin?.email).toBe(PLATFORM_ROOT_EMAIL)
    expect(body?.data?.admin?.isRoot).toBe(true)
    expect(Array.isArray(body?.data?.permissions)).toBe(true)
  }, T)

  test('with the platform session: /overview serves the Super Admin dashboard data', async () => {
    const res = await liveFetch(`${BASE}/api/platform/overview`, {
      headers: { cookie: platformCookie },
    }, LIVE)
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => null)) as {
      data?: { schools?: Record<string, unknown> }
    } | null
    expect(body?.data?.schools).toBeTruthy()
  }, T)

  test('logout revokes the session — the dashboard boundary is restored', async () => {
    const res = await liveFetch(`${BASE}/api/platform/auth/logout`, {
      method: 'POST',
      headers: { cookie: platformCookie },
    }, LIVE)
    expect(res.status).toBe(200)
    const after = await liveFetch(`${BASE}/api/platform/auth/me`, {
      headers: { cookie: platformCookie },
    }, LIVE)
    expect(after.status).toBe(401)
  }, T)

  test(
    'role-based authorization: a SCHOOL session can never satisfy the platform boundary',
    async () => {
      // Mint a REAL school session directly (auth fixture, not a bypass —
      // same convention as plane-architecture/tenant-isolation) for any
      // school-scoped user present in the database.
      const user = await db.user.findFirst({ where: { schoolId: { not: null } } })
      if (!user) throw new Error('no school-scoped user fixture in the database — seed required')
      const raw = randomBytes(32).toString('hex')
      const session = await db.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(raw),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      mintedSchoolSessionId = session.id
      const schoolCookie = `erp_session=${raw}`

      // Control: the school session IS valid on the school plane.
      const schoolMe = await liveFetch(`${BASE}/api/auth/me`, {
        headers: { cookie: schoolCookie },
      }, LIVE)
      expect(schoolMe.status).toBe(200)

      // Boundary: the same credential on a platform API → 401. A school
      // identity can never act as a platform admin (credential-space
      // separation — the marketing-page removal is UX, not the gate).
      const platformSchools = await liveFetch(`${BASE}/api/platform/schools`, {
        headers: { cookie: schoolCookie },
      }, LIVE)
      expect(platformSchools.status).toBe(401)
      const platformMe = await liveFetch(`${BASE}/api/platform/auth/me`, {
        headers: { cookie: schoolCookie },
      }, LIVE)
      expect(platformMe.status).toBe(401)

      // And a FORGED platform cookie value is an honest 401 too.
      const forged = await liveFetch(`${BASE}/api/platform/schools`, {
        headers: { cookie: 'scholario_platform_session=deadbeefdeadbeefdeadbeef' },
      }, LIVE)
      expect(forged.status).toBe(401)
    },
    T,
  )
})
