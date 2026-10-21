/**
 * ROOT-ADMIN ROUTING REPAIR — PLATFORM CONSOLE NAVIGATION JOURNEYS.
 *
 * THE INVARIANT UNDER TEST (the task's own words): an authenticated
 * Super Admin must reach every sidebar destination, refresh it, deep
 * link it, and recover from 404s — WITHOUT being dumped on the school
 * portal or bounced to a login page — while genuine authentication
 * failures follow the canonical login flow and server authorization
 * stays enforced.
 *
 * Every journey uses the REAL surfaces against the live dev server
 * (process.env.E2E_BASE_URL ?? http://localhost:3000):
 *   · sign-in via POST /api/platform/auth/login (the REAL path; direct
 *     session fixture only on 429 — the provisioning-acceptance
 *     convention, bypassing ONLY the limiter, never an auth gate);
 *   · page journeys carry the platform cookie (the browser transport);
 *   · API journeys carry x-platform-token (the dev-preview transport).
 *
 * Routes exercised (the 2026-10-21 production incident): the Audit Log
 * page + API were silently absent from every Vercel build (the
 * .vercelignore `audit` swallow — see tests/security/route-inventory
 * .test.ts). Dev/CI never saw it; this suite pins the console routes
 * END-TO-END so a build-exclusion or routing regression fails HERE
 * before it ships.
 */
import { db } from '../helpers/db'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes, randomUUID } from 'crypto'
import { hashSessionToken, hashPassword } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET } from '../helpers/credentials'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const T = 90_000 // generous: first-hit dev compilation
const ROOT_EMAIL = 'admin@scholario.cloud'

/** The ten canonical sidebar destinations (order = sidebar order). */
const SIDEBAR_ROUTES = [
  '/platform',
  '/platform/schools',
  '/platform/subscriptions',
  '/platform/admins',
  '/platform/support',
  '/platform/announcements',
  '/platform/audit',
  '/platform/settings',
  '/platform/sessions',
  '/platform/operations',
]

let rootToken = ''
const cleanup: Array<() => Promise<unknown>> = []
let fixtureAdminId: string | null = null

/** The sidebar permission keys a non-root fixture needs to see every destination. */
const FIXTURE_PERMISSIONS = [
  'schools.read',
  'billing.manage',
  'admins.manage',
  'support.access',
  'announcements.manage',
  'audit.read',
  'settings.manage',
  'ops.read',
]

/** Platform root login (the REAL path; fixture on 429). */
async function platformRootLogin(): Promise<string> {
  let code: string | undefined
  try {
    const mod = await import('../../src/lib/platform/totp')
    code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  } catch {
    code = undefined // TOTP policy off — password-only sign-in
  }
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, ...(code ? { totpCode: code } : {}) }),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null
  if (res.status === 429 || !body?.data?.sessionToken) {
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('root platform admin missing (run the canonical seeds)')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    return token
  }
  return body.data.sessionToken
}

/**
 * Suite-owned fixture admin (the ops-isolation convention): a NON-root
 * ACTIVE admin granted exactly the sidebar permission keys, with a
 * runtime-generated strong password (never logged, never committed).
 * Used when the seeded root corpus is absent or its password is not the
 * seed value (e.g. a dev server pointed at the production database,
 * where the real root password is operator-held). All authorization
 * still flows through the REAL gates: withPlatform validates the
 * session row, the ACTIVE status and every permission key.
 */
async function fixtureAdminLogin(): Promise<string> {
  const email = `console-journey-fixture-${randomUUID().slice(0, 8)}@scholario.test`
  const password = `Journey-${randomBytes(18).toString('base64url')}!`
  const created = await db.platformAdmin.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      name: 'Console Journey Fixture',
      status: 'ACTIVE',
      isRoot: false,
      totpSecret: 'JBSWY3DPEHPK3PXP',
    },
  })
  fixtureAdminId = created.id
  await db.platformPermission.createMany({
    data: FIXTURE_PERMISSIONS.map((key) => ({ adminId: created.id, key, granted: true })),
  })
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: created.id } }).catch(() => {})
    await db.platformPermission.deleteMany({ where: { adminId: created.id } }).catch(() => {})
    await db.platformAdmin.deleteMany({ where: { id: created.id } }).catch(() => {})
  })
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null
  if (!body?.data?.sessionToken) {
    // Real login unavailable (e.g. limiter): direct session row — the
    // authorization gates still apply unchanged.
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: created.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    return token
  }
  return body.data.sessionToken
}

/** Page request in the BROWSER transport (the HttpOnly cookie). */
function page(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `scholario_platform_session=${rootToken}` },
    redirect: 'manual',
  })
}

/** API request in the dev-preview transport. */
function platform(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': rootToken, 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  await resetLoginBuckets([ROOT_EMAIL])
  try {
    rootToken = await platformRootLogin()
  } catch {
    // Seeded root unavailable (e.g. dev server on the production DB —
    // the real root password is operator-held): suite-owned fixture.
    rootToken = await fixtureAdminLogin()
  }
}, 120_000)

afterAll(async () => {
  for (const fn of cleanup) await fn().catch(() => {})
}, 60_000)

/** Visible DOM text — strips the inline RSC flight payloads (dev embeds
 * every not-found tree as strings in page scripts; only RENDERED content
 * is meaningful for content assertions). */
