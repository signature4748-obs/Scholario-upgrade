/**
 * PUBLIC WEBSITE vs SCHOOL LOGIN — the doors contract (live HTTP).
 *
 * THE DEFECT BEING LOCKED OUT (super-admin routing fix, 2026-10): the
 * console's "Open website" link landed in the PRINCIPAL panel because
 * (a) the root route rendered the role dashboard for ANY authenticated
 * school session regardless of ?tenant=, and (b) the login doors
 * auto-replaced to /?tenant=<slug> for every cached session. The fix
 * makes ?tenant=/?slug= an EXPLICIT PUBLIC-WEBSITE signal on the root
 * route and rebuilds the doors on lib/school-door.ts.
 *
 * THE SERVER-SIDE CONTRACTS PINNED HERE (this suite — live HTTP):
 *   · /s/<slug> stays the canonical PUBLIC link: 307 → /?tenant=<slug>
 *     (the public signal), never a dashboard, never a login;
 *   · the doors EXIST and render (200): /s/<slug>/login and
 *     /login?tenant=<slug>;
 *   · unknown/malformed slugs are HONEST 404s (never a guessed tenant);
 *   · /?tenant=<slug> serves 200 HTML with NO redirect — the public
 *     signal is rendered client-side, the server never bounces anyone
 *     to a dashboard;
 *   · a school session's /api/auth/me carries the SESSION's OWN school
 *     slug — a ?tenant= query can NEVER override server truth;
 *   · a foreign-tenant session fetching ANOTHER school's door gets the
 *     honest 200 door (the different-school decision is client-side;
 *     the server never silently redirects anyone across tenants);
 *   · the platform school dossier exposes access.websiteEnabled
 *     (default TRUE; a school that switched its website off reports
 *     FALSE so the Access card can say "not configured").
 *
 * The CLIENT-side matrix (deliberate continue vs form vs stale-cache
 * clear) is pinned by tests/unit/school-door.test.ts and was
 * additionally browser-verified in the fix session — HTTP cannot see
 * client routing by design.
 *
 * RATE-LIMIT HYGIENE: exactly ONE real platform login per run (the
 * websiteEnabled dossier assertions); its limiter rows are healed
 * first (same pattern as platform-entry.test.ts). The school session
 * is a direct DB fixture (tenant-isolation convention) — no real
 * school login is consumed here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'

import { db } from '../helpers/db'
import { liveFetch, type LiveFetchOpts } from '../helpers/live-http'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_ROOT_EMAIL, PLATFORM_ROOT_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const LIVE: LiveFetchOpts = { deadlineMs: 50_000 }
const T = 60_000

// Seeded canonical corpus (CI seed pipeline, DATABASE_ENV=test):
// two REAL tenants with distinct identities.
const HAWKINGS = 'hawkings-prithvipur'
const GREEN_VALLEY = 'green-valley'
const GV_PRINCIPAL = 'principal@greenvalley.test'

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
    console.warn('[public-vs-login-doors] limiter heal query failed — limiter state left as-is')
  }
}

describe('public website vs school login — the doors contract', () => {
  let platformCookie = ''
  let gvSessionToken = ''
  let gvSessionId = ''
  let hawkingsId = ''
  let throwawaySchoolId: string | null = null

  beforeAll(async () => {
    await healPlatformLoginBuckets()

    // The ONE real platform login (root fixture) for the dossier tests.
    const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: PLATFORM_ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD }),
    }, LIVE)
    if (res.ok) {
      const raw = res.headers.get('set-cookie') ?? ''
      const token = raw.split('scholario_platform_session=')[1]?.split(';')[0] ?? ''
      if (token) platformCookie = `scholario_platform_session=${token}`
    }

    // Direct school session fixture (Green Valley principal) — the
    // tenant-isolation convention: a real Session row, hashed token,
    // no login consumed. Server truth for /api/auth/me comes from this
    // session's schoolId — exactly what the ?tenant= override test
    // must NOT be able to move.
    const principal = await db.user.findFirst({
      where: { email: GV_PRINCIPAL, school: { slug: GREEN_VALLEY } },
      select: { id: true },
    })
    if (principal) {
      gvSessionToken = `${randomBytes(24).toString('hex')}`
      const row = await db.session.create({
        data: {
          userId: principal.id,
          tokenHash: hashSessionToken(gvSessionToken),
          expiresAt: new Date(Date.now() + 3600_000),
        },
        select: { id: true },
      })
      gvSessionId = row.id
    }

    const hawkings = await db.school.findUnique({ where: { slug: HAWKINGS }, select: { id: true } })
    hawkingsId = hawkings?.id ?? ''
  }, T)

  afterAll(async () => {
    // Fixture teardown — rows only, never the shared client.
    if (gvSessionId) {
      await db.session.delete({ where: { id: gvSessionId } }).catch(() => undefined)
    }
    if (throwawaySchoolId) {
      await db.school.delete({ where: { id: throwawaySchoolId } }).catch(() => undefined)
    }
  }, T)

  test(
    '/s/<slug> is the canonical PUBLIC link: 307 to the /?tenant= signal (never a dashboard, never a login)',
    async () => {
      const res = await liveFetch(`${BASE}/s/${HAWKINGS}`, { redirect: 'manual' }, LIVE)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toBe(`/?tenant=${HAWKINGS}`)
    },
    T,
  )

  test('/s/<slug>/login exists — the per-school login door renders (200 HTML)', async () => {
    const res = await liveFetch(`${BASE}/s/${HAWKINGS}/login`, {}, LIVE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
  }, T)

  test('/login?tenant=<slug> exists — the same door via the explicit tenant link', async () => {
    const res = await liveFetch(`${BASE}/login?tenant=${GREEN_VALLEY}`, {}, LIVE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/html')
  }, T)

  test('a malformed slug is an HONEST 404 — never a guessed or defaulted tenant', async () => {
    const res = await liveFetch(`${BASE}/s/UP`, { redirect: 'manual' }, LIVE)
    expect(res.status).toBe(404)
  }, T)

  test('a well-formed UNKNOWN slug is an honest 404 — both the public link and the login door', async () => {
    const resPub = await liveFetch(`${BASE}/s/no-such-school-xyz`, { redirect: 'manual' }, LIVE)
    expect(resPub.status).toBe(404)
    const resLogin = await liveFetch(`${BASE}/s/no-such-school-xyz/login`, {}, LIVE)
    expect(resLogin.status).toBe(404)
  }, T)

  test(
    '/?tenant=<slug> serves 200 HTML with NO redirect — the server never bounces the public link anywhere',
    async () => {
      const res = await liveFetch(`${BASE}/?tenant=${GREEN_VALLEY}`, { redirect: 'manual' }, LIVE)
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('content-type') ?? '').toContain('text/html')
    },
    T,
  )

  test(
    'a school session\'s /api/auth/me carries ITS OWN school slug — a ?tenant= query never overrides server truth',
    async () => {
      expect(gvSessionToken).not.toBe('')
      const res = await liveFetch(
        `${BASE}/api/auth/me?tenant=${HAWKINGS}`,
        { headers: { authorization: `Bearer ${gvSessionToken}` } },
        LIVE,
      )
      expect(res.status).toBe(200)
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        data?: { user?: { school?: { slug?: string } } }
      } | null
      expect(body?.ok).toBe(true)
      expect(body?.data?.user?.school?.slug).toBe(GREEN_VALLEY)
    },
    T,
  )

  test(
    'a FOREIGN-tenant session fetching another school\'s door gets the honest 200 door — no server-side cross-tenant redirect',
    async () => {
      expect(gvSessionToken).not.toBe('')
      // Green Valley principal opens HAWKINGS' door: the server must
      // neither leak Hawkings data nor redirect the session away. The
      // different-school decision (this school's form) is client-side.
      const res = await liveFetch(
        `${BASE}/s/${HAWKINGS}/login`,
        { headers: { authorization: `Bearer ${gvSessionToken}` }, redirect: 'manual' },
        LIVE,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('content-type') ?? '').toContain('text/html')
    },
    T,
  )

  test(
    'the school dossier exposes access.websiteEnabled — default TRUE for a seeded school',
    async () => {
      expect(platformCookie).not.toBe('')
      expect(hawkingsId).not.toBe('')
      const res = await liveFetch(`${BASE}/api/platform/schools/${hawkingsId}`, {
        headers: { cookie: platformCookie },
      }, LIVE)
      expect(res.status).toBe(200)
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        data?: {
          access?: { loginUrl?: string; publicUrl?: string; websiteEnabled?: boolean }
        }
      } | null
      expect(body?.ok).toBe(true)
      expect(typeof body?.data?.access?.websiteEnabled).toBe('boolean')
      expect(body?.data?.access?.websiteEnabled).toBe(true)
    },
    T,
  )

  test(
    'a school that switched its public website OFF is reported honestly (websiteEnabled: false)',
    async () => {
      expect(platformCookie).not.toBe('')
      const marker = randomBytes(4).toString('hex')
      const school = await db.school.create({
        data: {
          name: `Doors Fixture ${marker}`,
          slug: `doors-fixture-${marker}`,
          code: `DFX-${marker}`,
          settings: JSON.stringify({ websiteEnabled: false }),
        },
        select: { id: true },
      })
      throwawaySchoolId = school.id
      try {
        const res = await liveFetch(`${BASE}/api/platform/schools/${school.id}`, {
          headers: { cookie: platformCookie },
        }, LIVE)
        expect(res.status).toBe(200)
        const body = (await res.json().catch(() => null)) as {
          data?: { access?: { websiteEnabled?: boolean } }
        } | null
        expect(body?.data?.access?.websiteEnabled).toBe(false)
      } finally {
        await db.school.delete({ where: { id: school.id } }).catch(() => undefined)
        throwawaySchoolId = null
      }
    },
    T,
  )
})
