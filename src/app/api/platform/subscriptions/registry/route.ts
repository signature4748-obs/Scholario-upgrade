import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { isSubscriptionSchemaPendingError, SUBSCRIPTION_LEGACY_SELECT } from '@/lib/platform/subscription-schema'

export const runtime = 'nodejs'

/**
 * Registry-wide tenant entitlement tallies + expired count, computed from
 * ALL SchoolSubscription rows using ONLY legacy columns (status, periodEnd,
 * graceDays, overrideStatus + school.status) — identical on pre- and
 * post-migration databases, so the renewal KPIs stay honest under
 * schema-pending. The row inputs are exactly the entitlement evaluator's
 * contract; every state is computed LIVE (never a stored snapshot).
 *
 * PAYMENTS & GATEWAYS REDESIGN — also tallies the PAYMENT plane: rows
 * whose access is legacy fail-open (ACTIVE, no paid period, no override)
 * are counted separately so the control centre can say
 * "active paid" vs "unpaid — access allowed" honestly.
 */
async function computeTenantStateTallies(): Promise<{
  tenantStates: Record<string, number>
  subscriptionsExpired: number
  activePaid: number
  openAccessUnpaid: number
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
  let activePaid = 0
  let openAccessUnpaid = 0
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
    // PAYMENT plane: a paid period must EXIST for "active paid". Legacy
    // fail-open access (ACTIVE, no periodEnd, no override) is counted as
    // openAccessUnpaid — never as an active subscription.
    if (state === 'ACTIVE') {
      if (row.periodEnd != null) activePaid += 1
      else if (!row.overrideStatus) openAccessUnpaid += 1
    }
  }
  return { tenantStates, subscriptionsExpired, activePaid, openAccessUnpaid }
}

