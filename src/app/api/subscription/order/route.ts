import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { createSubscriptionOrder } from '@/lib/subscription/orders'
import { resolvePlanForPurchase, planPrice } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'

export const runtime = 'nodejs'

const orderSchema = strictBody({
  planCode: z.string().min(3).max(40),
})

/**
 * POST /api/subscription/order — the principal initiates an ONLINE school
 * renewal (Model A online lane). Server-side order creation ONLY:
 *   · plan resolved + availability + online policy verified server-side;
 *   · the amount comes from the plan registry — NEVER client input;
 *   · provider strategy: sandbox (dev/test) | Razorpay (platform keys) |
 *     fail-closed BLOCKED_INTEGRATION when unconfigured (honest message).
 *
 * Settlement happens ONLY through /api/subscription/verify (provider
 * signature verification) or the signed webhook — a browser redirect
 * never activates anything. Exempt-route reachable (renewal surface).
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:subord:${user.id}`, RATE_LIMITS.subscriptionOrder)

      const body = await parseJsonBody(req, orderSchema)
      const config = await loadSubscriptionConfig()
      if (!config.models.school.enabled) {
        return {
          ok: false as const,
          error: 'School subscriptions are currently not offered online. Please contact SCHOLARIO support.',
        }
      }

      // Renewal or first purchase — either way the plan must allow it.
      const current = await db.schoolSubscription.findUnique({ where: { schoolId } })
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: 'SCHOOL',
        kind: current?.periodEnd && current.periodEnd.getTime() > Date.now() ? 'renewal' : 'new',
        requireOnline: true,
      })
      const price = planPrice(plan)

      const order = await createSubscriptionOrder({
        scope: 'SCHOOL_PLAN',
        schoolId,
        initiatedByUserId: user.id,
        planId: plan.id,
        planCode: plan.code,
        interval: price.interval,
        amount: price.amount,
        currency: plan.currency,
        validityMonths: price.interval === 'MONTHLY' ? 1 : 12,
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SUBSCRIPTION_ORDER_CREATED',
        detail: `Online renewal order ${order.orderNo} for plan ${plan.code} (${price.amount} ${plan.currency})`,
      }).catch(() => {})

      return {
        ok: true as const,
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
        message:
          order.provider === 'SANDBOX'
            ? 'Order created on the sandbox gateway (test mode). Complete the payment to verify the flow.'
            : 'Order created. Complete the payment; the subscription activates after server-side verification.',
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'], allowLockedSubscription: true },
  )
}
