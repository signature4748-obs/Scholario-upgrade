'use client'

// ============================================================
// Platform Operations — Overview tab
// ------------------------------------------------------------
// REAL platform status. Every tile shows: what the metric means, its
// source, its observation time, and a drill-down action. States:
// healthy / degraded / unavailable / warning / unknown — a missing
// metric NEVER renders as zero or healthy.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  Globe2,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../../platform-client'
import {
  OPS_CARD,
  CheckStatusBadge,
  FreshnessBadge,
  OpsErrorState,
  OpsSkeletonGrid,
  StateBadge,
  formatNumber,
  formatPercent,
  timeAgo,
} from './shared'
import { Button } from '@/components/ui/button'

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const

export interface OpsOverviewData {
  schools: { total: number; active: number; suspended: number; pending: number; trial: number }
  sessions: { platform: number; school: number }
  security: { platformAuthFailures7d: number }
  health: {
    db: { status: string; latencyMs: number | null; checkedAt: string | null }
    checks: Array<{
      checkKey: string
      status: string
      severity: string
      latencyMs: number | null
      detail: string
      checkedAt: string
    }>
    lastCheckedAt: string | null
  }
  errors: {
    unresolved: Array<{
      id: string
      fingerprint: string
      category: string
      severity: string
      status: string
      message: string
      lastSeenAt: string
      occurrences: number
    }>
  }
  email: {
    last7d: Record<string, number>
    failedTotal: number
    distinctionNote: string
  }
  usage: {
    headline: Array<{
      provider: string
      metric: string
      metricLabel: string
      value: number
      unit: string
      limitValue: number
      percentConsumed: number
      collectedAt: string
      stale: boolean
    }>
    syncAgesMinutes: Record<string, number | null>
    staleThresholdMinutes: number
    providerStale: Record<string, boolean>
  }
  deployments: Array<{
    project: string
    scope: string
    collectedAt: string
    list: Array<{
      deploymentId: string
      state: string
      createdAt: string | null
      commitSha: string | null
      commitMessage: string | null
      url: string | null
    }>
  }>
  alerts: Array<{
    id: string
    type: string
    severity: string
    status: string
    metricLabel: string
    message: string
    lastSeenAt: string
    observedValue: number
    unit: string
  }>
  recentAudit: Array<{ id: string; action: string; at: string; schoolId: string | null }>
  generatedAt: string
}

