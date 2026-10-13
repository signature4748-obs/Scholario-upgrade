/**
 * subscription/orders — the ONLINE-order lane (provider-agnostic).
 *
 * Order lifecycle: PENDING → (verified settle) PAID exactly-once, or
 * EXPIRED (TTL 30 min) / CANCELLED / FAILED. REFUNDED is an operator
 * action that revokes the produced entitlement and NEVER erases the
 * financial rows.
 *
 * Settlement has EXACTLY two legitimate causes — both idempotent:
 *   1. the signature-verified webhook (/api/webhooks/platform-subscription,
 *      extended with order linkage), and
 *   2. the server-side verify route (provider checkout-confirmation
 *      signature check — Razorpay HMAC or the sandbox provider's
 *      server-minted confirmation).
 * A browser redirect to a success page NEVER settles anything.
 *
 * Provider strategy: the platform reuses the shared payment provider
 * (src/lib/payments/provider.ts — Razorpay over plain fetch when
 * RAZORPAY_KEY_ID/SECRET are configured platform-level, Sandbox when
 * PAYMENTS_SANDBOX=1). When neither is configured the LIVE lane is
 * fail-closed BLOCKED_INTEGRATION (honest, labeled in the UI — never a
 * fake success).
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient
import { AppError } from '@/lib/security/errors'
import { getPaymentProvider, type CheckoutConfirmation } from '@/lib/payments/provider'
import { activateEntitlementInTx } from './student'
import { addMonths } from './codes'

export const ORDER_SCOPES = ['SCHOOL_PLAN', 'STUDENT_PLAN'] as const
export type OrderScope = (typeof ORDER_SCOPES)[number]
export const ORDER_TTL_MINUTES = 30

function orderNumber(seq: number): string {
  return `SCH-ORD-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
}

async function nextOrderSeq(): Promise<number> {
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const count = await db.subscriptionOrder.count({ where: { createdAt: { gte: yearStart } } })
  return count + 1
}

// ── Order creation (server-side only) ───────────────────────────────────────

export interface CreateOrderInput {
  scope: OrderScope
  schoolId: string
  studentId?: string | null
  initiatedByUserId: string
  planId: string
  planCode: string
  interval: string
  amount: number
  currency: string
  validityMonths: number
}

export interface CreateOrderResult {
  orderId: string
  orderNo: string
  amount: number
  currency: string
  expiresAt: Date
  provider: 'SANDBOX' | 'RAZORPAY'
  providerOrderId: string
  /** Razorpay only — the PUBLIC checkout key (safe for the client). */
  keyId?: string
  mode: 'live' | 'test' | 'sandbox'
}

export async function createSubscriptionOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!(input.amount > 0)) {
    throw new AppError('VALIDATION_FAILED', { publicMessage: 'Order amount must be greater than zero.' })
  }
  const provider = getPaymentProvider()
  if (!provider) {
    // Fail-closed: no fake success, honest block until owner configures.
    throw new AppError('INVALID_INPUT', {
      publicMessage:
        'Online payment is not available on this deployment yet (payment gateway not configured). ' +
        'Please pay offline through your school office / SCHOLARIO support.',
      internalDetail: 'createSubscriptionOrder: no payment provider configured',
    })
  }

  let seq = await nextOrderSeq()
  for (let attempt = 0; attempt < 10; attempt++) {
    const orderNo = orderNumber(seq + attempt)
    try {
      // Provider order FIRST (outside the local transaction — the gateway
      // order is the join key; a local-row failure simply orphans a
      // provider order harmlessly).
      const providerOrder = await provider.createOrder({
        amountPaise: Math.round(input.amount * 100),
        receipt: orderNo,
        notes: {
          scope: input.scope,
          schoolId: input.schoolId,
          studentId: input.studentId ?? '',
          planCode: input.planCode,
        },
      })
      const row = await db.subscriptionOrder.create({
        data: {
          orderNo,
          scope: input.scope,
          schoolId: input.schoolId,
          studentId: input.studentId ?? null,
          initiatedByUserId: input.initiatedByUserId,
          planId: input.planId,
          planCode: input.planCode,
          interval: input.interval,
          amount: input.amount,
          currency: input.currency,
          validityMonths: input.validityMonths,
          status: 'PENDING',
          provider: provider.name === 'razorpay' ? 'RAZORPAY' : 'SANDBOX',
          providerOrderId: providerOrder.orderId,
          expiresAt: new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000),
        },
      })
      return {
        orderId: row.id,
        orderNo,
        amount: input.amount,
        currency: input.currency,
        expiresAt: row.expiresAt,
        provider: row.provider as 'SANDBOX' | 'RAZORPAY',
        providerOrderId: providerOrder.orderId,
        keyId: provider.keyId,
        mode: provider.mode,
      }
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2002') continue // orderNo collision
      throw e
    }
  }
  throw new AppError('CONFLICT', {
    publicMessage: 'Could not assign a unique order number — please retry.',
    internalDetail: 'createSubscriptionOrder: sequence exhausted',
  })
}

