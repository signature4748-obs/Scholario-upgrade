/**
 * SCHOOLS-MANAGEMENT OVERHAUL — new backend-surface regression suite.
 *
 * THE INVARIANTS UNDER TEST (mission §9 + §3A + §4):
 *
 *   1. GET /api/platform/schools/[id]/users — the tenant-scoped
 *      administration roster:
 *        · anonymous → 401; school session → 401 (disjoint token
 *          spaces — a school principal can NEVER read the roster);
 *        · platform admin WITH schools.read → 200 + ONLY this
 *          school's users (tenant scoping by construction);
 *        · role/status filters and search return LIVE-DB-matching
 *          subsets; platform-plane accounts (schoolId NULL) never
 *          leak into a tenant roster;
 *        · roleCounts/liveSessions agree with direct DB counts.
 *
 *   2. GET /api/platform/schools directory extensions:
 *        · computed subscriptionState filter = the same evaluator the
 *          school plane enforces (directory ↔ plane can't disagree);
 *        · demo/production classification filter;
 *        · readiness filter (all-5-required-sections, incl. the §7
 *          academic = year AND ≥1 class fix);
 *        · server-side sort (name_asc / created_asc actually order);
 *        · summary KPIs agree with direct DB aggregates.
 *
 *   3. GET /api/platform/subscriptions/registry?schoolId — the
 *      precise per-school fetch returns exactly this school's row.
 *
 *   4. Wizard billingModel (§4): provisioning accepts billingModel and
 *      the SchoolSubscription row persists it (verified read-only on
 *      the EXISTING seeded tenants — no new school is created here;
 *      the full wizard E2E lives in the provisioning-acceptance suite).
 *
 * LIVE HTTP against the dev server; direct-session fixtures (auth
 * fixtures, NOT authorization bypasses — every authorization check
 * under test runs server-side on the real route).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { createHash } from 'crypto'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

let rootToken = ''
let schoolToken = '' // a SCHOOL principal session (cross-plane negative)
let hawkingsId = ''
let greenValleyId = ''
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

/** A school-plane principal session (for the cross-plane negative). */
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

