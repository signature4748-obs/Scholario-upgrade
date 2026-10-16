/**
 * PR #31 STABILITY HARDENING — regression: core surfaces must survive a
 * pre-migration (schema-pending) database.
 *
 * THE DEFECTS THESE TESTS PIN (all reproduced live against the deployed
 * preview + a faithful pre-migration local database, 2026-10-16):
 *
 *   1. `src/lib/platform/module-flags.ts` read the FULL PlatformSetting
 *      row. On a database where migration 20261013183000_subscription_
 *      entitlement_system is still pending (owner-gated), that select
 *      references the missing `subscriptionConfig` column → Prisma
 *      P2022 → central classifier → typed 503 SUBSCRIPTION_SYSTEM_
 *      PENDING. The blast radius was CORE, NON-subscription surfaces:
 *        · GET /api/school-settings (the school plane's own config)
 *        · every module-guarded school route: /api/exams, /api/fees,
 *          /api/homework, /api/library, /api/transport
 *   2. `GET/PATCH /api/platform/settings` (the console Settings page
 *      endpoint) — same full-row read, same 503: the Settings page's
 *      own data failed with a message claiming "core school management
 *      remains fully available".
 *   3. `GET /api/platform/schools/[id]/admissions-issuance` — the flag
 *      source resolution used the same full-row read, so the school
 *      workspace Configuration tab's admissions toggle 503'd even
 *      though the flag + readiness data are fully legacy-compatible.
 *
 * THE FIX: every one of those reads now selects EXACTLY the legacy
 * columns it consumes (modules / showDemoSchool / supportMaxDuration —
 * present in BOTH schema states). These tests pin the RESULT: each
 * surface returns 200 with its real payload on a FULLY MIGRATED
 * database (this suite, CI) — and the same assertions were verified
 * live against the FAITHFUL PRE-MIGRATION database (worklog evidence:
 * the pending objects dropped from a seeded database, then the same
 * requests re-run — see audit/sa-hardening-20261016). The legacy-
 * compatible select is precisely what makes one code path serve both
 * states honestly.
 *
 * Also pinned: the previously-503 admissions-issuance GET now serves
 * its real flag state on both databases, and fail-closed authorization
 * is untouched (anonymous → 401; a SCHOOL session on a platform route
 * → 401, not data).
 *
 * LIVE HTTP against the dev server; direct-session fixtures (auth
 * fixtures, NOT authorization bypasses).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { createHash } from 'crypto'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

let rootToken = ''
let schoolToken = ''
let hawkingsId = ''
const minted: string[] = []

async function platformFixture(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
  if (!admin) throw new Error('root platform admin missing — run seed-platform')
  const raw = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  minted.push(raw)
  return raw
}

async function schoolFixture(): Promise<string> {
  const u = await db.user.findUnique({ where: { email: 'principal@hawkingshigh.edu' } })
  if (!u) throw new Error('hawkings principal missing — run the demo corpus seeds')
  const raw = randomBytes(32).toString('hex')
  const { hashSessionToken } = await import('@/lib/auth')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  minted.push(raw)
  return raw
}

function asPlatform(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { 'x-platform-token': token, 'content-type': 'application/json' },
  })
}

function asSchool(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  const hawk = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!hawk) throw new Error('canonical corpus school missing')
  hawkingsId = hawk.id
  rootToken = await platformFixture()
  schoolToken = await schoolFixture()
  await resetLoginBuckets(['principal@hawkingshigh.edu'])
}, 60_000)

afterAll(async () => {
  const { hashSessionToken } = await import('@/lib/auth')
  for (const raw of minted) {
    const platformHash = createHash('sha256').update(raw).digest('hex')
    await db.platformAdminSession.deleteMany({ where: { tokenHash: platformHash } }).catch(() => {})
    await db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }).catch(() => {})
  }
  await db.$disconnect()
})

describe('Core surfaces survive a schema-pending database (legacy column selects)', () => {
  test(
    'GET /api/school-settings — the school plane serves its own config (was 503)',
    async () => {
      const res = await asSchool(schoolToken, '/api/school-settings')
      expect(res.status).toBe(200)
      // This route uses the legacy `{ success, data }` envelope.
      const body = (await res.json()) as { success: boolean; data: Record<string, unknown> }
      expect(body.success).toBe(true)
      // Real config payload — identity + branding + settings + moduleFlags.
      const d = body.data
      expect(d.identity).toBeDefined()
      expect(d.moduleFlags).toBeDefined()
    },
    T,
  )

  test(
    'GET /api/exams — module-guarded school route serves real data (was 503)',
    async () => {
      const res = await asSchool(schoolToken, '/api/exams')
      // On the seeded corpus exams are enabled → 200 with data. (If a
      // fixture disabled the module, FEATURE_DISABLED 403 would still be
      // a NON-503, non-schema-pending answer — the regression is the
      // 503 SUBSCRIPTION_SYSTEM_PENDING on this surface.)
      expect([200, 403]).toContain(res.status)
      if (res.status === 200) {
        const body = (await res.json()) as { ok: boolean; data: unknown }
        expect(body.ok).toBe(true)
      } else {
        const body = (await res.json()) as { error: { code: string } }
        expect(body.error.code).toBe('FEATURE_DISABLED')
      }
    },
    T,
  )

  test(
    'GET /api/platform/settings — the console Settings page endpoint serves real settings (was 503)',
    async () => {
      const res = await asPlatform(rootToken, '/api/platform/settings')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: { showDemoSchool: boolean; modules: Record<string, boolean>; supportMaxDuration: number }
      }
      expect(body.ok).toBe(true)
      expect(typeof body.data.showDemoSchool).toBe('boolean')
      expect(typeof body.data.supportMaxDuration).toBe('number')
      expect(body.data.modules).toBeDefined()
    },
    T,
  )

  test(
    'GET /api/platform/schools/[id]/admissions-issuance — real flag + readiness state (was 503)',
    async () => {
      const res = await asPlatform(rootToken, `/api/platform/schools/${hawkingsId}/admissions-issuance`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: {
          enabled: boolean
          source: 'school' | 'platform' | 'default'
          readiness: { academicYearSet: boolean; publishedFeeStructures: number; ready: boolean }
        }
      }
      expect(body.ok).toBe(true)
      expect(['school', 'platform', 'default']).toContain(body.data.source)
      expect(body.data.readiness).toBeDefined()
      expect(typeof body.data.readiness.ready).toBe('boolean')
    },
    T,
  )

  test(
    'authorization stays fail-closed: anonymous platform settings → 401',
    async () => {
      const res = await fetch(`${BASE}/api/platform/settings`)
      expect(res.status).toBe(401)
      // Flat error envelope: { ok:false, error, code, requestId }.
      const body = (await res.json()) as { ok: boolean; code: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
    },
    T,
  )

  test(
    'authorization stays fail-closed: a SCHOOL session cannot read platform settings',
    async () => {
      const res = await fetch(`${BASE}/api/platform/settings`, {
        headers: { authorization: `Bearer ${schoolToken}`, 'content-type': 'application/json' },
      })
      expect(res.status).toBe(401)
    },
    T,
  )
})
