/**
 * tests/security/subscription-provider-failclosed.test.ts
 *
 * SUBSCRIPTION · zero-credential fail-closed contract (PR-30 no-cost lane).
 *
 * The deployment state this suite pins: NEITHER Razorpay credentials
 * (RAZORPAY_KEY_ID/SECRET) NOR the local test lane (PAYMENTS_SANDBOX) are
 * configured, and the webhook secret (PLATFORM_PAYMENT_WEBHOOK_SECRET) is
 * absent — exactly today's production posture. Under that state:
 *
 *   · online order creation REFUSES with the honest, labeled error —
 *     never a fake success, never a provider order, never a local row;
 *   · server-side verify-and-settle REFUSES ("verification unavailable")
 *     even for a real PENDING order row — no forged confirmation can
 *     settle anything;
 *   · the sandbox helper is unavailable (the sandbox lane exists ONLY
 *     behind an explicit PAYMENTS_SANDBOX=1 — never silently);
 *   · the subscription webhook rejects 401 — with no configured secret
 *     there is NO signature that validates, so no online activation path
 *     exists at all.
 *
 * This is the invariant the owner's no-paid-services constraint depends
 * on: the unconfigured gateway can never unlock an entitlement, and the
 * offline lanes (operator recording + activation codes) keep working.
 *
 * In-process suite (no live server, no HTTP): the provider factory and
 * webhook secret are read from process.env at CALL time, so the env is
 * scrubbed in beforeAll and restored in afterAll. Nothing in the shared
 * test process depends on the provider env (all other provider-path
 * coverage runs against the live dev server via liveFetch).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { AppError } from '@/lib/security/errors'
import {
  createSubscriptionOrder,
  verifyAndSettleOrder,
  sandboxConfirmOrder,
} from '@/lib/subscription/orders'

const RUN = `FC${randomBytes(4).toString('hex').toUpperCase()}`

/** Every env var that could arm a payment provider / webhook verifier. */
const SCRUB_KEYS = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'PAYMENTS_SANDBOX',
  'PAYMENTS_SANDBOX_SECRET',
  'PLATFORM_PAYMENT_WEBHOOK_SECRET',
] as const

const savedEnv: Record<string, string | undefined> = {}
let schoolId = ''
/** PAYMENTS & GATEWAYS REDESIGN — the platform gateway DB lane is part of
 *  the zero-credential contract. Other suites (the gateway acceptance
 *  suite) legitimately arm the singleton DURING their run, so a one-off
 *  disable at beforeAll races. The hermetic mechanism: RENAME the row
 *  away from the well-known id for the window (resolution looks the id
 *  up — a renamed row is invisible), and restore it afterwards, removing
 *  any row a concurrent suite re-planted under the canonical id. */
let parkedGateway: { id: string; status: string } | null = null
const PARKED_ID_PREFIX = 'singleton__parked_failclosed_'

beforeAll(async () => {
  for (const k of SCRUB_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  const gw = await db.platformGatewayConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null)
  if (gw) {
    parkedGateway = { id: gw.id, status: gw.status }
    await db.platformGatewayConfig.update({
      where: { id: gw.id },
      data: { id: `${PARKED_ID_PREFIX}${Date.now()}`, status: gw.status },
    })
  }
  const school = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!school) throw new Error('fixture school missing (run seed:demo)')
  schoolId = school.id
}, 30_000)

