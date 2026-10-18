/**
 * PLATFORM SUBSCRIPTIONS REGISTRY — registry-wide renewal summary
 * (renewal-report regression, 2026-10-18).
 *
 * The subscriptions workspace KPI cards previously counted the CURRENT
 * PAGE of registry rows and presented the numbers as global — silently
 * under-reporting on paginated registries, with no drill-down for the
 * expiring cohort. The registry now serves REGISTRY-WIDE computed-live
 * tallies in every response:
 *
 *   summary.tenantStates                       — entitlement-state counts
 *                                                over ALL SchoolSubscription
 *                                                rows (legacy columns only —
 *                                                identical under schema-pending)
 *   summary.subscriptionsExpired               — periodEnd < now (all rows)
 *   summary.subscriptionsExpiringWithin30Days  — periodEnd ∈ [now, now+30d]
 *
 * This suite pins the wire contract with real fixture tenants whose
 * periodEnd lands inside and outside the 30-day window:
 *
 *   1. summary tallies are consistent with an independent recomputation
 *      over the whole table (never page-scoped);
 *   2. the summary is page-scope-INDEPENDENT (pageSize=1 vs pageSize=100
 *      — the exact defect class this replaces);
 *   3. ?expiringDays=30 returns exactly the in-window cohort (fixture-in,
 *      fixture-out) and its total equals the registry-wide expiring count;
 *   4. the registry stays fail-closed (no session → 401).
 *
 * Live-HTTP against the dev server (same style as
 * platform-schools-attention-filter); root session with the direct-row
 * fallback when the login limiter is hot. Fixture schools are removed in
 * afterAll (cascade-verified teardown per the database-integrity suite).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import {
  PLATFORM_ROOT_EMAIL,
  PLATFORM_ROOT_PASSWORD,
} from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const RUN = `regsum${randomBytes(4).toString('hex')}`
const RUN_IP = `10.237.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const DAY_MS = 24 * 60 * 60 * 1000
const STATES = ['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED', 'NOT_ACTIVATED'] as const

const createdSessionHashes: string[] = []
let rootToken = ''

let schoolSoonId = ''
let schoolFarId = ''

/** Direct PlatformAdminSession row (auth fixture — bypasses only the
 *  login limiter, never an authorization gate). */
async function directPlatformSession(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error(`no platform admin ${PLATFORM_ROOT_EMAIL}`)
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  createdSessionHashes.push(hashSessionToken(token))
  return token
}

async function rootLogin(): Promise<string> {
  const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: PLATFORM_ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD }),
  }, T)
  if (res.status === 429) return directPlatformSession()
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform login failed: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

interface RegistryBody {
  ok: boolean
  data?: {
    subscriptionSchemaPending?: boolean
    schools: {
      rows: Array<{ subscriptionId: string; school: { id: string; slug: string }; periodEnd: string | null }>
      total: number
    }
    summary?: {
      tenantStates?: Record<string, number>
      subscriptionsExpired?: number
      subscriptionsExpiringWithin30Days: number
    }
  }
  error?: string
}

async function registry(
  token: string,
  query: string,
): Promise<{ status: number; body: RegistryBody }> {
  const res = await liveFetch(
    `${BASE}/api/platform/subscriptions/registry${query}`,
    { headers: { cookie: `scholario_platform_session=${token}` } },
    T,
  )
  let body: RegistryBody | null = null
  try {
    body = (await res.json()) as RegistryBody
  } catch {
    /* non-JSON error body — assertions below surface it */
  }
  return { status: res.status, body: body as RegistryBody }
}

/** Independent recomputation over the WHOLE table (the summary's oracle). */
async function recomputeSummary() {
  const rows = await db.schoolSubscription.findMany({
    select: {
      status: true,
      periodEnd: true,
      graceDays: true,
      overrideStatus: true,
      school: { select: { status: true } },
    },
  })
  const now = Date.now()
  const tenantStates: Record<string, number> = Object.fromEntries(STATES.map((s) => [s, 0]))
  let expired = 0
  let expiring30 = 0
  for (const row of rows) {
    const state = evaluateTenantEntitlement({
      schoolStatus: row.school.status,
      accountSubscriptionStatus: 'ACTIVE',
      subscription: {
        status: row.status,
        plan: null,
        periodEnd: row.periodEnd,
        graceDays: row.graceDays,
        overrideStatus: row.overrideStatus,
      },
    }).state
    tenantStates[state] = (tenantStates[state] ?? 0) + 1
    if (row.periodEnd == null) continue
    const end = new Date(row.periodEnd).getTime()
    if (end < now) expired += 1
    else if (end <= now + 30 * DAY_MS) expiring30 += 1
  }
  return { tenantStates, expired, expiring30 }
}

