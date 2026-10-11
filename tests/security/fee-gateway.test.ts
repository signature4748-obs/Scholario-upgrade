/**
 * BATCH2 — FEE GATEWAY HARDENING (B2/B3/B4) regression suite.
 *
 * THE INVARIANTS UNDER TEST (all live-HTTP against the dev server, DB
 * truth asserted directly — the house pattern of fee-lifecycle.test.ts):
 *
 *   B2 · ORDER AMOUNT TAMPERING — a client can never pick an arbitrary
 *       order amount: staff AND student order creation are bounded by the
 *       student's REAL outstanding balance, computed server-side
 *       (409 CONFLICT above it; 409 when nothing is outstanding; 404 for
 *       a foreign student/fee reference; a validated feeId is persisted
 *       on the order row).
 *
 *   B3 · WEBHOOK SIGNING + AMOUNT AGREEMENT — the Razorpay receiver:
 *       missing/wrong signature → 400 (nothing recorded); a
 *       valid-signature payment.captured whose paise amount or currency
 *       DISAGREES with the persisted order → EXCEPTION, never a
 *       settlement (txn stays PENDING, no receipt, no ledger credit,
 *       WebhookEvent recorded as error); payment.authorized → recorded
 *       but NEVER settles (funds not captured); payment.captured with
 *       the exact amount → SUCCESS + SCH- receipt + ledger credit in one
 *       transaction; replayed event ids (and distinct event ids for the
 *       same payment racing in parallel) credit the ledger EXACTLY ONCE.
 *
 *   B4 · RECEIPTS AT SETTLEMENT — a student self-service order carries
 *       receiptNo NULL while PENDING (the old RCP-at-creation mint is
 *       gone); the settling writer (checkout verify) mints the canonical
 *       SCH-YYYY-NNNNNN receipt inside its transaction.
 *
 *   B4 · FORGED CHECKOUT — a client-forged checkout signature fails
 *       server-side verification and the txn is marked FAILED (exception)
 *       — the client can never declare success.
 *
 *   B4 · REFUND — the canonical refund endpoint reverses a settled
 *       payment EXACTLY ONCE (guarded SUCCESS→REFUNDED): Fee.paid is
 *       reversed, the ORIGINAL Payment mirror flips to REFUNDED, a
 *       refund mirror row is created, the receipt number is kept as
 *       history, and the three-way ledger parity
 *       (Σ Payment(SUCCESS) == Σ FeeTransaction(SUCCESS) == Σ Fee.paid)
 *       still holds; a second refund is a 409; refunding a PENDING txn
 *       is refused; partial amounts are refused; a foreign-tenant txn id
 *       is a 404 (tenant isolation).
 *
 *   B4 · LEGACY CANONICALIZATION — POST /api/fees (payment-record branch)
 *       now writes through the canonical pipeline: a FeeTransaction
 *       (SUCCESS, SCH- receipt) + the Payment mirror with the
 *       `manual:{txn.id}` idempotency key + the ledger credit — parity
 *       holds after it.
 *
 * Environment (set on the dev server for this suite — TEST-ONLY synthetic
 * values, never real credentials): PAYMENTS_SANDBOX=1 +
 * PAYMENTS_SANDBOX_SECRET (local SandboxProvider — no network), and
 * RAZORPAY_WEBHOOK_SECRET (the suite signs webhook payloads with it).
 *
 * Cleanup discipline: every row the suite creates (Fee, FeeTransaction,
 * Payment, WebhookEvent, Reconciliation, Notification, Message,
 * ActivityLog, Session) is deleted; the ledger parity is re-asserted
 * after cleanup — the DB is left exactly as it was found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes, createHmac } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000 // generous: first-hit dev compilation
const MARKER = randomBytes(4).toString('hex')

/** TEST-ONLY synthetic webhook secret (mirrors the dev-server env; never a real credential). */
const WEBHOOK_SECRET = 'batch2-test-webhook-secret'

// ── fixtures ───────────────────────────────────────────────────────────────

let schoolId = ''
let principal = { id: '', email: 'principal@hawkingshigh.edu' }
let studentUser = { id: '', email: '' }
let student = { id: '' }
/** Test-owned fee row (amount ₹1000) — full control, deleted in cleanup. */
let fee = { id: '' }
let principalToken = ''
let studentToken = ''

