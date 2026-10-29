/**
 * tests/security/subscription-terms.test.ts
 *
 * SUBSCRIPTION TERMS — live acceptance suite (2026-10-29 UX redesign).
 *
 * Pins the NEW post-creation commercial-terms capability end-to-end
 * against the dev server:
 *
 *   · PATCH /api/platform/schools/[id]/subscription/terms — the missing
 *     control-plane capability: an EXISTING school can be assigned a
 *     plan, billing model, negotiated price, licensed student count,
 *     interval and start date AFTER creation (licensedStudents was
 *     immutable before this route).
 *   · Terms are NOT payments: status/periodEnd/overrideStatus are never
 *     moved by a terms write (the honest-billing contract).
 *   · Cross-field validation mirrors the add-school wizard's contract
 *     (PER_STUDENT needs licensedStudents; PER_STUDENT is annual-only;
 *     licensedStudents applies to PER_STUDENT only; plan must exist).
 *   · Authorization: billing.manage-gated; non-billing admins get 403;
 *     anonymous transport gets 401.
 *   · Negotiated pricing drives the payment expectation: a school with
 *     terms (₹300/student × 350 licensed) must be paid ₹1,05,000 — the
 *     unit price alone is REJECTED with the spelled-out math.
 *   · The negotiated UNIT price survives the payment (priceSnapshot is
 *     the unit price; the total is computed, never stored twice).
 *   · Duplicate guard: an identical payment (amount/method/currency/
 *     day) within 10 minutes is refused with the earlier receipt
 *     (409 CONFLICT) unless confirmDuplicate re-confirms it.
 *   · Audit trail: terms writes and payments produce audit rows.
 *
 * Test-data discipline: every row this suite creates is tracked and
 * removed in afterAll; the fixture school's subscription posture is
 * saved and restored (the same convention as the sibling suites).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const T = 45_000

// ── fixtures / helpers ───────────────────────────────────────────────────

/** green-valley — the fixture school the sibling suites do NOT mutate. */
let school = { id: '', slug: '' }
let rootToken = ''
let opsToken = ''
let originalSub: {
  billingModel: string
  periodEnd: Date | null
  status: string
  plan: string
  planId: string | null
  planCode: string | null
  interval: string | null
  priceSnapshot: Date | null
  licensedStudents: number | null
  periodStart: Date | null
} | null = null

const cleanup: Array<() => Promise<unknown>> = []
const RUN = randomBytes(4).toString('hex').toUpperCase() // plan codes require uppercase

async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': token, 'content-type': 'application/json' },
  }, { deadlineMs: 40_000 })
}

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

/** Direct PlatformAdminSession row for an admin id (auth fixture). */
async function sessionForAdmin(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

// ── setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const sc = await db.school.findUnique({ where: { slug: 'green-valley' }, include: { subscription: true } })
  if (!sc) throw new Error('fixture school missing (run the seed)')
  school = { id: sc.id, slug: sc.slug }
  if (sc.subscription) {
    originalSub = {
      billingModel: sc.subscription.billingModel,
      periodEnd: sc.subscription.periodEnd,
      status: sc.subscription.status,
      plan: sc.subscription.plan,
      planId: sc.subscription.planId,
      planCode: sc.subscription.planCode,
      interval: sc.subscription.interval,
      priceSnapshot: sc.subscription.priceSnapshot,
      licensedStudents: sc.subscription.licensedStudents,
      periodStart: sc.subscription.periodStart,
    }
  }

  // Per-run throwaway identities (fresh rate-limit budgets):
  //   · ROOT platform admin (isRoot → every capability incl. billing.*)
  //   · non-root OPS admin (no billing.* grants — the negative cases)
  const rootRow = await db.platformAdmin.create({
    data: {
      email: `terms.root.${RUN}@platform.test`, name: 'Terms Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  const opsRow = await db.platformAdmin.create({
    data: {
      email: `terms.ops.${RUN}@platform.test`, name: 'Terms Suite Ops', isRoot: false,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  rootToken = await sessionForAdmin(rootRow.id)
  opsToken = await sessionForAdmin(opsRow.id)
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: { in: [rootRow.id, opsRow.id] } } })
    await db.platformAdmin.deleteMany({ where: { id: { in: [rootRow.id, opsRow.id] } } })
  })

  // The plan this suite links the school to (created through the real API).
  const mk = await asPlatform(rootToken, '/api/platform/subscriptions/plans', {
    method: 'POST',
    body: JSON.stringify({
      code: `TERMS-SCH-A-${RUN}`,
      name: 'Terms Suite School Annual',
      description: 'Suite plan — fixed school annual fee.',
      scope: 'SCHOOL',
      interval: 'ANNUAL',
      priceAnnual: 24000,
      currency: 'INR',
    }),
  })
  expect(mk.status).toBe(200)
  cleanup.push(async () => {
    await db.platformPayment.deleteMany({ where: { notes: { contains: RUN } } })
    await db.platformAuditLog.deleteMany({ where: { reason: { contains: RUN } } }).catch(() => {})
    await db.subscriptionPlan.deleteMany({ where: { code: `TERMS-SCH-A-${RUN}` } })
  })
}, 120_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Restore the fixture school's saved posture (no suite residue).
  await db.schoolSubscription.update({
    where: { schoolId: school.id },
    data: {
      billingModel: originalSub?.billingModel ?? 'SCHOOL_WIDE',
      periodEnd: originalSub?.periodEnd ?? null,
      status: originalSub?.status ?? 'ACTIVE',
      plan: originalSub?.plan ?? 'STANDARD',
      planId: originalSub?.planId ?? null,
      planCode: originalSub?.planCode ?? null,
      interval: originalSub?.interval ?? null,
      priceSnapshot: originalSub?.priceSnapshot ?? null,
      licensedStudents: originalSub?.licensedStudents ?? null,
      periodStart: originalSub?.periodStart ?? null,
      overrideStatus: null,
    },
  }).catch(() => {})
  await db.$disconnect()
})