afterAll(async () => {
  // Row hygiene: only rows this suite planted (RUN marker).
  await db.subscriptionOrder.deleteMany({ where: { orderNo: { contains: RUN } } }).catch(() => {})
  // Gateway-lane hygiene: drop whatever a concurrent suite re-planted
  // under the canonical id during the window, then restore the parked row.
  await db.platformGatewayConfig.deleteMany({ where: { id: 'singleton' } }).catch(() => {})
  const parked = await db.platformGatewayConfig.findFirst({ where: { id: { startsWith: PARKED_ID_PREFIX } } })
  if (parked) {
    await db.platformGatewayConfig.update({ where: { id: parked.id }, data: { id: 'singleton' } }).catch(() => {})
  }
  // Env hygiene: the scrub is this suite's fixture, not a global change.
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** Re-park immediately before each assertion: a concurrent suite may
 *  legitimately re-arm the canonical singleton mid-window; this shrinks
 *  the race to microseconds around the provider resolution itself. */
async function ensureGatewayParked(): Promise<void> {
  const gw = await db.platformGatewayConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null)
  if (gw) {
    if (!parkedGateway) parkedGateway = { id: gw.id, status: gw.status }
    await db.platformGatewayConfig
      .update({ where: { id: gw.id }, data: { id: `${PARKED_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } })
      .catch(() => {})
  }
}

describe('SUBSCRIPTION · provider fail-closed (no credentials)', () => {
  test('order creation refuses honestly — no provider order, no local row, no fake success', async () => {
    await ensureGatewayParked()
    let err: unknown
    try {
      await createSubscriptionOrder({
        scope: 'STUDENT_PLAN',
        schoolId,
        studentId: 'no-student-failclosed',
        initiatedByUserId: 'no-user-failclosed',
        planId: 'no-plan-failclosed',
        planCode: `FAILCLOSED-${RUN}`,
        interval: 'ANNUAL',
        amount: 1000,
        currency: 'INR',
        validityMonths: 12,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    const appErr = err as AppError
    expect(appErr.publicMessage).toContain('Online payment is not available on this deployment yet')
    // The honest error points the user at the offline lanes.
    expect(appErr.publicMessage).toContain('pay offline')
    // Fail-closed means fail-EMPTY: nothing was persisted.
    const rows = await db.subscriptionOrder.findMany({ where: { planCode: `FAILCLOSED-${RUN}` } })
    expect(rows.length).toBe(0)
  })

  test('verify-and-settle refuses for a real PENDING order (no forged confirmation can settle)', async () => {
    await ensureGatewayParked()
    // The ONLY way an order row exists with no provider configured: planted
    // directly (in reality: recorded by reconciliation/operator flows).
    const order = await db.subscriptionOrder.create({
      data: {
        orderNo: `SCH-ORD-FAILCLOSED-${RUN}`,
        scope: 'STUDENT_PLAN',
        schoolId,
        initiatedByUserId: null,
        planId: null,
        planCode: `FAILCLOSED-${RUN}`,
        interval: 'ANNUAL',
        amount: 1000,
        currency: 'INR',
        validityMonths: 12,
        status: 'PENDING',
        provider: 'RAZORPAY',
        providerOrderId: `order_failclosed_${RUN}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    })
    try {
      let err: unknown
      try {
        await verifyAndSettleOrder({
          orderNo: order.orderNo,
          confirmation: {
            paymentId: `pay_forged_${RUN}`,
            orderId: order.providerOrderId ?? '',
            signature: 'a'.repeat(64),
          },
        })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(AppError)
      const appErr = err as AppError
      expect(appErr.publicMessage).toContain('Payment verification is unavailable on this deployment')
      // Nothing settled: the row is untouched, no payment id recorded.
      const after = await db.subscriptionOrder.findUnique({ where: { id: order.id } })
      expect(after?.status).toBe('PENDING')
      expect(after?.providerPaymentId).toBeNull()
      expect(after?.paidAt).toBeNull()
    } finally {
      await db.subscriptionOrder.delete({ where: { id: order.id } }).catch(() => {})
    }
  })

  test('the sandbox helper stays unavailable without an explicit PAYMENTS_SANDBOX flag', async () => {
    await ensureGatewayParked()
    let err: unknown
    try {
      await sandboxConfirmOrder(`SCH-ORD-FAILCLOSED-${RUN}`)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).publicMessage).toContain('sandbox gateway is not enabled')
  })

  test('the subscription webhook rejects 401 with no configured secret (no validatable signature exists)', async () => {
    const { POST } = await import('@/app/api/webhooks/platform-subscription/route')
    const raw = JSON.stringify({
      eventId: `evt-failclosed-${RUN}`,
      eventType: 'student_subscription.payment.captured',
      payment: { schoolId, amount: 1000, currency: 'INR', providerPaymentId: `pay_fake_${RUN}` },
    })
    const req = new Request('http://127.0.0.1:3000/api/webhooks/platform-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Even a perfectly-formed signature header cannot validate —
        // with no secret there is nothing to verify against.
        'x-scholario-signature': 'b'.repeat(64),
      },
      body: raw,
    })
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    // And the idempotency ledger was never touched (no event row).
    const events = await db.webhookEvent.findMany({ where: { eventId: `evt-failclosed-${RUN}` } })
    expect(events.length).toBe(0)
  })
})