/**
 * GET /api/platform/subscriptions/registry — the searchable subscription
 * registry (billing.manage): per-school subscriptions with computed
 * states, plus the registry-wide summary aggregates.
 *
 * Query filters:
 *   ?q=<text>            school name/slug/code search
 *   ?billingModel=       SCHOOL_WIDE | PER_STUDENT | MIXED
 *   ?status=             computed state filter (ACTIVE/GRACE/RESTRICTED/…)
 *   ?paymentState=       UNPAID | PENDING | PAID (payment-plane filter)
 *   ?plan=               catalogue plan code (snapshot planCode or plan link)
 *   ?expiringDays=30     periodEnd within N days (renewal report window)
 *   ?page=&pageSize=     pagination (default 25, max 100)
 *
 * ROW PIPELINE (filter-BEFORE-paginate): the DB applies schoolId/q/
 * billingModel + the renewal window; the COMPUTED-state filter runs in JS
 * over the FULL filtered row set (the state is derived, it cannot be a
 * SQL predicate); ONLY THEN is the page sliced. `schools.total` is the
 * filtered cohort's size — the UI's "Showing X of Y" must describe the
 * filtered report, never the unfiltered registry, and matching rows on
 * page 2+ must be reachable.
 *
 * SUMMARY SEMANTICS — registry-wide, NEVER filter-scoped: the KPI cards
 * on the subscriptions overview are labeled as global counts, so
 * tenantStates / subscriptionsExpired / subscriptionsExpiringWithin30Days
 * are computed over ALL SchoolSubscription rows (the 30-day KPI keeps a
 * FIXED 30-day window even when ?expiringDays narrows the row lane).
 * Student-entitlement ORDER COUNTS by status + order stats + failed-claim
 * diagnostics come with every page — the operations dashboard reads one
 * endpoint. (The per-student ROWS slice this route once served was dead
 * wire payload — no consumer; the school-scoped student registry lives
 * at /api/platform/schools/[id]/students.)
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const billingModel = url.searchParams.get('billingModel') ?? ''
    const statusFilter = url.searchParams.get('status') ?? ''
    const paymentStateFilter = url.searchParams.get('paymentState') ?? ''
    const planFilter = url.searchParams.get('plan')?.trim() ?? ''
    const expiringDays = Number(url.searchParams.get('expiringDays') ?? '0') || 0
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') ?? '25') || 25))

    const now = new Date()
    const expiringBefore = expiringDays > 0 ? new Date(now.getTime() + expiringDays * 24 * 60 * 60 * 1000) : null
    /** Renewal-lane window — bounds the ROW set (and therefore the
     *  cohort total) when ?expiringDays is set. */
    const renewalWindow = expiringBefore ? { periodEnd: { gte: now, lte: expiringBefore } } : {}
    /** FIXED 30-day window for the "Expiring soon (30d)" KPI — the UI
     *  label says 30 days regardless of the renewal-report filter, so
     *  the math must too (a registry-wide KPI is never silently
     *  re-scoped to the active filter). */
    const expiring30Before = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

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
    /** DB-level tenant-row filter: schoolId / q / billingModel + the
     *  renewal window (the window is a plain SQL predicate, so it bounds
     *  the candidate set up front — coherent with the cohort total). */
    const registryWhere: Record<string, unknown> = { ...renewalWindow, ...schoolWhere }

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
    let studentCounts: Array<{ status: string; _count: { _all: number } }>
    let orderStats: Array<{ status: string; _count: { _all: number } }>
    let claimDiagnostics: Array<{ type: string; _count: { _all: number } }>
    let expiringSoon: number
    // PAYMENT plane — per-school pending-verification counts: online
    // orders awaiting settlement + deferred (code-gated) activations.
    // (Populated from groupBy rows after the query block below.)
    // PLAN filter options — distinct catalogue plan codes on live rows.
    let planOptionRows: Array<{ planDef: { code: string; name: string } | null }> = []
    let pendingOrderRows: Array<{ schoolId: string; _count: { _all: number } }> = []
    let deferredRows: Array<{ schoolId: string; _count: { _all: number } }> = []
    // Registry-wide renewal KPIs — queried SEPARATELY from the pending-
    // sensitive block: the tally consumes only legacy columns, so it must
    // survive a schema-pending failure of the other aggregates untouched.
    const { tenantStates, subscriptionsExpired, activePaid, openAccessUnpaid } =
      await computeTenantStateTallies()
    try {
      ;[
        subscriptions,
        studentCounts,
        orderStats,
        claimDiagnostics,
        expiringSoon,
        pendingOrderRows,
        deferredRows,
        planOptionRows,
      ] = await Promise.all([
          // FULL filtered row set — NO take/skip here. The computed-state
          // filter (a JS derivation) must run over EVERY matching row
          // BEFORE the pagination slice; slicing first made the filtered
          // total incoherent and matching rows beyond page 1 unreachable.
          // The renewal window IS a SQL predicate — apply it up front so
          // the candidates are bounded and coherent with the cohort total.
          db.schoolSubscription.findMany({
            where: registryWhere,
            orderBy: { updatedAt: 'desc' },
            include: {
              school: { select: { id: true, name: true, slug: true, code: true, status: true, isDemo: true } },
              planDef: { select: { code: true, name: true } },
              _count: { select: { payments: true } },
            },
          }),
          // Per-student entitlement ORDER-COUNT aggregates (computed live
          // from windows) — summary only.
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
          // Registry-wide 30-day KPI — FIXED window (never the
          // ?expiringDays filter's window), never schoolWhere-scoped.
          db.schoolSubscription.count({
            where: { periodEnd: { gte: now, lte: expiring30Before } },
          }),
          // PAYMENT plane — PENDING orders grouped per school (the row
          // pipeline reads this map to classify paymentState).
          db.subscriptionOrder.groupBy({
            by: ['schoolId'],
            _count: { _all: true },
            where: { status: 'PENDING' },
          }),
          // PAYMENT plane — deferred code-gated payments per school.
          db.platformPayment.groupBy({
            by: ['schoolId'],
            _count: { _all: true },
            where: { statusAfter: null },
          }),
          // PLAN filter options from live tenant snapshots.
          db.schoolSubscription.findMany({
            where: { planId: { not: null } },
            select: { planId: true, planDef: { select: { code: true, name: true } } },
            distinct: ['planId'],
          }),
        ])
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      schemaPending = true
      // Pre-migration retry: the tenant rows themselves (legacy columns +
      // computed states). The billingModel filter cannot be served. Same
      // filter-BEFORE-paginate lane as the primary path.
      const whereLegacy: Record<string, unknown> = { ...renewalWindow, ...schoolWhere }
      delete whereLegacy.billingModel
      ;[subscriptions, expiringSoon] = await Promise.all([
        db.schoolSubscription.findMany({
          where: whereLegacy,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            schoolId: true,
            ...SUBSCRIPTION_LEGACY_SELECT,
            school: { select: { id: true, name: true, slug: true, code: true, status: true, isDemo: true } },
          },
        }) as unknown as Array<Record<string, unknown>>,
        db.schoolSubscription.count({
          where: { periodEnd: { gte: now, lte: expiring30Before } },
        }),
      ])
      // Honest emptiness: these subsystems do not exist on this database
      // yet — the schemaPending flag explains why (never "zero activity").
      studentCounts = []
      orderStats = []
      claimDiagnostics = []
      pendingOrderRows = []
      deferredRows = []
      planOptionRows = []
    }

    const pendingOrdersBySchool = new Map(pendingOrderRows.map((r) => [r.schoolId, r._count._all]))
    const deferredBySchool = new Map(deferredRows.map((r) => [r.schoolId, r._count._all]))
    const planOptions = planOptionRows
      .filter((r): r is { planDef: { code: string; name: string } } => Boolean(r.planDef))
      .map((r) => ({ code: r.planDef.code, name: r.planDef.name }))

    // Compose the tenant entitlement states + row-level filters over the
    // FULL filtered set. The status filter matches a COMPUTED state (JS
    // derivation) — running it here, before the slice, is what keeps
    // `total` and the paged rows coherent; the window re-check mirrors
    // the SQL predicate exactly (defense against boundary drift between
    // the query's `now` and composition time).
    const filteredRows = subscriptions
      .map((raw) => {
        const sub = raw as {
          id: string
          schoolId: string
          status: string
          school: { id: string; name: string; slug: string; code: string; status: string; isDemo: boolean }
          billingModel?: string
          licensedStudents?: number | null
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

        // ── PAYMENTS & GATEWAYS REDESIGN — the four status planes, per
        // row, computed server-side (the UI renders them verbatim):
        //
        // 1. ACCOUNT ACCESS — can the tenant sign in at all.
        // 2. PAYMENT STATE — money: UNPAID / PENDING / PAID. "PENDING"
        //    = verified money is awaited (online order open or a
        //    code-gated deferred payment not yet redeemed). NEVER a
        //    proxy for access.
        // 3. SUBSCRIPTION STATE — the commercial contract. Legacy
        //    fail-open tenants classify as `legacy-open-access` and the
        //    UI labels them "Access allowed — no verified payment
        //    recorded." — never as an active subscription.
        // 4. (per-student/staff entitlement states live in their own
        //    registries — this is the tenant control centre.)
        const hasPaidPeriod = sub.periodEnd != null
        const openAccess = entitlement.state === 'ACTIVE' && !hasPaidPeriod && !sub.overrideStatus
        const pendingCount = (pendingOrdersBySchool.get(sub.schoolId) ?? 0) + (deferredBySchool.get(sub.schoolId) ?? 0)
        const paymentState: 'UNPAID' | 'PENDING' | 'PAID' =
          pendingCount > 0 ? 'PENDING' : (sub._count?.payments ?? 0) > 0 ? 'PAID' : 'UNPAID'
        const accessState: 'allowed' | 'blocked' = entitlement.state === 'NOT_ACTIVATED' ? 'blocked' : 'allowed'
        const subscriptionState = sub.overrideStatus
          ? `override-${sub.overrideStatus.toLowerCase()}`
          : entitlement.state === 'ACTIVE'
            ? openAccess
              ? 'legacy-open-access'
              : 'active-paid'
            : entitlement.state === 'GRACE'
              ? 'grace-period'
              : entitlement.state === 'RESTRICTED'
                ? 'expired'
                : entitlement.state === 'SUSPENDED'
                  ? 'suspended'
                  : 'not-activated'
        const daysToExpiry = hasPaidPeriod
          ? Math.ceil((new Date(sub.periodEnd as Date).getTime() - now.getTime()) / 86_400_000)
          : null
        const nextAction =
          entitlement.state === 'SUSPENDED'
            ? 'Resume the subscription or record a renewal payment'
            : entitlement.state === 'RESTRICTED'
              ? 'Record renewal payment'
              : entitlement.state === 'GRACE'
                ? 'Collect renewal payment before grace ends'
                : pendingCount > 0
                  ? 'Verify the pending payment'
                  : openAccess
                    ? 'Link a plan & record the first payment'
                    : entitlement.state === 'NOT_ACTIVATED'
                      ? 'Activate the school & its subscription'
                      : daysToExpiry != null && daysToExpiry <= 30
                        ? 'Prepare renewal'
                        : 'None'

        return {
          subscriptionId: sub.id,
          school: sub.school,
          billingModel: sub.billingModel ?? null,
          // ADD-SCHOOL WIZARD — the licensed student count agreed for
          // PER_STUDENT tenants (null for school-wide/mixed).
          licensedStudents: sub.licensedStudents ?? null,
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
          pendingPayments: pendingCount,
          paymentState,
          accessState,
          subscriptionState,
          openAccess,
          daysToExpiry,
          nextAction,
          entitlement: {
            state: entitlement.state,
            businessAllowed: entitlement.businessAllowed,
            renewalRequired: entitlement.renewalRequired,
          },
        }
      })
      .filter((r) => (statusFilter ? r.entitlement.state === statusFilter : true))
      .filter((r) => (paymentStateFilter ? r.paymentState === paymentStateFilter : true))
      .filter((r) =>
        planFilter
          ? r.planCode === planFilter || r.planDef?.code === planFilter
          : true,
      )
      .filter((r) =>
        expiringBefore
          ? r.periodEnd !== null && new Date(r.periodEnd) >= now && new Date(r.periodEnd) <= expiringBefore
          : true,
      )

    // Pagination — the slice happens ONLY after the computed-state filter
    // so every matching row is reachable and the counter's denominator is
    // the filtered cohort.
    const total = filteredRows.length
    const pageStart = (page - 1) * pageSize
    const pagedRows = filteredRows.slice(pageStart, pageStart + pageSize)

    return {
      ...(schemaPending ? { subscriptionSchemaPending: true as const } : {}),
      schools: {
        rows: pagedRows,
        // The FILTERED cohort's size (search + billingModel + renewal
        // window + computed status) — the honest denominator for the
        // UI's "Showing X of Y" under any filter combination.
        total,
        page,
        pageSize,
      },
      summary: {
        // Registry-wide tenant entitlement tallies + expired count are
        // computed on BOTH database states (legacy columns only) — the
        // renewal KPIs never depend on the pending migration.
        tenantStates,
        subscriptionsExpired,
        // PAYMENTS & GATEWAYS REDESIGN — the payment plane, registry-wide:
        // active PAID subscriptions vs legacy fail-open access, and the
        // pending-verification pipeline (open online orders + deferred
        // code-gated activations). "Active subscriptions" is now
        // unambiguous: activePaid NEVER counts open-access rows.
        activePaidSubscriptions: activePaid,
        unpaidOpenAccess: openAccessUnpaid,
        pendingVerification:
          (orderStats?.find((o) => o.status === 'PENDING')?._count._all ?? 0) +
          (deferredBySchool ? [...deferredBySchool.values()].reduce((s, n) => s + n, 0) : 0),
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
      planOptions,
    }
  })
}
