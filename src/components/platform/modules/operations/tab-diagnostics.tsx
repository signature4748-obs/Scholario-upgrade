'use client'

// ============================================================
// Platform Operations — Audit & Diagnostics tab
// ------------------------------------------------------------
// Monitoring-coverage report (instrumented / partial / not
// instrumented, with the specific mechanism), ops action history from
// the platform audit trail, retention state + manual cleanup, and the
// honest known-gaps list.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Circle, CircleSlash, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../../platform-client'
import { OPS_CARD, OpsErrorState, formatNumber, timeAgo } from './shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } as const

interface CoverageEntry {
  path: string
  state: 'instrumented' | 'partial' | 'not-instrumented'
  mechanism: string
  gap?: string
}

interface DiagnosticsData {
  coverage: { entries: CoverageEntry[]; summary: { instrumented: number; partial: number; notInstrumented: number } }
  opsAudit: {
    total: number
    recent: Array<{ id: string; action: string; at: string; reason: string | null; target: string | null }>
    note: string
  }
  retention: {
    snapshotRetentionDays: number
    errorEventRetentionDays: number
    monitoringCheckRetentionDays: number
    currentRows: { snapshots: number; errorEvents: number; checks: number }
    note: string
  }
  knownGaps: string[]
}

function StateIcon({ state }: { state: CoverageEntry['state'] }) {
  if (state === 'instrumented')
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> instrumented
      </span>
    )
  if (state === 'partial')
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
        <Circle className="h-3 w-3" aria-hidden="true" /> partial
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
      <CircleSlash className="h-3 w-3" aria-hidden="true" /> not instrumented
    </span>
  )
}

export function DiagnosticsTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<DiagnosticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pruning, setPruning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<DiagnosticsData>('/api/platform/operations/diagnostics')
      setData(d)
    } catch (e) {
      setError((e as PlatformApiError).error || 'Failed to load diagnostics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const prune = useCallback(async () => {
    setPruning(true)
    try {
      const r = await platformApi<{ pruned: { snapshots: number; events: number; checks: number } }>(
        '/api/platform/operations/diagnostics',
        { method: 'POST', body: JSON.stringify({}) },
      )
      toast.success(
        `Retention cleanup finished — pruned ${formatNumber(r.pruned.snapshots)} snapshots, ${formatNumber(r.pruned.events)} error events, ${formatNumber(r.pruned.checks)} checks (audited)`,
      )
      await load()
    } catch (e) {
      toast.error((e as PlatformApiError).error || 'Retention cleanup failed')
    } finally {
      setPruning(false)
    }
  }, [load])

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={OPS_CARD}>
            <Skeleton className="h-4 w-56 bg-slate-200" />
            <Skeleton className="mt-2 h-3 w-80 bg-slate-200" />
          </div>
        ))}
      </div>
    )
  }
  if (error) return <OpsErrorState message={error} onRetry={() => void load()} retrying={loading} />
  if (!data) return null

  const s = data.coverage.summary

  return (
    <div className="space-y-6">
      {/* Coverage summary */}
      <section aria-labelledby="ops-d-coverage">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ops-d-coverage" className="text-base font-semibold text-slate-900">
            Monitoring coverage
          </h2>
          <p className="text-[10px] text-slate-400">
            {formatNumber(s.instrumented)} instrumented · {formatNumber(s.partial)} partial ·{' '}
            {formatNumber(s.notInstrumented)} not instrumented
          </p>
        </div>
        <ul className="space-y-2">
          {data.coverage.entries.map((e, i) => (
            <motion.li key={e.path} {...fadeUp} transition={{ delay: Math.min(i * 0.02, 0.2) }} className={`${OPS_CARD} !p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <StateIcon state={e.state} />
                <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{e.path}</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 break-words">{e.mechanism}</p>
              {e.gap && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-700 break-words">
                  <span className="font-semibold">Gap: </span>
                  {e.gap}
                </p>
              )}
            </motion.li>
          ))}
        </ul>
      </section>

      {/* Ops audit history */}
      <section aria-labelledby="ops-d-audit">
        <h2 id="ops-d-audit" className="mb-3 text-base font-semibold text-slate-900">
          Operations actions (platform audit trail)
        </h2>
        <div className={`${OPS_CARD} overflow-hidden`}>
          <ul className="max-h-72 overflow-y-auto custom-scrollbar">
            {data.opsAudit.recent.length === 0 ? (
              <li className="px-4 py-4 text-center text-xs text-slate-500">
                No operations actions recorded yet (syncs, health-check runs, alert and error transitions appear here).
              </li>
            ) : (
              data.opsAudit.recent.map((a) => (
                <li key={a.id} className="border-b border-slate-100 px-4 py-2 last:border-0">
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="tabular-nums text-slate-400">{timeAgo(a.at)}</span>
                    <span className="font-mono font-medium text-slate-700">{a.action}</span>
                    {a.target && <span className="truncate font-mono text-slate-400">{a.target.slice(0, 28)}</span>}
                  </div>
                  {a.reason && <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{a.reason}</p>}
                </li>
              ))
            )}
          </ul>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">{data.opsAudit.note}</p>
      </section>

      {/* Retention */}
      <section aria-labelledby="ops-d-retention">
        <h2 id="ops-d-retention" className="mb-3 text-base font-semibold text-slate-900">
          Data retention
        </h2>
        <div className={`${OPS_CARD} space-y-2`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Usage snapshots</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {formatNumber(data.retention.currentRows.snapshots)} rows · keep {data.retention.snapshotRetentionDays}d
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Error occurrence events</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {formatNumber(data.retention.currentRows.errorEvents)} rows · keep {data.retention.errorEventRetentionDays}d
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Health check history</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                {formatNumber(data.retention.currentRows.checks)} rows · keep {data.retention.monitoringCheckRetentionDays}d
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">{data.retention.note}</p>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void prune()}
              disabled={pruning}
              className="border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              <Trash2 className={`mr-1.5 h-3.5 w-3.5 ${pruning ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {pruning ? 'Pruning…' : 'Run retention cleanup now'}
            </Button>
          </div>
        </div>
      </section>

      {/* Known gaps */}
      <section aria-labelledby="ops-d-gaps">
        <h2 id="ops-d-gaps" className="mb-3 text-base font-semibold text-slate-900">
          Known limits & honest gaps
        </h2>
        <ul className="space-y-2">
          {data.knownGaps.map((g, i) => (
            <li key={i} className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-2.5 text-xs leading-relaxed text-slate-600">
              {g}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
