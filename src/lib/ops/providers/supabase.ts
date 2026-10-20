/**
 * Supabase provider adapter — project health + DIRECTLY MEASURED database
 * metrics.
 *
 * WHAT IS ACTUALLY AVAILABLE (live-verified against the connected
 * project kbyknezedewvgrnqervj, 2026-10-20):
 *   · GET /v1/projects — project identity, region, Postgres version.
 *   · GET /v1/projects/{ref}/health?services[]=db&… — PER-SERVICE health
 *     (db, storage, auth, realtime, rest, pooler) — the real dependency
 *     status for the Service Health tab.
 *   · DIRECT SQL (the app's own Prisma connection, one cheap statement):
 *       pg_database_size() — the REAL database size in bytes;
 *       pg_stat_activity — real connection counts.
 *     These are measured facts, not estimates, and are safe to run on a
 *     schedule (single-row catalog reads).
 *
 * WHAT IS NOT AVAILABLE (live-verified: HTTP 404 on this Management API):
 *   · Usage/quota endpoints (db egress, storage size, MAU, Edge Function
 *     invocations, monthly quotas/billing). The adapter records these as
 *     `endpoint-unavailable` so the UI shows the honest reason + a link
 *     to the Supabase dashboard.
 *   · The plan's database-size QUOTA is not exposed either — the ops
 *     db_size threshold therefore uses the operator-configured
 *     expectation (db_size.warning_bytes, labeled ESTIMATE), never a
 *     fabricated provider limit.
 *
 * Credential: OPS_SUPABASE_ACCESS_TOKEN (Management API, server-only).
 * Unset → management-API metrics report `not-configured`; the direct-SQL
 * database metrics still work (they ride the app's DATABASE_URL).
 */

import { db } from '@/lib/db'
import { opsFetch, OpsFetchError } from '../fetch'
import type { MetricSample, ProviderSyncResult, UnavailableMetric } from '../types'

const MANAGEMENT_API = 'https://api.supabase.com'

/** Resolve the project ref from SUPABASE_URL (kbyknezedewvgrnqervj
 *  style), with an optional explicit override. */
export function supabaseProjectRef(): string | null {
  const explicit = (process.env.SUPABASE_PROJECT_REF ?? '').trim()
  if (explicit) return explicit
  const url = (process.env.SUPABASE_URL ?? '').trim()
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\./i)
  return m ? m[1] : null
}

export function supabaseConfigured(): boolean {
  return (process.env.OPS_SUPABASE_ACCESS_TOKEN ?? '').trim().length > 0
}

async function queryDbSize(): Promise<{ sizeBytes: number | null; connections: number | null; activeConnections: number | null; error?: string }> {
  try {
    const rows = (await db.$queryRaw`
      SELECT pg_database_size(current_database()) AS size_bytes,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_connections
    `) as Array<{ size_bytes: bigint | number; connections: number; active_connections: number }>
    if (!rows.length) return { sizeBytes: null, connections: null, activeConnections: null, error: 'no rows' }
    const row = rows[0]
    return {
      sizeBytes: Number(row.size_bytes),
      connections: Number(row.connections),
      activeConnections: Number(row.active_connections),
    }
  } catch (e) {
    return {
      sizeBytes: null,
      connections: null,
      activeConnections: null,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    }
  }
}

interface SupabaseHealthEntry {
  name: string
  healthy: boolean
  status?: string
}