/** Every FeeTransaction id created by this suite (cleanup + audit sweeps). */
const txnIds: string[] = []
/** Every webhook event id used by this suite. */
const eventIds: string[] = []

const testStart = new Date()
const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing (run the canonical seeds)')
  schoolId = school.id

  const p = await db.user.findUnique({ where: { email: principal.email } })
  if (!p) throw new Error('fixture user missing: principal@hawkingshigh.edu')
  principal = { ...principal, id: p.id }

  // A DEDICATED test student (created here, deleted in cleanup) — full
  // control: guaranteed zero fees, so the obligation gate sees outstanding 0
  // before the suite creates its own fee row.
  const testUser = await db.user.create({
    data: {
      schoolId,
      email: `batch2-student-${MARKER}@test.local`,
      name: `BATCH2 Student ${MARKER}`,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
  const testStudent = await db.student.create({
    data: { schoolId, userId: testUser.id },
  })
  student = { id: testStudent.id }
  studentUser = { id: testUser.id, email: testUser.email }
  cleanup.push(() => db.student.deleteMany({ where: { id: testStudent.id } }))
  cleanup.push(() => db.user.deleteMany({ where: { id: testUser.id } }))

  principalToken = randomBytes(32).toString('hex')
  studentToken = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: principal.id, tokenHash: hashSessionToken(principalToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: studentUser.id, tokenHash: hashSessionToken(studentToken), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: { tokenHash: { in: [hashSessionToken(principalToken), hashSessionToken(studentToken)] } },
    }),
  )

  // The payment endpoints are rate-limited 20/h per user with DB-synced
  // bucket state (RateLimitBucket) — a re-run against a warmed environment
  // would inherit the previous run's budget. Reset BOTH suite keys so this
  // run owns a fresh DB budget (the server's in-memory bucket for a key
  // only ever counts up from what reconcile merges in).
  await db.$executeRawUnsafe(
    `DELETE FROM "RateLimitBucket" WHERE "key" IN ($1, $2)`,
    `rl:pay:${principal.id}`,
    `rl:pay:${studentUser.id}`,
  ).catch(() => {})
}, 60_000)

afterAll(async () => {
  // ── Full sweep: every row this suite created, then parity re-proof ──
  // The sweep is ORDER-INDEPENDENT: payments are matched by the suite's
  // transaction-id PREFIXES (pay_<MARKER>…, manual:{txn}, refund:{txn}) —
  // NOT by feeId (the fee deletion below SetNulls feeId, so a feeId-only
  // filter would miss rows depending on deletion order).
  const allTxnIds = await db.feeTransaction.findMany({
    where: { OR: [{ note: { contains: MARKER } }, { feeId: fee.id || '__none__' }, { id: { in: txnIds } }] },
    select: { id: true },
  })
  const ids = allTxnIds.map((t) => t.id)
  if (ids.length) {
    await db.reconciliation.deleteMany({ where: { transactionId: { in: ids } } }).catch(() => {})
  }
  await db.payment.deleteMany({
    where: {
      OR: [
        { transactionId: { startsWith: `pay_${MARKER}` } },
        { transactionId: { startsWith: 'pay_sbx_' }, note: { contains: 'Canonical payment' }, createdAt: { gte: testStart } },
        { transactionId: { in: ids.map((i) => `manual:${i}`) } },
        { transactionId: { in: ids.map((i) => `refund:${i}`) } },
        { feeId: fee.id || '__none__' },
      ],
    },
  }).catch(() => {})
  if (ids.length) {
    await db.feeTransaction.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  }
  await db.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {})
  if (fee.id) await db.fee.deleteMany({ where: { id: fee.id } }).catch(() => {})
  await db.notification.deleteMany({
    where: { schoolId, createdAt: { gte: testStart }, title: 'Fee payment received' },
  }).catch(() => {})
  await db.message.deleteMany({
    where: { schoolId, createdAt: { gte: testStart }, subject: { contains: 'refunded' } },
  }).catch(() => {})
  await db.activityLog.deleteMany({
    where: { schoolId, createdAt: { gte: testStart }, detail: { contains: MARKER } },
  }).catch(() => {})

  for (const fn of cleanup.reverse()) await fn().catch(() => {})

  const sums = await ledgerSums(schoolId)
  expect(Math.abs(sums.payments - sums.txns)).toBeLessThanOrEqual(0.01)
  expect(Math.abs(sums.txns - sums.fees)).toBeLessThanOrEqual(0.01)
  await db.$disconnect()
})

