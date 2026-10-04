'use client'

// ============================================================
// SupportOversightView — /platform/support/view (PHASE 6)
// ------------------------------------------------------------
// The READ-ONLY oversight surface of an active support session.
// Renders STANDALONE (no console chrome): a persistent amber banner
// with the live expiry countdown replaces the shell. Authenticated
// exclusively by the SUPPORT token space — importing platform-client
// also installs the fetch interceptor that attaches x-support-token.
// Every section communicates read-only; there is no write affordance
// anywhere on this page.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import {
  Lock,
  LifeBuoy,
  LogOut,
  AlertTriangle,
  RefreshCw,
  Clock,
  History,
  Megaphone,
  Info,
  ShieldAlert,
  Users,
  GraduationCap,
  BookOpen,
  LayoutGrid,
  ClipboardList,
  IndianRupee,
  MonitorSmartphone,
  Building2,
} from 'lucide-react'
import { platformApi, exitSupportSession, type PlatformApiError } from '../platform-client'

// ── Types (API contract, worklog Task 6-1) ────────────────────────────────

interface SupportOverviewData {
  supportSession: {
    id: string
    schoolId: string
    schoolName: string
    schoolSlug: string
    schoolStatus: string
    reason: string
    startedAt: string
    expiresAt: string
  }
  counts: {
    users?: number
    students?: number
    teachers?: number
    classes?: number
    subjects?: number
    exams?: number
  }
  finance: { successfulPayments: number; collectedTotal: number }
  recentActivity: Array<{ id: string; action: string; detail: string | null; at: string }>
  activeSchoolSessions: number
  announcements: Array<{ id: string; title: string; level: string; createdAt: string }>
}

const num = new Intl.NumberFormat('en-IN')
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

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

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  TRIAL: 'border-slate-200 bg-slate-100 text-slate-600',
}

const ANNOUNCEMENT_LEVELS: Record<string, { badge: string; icon: React.ReactNode }> = {
  INFO: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: <Info className="h-3 w-3" aria-hidden="true" />,
  },
  WARNING: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  },
  CRITICAL: {
    badge: 'border-red-200 bg-red-50 text-red-600',
    icon: <ShieldAlert className="h-3 w-3" aria-hidden="true" />,
  },
}

/** Live mm:ss remaining to expiry (null once past). */
function useRemaining(expiresAt: string | null): number | null {
  const [ms, setMs] = useState<number | null>(null)
  useEffect(() => {
    if (!expiresAt) return
    const target = new Date(expiresAt).getTime()
    if (!Number.isFinite(target)) return
    const tick = () => setMs(target - Date.now())
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [expiresAt])
  return ms
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── Stat card ─────────────────────────────────────────────────────────────

function DossierCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  )
}

// ── View ──────────────────────────────────────────────────────────────────

