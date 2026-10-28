'use client'

// ============================================================
// SupportOversightView — /platform/support/view (2026-10-28
// task-focused redesign)
// ------------------------------------------------------------
// The READ-ONLY troubleshooting workspace of an active support
// session. A support session exists to INVESTIGATE a school issue —
// this surface is organized around that job, not as a duplicate of
// the school overview:
//
//   · Context strip — school identity, the STATED ISSUE (reason),
//     the live countdown, and the permitted scope, always visible.
//   · Diagnostics — issue-focused evidence:
//       · Fee ledger — collected totals + FAILED payments with record
//         references (fee-ledger discrepancy investigations).
//       · Sign-in health — live session count + recent sign-ins with
//         device/IP (session & authentication investigations).
//       · Records — entity counts (missing-record checks).
//   · School activity journal — the tenant's own events (failed
//     operations / missing records evidence).
//   · Hand-off — a link into the normal Super Admin school management
//     screen for any corrective action (support access itself can
//     never write).
//
// Authenticated exclusively by the SUPPORT token space. Every section
// communicates read-only; there is no write affordance anywhere.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  History,
  IndianRupee,
  LifeBuoy,
  Loader2,
  Lock,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { platformApi, exitSupportSession, type PlatformApiError } from '../platform-client'

// ── Types (API contract) ───────────────────────────────────────────────────

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
  diagnostics: {
    fees: {
      successfulPayments: number
      collectedTotal: number
      failedRecent: Array<{
        id: string
        amount: number
        method: string | null
        status: string
        transactionId: string | null
        note: string | null
        feeId: string | null
        at: string
      }>
    }
    signIns: {
      activeCount: number
      recent: Array<{
        id: string
        userName: string
        userRole: string
        createdAt: string
        expiresAt: string
        live: boolean
        userAgent: string | null
        ipAddress: string | null
      }>
    }
  }
  recentActivity: Array<{ id: string; action: string; detail: string | null; at: string }>
}

const num = new Intl.NumberFormat('en-IN')
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

