import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withUser, schoolScoped } from '@/lib/api'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { verifyAndSettleOrder, sandboxConfirmOrder } from '@/lib/subscription/orders'
import { applySchoolSubscriptionPeriodInTx } from '@/lib/platform/billing'

export const runtime = 'nodejs'

const verifySchema = strictBody({
  orderNo: z.string().min(6).max(40),
  /** LIVE lane: the gateway order id (razorpay_order_id) from the checkout
   *  handler — required for the server to bind the confirmation to this
   *  order's providerOrderId before verifying the HMAC. */
  orderId: z.string().min(4).max(80).optional(),
  paymentId: z.string().min(4).max(80).optional(),
  signature: z.string().min(16).max(256).optional(),
  /** Sandbox lane only: the server runs the sandbox payment and returns
   *  the signed confirmation for relay (the documented dev/test contract —
   *  the server mints and re-verifies the HMAC; forged client payloads
   *  cannot pass verification). */
  sandbox: z.boolean().default(false),
})

/**
 * POST /api/subscription/verify — server-side verification + settlement of
 * a school online order. THE activation cause (with the signed webhook):
 * the provider checkout-confirmation signature is verified server-side,
 * then the exactly-once settlement transaction runs (order PAID + VERIFIED
 * payment row + tenant subscription extension atomically, through the same
 * applySchoolSubscriptionPeriodInTx the webhook uses). Idempotent:
 * re-verifying a settled order returns the original result (alreadyPaid).
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:subverify:${user.id}`, RATE_LIMITS.subscriptionOrder)

      const body = await parseJsonBody(req, verifySchema)

      const confirmation = body.sandbox
        ? await sandboxConfirmOrder(body.orderNo)
        : {
            // LIVE lane: the relayed checkout triple (razorpay_order_id |
            // razorpay_payment_id | razorpay_signature) — the server binds
            // it to the order's providerOrderId and verifies the HMAC.
            orderId: body.orderId ?? '',
            paymentId: body.paymentId ?? '',
            signature: body.signature ?? '',
          }

      const result = await verifyAndSettleOrder({
        orderNo: body.orderNo,
        confirmation,
        initiatedByUserId: user.id,
        applySchool: (tx, o) =>
          applySchoolSubscriptionPeriodInTx(tx, {
            schoolId: o.schoolId,
            planId: o.order.planId,
            planCode: o.order.planCode,
            interval: o.order.interval,
            priceSnapshot: o.order.amount,
            currency: o.order.currency,
            amount: o.order.amount,
            mode: 'ONLINE_PAYMENT',
            paymentDate: new Date(),
            validityMonths: o.order.validityMonths,
            reference: o.order.planCode,
            notes: 'Online payment — server-verified checkout confirmation',
            orderId: o.orderId,
          }),
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SUBSCRIPTION_ORDER_SETTLED',
        detail: `Order ${result.orderNo} settled (${result.alreadyPaid ? 'idempotent replay' : 'activated'})${result.periodEndAfter ? ` — ACTIVE until ${result.periodEndAfter.toISOString().slice(0, 10)}` : ''}`,
      }).catch(() => {})

      return {
        ok: true,
        alreadyPaid: result.alreadyPaid,
        orderNo: result.orderNo,
        statusAfter: result.statusAfter,
        periodEndAfter: result.periodEndAfter?.toISOString() ?? null,
        message: result.alreadyPaid
          ? 'This payment was already processed — the subscription state is unchanged (no double activation).'
          : 'Payment verified and subscription activated.',
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'], allowLockedSubscription: true },
  )
}
