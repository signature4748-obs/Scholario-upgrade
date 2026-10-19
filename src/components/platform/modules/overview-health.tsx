'use client'

// ============================================================
// SystemHealthCard — the Overview system-health panel.
// ------------------------------------------------------------
// Implements the documented control-plane requirement
// (docs/PLATFORM_CONTROL_PLANE.md §3 + §11: "stats dashboard +
// system health (DB latency, counts, memory, recent auth
// failures)") against the existing read-only
// GET /api/platform/health route — an API that shipped fully
// implemented but was never surfaced in the console UI.
//
// Contract rules honored:
//   · Every value comes from the API — nothing is invented.
//   · Honest loading (skeleton), error (role=alert + retry) and
//     degraded states — a failed request NEVER renders fake
//     "healthy" values.
//   · Freshness: checked-at timestamp + a visibility-aware 60s
//     auto-refresh (paused while the tab is hidden), plus a
//     manual refresh action.
//   · Compact, information-dense tiles — no decorative charts.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Database,
  HeartPulse,
  RefreshCw,
  Server,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/** GET /api/platform/health — the fields this panel consumes. */
interface SystemHealthData {
  status: 'healthy' | 'degraded'
  db: { ok: boolean; latencyMs: number | null }
  schools: { active: number; suspended: number; pending: number }
  users: number
  platformAdmins: number
  sessions: { platform: number; school: number; support: number }
  security: { recentAuthFailures: number; recentAuthFailuresWindowDays?: number }
  process: { uptimeSec: number; rssMb: number; nodeEnv: string }
  checkedAt: string
}

/** Auto-refresh cadence — modest for an operator panel. */
const REFRESH_MS = 60_000

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function uptime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** One compact read-only stat tile. */
function HealthTile({
  icon,
  label,
  children,
  danger,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
            danger ? 'bg-red-100 text-red-600' : 'bg-slate-200/70 text-slate-500'
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
      </div>
      <div className="mt-1.5 min-w-0 text-xs text-slate-700">{children}</div>
    </div>
  )
}

export function SystemHealthCard() {
  const [health, setHealth] = useState<SystemHealthData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0) // re-render clock for "checked Xs ago"
  const mounted = useRef(true)

  const load = useCallback(async (background: boolean) => {
    if (background) setRefreshing(true)
    try {
      const data = await platformApi<SystemHealthData>('/api/platform/health')
      if (!mounted.current) return
      setHealth(data)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      const err = e as PlatformApiError
      // Keep the last good reading visible; the error line explains it.
      setError(err.error || 'Failed to load system health')
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load(false)
    return () => {
      mounted.current = false
    }
  }, [load])

  // Visibility-aware periodic refresh — paused while the tab is
  // hidden (an operator panel has no reason to poll in background).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  // 15s clock so "checked Xs ago" stays truthful without a refetch.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const failures = health?.security.recentAuthFailures ?? 0
  const windowDays = health?.security.recentAuthFailuresWindowDays ?? 7
  const degraded = health?.status === 'degraded' || health?.db.ok === false

  return (
    <motion.div
      {...fadeUp}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm"
      aria-labelledby="system-health-heading"
      data-tick={tick}
    >
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <HeartPulse
          className={`h-4 w-4 shrink-0 ${degraded ? 'text-red-600' : 'text-teal-600'}`}
          aria-hidden="true"
        />
        <h2 id="system-health-heading" className="font-display text-sm font-bold text-slate-900">
          System health
        </h2>
        {health && (
          <Badge
            variant="outline"
            className={`ml-1 text-[11px] font-semibold normal-case ${
              degraded
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-teal-200 bg-teal-50 text-teal-700'
            }`}
          >
            {degraded ? 'Degraded' : 'Healthy'}
          </Badge>
        )}
        <span
          className="ml-auto shrink-0 text-xs tabular-nums text-slate-500"
          title={health ? new Date(health.checkedAt).toLocaleString() : undefined}
        >
          {health ? `checked ${timeAgo(health.checkedAt)}` : '\u00A0'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh system health"
          className="h-8 w-8 border-slate-300 bg-white p-0 text-slate-700 hover:bg-slate-100 focus-ring"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </Button>
      </div>

      {error && !health ? (
        <div
          role="alert"
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : !health ? (
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 sm:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
              <Skeleton className="h-3 w-20 bg-slate-200" />
              <Skeleton className="mt-2 h-4 w-24 bg-slate-200" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HealthTile
              icon={<Database className="h-3 w-3" />}
              label="Database"
              danger={!health.db.ok}
            >
              {health.db.ok ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
                  <span className="tabular-nums">
                    Connected
                    {health.db.latencyMs != null ? ` · ${health.db.latencyMs}ms` : ''}
                  </span>
                </span>
              ) : (
                <span className="font-semibold text-red-600">Unreachable</span>
              )}
            </HealthTile>
            <HealthTile icon={<Users className="h-3 w-3" />} label="Live sessions">
              <span className="tabular-nums">
                {health.sessions.platform} platform · {health.sessions.school} school ·{' '}
                {health.sessions.support} support
              </span>
            </HealthTile>
            <HealthTile
              icon={<ShieldAlert className="h-3 w-3" />}
              label={`Auth failures · ${windowDays}d`}
              danger={failures > 0}
            >
              <span
                className={`tabular-nums font-semibold ${
                  failures > 0 ? 'text-amber-600' : 'text-slate-700'
                }`}
              >
                {failures} failed sign-in attempt{failures === 1 ? '' : 's'}
              </span>
            </HealthTile>
            <HealthTile icon={<Server className="h-3 w-3" />} label="Process">
              <span className="tabular-nums">
                up {uptime(health.process.uptimeSec)} · {health.process.rssMb} MB RSS
              </span>
            </HealthTile>
          </div>
          <p className="px-1 text-[11px] text-slate-400">
            {health.process.nodeEnv === 'production'
              ? 'Production process · read-only probes'
              : `Development process · ${health.users} users · ${health.platformAdmins} platform admins`}
          </p>
        </div>
      )}

      {/* Stale-data honesty: keep the last reading, explain its age. */}
      {error && health && (
        <p
          role="status"
          className="flex items-center gap-2 border-t border-slate-200 px-4 py-2.5 text-xs text-amber-700 sm:px-5"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Last reading kept (checked {timeAgo(health.checkedAt)}) — {error}
        </p>
      )}
    </motion.div>
  )
}