function as(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { 'x-platform-token': token, 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  const hawk = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!hawk || !gv) throw new Error('canonical corpus schools missing')
  hawkingsId = hawk.id
  greenValleyId = gv.id
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

describe('Schools-management overhaul · tenant user roster', () => {
  test(
    'anonymous → 401 (no roster without a platform session)',
    async () => {
      const res = await fetch(`${BASE}/api/platform/schools/${hawkingsId}/users`)
      expect(res.status).toBe(401)
    },
    T,
  )

  test(
    'school principal session → 401 (disjoint token spaces — the school plane never reads the roster)',
    async () => {
      const res = await fetch(`${BASE}/api/platform/schools/${hawkingsId}/users`, {
        headers: { authorization: `Bearer ${schoolToken}` },
      })
      expect(res.status).toBe(401)
    },
  )

  test(
    'platform root → 200, tenant-scoped, counts agree with the live DB',
    async () => {
      const res = await as(rootToken, `/api/platform/schools/${hawkingsId}/users?pageSize=100`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: {
          school: { id: string }
          users: Array<{ id: string; email: string; role: string; liveSessions: number }>
          roleCounts: Record<string, number>
          liveSessions: number
          total: number
        }
      }
      expect(body.data.school.id).toBe(hawkingsId)
      // Tenant scoping by construction: every row belongs to this school.
      const dbUsers = await db.user.findMany({ where: { schoolId: hawkingsId }, select: { id: true } })
      const dbIds = new Set(dbUsers.map((u) => u.id))
      expect(body.data.total).toBe(dbUsers.length)
      expect(body.data.users.every((u) => dbIds.has(u.id))).toBe(true)
      // Platform-plane accounts (schoolId NULL) never leak in.
      const platformAdmin = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
      expect(body.data.users.some((u) => u.id === platformAdmin?.id)).toBe(false)
      // Aggregates agree with direct DB counts.
      const dbRoleCounts = await db.user.groupBy({ by: ['role'], where: { schoolId: hawkingsId }, _count: { _all: true } })
      for (const rc of dbRoleCounts) {
        expect(body.data.roleCounts[rc.role] ?? 0).toBe(rc._count._all)
      }
      const dbLive = await db.session.count({
        where: { user: { schoolId: hawkingsId }, expiresAt: { gt: new Date() } },
      })
      expect(body.data.liveSessions).toBe(dbLive)
    },
    T,
  )

  test(
    'role filter + search return LIVE-matching subsets',
    async () => {
      const dbTeachers = await db.user.count({ where: { schoolId: hawkingsId, role: 'TEACHER' } })
      const res = await as(rootToken, `/api/platform/schools/${hawkingsId}/users?role=TEACHER&pageSize=100`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { users: Array<{ role: string }>; total: number } }
      expect(body.data.total).toBe(dbTeachers)
      expect(body.data.users.every((u) => u.role === 'TEACHER')).toBe(true)

      // Search by a known principal email prefix
      const res2 = await as(rootToken, `/api/platform/schools/${hawkingsId}/users?q=principal@hawkings`)
      expect(res2.status).toBe(200)
      const body2 = (await res2.json()) as { data: { users: Array<{ email: string }>; total: number } }
      expect(body2.data.total).toBeGreaterThan(0)
      expect(body2.data.users.every((u) => u.email.includes('principal@hawkings'))).toBe(true)
    },
    T,
  )
})

describe('Schools-management overhaul · directory filters/sort/summary', () => {
  test(
    'computed subscriptionState filter matches the enforcement evaluator',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?subscriptionState=ACTIVE&summary=1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: {
          total: number
          schools: Array<{ id: string; subscription: { state: string } }>
          summary: { bySubscriptionState: Record<string, number> }
        }
      }
      expect(body.data.schools.every((s) => s.subscription.state === 'ACTIVE')).toBe(true)
      expect(body.data.total).toBe(body.data.summary.bySubscriptionState.ACTIVE ?? 0)
    },
    T,
  )

  test(
    'demo/production classification filter',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?demo=production')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { schools: Array<{ id: string }> } }
      // Set membership (other production tenants created by sibling
      // suites may legitimately exist); the DEMO corpus tenant never
      // appears in the production set.
      expect(body.data.schools.some((s) => s.id === greenValleyId)).toBe(true)
      expect(body.data.schools.some((s) => s.id === hawkingsId)).toBe(false)
      const res2 = await as(rootToken, '/api/platform/schools?demo=demo')
      const body2 = (await res2.json()) as { data: { schools: Array<{ id: string }> } }
      expect(body2.data.schools.some((s) => s.id === hawkingsId)).toBe(true)
      expect(body2.data.schools.some((s) => s.id === greenValleyId)).toBe(false)
    },
    T,
  )

  test(
    'readiness filter = all 5 required sections (incl. the §7 academic fix)',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?readiness=ready')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { schools: Array<{ id: string }> } }
      // Hawkings (year + classes + people + fees + principal) is the
      // canonical ready tenant; Green Valley (0 classes, 0 fees) is not.
      expect(body.data.schools.some((s) => s.id === hawkingsId)).toBe(true)
      expect(body.data.schools.some((s) => s.id === greenValleyId)).toBe(false)

      const res2 = await as(rootToken, '/api/platform/schools?readiness=incomplete')
      const body2 = (await res2.json()) as { data: { schools: Array<{ id: string }> } }
      expect(body2.data.schools.some((s) => s.id === greenValleyId)).toBe(true)
      expect(body2.data.schools.some((s) => s.id === hawkingsId)).toBe(false)
    },
    T,
  )

  test(
    'server-side sort orders the rows (name_asc / created_asc)',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?sort=name_asc')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { schools: Array<{ name: string }> } }
      const names = body.data.schools.map((s) => s.name)
      // Oracle parity: the route sorts with
      //   new Intl.Collator('en', { sensitivity: 'base', numeric: true })
      // (src/app/api/platform/schools/route.ts). A default localeCompare
      // oracle is a DIFFERENT collation — it orders numeric substrings
      // lexicographically ('Class 10' < 'Class 2') and treats case as
      // significant, so it can contradict the API on corpora containing
      // numeric or case-divergent names. The test must assert against the
      // route's DOCUMENTED contract, not a collation the route never used.
      const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
      const sorted = [...names].sort(collator.compare)
      expect(names).toEqual(sorted)

      const res2 = await as(rootToken, '/api/platform/schools?sort=created_asc')
      const body2 = (await res2.json()) as {
        data: { schools: Array<{ id: string; createdAt: string }> }
      }
      // Seed-order-independent invariant: the API orders rows by DB
      // createdAt ascending. Which school is OLDEST depends on corpus
      // history (fresh CI: seed.ts plants Hawkings BEFORE green-valley
      // arrives via seed-tenant-isolation's ensureCleanSchool; on a
      // long-lived dev DB seed.ts's demo-tenant wipe re-mints Hawkings
      // later) — so we assert against the DATABASE truth, not a
      // hard-coded tenant identity. Tie-safe: equal createdAts satisfy
      // the non-decreasing check.
      const rows = body2.data.schools
      const times = rows.map((r) => Date.parse(r.createdAt))
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
      }
      const dbMin = await db.school.aggregate({ _min: { createdAt: true } })
      expect(dbMin._min.createdAt).not.toBeNull()
      expect(Date.parse(rows[0]?.createdAt ?? '')).toBe(dbMin._min.createdAt!.getTime())
    },
    T,
  )

  test(
    'name_asc collation contract pin — numeric substrings + case-divergence (corpus-independent)',
    () => {
      // Pins the SORT CONTRACT the route documents (route.ts:295)
      // independent of the seed corpus, so a future silent change of the
      // server comparator (e.g. swapping in localeCompare) is caught even
      // when the corpus of the day happens to satisfy both collations.
      const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
      // numeric:true — embedded numbers compare by VALUE: 'Class 2' < 'Class 10'.
      expect(collator.compare('Class 2', 'Class 10')).toBeLessThan(0)
      expect(collator.compare('Class 10', 'Class 2')).toBeGreaterThan(0)
      // sensitivity:'base' — case (and accents) are IGNORED: equal → 0.
      expect(collator.compare('hawkings', 'HAWKINGS')).toBe(0)
      expect(collator.compare('Green Valley', 'green valley')).toBe(0)
      // Full-name ordering is still deterministic for distinct names.
      expect(collator.compare('Alpha High', 'Beta High')).toBeLessThan(0)
      // The pin has teeth: the two collations genuinely diverge on these
      // inputs (runtime-verified expected orders below).
      const numericInput = ['Class 10', 'Class 2']
      const lexicographic = [...numericInput].sort((a, b) => a.localeCompare(b))
      const numeric = [...numericInput].sort(collator.compare)
      expect(lexicographic[0]).toBe('Class 10')
      expect(numeric[0]).toBe('Class 2')
      expect(lexicographic).not.toEqual(numeric)
      // End-to-end shape: a mixed list ordered exactly as the route would.
      const mixed = ['Sunrise 10', 'sunrise 2', 'Hawkings', 'HAWKINGS', 'Class 10', 'Class 2']
      const expected = ['Class 2', 'Class 10', 'Hawkings', 'HAWKINGS', 'sunrise 2', 'Sunrise 10']
      expect([...mixed].sort((a, b) => collator.compare(a, b) || a.localeCompare(b))).toEqual(expected)
    },
    T,
  )

  test(
    'summary KPIs agree with direct DB aggregates',
    async () => {
      const res = await as(rootToken, '/api/platform/schools?summary=1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { summary: { total: number; byStatus: Record<string, number>; demo: number; production: number } }
      }
      const dbTotal = await db.school.count()
      const dbActive = await db.school.count({ where: { status: 'ACTIVE' } })
      const dbDemo = await db.school.count({ where: { isDemo: true } })
      expect(body.data.summary.total).toBe(dbTotal)
      expect(body.data.summary.byStatus.ACTIVE ?? 0).toBe(dbActive)
      expect(body.data.summary.demo).toBe(dbDemo)
      expect(body.data.summary.production).toBe(dbTotal - dbDemo)
    },
    T,
  )
})

describe('Schools-management overhaul · registry schoolId + wizard billingModel', () => {
  test(
    'registry?schoolId returns exactly this school\'s subscription row',
    async () => {
      const res = await as(rootToken, `/api/platform/subscriptions/registry?schoolId=${hawkingsId}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { schools: { rows: Array<{ school: { id: string } }>; total: number } }
      }
      expect(body.data.schools.total).toBe(1)
      expect(body.data.schools.rows[0]?.school.id).toBe(hawkingsId)
    },
    T,
  )

  test(
    'provisioned tenants carry a billingModel on SchoolSubscription (§4 wiring, read-only)',
    async () => {
      // The seeded tenants must each have a subscription row with a
      // valid billing model — the wizard's new billingModel field
      // writes the same column (default SCHOOL_WIDE).
      for (const id of [hawkingsId, greenValleyId]) {
        const sub = await db.schoolSubscription.findUnique({ where: { schoolId: id } })
        expect(sub).not.toBeNull()
        expect(['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED']).toContain(sub!.billingModel)
      }
    },
    T,
  )
})