// ── Settlement (verify route + webhook — the ONLY activation causes) ───────

export interface SettleOrderResult {
  orderId: string
  orderNo: string
  alreadyPaid: boolean
  receiptNo: string | null
  entitlementId: string | null
  statusAfter: string | null
  validityEndAfter: Date | null
  periodEndAfter: Date | null
}

export class OrderSettlementError extends AppError {
  constructor(code: 'INVALID_INPUT' | 'CONFLICT' | 'FORBIDDEN', publicMessage: string, internalDetail: string) {
    super(code, { publicMessage, internalDetail })
  }
}

/**
 * Settle a PENDING order — exactly-once:
 *   conditional UPDATE (PENDING→PAID) + unique providerPaymentId + unique
 *   payment-orderId backstops. A second settle (retry, replayed webhook)
 *   returns the ORIGINAL result with alreadyPaid=true (idempotent), or
 *   CONFLICT when the provider payment id differs (double-payment probe).
 *
 * The same transaction records the VERIFIED payment and activates the
 * entitlement (student scope) or the school subscription (school scope —
 * via the applySchool callback, mirroring recordPlatformPayment's upsert).
 */
export async function settleSubscriptionOrder(opts: {
  orderNo: string
  providerPaymentId: string
  /** Who/what settled (audit context) — 'verify' | 'webhook'. */
  settledVia: 'verify' | 'webhook'
  applySchool?: (
    tx: Tx,
    o: { schoolId: string; orderId: string; order: { planId: string | null; planCode: string | null; interval: string | null; amount: number; currency: string; validityMonths: number } },
  ) => Promise<{ subscriptionId: string; statusAfter: string; periodEndAfter: Date }>
}): Promise<SettleOrderResult> {
  const order = await db.subscriptionOrder.findUnique({ where: { orderNo: opts.orderNo } })
  if (!order) {
    throw new OrderSettlementError('INVALID_INPUT', 'Order not found.', `settleSubscriptionOrder: unknown order ${opts.orderNo}`)
  }

  // Idempotent re-settle of an already-PAID order: same provider payment →
  // replay the stored result; different id → honest conflict.
  if (order.status === 'PAID') {
    if (order.providerPaymentId === opts.providerPaymentId) {
      const payment = order.scope === 'STUDENT_PLAN'
        ? await db.studentSubscriptionPayment.findUnique({ where: { orderId: order.id } })
        : null
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        alreadyPaid: true,
        receiptNo: payment?.receiptNo ?? null,
        entitlementId: order.scope === 'STUDENT_PLAN' ? payment?.entitlementId ?? null : null,
        statusAfter: order.statusAfter,
        validityEndAfter: order.validityEndAfter,
        periodEndAfter: order.periodEndAfter,
      }
    }
    throw new OrderSettlementError('CONFLICT', 'This order was already settled with a different payment.', `settleSubscriptionOrder: provider payment mismatch on ${order.orderNo}`)
  }
  if (order.status !== 'PENDING') {
    throw new OrderSettlementError('CONFLICT', `This order is ${order.status.toLowerCase()} and can no longer be paid.`, `settleSubscriptionOrder: status ${order.status}`)
  }
  if (order.expiresAt.getTime() <= Date.now()) {
    // Lazily expire (TTL) — honest, computed live.
    await db.subscriptionOrder.update({ where: { id: order.id }, data: { status: 'EXPIRED' } }).catch(() => {})
    throw new OrderSettlementError('CONFLICT', 'This payment order has expired — please start a new one.', `settleSubscriptionOrder: TTL expired ${order.orderNo}`)
  }

  return db.$transaction(async (tx) => {
    // Exactly-once guard: conditional status flip inside the transaction.
    const flipped = await tx.subscriptionOrder.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), providerPaymentId: opts.providerPaymentId },
    })
    if (flipped.count !== 1) {
      throw new OrderSettlementError('CONFLICT', 'This order was just settled by another request.', `settleSubscriptionOrder: conditional flip lost on ${order.orderNo}`)
    }

    if (order.scope === 'STUDENT_PLAN' && order.studentId) {
      // Student payment receipt (SCH-SSR sequence inside the tx).
      const yearStart = new Date(new Date().getFullYear(), 0, 1)
      const count = await tx.studentSubscriptionPayment.count({ where: { createdAt: { gte: yearStart } } })
      const receiptNo = `SCH-SSR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const payment = await tx.studentSubscriptionPayment.create({
        data: {
          schoolId: order.schoolId,
          studentId: order.studentId,
          planId: order.planId,
          planCode: order.planCode,
          interval: order.interval,
          amount: order.amount,
          currency: order.currency,
          mode: 'ONLINE_PAYMENT',
          paymentDate: new Date(),
          validityMonths: order.validityMonths,
          reference: opts.providerPaymentId,
          notes: `Online payment — settled via ${opts.settledVia}`,
          verification: 'VERIFIED',
          verifiedAt: new Date(),
          orderId: order.id,
          receiptNo,
        },
      })
      const activated = await activateEntitlementInTx(tx, {
        schoolId: order.schoolId,
        studentId: order.studentId,
        planId: order.planId,
        planCode: order.planCode,
        source: 'ONLINE',
        paymentId: payment.id,
        validityMonths: order.validityMonths,
      })
      await tx.studentSubscriptionPayment.update({
        where: { id: payment.id },
        data: { entitlementId: activated.entitlementId, statusAfter: activated.statusAfter, validityEndAfter: activated.validityEnd },
      })
      await tx.subscriptionOrder.update({
        where: { id: order.id },
        data: { statusAfter: activated.statusAfter, validityEndAfter: activated.validityEnd },
      })
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        alreadyPaid: false,
        receiptNo,
        entitlementId: activated.entitlementId,
        statusAfter: activated.statusAfter,
        validityEndAfter: activated.validityEnd,
        periodEndAfter: null,
      }
    }

    // School-scope: caller applies the tenant subscription extension
    // (shared upsert semantics with recordPlatformPayment).
    if (!opts.applySchool) {
      throw new OrderSettlementError('INVALID_INPUT', 'Order settlement misconfigured.', 'settleSubscriptionOrder: school scope without applySchool')
    }
    const applied = await opts.applySchool(tx, {
      schoolId: order.schoolId,
      orderId: order.id,
      order: {
        planId: order.planId,
        planCode: order.planCode,
        interval: order.interval,
        amount: Number(order.amount),
        currency: order.currency,
        validityMonths: order.validityMonths,
      },
    })
    await tx.subscriptionOrder.update({
      where: { id: order.id },
      data: { statusAfter: applied.statusAfter, periodEndAfter: applied.periodEndAfter },
    })
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      alreadyPaid: false,
      receiptNo: null,
      entitlementId: null,
      statusAfter: applied.statusAfter,
      validityEndAfter: null,
      periodEndAfter: applied.periodEndAfter,
    }
  }, { timeout: 20_000 })
}

/** Server-side verification of a checkout confirmation for an order —
 *  provider signature check (Razorpay HMAC / sandbox HMAC), then settle. */
export async function verifyAndSettleOrder(opts: {
  orderNo: string
  confirmation: CheckoutConfirmation
  initiatedByUserId?: string
}): Promise<SettleOrderResult> {
  const order = await db.subscriptionOrder.findUnique({ where: { orderNo: opts.orderNo } })
  if (!order) {
    throw new OrderSettlementError('INVALID_INPUT', 'Order not found.', `verifyAndSettleOrder: unknown order ${opts.orderNo}`)
  }
  // The confirmation must reference THIS order's provider id (a mismatched
  // confirmation is rejected — prevents cross-order replay).
  if (order.providerOrderId && opts.confirmation.orderId !== order.providerOrderId) {
    throw new OrderSettlementError('INVALID_INPUT', 'Payment confirmation does not match this order.', `verifyAndSettleOrder: provider order mismatch on ${opts.orderNo}`)
  }
  if (order.initiatedByUserId && opts.initiatedByUserId && order.initiatedByUserId !== opts.initiatedByUserId) {
    throw new OrderSettlementError('FORBIDDEN', 'This order belongs to another account.', `verifyAndSettleOrder: initiator mismatch on ${opts.orderNo}`)
  }
  const provider = getPaymentProvider()
  if (!provider) {
    throw new OrderSettlementError('INVALID_INPUT', 'Payment verification is unavailable on this deployment.', 'verifyAndSettleOrder: no provider')
  }
  const verdict = provider.verifyCheckoutConfirmation(opts.confirmation)
  if (!verdict.ok) {
    throw new OrderSettlementError('INVALID_INPUT', 'Payment verification failed — the subscription was NOT activated.', `verifyAndSettleOrder: ${verdict.reason}`)
  }
  return settleSubscriptionOrder({
    orderNo: opts.orderNo,
    providerPaymentId: opts.confirmation.paymentId,
    settledVia: 'verify',
    applySchool: undefined,
  })
}

/** Sandbox checkout helper — the dev/test contract: the SERVER "runs" the
 *  payment and mints the signed confirmation the client relays back. Only
 *  available when PAYMENTS_SANDBOX=1 (the SandboxProvider itself enforces
 *  this — never a production success path). */
export async function sandboxConfirmOrder(orderNo: string): Promise<CheckoutConfirmation> {
  const provider = getPaymentProvider()
  if (!provider || !provider.confirmSandboxPayment) {
    throw new OrderSettlementError('INVALID_INPUT', 'The sandbox gateway is not enabled on this deployment.', 'sandboxConfirmOrder: no sandbox provider')
  }
  const order = await db.subscriptionOrder.findUnique({ where: { orderNo } })
  if (!order || !order.providerOrderId) {
    throw new OrderSettlementError('INVALID_INPUT', 'Order not found.', `sandboxConfirmOrder: unknown order ${orderNo}`)
  }
  return provider.confirmSandboxPayment({ orderId: order.providerOrderId, amountPaise: Math.round(Number(order.amount) * 100) })
}

/** Calendar months helper re-export for school-period math. */
export { addMonths }
