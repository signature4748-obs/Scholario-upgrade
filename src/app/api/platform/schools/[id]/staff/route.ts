import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { evaluateStaffEntitlement, type StaffEntitlementSnapshot } from '@/lib/entitlement/staff'
import { SUBSCRIPTION_SESSION_SELECT } from '@/lib/platform/subscription-schema'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/staff — the school's teacher roster with
 * each teacher's effective staff-entitlement posture (billing.manage).
 *
 * Read-only: the roster feeds the Subscription workspace's Staff segment.
 * Effective access is computed LIVE (evaluateStaffEntitlement) from the
 * tenant's staffCoverage policy and each teacher's explicit validity
 * window — never from a stored status snapshot alone.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        subscription: { select: { ...SUBSCRIPTION_SESSION_SELECT } },
      },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
    }
    const sub = school.subscription as
      | { status: string; plan: string; periodEnd: Date | null; graceDays: number; overrideStatus: string | null; billingModel?: string | null; staffCoverage?: string | null }
      | null
    const staffCoverage = sub?.staffCoverage ?? 'TENANT'

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') ?? 100)))

    const teachers = await db.user.findMany({
      where: {
        schoolId: id,
        role: 'TEACHER',
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ name: 'asc' }],
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        subscriptionStatus: true,
        staffEntitlements: {
          where: { status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
          orderBy: { validityEnd: 'desc' },
          take: 1,
          select: { status: true, validityStart: true, validityEnd: true, source: true, planCode: true },
        },
      },
    })

    // The REAL tenant state — a RESTRICTED/SUSPENDED tenant locks every
    // staff member regardless of individual seats (the roster must show
    // the same truth the enforcement path applies).
    const tenant = evaluateTenantEntitlement({
      schoolStatus: school.status,
      accountSubscriptionStatus: 'ACTIVE',
      subscription: sub
        ? {
            status: sub.status,
            plan: sub.plan,
            periodEnd: sub.periodEnd,
            graceDays: sub.graceDays,
            overrideStatus: sub.overrideStatus,
          }
        : null,
    })

    return {
      school: { id: school.id, name: school.name, staffCoverage },
      staff: teachers.map((t) => {
        const live = t.staffEntitlements[0] ?? null
        const snapshot: StaffEntitlementSnapshot | null = live
          ? { status: live.status, validityStart: live.validityStart, validityEnd: live.validityEnd, source: live.source }
          : null
        const decision = evaluateStaffEntitlement({
          accountSubscriptionStatus: t.subscriptionStatus,
          tenant,
          staffCoverage,
          entitlement: snapshot,
        })
        return {
          id: t.id,
          name: t.name,
          email: t.email,
          accountLocked: t.subscriptionStatus === 'LOCKED',
          state: decision.state,
          businessAllowed: decision.businessAllowed,
          validityEnd: live?.validityEnd.toISOString() ?? null,
          source: live?.source ?? null,
          planCode: live?.planCode ?? null,
        }
      }),
    }
  })
}
