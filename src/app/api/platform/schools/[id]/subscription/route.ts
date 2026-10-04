import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { applySubscriptionOverride, SUBSCRIPTION_STATES } from '@/lib/platform/billing'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/subscription — the tenant's entitlement
 * snapshot + full payment ledger (billing.manage / schools.read).
 *
 * The response projects the SAME evaluation the school plane uses
 * (evaluateTenantEntitlement) so the console and the school's locked
 * shell can never disagree about the state.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      include: {
        subscription: true,
        platformPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 100,
          include: { recordedBy: { select: { name: true, email: true } } },
        },
      },
    })
    if (!school) return { ok: false, error: 'School not found' }

    const entitlement = evaluateTenantEntitlement({
      schoolStatus: school.status,
      accountSubscriptionStatus: 'ACTIVE',
      subscription: school.subscription
        ? {
            status: school.subscription.status,
            plan: school.subscription.plan,
            periodEnd: school.subscription.periodEnd,
            graceDays: school.subscription.graceDays,
            overrideStatus: school.subscription.overrideStatus,
          }
        : null,
    })

    return {
      school: { id: school.id, name: school.name, slug: school.slug, status: school.status },
      subscription: school.subscription
        ? {
            status: school.subscription.status,
            plan: school.subscription.plan,
            periodStart: school.subscription.periodStart?.toISOString() ?? null,
            periodEnd: school.subscription.periodEnd?.toISOString() ?? null,
            graceDays: school.subscription.graceDays,
            overrideStatus: school.subscription.overrideStatus,
            notes: school.subscription.notes,
          }
        : null,
      entitlement: {
        state: entitlement.state,
        businessAllowed: entitlement.businessAllowed,
        renewalRequired: entitlement.renewalRequired,
        message: entitlement.message,
      },
      payments: school.platformPayments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo,
        amount: Number(p.amount),
        currency: p.currency,
        mode: p.mode,
        paymentDate: p.paymentDate.toISOString(),
        periodMonths: p.periodMonths,
        reference: p.reference,
        notes: p.notes,
        verification: p.verification,
        recordedBy: p.recordedBy ? { name: p.recordedBy.name, email: p.recordedBy.email } : null,
        statusAfter: p.statusAfter,
        periodEndAfter: p.periodEndAfter?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  })
}

const overrideSchema = strictBody({
  overrideStatus: z.enum(SUBSCRIPTION_STATES).nullable(),
  reason: z.string().min(4).max(400),
})

/**
 * PATCH /api/platform/schools/[id]/subscription — manual entitlement
 * override (BILLING, STEP-UP): set RESTRICTED/SUSPENDED/GRACE/ACTIVE as
 * a platform decision (e.g. goodwill extension, manual restriction), or
 * null to return to the computed period-based state. Fully audited;
 * School.status (lifecycle) is NOT touched here (suspend/reactivate
 * remain the lifecycle controls).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, overrideSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!school) {
        return { ok: false, error: 'School not found' }
      }

      const result = await applySubscriptionOverride({
        schoolId: school.id,
        overrideStatus: body.overrideStatus,
        notes: body.reason,
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.subscription_override',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: { overrideStatus: result.overrideStatus ?? '(cleared — computed state)' },
      })

      return {
        ok: true,
        overrideStatus: result.overrideStatus,
        message: result.overrideStatus
          ? `Subscription override set to ${result.overrideStatus} (takes effect immediately).`
          : 'Override cleared — the subscription returns to its computed period state.',
      }
    },
    { method: 'PATCH' },
  )
}
