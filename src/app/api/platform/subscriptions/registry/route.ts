import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { evaluateStudentEntitlement } from '@/lib/entitlement/student'

export const runtime = 'nodejs'

/**
 * GET /api/platform/subscriptions/registry — the searchable subscription
 * registry (billing.manage): per-school subscriptions with computed
 * states, per-student entitlements, orders and code diagnostics.
 *
 * Query filters:
 *   ?q=<text>            school name/slug/code search
 *   ?billingModel=       SCHOOL_WIDE | PER_STUDENT | MIXED
 *   ?status=             computed state filter (ACTIVE/GRACE/RESTRICTED/…)
 *   ?expiringDays=30     periodEnd/validityEnd within N days (renewal report)
 *   ?page=&pageSize=     pagination (default 25, max 100)
 *
 * Summary aggregates (registry + student entitlement counts by computed
 * state + expiring buckets + failed-claim diagnostics) come with every
 * page — the operations dashboard reads one endpoint.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const billingModel = url.searchParams.get('billingModel') ?? ''
    const statusFilter = url.searchParams.get('status') ?? ''
    const expiringDays = Number(url.searchParams.get('expiringDays') ?? '0') || 0
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') ?? '25') || 25))

    const now = new Date()
    const expiringBefore = expiringDays > 0 ? new Date(now.getTime() + expiringDays * 24 * 60 * 60 * 1000) : null

    // ── School (tenant) subscriptions ─────────────────────────────────────
    const schoolWhere: Record<string, unknown> = {}
    if (q) {
      schoolWhere.school = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      }
    }
    if (billingModel && ['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'].includes(billingModel)) {
      schoolWhere.billingModel = billingModel
    }

    const [subscriptions, totalCount, studentCounts, orderStats, claimDiagnostics, expiringSoon] = await Promise.all([
      db.schoolSubscription.findMany({
        where: schoolWhere,
        orderBy: { updatedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: {
          school: { select: { id: true, name: true, slug: true, code: true, status: true, isDemo: true } },
          planDef: { select: { code: true, name: true } },
          _count: { select: { payments: true } },
        },
      }),
      db.schoolSubscription.count({ where: schoolWhere }),
      // Per-student entitlement aggregates (computed live from windows).
      db.studentEntitlement.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      db.subscriptionOrder.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      db.activationCodeEvent.groupBy({
        by: ['type'],
        _count: { _all: true },
        where: { type: 'CLAIM_REJECTED' },
      }),
      db.schoolSubscription.count({
        where: {
          periodEnd: { gte: now, lte: expiringBefore ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ])

    // Compose the tenant entitlement states + row-level filters.
    const rows = subscriptions
      .map((s) => {
        const entitlement = evaluateTenantEntitlement({
          schoolStatus: s.school.status,
          accountSubscriptionStatus: 'ACTIVE',
          subscription: {
            status: s.status,
            plan: s.plan,
            periodEnd: s.periodEnd,
            graceDays: s.graceDays,
            overrideStatus: s.overrideStatus,
          },
        })
        return {
          subscriptionId: s.id,
          school: s.school,
          billingModel: s.billingModel,
          plan: s.plan,
          planDef: s.planDef ? { code: s.planDef.code, name: s.planDef.name } : null,
          planCode: s.planCode,
          interval: s.interval,
          priceSnapshot: s.priceSnapshot === null ? null : Number(s.priceSnapshot),
          currencySnapshot: s.currencySnapshot,
          periodStart: s.periodStart?.toISOString() ?? null,
          periodEnd: s.periodEnd?.toISOString() ?? null,
          graceDays: s.graceDays,
          overrideStatus: s.overrideStatus,
          notes: s.notes,
          paymentCount: s._count.payments,
          entitlement: {
            state: entitlement.state,
            businessAllowed: entitlement.businessAllowed,
            renewalRequired: entitlement.renewalRequired,
          },
        }
      })
      .filter((r) => (statusFilter ? r.entitlement.state === statusFilter : true))
      .filter((r) =>
        expiringBefore
          ? r.periodEnd !== null && new Date(r.periodEnd) >= now && new Date(r.periodEnd) <= expiringBefore
          : true,
      )

    // ── Student entitlements slice (per-student registry) ──────────────────
    const entitlementRows = await db.studentEntitlement.findMany({
      orderBy: { validityEnd: 'desc' },
      take: pageSize,
      include: {
        school: { select: { id: true, name: true, slug: true } },
        student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true, email: true } } } },
      },
    })
    const studentRegistry = entitlementRows.map((e) => {
      const decision = evaluateStudentEntitlement({
        accountSubscriptionStatus: 'ACTIVE',
        tenant: { state: 'ACTIVE', businessAllowed: true, loginAllowed: true, plan: 'STANDARD', periodEnd: null, graceUntil: null, renewalRequired: false, message: null },
        billingModel: 'PER_STUDENT',
        entitlement: { status: e.status, validityStart: e.validityStart, validityEnd: e.validityEnd, source: e.source },
        now,
      })
      return {
        entitlementId: e.id,
        school: e.school,
        student: e.student,
        planCode: e.planCode,
        status: e.status,
        computedState: decision.state,
        validityStart: e.validityStart.toISOString(),
        validityEnd: e.validityEnd.toISOString(),
        source: e.source,
        revokeReason: e.revokeReason,
      }
    })

    return {
      schools: {
        rows,
        total: totalCount,
        page,
        pageSize,
      },
      students: {
        rows: studentRegistry.filter((r) => (statusFilter ? r.computedState === statusFilter : true)),
      },
      summary: {
        studentEntitlements: Object.fromEntries(studentCounts.map((c) => [c.status, c._count._all])),
        orders: Object.fromEntries(orderStats.map((o) => [o.status, o._count._all])),
        rejectedClaims: claimDiagnostics.reduce((sum, c) => sum + c._count._all, 0),
        subscriptionsExpiringWithin30Days: expiringSoon,
      },
    }
  })
}
