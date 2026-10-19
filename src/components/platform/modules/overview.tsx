'use client'

// ============================================================
// OverviewModule — the /platform overview page (SIMPLIFIED IA)
// ------------------------------------------------------------
// Answers exactly four questions with REAL data:
//   1. How many schools are under management?  (total)
//   2. How many are active?                    (ACTIVE)
//   3. What needs attention?                   (PENDING + TRIAL
//      count + a drill-down list of actionable rows, each linking
//      into the school workspace)
//   4. How many are suspended?                 (SUSPENDED)
// Metrics + drill-down come from GET /api/platform/schools?summary=1
// &pageSize=25 (the honest first page). The /api/platform/overview
// fetch stays for the operational context: recent platform audit
// entries and live support sessions. A failed request renders an
// honest error state (role=alert + retry) — NEVER zeros. If the
// schools response carries `subscriptionSchemaPending`, the shared
// SubscriptionPendingBanner is rendered exactly once near the top
// while the metrics/list keep rendering. No fabricated KPIs, no
// decorative charts — every number comes from an API.
//
// System health (docs/PLATFORM_CONTROL_PLANE.md §3/§11 — the
// documented "DB latency, counts, memory, recent auth failures"
// panel) renders from the existing read-only /api/platform/health
// route via the SystemHealthCard module.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  LifeBuoy,
  Plus,
  RefreshCw,
  ScrollText,
} from 'lucide-react'
import { platformApi, usePlatformSession, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { SystemHealthCard } from './overview-health'

// ── Types (API contracts — only the fields this page consumes) ────────────

/** GET /api/platform/overview — operational context (audit + support). */
interface OverviewData {
  activeSupportSessions: Array<{
    id: string
    school: string
    admin: string
    reason: string
    expiresAt: string
  }>
  recentAudit: Array<{
    id: string
    at: string
    action: string
    schoolId: string | null
    reason: string | null
  }>
}

/** GET /api/platform/schools?summary=1&pageSize=25 — KPI summary + the
 *  honest first page of school rows (feeds the needs-attention list). */
interface SchoolsSummaryData {
  total: number
  summary?: {
    total: number
    byStatus: Record<string, number>
    subscriptionsExpiringWithin30Days: number
  }
  /** Honest schema-pending flag (pending migration 20261013183000). */
  subscriptionSchemaPending?: boolean
  schools: Array<{
    id: string
    name: string
    status: string
    subscription: {
      state: string
      periodEnd: string | null
    }
  }>
}

// ── Small local helpers ───────────────────────────────────────────────────

function timeAgo(iso: string): string {
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

/** Future-facing relative time ("in 12m") for session expiry. */
function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'expired'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `in ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  return `in ${h}h ${m % 60}m`
}

/** "platform.school.suspended" → "school suspended" (badge-friendly). */
function prettyAction(action: string): string {
  return action
    .replace(/^platform\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const num = new Intl.NumberFormat('en-IN')

const RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35 },
} as const

/** The honest, actionable reasons a school row lands in the
 *  needs-attention list (empty array = nothing actionable). */
function attentionReasons(
  row: SchoolsSummaryData['schools'][number],
  now: number,
): string[] {
  const reasons: string[] = []
  if (row.status === 'PENDING') reasons.push('Setup not completed — awaiting activation')
  const state = row.subscription.state
  if (state === 'GRACE') reasons.push('Subscription in grace period')
  else if (state === 'RESTRICTED') reasons.push('Subscription restricted')
  else if (state === 'SUSPENDED') reasons.push('Subscription suspended')
  const end =
    row.subscription.periodEnd != null ? new Date(row.subscription.periodEnd).getTime() : null
  if (end != null && Number.isFinite(end) && end >= now && end - now <= RENEWAL_WINDOW_MS) {
    reasons.push('Renewal due soon')
  }
  return reasons
}

// ── Metric card ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  icon,
  valueClass,
  children,
  delay,
  href,
}: {
  label: string
  value: string
  icon: React.ReactNode
  valueClass?: string
  children?: React.ReactNode
  delay?: number
  /** When set, the whole card links to the filtered list (the metric
   *  is the summary; the list is the evidence). */
  href?: string
}) {
  const card = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${valueClass ?? 'text-slate-900'}`}>
        {value}
      </p>
      {children && <div className="mt-2 text-xs text-slate-500">{children}</div>}
    </>
  )
  const frame = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm'
  if (href) {
    return (
      <motion.div {...fadeUp} transition={{ duration: 0.35, delay }}>
        <Link
          href={href}
          className={`group block ${frame} transition-colors hover:border-teal-300 focus-ring`}
          aria-label={`${label}: ${value} — view the filtered list`}
        >
          {card}
        </Link>
      </motion.div>
    )
  }
  return (
    <motion.div {...fadeUp} transition={{ duration: 0.35, delay }} className={frame}>
      {card}
    </motion.div>
  )
}

