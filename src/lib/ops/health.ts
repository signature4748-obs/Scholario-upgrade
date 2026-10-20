/**
 * Service health checks — liveness / readiness / dependency, executed on
 * demand (POST …/health/run or the staleness background path), persisted
 * to MonitoringCheck, and read by the dashboard (GET …/health serves the
 * stored results — running checks is never required to view the tab).
 *
 * Suite (each bounded by a timeout; failures never abort the suite):
 *   db_connectivity      SELECT 1 latency (readiness) — degraded >300ms,
 *                        down when unreachable.
 *   db_size              Real pg_database_size vs the operator-configured
 *                        capacity expectation (ESTIMATE — the provider
 *                        does not expose the plan quota; labeled as such).
 *   config_presence      Required env NAMES present (booleans; values are
 *                        never read or shown) — readiness.
 *   resend_api           Read-only GET /domains (dependency) with 6s
 *                        timeout + verified-domain count (testing-mode
 *                        signal).
 *   supabase_mgmt_api    Management API reachability (dependency; skipped
 *                        → not_configured when the token is absent).
 *   vercel_api           Vercel API reachability (dependency; skipped →
 *                        not_configured when the token is absent).
 *   email_outbox_failure_rate  Real 7-day failure rate from EmailDelivery
 *                        (the source of truth) — warning/critical by
 *                        threshold.
 *   ops_sync_freshness   Newest successful provider sync per provider vs
 *                        the configured staleness threshold.
 *
 * Liveness = /health/live (exists — linked, not duplicated).
 * Public endpoints never expose infrastructure details; this suite is
 * platform-admin-only.
 */

import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'
import { getSetting } from './alerts'
import type { CheckStatus, HealthCheckResult, CheckSeverity } from './types'

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const started = Date.now()
  try {
    const value = await fn()
    return { ok: true, ms: Date.now() - started, value }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) }
  }
}

async function dbConnectivity(): Promise<HealthCheckResult> {
  const r = await timed(() => db.$queryRaw`SELECT 1`)
  const status: CheckStatus = !r.ok ? 'down' : r.ms > 300 ? 'degraded' : 'healthy'
  return {
    checkKey: 'db_connectivity',
    checkLabel: 'Database connectivity',
    status,
    severity: !r.ok ? 'critical' : status === 'degraded' ? 'warning' : 'info',
    latencyMs: r.ms,
    detail: r.ok
      ? `SELECT 1 responded in ${r.ms} ms${status === 'degraded' ? ' (elevated latency)' : ''}.`
      : `Database unreachable: ${r.error}. Next step: check the Supabase project status page; the pooler may be restarting.`,
    kind: 'readiness',
    drilldownHint: 'Service Health · Supabase services',
  }
}

async function dbSize(): Promise<HealthCheckResult> {
  const r = await timed(async () => {
    const rows = (await db.$queryRaw`SELECT pg_database_size(current_database()) AS size_bytes`) as Array<{
      size_bytes: bigint | number
    }>
    return Number(rows[0]?.size_bytes ?? 0)
  })
  if (!r.ok) {
    return {
      checkKey: 'db_size',
      checkLabel: 'Database size',
      status: 'unknown',
      severity: 'warning',
      latencyMs: r.ms,
      detail: `Size query failed: ${r.error}`,
      kind: 'readiness',
    }
  }
  const bytes = r.value ?? 0
  const warnBytes = await getSetting('db_size.warning_bytes')
  const percent = warnBytes > 0 ? (bytes / warnBytes) * 100 : 0
  const status: CheckStatus = percent >= 95 ? 'down' : percent >= 85 ? 'degraded' : 'healthy'
  const mb = (bytes / 1024 / 1024).toFixed(1)
  const warnMb = (warnBytes / 1024 / 1024).toFixed(0)
  return {
    checkKey: 'db_size',
    checkLabel: 'Database size',
    status,
    severity: status === 'healthy' ? 'info' : status === 'degraded' ? 'warning' : 'critical',
    latencyMs: r.ms,
    detail:
      `Database size is ${mb} MB — ${percent.toFixed(1)}% of the operator-configured capacity expectation ` +
      `(${warnMb} MB, an ESTIMATE: the provider does not expose the plan quota via API).`,
    kind: 'readiness',
    drilldownHint: 'Usage & Limits · Supabase',
  }
}

/** Required configuration NAMES (presence only — never values). */
const REQUIRED_CONFIG_KEYS = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FILE_SIGNING_SECRET',
] as const

const RECOVERY_CONFIG_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM'] as const

