'use client'

// ============================================================
// OverviewModule — the /platform control-plane dashboard (PHASE 6)
// ------------------------------------------------------------
// Read-only summary surface: schools by status, platform sessions,
// active support sessions, recent platform audit trail and live
// announcements. Every number comes from GET /api/platform/overview —
// no fabricated data, skeletons while loading, honest empty states.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Building2,
  MonitorSmartphone,
  LifeBuoy,
  Megaphone,
  ScrollText,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Clock,
  Info,
  ShieldAlert,
  Activity,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// ── Types (API contract, worklog Task 6-1) ────────────────────────────────

interface OverviewData {
  schools: { total: number; byStatus: Record<string, number> }
  platformSessions: number
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
  announcements: Array<{
    id: string
    title: string
    level: string
    createdAt: string
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

const ANNOUNCEMENT_LEVELS: Record<string, { badge: string; icon: React.ReactNode }> = {
  INFO: {
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    icon: <Info className="h-3 w-3" aria-hidden="true" />,
  },
  WARNING: {
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  },
  CRITICAL: {
    badge: 'border-red-500/30 bg-red-500/10 text-red-400',
    icon: <ShieldAlert className="h-3 w-3" aria-hidden="true" />,
  },
}

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35 },
} as const

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  children,
  delay,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  children?: React.ReactNode
  delay?: number
}) {
  return (
    <motion.div
      {...fadeUp}
      transition={{ duration: 0.35, delay }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 min-w-0"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl sm:text-3xl font-bold text-zinc-50 tabular-nums">{value}</p>
      {children && <div className="mt-2 text-xs text-zinc-400">{children}</div>}
    </motion.div>
  )
}

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      <Skeleton className="h-3 w-24 bg-zinc-800" />
      <Skeleton className="mt-3 h-8 w-16 bg-zinc-800" />
      <Skeleton className="mt-2 h-3 w-28 bg-zinc-800" />
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function OverviewModule() {
  const { me } = usePlatformSession()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await platformApi<OverviewData>('/api/platform/overview'))
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Failed to load the platform overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const byStatus = data?.schools.byStatus ?? {}
  const active = byStatus['ACTIVE'] ?? 0
  const suspended = byStatus['SUSPENDED'] ?? 0
  const pending = byStatus['PENDING'] ?? 0
  const trial = byStatus['TRIAL'] ?? 0
  const liveAnnouncements = data?.announcements.length ?? 0

  return (
    <section aria-labelledby="overview-heading" className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            id="overview-heading"
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-zinc-50"
          >
            Platform overview
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Infrastructure at a glance{me ? ` · signed in as ${me.admin.name}` : ''} · every action is audited
          </p>
        </div>
        <Button
          asChild
          size="sm"
          className="h-10 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
        >
          <Link href="/platform/schools">
            View schools
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* Load error */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Schools"
              value={data ? num.format(data.schools.total) : '—'}
              icon={<Building2 className="h-4 w-4" />}
              delay={0}
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-emerald-400 tabular-nums">{active} active</span>
                <span className="text-red-400 tabular-nums">{suspended} suspended</span>
                <span className="text-amber-400 tabular-nums">{pending} pending</span>
                {trial > 0 && <span className="text-zinc-500 tabular-nums">{trial} trial</span>}
              </span>
            </StatCard>
            <StatCard
              label="Platform sessions"
              value={data ? num.format(data.platformSessions) : '—'}
              icon={<MonitorSmartphone className="h-4 w-4" />}
              delay={0.05}
            >
              <span className="text-zinc-500">Admin sessions live right now</span>
            </StatCard>
            <StatCard
              label="Active support sessions"
              value={data ? num.format(data.activeSupportSessions.length) : '—'}
              icon={<LifeBuoy className="h-4 w-4" />}
              delay={0.1}
            >
              {data && data.activeSupportSessions.length > 0 ? (
                <span className="block truncate text-amber-300">
                  {data.activeSupportSessions.map((s) => s.school).join(', ')}
                </span>
              ) : (
                <span className="block truncate text-zinc-500">None open — nothing is being watched</span>
              )}
            </StatCard>
            <StatCard
              label="Live announcements"
              value={data ? num.format(liveAnnouncements) : '—'}
              icon={<Megaphone className="h-4 w-4" />}
              delay={0.15}
            >
              <span>Visible to signed-in schools</span>
            </StatCard>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent platform audit */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.1 }} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
            <ScrollText className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-zinc-100">Recent platform audit</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Read-only</span>
          </div>
          {loading ? (
            <div className="space-y-3 p-4 sm:p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-6 w-32 bg-zinc-800" />
                  <Skeleton className="h-4 flex-1 bg-zinc-800" />
                  <Skeleton className="h-4 w-14 bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : data && data.recentAudit.length > 0 ? (
            <ul className="divide-y divide-zinc-800/60" aria-label="Recent platform audit events">
              {data.recentAudit.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Badge
                    variant="outline"
                    className="border-zinc-700 bg-zinc-800/60 text-[11px] text-zinc-300 normal-case"
                  >
                    {prettyAction(event.action)}
                  </Badge>
                  <p className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={event.reason ?? undefined}>
                    {event.reason ?? <span className="text-zinc-600">No reason recorded</span>}
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500" title={new Date(event.at).toLocaleString()}>
                    {timeAgo(event.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/70 text-zinc-500 ring-1 ring-zinc-700/60">
                <Activity className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-200">No audit events yet</p>
              <p className="mt-1 max-w-xs text-xs leading-snug text-zinc-500">
                Control-plane actions (provisioning, suspensions, plan changes) will appear here.
              </p>
            </div>
          )}
        </motion.div>

        {/* Live announcements */}
        <motion.div {...fadeUp} transition={{ duration: 0.35, delay: 0.15 }} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
            <Megaphone className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-zinc-100">Live announcements</h2>
          </div>
          {loading ? (
            <div className="space-y-3 p-4 sm:p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-6 w-20 bg-zinc-800" />
                  <Skeleton className="h-4 flex-1 bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : data && data.announcements.length > 0 ? (
            <ul className="divide-y divide-zinc-800/60" aria-label="Live platform announcements">
              {data.announcements.map((a) => {
                const level = ANNOUNCEMENT_LEVELS[a.level] ?? ANNOUNCEMENT_LEVELS['INFO']
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Badge variant="outline" className={`gap-1 normal-case ${level.badge}`}>
                      {level.icon}
                      {a.level}
                    </Badge>
                    <p className="min-w-0 flex-1 truncate text-sm text-zinc-200">{a.title}</p>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500" title={new Date(a.createdAt).toLocaleString()}>
                      {timeAgo(a.createdAt)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/70 text-zinc-500 ring-1 ring-zinc-700/60">
                <Megaphone className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-200">No live announcements</p>
              <p className="mt-1 max-w-xs text-xs leading-snug text-zinc-500">
                Publish platform-wide notices from the Announcements module.
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Active support sessions detail (read-only) */}
      {!loading && data && data.activeSupportSessions.length > 0 && (
        <motion.div {...fadeUp} className="min-w-0 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
          <div className="flex items-center gap-2.5 border-b border-amber-500/20 px-4 py-3.5 sm:px-5">
            <LifeBuoy className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-amber-200">Support sessions in progress</h2>
          </div>
          <ul className="divide-y divide-amber-500/10" aria-label="Active support sessions">
            {data.activeSupportSessions.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
                <p className="text-sm font-semibold text-zinc-100">{s.school}</p>
                <p className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={s.reason}>
                  opened by {s.admin} — {s.reason}
                </p>
                <span className="flex items-center gap-1.5 text-xs tabular-nums text-amber-300">
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
