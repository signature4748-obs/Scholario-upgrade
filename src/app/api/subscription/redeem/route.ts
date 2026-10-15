import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withUser, schoolScoped } from '@/lib/api'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS, clientIpFromHeaders } from '@/lib/security/rate-limit'
import { redeemSchoolActivationCode } from '@/lib/subscription/codes'
import { applySchoolSubscriptionPeriodInTx } from '@/lib/platform/billing'

export const runtime = 'nodejs'

const redeemSchema = strictBody({
  code: z.string().min(10).max(60),
})

/**
 * POST /api/subscription/redeem — the principal redeems a school-wide
 * activation code (Model A offline delivery).
 *
 * ONE transaction: conditional code claim (ISSUED→CLAIMED, race-safe) +
 * tenant subscription activation via the VERIFIED payment linked at
 * issuance (applySchoolSubscriptionPeriodInTx with existingPaymentId —
 * the immutable financial row is snapshotted, never duplicated).
 * Tenant scope is enforced server-side from the session: a code issued
 * for another school is rejected with a generic message (no oracle).
 *
 * Exempt-route reachable (the redemption surface works even while the
 * tenant is RESTRICTED — that is the point of the offline handshake).
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const ip = clientIpFromHeaders(req.headers)
      // Per-user + per-IP anti-guessing budget on the redemption surface.
      enforceRateLimit(`rl:subcode:${user.id}`, RATE_LIMITS.subscriptionCodeClaim)
      enforceRateLimit(`rl:subcode-ip:${ip}`, RATE_LIMITS.subscriptionCodeClaim)

      const body = await parseJsonBody(req, redeemSchema)

      const result = await redeemSchoolActivationCode(
        body.code,
        { userId: user.id, schoolId, ip },
        async (tx, opts) => {
          const paymentId = opts.paymentRef?.startsWith('platformPayment:')
            ? opts.paymentRef.slice('platformPayment:'.length)
            : null
          const payment = paymentId ? await tx.platformPayment.findUnique({ where: { id: paymentId } }) : null
          return applySchoolSubscriptionPeriodInTx(tx, {
            schoolId: opts.schoolId,
            planId: opts.planId,
            planCode: opts.planCode,
            interval: opts.interval,
            amount: payment ? Number(payment.amount) : 0,
            // The deferred payment was validated against the plan price at
            // issuance (amount === plan price) — restoring the snapshot here
            // keeps the registry's price column honest after redemption.
            priceSnapshot: payment ? Number(payment.amount) : null,
            currency: payment?.currency ?? 'INR',
            mode: (payment?.mode ?? 'ONLINE_PAYMENT') as 'ONLINE_PAYMENT',
            paymentDate: payment?.paymentDate ?? new Date(),
            validityMonths: opts.validityMonths,
            reference: payment?.reference ?? null,
            notes: 'Activated by school-wide code redemption',
            existingPaymentId: paymentId,
          })
        },
      )

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SUBSCRIPTION_CODE_REDEEMED',
        detail: `School subscription activated via code ${result.publicRef} until ${result.periodEndAfter.toISOString().slice(0, 10)}`,
      }).catch(() => {})

      return {
        ok: true,
        publicRef: result.publicRef,
        statusAfter: result.statusAfter,
        periodEndAfter: result.periodEndAfter.toISOString(),
        message: `Subscription activated until ${result.periodEndAfter.toISOString().slice(0, 10)}.`,
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'], allowLockedSubscription: true },
  )
}