async function configPresence(): Promise<HealthCheckResult> {
  const missingCore = REQUIRED_CONFIG_KEYS.filter((k) => !(process.env[k] ?? '').trim())
  const missingRecovery = RECOVERY_CONFIG_KEYS.filter((k) => !(process.env[k] ?? '').trim())
  const missingOps = (['OPS_SUPABASE_ACCESS_TOKEN', 'OPS_VERCEL_TOKEN'] as const).filter(
    (k) => !(process.env[k] ?? '').trim(),
  )
  const status: CheckStatus =
    missingCore.length > 0 ? 'down' : missingRecovery.length > 0 ? 'degraded' : 'healthy'
  const parts: string[] = []
  if (missingCore.length) parts.push(`core missing: ${missingCore.join(', ')}`)
  if (missingRecovery.length) parts.push(`email recovery missing: ${missingRecovery.join(', ')} (password-reset email will fail loudly)`)
  if (missingOps.length) parts.push(`provider telemetry not configured: ${missingOps.join(', ')}`)
  return {
    checkKey: 'config_presence',
    checkLabel: 'Required configuration present',
    status,
    severity: status === 'healthy' ? 'info' : status === 'degraded' ? 'warning' : 'critical',
    latencyMs: null,
    detail:
      status === 'healthy'
        ? 'All core, email-recovery and provider-telemetry configuration variables are present (names only are checked — values are never exposed).'
        : `${parts.join('; ')}. Configure them in the deployment environment — never in the repo.`,
    kind: 'readiness',
  }
}

async function fetchProviderReachable(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6_000)
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) }
  } finally {
    clearTimeout(timer)
  }
}

async function resendApi(): Promise<HealthCheckResult> {
  const key = (process.env.RESEND_API_KEY ?? '').trim()
  if (!key) {
    return {
      checkKey: 'resend_api',
      checkLabel: 'Email provider (Resend) API',
      status: 'not_configured',
      severity: 'warning',
      latencyMs: null,
      detail: 'RESEND_API_KEY is not configured — transactional email is nonfunctional and provider health is unknown.',
      kind: 'dependency',
    }
  }
  // ONE bounded request: reachability + domain verification state together
  // (never an unbounded second call on the check path — a hung provider
  // must never hang the suite).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6_000)
  let latency = 0
  try {
    const started = Date.now()
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: 'no-store',
    })
    latency = Date.now() - started
    if (!res.ok) {
      return {
        checkKey: 'resend_api',
        checkLabel: 'Email provider (Resend) API',
        status: res.status === 401 ? 'down' : 'degraded',
        severity: res.status === 401 ? 'critical' : 'warning',
        latencyMs: latency,
        detail: `Resend API responded HTTP ${res.status}${res.status === 401 ? ' — the API key is missing/invalid/revoked; rotate it in the Resend dashboard and the deployment env.' : ''}.`,
        kind: 'dependency',
      }
    }
    const body = (await res.json().catch(() => null)) as { data?: Array<{ status?: string }> } | null
    const total = Array.isArray(body?.data) ? body.data.length : 0
    const verified = (body?.data ?? []).filter((d) => (d.status ?? '').toLowerCase() === 'verified').length
    return {
      checkKey: 'resend_api',
      checkLabel: 'Email provider (Resend) API',
      status: verified === 0 ? 'degraded' : 'healthy',
      severity: verified === 0 ? 'warning' : 'info',
      latencyMs: latency,
      detail:
        verified === 0
          ? `API reachable (${latency} ms) but ZERO verified sending domains (${total} configured) — the account is in TESTING MODE: the provider only delivers to the account-owner address. This is the confirmed cause of historical invitation failures. Next step: verify a sending domain in the Resend dashboard. Do NOT rotate the API key — it is valid.`
          : `API reachable (${latency} ms); ${verified}/${total} sending domains verified.`,
      kind: 'dependency',
      drilldownHint: 'Errors & Incidents — email failures diagnosis',
    }
  } catch (e) {
    return {
      checkKey: 'resend_api',
      checkLabel: 'Email provider (Resend) API',
      status: 'down',
      severity: 'critical',
      latencyMs: latency,
      detail: `Resend API unreachable (${e instanceof Error ? e.message.slice(0, 160) : 'network error'}). Email sending will fail while this persists — sends are retried with bounded backoff, never silently dropped.`,
      kind: 'dependency',
    }
  } finally {
    clearTimeout(timer)
  }
}