/** Live Supabase sync (called by the sync service). */
export async function syncSupabase(): Promise<ProviderSyncResult> {
  const samples: MetricSample[] = []
  const unavailable: UnavailableMetric[] = []
  const ref = supabaseProjectRef()

  // ── Direct-SQL metrics (always available — the app's own DB) ─────────
  const size = await queryDbSize()
  if (ref) {
    const label = `Supabase project · ${ref}`
    const scope = `database:${ref}`
    if (size.sizeBytes !== null) {
      samples.push({
        provider: 'supabase',
        scope,
        scopeLabel: label,
        metric: 'db_size_bytes',
        metricLabel: 'Database size',
        value: size.sizeBytes,
        unit: 'bytes',
        // Plan quota NOT exposed by the provider API → null (never 0,
        // never fabricated). The alert threshold uses the operator
        // estimate (db_size.warning_bytes), clearly labeled.
        limitValue: null,
        measured: true,
        availability: 'ok',
        meta: { source: 'pg_database_size(current_database()) — direct SQL' },
      })
    } else {
      unavailable.push({
        provider: 'supabase',
        scope,
        scopeLabel: label,
        metric: 'db_size_bytes',
        metricLabel: 'Database size',
        reason: 'endpoint-unavailable',
        detail: `Direct database size query failed: ${size.error ?? 'unknown error'}`,
      })
    }
    if (size.connections !== null) {
      samples.push({
        provider: 'supabase',
        scope,
        scopeLabel: label,
        metric: 'db_connections',
        metricLabel: 'Database connections (pooler sessions)',
        value: size.connections,
        unit: 'count',
        limitValue: null,
        measured: true,
        availability: 'ok',
        meta: {
          active: size.activeConnections,
          source: 'pg_stat_activity — direct SQL',
        },
      })
    }
  }

  // ── Management-API metrics ────────────────────────────────────────────
  if (!supabaseConfigured()) {
    unavailable.push({
      provider: 'supabase',
      scope: 'account',
      scopeLabel: 'Supabase account',
      metric: 'service_health',
      metricLabel: 'Per-service platform health (db · storage · auth · realtime · rest · pooler)',
      reason: 'not-configured',
      detail:
        'OPS_SUPABASE_ACCESS_TOKEN is not set in the server environment. Add the Supabase Management API access token to enable platform-level service health.',
    })
  } else if (ref) {
    try {
      const auth = { Authorization: `Bearer ${(process.env.OPS_SUPABASE_ACCESS_TOKEN ?? '').trim()}` }
      const health = (await opsFetch(
        `${MANAGEMENT_API}/v1/projects/${encodeURIComponent(ref)}/health?services[]=db&services[]=storage&services[]=auth&services[]=realtime&services[]=rest&services[]=pooler`,
        { headers: auth, timeoutMs: 8_000 },
      )) as SupabaseHealthEntry[] | null

      if (Array.isArray(health)) {
        const healthyCount = health.filter((s) => s.healthy).length
        samples.push({
          provider: 'supabase',
          scope: `database:${ref}`,
          scopeLabel: `Supabase project · ${ref}`,
          metric: 'services_healthy',
          metricLabel: 'Supabase services reporting healthy',
          value: healthyCount,
          unit: 'services',
          // NOT a quota: limitValue is reserved for CONSUMPTION ceilings;
          // "x of y services healthy" is a good-state count, and modeling
          // it as a limit would fire a false 100%-consumed threshold alert.
          // The total rides in meta.
          limitValue: null,
          measured: true,
          availability: 'ok',
          meta: {
            servicesTotal: health.length,
            services: health.map((s) => ({ name: s.name, healthy: Boolean(s.healthy), status: s.status ?? null })),
          },
        })
      }
    } catch (e) {
      const detail = e instanceof OpsFetchError ? e.message : e instanceof Error ? e.message : String(e)
      unavailable.push({
        provider: 'supabase',
        scope: `database:${ref}`,
        scopeLabel: `Supabase project · ${ref}`,
        metric: 'service_health',
        metricLabel: 'Per-service platform health',
        reason: 'endpoint-unavailable',
        detail: `Supabase Management API request failed: ${detail.slice(0, 200)}`,
      })
    }
  }

  // ── Honest unavailability: usage quotas not exposed by this API ──────
  unavailable.push({
    provider: 'supabase',
    scope: ref ? `database:${ref}` : 'account',
    scopeLabel: ref ? `Supabase project · ${ref}` : 'Supabase account',
    metric: 'usage_metrics',
    metricLabel: 'API requests · egress · storage · Edge Functions · Realtime · MAU',
    reason: 'endpoint-unavailable',
    detail:
      'The connected Supabase Management API does not expose usage/quota endpoints for this account (verified: 404). View usage and quotas in the Supabase dashboard: supabase.com/dashboard/project/_/settings/usage',
  })

  return { provider: 'supabase', samples, unavailable }
}