function Tile({
  label,
  value,
  icon,
  source,
  observedAt,
  drillHref,
  drillLabel,
  valueClass,
  children,
}: {
  label: string
  value: string
  icon: React.ReactNode
  source: string
  observedAt?: string
  drillHref?: string
  drillLabel?: string
  valueClass?: string
  children?: React.ReactNode
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${valueClass ?? 'text-slate-900'}`}>{value}</p>
      {children && <div className="mt-2 text-xs text-slate-500">{children}</div>}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
        <span className="min-w-0 truncate" title={source}>
          Source: {source}
        </span>
        <span className="shrink-0 whitespace-nowrap">{observedAt ? `Observed ${timeAgo(observedAt)}` : 'Live read'}</span>
      </div>
    </>
  )
  if (drillHref) {
    return (
      <motion.div {...fadeUp}>
        <Link
          href={drillHref}
          className={`${OPS_CARD} group block transition-colors hover:border-teal-300 focus-ring`}
          aria-label={`${label}: ${value}${drillLabel ? ` — ${drillLabel}` : ''}`}
        >
          {body}
          <ArrowRight className="mt-1 h-3 w-3 text-slate-300 transition-colors group-hover:text-teal-600" aria-hidden="true" />
        </Link>
      </motion.div>
    )
  }
  return (
    <motion.div {...fadeUp} className={OPS_CARD}>
      {body}
    </motion.div>
  )
}

function deploymentsToTiles(data: OpsOverviewData) {
  const out: React.ReactNode[] = []
  for (const dep of data.deployments) {
    const latest = dep.list[0]
    if (!latest) continue
    const failed = dep.list.find((d) => d.state === 'ERROR')
    out.push(
      <motion.div key={dep.scope} {...fadeUp} className={OPS_CARD}>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500">{dep.project}</p>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
            <Globe2 className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StateBadge status={latest.state} />
          <p className="truncate font-mono text-xs text-slate-500">
            {latest.commitSha ? latest.commitSha.slice(0, 8) : '—'}
          </p>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {latest.createdAt ? timeAgo(latest.createdAt) : '—'}
          {failed ? (
            <span className="ml-2 inline-flex items-center gap-1 text-red-600">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> recent failure logged
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400">
          <span>Source: Vercel deployments API (cached {timeAgo(dep.collectedAt)})</span>
          {latest.url && (
            <a href={latest.url} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-teal-700 underline underline-offset-2">
              Open
            </a>
          )}
        </div>
      </motion.div>,
    )
  }
  return out
}

export function OverviewTab({ refreshKey, onRefreshed }: { refreshKey: number; onRefreshed?: () => void }) {
  const [data, setData] = useState<OpsOverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<OpsOverviewData>('/api/platform/operations/overview')
      setData(d)
    } catch (e) {
      setError((e as PlatformApiError).error || 'Failed to load platform overview')
    } finally {
      setLoading(false)
      onRefreshed?.()
    }
  }, [onRefreshed])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (loading && !data) return <OpsSkeletonGrid count={8} />
  if (error) return <OpsErrorState message={error} onRetry={() => void load()} retrying={loading} />
  if (!data) return null

  const emailFailed = data.email.failedTotal
  const emailSentTotal = Object.values(data.email.last7d).reduce((a, b) => a + b, 0)
  const dbStatus = data.health.db.status
  const lastSuccessSync = Object.entries(data.usage.syncAgesMinutes)

  return (
    <div className="space-y-6">
      {/* Freshness banner */}
      <div className={`${OPS_CARD} flex flex-wrap items-center gap-x-6 gap-y-2`}>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>Generated {timeAgo(data.generatedAt)} · read from stored data (no provider APIs on this path)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSuccessSync.map(([provider, age]) => (
            <span key={provider} className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{provider}</span>
              <FreshnessBadge stale={data.usage.providerStale[provider] ?? true} ageMinutes={age} />
            </span>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="ml-auto border-slate-300 text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Row 1 — tenant + identity KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Schools under management"
          value={formatNumber(data.schools.total)}
          icon={<Building2 className="h-4 w-4" />}
          source="School table (group by status)"
          drillHref="/platform/schools"
          drillLabel="open the schools directory"
        >
          {formatNumber(data.schools.active)} active · {formatNumber(data.schools.suspended)} suspended ·{' '}
          {formatNumber(data.schools.pending)} pending
        </Tile>
        <Tile
          label="Active schools"
          value={formatNumber(data.schools.active)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          source="School table (status=ACTIVE)"
          valueClass="text-emerald-700"
          drillHref="/platform/schools"
        >
          Tenants with the full ERP surface available
        </Tile>
        <Tile
          label="Suspended schools"
          value={formatNumber(data.schools.suspended)}
          icon={<Building2 className="h-4 w-4" />}
          source="School table (status=SUSPENDED)"
          valueClass={data.schools.suspended > 0 ? 'text-amber-700' : 'text-slate-900'}
          drillHref="/platform/schools"
        >
          Login still allowed; ERP locked with the suspension message
        </Tile>
        <Tile
          label="Live sessions"
          value={formatNumber(data.sessions.school + data.sessions.platform)}
          icon={<MonitorSmartphone className="h-4 w-4" />}
          source="Session tables (school + platform, unexpired)"
        >
          {formatNumber(data.sessions.platform)} platform · {formatNumber(data.sessions.school)} school
        </Tile>
      </div>

      {/* Row 2 — health + security + errors + email */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Database connectivity"
          value={dbStatus === 'healthy' ? 'Healthy' : dbStatus === 'unknown' ? 'Unknown' : dbStatus.charAt(0).toUpperCase() + dbStatus.slice(1)}
          icon={<Database className="h-4 w-4" />}
          source="MonitoringCheck db_connectivity (SELECT 1)"
          observedAt={data.health.db.checkedAt ?? undefined}
          valueClass={dbStatus === 'healthy' ? 'text-emerald-700' : dbStatus === 'down' ? 'text-red-700' : 'text-amber-700'}
        >
          {data.health.db.latencyMs != null ? `${data.health.db.latencyMs} ms round-trip · ` : ''}
          <Link href="/platform/operations?tab=health" className="font-medium text-teal-700 underline underline-offset-2">
            run checks
          </Link>
        </Tile>
        <Tile
          label="Platform auth failures (7d)"
          value={formatNumber(data.security.platformAuthFailures7d)}
          icon={<ShieldAlert className="h-4 w-4" />}
          source="PlatformAuditLog (platform.login.failed / locked / step_up.failed)"
          valueClass={data.security.platformAuthFailures7d > 0 ? 'text-amber-700' : 'text-slate-900'}
          drillHref="/platform/audit"
          drillLabel="open the audit log"
        >
          Failed platform sign-ins + lockouts in the last 7 days
        </Tile>
        <Tile
          label="Unresolved incidents"
          value={formatNumber(data.errors.unresolved.length)}
          icon={<AlertTriangle className="h-4 w-4" />}
          source="OperationalError (status ≠ resolved, newest 6 shown)"
          valueClass={data.errors.unresolved.length > 0 ? 'text-red-700' : 'text-emerald-700'}
          drillHref="/platform/operations?tab=errors"
          drillLabel="open Errors & Incidents"
        >
          {data.errors.unresolved.length > 0
            ? `Top: ${data.errors.unresolved[0].message.slice(0, 60)}…`
            : 'No open operational errors recorded'}
        </Tile>
        <Tile
          label="Email failures (7d)"
          value={formatNumber(emailFailed)}
          icon={<Mail className="h-4 w-4" />}
          source="EmailDelivery outbox (7-day window)"
          valueClass={emailFailed > 0 ? 'text-red-700' : 'text-slate-900'}
          drillHref="/platform/operations?tab=errors"
          drillLabel="diagnose email failures"
        >
          {formatNumber(data.email.last7d['SENT'] ?? 0)} delivered (evidence) ·{' '}
          {formatNumber(data.email.last7d['QUEUED'] ?? 0)} accepted-unconfirmed · {formatNumber(emailSentTotal)} total
        </Tile>
      </div>

      {/* Row 3 — deployments + usage headline */}
      {data.deployments.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Latest production deployments</h2>
            <span className="text-[10px] text-slate-400">
              Source: Vercel deployments API · collected during provider sync
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{deploymentsToTiles(data)}</div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Usage vs reported limits</h2>
          <Link href="/platform/operations?tab=usage" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800">
            Usage & Limits <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        {data.usage.headline.length === 0 ? (
          <div className={`${OPS_CARD} text-xs text-slate-500`}>
            No metric with a provider-reported limit is currently available. Provider usage metrics that the connected
            APIs/plans do not expose are shown honestly as unavailable on the Usage tab — never as zero.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.usage.headline.slice(0, 6).map((m) => (
              <motion.div key={`${m.provider}-${m.metric}`} {...fadeUp} className={OPS_CARD}>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500">
                    {m.metricLabel}
                  </p>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900">
                  {formatPercent(m.percentConsumed)}
                </p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      m.percentConsumed >= 95 ? 'bg-red-500' : m.percentConsumed >= 85 ? 'bg-orange-500' : m.percentConsumed >= 70 ? 'bg-amber-500' : 'bg-teal-500'
                    }`}
                    style={{ width: `${Math.min(100, m.percentConsumed)}%` }}
                    role="progressbar"
                    aria-valuenow={m.percentConsumed}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>
                    {formatNumber(m.value)} / {formatNumber(m.limitValue)} {m.unit}
                  </span>
                  <FreshnessBadge stale={m.stale} />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Row 4 — open alerts + unresolved errors preview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Open alerts</h2>
            <Link href="/platform/operations?tab=overview" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800">
              Manage <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {data.alerts.length === 0 ? (
            <div className={`${OPS_CARD} text-xs text-slate-500`}>
              No open alerts. Threshold breaches, stale sync, email failure-rate and error-burst alerts appear here.
            </div>
          ) : (
            <ul className="space-y-2">
              {data.alerts.map((a) => (
                <li key={a.id} className={`${OPS_CARD} !p-4`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        a.severity === 'critical' ? 'text-red-700' : a.severity === 'high' ? 'text-orange-700' : 'text-amber-700'
                      }`}
                    >
                      {a.metricLabel}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">{timeAgo(a.lastSeenAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Unresolved errors</h2>
            <Link href="/platform/operations?tab=errors" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800">
              Investigate <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {data.errors.unresolved.length === 0 ? (
            <div className={`${OPS_CARD} text-xs text-slate-500`}>
              No unresolved operational errors. 5xx responses, cross-tenant denials and provider failures are grouped here
              with occurrence history.
            </div>
          ) : (
            <ul className="space-y-2">
              {data.errors.unresolved.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/platform/operations?tab=errors&fp=${encodeURIComponent(e.fingerprint)}`}
                    className={`${OPS_CARD} !p-4 block transition-colors hover:border-teal-300 focus-ring`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          e.severity === 'critical'
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : e.severity === 'error'
                              ? 'border-red-200 bg-red-50 text-red-600'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {e.severity}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">{e.category}</span>
                      <span className="text-[10px] text-slate-500">×{formatNumber(e.occurrences)}</span>
                      <StateBadge status={e.status} />
                      <span className="ml-auto text-[10px] text-slate-400">{timeAgo(e.lastSeenAt)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-700 break-words">{e.message}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Health check strip */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Latest dependency checks</h2>
          <Link href="/platform/operations?tab=health" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800">
            Service Health <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.health.checks.length === 0 ? (
            <span className="text-xs text-slate-500">No checks recorded yet — run them from the Service Health tab.</span>
          ) : (
            data.health.checks.map((c) => (
              <span key={c.checkKey} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                <CheckStatusBadge status={c.status} />
                <span className="text-xs text-slate-600">{c.checkKey}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