function MetricSkeleton() {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
      <Skeleton className="h-3 w-24 bg-slate-200" />
      <Skeleton className="mt-3 h-8 w-16 bg-slate-200" />
      <Skeleton className="mt-2 h-3 w-28 bg-slate-200" />
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function OverviewModule() {
  const { can } = usePlatformSession()
  const [schools, setSchools] = useState<SchoolsSummaryData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [schoolsError, setSchoolsError] = useState<string | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  // Both fetches run in parallel; each one fails HONESTLY on its own
  // (a failed metrics request never renders zeros, a failed activity
  // request never renders an empty success state).
  const load = useCallback(async () => {
    setLoading(true)
    setSchoolsError(null)
    setOverviewError(null)
    await Promise.all([
      (async () => {
        try {
          const data = await platformApi<SchoolsSummaryData>(
            '/api/platform/schools?summary=1&pageSize=25',
          )
          setSchools(data)
          // summary=1 is part of the request; a response without the
          // KPI summary is a contract anomaly — surface it honestly
          // instead of silently hiding the metric cards.
          if (!data.summary) {
            setSchoolsError('The schools summary is unavailable — unexpected API response')
          }
        } catch (e) {
          const err = e as PlatformApiError
          setSchoolsError(err.error || 'Failed to load the schools summary')
        }
      })(),
      (async () => {
        try {
          setOverview(await platformApi<OverviewData>('/api/platform/overview'))
        } catch (e) {
          const err = e as PlatformApiError
          setOverviewError(err.error || 'Failed to load the recent activity')
        }
      })(),
    ])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const summary = schools?.summary
  const byStatus = summary?.byStatus ?? {}
  const active = byStatus['ACTIVE'] ?? 0
  const suspended = byStatus['SUSPENDED'] ?? 0
  const needsAttention = (byStatus['PENDING'] ?? 0) + (byStatus['TRIAL'] ?? 0)
  const expiringSoon = summary?.subscriptionsExpiringWithin30Days ?? 0

  // Needs-attention drill-down — derived from the honest first page
  // of rows (pageSize=25). Zero actionable rows → nothing rendered.
  const attention: Array<{
    id: string
    name: string
    reasons: string[]
    severe: boolean
  }> = []
  for (const row of schools?.schools ?? []) {
    const reasons = attentionReasons(row, Date.now())
    if (reasons.length === 0) continue
    attention.push({
      id: row.id,
      name: row.name,
      reasons,
      severe:
        row.subscription.state === 'SUSPENDED' || row.subscription.state === 'RESTRICTED',
    })
  }

  return (
    <section aria-labelledby="overview-heading" className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            id="overview-heading"
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900"
          >
            Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500">Platform health and schools at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Direct shortcut — the primary daily workflow. */}
          {can('schools.provision') && (
            <Button
              asChild
              size="sm"
              className="h-10 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
            >
              <Link href="/platform/schools?new=1">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add school
              </Link>
            </Button>
          )}
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold focus-ring"
          >
            <Link href="/platform/schools">
              View schools
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Honest schema-pending banner — exactly once, metrics still render */}
      {schools && isSubscriptionSchemaPending(schools) && <SubscriptionPendingBanner />}

      {/* Metrics load failure — honest error, never zeros */}
      {schoolsError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {schoolsError}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* The four metric cards (skeletons while loading; absent on a
          first-load failure — a failed request must not render zeros) */}
      {(loading || summary) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {loading ? (
            <>
              <MetricSkeleton />
              <MetricSkeleton />
              <MetricSkeleton />
              <MetricSkeleton />
            </>
          ) : (
            <>
              <MetricCard
                label="Total schools"
                value={num.format(summary?.total ?? 0)}
                icon={<Building2 className="h-4 w-4" />}
                delay={0}
                href="/platform/schools"
              />
              <MetricCard
                label="Active schools"
                value={num.format(active)}
                valueClass="text-teal-600"
                icon={<CheckCircle2 className="h-4 w-4" />}
                delay={0.05}
                href="/platform/schools?status=ACTIVE"
              />
              <MetricCard
                label="Needs attention"
                value={num.format(needsAttention)}
                valueClass="text-amber-600"
                icon={<AlertTriangle className="h-4 w-4" />}
                delay={0.1}
                href="/platform/schools?status=ATTENTION"
              >
                <span className="tabular-nums">
                  {expiringSoon} subscription{expiringSoon === 1 ? '' : 's'} expiring within 30 days
                </span>
              </MetricCard>
              <MetricCard
                label="Suspended schools"
                value={num.format(suspended)}
                valueClass="text-red-600"
                icon={<Ban className="h-4 w-4" />}
                delay={0.15}
                href="/platform/schools?status=SUSPENDED"
              />
            </>
          )}
        </div>
      )}

      {/* System health — the documented control-plane health panel
          (DB latency, live sessions, recent auth failures, process
          health) fed by the read-only /api/platform/health route. */}
      <SystemHealthCard />

      {/* Needs attention — real actionable rows only (nothing when empty) */}
      {!loading && attention.length > 0 && (
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.1 }} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="font-display text-sm font-bold text-slate-900">Needs attention</h2>
            <p className="text-xs text-slate-500">
              {attention.length} school{attention.length === 1 ? '' : 's'} on this page
            </p>
          </div>
          <ul className="space-y-2" aria-label="Schools that need attention">
            {attention.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/platform/schools/${row.id}`}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-slate-300 focus-ring"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${row.severe ? 'bg-red-500' : 'bg-amber-500'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {row.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {row.reasons.join(' · ')}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Recent activity — slim read-only audit slice */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <ScrollText className="h-4 w-4 text-teal-600" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-slate-900">Recent activity</h2>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Audit log
          </span>
        </div>
        {loading ? (
          <div className="space-y-3 p-4 sm:p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-32 bg-slate-200" />
                <Skeleton className="h-4 flex-1 bg-slate-200" />
                <Skeleton className="h-4 w-14 bg-slate-200" />
              </div>
            ))}
          </div>
        ) : overviewError ? (
          <div
            role="alert"
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
          >
            <p className="flex items-start gap-2.5 text-sm text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {overviewError}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : overview && overview.recentAudit.length > 0 ? (
          <ul className="divide-y divide-slate-200" aria-label="Recent platform audit events">
            {overview.recentAudit.slice(0, 5).map((event) => (
              <li key={event.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-100 text-[11px] text-slate-700 normal-case"
                >
                  {prettyAction(event.action)}
                </Badge>
                <p
                  className="min-w-0 flex-1 truncate text-xs text-slate-600"
                  title={event.reason ?? undefined}
                >
                  {event.reason ?? <span className="text-slate-400">No reason recorded</span>}
                </p>
                <span
                  className="shrink-0 text-xs tabular-nums text-slate-500"
                  title={new Date(event.at).toLocaleString()}
                >
                  {timeAgo(event.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-4 py-6 sm:px-5">
            <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <p className="text-xs text-slate-500">
              No audit events yet — control-plane actions will appear here.
            </p>
          </div>
        )}
      </motion.div>

      {/* Active support sessions (read-only) — only when one is live */}
      {overview && overview.activeSupportSessions.length > 0 && (
        <motion.div
          {...fadeUp}
          className="min-w-0 rounded-xl border border-amber-200 bg-amber-50"
        >
          <div className="flex items-center gap-2.5 border-b border-amber-200 px-4 py-3.5 sm:px-5">
            <LifeBuoy className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-amber-700">
              Support sessions in progress
            </h2>
          </div>
          <ul className="divide-y divide-amber-200" aria-label="Active support sessions">
            {overview.activeSupportSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5"
              >
                <p className="text-sm font-semibold text-slate-900">{s.school}</p>
                <p className="min-w-0 flex-1 truncate text-xs text-slate-600" title={s.reason}>
                  opened by {s.admin} — {s.reason}
                </p>
                <span className="flex items-center gap-1.5 text-xs tabular-nums text-amber-700">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  ends {timeUntil(s.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </section>
  )
}
