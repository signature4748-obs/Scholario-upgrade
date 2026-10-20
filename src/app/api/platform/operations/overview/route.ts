import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { lastSuccessfulSyncPerProvider, isStale } from '@/lib/ops/sync'
import { getSetting } from '@/lib/ops/alerts'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/overview — the Overview tab aggregate.
 * Permission: ops.read (root implicit; explicit grant otherwise).
 *
 * Every metric carries its source + observation time; the route reads
 * STORED data only (snapshots/checks/audit rows) — no provider API is
 * called on this path. Staleness is computed server-side.
 */
export async function GET() {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const now = new Date()
    const authWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [
      schoolCounts,
      authFailures,
      errorGroups,
      emailStatuses,
      latestChecks,
      syncAges,
      staleMinutes,
      alertsOpen,
      deploymentsSnapshot,
      latestAudit,
      sessionStats,
    ] = await Promise.all([
      db.school.groupBy({ by: ['status'], _count: { _all: true } }),
      db.platformAuditLog.count({
        where: {
          action: { in: ['platform.login.failed', 'platform.step_up.failed', 'platform.login.locked'] },
          createdAt: { gte: authWindow },
        },
      }),
      db.operationalError.findMany({
        where: { status: { not: 'resolved' } },
        orderBy: { lastSeenAt: 'desc' },
        take: 6,
        select: {
          id: true,
          fingerprint: true,
          category: true,
          severity: true,
          status: true,
          message: true,
          lastSeenAt: true,
          occurrences: true,
        },
      }),
      db.emailDelivery.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { createdAt: { gte: authWindow } },
      }),
      db.monitoringCheck.findMany({ orderBy: { checkedAt: 'desc' }, take: 100 }),
      lastSuccessfulSyncPerProvider(),
      getSetting('sync.stale_minutes'),
      db.platformAlert.findMany({
        where: { status: { not: 'resolved' } },
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          type: true,
          severity: true,
          status: true,
          metricLabel: true,
          message: true,
          lastSeenAt: true,
          observedValue: true,
          unit: true,
        },
      }),
      db.providerUsageSnapshot.findMany({
        where: { metric: 'deployments_recent_list', availability: 'ok' },
        orderBy: { collectedAt: 'desc' },
        take: 4,
        select: { scope: true, meta: true, collectedAt: true },
      }),
      db.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, action: true, adminId: true, createdAt: true, schoolId: true },
      }),
      Promise.all([
        db.platformAdminSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
        db.session.count({ where: { expiresAt: { gt: now } } }),
      ]),
    ])

    const statusMap: Record<string, number> = { ACTIVE: 0, SUSPENDED: 0, PENDING: 0, TRIAL: 0 }
    for (const g of schoolCounts) statusMap[g.status] = g._count._all
    const totalSchools = Object.values(statusMap).reduce((a, b) => a + b, 0)

    // Email outbox (7d) with the accepted≠delivered distinction.
    const email: Record<string, number> = {}
    for (const r of emailStatuses) email[r.status] = r._count._all

    // Latest health check per key.
    const checksByKeys = new Map<string, (typeof latestChecks)[number] & { detail: string | null }>()
    for (const c of latestChecks) {
      if (!checksByKeys.has(c.checkKey)) checksByKeys.set(c.checkKey, { ...c, detail: c.detail ?? null })
    }
    const checks = [...checksByKeys.values()].map((c) => ({
      checkKey: c.checkKey,
      status: c.status,
      severity: c.severity,
      latencyMs: c.latencyMs,
      detail: c.detail ?? '',
      checkedAt: c.checkedAt.toISOString(),
    }))
    const dbCheck = checksByKeys.get('db_connectivity')

    // Usage headline: newest snapshot per (provider, scope, metric) with
    // a known limit, ranked by percent consumed.
    const snapRows = await db.providerUsageSnapshot.findMany({
      where: { availability: 'ok', limitValue: { not: null } },
      orderBy: { collectedAt: 'desc' },
      take: 300,
      select: {
        provider: true,
        scope: true,
        metric: true,
        value: true,
        unit: true,
        limitValue: true,
        collectedAt: true,
        meta: true,
      },
    })
    const seen = new Set<string>()
    const usageHeadline: Array<Record<string, unknown>> = []
    for (const r of snapRows) {
      const key = `${r.provider}|${r.scope}|${r.metric}`
      if (seen.has(key) || !r.limitValue) continue
      seen.add(key)
      let metricLabel = r.metric
      try {
        metricLabel = ((JSON.parse(r.meta ?? '{}') as Record<string, unknown>).metricLabel as string) ?? r.metric
      } catch {
        /* meta unparseable → metric key */
      }
      usageHeadline.push({
        provider: r.provider,
        metric: r.metric,
        metricLabel,
        value: r.value,
        unit: r.unit,
        limitValue: r.limitValue,
        percentConsumed: Math.min(100, Math.round(((r.value / r.limitValue) * 100) * 10) / 10),
        collectedAt: r.collectedAt.toISOString(),
        stale: isStale(Math.round((Date.now() - r.collectedAt.getTime()) / 60_000), staleMinutes),
      })
    }

    // Deployments (real, from the latest Vercel sync).
    type Dep = {
      deploymentId: string
      state: string
      createdAt: string | null
      commitSha: string | null
      commitMessage: string | null
      url: string | null
    }
    const deployments: Array<{ project: string; scope: string; collectedAt: string; list: Dep[] }> = []
    const seenDepScopes = new Set<string>()
    for (const d of deploymentsSnapshot) {
      if (seenDepScopes.has(d.scope)) continue
      seenDepScopes.add(d.scope)
      let list: Dep[] = []
      try {
        const meta = JSON.parse(d.meta ?? '{}') as { deployments?: Dep[]; scopeLabel?: string }
        list = Array.isArray(meta.deployments) ? meta.deployments.slice(0, 3) : []
        deployments.push({
          project: meta.scopeLabel ?? d.scope,
          scope: d.scope,
          collectedAt: d.collectedAt.toISOString(),
          list,
        })
      } catch {
        /* skip malformed */
      }
    }

    return {
      schools: {
        total: totalSchools,
        active: statusMap['ACTIVE'] ?? 0,
        suspended: statusMap['SUSPENDED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        trial: statusMap['TRIAL'] ?? 0,
      },
      sessions: { platform: sessionStats[0], school: sessionStats[1] },
      security: { platformAuthFailures7d: authFailures },
      health: {
        db: dbCheck
          ? {
              status: dbCheck.status,
              latencyMs: dbCheck.latencyMs,
              checkedAt: dbCheck.checkedAt.toISOString(),
            }
          : { status: 'unknown', latencyMs: null, checkedAt: null },
        checks,
        lastCheckedAt: latestChecks[0]?.checkedAt.toISOString() ?? null,
      },
      errors: {
        unresolved: errorGroups,
        // Monitoring coverage summary (honest map).
      },
      email: {
        last7d: email,
        failedTotal:
          (email['FAILED'] ?? 0) + (email['BOUNCED'] ?? 0) + (email['COMPLAINED'] ?? 0),
        distinctionNote:
          'QUEUED = provider ACCEPTED (delivery unconfirmed); SENT = delivery evidence (webhook/delivery event). Failed emails are never marked delivered.',
      },
      usage: {
        headline: usageHeadline.sort(
          (a, b) => (b.percentConsumed as number) - (a.percentConsumed as number),
        ),
        syncAgesMinutes: syncAges,
        staleThresholdMinutes: staleMinutes,
        providerStale: Object.fromEntries(
          Object.entries(syncAges).map(([p, age]) => [p, isStale(age, staleMinutes)]),
        ),
      },
      deployments,
      alerts: alertsOpen,
      recentAudit: latestAudit.map((a) => ({
        id: a.id,
        action: a.action,
        at: a.createdAt.toISOString(),
        schoolId: a.schoolId,
      })),
      generatedAt: now.toISOString(),
    }
  })
}
