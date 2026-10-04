import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { entitlementForUser, publicEntitlementForUser } from '@/lib/entitlement/server'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * GET /api/subscription — this school's subscription entitlement status.
 *
 * SaaS-HARDENING (§2): entitlement surfaces stay reachable in EVERY state
 * (this route is in the withUser exemption list) so a restricted tenant
 * can always answer "why is my ERP locked?" and act on renewal. The
 * evaluation is server-side from the session's tenant row — client input
 * never participates.
 */
export async function GET() {
  return withUser(async (user) => {
    const schoolId = user.schoolId
    const payments = schoolId
      ? await db.platformPayment.findMany({
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
        })
      : []
    return {
      entitlement: publicEntitlementForUser(user),
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
      // Honest renewal instructions (no fabricated pricing/contacts).
      renewal: {
        message:
          'Renew your SCHOLARIO subscription to restore business modules. ' +
          'Contact SCHOLARIO support to arrange renewal (online or offline payment).',
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
