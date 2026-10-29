import { withUser } from '@/lib/api'
import { db } from '@/lib/db'
import { entitlementForUser } from '@/lib/entitlement/server'
import { evaluateStaffEntitlement, publicStaffEntitlement } from '@/lib/entitlement/staff'

export const runtime = 'nodejs'

/**
 * GET /api/subscription/staff — the TEACHER's own staff entitlement
 * status (self-view; always reachable — the exempt subscription surface —
 * so a per-seat locked teacher can see WHY and how to activate).
 */
export async function GET() {
  return withUser(async (user) => {
    const tenant = entitlementForUser(user)
    const live = await db.staffEntitlement.findFirst({
      where: { userId: user.id, schoolId: user.schoolId ?? '', status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
      orderBy: [{ status: 'asc' }, { validityEnd: 'desc' }],
      select: { id: true, status: true, validityStart: true, validityEnd: true, source: true, planCode: true },
    })
    const decision = evaluateStaffEntitlement({
      accountSubscriptionStatus: user.subscriptionStatus,
      tenant,
      staffCoverage: user.school?.subscription?.staffCoverage,
      entitlement: live
        ? { status: live.status, validityStart: live.validityStart, validityEnd: live.validityEnd, source: live.source }
        : null,
    })
    return {
      ok: true,
      staffCoverage: user.school?.subscription?.staffCoverage ?? 'TENANT',
      entitlement: publicStaffEntitlement(decision, { source: live?.source ?? null, planCode: live?.planCode ?? null }),
      entitlementId: live?.id ?? null,
      validityStart: live?.validityStart.toISOString() ?? null,
      validityEnd: live?.validityEnd.toISOString() ?? null,
      status: live?.status ?? null,
    }
  })
}