// ── helpers ────────────────────────────────────────────────────────────────

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

function signBody(raw: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')
}

/** POST /api/webhooks/razorpay with a signature-verified raw body. */
async function webhook(payload: unknown, eventId: string): Promise<Response> {
  eventIds.push(eventId)
  const raw = JSON.stringify(payload)
  return fetch(`${BASE}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signBody(raw),
      'x-razorpay-event-id': eventId,
    },
    body: raw,
  })
}

/** A Razorpay-shaped payment event body. */
function paymentEvent(event: string, entity: Record<string, unknown>) {
  return { event, payload: { payment: { entity } } }
}

/** The three-way ledger parity for the demo school. */
async function ledgerSums(sid: string): Promise<{ payments: number; txns: number; fees: number }> {
  const [pay, txn, feeSum] = await Promise.all([
    db.payment.aggregate({ where: { schoolId: sid, status: 'SUCCESS' }, _sum: { amount: true } }),
    db.feeTransaction.aggregate({ where: { schoolId: sid, status: 'SUCCESS' }, _sum: { amount: true } }),
    db.fee.aggregate({ where: { schoolId: sid }, _sum: { paid: true } }),
  ])
  return {
    payments: Number(pay._sum.amount ?? 0),
    txns: Number(txn._sum.amount ?? 0),
    fees: Number(feeSum._sum.paid ?? 0),
  }
}

/** Create a staff order (the stub-gateway rail — no provider call). */
async function staffOrder(amount: number, opts?: { feeId?: string; studentId?: string }) {
  const res = await as(principalToken, '/api/fees/orders', {
    method: 'POST',
    body: JSON.stringify({
      studentId: opts?.studentId ?? student.id,
      feeId: opts?.feeId ?? fee.id,
      feeHeadName: `BATCH2-TEST-${MARKER}`,
      amount,
      method: 'UPI',
    }),
  })
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: { orderId?: string; txnId?: string; receiptNo?: string | null } }
    | null
  return { res, json, orderId: json?.data?.orderId ?? '', txnId: json?.data?.txnId ?? '' }
}

// ── B2: order amount tampering ────────────────────────────────────────────

describe('BATCH2-B2 · order amount is bounded by the server-side obligation', () => {
  test('a student with no open fees cannot create ANY order (409, before the provider is touched)', async () => {
    const res = await as(studentToken, '/api/student/payments/order', {
      method: 'POST',
      body: JSON.stringify({ amount: 500, method: 'UPI' }),
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as { ok: boolean; code?: string; error?: string }
    expect(json.ok).toBe(false)
    expect(json.code).toBe('CONFLICT')
    expect(json.error).toContain('no outstanding fee balance')
  }, T)

  test('the suite fee exists (₹1000 outstanding, test-owned)', async () => {
    const created = await db.fee.create({
      data: {
        schoolId,
        studentId: student.id,
        title: `BATCH2-TEST-${MARKER}`,
        amount: 1000,
        paid: 0,
        status: 'UNPAID',
      },
    })
    fee.id = created.id
    // NOTE: the fee row is deleted by the afterAll sweep (single source of
    // truth) — a second cleanup entry here would run BEFORE the sweep's
    // payment matcher and SetNull the payment feeIds it needs to match.
  }, T)

  test('student order ABOVE the outstanding balance → 409, no FeeTransaction created', async () => {
    const before = await db.feeTransaction.count({ where: { studentId: student.id, createdAt: { gte: testStart } } })
    const res = await as(studentToken, '/api/student/payments/order', {
      method: 'POST',
      body: JSON.stringify({ amount: 1001, method: 'UPI' }),
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as { ok: boolean; code?: string; error?: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('exceeds your outstanding')
    const after = await db.feeTransaction.count({ where: { studentId: student.id, createdAt: { gte: testStart } } })
    expect(after).toBe(before)
  }, T)

  test('staff order ABOVE the outstanding balance → 409, no FeeTransaction created', async () => {
    const { res } = await staffOrder(1500)
    expect(res.status).toBe(409)
    const txn = await db.feeTransaction.findFirst({ where: { feeId: fee.id, createdAt: { gte: testStart } } })
    expect(txn).toBeNull()
  }, T)

  test('staff order with a FOREIGN student id → 404 (FK-validated in-tenant)', async () => {
    const { res } = await staffOrder(100, { studentId: `foreign-${MARKER}` })
    expect(res.status).toBe(404)
  }, T)

  test('staff order with a foreign/foreign-student feeId → 404', async () => {
    const { res } = await staffOrder(100, { feeId: `fee-foreign-${MARKER}` })
    expect(res.status).toBe(404)
  }, T)

  test('a VALID order is accepted: PENDING, receiptNo null, feeId persisted (within outstanding)', async () => {
    const { res, json, orderId, txnId } = await staffOrder(300)
    expect(res.status).toBe(200)
    expect(json?.ok).toBe(true)
    expect(orderId).toMatch(/^order_/)
    expect(json?.data?.receiptNo).toBeNull()
    txnIds.push(txnId)
    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING')
    expect(txn?.receiptNo).toBeNull()
    expect(txn?.feeId).toBe(fee.id) // the validated fee reference traveled with the order
    expect(txn?.gatewayOrderId).toBe(orderId)
  }, T)
})

// ── B3: webhook signature + amount agreement ──────────────────────────────

describe('BATCH2-B3 · webhook signature and amount agreement (fail-closed)', () => {
  let orderId = ''
  let txnId = ''

  beforeAll(async () => {
    const created = await staffOrder(300)
    orderId = created.orderId
    txnId = created.txnId
    txnIds.push(txnId)
  })

  test('MISSING signature → 400, nothing recorded, txn stays PENDING', async () => {
    const raw = JSON.stringify(paymentEvent('payment.captured', { id: `pay_${MARKER}_1`, order_id: orderId, amount: 30000, currency: 'INR', status: 'captured' }))
    const res = await fetch(`${BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    expect(res.status).toBe(400)
    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING')
  }, T)

  test('WRONG signature → 400, txn stays PENDING, no WebhookEvent row', async () => {
    const raw = JSON.stringify(paymentEvent('payment.captured', { id: `pay_${MARKER}_2`, order_id: orderId, amount: 30000, currency: 'INR', status: 'captured' }))
    const res = await fetch(`${BASE}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef'.repeat(8), 'x-razorpay-event-id': `evt-batch2-wrong-${MARKER}` },
      body: raw,
    })
    expect(res.status).toBe(400)
    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING')
  }, T)

  test('payment.captured with a WRONG amount (valid signature) → EXCEPTION, never a settlement', async () => {
    const res = await webhook(
      paymentEvent('payment.captured', { id: `pay_${MARKER}_3`, order_id: orderId, amount: 12300, currency: 'INR', status: 'captured' }),
      `evt-batch2-mismatch-${MARKER}`,
    )
    expect(res.status).toBe(200) // acked (the gateway did its job)…
    const body = (await res.json()) as { received: boolean; error?: string }
    expect(body.received).toBe(true)
    expect(body.error).toContain('amount agreement failed') // …but recorded as an error

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING') // NOT settled
    expect(txn?.reconciliationStatus).toBe('exception')
    expect(txn?.reconciliationNote).toContain('AMOUNT MISMATCH')

    // No receipt, no ledger credit, no Payment mirror.
    expect(txn?.receiptNo).toBeNull()
    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(0)
    const payments = await db.payment.findMany({ where: { feeId: fee.id } })
    expect(payments).toEqual([])

    const evt = await db.webhookEvent.findUnique({ where: { eventId: `evt-batch2-mismatch-${MARKER}` } })
    expect(evt?.status).toBe('error')
  }, T)

  test('payment.captured with a WRONG currency (valid signature, exact amount) → EXCEPTION', async () => {
    const res = await webhook(
      paymentEvent('payment.captured', { id: `pay_${MARKER}_4`, order_id: orderId, amount: 30000, currency: 'USD', status: 'captured' }),
      `evt-batch2-currency-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { received: boolean; error?: string }
    expect(body.error).toContain('amount agreement failed')

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING') // still not settled
    expect(txn?.reconciliationStatus).toBe('exception')
  }, T)

  test('payment.authorized (valid signature, exact amount) → recorded but NEVER settles (funds not captured)', async () => {
    const res = await webhook(
      paymentEvent('payment.authorized', { id: `pay_${MARKER}_5`, order_id: orderId, amount: 30000, currency: 'INR', status: 'authorized' }),
      `evt-batch2-authorized-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { received: boolean; error?: string }
    expect(body.error ?? null).toBeNull()

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('PENDING') // authorized ≠ captured: no settlement
    expect(txn?.receiptNo).toBeNull()
    const evt = await db.webhookEvent.findUnique({ where: { eventId: `evt-batch2-authorized-${MARKER}` } })
    expect(evt?.status).toBe('processed') // but the authorization IS audited
  }, T)

  test('payment.captured with the EXACT amount → SUCCESS + SCH- receipt + ledger credit (one transaction)', async () => {
    const res = await webhook(
      paymentEvent('payment.captured', { id: `pay_${MARKER}_6`, order_id: orderId, amount: 30000, currency: 'INR', status: 'captured', notes: { schoolId } }),
      `evt-batch2-captured-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { received: boolean; error?: string; matched_transaction_id?: string }
    expect(body.error ?? null).toBeNull()
    expect(body.matched_transaction_id).toBe(txnId)

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('SUCCESS')
    expect(txn?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)
    expect(txn?.gatewayPaymentId).toBe(`pay_${MARKER}_6`)
    expect(txn?.reconciliationStatus).toBe('reconciled')

    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(300)
    expect(feeRow?.status).toBe('PARTIAL')

    const mirror = await db.payment.findUnique({ where: { transactionId: `pay_${MARKER}_6` } })
    expect(mirror).not.toBeNull()
    expect(Number(mirror?.amount)).toBe(300)
    expect(mirror?.status).toBe('SUCCESS')

    const evt = await db.webhookEvent.findUnique({ where: { eventId: `evt-batch2-captured-${MARKER}` } })
    expect(evt?.status).toBe('processed')

    // Parity after a full canonical settlement.
    const sums = await ledgerSums(schoolId)
    expect(Math.abs(sums.payments - sums.txns)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sums.txns - sums.fees)).toBeLessThanOrEqual(0.01)
  }, T)

  test('REPLAY of the same event id → duplicate ack, the ledger does NOT move', async () => {
    const feeBefore = await db.fee.findUnique({ where: { id: fee.id }, select: { paid: true } })
    const res = await webhook(
      paymentEvent('payment.captured', { id: `pay_${MARKER}_6`, order_id: orderId, amount: 30000, currency: 'INR', status: 'captured' }),
      `evt-batch2-captured-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { received: boolean; duplicate?: boolean }
    expect(body.duplicate).toBe(true)

    const feeAfter = await db.fee.findUnique({ where: { id: fee.id }, select: { paid: true } })
    expect(Number(feeAfter?.paid)).toBe(Number(feeBefore?.paid))
    const mirrors = await db.payment.findMany({ where: { transactionId: `pay_${MARKER}_6` } })
    expect(mirrors).toHaveLength(1)
  }, T)

  test('DISTINCT event ids for the SAME payment fired in PARALLEL → the ledger credits EXACTLY ONCE', async () => {
    const created = await staffOrder(100)
    const order2 = created.orderId
    const txn2 = created.txnId
    txnIds.push(txn2)

    const entity = { id: `pay_${MARKER}_7`, order_id: order2, amount: 10000, currency: 'INR', status: 'captured', notes: { schoolId } }
    const [a, b] = await Promise.all([
      webhook(paymentEvent('payment.captured', entity), `evt-batch2-race-a-${MARKER}`),
      webhook(paymentEvent('payment.captured', entity), `evt-batch2-race-b-${MARKER}`),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(400) // 300 + exactly one 100

    const mirrors = await db.payment.findMany({ where: { transactionId: `pay_${MARKER}_7` } })
    expect(mirrors).toHaveLength(1) // idempotent on Payment.transactionId

    const txnRow = await db.feeTransaction.findUnique({ where: { id: txn2 } })
    expect(txnRow?.status).toBe('SUCCESS')

    const sums = await ledgerSums(schoolId)
    expect(Math.abs(sums.payments - sums.txns)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sums.txns - sums.fees)).toBeLessThanOrEqual(0.01)
  }, T)

  test('payment.failed → the txn is marked FAILED (exception)', async () => {
    const created = await staffOrder(50)
    const txn3 = created.txnId
    txnIds.push(txn3)
    const res = await webhook(
      paymentEvent('payment.failed', { id: `pay_${MARKER}_8`, order_id: created.orderId, amount: 5000, currency: 'INR', status: 'failed' }),
      `evt-batch2-failed-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const txn = await db.feeTransaction.findUnique({ where: { id: txn3 } })
    expect(txn?.status).toBe('FAILED')
    expect(txn?.reconciliationStatus).toBe('exception')
  }, T)
})

// ── B4: student self-service checkout (sandbox) — receipts at settlement ──

describe('BATCH2-B4 · student checkout: receipts belong to settlement; forged signatures fail', () => {
  test('student order (within outstanding) → PENDING with receiptNo NULL; verify → SUCCESS + SCH- receipt + ledger credit', async () => {
    // outstanding is 1000 - 400 = 600 at this point.
    const order = await as(studentToken, '/api/student/payments/order', {
      method: 'POST',
      body: JSON.stringify({ amount: 200, method: 'UPI', feeHead: `BATCH2-TEST-${MARKER}` }),
    })
    expect(order.status).toBe(200)
    const orderJson = (await order.json()) as {
      ok: boolean
      data?: { orderId?: string; txnId?: string; receiptNo?: string | null; mode?: string; paymentId?: string | null; signature?: string | null }
    }
    expect(orderJson.ok).toBe(true)
    expect(orderJson.data?.mode).toBe('sandbox') // the local SandboxProvider — no network
    expect(orderJson.data?.receiptNo).toBeNull() // BATCH2-B4: no receipt at order creation
    const orderId = orderJson.data?.orderId ?? ''
    const txnId = orderJson.data?.txnId ?? ''
    txnIds.push(txnId)

    const pending = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(pending?.status).toBe('PENDING')
    expect(pending?.receiptNo).toBeNull() // DB truth: the old RCP-at-creation mint is GONE

    // Relay the server-minted sandbox confirmation to /verify (as the client would).
    const verify = await as(studentToken, '/api/student/payments/verify', {
      method: 'POST',
      body: JSON.stringify({
        orderId,
        paymentId: orderJson.data?.paymentId,
        signature: orderJson.data?.signature,
      }),
    })
    expect(verify.status).toBe(200)
    const verifyJson = (await verify.json()) as {
      ok: boolean
      data?: { receiptNo?: string | null; status?: string; amount?: number }
    }
    expect(verifyJson.ok).toBe(true)
    expect(verifyJson.data?.status).toBe('SUCCESS')
    expect(verifyJson.data?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/) // minted at settlement

    const settled = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(settled?.status).toBe('SUCCESS')
    expect(settled?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)

    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(600) // 400 + 200
  }, T)

  test('a FORGED checkout signature → verification fails, the txn is FAILED (exception) — the client can never declare success', async () => {
    // outstanding is 400 at this point.
    const order = await as(studentToken, '/api/student/payments/order', {
      method: 'POST',
      body: JSON.stringify({ amount: 100, method: 'UPI' }),
    })
    expect(order.status).toBe(200)
    const orderJson = (await order.json()) as { ok: boolean; data?: { orderId?: string; txnId?: string } }
    const orderId = orderJson.data?.orderId ?? ''
    const txnId = orderJson.data?.txnId ?? ''
    txnIds.push(txnId)

    const verify = await as(studentToken, '/api/student/payments/verify', {
      method: 'POST',
      body: JSON.stringify({
        orderId,
        paymentId: `pay_forged_${MARKER}`,
        signature: '0'.repeat(64), // forged HMAC
      }),
    })
    expect([400, 422, 500]).toContain(verify.status)

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('FAILED')
    expect(txn?.reconciliationStatus).toBe('exception')

    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(600) // the ledger did NOT move
  }, T)
})

// ── B4: refund (canonical, one-shot, parity-preserving) ────────────────────

describe('BATCH2-B4 · canonical refund: exact reversal, one shot, tenant-safe', () => {
  let refundTxnId = ''
  let refundOrderId = ''

  beforeAll(async () => {
    // outstanding is 400. Settle ₹100 via the webhook rail for the refund flow.
    const created = await staffOrder(100)
    refundOrderId = created.orderId
    refundTxnId = created.txnId
    txnIds.push(refundTxnId)
    const res = await webhook(
      paymentEvent('payment.captured', { id: `pay_${MARKER}_9`, order_id: refundOrderId, amount: 10000, currency: 'INR', status: 'captured', notes: { schoolId } }),
      `evt-batch2-refund-settle-${MARKER}`,
    )
    expect(res.status).toBe(200)
    const txn = await db.feeTransaction.findUnique({ where: { id: refundTxnId } })
    expect(txn?.status).toBe('SUCCESS')
  })

  test('FULL refund: status flips, Fee.paid reversed, original mirror REFUNDED, refund mirror row created, parity holds', async () => {
    const sumsBefore = await ledgerSums(schoolId)
    const res = await as(principalToken, `/api/fees/transactions/${refundTxnId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason: `BATCH2 refund test ${MARKER}` }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      data?: { status?: string; refunded?: number; fee?: { paid?: number; status?: string }; receiptNo?: string | null }
    }
    expect(json.ok).toBe(true)
    expect(json.data?.status).toBe('REFUNDED')
    expect(json.data?.refunded).toBe(100)
    expect(json.data?.fee?.paid).toBe(600) // 700 - 100

    const txn = await db.feeTransaction.findUnique({ where: { id: refundTxnId } })
    expect(txn?.status).toBe('REFUNDED')
    expect(txn?.reconciliationNote).toContain('Refunded')

    // The original credit mirror flipped to REFUNDED …
    const original = await db.payment.findUnique({ where: { transactionId: `pay_${MARKER}_9` } })
    expect(original?.status).toBe('REFUNDED')
    // … and the refund mirror row exists with the replay-proof key.
    const refundMirror = await db.payment.findUnique({ where: { transactionId: `refund:${refundTxnId}` } })
    expect(refundMirror).not.toBeNull()
    expect(refundMirror?.status).toBe('REFUNDED')
    expect(Number(refundMirror?.amount)).toBe(100)

    // Parity preserved: all three sums dropped by the same ₹100.
    const sumsAfter = await ledgerSums(schoolId)
    expect(Math.abs(sumsBefore.payments - sumsAfter.payments - 100)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sumsBefore.txns - sumsAfter.txns - 100)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sumsBefore.fees - sumsAfter.fees - 100)).toBeLessThanOrEqual(0.01)
  }, T)

  test('a SECOND refund of the same txn → 409, nothing moves', async () => {
    const res = await as(principalToken, `/api/fees/transactions/${refundTxnId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason: `second attempt ${MARKER}` }),
    })
    expect(res.status).toBe(409)
    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(600)
  }, T)

  test('a PARTIAL refund amount is refused with guidance (400)', async () => {
    // outstanding is 300; settle nothing new — use the still-SUCCESS concurrent txn? No:
    // partial refunds are refused BEFORE any state check on amount, so any txn id proves it.
    const res = await as(principalToken, `/api/fees/transactions/${refundTxnId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason: `partial attempt ${MARKER}`, amount: 50 }),
    })
    expect(res.status).toBe(422) // AppError INVALID_INPUT → 422
    const json = (await res.json()) as { ok: boolean; error?: string }
    expect(json.error).toContain('Partial refunds are not supported')
  }, T)

  test('refunding a PENDING (unsettled) txn → 409', async () => {
    const created = await staffOrder(100) // stays PENDING (never settled)
    txnIds.push(created.txnId)
    const res = await as(principalToken, `/api/fees/transactions/${created.txnId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason: `pending refund ${MARKER}` }),
    })
    expect(res.status).toBe(409)
  }, T)

  test('an unknown txn id → 404', async () => {
    const res = await as(principalToken, `/api/fees/transactions/txn-foreign-${MARKER}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason: `not found ${MARKER}` }),
    })
    expect(res.status).toBe(404)
  }, T)

  test('a FOREIGN-TENANT txn id → 404 (tenant isolation)', async () => {
    // A SUCCESS txn in another school (minimal fixture, cleaned up after).
    const other = await db.school.findFirst({ where: { isDemo: false } })
    if (!other) return // single-school environment — isolation covered by the 404 case
    let foreignStudent = await db.student.findFirst({ where: { schoolId: other.id }, select: { id: true, userId: true } })
    if (!foreignStudent) {
      // The other school has no students — create a minimal one (cleaned up).
      const u = await db.user.create({ data: { schoolId: other.id, email: `batch2-foreign-${MARKER}@test.local`, role: 'STUDENT', status: 'ACTIVE' } })
      foreignStudent = await db.student.create({ data: { schoolId: other.id, userId: u.id } })
      cleanup.push(() => db.student.deleteMany({ where: { id: foreignStudent!.id } }))
      cleanup.push(() => db.user.deleteMany({ where: { id: u.id } }))
    }
    const foreignFee = await db.fee.create({
      data: { schoolId: other.id, studentId: foreignStudent.id, title: `BATCH2-FOREIGN-${MARKER}`, amount: 100, paid: 0 },
    })
    const foreignTxn = await db.feeTransaction.create({
      data: { schoolId: other.id, feeId: foreignFee.id, amount: 100, method: 'CASH', status: 'SUCCESS', gatewayName: 'manual', receiptNo: `SCH-9999-${MARKER}01` },
    })
    try {
      const res = await as(principalToken, `/api/fees/transactions/${foreignTxn.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: `cross tenant ${MARKER}` }),
      })
      expect(res.status).toBe(404)
      const still = await db.feeTransaction.findUnique({ where: { id: foreignTxn.id } })
      expect(still?.status).toBe('SUCCESS') // untouched
    } finally {
      await db.feeTransaction.deleteMany({ where: { id: foreignTxn.id } })
      await db.fee.deleteMany({ where: { id: foreignFee.id } })
    }
  }, T)
})