beforeAll(async () => {
  rootToken = await rootLogin()

  // Fixture tenants: one subscription expiring INSIDE the 30-day window,
  // one far outside it. Legacy columns only — the fixtures stay valid on
  // pre- and post-migration databases alike.
  const soon = await db.school.create({
    data: {
      name: `RegistrySoon ${RUN}`,
      slug: `regsoon-${RUN}`,
      code: `RS${RUN.slice(5, 11).toUpperCase()}`,
      plan: 'STANDARD',
      status: 'ACTIVE',
      featureFlags: '{}',
    },
  })
  schoolSoonId = soon.id
  await db.schoolSubscription.create({
    data: {
      schoolId: soon.id,
      plan: 'STANDARD',
      status: 'ACTIVE',
      graceDays: 14,
      periodStart: new Date(now() - 90 * DAY_MS),
      periodEnd: new Date(now() + 10 * DAY_MS),
    },
  })

  const far = await db.school.create({
    data: {
      name: `RegistryFar ${RUN}`,
      slug: `regfar-${RUN}`,
      code: `RF${RUN.slice(5, 11).toUpperCase()}`,
      plan: 'STANDARD',
      status: 'ACTIVE',
      featureFlags: '{}',
    },
  })
  schoolFarId = far.id
  await db.schoolSubscription.create({
    data: {
      schoolId: far.id,
      plan: 'STANDARD',
      status: 'ACTIVE',
      graceDays: 14,
      periodStart: new Date(now() - 90 * DAY_MS),
      periodEnd: new Date(now() + 90 * DAY_MS),
    },
  })
}, 120_000)

function now(): number {
  return Date.now()
}

afterAll(async () => {
  // Fixture teardown — subscriptions die with the tenant cascade; delete
  // them explicitly first so the school delete is a clean cascade root.
  await db.schoolSubscription.deleteMany({ where: { schoolId: { in: [schoolSoonId, schoolFarId].filter(Boolean) } } }).catch(() => undefined)
  if (schoolSoonId) await db.school.delete({ where: { id: schoolSoonId } }).catch(() => undefined)
  if (schoolFarId) await db.school.delete({ where: { id: schoolFarId } }).catch(() => undefined)
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('subscriptions registry — registry-wide renewal summary', () => {
  test(
    'summary tallies match an independent whole-table recomputation',
    async () => {
      const { status, body } = await registry(rootToken, '?pageSize=10')
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      const summary = body.data!.summary!
      const oracle = await recomputeSummary()
      expect(summary.tenantStates).toBeDefined()
      for (const state of STATES) {
        expect(summary.tenantStates![state] ?? 0).toBe(oracle.tenantStates[state] ?? 0)
      }
      expect(summary.subscriptionsExpired).toBe(oracle.expired)
      expect(summary.subscriptionsExpiringWithin30Days).toBe(oracle.expiring30)
      // The fixture-in-window tenant is part of the registry-wide count.
      expect(summary.subscriptionsExpiringWithin30Days).toBeGreaterThanOrEqual(1)
    },
    T,
  )

  test(
    'summary is page-scope-independent (pageSize=1 vs pageSize=100)',
    async () => {
      const tiny = await registry(rootToken, '?pageSize=1')
      const full = await registry(rootToken, '?pageSize=100')
      expect(tiny.status).toBe(200)
      expect(full.status).toBe(200)
      // pageSize clamps to a minimum of 10 — the point of this test is the
      // SUMMARY's page-scope independence, not the page size itself.
      expect(tiny.body.data!.schools.rows.length)
        .toBe(Math.min(full.body.data!.schools.total, 10))
      expect(tiny.body.data!.summary!.subscriptionsExpiringWithin30Days)
        .toBe(full.body.data!.summary!.subscriptionsExpiringWithin30Days)
      expect(tiny.body.data!.summary!.tenantStates).toEqual(full.body.data!.summary!.tenantStates)
      expect(tiny.body.data!.summary!.subscriptionsExpired)
        .toBe(full.body.data!.summary!.subscriptionsExpired)
    },
    T,
  )

  test(
    'expiringDays=30 returns exactly the in-window cohort (fixture in, fixture out)',
    async () => {
      const { status, body } = await registry(rootToken, '?expiringDays=30&pageSize=100')
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      const data = body.data!
      const rows = data.schools.rows
      const now = Date.now()
      // Every returned row is inside the window — none expired, none beyond.
      for (const row of rows) {
        expect(row.periodEnd).not.toBeNull()
        const end = new Date(row.periodEnd!).getTime()
        expect(end).toBeGreaterThanOrEqual(now)
        expect(end).toBeLessThanOrEqual(now + 30 * DAY_MS)
      }
      // The window cohort total equals the registry-wide expiring count.
      expect(data.schools.total).toBe(data.summary!.subscriptionsExpiringWithin30Days)
      // Fixture membership: the soon tenant is listed, the far tenant is not.
      const slugs = rows.map((r) => r.school.slug)
      expect(slugs).toContain(`regsoon-${RUN}`)
      expect(slugs).not.toContain(`regfar-${RUN}`)
    },
    T,
  )

  test(
    'the registry stays fail-closed without a platform session',
    async () => {
      const res = await liveFetch(`${BASE}/api/platform/subscriptions/registry?pageSize=10`, {}, T)
      expect([401, 403]).toContain(res.status)
    },
    T,
  )
})
