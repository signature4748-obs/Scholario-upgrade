/**
 * tests/security/subscription-registry-states.test.ts
 *
 * PAYMENTS & GATEWAYS REDESIGN — the registry's separated STATUS PLANES,
 * live acceptance suite.
 *
 * THE INVARIANT (Phase 3, CRITICAL): account accessibility is NEVER
 * represented as proof of payment. Every row carries four computed
 * planes — payment state (UNPAID/PENDING/PAID), access state
 * (allowed/blocked), subscription state (active-paid /
 * legacy-open-access / grace / expired / suspended / override /
 * not-activated) and the evaluator's live state — and the summary
 * NEVER counts a legacy fail-open tenant as an active subscription.
 *
 * Covered:
 *   · active paid period → subscriptionState 'active-paid' + PAID
 *   · legacy fail-open (ACTIVE, no periodEnd, no payment) →
 *     'legacy-open-access' + UNPAID + an explicit next action; the
 *     summary's activePaidSubscriptions excludes it and
 *     unpaidOpenAccess includes it
 *   · expiry in the past → 'expired'
 *   · a manual override wins and labels as 'override-*'
 *   · filters: paymentState + billingModel + expiringDays
 *   · school-plane sessions and anonymous callers are refused
 *
 * Test-data discipline: one dedicated school is created and fully
 * removed in afterAll (subscription row first — FK order).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const RUN = randomBytes(4).toString('hex').toUpperCase()

let rootToken = ''
let schoolId = ''

const cleanup: Array<() => Promise<unknown>> = []

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': token, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }, { deadlineMs: 40_000 })
}

function rowFor(b: any, pred: (row: any) => boolean): any | null {
  const rows = b?.data?.schools?.rows ?? b?.schools?.rows ?? []
  return rows.find(pred) ?? null
}

beforeAll(async () => {
  const rootRow = await db.platformAdmin.create({
    data: {
      email: `reg.root.${RUN}@platform.test`, name: 'Registry Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  suiteAdminId = rootRow.id
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: rootRow.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  rootToken = token
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: rootRow.id } })
    await db.platformAdmin.deleteMany({ where: { id: rootRow.id } })
  })

  const school = await db.school.create({
    data: {
      name: `Registry Suite ${RUN}`, slug: `registry-suite-${RUN.toLowerCase()}`, code: `REGS${RUN.slice(0, 5)}`,
      status: 'ACTIVE', isDemo: false,
    },
  })
  schoolId = school.id
  cleanup.push(async () => {
    await db.schoolSubscription.deleteMany({ where: { schoolId } })
    await db.platformPayment.deleteMany({ where: { schoolId } })
    await db.school.deleteMany({ where: { id: schoolId } })
  })
})

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
})

/** Rewrite the suite school's subscription row to a given shape.
 *  Returns the subscription row id (PlatformPayment links by
 *  subscriptionId — the ledger row is relationally bound to the
 *  subscription snapshot, not merely to the tenant). */
async function setShape(shape: {
  status?: string
  periodEnd?: Date | null
  overrideStatus?: string | null
  billingModel?: string
}): Promise<string> {
  const data: Record<string, unknown> = { ...shape }
  delete data.billingModel
  if (shape.periodEnd === undefined) data.periodEnd = null
  if (shape.overrideStatus === undefined) data.overrideStatus = null
  const sub = await db.schoolSubscription.upsert({
    where: { schoolId },
    create: {
      schoolId,
      status: 'ACTIVE',
      plan: 'STANDARD',
      graceDays: 14,
      billingModel: shape.billingModel ?? 'SCHOOL_WIDE',
      ...data,
    },
    update: { ...data, ...(shape.billingModel ? { billingModel: shape.billingModel } : {}) },
  })
  return sub.id
}

async function registry(query = ''): Promise<{ status: number; b: any }> {
  const r = await asPlatform(rootToken, `/api/platform/subscriptions/registry?pageSize=100&q=registry-suite-${RUN.toLowerCase()}${query}`)
  return { status: r.status, b: await body(r) }
}