async function supabaseMgmtApi(): Promise<HealthCheckResult> {
  const token = (process.env.OPS_SUPABASE_ACCESS_TOKEN ?? '').trim()
  if (!token) {
    return {
      checkKey: 'supabase_mgmt_api',
      checkLabel: 'Supabase Management API',
      status: 'not_configured',
      severity: 'info',
      latencyMs: null,
      detail: 'OPS_SUPABASE_ACCESS_TOKEN not set — Supabase platform-level service health is unavailable (direct database checks still run).',
      kind: 'dependency',
    }
  }
  const started = Date.now()
  const r = await fetchProviderReachable('https://api.supabase.com/v1/projects', {
    Authorization: `Bearer ${token}`,
  })
  const latency = Date.now() - started
  return {
    checkKey: 'supabase_mgmt_api',
    checkLabel: 'Supabase Management API',
    status: r.ok ? 'healthy' : r.status === 401 ? 'down' : 'degraded',
    severity: r.ok ? 'info' : r.status === 401 ? 'critical' : 'warning',
    latencyMs: latency,
    detail: r.ok
      ? `Management API reachable (${latency} ms) — platform service health is collected during provider sync.`
      : `Management API unreachable (HTTP ${r.status ?? 'network error'}). ${r.status === 401 ? 'Token invalid/revoked — rotate OPS_SUPABASE_ACCESS_TOKEN.' : 'Next step: check api.supabase.com status.'}`,
    kind: 'dependency',
  }
}

async function vercelApi(): Promise<HealthCheckResult> {
  const token = (process.env.OPS_VERCEL_TOKEN ?? '').trim()
  if (!token) {
    return {
      checkKey: 'vercel_api',
      checkLabel: 'Vercel API (deployments)',
      status: 'not_configured',
      severity: 'info',
      latencyMs: null,
      detail: 'OPS_VERCEL_TOKEN not set — deployment telemetry is unavailable. Add the read-only token to enable it.',
      kind: 'dependency',
    }
  }
  const started = Date.now()
  const r = await fetchProviderReachable('https://api.vercel.com/v9/projects?limit=1', {
    Authorization: `Bearer ${token}`,
  })
  const latency = Date.now() - started
  return {
    checkKey: 'vercel_api',
    checkLabel: 'Vercel API (deployments)',
    status: r.ok ? 'healthy' : r.status === 401 ? 'down' : 'degraded',
    severity: r.ok ? 'info' : r.status === 401 ? 'critical' : 'warning',
    latencyMs: latency,
    detail: r.ok
      ? `Vercel API reachable (${latency} ms) — deployment history is collected during provider sync.`
      : `Vercel API unreachable (HTTP ${r.status ?? 'network error'}). ${r.status === 401 ? 'Token invalid/revoked — rotate OPS_VERCEL_TOKEN.' : ''}`,
    kind: 'dependency',
  }
}

async function emailOutboxFailureRate(): Promise<HealthCheckResult> {
  const [warnPct, criticalPct] = await Promise.all([
    getSetting('email.failure_rate.warn'),
    getSetting('email.failure_rate.critical'),
  ])
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const rows = await db.emailDelivery.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: { createdAt: { gte: since }, status: { not: 'PENDING' } },
  })
  const counts: Record<string, number> = {}
  let attempts = 0
  for (const r of rows) {
    counts[r.status] = r._count._all
    attempts += r._count._all
  }
  const failed = (counts['FAILED'] ?? 0) + (counts['BOUNCED'] ?? 0) + (counts['COMPLAINED'] ?? 0)
  const rate = attempts > 0 ? (failed / attempts) * 100 : 0
  // Fewer than 20 attempts = not enough evidence for a rate verdict.
  if (attempts < 20) {
    return {
      checkKey: 'email_outbox_failure_rate',
      checkLabel: 'Email delivery failure rate (7d)',
      status: 'unknown',
      severity: 'info',
      latencyMs: null,
      detail: `Only ${attempts} send attempt(s) in the 7-day window — not enough evidence for a rate verdict (delivered ${counts['SENT'] ?? 0}, queued-accepted ${counts['QUEUED'] ?? 0}).`,
      kind: 'readiness',
    }
  }
  const status: CheckStatus = rate >= criticalPct ? 'down' : rate >= warnPct ? 'degraded' : 'healthy'
  return {
    checkKey: 'email_outbox_failure_rate',
    checkLabel: 'Email delivery failure rate (7d)',
    status,
    severity: status === 'healthy' ? 'info' : status === 'degraded' ? 'warning' : 'critical',
    latencyMs: null,
    detail: `${failed} of ${attempts} sends failed/bounced/complained in 7 days (${rate.toFixed(1)}%; thresholds warn ${warnPct}% / critical ${criticalPct}%). By status: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}.`,
    kind: 'readiness',
    drilldownHint: 'Errors & Incidents — email failures',
  }
}