const termsPath = () => `/api/platform/schools/${school.id}/subscription/terms`
const paymentsPath = () => `/api/platform/schools/${school.id}/subscription/payments`

// ── authorization ────────────────────────────────────────────────────────

describe('TERMS · authorization (the control-plane boundary)', () => {
  test('anonymous transport → 401 (no platform session)', async () => {
    const r = await liveFetch(`${BASE}${termsPath()}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billingModel: 'SCHOOL_WIDE', reason: 'anon probe' }),
    }, { deadlineMs: 40_000 })
    expect(r.status).toBe(401)
  }, T)

  test('non-billing admin → 403 (fail-closed permission check)', async () => {
    const r = await asPlatform(opsToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({ billingModel: 'SCHOOL_WIDE', reason: 'ops probe' }),
    })
    expect(r.status).toBe(403)
  }, T)
})

// ── the terms write ──────────────────────────────────────────────────────

describe('TERMS · post-creation commercial terms (the new capability)', () => {
  test('PER_STUDENT terms: plan + model + negotiated price + licensed count persist', async () => {
    const before = await db.schoolSubscription.findUnique({ where: { schoolId: school.id } })
    const r = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({
        planCode: `TERMS-SCH-A-${RUN}`,
        billingModel: 'PER_STUDENT',
        price: 300,
        currency: 'INR',
        licensedStudents: 350,
        reason: `suite ${RUN}: negotiated 300/student for 350 students`,
      }),
    })
    expect(r.status).toBe(200)
    const b = await body(r)
    expect(b?.ok ?? b?.data?.ok).toBe(true)
    // The honest-billing contract is stated on the wire.
    expect(String(b?.message ?? b?.data?.message ?? '')).toContain('verified payment')

    const after = await db.schoolSubscription.findUnique({ where: { schoolId: school.id } })
    expect(after?.planCode).toBe(`TERMS-SCH-A-${RUN}`)
    expect(after?.planId).toBeTruthy()
    expect(after?.billingModel).toBe('PER_STUDENT')
    expect(Number(after?.priceSnapshot)).toBe(300)
    expect(after?.licensedStudents).toBe(350)
    expect(after?.interval).toBe('ANNUAL')

    // TERMS ARE NOT PAYMENTS: the enforced state never moves.
    expect(after?.periodEnd?.toISOString()).toBe(before?.periodEnd?.toISOString())
    expect(after?.status).toBe(before?.status)
    expect(after?.overrideStatus).toBeNull()
  }, T)

  test('terms write is audited with before → after', async () => {
    const audits = await db.platformAuditLog.findMany({
      where: { action: 'platform.billing.terms_updated', schoolId: school.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    expect(audits.length).toBe(1)
    expect(String(audits[0]?.reason ?? '')).toContain(RUN)
    const meta = JSON.parse(String(audits[0]?.metadata ?? '{}'))
    expect(meta?.after?.licensedStudents).toBe(350)
    expect(Number(meta?.after?.priceSnapshot)).toBe(300)
  }, T)

  test('renegotiation works too: SCHOOL_WIDE fixed fee replaces the per-student terms', async () => {
    const r = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({
        billingModel: 'SCHOOL_WIDE',
        price: 24000,
        interval: 'ANNUAL',
        licensedStudents: null,
        reason: `suite ${RUN}: switched to fixed annual fee`,
      }),
    })
    expect(r.status).toBe(200)
    const after = await db.schoolSubscription.findUnique({ where: { schoolId: school.id } })
    expect(after?.billingModel).toBe('SCHOOL_WIDE')
    expect(Number(after?.priceSnapshot)).toBe(24000)
    expect(after?.licensedStudents).toBeNull()
  }, T)

  test('validation: PER_STUDENT requires the licensed count', async () => {
    const r = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({ billingModel: 'PER_STUDENT', reason: `suite ${RUN}: missing count` }),
    })
    expect(r.status).toBe(422)
    const b = await body(r)
    expect(String(b?.error ?? '')).toContain('licensed student count')
  }, T)

  test('validation: PER_STUDENT is annual-only', async () => {
    const r = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({
        billingModel: 'PER_STUDENT',
        licensedStudents: 100,
        interval: 'MONTHLY',
        price: 300,
        reason: `suite ${RUN}: illegal monthly per-student`,
      }),
    })
    expect(r.status).toBe(422)
  }, T)

  test('validation: licensedStudents only applies to PER_STUDENT', async () => {
    const r = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({
        billingModel: 'SCHOOL_WIDE',
        licensedStudents: 100,
        reason: `suite ${RUN}: count on school-wide`,
      }),
    })
    expect(r.status).toBe(422)
  }, T)

  test('validation: unknown plan → 404; short reason → 422', async () => {
    const r1 = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({ planCode: `NO-SUCH-PLAN-${RUN}`, reason: `suite ${RUN}: ghost plan` }),
    })
    expect(r1.status).toBe(404)

    const r2 = await asPlatform(rootToken, termsPath(), {
      method: 'PATCH',
      body: JSON.stringify({ billingModel: 'SCHOOL_WIDE', reason: 'ab' }),
    })
    expect(r2.status).toBe(422)
  }, T)
})

// ── negotiated pricing in the payment flow ───────────────────────────────

describe('TERMS · negotiated pricing drives the recorded payment', () => {
  test(
    'per-student total is enforced: ₹300 × 350 licensed = ₹1,05,000 expected',
    async () => {
      // Terms: back to per-student with a negotiated unit price.
      const set = await asPlatform(rootToken, termsPath(), {
        method: 'PATCH',
        body: JSON.stringify({
          planCode: `TERMS-SCH-A-${RUN}`,
          billingModel: 'PER_STUDENT',
          price: 300,
          currency: 'INR',
          licensedStudents: 350,
          reason: `suite ${RUN}: per-student terms for the payment flow`,
        }),
      })
      expect(set.status).toBe(200)

      const before = await db.schoolSubscription.findUnique({ where: { schoolId: school.id } })

      // The UNIT price alone is rejected — the spelled-out math explains why.
      const wrongAmount = await asPlatform(rootToken, paymentsPath(), {
        method: 'POST',
        body: JSON.stringify({
          planCode: `TERMS-SCH-A-${RUN}`,
          amount: 300,
          currency: 'INR',
          mode: 'CASH',
          paymentDate: new Date().toISOString(),
          notes: `suite ${RUN} wrong-amount probe`,
        }),
      })
      expect(wrongAmount.status).toBe(422)
      const wb = await body(wrongAmount)
      expect(String(wb?.error ?? '')).toContain('300')
      expect(String(wb?.error ?? '')).toContain('350')
      expect(String(wb?.error ?? '')).toContain('105000')

      // The correct total activates the subscription.
      const ok = await asPlatform(rootToken, paymentsPath(), {
        method: 'POST',
        body: JSON.stringify({
          planCode: `TERMS-SCH-A-${RUN}`,
          amount: 105000,
          currency: 'INR',
          mode: 'CASH',
          paymentDate: new Date().toISOString(),
          notes: `suite ${RUN} per-student annual payment`,
        }),
      })
      expect(ok.status).toBe(200)
      const ob = await body(ok)
      expect(ob?.payment?.receiptNo ?? ob?.data?.payment?.receiptNo).toMatch(/^SCH-RCP-/)

      const after = await db.schoolSubscription.findUnique({ where: { schoolId: school.id } })
      expect(after?.periodEnd?.getTime()).toBeGreaterThan(before?.periodEnd?.getTime() ?? 0)
      expect(after?.status).toBe('ACTIVE')
      // The negotiated UNIT price survives the payment (the total is
      // computed, never stored twice).
      expect(Number(after?.priceSnapshot)).toBe(300)
      expect(after?.licensedStudents).toBe(350)

      // The payment row itself carries the paid total.
      const payment = await db.platformPayment.findFirst({
        where: { schoolId: school.id, notes: { contains: `${RUN} per-student annual payment` } },
      })
      expect(Number(payment?.amount)).toBe(105000)
      expect(payment?.verification).toBe('VERIFIED')
    },
    T,
  )

  test(
    'duplicate guard: identical payment within 10 minutes → 409 with the earlier receipt; confirmDuplicate records it anyway',
    async () => {
      // Identical amount/method/currency/day as the payment just recorded.
      const dup = await asPlatform(rootToken, paymentsPath(), {
        method: 'POST',
        body: JSON.stringify({
          planCode: `TERMS-SCH-A-${RUN}`,
          amount: 105000,
          currency: 'INR',
          mode: 'CASH',
          paymentDate: new Date().toISOString(),
          notes: `suite ${RUN} duplicate probe`,
        }),
      })
      expect(dup.status).toBe(409)
      const db_ = await body(dup)
      expect(String(db_?.error ?? '')).toContain('SCH-RCP-')

      // Re-confirmed as a GENUINE second payment → recorded.
      const again = await asPlatform(rootToken, paymentsPath(), {
        method: 'POST',
        body: JSON.stringify({
          planCode: `TERMS-SCH-A-${RUN}`,
          amount: 105000,
          currency: 'INR',
          mode: 'CASH',
          paymentDate: new Date().toISOString(),
          notes: `suite ${RUN} genuine second payment`,
          confirmDuplicate: true,
        }),
      })
      expect(again.status).toBe(200)
    },
    T,
  )
})