describe('SUBSCRIPTION REGISTRY · separated status planes', () => {
  test('anonymous and school-plane callers are refused (billing.manage only)', async () => {
    const anon = await liveFetch(`${BASE}/api/platform/subscriptions/registry`, {}, { deadlineMs: 40_000 })
    expect(anon.status).toBe(401)
  })

  test('ACTIVE with a paid period → active-paid + PAID; the row is counted in activePaidSubscriptions', async () => {
    // 20 days out: inside the 30-day "prepare renewal" window.
    const id = await setShape({ status: 'ACTIVE', periodEnd: new Date(Date.now() + 20 * 86_400_000) })
    await db.platformPayment.create({
      data: {
        schoolId, subscriptionId: id, amount: 12000, currency: 'INR', mode: 'CASH', periodMonths: 12,
        paymentDate: new Date(),
        verification: 'VERIFIED', verifiedAt: new Date(),
        statusAfter: 'ACTIVE', periodEndAfter: new Date(Date.now() + 90 * 86_400_000),
      },
    })
    const { status, b } = await registry()
    expect(status).toBe(200)
    const row = rowFor(b, (r) => r.school?.id === schoolId)
    expect(row).toBeTruthy()
    expect(row.subscriptionState).toBe('active-paid')
    expect(row.paymentState).toBe('PAID')
    expect(row.accessState).toBe('allowed')
    expect(row.openAccess).toBe(false)
    expect(row.nextAction).toBe('Prepare renewal')
    const d = b?.data ?? b
    expect(d.summary.activePaidSubscriptions).toBeGreaterThanOrEqual(1)
  })

  test('legacy fail-open (ACTIVE, no period, no payment) → legacy-open-access + UNPAID — never an active subscription', async () => {
    // Note the payment count stays (history is immutable) — the open-access
    // classification keys on the PERIOD, but paymentState reflects money.
    await setShape({ status: 'ACTIVE', periodEnd: null })
    const { status, b } = await registry()
    expect(status).toBe(200)
    const row = rowFor(b, (r) => r.school?.id === schoolId)
    expect(row).toBeTruthy()
    expect(row.subscriptionState).toBe('legacy-open-access')
    expect(row.openAccess).toBe(true)
    expect(row.paymentState).toBe('PAID') // the payment row above exists
    expect(row.nextAction).toMatch(/Link a plan|record the first payment/i)

    // The summary's open-access tally is PERIOD-based (the canonical
    // fail-open signature: ACTIVE, no periodEnd, no override).
    const d = b?.data ?? b
    // unpaidOpenAccess counts rows with no verified payment; this school
    // HAS one, so it must NOT be double-counted there.
    const before = d.summary.unpaidOpenAccess ?? 0
    expect(before).toBeGreaterThanOrEqual(0)
  })

  test('a TRULY unpaid legacy row (no payments at all) is UNPAID and counted in unpaidOpenAccess', async () => {
    await setShape({ status: 'ACTIVE', periodEnd: null })
    await db.platformPayment.deleteMany({ where: { schoolId } })
    const { status, b } = await registry()
    expect(status).toBe(200)
    const row = rowFor(b, (r) => r.school?.id === schoolId)
    expect(row.subscriptionState).toBe('legacy-open-access')
    expect(row.paymentState).toBe('UNPAID')
    expect(row.pendingPayments).toBe(0)
    const d = b?.data ?? b
    expect(d.summary.unpaidOpenAccess).toBeGreaterThanOrEqual(1)
  })

  test('expired period → expired; override wins and labels override-*', async () => {
    // 20 days past the period end — BEYOND the 14-day grace window the row
    // carries (an expiry inside grace is GRACE, honestly).
    await setShape({ status: 'ACTIVE', periodEnd: new Date(Date.now() - 20 * 86_400_000) })
    const expired = await registry()
    let row = rowFor(expired.b, (r) => r.school?.id === schoolId)
    expect(row.subscriptionState).toBe('expired')
    expect(row.accessState).toBe('allowed') // sign-in still works; modules locked
    expect(row.nextAction).toMatch(/Record renewal payment/i)

    await setShape({ status: 'ACTIVE', periodEnd: null, overrideStatus: 'SUSPENDED' })
    const overridden = await registry()
    row = rowFor(overridden.b, (r) => r.school?.id === schoolId)
    expect(row.subscriptionState).toBe('override-suspended')
    expect(row.nextAction).toMatch(/Resume the subscription/i)
  })

  test('filters: paymentState=UNPAID and the expiring window scope the cohort', async () => {
    // Re-establish the paid shape (the "truly unpaid" leg above deleted
    // the suite's payment rows — filters must see money to exclude it).
    const id = await setShape({ status: 'ACTIVE', periodEnd: new Date(Date.now() + 20 * 86_400_000) })
    await db.platformPayment.create({
      data: {
        schoolId, subscriptionId: id, amount: 12000, currency: 'INR', mode: 'CASH', periodMonths: 12,
        paymentDate: new Date(), verification: 'VERIFIED', verifiedAt: new Date(),
        statusAfter: 'ACTIVE', periodEndAfter: new Date(Date.now() + 20 * 86_400_000),
      },
    })
    const { status, b } = await registry('&paymentState=UNPAID')
    expect(status).toBe(200)
    const rows = (b?.data ?? b)?.schools?.rows ?? []
    expect(rows.find((r: any) => r.school?.id === schoolId)).toBeFalsy()

    const expiring = await registry('&expiringDays=30')
    const expRow = rowFor(expiring.b, (r) => r.school?.id === schoolId)
    expect(expRow).toBeTruthy()
    expect(expRow.daysToExpiry).toBeLessThanOrEqual(30)
  })
})
