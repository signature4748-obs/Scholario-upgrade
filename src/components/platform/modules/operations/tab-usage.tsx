'use client'

// ============================================================
// Platform Operations — Usage & Limits tab
// ------------------------------------------------------------
// Provider metrics from STORED snapshots (grouped by provider), the
// sync-run history, and manual Sync now. Every metric shows: value,
// unit, limit (or the honest "not reported" state), % consumed,
// collected-at + staleness, and source. Estimated-cost row: explicitly
// NOT shown (no billing API — stated honestly in the footer).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Database, Mail, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../../platform-client'
import {
  OPS_CARD,
  FreshnessBadge,
  OpsErrorState,
  OpsEmptyState,
  StateBadge,
  UnavailableNotice,
  formatBytes,
  formatNumber,
  formatPercent,
  timeAgo,
} from './shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
} from 'recharts'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } as const

interface MetricRow {
  provider: string
  scope: string
  scopeLabel: string
  metric: string
  metricLabel: string
  value: number
  unit: string
  limitValue: number | null
  measured: boolean
  availability: 'ok' | 'unavailable'
  collectedAt: string
  meta: Record<string, unknown> | null
  percentConsumed: number | null
  remaining: number | null
  stale: boolean
  ageMinutes: number
  history: Array<{ collectedAt: string; value: number }>
  unavailableReason: string | null
}

interface UsageData {
  metrics: MetricRow[]
  syncRuns: Array<{
    id: string
    provider: string
    trigger: string
    status: string
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    metricsWritten: number
    metricsUnavailable: number
    error: string | null
  }>
  lastSuccess: Record<string, { startedAt: string; status: string }>
  staleThresholdMinutes: number
  staleCount: number
  refreshScheduled: string[]
  costStatement: string
}

const PROVIDER_META: Record<string, { label: string; icon: React.ReactNode; dashboard: string }> = {
  vercel: { label: 'Vercel', icon: <Cloud className="h-4 w-4" />, dashboard: 'https://vercel.com/usage' },
  supabase: {
    label: 'Supabase',
    icon: <Database className="h-4 w-4" />,
    dashboard: 'https://supabase.com/dashboard/project/_/settings/usage',
  },
  resend: { label: 'Resend', icon: <Mail className="h-4 w-4" />, dashboard: 'https://resend.com/usage' },
}

function formatValue(m: MetricRow): string {
  if (m.unit === 'bytes') return formatBytes(m.value)
  if (m.unit === 'percent') return formatPercent(m.value)
  return formatNumber(m.value)
}

