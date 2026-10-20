/**
 * Provider sync service — the ONLY writer of ProviderUsageSnapshot rows.
 *
 * Contract:
 *   · Dashboard reads NEVER call a provider API — they read snapshots
 *     and compute staleness; synchronization happens here (manual
 *     "Sync now", the Vercel cron endpoint, or the staleness-triggered
 *     background refresh scheduled with Next `after()` — the response
 *     is never delayed by a provider call).
 *   · ONE provider failing never fails the run for the others —
 *     providers run in bounded parallel, each with its own error
 *     handling + ProviderSyncRun row.
 *   · Every run is recorded (ProviderSyncRun) with written/unavailable
 *     counts + sanitized error; the newest SUCCESS/PARTIAL per provider
 *     drives "last successful synchronization" and the sync-freshness
 *     health check.
 *   · Alerts are evaluated after every run (threshold breaches, stale
 *     sync, email failure rate) — see src/lib/ops/alerts.ts.
 */

import { after } from 'next/server'
import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'
import { syncVercel } from './providers/vercel'
import { syncSupabase } from './providers/supabase'
import { syncResend } from './providers/resend'
import { evaluateAlertsAfterSync, getSetting } from './alerts'
import { isStaleMetric } from './quota'
import type { ProviderId, ProviderSyncResult } from './types'

const PROVIDERS: ProviderId[] = ['vercel', 'supabase', 'resend']

const ADAPTERS: Record<ProviderId, () => Promise<ProviderSyncResult>> = {
  vercel: syncVercel,
  supabase: syncSupabase,
  resend: syncResend,
}

/** Snapshot retention (days) — pruned by runOpsRetention. */
export const SNAPSHOT_RETENTION_DAYS = 90

function sanitizeMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  try {
    return JSON.stringify(meta).slice(0, 4000)
  } catch {
    return '[unserializable-meta]'
  }
}

/** Sync ONE provider: run adapter → persist samples + unavailable rows +
 *  finalize the ProviderSyncRun row. Never throws. */
export async function syncProvider(
  provider: ProviderId,
  trigger: 'manual' | 'staleness' | 'cron' | 'request',
): Promise<ProviderSyncResult> {
  const startedAt = Date.now()
  const run = await db.providerSyncRun
    .create({ data: { provider, trigger, status: 'running' } })
    .catch(() => null)

  let result: ProviderSyncResult
  try {
    result = await ADAPTERS[provider]()
  } catch (e) {
    result = {
      provider,
      samples: [],
      unavailable: [],
      error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300),
    }
  }

  let written = 0
  let unavailableCount = 0

  // Persist samples + explicit unavailable rows (a missing metric must be
  // VISIBLE in the dashboard with its reason — never an implied zero).
  const persistOne = async (data: Parameters<typeof db.providerUsageSnapshot.create>[0]['data']) => {
    await db.providerUsageSnapshot.create({ data }).catch((e) => {
      log('warn', 'ops_snapshot_write_failed', {
        channel: 'ops',
        provider,
        detail: e instanceof Error ? e.message : String(e),
      })
    })
  }

  for (const s of result.samples) {
    await persistOne({
      provider: s.provider,
      scope: s.scope,
      metric: s.metric,
      value: s.value,
      unit: s.unit,
      limitValue: s.limitValue,
      measured: s.measured,
      periodStart: s.periodStart ?? null,
      periodEnd: s.periodEnd ?? null,
      availability: 'ok',
      meta: sanitizeMeta({
        ...(s.meta ?? {}),
        metricLabel: s.metricLabel,
        scopeLabel: s.scopeLabel,
      }),
      syncRunId: run?.id ?? null,
    })
    written++
  }
  for (const u of result.unavailable) {
    await persistOne({
      provider: u.provider,
      scope: u.scope,
      metric: u.metric,
      value: 0,
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'unavailable',
      meta: sanitizeMeta({
        reason: u.reason,
        detail: u.detail,
        metricLabel: u.metricLabel,
        scopeLabel: u.scopeLabel,
      }),
      syncRunId: run?.id ?? null,
    })
    unavailableCount++
  }

  // Vercel deployment summaries → one snapshot row per project (bounded
  // list in meta: state, SHA, URL, time — no PII).
  if (result.deployments?.length) {
    const byProject = new Map<string, typeof result.deployments>()
    for (const d of result.deployments) {
      const list = byProject.get(d.projectId) ?? []
      list.push(d)
      byProject.set(d.projectId, list)
    }
    for (const [projectId, list] of byProject) {
      await persistOne({
        provider: 'vercel',
        scope: `project:${projectId}`,
        metric: 'deployments_recent_list',
        value: list.length,
        unit: 'count',
        limitValue: null,
        measured: true,
        availability: 'ok',
        meta: sanitizeMeta({
          metricLabel: 'Recent production deployments',
          scopeLabel: `Vercel project · ${list[0]?.projectName ?? projectId}`,
          deployments: list.map((d) => ({
            deploymentId: d.deploymentId,
            state: d.state,
            createdAt: d.createdAt,
            commitSha: d.commitSha,
            commitMessage: d.commitMessage,
            url: d.url,
          })),
        }),
        syncRunId: run?.id ?? null,
      })
      written++
    }
  }

  const status = result.error ? (result.samples.length > 0 ? 'partial' : 'failed') : 'success'
  if (run) {
    await db.providerSyncRun
      .update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          metricsWritten: written,
          metricsUnavailable: unavailableCount,
          error: result.error ?? null,
        },
      })
      .catch(() => null)
  }

  log(status === 'success' ? 'info' : 'warn', 'ops_provider_sync', {
    channel: 'ops',
    provider,
    trigger,
    status,
    written,
    unavailable: unavailableCount,
    durationMs: Date.now() - startedAt,
    error: result.error ?? null,
  })

  // Operational error record for failed syncs (grouped per provider).
  if (result.error) {
    const { recordOperationalError } = await import('./errors')
    await recordOperationalError({
      category: 'provider_sync',
      severity: 'error',
      message: result.error,
      provider,
      env: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    })
  }

  // Alert evaluation rides along (usage thresholds / staleness / email rate).
  await evaluateAlertsAfterSync(provider).catch((e) => {
    log('warn', 'ops_alert_eval_failed', {
      channel: 'ops',
      provider,
      detail: e instanceof Error ? e.message : String(e),
    })
  })

  return result
}