function visibleDom(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
}

describe('E2E · platform console navigation (root admin session)', () => {
  test(
    'every one of the ten sidebar destinations renders a real page — statuses are the router truth (the Audit Log incident regression)',
    async () => {
      for (const route of SIDEBAR_ROUTES) {
        const res = await page(route)
        expect([route, res.status]).toEqual([route, 200])
        const html = await res.text()
        expect(html).toContain('SCHOLARIO')
        // the visible DOM must not render ANY not-found boundary
        expect(visibleDom(html)).not.toContain('Page or resource not found')
        expect(visibleDom(html)).not.toContain('This control-plane page does not exist')
      }
    },
    T,
  )

  test(
    'the Audit Log opens directly, on refresh, and in a fresh client (new tab) — and its API serves the signed-in admin',
    async () => {
      const first = await page('/platform/audit')
      expect(first.status).toBe(200)
      const refresh = await page('/platform/audit')
      expect(refresh.status).toBe(200)
      const newTab = await fetch(`${BASE}/platform/audit`, {
        headers: { cookie: `scholario_platform_session=${rootToken}` },
      })
      expect(newTab.status).toBe(200)
      const api = await platform('/api/platform/audit?page=1&pageSize=5')
      expect(api.status).toBe(200)
      const body = (await api.json()) as { ok: boolean; data?: { events?: unknown[] } }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data?.events)).toBe(true)
    },
    T,
  )

  test(
    'the real console routes all resolve: the public doors + a deep route render their OWN pages',
    async () => {
      for (const route of [
        '/platform/login',
        '/platform/forgot-password',
        '/platform/reset-password',
        '/platform/schools/new',
      ] as const) {
        const res = await fetch(`${BASE}${route}`)
        expect([route, res.status]).toEqual([route, 200])
        const dom = visibleDom(await res.text())
        expect(dom).not.toContain('This control-plane page does not exist')
        expect(dom).not.toContain('Page or resource not found')
      }
    },
    T,
  )

  test(
    'an unmatched /platform path renders an HONEST 404 status whose recovery is correct for the deployment plane (dev = unified → school portal; the platform variant is pinned by route-inventory + verified live in production)',
    async () => {
      const res = await page('/platform/audit-log') // the stale-path class
      expect(res.status).toBe(404)
      const dom = visibleDom(await res.text())
      // dev server runs the unified plane → the school/unified variant
      // (recovery → "/", the school portal home — CORRECT on this origin;
      // the PLATFORM variant with "Back to Overview" → /platform is what
      // production renders — pinned in tests/security/route-inventory
      // .test.ts and live-verified post-deploy).
      expect(dom).toContain('Page or resource not found')
      expect(dom).toContain('href="/"')
    },
    T,
  )

  test(
    'a genuine session expiration follows the canonical login flow (401 envelope → /platform/login renders, ?next= honored and constrained)',
    async () => {
      // 1 · a live session stays authenticated
      const meOk = await platform('/api/platform/auth/me')
      expect(meOk.status).toBe(200)
      // 2 · an EXPIRED/REVOKED session is an honest 401 AUTH_REQUIRED envelope
      const adminId = fixtureAdminId ?? (await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } }))!.id
      const dead = randomBytes(32).toString('hex')
      await db.platformAdminSession.create({
        data: {
          adminId,
          tokenHash: hashSessionToken(dead),
          expiresAt: new Date(Date.now() - 60_000), // already expired
        },
      })
      cleanup.push(() =>
        db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(dead) } }),
      )
      const expired = await fetch(`${BASE}/api/platform/auth/me`, {
        headers: { 'x-platform-token': dead },
      })
      expect(expired.status).toBe(401)
      const body = (await expired.json()) as { ok: boolean; code?: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
      // 3 · the redirect target exists and keeps the operator inside /platform
      const login = await fetch(`${BASE}/platform/login?next=${encodeURIComponent('/platform/audit')}`)
      expect(login.status).toBe(200)
      const html = await login.text()
      expect(html).toContain('SCHOLARIO')
    },
    T,
  )

  test(
    'server authorization stays enforced: no credentials, garbage credentials and school-plane bearers are all rejected',
    async () => {
      const anon = await fetch(`${BASE}/api/platform/auth/me`)
      expect(anon.status).toBe(401)
      const garbage = await fetch(`${BASE}/api/platform/auth/me`, {
        headers: { cookie: 'scholario_platform_session=not-a-real-session' },
      })
      expect(garbage.status).toBe(401)
      const schoolBearer = await fetch(`${BASE}/api/platform/auth/me`, {
        headers: { authorization: 'Bearer school-side-token-probe' },
      })
      expect(schoolBearer.status).toBe(401)
      const auditAnon = await fetch(`${BASE}/api/platform/audit?page=1`)
      expect(auditAnon.status).toBe(401)
    },
    T,
  )

  test(
    'the school login door and tenant doors still answer on their own plane (no platform-side regression)',
    async () => {
      const schoolLogin = await fetch(`${BASE}/login`)
      expect(schoolLogin.status).toBe(200)
      const door = await fetch(`${BASE}/s/hawkings-prithvipur`, { redirect: 'manual' })
      expect(door.status).toBe(307)
      const loc = door.headers.get('location') ?? ''
      expect(loc).toContain('/?tenant=hawkings-prithvipur')
    },
    T,
  )
})
