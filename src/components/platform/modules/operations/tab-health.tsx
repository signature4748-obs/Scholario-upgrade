'use client'

// ============================================================
// Platform Operations — Service Health tab
// ------------------------------------------------------------
// Liveness/readiness/dependency split, latest stored checks per key,
// run-now action, history, and alert management (ack/resolve + the
// threshold settings editor — every change audited server-side).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Bell, GaugeCircle, HeartPulse, Save, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../../platform-client'
import {
  OPS_CARD,
  CheckStatusBadge,
  OpsEmptyState,
  OpsErrorState,
  SeverityBadge,
  StateBadge,
  formatNumber,
  formatPercent,
  timeAgo,
} from './shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } as const

interface CheckRow {
  checkKey: string
  checkLabel: string
  status: string
  severity: string
  latencyMs: number | null
  detail: string
  kind: 'liveness' | 'readiness' | 'dependency'
  drilldownHint?: string
}

interface HealthData {
  checks: CheckRow[]
  history: Array<{ checkKey: string; status: string; severity: string; latencyMs: number | null; checkedAt: string }>
  liveness: { endpoint: string; note: string }
  readiness: { endpoint: string; note: string }
}

interface AlertRow {
  id: string
  fingerprint: string
  type: string
  severity: string
  status: string
  metricLabel: string
  observedValue: number
  threshold: number | null
  unit: string
  message: string
  firstSeenAt: string
  lastSeenAt: string
  occurrences: number
  resolutionNote: string | null
}

interface AlertsData {
  alerts: AlertRow[]
  statusCounts: Record<string, number>
  notificationNote: string
}

const KIND_LABELS: Record<string, string> = {
  liveness: 'Liveness',
  readiness: 'Readiness',
  dependency: 'Dependency health',
}