function MetricCard({ m }: { m: MetricRow }) {
  const hasHistory = m.history.length >= 2
  const chartData = m.history.map((h) => ({
    t: new Date(h.collectedAt).getTime(),
    v: h.value,
  }))
  return (
    <motion.div {...fadeUp} className={`${OPS_CARD} flex flex-col`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{m.metricLabel}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{m.scopeLabel}</p>
        </div>
        <FreshnessBadge stale={m.stale} ageMinutes={m.ageMinutes} />
      </div>

      <p className="mt-3 font-display text-2xl font-bold tabular-nums text-slate-900">
        {formatValue(m)}
        {m.limitValue !== null && m.limitValue > 0 && (
          <span className="ml-1 text-sm font-medium text-slate-400">
            / {m.unit === 'bytes' ? formatBytes(m.limitValue) : formatNumber(m.limitValue)}
          </span>
        )}
      </p>

      {m.limitValue !== null && m.limitValue > 0 && m.percentConsumed !== null ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${
                m.percentConsumed >= 95
                  ? 'bg-red-500'
                  : m.percentConsumed >= 85
                    ? 'bg-orange-500'
                    : m.percentConsumed >= 70
                      ? 'bg-amber-500'
                      : 'bg-teal-500'
              }`}
              style={{ width: `${Math.min(100, m.percentConsumed)}%` }}
              role="progressbar"
              aria-valuenow={m.percentConsumed}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
            <span>{formatPercent(m.percentConsumed)} consumed</span>
            <span>
              {m.unit === 'bytes' ? formatBytes(Math.max(0, m.remaining ?? 0)) : formatNumber(Math.max(0, m.remaining ?? 0))} remaining
            </span>
          </div>
        </>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">Limit not reported by the provider API</span>
        </div>
      )}

      {m.unit === 'bytes' && m.metric.includes('db_size') && hasHistory && (
        <div className="mt-3 h-16 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="opsArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
              <YAxis hide domain={['auto', 'auto']} />
              <ChartTooltip
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                formatter={(v) => [formatBytes(Number(v)), m.metricLabel]}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Area dataKey="v" stroke="#0f766e" strokeWidth={1.5} fill="url(#opsArea)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
        <span>
          {m.measured ? 'Measured' : 'Estimate (operator-configured)'} · collected {timeAgo(m.collectedAt)}
        </span>
        {m.meta && typeof m.meta.source === 'string' && <span className="min-w-0 truncate" title={m.meta.source}>{m.meta.source}</span>}
      </div>
    </motion.div>
  )
}

export function UsageTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<UsageData>('/api/platform/operations/usage')
      setData(d)
    } catch (e) {
      setError((e as PlatformApiError).error || 'Failed to load usage data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const syncNow = useCallback(async () => {
    setSyncing(true)
    try {
      const r = await platformApi<{ statuses: Record<string, string>; note: string }>(
        '/api/platform/operations/usage/sync',
        { method: 'POST', body: JSON.stringify({}) },
      )
      const summary = Object.entries(r.statuses)
        .map(([p, s]) => `${p}: ${s}`)
        .join(' · ')
      toast.success(`Provider sync finished — ${summary}`)
      await load()
    } catch (e) {
      toast.error((e as PlatformApiError).error || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [load])

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={OPS_CARD}>
              <Skeleton className="h-4 w-32 bg-slate-200" />
              <Skeleton className="mt-3 h-8 w-24 bg-slate-200" />
              <Skeleton className="mt-3 h-1.5 w-full bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (error) return <OpsErrorState message={error} onRetry={() => void load()} retrying={loading} />
  if (!data) return null

  const byProvider = new Map<string, MetricRow[]>()
  for (const m of data.metrics) {
    const list = byProvider.get(m.provider) ?? []
    list.push(m)
    byProvider.set(m.provider, list)
  }

  return (
    <div className="space-y-6">
      <div className={`${OPS_CARD} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Provider synchronization</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Data is read from stored snapshots (cached provider responses). {data.staleCount > 0
              ? `${data.staleCount} metric(s) are beyond the ${data.staleThresholdMinutes}-minute freshness threshold.`
              : `All metrics within the ${data.staleThresholdMinutes}-minute freshness threshold.`}
            {data.refreshScheduled.length > 0 && ' A background refresh for stale providers was scheduled by this read.'}
          </p>
        </div>
        <Button onClick={() => void syncNow()} disabled={syncing} className="bg-teal-600 text-white hover:bg-teal-700">
          <Zap className={`mr-2 h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} aria-hidden="true" />
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>

      {['vercel', 'supabase', 'resend'].map((provider) => {
        const meta = PROVIDER_META[provider]
        const rows = byProvider.get(provider) ?? []
        const available = rows.filter((m) => m.availability === 'ok')
        const unavailable = rows.filter((m) => m.availability === 'unavailable')
        const last = data.lastSuccess[provider]
        return (
          <section key={provider} aria-labelledby={`ops-provider-${provider}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id={`ops-provider-${provider}`} className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700">{meta.icon}</span>
                {meta.label}
              </h2>
              <span className="text-[10px] text-slate-400">
                {last ? `Last successful sync ${timeAgo(last.startedAt)} (${last.status})` : 'Never synced'}
              </span>
            </div>

            {available.length === 0 && unavailable.length === 0 ? (
              <OpsEmptyState
                title={`No ${meta.label} data collected yet`}
                hint='Use "Sync now" (or wait for the scheduled cron) — the first collection stores the baseline snapshot.'
              />
            ) : (
              <div className="space-y-3">
                {available.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {available.map((m) => (
                      <MetricCard key={`${m.scope}-${m.metric}`} m={m} />
                    ))}
                  </div>
                )}
                {unavailable.map((m) => (
                  <UnavailableNotice
                    key={`${m.scope}-${m.metric}`}
                    reason={m.unavailableReason}
                    detail={typeof m.meta?.detail === 'string' ? (m.meta.detail as string) : undefined}
                    metricLabel={m.metricLabel}
                    dashboardUrl={meta.dashboard}
                    dashboardLabel={`Open ${meta.label} usage dashboard`}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}

      <section aria-labelledby="ops-sync-runs">
        <h2 id="ops-sync-runs" className="mb-3 text-base font-semibold text-slate-900">
          Synchronization history
        </h2>
        <div className={`${OPS_CARD} overflow-x-auto`}>
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Trigger</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Started</th>
                <th className="py-2 pr-3 font-medium">Duration</th>
                <th className="py-2 pr-3 font-medium">Written / unavailable</th>
                <th className="py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.syncRuns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-500">
                    No sync runs recorded yet.
                  </td>
                </tr>
              ) : (
                data.syncRuns.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-700">{r.provider}</td>
                    <td className="py-2 pr-3 text-slate-500">{r.trigger}</td>
                    <td className="py-2 pr-3">
                      <StateBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{timeAgo(r.startedAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-500">
                      {r.durationMs != null ? `${r.durationMs} ms` : '—'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-500">
                      {r.metricsWritten} / {r.metricsUnavailable}
                    </td>
                    <td className="max-w-[280px] truncate py-2 text-red-600" title={r.error ?? undefined}>
                      {r.error ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{data.costStatement}</p>
      </section>
    </div>
  )
}
