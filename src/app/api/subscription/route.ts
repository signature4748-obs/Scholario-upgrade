import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { entitlementForUser, publicEntitlementForUser } from '@/lib/entitlement/server'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { loadSubscriptionConfig } from '@/lib/subscription/config'

export const runtime = 'nodejs'

/**
 * GET /api/subscription — this school's subscription entitlement status.
 *
 * SaaS-HARDENING (§2): entitlement surfaces stay reachable in EVERY state
 * (this route is in the withUser exemption list) so a restricted tenant
 * can always answer "why is my ERP locked?" and act on renewal. The
 * evaluation is server-side from the session's tenant row — client input
 * never participates.
 *
 * SUBSCRIPTION & ENTITLEMENT SYSTEM: also returns the tenant's billing
 * model, the purchasable school-plan catalogue (for the renewal UX) and
 * the operator-issued activation codes visible to the school (publicRef
 * + status only — the code secret NEVER exists after issuance).
 */
export async function GET() {
  return withUser(async (user) => {
    const schoolId = user.schoolId
    const [payments, config, plans, codes] = schoolId
      ? await Promise.all([
          db.platformPayment.findMany({
            where: { schoolId },
            orderBy: { paymentDate: 'desc' },
            take: 5,
            select: {
              receiptNo: true,
              amount: true,
              currency: true,
              mode: true,
              paymentDate: true,
              periodMonths: true,
              statusAfter: true,
              periodEndAfter: true,
            },
          }),
          loadSubscriptionConfig(),
          // Purchasable school plans (online-capable, available) — the
          // renewal surface reads REAL configured prices, never invented.
          db.subscriptionPlan.findMany({
            where: { scope: 'SCHOOL', status: 'ACTIVE', allowOnline: true, availableForNew: true },
            orderBy: [{ sortOrder: 'asc' }],
            select: { code: true, name: true, description: true, interval: true, priceMonthly: true, priceAnnual: true, currency: true, graceDays: true },
          }),
          // Activation codes issued for THIS school (support-safe refs).
          db.activationCode.findMany({
            where: { schoolId, scope: 'SCHOOL_SUBSCRIPTION' },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { publicRef: true, status: true, planCode: true, expiresAt: true, issuedAt: true },
          }),
        ])
      : [[], null, [], []]

    return {
      entitlement: publicEntitlementForUser(user),
      billingModel: user.school?.subscription?.billingModel ?? 'SCHOOL_WIDE',
      recentPayments: payments.map((p) => ({
        receiptNo: p.receiptNo,
        amount: Number(p.amount),
        currency: p.currency,
        mode: p.mode,
        paymentDate: p.paymentDate.toISOString(),
        periodMonths: p.periodMonths,
        statusAfter: p.statusAfter,
        periodEndAfter: p.periodEndAfter ? p.periodEndAfter.toISOString() : null,
      })),
      plans: (plans as Array<{ code: string; name: string; description: string | null; interval: string; priceMonthly: unknown; priceAnnual: unknown; currency: string; graceDays: number }>).map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        interval: p.interval,
        price: p.interval === 'MONTHLY' ? Number(p.priceMonthly ?? 0) : Number(p.priceAnnual ?? 0),
        currency: p.currency,
        graceDays: p.graceDays,
      })),
      activationCodes: codes.map((c) => ({
        publicRef: c.publicRef,
        status: c.status,
        planCode: c.planCode,
        issuedAt: c.issuedAt.toISOString(),
        expiresAt: c.expiresAt.toISOString(),
      })),
      onlinePaymentsAvailable: config?.models.school.enabled ?? true,
      // Honest renewal instructions (no fabricated pricing/contacts).
      renewal: {
        message:
          'Renew your SCHOLARIO subscription to restore business modules. ' +
          'Renew online below, or contact SCHOLARIO support to arrange offline payment ' +
          '(you will receive an activation code to redeem here).',
      },
      _evalState: entitlementForUser(user).state,
    }
  })
}

/**
 * POST /api/subscription — request renewal (principal/management only).
 *
 * Records an audited RENEWAL_REQUEST (school-plane audit + platform
 * audit) so the platform team can act on it. This endpoint NEVER
 * activates anything — activation requires a VERIFIED payment (platform
 * admin record or signature-verified webhook). Browser reports are not
 * payment.
 */
const renewalRequestSchema = strictBody({
  note: z.string().max(400).optional(),
})

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only the principal or management can request a subscription renewal.',
          internalDetail: `subscription renewal request by role ${user.role}`,
        })
      }
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:subreq:${schoolId}`, RATE_LIMITS.message)

      const body = await parseJsonBody(req, renewalRequestSchema)

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SUBSCRIPTION_RENEWAL_REQUESTED',
        detail: body.note ?? 'Renewal requested from the school console',
      }).catch(() => {})

      return {
        ok: true,
        message:
          'Renewal request recorded. The SCHOLARIO platform team will contact your school to arrange payment.',
      }
    },
  )
}