export function HealthTab({ refreshKey }: { refreshKey: number }) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [alerts, setAlerts] = useState<AlertsData | null>(null)
  const [settings, setSettings] = useState<Record<string, number> | null>(null)
  const [settingsDefaults, setSettingsDefaults] = useState<Record<string, number> | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, a, s] = await Promise.all([
        platformApi<HealthData>('/api/platform/operations/health'),
        platformApi<AlertsData>('/api/platform/operations/alerts?status=all'),
        platformApi<{ settings: Record<string, number>; defaults: Record<string, number> }>(
          '/api/platform/operations/alerts/settings',
        ),
      ])
      setHealth(h)
      setAlerts(a)
      setSettings(s.settings)
      setSettingsDefaults(s.defaults)
      setSettingsDraft(Object.fromEntries(Object.entries(s.settings).map(([k, v]) => [k, String(v)])))
    } catch (e) {
      setError((e as PlatformApiError).error || 'Failed to load service health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const runChecks = useCallback(async () => {
    setRunning(true)
    try {
      const r = await platformApi<{ summary: { healthy: number; degraded: number; down: number; unknown: number } }>(
        '/api/platform/operations/health/run',
        { method: 'POST', body: JSON.stringify({}) },
      )
      toast.success(
        `Checks finished — ${r.summary.healthy} healthy · ${r.summary.degraded} degraded · ${r.summary.down} down · ${r.summary.unknown} unknown/not configured`,
      )
      await load()
    } catch (e) {
      toast.error((e as PlatformApiError).error || 'Health checks failed to run')
    } finally {
      setRunning(false)
    }
  }, [load])

  const saveSettings = useCallback(async () => {
    if (!settings) return
    setSaving(true)
    try {
      const changed: Record<string, number> = {}
      for (const [k, v] of Object.entries(settingsDraft)) {
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`Invalid value for ${k}`)
          setSaving(false)
          return
        }
        if (settings[k] !== n) changed[k] = n
      }
      if (Object.keys(changed).length === 0) {
        toast.info('No threshold changes to save')
        setSaving(false)
        return
      }
      await platformApi('/api/platform/operations/alerts/settings', {
        method: 'PUT',
        body: JSON.stringify(changed),
      })
      toast.success(`Saved ${Object.keys(changed).length} threshold change(s) — audited`)
      await load()
    } catch (e) {
      toast.error((e as PlatformApiError).error || 'Failed to save thresholds')
    } finally {
      setSaving(false)
    }
  }, [settings, settingsDraft, load])

  const alertAct = useCallback(
    async (id: string, kind: 'ack' | 'resolve') => {
      const note = noteDraft[id] ?? ''
      if (kind === 'resolve' && note.trim().length < 3) {
        toast.error('A resolution note is required (min 3 characters)')
        return
      }
      setActing(id)
      try {
        await platformApi(`/api/platform/operations/alerts/${id}/${kind}`, {
          method: 'POST',
          body: JSON.stringify(kind === 'resolve' ? { note } : {}),
        })
        toast.success(kind === 'ack' ? 'Alert acknowledged' : 'Alert resolved (audited)')
        setNoteDraft((d) => ({ ...d, [id]: '' }))
        await load()
      } catch (e) {
        toast.error((e as PlatformApiError).error || `Failed to ${kind} alert`)
      } finally {
        setActing(null)
      }
    },
    [noteDraft, load],
  )

  if (loading && !health) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={OPS_CARD}>
            <Skeleton className="h-4 w-40 bg-slate-200" />
            <Skeleton className="mt-2 h-3 w-64 bg-slate-200" />
          </div>
        ))}
      </div>
    )
  }
  if (error) return <OpsErrorState message={error} onRetry={() => void load()} retrying={loading} />
  if (!health || !alerts) return null

  const byKind = (kind: CheckRow['kind']) => health.checks.filter((c) => c.kind === kind)

  const renderCheck = (c: CheckRow) => (
    <motion.div key={c.checkKey} {...fadeUp} className={`${OPS_CARD} !p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <CheckStatusBadge status={c.status} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{c.checkLabel}</p>
        {c.latencyMs !== null && <span className="tabular-nums text-[10px] text-slate-400">{c.latencyMs} ms</span>}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-600 break-words">{c.detail}</p>
      {c.drilldownHint && (
        <p className="mt-1 text-[10px] text-slate-400">Drill-down: {c.drilldownHint}</p>
      )}
    </motion.div>
  )

  return (
    <div className="space-y-6">
      <div className={`${OPS_CARD} flex flex-wrap items-center gap-3`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Dependency & readiness checks</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Showing the latest STORED results. Run the suite to probe live now — each check is timeout-bounded and one
            failure never aborts the others.
          </p>
        </div>
        <Button onClick={() => void runChecks()} disabled={running} className="bg-teal-600 text-white hover:bg-teal-700">
          <Activity className={`mr-2 h-4 w-4 ${running ? 'animate-pulse' : ''}`} aria-hidden="true" />
          {running ? 'Running…' : 'Run checks now'}
        </Button>
      </div>

      <section aria-labelledby="ops-h-liveness">
        <h2 id="ops-h-liveness" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
          <HeartPulse className="h-4 w-4 text-teal-600" aria-hidden="true" /> Liveness
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {['live', 'ready'].map((ep) => (
            <div key={ep} className={`${OPS_CARD} !p-4`}>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs font-semibold text-slate-700">GET /health/{ep}</p>
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  exists — unchanged
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {ep === 'live' ? health.liveness.note : health.readiness.note}
              </p>
            </div>
          ))}
        </div>
      </section>

      {(['readiness', 'dependency'] as const).map((kind) => (
        <section key={kind} aria-labelledby={`ops-h-${kind}`}>
          <h2 id={`ops-h-${kind}`} className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <GaugeCircle className="h-4 w-4 text-teal-600" aria-hidden="true" /> {KIND_LABELS[kind]}
          </h2>
          {byKind(kind).length === 0 ? (
            <OpsEmptyState title="No checks in this group" />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{byKind(kind).map(renderCheck)}</div>
          )}
        </section>
      ))}

      {/* History */}
      <section aria-labelledby="ops-h-history">
        <h2 id="ops-h-history" className="mb-3 text-base font-semibold text-slate-900">
          Recent check history
        </h2>
        <div className={`${OPS_CARD} max-h-64 overflow-y-auto custom-scrollbar`}>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-medium">Check</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Latency</th>
                <th className="py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {health.history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-500">
                    No check has been recorded yet.
                  </td>
                </tr>
              ) : (
                health.history.map((h, i) => (
                  <tr key={`${h.checkKey}-${h.checkedAt}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-slate-600">{h.checkKey}</td>
                    <td className="py-1.5 pr-3">
                      <CheckStatusBadge status={h.status} />
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-500">
                      {h.latencyMs != null ? `${h.latencyMs} ms` : '—'}
                    </td>
                    <td className="py-1.5 text-slate-500">{timeAgo(h.checkedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Alerts */}
      <section aria-labelledby="ops-h-alerts">
        <h2 id="ops-h-alerts" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bell className="h-4 w-4 text-teal-600" aria-hidden="true" /> Alerts
          <span className="ml-2 text-xs font-normal text-slate-500">
            {formatNumber(alerts.statusCounts.open ?? 0)} open · {formatNumber(alerts.statusCounts.acknowledged ?? 0)} acknowledged ·{' '}
            {formatNumber(alerts.statusCounts.resolved ?? 0)} resolved
          </span>
        </h2>
        <p className="mb-2 text-[11px] text-slate-400">{alerts.notificationNote}</p>
        {alerts.alerts.length === 0 ? (
          <OpsEmptyState
            title="No alerts recorded"
            hint="Alerts open automatically from threshold breaches, stale provider sync, email failure rates and error bursts — deduplicated per metric, cooldown-controlled."
          />
        ) : (
          <ul className="space-y-2">
            {alerts.alerts.map((a) => (
              <li key={a.id} className={`${OPS_CARD} !p-4`}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <StateBadge status={a.status} />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{a.metricLabel}</p>
                  <span className="tabular-nums text-[10px] text-slate-400">
                    {formatNumber(a.occurrences)}× · last {timeAgo(a.lastSeenAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 break-words">{a.message}</p>
                {a.status !== 'resolved' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={noteDraft[a.id] ?? ''}
                      onChange={(e) => setNoteDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                      placeholder="Resolution note (required to resolve)"
                      className="h-8 min-w-56 flex-1 border-slate-200 bg-white text-xs"
                      aria-label={`Resolution note for ${a.metricLabel}`}
                    />
                    {a.status !== 'acknowledged' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acting === a.id}
                        onClick={() => void alertAct(a.id, 'ack')}
                        className="h-8 border-amber-200 bg-amber-50 text-xs text-amber-700 hover:bg-amber-100"
                      >
                        Acknowledge
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={acting === a.id}
                      onClick={() => void alertAct(a.id, 'resolve')}
                      className="h-8 bg-teal-600 text-xs text-white hover:bg-teal-700"
                    >
                      Resolve
                    </Button>
                  </div>
                ) : (
                  a.resolutionNote && (
                    <p className="mt-1 text-[11px] text-slate-400">Resolved — “{a.resolutionNote}”</p>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Threshold settings */}
      {settings && settingsDefaults && (
        <section aria-labelledby="ops-h-settings">
          <h2 id="ops-h-settings" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <Settings2 className="h-4 w-4 text-teal-600" aria-hidden="true" /> Alert thresholds
          </h2>
          <div className={`${OPS_CARD} space-y-3`}>
            <p className="text-xs text-slate-500">
              Defaults are documented in code; every change here is persisted to the settings table and audited with the
              before/after diff. Unknown or invalid values fall back to the default.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(settingsDefaults).map((k) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400" title={k}>
                    {k}
                  </span>
                  <Input
                    value={settingsDraft[k] ?? ''}
                    onChange={(e) => setSettingsDraft((d) => ({ ...d, [k]: e.target.value }))}
                    inputMode="numeric"
                    className="h-8 border-slate-200 bg-white text-xs tabular-nums"
                    aria-label={`Threshold ${k}`}
                  />
                  <span className="text-[10px] text-slate-400">
                    default {formatNumber(settingsDefaults[k])}
                    {k === 'db_size.warning_bytes' && ' (bytes — operator ESTIMATE, provider quota not exposed)'}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void saveSettings()} disabled={saving} className="bg-teal-600 text-white hover:bg-teal-700">
                <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {saving ? 'Saving…' : 'Save thresholds'}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Usage percentages: {formatPercent(null)} means the limit is not reported — such metrics never breach and never
            show a fabricated percentage.
          </p>
        </section>
      )}
    </div>
  )
}
