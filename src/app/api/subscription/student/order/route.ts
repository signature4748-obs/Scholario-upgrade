import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { createSubscriptionOrder, sandboxConfirmOrder } from '@/lib/subscription/orders'
import { resolvePlanForPurchase, planPrice } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'

export const runtime = 'nodejs'

const orderSchema = strictBody({
  planCode: z.string().min(3).max(40),
  /** Sandbox lane only: also run the sandbox payment now and return the
   *  signed confirmation (the client relays it to /verify; the server
   *  re-verifies the HMAC — forged payloads cannot pass). */
  sandbox: z.boolean().default(false),
})

/**
 * POST /api/subscription/student/order — a STUDENT initiates their own
 * online per-student subscription payment (Model B online lane).
 *
 * Server-side order creation ONLY:
 *   · plan resolved server-side (scope STUDENT, online allowed, model
 *     enabled); amount = the plan registry price — never client input;
 *   · the student scope is resolved from the session identity;
 *   · provider strategy: sandbox | Razorpay | fail-closed honest block.
 *
 * Settlement happens ONLY at /api/subscription/student/verify (provider
 * signature verification) or the signed webhook. Exempt-route reachable.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'STUDENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only student accounts can purchase student subscriptions.',
          internalDetail: `student order by role ${user.role}`,
        })
      }
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:subord:${user.id}`, RATE_LIMITS.subscriptionOrder)

      const body = await parseJsonBody(req, orderSchema)
      const config = await loadSubscriptionConfig()
      if (!config.models.student.enabled) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'Student subscriptions are currently not offered online. Please use the activation code from your school office.',
        })
      }

      const student = await db.student.findUnique({
        where: { userId: user.id },
        select: { id: true, schoolId: true },
      })
      if (!student || student.schoolId !== schoolId) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'No student record is linked to this account.',
          internalDetail: 'student order: no student row for session user',
        })
      }

      // Renewal vs first purchase (both allowed; settlement anchors at the
      // current validityEnd for renewals — see activateEntitlementInTx).
      const live = await db.studentEntitlement.findFirst({
        where: { studentId: student.id, status: { in: ['PENDING', 'ACTIVE'] } },
        select: { validityEnd: true },
      })
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: 'STUDENT',
        kind: live ? 'renewal' : 'new',
        requireOnline: true,
      })
      const price = planPrice(plan)

      const order = await createSubscriptionOrder({
        scope: 'STUDENT_PLAN',
        schoolId,
        studentId: student.id,
        initiatedByUserId: user.id,
        planId: plan.id,
        planCode: plan.code,
        interval: 'ANNUAL',
        amount: price.amount,
        currency: plan.currency,
        validityMonths: config.student.defaultValidityMonths,
      })

      const sandboxConfirmation = body.sandbox && order.provider === 'SANDBOX'
        ? await sandboxConfirmOrder(order.orderNo)
        : null

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'STUDENT_SUBSCRIPTION_ORDER_CREATED',
        detail: `Online order ${order.orderNo} for plan ${plan.code} (${price.amount} ${plan.currency})`,
      }).catch(() => {})

      return {
        ok: true,
        order: {
          orderNo: order.orderNo,
          amount: order.amount,
          currency: order.currency,
          expiresAt: order.expiresAt.toISOString(),
          provider: order.provider,
          providerOrderId: order.providerOrderId,
          keyId: order.keyId ?? null,
          mode: order.mode,
        },
        sandboxConfirmation,
        message:
          order.provider === 'SANDBOX'
            ? 'Order created on the sandbox gateway (test mode). Complete the payment to verify the flow.'
            : 'Order created. Complete the payment; your subscription activates after server-side verification.',
      }
    },
    { allowLockedSubscription: true },
  )
}
