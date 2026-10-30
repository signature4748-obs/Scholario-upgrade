import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import { isSubscriptionSchemaPendingError } from '@/lib/platform/subscription-schema'

export const runtime = 'nodejs'

/**
 * GET /api/platform/reports/operations — the Reports & Audit data feed
 * (billing.manage OR audit.read is enforced per-section by the caller's
 * permissions — this route requires billing.manage, the audit slice is
 * additionally readable via the existing /api/platform/audit route):
 *
 *   renewals     — expiry buckets (7/30/90 days) + expired + unpaid
 *                  open-access (legacy fail-open) registry-wide counts
 *   actionList   — the schools needing administrative action right now
 *                  (grace / expired / suspended / unpaid open access),
 *                  each with its computed state and next action
 *   reconcile    — the scheduled reconciliation runs (JobRun) + what the
 *                  sweeps would expire right now (codes / entitlements /
 *                  orders reaching their end)
 *   auditFeed    — the most recent platform.billing.* audit events
 *
 * SCHEMA-PENDING TOLERANCE — subsystems that do not exist on a
 * pre-migration database degrade to null with `subscriptionSchemaPending`.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const url = new URL(req.url)
    const horizonDays = Math.min(
      180,
      Math.max(1, Number(url.searchParams.get('horizonDays') ?? '30') || 30),
    )

    const now = new Date()
    const horizonEnd = new Date(now.getTime() + horizonDays * 86_400_000)
    const in7 = new Date(now.getTime() + 7 * 86_400_000)
    const in90 = new Date(now.getTime() + 90 * 86_400_000)

    // Tenant tallies — legacy columns only (pre/post-migration identical).
    const rows = await db.schoolSubscription.findMany({
      select: {
        schoolId: true,
        status: true,
        periodEnd: true,
        graceDays: true,
        overrideStatus: true,
        school: { select: { id: true, name: true, status: true } },
        _count: { select: { payments: true } },
      },
    })
    const tenantStates: Record<string, number> = {
      ACTIVE: 0, GRACE: 0, RESTRICTED: 0, SUSPENDED: 0, NOT_ACTIVATED: 0,
    }
    let expiredCount = 0
    let activePaid = 0
    let openAccessUnpaid = 0
    let expiring7 = 0
    let expiring30 = 0
    let expiring90 = 0
    type ActionRow = {
      schoolId: string
      schoolName: string
      state: string
      subscriptionState: string
      paymentState: string
      periodEnd: string | null
      nextAction: string
    }
    const actionList: ActionRow[] = []
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
      const hasPeriod = row.periodEnd != null
      const periodEndTime = row.periodEnd ? new Date(row.periodEnd).getTime() : null
      if (periodEndTime != null && periodEndTime < now.getTime()) expiredCount += 1
      if (state === 'ACTIVE') {
        if (hasPeriod) activePaid += 1
        else if (!row.overrideStatus) openAccessUnpaid += 1
      }
      if (periodEndTime != null && periodEndTime >= now.getTime()) {
        if (periodEndTime <= in7.getTime()) expiring7 += 1
        if (periodEndTime <= now.getTime() + 30 * 86_400_000) expiring30 += 1
        if (periodEndTime <= in90.getTime()) expiring90 += 1
      }
      const openAccess = state === 'ACTIVE' && !hasPeriod && !row.overrideStatus
      const paymentState = (row._count?.payments ?? 0) > 0 ? 'PAID' : 'UNPAID'
      const subscriptionState = row.overrideStatus
        ? `override-${row.overrideStatus.toLowerCase()}`
        : state === 'ACTIVE'
          ? openAccess ? 'legacy-open-access' : 'active-paid'
          : state === 'GRACE' ? 'grace-period'
          : state === 'RESTRICTED' ? 'expired'
          : state === 'SUSPENDED' ? 'suspended'
          : 'not-activated'
      const needsAction =
        state === 'GRACE' || state === 'RESTRICTED' || state === 'SUSPENDED' || openAccess ||
        state === 'NOT_ACTIVATED' ||
        (periodEndTime != null && periodEndTime >= now.getTime() && periodEndTime <= horizonEnd.getTime())
      if (needsAction) {
        actionList.push({
          schoolId: row.school.id,
          schoolName: row.school.name,
          state,
          subscriptionState,
          paymentState,
          periodEnd: row.periodEnd?.toISOString() ?? null,
          nextAction:
            state === 'SUSPENDED' ? 'Resume the subscription or record a renewal payment'
            : state === 'RESTRICTED' ? 'Record renewal payment'
            : state === 'GRACE' ? 'Collect renewal payment before grace ends'
            : openAccess ? 'Link a plan & record the first payment'
            : state === 'NOT_ACTIVATED' ? 'Activate the school & its subscription'
            : 'Prepare renewal',
        })
      }
    }
    actionList.sort((a, b) => {
      const at = a.periodEnd ? new Date(a.periodEnd).getTime() : Number.MAX_SAFE_INTEGER
      const bt = b.periodEnd ? new Date(b.periodEnd).getTime() : Number.MAX_SAFE_INTEGER
      return at - bt
    })

    let schemaPending = false
    let reconcileRuns: Array<Record<string, unknown>> = []
    let sweep = { codesExpiringSoon: null as number | null, lapsedEntitlements: null as number | null, staleOrders: null as number | null }
    let auditFeed: Array<Record<string, unknown>> = []

    try {
      const [jobRuns, codesExpiringSoon, lapsedStudent, lapsedStaff, staleOrders, audit] =
        await Promise.all([
          db.jobRun.findMany({
            where: { jobName: { contains: 'reconcile' } },
            orderBy: { startedAt: 'desc' },
            take: 15,
          }),
          db.activationCode.count({
            where: { status: 'ISSUED', expiresAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
          }),
          db.studentEntitlement.count({
            where: { status: { in: ['PENDING', 'ACTIVE'] }, validityEnd: { lte: now } },
          }),
          db.staffEntitlement.count({
            where: { status: { in: ['PENDING', 'ACTIVE'] }, validityEnd: { lte: now } },
          }),
          db.subscriptionOrder.count({
            where: { status: 'PENDING', createdAt: { lte: new Date(now.getTime() - 60 * 60 * 1000) } },
          }),
          db.platformAuditLog.findMany({
            where: { action: { startsWith: 'platform.billing.' } },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
        ])
      reconcileRuns = jobRuns.map((r) => ({
        jobId: r.jobId,
        jobName: r.jobName,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        resultSummary: r.resultSummary,
        error: r.error,
      }))
      sweep = {
        codesExpiringSoon,
        lapsedEntitlements: lapsedStudent + lapsedStaff,
        staleOrders,
      }
      auditFeed = audit.map((a) => ({
        id: a.id,
        action: a.action,
        adminId: a.adminId,
        targetType: a.targetType,
        targetId: a.targetId,
        schoolId: a.schoolId,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      }))
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      schemaPending = true
    }

    return {
      ...(schemaPending ? { subscriptionSchemaPending: true as const } : {}),
      renewals: {
        horizonDays,
        expiring7,
        expiring30,
        expiring90,
        expired: expiredCount,
        activePaidSubscriptions: activePaid,
        unpaidOpenAccess: openAccessUnpaid,
      },
      actionList: actionList.slice(0, 100),
      reconcile: { runs: reconcileRuns, sweep },
      auditFeed,
    }
  })
}
