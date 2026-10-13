import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { verifyAndSettleOrder, sandboxConfirmOrder } from '@/lib/subscription/orders'

export const runtime = 'nodejs'

const verifySchema = strictBody({
  orderNo: z.string().min(6).max(40),
  paymentId: z.string().min(4).max(80).optional(),
  signature: z.string().min(16).max(256).optional(),
  /** Sandbox lane only: the server runs the sandbox payment and returns
   *  the signed confirmation for relay (dev/test contract). */
  sandbox: z.boolean().default(false),
})

/**
 * POST /api/subscription/student/verify — server-side verification +
 * settlement of a student online order (THE activation cause, with the
 * signed webhook). Exactly-once: the conditional order flip + unique
 * provider payment id + the one-live-per-student partial unique index
 * make double activation impossible; replaying a settled verification
 * returns the original result (alreadyPaid) without re-activating.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'STUDENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only student accounts can verify student subscription payments.',
          internalDetail: `student verify by role ${user.role}`,
        })
      }
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:subverify:${user.id}`, RATE_LIMITS.subscriptionOrder)

      const body = await parseJsonBody(req, verifySchema)

      // The order must belong to THIS student (server-side scope check —
      // another student's order number is refused without leaking it).
      const order = await db.subscriptionOrder.findUnique({ where: { orderNo: body.orderNo } })
      if (!order || order.scope !== 'STUDENT_PLAN' || !order.studentId) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Order not found.' })
      }
      // Idempotent re-check: an order that is already PAID (the payment
      // page verifying again after settlement) returns the original
      // result WITHOUT minting a new sandbox payment or touching the
      // settled state — "already processed, no double activation".
      if (order.status === 'PAID') {
        const payment = await db.studentSubscriptionPayment.findUnique({ where: { orderId: order.id } })
        return {
          ok: true,
          alreadyPaid: true,
          orderNo: order.orderNo,
          entitlement: payment?.entitlementId ? { id: payment.entitlementId } : null,
          statusAfter: order.statusAfter,
          validityEndAfter: order.validityEndAfter?.toISOString() ?? null,
          message: 'This payment was already processed — no second entitlement was created.',
        }
      }
      const student = await db.student.findUnique({ where: { userId: user.id }, select: { id: true, schoolId: true } })
      if (!student || order.studentId !== student.id || order.schoolId !== schoolId) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'This order belongs to another account.',
          internalDetail: 'student verify: order scope mismatch',
        })
      }

      const confirmation = body.sandbox
        ? await sandboxConfirmOrder(body.orderNo)
        : { orderId: '', paymentId: body.paymentId ?? '', signature: body.signature ?? '' }

      const result = await verifyAndSettleOrder({
        orderNo: body.orderNo,
        confirmation,
        initiatedByUserId: user.id,
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'STUDENT_SUBSCRIPTION_ORDER_SETTLED',
        detail: `Order ${result.orderNo} settled (${result.alreadyPaid ? 'idempotent replay' : 'activated'})${result.validityEndAfter ? ` — until ${result.validityEndAfter.toISOString().slice(0, 10)}` : ''}`,
      }).catch(() => {})

      return {
        ok: true,
        alreadyPaid: result.alreadyPaid,
        orderNo: result.orderNo,
        entitlement: result.entitlementId ? { id: result.entitlementId } : null,
        statusAfter: result.statusAfter,
        validityEndAfter: result.validityEndAfter?.toISOString() ?? null,
        message: result.alreadyPaid
          ? 'This payment was already processed — no second entitlement was created.'
          : 'Payment verified and your subscription is active.',
      }
    },
    { allowLockedSubscription: true },
  )
}
