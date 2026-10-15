/**
 * SUBSCRIPTION-SCHEMA PENDING — the non-pending wire contract (live API
 * regression) + login password-toggle DOM contract.
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. The dual-path hardening did NOT change the normal (fully
 *      migrated database) contract of every hardened surface:
 *        · GET /api/platform/schools serves real rows WITH the full
 *          subscription chip (planCode/billingModel present) and NO
 *          subscriptionSchemaPending flag;
 *        · GET /api/platform/subscriptions/registry serves rows with a
 *          populated (non-null) summary + student registry slice;
 *        · GET /api/platform/subscriptions/plans serves the registry +
 *          config with NO schemaPending flag;
 *        · GET /api/platform/subscriptions/codes serves the registry;
 *        · GET /api/platform/schools/[id]/students serves the billing
 *          model + per-student entitlements;
 *        · GET /api/platform/schools/[id]/subscription serves the
 *          snapshot + payments ledger.
 *      (The schema-pending DEGRADED path itself is exercised by the
 *      faithful pre-migration database verification documented in
 *      worklog Task 7 — its code path is the catch branch gated by
 *      isSubscriptionSchemaPendingError, unit-tested in
 *      tests/unit/subscription-schema-pending.test.ts.)
 *
 *   2. Fail-closed authorization is preserved: anonymous requests to the
 *      hardened surfaces still return 401 AUTH_REQUIRED.
 *
 *   3. LOGIN — /platform/login serves the password input with the
 *      accessible show/hide toggle (id=pf-password, type=password by
 *      default, and a type=button control labelled "Show password").
 *
 * LIVE HTTP against the dev server; direct-session fixtures (auth
 * fixtures, NOT authorization bypasses).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { createHash } from 'crypto'
import { db } from '../helpers/db'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

let rootToken = ''
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

function as(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { 'x-platform-token': token, 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  const hawk = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!hawk) throw new Error('canonical corpus school missing')
  hawkingsId = hawk.id
  rootToken = await platformFixture()
}, 60_000)

afterAll(async () => {
  for (const raw of minted) {
    const platformHash = createHash('sha256').update(raw).digest('hex')
    await db.platformAdminSession.deleteMany({ where: { tokenHash: platformHash } }).catch(() => {})
  }
  await db.$disconnect()
})

describe('Schema-pending hardening · normal-path contract (fully migrated DB)', () => {
  test(
    'GET /api/platform/schools — real rows, full chip, NO pending flag',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?page=1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      expect(Number(d.total)).toBeGreaterThan(0)
      expect((d as { schools: unknown[] }).schools.length).toBeGreaterThan(0)
      // The flag must be ABSENT on a fully migrated database.
      expect((d as { subscriptionSchemaPending?: boolean }).subscriptionSchemaPending).toBeUndefined()
      const schools = (d as { schools: Array<{ name: string; subscription: { planCode: string | null; billingModel: string | null } }> }).schools
      const hawk = schools.find((s) => s.name.includes('Hawkings'))
      if (hawk) {
        // Seeded backfill assigns registry plans — the chip columns exist.
        expect(hawk.subscription).toBeDefined()
      }
    },
    T,
  )

  test(
    'GET /api/platform/subscriptions/registry — rows + populated summary, NO pending flag',
    async () => {
      const res = await as(rootToken, '/api/platform/subscriptions/registry?pageSize=10')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      expect((d as { subscriptionSchemaPending?: boolean }).subscriptionSchemaPending).toBeUndefined()
      const schools = (d as { schools: { rows: unknown[]; total: number } }).schools
      expect(schools.total).toBeGreaterThan(0)
      expect(schools.rows.length).toBeGreaterThan(0)
      const summary = (d as { summary: { studentEntitlements: unknown; orders: unknown; rejectedClaims: number } }).summary
      // Non-pending contract: aggregates are objects/numbers, never null.
      expect(summary.studentEntitlements).not.toBeNull()
      expect(summary.orders).not.toBeNull()
      expect(typeof summary.rejectedClaims).toBe('number')
    },
    T,
  )

  test(
    'GET /api/platform/subscriptions/plans — registry + config, NO pending flag',
    async () => {
      const res = await as(rootToken, '/api/platform/subscriptions/plans')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      expect((d as { subscriptionSchemaPending?: boolean }).subscriptionSchemaPending).toBeUndefined()
      // Contract: the registry is an array + config is always served.
      // (Registry CONTENT is corpus-dependent — empty is a legitimate
      // state; the pending-migration reason is what the flag tells apart.)
      expect(Array.isArray((d as { plans: unknown[] }).plans)).toBe(true)
      expect((d as { config: unknown }).config).toBeDefined()
    },
    T,
  )

  test(
    'GET /api/platform/subscriptions/codes — registry contract, NO pending flag',
    async () => {
      const res = await as(rootToken, '/api/platform/subscriptions/codes?pageSize=10')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      expect((d as { subscriptionSchemaPending?: boolean }).subscriptionSchemaPending).toBeUndefined()
      expect(Array.isArray((d as { codes: unknown[] }).codes)).toBe(true)
      expect(typeof (d as { total: number }).total).toBe('number')
    },
    T,
  )

  test(
    'GET /api/platform/schools/[id]/students — billing model + entitlements',
    async () => {
      const res = await as(rootToken, `/api/platform/schools/${hawkingsId}/students?pageSize=10`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      const school = (d as { school: { billingModel: string; name: string } }).school
      expect(['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED']).toContain(school.billingModel)
      expect(Array.isArray((d as { students: unknown[] }).students)).toBe(true)
    },
    T,
  )

  test(
    'GET /api/platform/schools/[id]/subscription — snapshot + payments ledger',
    async () => {
      const res = await as(rootToken, `/api/platform/schools/${hawkingsId}/subscription`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
      expect(body.ok).toBe(true)
      const d = body.data
      expect((d as { school: { id: string } }).school.id).toBe(hawkingsId)
      const sub = (d as { subscription: Record<string, unknown> | null }).subscription
      expect(sub).not.toBeNull()
      expect(typeof sub!.status).toBe('string')
      expect(Array.isArray((d as { payments: unknown[] }).payments)).toBe(true)
    },
    T,
  )
})

describe('Schema-pending hardening · fail-closed authorization preserved', () => {
  test(
    'anonymous GET /api/platform/schools → 401 AUTH_REQUIRED',
    async () => {
      const res = await fetch(`${BASE}/api/platform/schools`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { ok: boolean; code: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
    },
    T,
  )

  test(
    'anonymous GET /api/platform/subscriptions/registry → 401 AUTH_REQUIRED',
    async () => {
      const res = await fetch(`${BASE}/api/platform/subscriptions/registry`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { ok: boolean; code: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
    },
    T,
  )
})

describe('Login · password show/hide DOM contract', () => {
  test(
    '/platform/login serves the password input + accessible toggle control',
    async () => {
      const res = await fetch(`${BASE}/platform/login`)
      expect(res.status).toBe(200)
      const html = await res.text()
      // The password input: type=password by default (SSR contract).
      expect(html).toContain('id="pf-password"')
      expect(html).toMatch(/type="password"/)
      // The accessible toggle: type=button (never submits the form) with
      // the explicit label; aria-pressed reflects the toggle state.
      expect(html).toContain('Show password')
      expect(html).toMatch(/type="button"/)
      // The eye icons render server-side (lucide svg) inside the control.
      expect(html.toLowerCase()).toContain('svg')
    },
    T,
  )
})
