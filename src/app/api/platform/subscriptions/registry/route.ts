import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { evaluateStudentEntitlement } from '@/lib/entitlement/student'
import { isSubscriptionSchemaPendingError, SUBSCRIPTION_LEGACY_SELECT } from '@/lib/platform/subscription-schema'

export const runtime = 'nodejs'

/**
 * Registry-wide tenant entitlement tallies + expired count, computed from
 * ALL SchoolSubscription rows using ONLY legacy columns (status, periodEnd,
 * graceDays, overrideStatus + school.status) — identical on pre- and
 * post-migration databases, so the renewal KPIs stay honest under
 * schema-pending. The row inputs are exactly the entitlement evaluator's
 * contract; every state is computed LIVE (never a stored snapshot).
 */
async function computeTenantStateTallies(): Promise<{
  tenantStates: Record<string, number>
  subscriptionsExpired: number
}> {
  const rows = await db.schoolSubscription.findMany({
    select: {
      status: true,
      periodEnd: true,
      graceDays: true,
      overrideStatus: true,
      school: { select: { status: true } },
    },
  })
  const tenantStates: Record<string, number> = {
    ACTIVE: 0,
    GRACE: 0,
    RESTRICTED: 0,
    SUSPENDED: 0,
    NOT_ACTIVATED: 0,
  }
  const now = Date.now()
  let subscriptionsExpired = 0
  for (const row of rows) {
    const state = evaluateTenantEntitlement({
      schoolStatus: row.school.status,
      accountSubscriptionStatus: 'ACTIVE',
      subscription: {
        status: row.status,
        plan: null,
        periodEnd: row.periodEnd,
        graceDays: row.graceDays,
        overrideStatus: row.overrideStatus,
      },
    }).state
    tenantStates[state] = (tenantStates[state] ?? 0) + 1
    if (row.periodEnd != null && new Date(row.periodEnd).getTime() < now) subscriptionsExpired += 1
  }
  return { tenantStates, subscriptionsExpired }
}

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
    const schoolId = url.searchParams.get('schoolId')?.trim() ?? ''
    const schoolWhere: Record<string, unknown> = {}
    if (schoolId) {
      // Precise per-school fetch (the school workspace's Subscription tab
      // reads exactly one tenant's row — never a name-search guess).
      schoolWhere.schoolId = schoolId
    }
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

    // SCHEMA-PENDING RESILIENCE — the registry is the subscription read
    // surface. On a pre-migration database the SchoolSubscription rows
    // themselves EXIST (legacy columns), so the tenant registry serves
    // real rows + computed entitlement states; everything that needs
    // pending-migration objects (student entitlements, orders, claim
    // diagnostics, plan-registry join, payment counts, snapshot columns)
    // degrades to empty/null and the response carries `schemaPending:
    // true` so the UI explains the state honestly. The billingModel
    // filter (a pending column) is dropped in the retry path.
    let schemaPending = false
    let subscriptions: Array<Record<string, unknown>>
    let totalCount: number
    let studentCounts: Array<{ status: string; _count: { _all: number } }>
    let orderStats: Array<{ status: string; _count: { _all: number } }>
    let claimDiagnostics: Array<{ type: string; _count: { _all: number } }>
    let expiringSoon: number
    let entitlementRows: Array<Record<string, unknown>>
    // Registry-wide renewal KPIs — queried SEPARATELY from the pending-
    // sensitive block: the tally consumes only legacy columns, so it must
    // survive a schema-pending failure of the other aggregates untouched.
    const { tenantStates, subscriptionsExpired } = await computeTenantStateTallies()
    try {
      ;[subscriptions, totalCount, studentCounts, orderStats, claimDiagnostics, expiringSoon, entitlementRows] =
        await Promise.all([
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
          db.schoolSubscription.count({
            where: {
              // RENEWAL LANE — when expiringDays is set, the list total is
              // the WINDOW cohort (the UI's "showing X of Y" must describe
              // the report, not the whole registry); the unfiltered lane
              // keeps the plain registry count.
              ...(expiringBefore ? { periodEnd: { gte: now, lte: expiringBefore } } : {}),
              ...schoolWhere,
            },
          }),
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
          db.studentEntitlement.findMany({
            orderBy: { validityEnd: 'desc' },
            take: pageSize,
            include: {
              school: { select: { id: true, name: true, slug: true } },
              student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true, email: true } } } },
            },
          }),
        ])
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      schemaPending = true
      // Pre-migration retry: the tenant rows themselves (legacy columns +
      // computed states). The billingModel filter cannot be served.
      const whereLegacy = { ...schoolWhere }
      delete whereLegacy.billingModel
      ;[subscriptions, totalCount, expiringSoon] = await Promise.all([
        db.schoolSubscription.findMany({
          where: whereLegacy,
          orderBy: { updatedAt: 'desc' },
          take: pageSize,
          skip: (page - 1) * pageSize,
          select: {
            id: true,
            schoolId: true,
            ...SUBSCRIPTION_LEGACY_SELECT,
            school: { select: { id: true, name: true, slug: true, code: true, status: true, isDemo: true } },
          },
        }) as unknown as Array<Record<string, unknown>>,
        db.schoolSubscription.count({
          where: {
            // Same renewal-lane window semantics as the primary lane.
            ...(expiringBefore ? { periodEnd: { gte: now, lte: expiringBefore } } : {}),
            ...whereLegacy,
          },
        }),
        db.schoolSubscription.count({
          where: {
            periodEnd: { gte: now, lte: expiringBefore ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
          },
        }),
      ])
      // Honest emptiness: these subsystems do not exist on this database
      // yet — the schemaPending flag explains why (never "zero activity").
      studentCounts = []
      orderStats = []
      claimDiagnostics = []
      entitlementRows = []
    }

    // Compose the tenant entitlement states + row-level filters.
    const rows = subscriptions
      .map((raw) => {
        const sub = raw as {
          id: string
          schoolId: string
          status: string
          school: { id: string; name: string; slug: string; code: string; status: string; isDemo: boolean }
          billingModel?: string
          plan: string
          planDef?: { code: string; name: string } | null
          planCode?: string | null
          interval?: string | null
          priceSnapshot?: string | null
          currencySnapshot?: string | null
          periodStart: Date | null
          periodEnd: Date | null
          graceDays: number
          overrideStatus: string | null
          notes: string | null
          _count?: { payments: number }
        }
        const entitlement = evaluateTenantEntitlement({
          schoolStatus: sub.school.status,
          accountSubscriptionStatus: 'ACTIVE',
          subscription: {
            status: sub.status,
            plan: sub.plan,
            periodEnd: sub.periodEnd,
            graceDays: sub.graceDays,
            overrideStatus: sub.overrideStatus,
          },
        })
        return {
          subscriptionId: sub.id,
          school: sub.school,
          billingModel: sub.billingModel ?? null,
          plan: sub.plan,
          planDef: sub.planDef ? { code: sub.planDef.code, name: sub.planDef.name } : null,
          planCode: sub.planCode ?? null,
          interval: sub.interval ?? null,
          priceSnapshot: sub.priceSnapshot == null ? null : Number(sub.priceSnapshot),
          currencySnapshot: sub.currencySnapshot ?? null,
          periodStart: sub.periodStart?.toISOString() ?? null,
          periodEnd: sub.periodEnd?.toISOString() ?? null,
          graceDays: sub.graceDays,
          overrideStatus: sub.overrideStatus,
          notes: sub.notes,
          paymentCount: sub._count?.payments ?? null,
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

    // ── Student entitlements slice (per-student registry) — loaded in
    // the main Promise.all above (empty + schemaPending when the system
    // is not provisioned on this database yet). ──────────────────────────
    const studentRegistry = (entitlementRows as Array<{
      id: string
      planCode: string | null
      status: string
      validityStart: Date
      validityEnd: Date
      source: string
      revokeReason: string | null
      school: { id: string; name: string; slug: string }
      student: { id: string; admissionNo: string | null; rollNo: string | null; user: { name: string | null; email: string } }
    }>).map((e) => {
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
      ...(schemaPending ? { subscriptionSchemaPending: true as const } : {}),
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
        // Registry-wide tenant entitlement tallies + expired count are
        // computed on BOTH database states (legacy columns only) — the
        // renewal KPIs never depend on the pending migration.
        tenantStates,
        subscriptionsExpired,
        ...(schemaPending
          ? {
              // null = "system not provisioned on this database yet" — the
              // UI renders these as unavailable, never as zero activity.
              studentEntitlements: null,
              orders: null,
              rejectedClaims: null,
            }
          : {
              studentEntitlements: Object.fromEntries(studentCounts.map((c) => [c.status, c._count._all])),
              orders: Object.fromEntries(orderStats.map((o) => [o.status, o._count._all])),
              rejectedClaims: claimDiagnostics.reduce((sum, c) => sum + c._count._all, 0),
            }),
        subscriptionsExpiringWithin30Days: expiringSoon,
      },
    }
  })
}
