import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateStudentEntitlement } from '@/lib/entitlement/student'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/students — student search for the
 * subscription-management workspace (billing.manage). Scoped to ONE
 * school (tenant isolation by construction — the id is re-verified
 * server-side and every query filters by schoolId).
 *
 * Query: ?q= (name/email/admissionNo/rollNo) &page= &pageSize= &entitlement=
 * (all | subscribed | unsubscribed | expiring)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true, slug: true, subscription: true } })
    if (!school) {
      return { ok: false, error: 'School not found' }
    }

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') ?? '25') || 25))
    const entitlementFilter = url.searchParams.get('entitlement') ?? 'all'

    const where: Record<string, unknown> = { schoolId: school.id }
    if (q) {
      where.OR = [
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { admissionNo: { contains: q, mode: 'insensitive' } },
        { rollNo: { contains: q, mode: 'insensitive' } },
      ]
    }

    const billingModel = school.subscription?.billingModel ?? 'SCHOOL_WIDE'
    const now = new Date()

    const [students, total] = await Promise.all([
      db.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: {
          user: { select: { id: true, name: true, email: true, status: true, subscriptionStatus: true } },
          class: { select: { name: true } },
          studentEntitlements: {
            where: { status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
            orderBy: { validityEnd: 'desc' },
            take: 1,
          },
        },
      }),
      db.student.count({ where }),
    ])

    const rows = students
      .map((s) => {
        const live = s.studentEntitlements[0] ?? null
        // School-wide tenants: students are covered — the entitlement
        // column shows "covered" rather than a per-student state.
        const coveredBySchool = billingModel === 'SCHOOL_WIDE'
        const decision = coveredBySchool
          ? null
          : evaluateStudentEntitlement({
              accountSubscriptionStatus: s.user.subscriptionStatus,
              tenant: { state: 'ACTIVE', businessAllowed: true, loginAllowed: true, plan: 'STANDARD', periodEnd: null, graceUntil: null, renewalRequired: false, message: null },
              billingModel,
              entitlement: live ? { status: live.status, validityStart: live.validityStart, validityEnd: live.validityEnd, source: live.source } : null,
              now,
            })
        return {
          studentId: s.id,
          userId: s.user.id,
          name: s.user.name,
          email: s.user.email,
          accountStatus: s.user.status,
          accountLocked: s.user.subscriptionStatus === 'LOCKED',
          admissionNo: s.admissionNo,
          rollNo: s.rollNo,
          class: s.class?.name ?? null,
          billingModel,
          entitlement: live
            ? {
                id: live.id,
                status: live.status,
                computedState: decision?.state ?? live.status,
                validityStart: live.validityStart.toISOString(),
                validityEnd: live.validityEnd.toISOString(),
                source: live.source,
                planCode: live.planCode,
              }
            : coveredBySchool
              ? { computedState: 'COVERED_BY_SCHOOL', coveredBySchool: true }
              : { computedState: 'NOT_SUBSCRIBED' },
        }
      })
      .filter((r) => {
        if (entitlementFilter === 'all') return true
        const state = r.entitlement.computedState
        if (entitlementFilter === 'subscribed') return state === 'ACTIVE' || state === 'PENDING'
        if (entitlementFilter === 'unsubscribed') return state === 'NOT_SUBSCRIBED' || state === 'EXPIRED'
        if (entitlementFilter === 'expiring') {
          const e = r.entitlement as { validityEnd?: string }
          return !!e.validityEnd && new Date(e.validityEnd).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000 && new Date(e.validityEnd).getTime() > now.getTime()
        }
        return true
      })

    return { school: { id: school.id, name: school.name, slug: school.slug, billingModel }, students: rows, total, page, pageSize }
  })
}