export function SupportOversightView() {
  const router = useRouter()
  const [data, setData] = useState<SupportOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noSession, setNoSession] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [expiryHandled, setExpiryHandled] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNoSession(false)
    try {
      const result = await platformApi<SupportOverviewData>('/api/platform/support/overview')
      setData(result)
      setExpiryHandled(false)
    } catch (e) {
      const err = e as PlatformApiError
      if (err.code === 'AUTH_REQUIRED' || err.code === 'FORBIDDEN') {
        setNoSession(true)
      } else {
        setError(err.error || 'Failed to load the oversight dossier')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remaining = useRemaining(data?.supportSession.expiresAt ?? null)
  const expired = data !== null && remaining !== null && remaining <= 0

  // When the clock runs out, re-check with the server once (it retires +
  // audits the expired session and we fall back to the no-session state).
  useEffect(() => {
    if (expired && !expiryHandled) {
      setExpiryHandled(true)
      void load()
    }
  }, [expired, expiryHandled, load])

  const exit = useCallback(async () => {
    setExiting(true)
    await exitSupportSession()
    router.replace('/platform')
  }, [router])

  // ── No active support session ─────────────────────────────────────────
  if (noSession) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
            <LifeBuoy className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold text-slate-900">No active support session</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            This oversight surface is only available while a time-boxed, reason-bearing support session is
            live. Open one from a school&apos;s detail page in the control plane.
          </p>
          <Link
            href="/platform"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors focus-ring"
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Back to the control plane
          </Link>
        </div>
      </div>
    )
  }

  // ── Boot state ────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4" aria-busy="true" aria-label="Loading support session">
          <div className="h-16 rounded-2xl border border-amber-200 bg-amber-50 animate-pulse" />
          <div className="h-40 rounded-2xl border border-slate-200 bg-white animate-pulse" />
        </div>
      </div>
    )
  }

  // ── Load error (not auth) ─────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-red-600" aria-hidden="true" />
          <h1 className="mt-3 font-display text-lg font-bold text-slate-900">Could not load the dossier</h1>
          <p className="mt-2 text-sm text-slate-500">{error ?? 'Something went wrong'}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={() => void load()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors focus-ring"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
            <Link
              href="/platform"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors focus-ring"
            >
              Back to the control plane
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const session = data.supportSession
  const secondsLeft = remaining !== null ? Math.max(0, Math.floor(remaining / 1000)) : null
  const urgent = secondsLeft !== null && secondsLeft <= 60

  const counts: Array<{ label: string; value: number; icon: React.ReactNode }> = [
    { label: 'Users', value: data.counts.users ?? 0, icon: <Users className="h-4 w-4" /> },
    { label: 'Students', value: data.counts.students ?? 0, icon: <GraduationCap className="h-4 w-4" /> },
    { label: 'Teachers', value: data.counts.teachers ?? 0, icon: <BookOpen className="h-4 w-4" /> },
    { label: 'Classes', value: data.counts.classes ?? 0, icon: <LayoutGrid className="h-4 w-4" /> },
    { label: 'Subjects', value: data.counts.subjects ?? 0, icon: <ClipboardList className="h-4 w-4" /> },
    { label: 'Exams', value: data.counts.exams ?? 0, icon: <ClipboardList className="h-4 w-4" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-amber-100 selection:text-amber-900 flex flex-col">
      {/* ── Persistent amber support banner (sticky) ───────────────────── */}
      <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">
              <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
              Platform support session — {session.schoolName}
            </p>
            <p className="mt-1 truncate text-xs text-amber-700/80" title={session.reason}>
              {session.reason}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 lg:justify-end lg:shrink-0">
            <span
              role="status"
              aria-live="polite"
              aria-label={`Support session ${expired ? 'expired' : `expires in ${formatClock(remaining ?? 0)}`}`}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold tabular-nums ${
                expired
                  ? 'border-red-200 bg-red-50 text-red-600'
                  : urgent
                    ? 'border-red-200 bg-red-50 text-red-600 animate-pulse'
                    : 'border-amber-300 bg-amber-100 text-amber-800'
              }`}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {expired ? 'expired' : remaining !== null ? formatClock(remaining) : '—'}
            </span>
            <button
              onClick={() => void exit()}
              disabled={exiting}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-4 text-sm font-semibold text-amber-800 hover:bg-amber-200 transition-colors focus-ring disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {exiting ? 'Exiting…' : 'Exit support session'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Dossier ────────────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-5">
        {/* Read-only identity */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-amber-800">
                  Read-only oversight — support sessions can never modify school data
                </h1>
                <p className="mt-1 text-xs text-slate-600">
                  {session.schoolName} · <span className="font-mono">{session.schoolSlug}</span> · opened{' '}
                  {timeAgo(session.startedAt)} · ends {new Date(session.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`normal-case shrink-0 ${STATUS_STYLES[session.schoolStatus] ?? STATUS_STYLES['TRIAL']}`}
            >
              {session.schoolStatus}
            </Badge>
          </div>
        </motion.div>

        {/* Live counts — read-only */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {counts.map((c) => (
            <DossierCard key={c.label} label={c.label} value={num.format(c.value)} icon={c.icon} />
          ))}
        </div>

        {/* Finance + sessions — read-only */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <IndianRupee className="h-4 w-4 text-teal-600" aria-hidden="true" />
              <h2 className="font-display text-sm font-bold text-slate-900">Fee collection</h2>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Read-only
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Successful payments
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {num.format(data.finance.successfulPayments)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Collected total
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
                  {inr.format(data.finance.collectedTotal)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <MonitorSmartphone className="h-4 w-4 text-amber-600" aria-hidden="true" />
              <h2 className="font-display text-sm font-bold text-slate-900">Active school sessions</h2>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Read-only
              </span>
            </div>
            <p className="mt-3 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {num.format(data.activeSchoolSessions)}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              School users signed in right now — support sessions cannot revoke or impersonate them.
            </p>
          </div>
        </div>

        {/* Activity timeline — read-only */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <History className="h-4 w-4 text-teal-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">Recent school activity</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Read-only · last 20
            </span>
          </div>
          {data.recentActivity.length > 0 ? (
            <ol className="p-4 sm:px-5" aria-label="Recent school activity">
              {data.recentActivity.map((a, i) => (
                <li key={a.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                  {i < data.recentActivity.length - 1 && (
                    <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />
                  )}
                  <span
                    className="relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-amber-500/60 ring-4 ring-white"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="font-mono text-xs font-semibold text-slate-700">{a.action}</p>
                      <span
                        className="text-[11px] tabular-nums text-slate-500"
                        title={new Date(a.at).toLocaleString()}
                      >
                        {timeAgo(a.at)}
                      </span>
                    </div>
                    {a.detail && (
                      <p className="mt-0.5 break-words text-xs leading-snug text-slate-500">{a.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                <History className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">No school activity recorded yet</p>
              <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
                Tenant-side events will appear here as they happen.
              </p>
            </div>
          )}
        </div>

        {/* Platform announcements — read-only */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <Megaphone className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">Platform announcements</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Read-only
            </span>
          </div>
          {data.announcements.length > 0 ? (
            <ul className="divide-y divide-slate-200" aria-label="Current platform announcements">
              {data.announcements.map((a) => {
                const level = ANNOUNCEMENT_LEVELS[a.level] ?? ANNOUNCEMENT_LEVELS['INFO']
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Badge variant="outline" className={`gap-1 normal-case ${level.badge}`}>
                      {level.icon}
                      {a.level}
                    </Badge>
                    <p className="min-w-0 flex-1 truncate text-sm text-slate-700">{a.title}</p>
                    <span
                      className="shrink-0 text-xs tabular-nums text-slate-500"
                      title={new Date(a.createdAt).toLocaleString()}
                    >
                      {timeAgo(a.createdAt)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                <Megaphone className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">No live announcements</p>
              <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
                Nothing platform-wide is being broadcast right now.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-2 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-[11px] text-slate-400">
        <p>
          SCHOLARIO support oversight · read-only by construction · every support session is audited and
          visible to the school
        </p>
      </footer>
    </div>
  )
}