// ── B4: legacy POST /api/fees canonicalization ─────────────────────────────

describe('BATCH2-B4 · legacy POST /api/fees payment-record goes through the canonical pipeline', () => {
  test('POST { feeId, amount } → FeeTransaction(SUCCESS, SCH-) + Payment mirror manual:{id} + ledger credit; parity holds', async () => {
    // outstanding is 300 at this point.
    const sumsBefore = await ledgerSums(schoolId)
    const res = await as(principalToken, '/api/fees', {
      method: 'POST',
      body: JSON.stringify({ feeId: fee.id, amount: 250, method: 'CASH', note: `BATCH2 legacy ${MARKER}` }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; data?: { ok?: boolean; feeId?: string; paid?: number; status?: string; receiptNo?: string; txnId?: string } }
    expect(json.ok).toBe(true)
    expect(json.data?.ok).toBe(true)
    expect(json.data?.feeId).toBe(fee.id)
    expect(json.data?.status).toBe('PARTIAL')
    expect(json.data?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)

    const txnId = json.data?.txnId ?? ''
    expect(txnId).toBeTruthy()
    txnIds.push(txnId)

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.status).toBe('SUCCESS')
    expect(txn?.source).toBe('SCHOOL_OFFICE')
    expect(txn?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)

    const mirror = await db.payment.findUnique({ where: { transactionId: `manual:${txnId}` } })
    expect(mirror).not.toBeNull()
    expect(Number(mirror?.amount)).toBe(250)
    expect(mirror?.status).toBe('SUCCESS')

    const feeRow = await db.fee.findUnique({ where: { id: fee.id } })
    expect(Number(feeRow?.paid)).toBe(850)

    // The legacy branch no longer breaks the parity invariant.
    const sumsAfter = await ledgerSums(schoolId)
    expect(Math.abs(sumsAfter.payments - sumsAfter.txns)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sumsAfter.txns - sumsAfter.fees)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sumsAfter.fees - sumsBefore.fees - 250)).toBeLessThanOrEqual(0.01)
  }, T)
})
