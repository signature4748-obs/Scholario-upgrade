'use client'

// ============================================================
// Platform Operations Center — shared presentation primitives
// ------------------------------------------------------------
// Same light design system as the rest of the console (slate canvas,
// white cards, teal accents, amber warnings, red errors). Everything
// here is presentational; data contracts live in each tab module.
// Every component renders HONEST states: unavailable ≠ zero, stale ≠
// current, unknown ≠ healthy.
// ============================================================

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Clock, ExternalLink, Info, RefreshCw } from 'lucide-react'

// ── Formatting ────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat('en-IN')

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return numFmt.format(n)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

export function formatPercent(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—'
  return `${Math.round(p * 10) / 10}%`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Status / severity chips ──────────────────────────────────────────────

const CHECK_STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  down: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-slate-50 text-slate-600 border-slate-200',
  not_configured: 'bg-slate-50 text-slate-500 border-slate-200',
}

const CHECK_STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
  not_configured: 'Not configured',
}

export function CheckStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`${CHECK_STATUS_STYLES[status] ?? CHECK_STATUS_STYLES.unknown} whitespace-nowrap`}>
      <span
        className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
          status === 'healthy'
            ? 'bg-emerald-500'
            : status === 'degraded'
              ? 'bg-amber-500'
              : status === 'down'
                ? 'bg-red-500'
                : 'bg-slate-400'
        }`}
        aria-hidden="true"
      />
      {CHECK_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-slate-50 text-slate-600 border-slate-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  critical: 'bg-red-100 text-red-800 border-red-300',
}

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, high: 2, error: 3, critical: 4 }

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={`${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info} whitespace-nowrap`}>
      {severity}
    </Badge>
  )
}

export function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 0
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-red-50 text-red-700 border-red-200',
  acknowledged: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-sky-50 text-sky-700 border-sky-200',
  skipped: 'bg-slate-50 text-slate-500 border-slate-200',
}

export function StateBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`${STATUS_STYLES[status] ?? STATUS_STYLES.skipped} whitespace-nowrap`}>
      {status}
    </Badge>
  )
}

// ── Freshness ─────────────────────────────────────────────────────────────

export function FreshnessBadge({ stale, ageMinutes }: { stale: boolean; ageMinutes?: number | null }) {
  if (stale) {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap">
        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
        Stale{ageMinutes != null ? ` · ${ageMinutes}m` : ''}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">
      Fresh
    </Badge>
  )
}

// ── Cards / states ────────────────────────────────────────────────────────

export const OPS_CARD = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm'

export function OpsErrorState({
  message,
  onRetry,
  retrying,
}: {
  message: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div role="alert" className={`${OPS_CARD} border-red-200 bg-red-50/50`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-700">Data could not be loaded</p>
          <p className="mt-1 text-sm text-red-600 break-words">{message}</p>
          <p className="mt-1 text-xs text-red-500">
            Nothing was changed. The failure may be transient — retry, or check the Errors tab once the center is reachable.
          </p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              className="mt-3 border-red-200 bg-white text-red-700 hover:bg-red-50"
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function OpsEmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={`${OPS_CARD} flex flex-col items-center justify-center py-10 text-center`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
        <Info className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function OpsSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={OPS_CARD}>
          <Skeleton className="h-3 w-24 bg-slate-200" />
          <Skeleton className="mt-3 h-8 w-20 bg-slate-200" />
          <Skeleton className="mt-2 h-3 w-28 bg-slate-200" />
        </div>
      ))}
    </div>
  )
}

// ── Honest unavailability ─────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  'plan-restricted': 'Not available through the connected API/plan',
  'endpoint-unavailable': 'Not exposed by the provider API',
  'not-configured': 'Not configured',
  'not-reported': 'Not reported by the provider',
}

export function UnavailableNotice({
  reason,
  detail,
  metricLabel,
  dashboardUrl,
  dashboardLabel,
}: {
  reason: string | null
  detail?: string | null
  metricLabel: string
  dashboardUrl?: string
  dashboardLabel?: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-600">
            {metricLabel} — <span className="text-slate-500">{REASON_LABELS[reason ?? ''] ?? 'Unavailable'}</span>
          </p>
          {detail && <p className="mt-1 text-xs leading-relaxed text-slate-500 break-words">{detail}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span>Rendered honestly as unavailable — never as zero usage.</span>
            {dashboardUrl && (
              <a
                href={dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800"
              >
                {dashboardLabel ?? 'Open provider dashboard'}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section header ───────────────────────────────────────────────────────

export function OpsSectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