/** Sync all providers (bounded parallel). Never throws; returns per-
 *  provider statuses for the API response. */
export async function syncAllProviders(
  trigger: 'manual' | 'staleness' | 'cron' | 'request',
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(
    PROVIDERS.map(async (p) => {
      const r = await syncProvider(p, trigger)
      out[p] = r.error ? (r.samples.length ? 'partial' : 'failed') : 'success'
    }),
  )
  return out
}

/** Age (minutes) since the last SUCCESS/PARTIAL sync per provider.
 *  null = never synced. */
export async function lastSuccessfulSyncPerProvider(): Promise<Record<string, number | null>> {
  const rows = await db.providerSyncRun.findMany({
    where: { status: { in: ['success', 'partial'] } },
    orderBy: { startedAt: 'desc' },
    take: 60,
    select: { provider: true, startedAt: true },
  })
  const out: Record<string, number | null> = {}
  for (const p of PROVIDERS) out[p] = null
  for (const r of rows) {
    if (out[r.provider] === null) {
      out[r.provider] = Math.round((Date.now() - r.startedAt.getTime()) / 60_000)
    }
  }
  return out
}

/** Is a provider's data stale right now? Single implementation lives in
 *  quota.ts (isStaleMetric) and is unit-tested there. */
export { isStaleMetric as isStale }

/**
 * Staleness-triggered background refresh — call from a READ route during
 * request processing: cheap DB checks run inline; the provider calls are
 * scheduled with Next `after()` so the response is never delayed and no
 * provider API is called on the render path. Coarse lock: providers with
 * a RUNNING sync started <10 minutes ago are skipped (concurrent
 * dashboard pings collapse into one refresh).
 * Returns the providers scheduled (for logging/tests).
 */
export async function maybeScheduleStalenessSync(): Promise<ProviderId[]> {
  try {
    const staleMinutes = await getSetting('sync.stale_minutes')
    const ages = await lastSuccessfulSyncPerProvider()
    const running = await db.providerSyncRun.findMany({
      where: { status: 'running', startedAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      select: { provider: true },
    })
    const runningSet = new Set(running.map((r) => r.provider))
    const staleProviders = PROVIDERS.filter(
      (p) => !runningSet.has(p) && isStaleMetric(ages[p] ?? null, staleMinutes),
    )
    if (staleProviders.length) {
      log('info', 'ops_staleness_sync_scheduled', {
        channel: 'ops',
        providers: staleProviders,
        staleMinutes,
      })
      after(() => Promise.all(staleProviders.map((p) => syncProvider(p, 'staleness'))))
    }
    return staleProviders
  } catch (e) {
    log('warn', 'ops_staleness_sync_check_failed', {
      channel: 'ops',
      detail: e instanceof Error ? e.message : String(e),
    })
    return []
  }
}

/** Retention cleanup — prunes event-level history (group/rollup rows
 *  stay forever, like the audit trail). Safe to run repeatedly. */
export async function runOpsRetention(): Promise<{
  snapshots: number
  events: number
  checks: number
}> {
  const snapshotCutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const eventCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const checkCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [snapshots, events, checks] = await Promise.all([
    db.providerUsageSnapshot.deleteMany({ where: { collectedAt: { lt: snapshotCutoff } } }),
    db.operationalErrorEvent.deleteMany({ where: { occurredAt: { lt: eventCutoff } } }),
    db.monitoringCheck.deleteMany({ where: { checkedAt: { lt: checkCutoff } } }),
  ])

  log('info', 'ops_retention_run', {
    channel: 'ops',
    snapshots: snapshots.count,
    events: events.count,
    checks: checks.count,
  })

  return { snapshots: snapshots.count, events: events.count, checks: checks.count }
}