// ── Small local helpers ────────────────────────────────────────────────────

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

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function deviceLabel(ua: string | null): string | null {
  if (!ua) return null
  const os =
    /Windows NT 10/.test(ua) ? 'Windows'
    : /iPad/.test(ua) ? 'iPad'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : null
  return [browser, os].filter(Boolean).join(' · ') || 'unknown device'
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  TRIAL: 'border-slate-200 bg-slate-100 text-slate-600',
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
        setError(err.error || 'Failed to load the support workspace')
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
            <LifeBuoy className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold text-slate-900">No active support session</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            This workspace is only available while a time-boxed, reason-bearing support session is
            live. Open one from a school&apos;s detail page in the control plane.
          </p>
          <Link
            href="/platform"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-ring"
          >
            Back to the control plane
          </Link>
        </div>
      </div>
    )
  }

  // ── Boot state ────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="w-full max-w-xl space-y-4" aria-busy="true" aria-label="Loading support session">
          <div className="h-16 animate-pulse rounded-2xl border border-amber-200 bg-amber-50" />
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    )
  }

  // ── Load error (not auth) ─────────────────────────────────────────────
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-red-600" aria-hidden="true" />
          <h1 className="mt-3 font-display text-lg font-bold text-slate-900">Could not load the workspace</h1>
          <p className="mt-2 text-sm text-slate-500">{error ?? 'Something went wrong'}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={() => void load()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-ring"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
            <Link
              href="/platform"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
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
  const fees = data.diagnostics.fees
  const signIns = data.diagnostics.signIns

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 selection:bg-amber-100 selection:text-amber-900">
      {/* ── Persistent amber support banner (sticky) ───────────────────── */}
      <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2.5 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">
              <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
              Support session — {session.schoolName}
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
                    ? 'animate-pulse border-red-200 bg-red-50 text-red-600'
                    : 'border-amber-300 bg-amber-100 text-amber-800'
              }`}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {expired ? 'expired' : remaining !== null ? formatClock(remaining) : '—'}
            </span>
            <button
              onClick={() => void exit()}
              disabled={exiting}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-4 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-200 focus-ring disabled:opacity-60"
            >
              {exiting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              {exiting ? 'Exiting…' : 'Exit support session'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 px-4 py-6 sm:px-6 lg:py-8">
        {/* Context strip — identity, stated issue, scope, hand-off */}
        <section
          aria-label="Support session context"
          className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold tracking-tight text-amber-800">
                  {session.schoolName}
                  <span className="rounded border border-amber-300 bg-white/70 px-1.5 py-px font-mono text-[11px] font-normal text-amber-700">
                    {session.schoolSlug}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold normal-case ${
                      STATUS_STYLES[session.schoolStatus] ?? STATUS_STYLES['TRIAL']
                    }`}
                  >
                    {session.schoolStatus}
                  </span>
                </h1>
                <p className="mt-1.5 text-xs text-slate-600">
                  <span className="font-semibold uppercase tracking-wider text-slate-500">Stated issue: </span>
                  {session.reason}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                  opened {timeAgo(session.startedAt)} · window ends {fmtTime(session.expiresAt)} ·
                  read-only — no school data can be modified, and the school can see this visit
                </p>
              </div>
            </div>
            <Link
              href={`/platform/schools/${session.schoolId}`}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              School management
              <span className="sr-only">(opens the control-plane screen for corrective actions)</span>
            </Link>
          </div>
        </section>

        {/* Diagnostics — fee ledger */}
        <section
          aria-label="Fee ledger diagnostics"
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <IndianRupee className="h-4 w-4 text-teal-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">Fee ledger</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Read-only evidence
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Successful payments</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-slate-900">
                {num.format(fees.successfulPayments)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Collected total</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums text-emerald-700">
                {inr.format(fees.collectedTotal)}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Failed / non-successful payments (recent)
              </p>
              <p
                className={`mt-1 font-display text-xl font-bold tabular-nums ${
                  fees.failedRecent.length > 0 ? 'text-red-600' : 'text-slate-900'
                }`}
              >
                {fees.failedRecent.length > 0 ? `${fees.failedRecent.length} shown below` : 'None on record'}
              </p>
            </div>
          </div>
          {fees.failedRecent.length > 0 ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-200" aria-label="Recent failed payments">
              {fees.failedRecent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {inr.format(p.amount)}
                      <span className="ml-2 text-xs font-normal text-slate-500">{p.status}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={p.id}>
                      payment {p.id.slice(0, 14)}…
                      {p.feeId ? ` · fee ${p.feeId.slice(0, 10)}…` : ''}
                      {p.transactionId ? ` · ref ${p.transactionId}` : ''}
                      {p.method ? ` · ${p.method}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500" title={new Date(p.at).toLocaleString()}>
                    {timeAgo(p.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
              No failed or non-successful payment rows exist for this tenant — a reported ledger
              discrepancy is not corroborated by the payments table.
            </p>
          )}
        </section>

        {/* Diagnostics — sign-in health */}
        <section
          aria-label="Sign-in diagnostics"
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <MonitorSmartphone className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">Sign-in health</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Read-only evidence
            </span>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <p className="text-xs text-slate-500">
              <span className="font-display text-lg font-bold tabular-nums text-slate-900">
                {num.format(signIns.activeCount)}
              </span>{' '}
              live school-user session{signIns.activeCount === 1 ? '' : 's'} — support sessions cannot
              revoke or impersonate them.
            </p>
            <ul className="mt-3 divide-y divide-slate-100" aria-label="Recent sign-ins">
              {signIns.recent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {s.userName ?? '—'}
                      <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-slate-400">
                        {s.userRole.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      {deviceLabel(s.userAgent) ?? 'unknown device'}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold normal-case tabular-nums ${
                      s.live
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {s.live ? `live · ends ${fmtTime(s.expiresAt)}` : `ended · was until ${fmtTime(s.expiresAt)}`}
                  </span>
                </li>
              ))}
              {signIns.recent.length === 0 && (
                <li className="py-3 text-xs text-slate-500">
                  No school-user sessions on record — a &ldquo;cannot sign in&rdquo; report is not
                  corroborated by any recent session row.
                </li>
              )}
            </ul>
          </div>
        </section>

        {/* Records — compact counts strip (missing-record checks) */}
        <section
          aria-label="Record counts"
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <ClipboardList className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">Records</h2>
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Read-only counts
            </span>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
            {(
              [
                ['Users', data.counts.users],
                ['Students', data.counts.students],
                ['Teachers', data.counts.teachers],
                ['Classes', data.counts.classes],
                ['Subjects', data.counts.subjects],
                ['Exams', data.counts.exams],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-[72px]">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900">
                  {num.format(value ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* School activity journal — failed-operations evidence */}
        <section
          aria-label="Recent school activity"
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <History className="h-4 w-4 text-teal-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900">School activity journal</h2>
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
                Tenant-side events will appear here as they happen — a reported &ldquo;failed
                operation&rdquo; has no journal corroboration right now.
              </p>
            </div>
          )}
        </section>

        {error && (
          <p role="alert" className="flex items-center gap-2 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-[11px] text-slate-400">
        <p>
          SCHOLARIO support workspace · read-only by construction · every support session is audited
          and visible to the school
        </p>
      </footer>
    </div>
  )
}
