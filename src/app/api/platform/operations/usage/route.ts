import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { maybeScheduleStalenessSync, isStale } from '@/lib/ops/sync'
import { getSetting } from '@/lib/ops/alerts'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/usage — provider usage & limits from
 * STORED snapshots (no provider API on the read path). If data is
 * stale, a background refresh is SCHEDULED via Next `after()` (the
 * response still returns immediately with the current cache).
 * Permission: ops.read.
 */
export async function GET() {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const [staleMinutes, snapRows, syncRuns] = await Promise.all([
      getSetting('sync.stale_minutes'),
      db.providerUsageSnapshot.findMany({
        orderBy: { collectedAt: 'desc' },
        take: 500,
      }),
      db.providerSyncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 18,
        select: {
          id: true,
          provider: true,
          trigger: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          metricsWritten: true,
          metricsUnavailable: true,
          error: true,
        },
      }),
    ])

    // Newest row per (provider, scope, metric) + a small history for
    // chartable metrics (db_size_bytes keeps the last 30 points).
    const latest = new Map<string, (typeof snapRows)[number]>()
    const history = new Map<string, Array<{ collectedAt: string; value: number }>>()
    for (const r of snapRows) {
      const key = `${r.provider}|${r.scope}|${r.metric}`
      if (!latest.has(key)) {
        latest.set(key, r)
        const pts: Array<{ collectedAt: string; value: number }> = []
        for (const h of snapRows) {
          if (h.provider === r.provider && h.scope === r.scope && h.metric === r.metric) {
            pts.push({ collectedAt: h.collectedAt.toISOString(), value: h.value })
            if (pts.length >= 30) break
          }
        }
        history.set(key, pts.reverse())
      }
    }

    const parseMeta = (m: string | null): Record<string, unknown> | null => {
      if (!m) return null
      try {
        return JSON.parse(m)
      } catch {
        return null
      }
    }

    const metrics = [...latest.values()].map((r) => {
      const meta = parseMeta(r.meta)
      const ageMinutes = Math.round((Date.now() - r.collectedAt.getTime()) / 60_000)
      const percentConsumed =
        r.limitValue !== null && r.limitValue > 0
          ? Math.round(((r.value / r.limitValue) * 100) * 10) / 10
          : null
      return {
        provider: r.provider,
        scope: r.scope,
        scopeLabel: (meta?.scopeLabel as string) ?? r.scope,
        metric: r.metric,
        metricLabel: (meta?.metricLabel as string) ?? r.metric,
        value: r.value,
        unit: r.unit,
        limitValue: r.limitValue,
        measured: r.measured,
        availability: r.availability,
        periodStart: r.periodStart?.toISOString() ?? null,
        periodEnd: r.periodEnd?.toISOString() ?? null,
        collectedAt: r.collectedAt.toISOString(),
        meta,
        percentConsumed,
        remaining: r.limitValue !== null && r.limitValue > 0 ? r.limitValue - r.value : null,
        stale: isStale(ageMinutes, staleMinutes),
        ageMinutes,
        history: history.get(`${r.provider}|${r.scope}|${r.metric}`) ?? [],
        // Unavailable rows carry the machine-readable reason.
        unavailableReason:
          r.availability === 'unavailable'
            ? ((meta?.reason as string) ?? 'not-reported')
            : null,
      }
    })

    // Schedule a background refresh when anything is stale — the caller
    // sees a `refreshScheduled` flag (honest: data shown is still the
    // last snapshot; the NEXT read will be fresh).
    const staleCount = metrics.filter((m) => m.stale && m.availability === 'ok').length
    const scheduled = await maybeScheduleStalenessSync()

    const lastSuccessByProvider = new Map<string, { startedAt: string; status: string }>()
    for (const r of syncRuns) {
      if (!lastSuccessByProvider.has(r.provider) && (r.status === 'success' || r.status === 'partial')) {
        lastSuccessByProvider.set(r.provider, { startedAt: r.startedAt.toISOString(), status: r.status })
      }
    }

    return {
      metrics,
      syncRuns: syncRuns.map((r) => ({
        id: r.id,
        provider: r.provider,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        metricsWritten: r.metricsWritten,
        metricsUnavailable: r.metricsUnavailable,
        error: r.error,
      })),
      lastSuccess: Object.fromEntries(lastSuccessByProvider),
      staleThresholdMinutes: staleMinutes,
      staleCount,
      refreshScheduled: scheduled,
      costStatement:
        'Estimated costs are not shown: no billing/pricing data is available through the connected provider APIs/plans. Usage-to-cost conversion would be fabrication.',
    }
  })
}