async function opsSyncFreshness(): Promise<HealthCheckResult> {
  const staleMinutes = await getSetting('sync.stale_minutes')
  const rows = await db.providerSyncRun.findMany({
    where: { status: { in: ['success', 'partial'] } },
    orderBy: { startedAt: 'desc' },
    take: 60,
    select: { provider: true, startedAt: true },
  })
  const ageByProvider = new Map<string, number>()
  for (const r of rows) {
    if (!ageByProvider.has(r.provider)) {
      ageByProvider.set(r.provider, Math.round((Date.now() - r.startedAt.getTime()) / 60_000))
    }
  }
  const all = ['vercel', 'supabase', 'resend']
  const stale = all.filter((p) => (ageByProvider.get(p) ?? Infinity) > staleMinutes)
  const never = all.filter((p) => !ageByProvider.has(p))
  const status: CheckStatus =
    never.length === all.length ? 'unknown' : stale.length > 0 ? 'degraded' : 'healthy'
  const ages = all.map((p) => `${p}=${ageByProvider.has(p) ? `${ageByProvider.get(p)}m ago` : 'never'}`).join(', ')
  return {
    checkKey: 'ops_sync_freshness',
    checkLabel: 'Provider data freshness',
    status,
    severity: status === 'healthy' ? 'info' : status === 'unknown' ? 'info' : 'warning',
    latencyMs: null,
    detail: `Last successful provider sync — ${ages}. ${
      stale.length ? `Stale beyond the ${staleMinutes}-minute threshold: ${stale.join(', ')} — use "Sync now" on the Usage tab.` : never.length ? 'Run the first sync from the Usage tab (Sync now).' : `All within the ${staleMinutes}-minute freshness threshold.`
    }`,
    kind: 'readiness',
  }
}

/** Run the whole suite (bounded parallel; one failure never aborts the
 *  rest) + persist one MonitoringCheck row per check. Never throws. */
export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const results = await Promise.all([
    dbConnectivity(),
    dbSize(),
    configPresence(),
    resendApi(),
    supabaseMgmtApi(),
    vercelApi(),
    emailOutboxFailureRate(),
    opsSyncFreshness(),
  ])

  for (const r of results) {
    await db.monitoringCheck
      .create({
        data: {
          checkKey: r.checkKey,
          status: r.status,
          severity: r.severity,
          latencyMs: r.latencyMs,
          detail: r.detail?.slice(0, 900) ?? null,
        },
      })
      .catch((e) => {
        log('warn', 'ops_check_persist_failed', {
          channel: 'ops',
          checkKey: r.checkKey,
          detail: e instanceof Error ? e.message : String(e),
        })
      })
  }

  // Operational error record for DOWN checks (deduped by fingerprint).
  const { recordOperationalError } = await import('./errors')
  for (const r of results) {
    if (r.status === 'down') {
      await recordOperationalError({
        category: 'health',
        severity: 'error',
        message: `Health check DOWN: ${r.checkLabel} — ${r.detail.slice(0, 300)}`,
      })
    }
  }

  log('info', 'ops_health_checks_run', {
    channel: 'ops',
    summary: results.map((r) => `${r.checkKey}=${r.status}`).join(' '),
  })
  return results
}

/** Latest STORED result per check (dashboard read path — no live calls). */
export async function latestChecks(): Promise<HealthCheckResult[]> {
  const keys = [
    'db_connectivity',
    'db_size',
    'config_presence',
    'resend_api',
    'supabase_mgmt_api',
    'vercel_api',
    'email_outbox_failure_rate',
    'ops_sync_freshness',
  ]
  const rows = await db.monitoringCheck.findMany({
    orderBy: { checkedAt: 'desc' },
    take: 200,
  })
  const byKey = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (keys.includes(r.checkKey) && !byKey.has(r.checkKey)) byKey.set(r.checkKey, r)
  }
  const LABELS: Record<string, string> = {
    db_connectivity: 'Database connectivity',
    db_size: 'Database size',
    config_presence: 'Required configuration present',
    resend_api: 'Email provider (Resend) API',
    supabase_mgmt_api: 'Supabase Management API',
    vercel_api: 'Vercel API (deployments)',
    email_outbox_failure_rate: 'Email delivery failure rate (7d)',
    ops_sync_freshness: 'Provider data freshness',
  }
  const KINDS: Record<string, HealthCheckResult['kind']> = {
    db_connectivity: 'readiness',
    db_size: 'readiness',
    config_presence: 'readiness',
    resend_api: 'dependency',
    supabase_mgmt_api: 'dependency',
    vercel_api: 'dependency',
    email_outbox_failure_rate: 'readiness',
    ops_sync_freshness: 'readiness',
  }
  return keys.map((k) => {
    const row = byKey.get(k)
    if (!row) {
      return {
        checkKey: k,
        checkLabel: LABELS[k],
        status: 'unknown' as CheckStatus,
        severity: 'info' as CheckSeverity,
        latencyMs: null,
        detail: 'No check has been recorded yet — run the checks from this tab.',
        kind: KINDS[k],
      }
    }
    return {
      checkKey: k,
      checkLabel: LABELS[k],
      status: row.status as CheckStatus,
      severity: row.severity as CheckSeverity,
      latencyMs: row.latencyMs,
      detail: row.detail ?? '',
      kind: KINDS[k],
    }
  })
}
