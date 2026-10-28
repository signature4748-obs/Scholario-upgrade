'use client'

// ============================================================
// SupportAuditTab — school workspace · Support & audit (2026-10-28
// task-focused redesign)
// ------------------------------------------------------------
// ONE coherent operator surface replacing the two stacked lists:
//
//   · Compact header — school identity + status, the LIVE support
//     session state (with countdown) when one exists, and the two
//     primary actions: open a support session / jump to audit
//     history. No repeated school statistics (they live in Overview).
//   · Support sessions — status filter + reason/admin search, detail
//     dialog (scope, window, per-school audit trail), end-session.
//   · Live school-user sessions — the tenant's active sign-ins with
//     individually scoped force-sign-out (impact explained, audited
//     on both planes). Never conflated with support sessions.
//   · Audit history — the authoritative school-scoped trail: search
//     (action/reason/target/actor), category, outcome, date range,
//     server-side pagination, expandable labeled metadata and
//     correlation ids.
//
// All permissions are re-checked SERVER-side on every endpoint; this
// component only decides what to RENDER.
//
// Data (support.access / audit.read gated):
//   GET  /api/platform/support/sessions?schoolId=&status=&q=
//   POST /api/platform/support/sessions/[id]/revoke
//   GET  /api/platform/school-sessions?schoolId=
//   POST /api/platform/school-sessions/[id]/revoke
//   GET  /api/platform/audit?schoolId=&q=&category=&outcome=&from=&to=&page=
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  LifeBuoy,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  auditActionFailed,
  auditActionSummary,
  auditMetaEntries,
  type AuditCategory,
} from '@/lib/platform/audit-format'

// ── API row types ──────────────────────────────────────────────────────────

interface SupportSessionRow {
  id: string
  admin: { id: string; name: string; email: string } | null
  reason: string
  durationMinutes: number
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  live: boolean
}

interface SchoolSessionRow {
  id: string
  user: { id: string; name: string; email: string; role: string }
  createdAt: string
  expiresAt: string
  userAgent: string | null
  ipAddress: string | null
}

interface AuditEvent {
  id: string
  at: string
  action: string
  admin: { id: string; name: string; email: string | null } | null
  targetType: string | null
  targetId: string | null
  schoolId: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  requestId: string | null
}

interface AuditPage {
  total: number
  page: number
  pageSize: number
  events: AuditEvent[]
}

// ── Local helpers ──────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Live mm:ss countdown while a session is active (null = unknown). */
function useCountdown(expiresAt: string | null): number | null {
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

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function remainingLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m left`
  return `${Math.floor(m / 60)}h ${m % 60}m left`
}

/** Short honest device label from a UA string (no analytics-grade parsing). */
function deviceLabel(ua: string | null): string | null {
  if (!ua) return null
  const os =
    /Windows NT 10/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone')
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

const STATUS_TONES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  TRIAL: 'border-slate-200 bg-slate-100 text-slate-600',
}

// ── Small shared bits ──────────────────────────────────────────────────────

function ErrorPanel({
  message,
  onRetry,
  label,
}: {
  message: string
  onRetry: () => void
  label: string
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="flex items-start gap-2.5 text-sm text-red-600">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {message}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        aria-label={label}
        className="mt-3 h-9 border-slate-300 bg-white text-slate-700"
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
        {icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-snug text-slate-500">{hint}</p>
    </div>
  )
}

// ── Support-session detail dialog ──────────────────────────────────────────

function SupportSessionDialog({
  session,
  schoolId,
  canAudit,
  onEnd,
  ending,
  onClose,
}: {
  session: SupportSessionRow | null
  schoolId: string
  canAudit: boolean
  onEnd: (s: SupportSessionRow) => void
  ending: boolean
  onClose: () => void
}) {
  const [trail, setTrail] = useState<AuditEvent[] | null>(null)
  const [trailError, setTrailError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || !canAudit) return
    let cancelled = false
    setTrail(null)
    setTrailError(null)
    platformApi<AuditPage>(
      `/api/platform/audit?schoolId=${schoolId}&action=platform.support_session.&page=1`,
    )
      .then((p) => {
        if (!cancelled) setTrail(p.events)
      })
      .catch((e) => {
        if (!cancelled) setTrailError((e as PlatformApiError).error || 'Could not load the audit trail')
      })
    return () => {
      cancelled = true
    }
  }, [session, schoolId, canAudit])

  if (!session) return null
  const live = session.live

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Support session — {session.admin?.name ?? 'unknown admin'}
          </DialogTitle>
          <DialogDescription>
            Opened {fmtDateTime(session.createdAt)} · {session.durationMinutes} minute window ·{' '}
            {live ? `expires ${fmtDateTime(session.expiresAt)}` : session.revokedAt ? 'ended manually' : 'expired'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Stated reason
            </p>
            <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {session.reason}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Permitted scope
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-snug text-slate-600">
                <li>Read-only oversight of this tenant&apos;s data</li>
                <li>No school identity assumed, no writes possible</li>
                <li>The school can see this visit in its activity log</li>
              </ul>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Opened by
              </p>
              <p className="mt-1.5 text-sm font-medium text-slate-800">{session.admin?.name ?? '—'}</p>
              <p className="font-mono text-[11px] text-slate-500">{session.admin?.email}</p>
              <p className="mt-1.5 text-[11px] tabular-nums text-slate-500">
                Window ends {fmtDateTime(session.expiresAt)}
              </p>
            </div>
          </div>

          {canAudit && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Support-access audit trail (this school)
              </p>
              {trailError ? (
                <p className="mt-1.5 text-xs text-red-600">{trailError}</p>
              ) : trail === null ? (
                <Skeleton className="mt-1.5 h-16 w-full bg-slate-100" />
              ) : trail.length === 0 ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  No support-access events on record for this school yet.
                </p>
              ) : (
                <ul className="mt-1.5 max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {trail.slice(0, 12).map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-slate-700">{auditActionSummary(e.action)}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">{fmtDateTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="h-10 border-slate-300 bg-white text-slate-700">
            Close
          </Button>
          {live && (
            <Button
              variant="destructive"
              onClick={() => onEnd(session)}
              disabled={ending}
              className="h-10"
            >
              {ending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              End session now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

type SupportStatus = 'live' | 'ended' | 'all'

export function SupportAuditTab({
  schoolId,
  schoolName,
  schoolStatus,
  canSupport,
  canAudit,
  activeSupportSessions,
  onOpenSupport,
}: {
  schoolId: string
  schoolName: string
  schoolStatus: string
  canSupport: boolean
  canAudit: boolean
  activeSupportSessions: number
  /** Opens the workspace header's reason+duration+step-up dialog. */
  onOpenSupport: () => void
}) {
  // ── Support sessions ──
  const [supportStatus, setSupportStatus] = useState<SupportStatus>('all')
  const [supportSearch, setSupportSearch] = useState('')
  const [supportQ, setSupportQ] = useState('')
  const [supportSessions, setSupportSessions] = useState<SupportSessionRow[] | null>(null)
  const [supportLoading, setSupportLoading] = useState(true)
  const [supportError, setSupportError] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<SupportSessionRow | null>(null)
  const [endingBusy, setEndingBusy] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState<SupportSessionRow | null>(null)

  // ── School-user sessions ──
  const [schoolSessions, setSchoolSessions] = useState<SchoolSessionRow[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [forceOut, setForceOut] = useState<SchoolSessionRow | null>(null)
  const [forceBusy, setForceBusy] = useState(false)

  // ── Audit history ──
  const [auditSearch, setAuditSearch] = useState('')
  const [auditQ, setAuditQ] = useState('')
  const [category, setCategory] = useState<'ALL' | AuditCategory>('ALL')
  const [outcome, setOutcome] = useState<'ALL' | 'failure' | 'success'>('ALL')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [audit, setAudit] = useState<AuditPage | null>(null)
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const auditSectionRef = useRef<HTMLDivElement>(null)

  // Debounced searches (~350ms) reset pagination.
  useEffect(() => {
    const t = setTimeout(() => {
      setSupportQ(supportSearch.trim())
    }, 350)
    return () => clearTimeout(t)
  }, [supportSearch])

  useEffect(() => {
    const t = setTimeout(() => {
      setAuditQ(auditSearch.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [auditSearch])

  // ── Loaders ──
  const loadSupport = useCallback(async () => {
    setSupportLoading(true)
    setSupportError(null)
    try {
      const params = new URLSearchParams({ schoolId, status: supportStatus })
      if (supportQ) params.set('q', supportQ)
      const res = await platformApi<{ sessions: SupportSessionRow[] }>(
        `/api/platform/support/sessions?${params.toString()}`,
      )
      setSupportSessions(res.sessions)
    } catch (e) {
      setSupportError((e as PlatformApiError).error || 'Failed to load support sessions')
    } finally {
      setSupportLoading(false)
    }
  }, [schoolId, supportStatus, supportQ])

  const loadSchoolSessions = useCallback(async () => {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const res = await platformApi<{ sessions: SchoolSessionRow[] }>(
        `/api/platform/school-sessions?schoolId=${schoolId}&limit=50`,
      )
      setSchoolSessions(res.sessions)
    } catch (e) {
      setSessionsError((e as PlatformApiError).error || 'Failed to load school-user sessions')
    } finally {
      setSessionsLoading(false)
    }
  }, [schoolId])

  const loadAudit = useCallback(async () => {
    if (!canAudit) return
    setAuditLoading(true)
    setAuditError(null)
    try {
      const params = new URLSearchParams({ schoolId, page: String(page) })
      if (auditQ) params.set('q', auditQ)
      if (category !== 'ALL') params.set('category', category)
      if (outcome !== 'ALL') params.set('outcome', outcome)
      if (fromDate) params.set('from', new Date(`${fromDate}T00:00:00`).toISOString())
      if (toDate) params.set('to', new Date(`${toDate}T23:59:59`).toISOString())
      const res = await platformApi<AuditPage>(`/api/platform/audit?${params.toString()}`)
      setAudit(res)
    } catch (e) {
      setAuditError((e as PlatformApiError).error || 'Failed to load the audit trail')
    } finally {
      setAuditLoading(false)
    }
  }, [schoolId, auditQ, category, outcome, fromDate, toDate, page, canAudit])

  useEffect(() => {
    void loadSupport()
  }, [loadSupport])
  useEffect(() => {
    if (canSupport) void loadSchoolSessions()
  }, [loadSchoolSessions, canSupport])
  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  // ── Actions ──
  const endSession = async (s: SupportSessionRow) => {
    setEndingBusy(true)
    try {
      await platformApi(`/api/platform/support/sessions/${s.id}/revoke`, { method: 'POST' })
      toast.success('Support session ended — audited.')
      setConfirmEnd(null)
      setDetailSession(null)
      void loadSupport()
    } catch (e) {
      toast.error('Could not end the session', {
        description: (e as PlatformApiError).error || 'unknown error',
      })
    } finally {
      setEndingBusy(false)
    }
  }

  const forceSignOut = async (s: SchoolSessionRow) => {
    setForceBusy(true)
    try {
      await platformApi(`/api/platform/school-sessions/${s.id}/revoke`, { method: 'POST' })
      toast.success(`${s.user.name ?? s.user.email} signed out — audited on both planes.`)
      setForceOut(null)
      void loadSchoolSessions()
    } catch (e) {
      toast.error('Force sign-out failed', {
        description: (e as PlatformApiError).error || 'unknown error',
      })
    } finally {
      setForceBusy(false)
    }
  }

  // ── Derived ──
  const liveSupport = useMemo(
    () => (supportSessions ?? []).filter((s) => s.live),
    [supportSessions],
  )
  const liveForHeader = liveSupport.length > 0 ? liveSupport[0]! : null
  const headerCountdown = useCountdown(liveForHeader?.expiresAt ?? null)
  const totalPages = audit ? Math.max(1, Math.ceil(audit.total / audit.pageSize)) : 1

  const scrollToAudit = () => {
    auditSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const focusable = auditSectionRef.current?.querySelector<HTMLElement>('input, button')
    focusable?.focus({ preventScroll: true })
  }

  return (
    <div className="space-y-8 sm:space-y-10" aria-label="Support and audit">
      {/* ── A · Compact header ─────────────────────────────────────────── */}
      <section
        id="section-support"
        aria-labelledby="section-support-heading"
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h3 id="section-support-heading" className="font-display text-sm font-bold text-slate-900">
              {schoolName}
              <Badge
                variant="outline"
                className={`ml-2 align-middle normal-case ${STATUS_TONES[schoolStatus] ?? STATUS_TONES['TRIAL']}`}
              >
                {schoolStatus}
              </Badge>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              {liveForHeader ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700" role="status" aria-live="polite">
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                  </span>
                  Support session live
                  {headerCountdown !== null && headerCountdown > 0 ? (
                    <> · ends in <span className="font-mono tabular-nums">{fmtClock(headerCountdown)}</span></>
                  ) : null}
                </span>
              ) : activeSupportSessions > 0 ? (
                <span>{activeSupportSessions} support session(s) on record for this school</span>
              ) : (
                <span>No support session is currently open into this tenant</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSupport && !liveForHeader && (
              <Button
                onClick={onOpenSupport}
                className="h-10 bg-amber-500 font-semibold text-slate-900 hover:bg-amber-600 focus-ring"
              >
                <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                Open support session
              </Button>
            )}
            {canSupport && liveForHeader && (
              <Button
                variant="outline"
                onClick={() => setConfirmEnd(liveForHeader)}
                className="h-10 border-red-200 bg-white text-red-600 hover:bg-red-50 focus-ring"
              >
                End live session
              </Button>
            )}
            {canAudit && (
              <Button
                variant="outline"
                onClick={scrollToAudit}
                className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
              >
                <ScrollText className="h-4 w-4" aria-hidden="true" />
                View audit history
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ── B · Support sessions ───────────────────────────────────────── */}
      {canSupport && (
        <section aria-labelledby="support-sessions-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <h3 id="support-sessions-heading" className="font-display text-sm font-bold text-slate-900">
              Support sessions
            </h3>
            <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
              <div className="relative w-full sm:w-56">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={supportSearch}
                  onChange={(e) => setSupportSearch(e.target.value)}
                  placeholder="Search reason or admin…"
                  aria-label="Search support sessions"
                  className="h-10 border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40"
                />
              </div>
              <div role="group" aria-label="Filter support sessions by status" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                {(['live', 'ended', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSupportStatus(s)}
                    aria-pressed={supportStatus === s}
                    className={`h-8 rounded-md px-3 text-xs font-semibold capitalize transition-colors focus-ring ${
                      supportStatus === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {s === 'live' ? 'Live' : s === 'ended' ? 'Ended' : 'All'}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() => void loadSupport()}
                disabled={supportLoading}
                aria-label="Refresh support sessions"
                className="h-10 w-10 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-100"
              >
                <RefreshCw className={`h-4 w-4 ${supportLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {supportError ? (
              <div className="p-4">
                <ErrorPanel message={supportError} onRetry={() => void loadSupport()} label="Retry support sessions" />
              </div>
            ) : supportLoading && supportSessions === null ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading support sessions">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-slate-100" />
                ))}
              </div>
            ) : (supportSessions ?? []).length === 0 ? (
              <EmptyState
                icon={<LifeBuoy className="h-5 w-5" aria-hidden="true" />}
                title={
                  supportStatus === 'live'
                    ? 'No live support session'
                    : supportQ
                      ? 'Nothing matches the search'
                      : 'No support sessions on record'
                }
                hint={
                  supportStatus === 'live'
                    ? 'No oversight session is currently open into this tenant. Open one with a reason and duration when a school issue needs investigation.'
                    : supportQ
                      ? 'Try a different reason or administrator name, or clear the search.'
                      : 'When platform staff open a read-only oversight session for this school, it will be listed here with its reason and window.'
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100" aria-label="Support sessions">
                {(supportSessions ?? []).map((s) => {
                  const live = s.live
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setDetailSession(s)}
                        aria-label={`Support session details: ${s.reason}`}
                        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-ring sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {s.admin?.name ?? 'unknown admin'}
                            </span>
                            {live ? (
                              <Badge variant="outline" className="normal-case border-emerald-200 bg-emerald-50 text-emerald-700">
                                live · {remainingLabel(s.expiresAt)}
                              </Badge>
                            ) : s.revokedAt ? (
                              <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-500">
                                ended manually
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="normal-case border-slate-200 bg-slate-50 text-slate-400">
                                expired
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-600" title={s.reason}>
                            {s.reason}
                          </p>
                          <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                            <Clock className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                            opened {fmtDateTime(s.createdAt)} · {s.durationMinutes} min window · expires{' '}
                            {fmtDateTime(s.expiresAt)}
                          </p>
                        </div>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 -rotate-90 text-slate-400"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── C · Live school-user sessions ──────────────────────────────── */}
      {canSupport && (
        <section aria-labelledby="school-sessions-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 id="school-sessions-heading" className="font-display text-sm font-bold text-slate-900">
              Live school-user sessions
            </h3>
            <p className="text-xs text-slate-500">
              The tenant&apos;s own sign-ins — separate from platform support sessions.
            </p>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {sessionsError ? (
              <div className="p-4">
                <ErrorPanel
                  message={sessionsError}
                  onRetry={() => void loadSchoolSessions()}
                  label="Retry school-user sessions"
                />
              </div>
            ) : sessionsLoading && schoolSessions === null ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading school-user sessions">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-slate-100" />
                ))}
              </div>
            ) : (schoolSessions ?? []).length === 0 ? (
              <EmptyState
                icon={<MonitorSmartphone className="h-5 w-5" aria-hidden="true" />}
                title="No school users signed in"
                hint="None of this school's users currently holds a live session. Force sign-out applies to a single live session — there is nothing to revoke."
              />
            ) : (
              <ul className="divide-y divide-slate-100" aria-label="Live school-user sessions">
                {(schoolSessions ?? []).map((s) => {
                  const device = deviceLabel(s.userAgent)
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{s.user.name ?? '—'}</span>
                          <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-600">
                            {s.user.role.toLowerCase()}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          signed in {fmtDateTime(s.createdAt)} · expires {fmtDateTime(s.expiresAt)}
                          {device ? ` · ${device}` : ''}
                          {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setForceOut(s)}
                        className="h-9 border-red-200 bg-white text-red-600 hover:bg-red-50 focus-ring"
                      >
                        Force sign-out
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── D · Audit history ──────────────────────────────────────────── */}
      {canAudit && (
        <section ref={auditSectionRef} id="section-audit" aria-labelledby="section-audit-heading" className="scroll-mt-24">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 id="section-audit-heading" className="font-display text-sm font-bold text-slate-900">
              Audit history
            </h3>
            <Button
              variant="outline"
              onClick={() => void loadAudit()}
              disabled={auditLoading}
              aria-label="Refresh audit history"
              className="h-10 w-10 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-100"
            >
              <RefreshCw className={`h-4 w-4 ${auditLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Every audited platform action targeting this school — searchable, filterable, read-only.
          </p>

          {/* Filter bar */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search action, reason, target, actor…"
                aria-label="Search audit events"
                className="h-10 border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40"
              />
            </div>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v as 'ALL' | AuditCategory)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Filter by event category" className="h-10 border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-500/40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white text-slate-900">
                <SelectItem value="ALL" className="focus:bg-slate-100">All categories</SelectItem>
                {AUDIT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="focus:bg-slate-100">
                    {AUDIT_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={outcome}
              onValueChange={(v) => {
                setOutcome(v as 'ALL' | 'failure' | 'success')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Filter by outcome" className="h-10 border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-500/40">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white text-slate-900">
                <SelectItem value="ALL" className="focus:bg-slate-100">Any outcome</SelectItem>
                <SelectItem value="failure" className="focus:bg-slate-100">Failures only</SelectItem>
                <SelectItem value="success" className="focus:bg-slate-100">Non-failures</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label htmlFor="audit-from" className="sr-only">From date</Label>
                <Input
                  id="audit-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value)
                    setPage(1)
                  }}
                  aria-label="Filter events from this date"
                  className="h-10 border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-500/40"
                />
              </div>
              <span className="text-xs text-slate-400" aria-hidden="true">to</span>
              <div className="flex-1">
                <Label htmlFor="audit-to" className="sr-only">To date</Label>
                <Input
                  id="audit-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value)
                    setPage(1)
                  }}
                  aria-label="Filter events up to this date"
                  className="h-10 border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-500/40"
                />
              </div>
            </div>
            {(auditQ || category !== 'ALL' || outcome !== 'ALL' || fromDate || toDate) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setAuditSearch('')
                  setAuditQ('')
                  setCategory('ALL')
                  setOutcome('ALL')
                  setFromDate('')
                  setToDate('')
                  setPage(1)
                }}
                className="h-10 justify-start text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                Clear all filters
              </Button>
            )}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {auditError ? (
              <div className="p-4">
                <ErrorPanel message={auditError} onRetry={() => void loadAudit()} label="Retry audit history" />
              </div>
            ) : auditLoading && !audit ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading audit history">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-slate-100" />
                ))}
              </div>
            ) : (audit?.events.length ?? 0) === 0 ? (
              <EmptyState
                icon={<ScrollText className="h-5 w-5" aria-hidden="true" />}
                title="No audit events match"
                hint={
                  auditQ || category !== 'ALL' || outcome !== 'ALL' || fromDate || toDate
                    ? 'Nothing matches the current search and filters — clear them to see the full trail.'
                    : 'No platform actions targeting this school have been audited yet.'
                }
              />
            ) : (
              <>
                <ul className="divide-y divide-slate-100" aria-label="Audit events">
                  {(audit?.events ?? []).map((e) => {
                    const failed = auditActionFailed(e.action)
                    const open = expanded === e.id
                    const meta = auditMetaEntries(e.metadata)
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : e.id)}
                          aria-expanded={open}
                          aria-label={`${auditActionSummary(e.action)} — ${fmtDateTime(e.at)}. ${open ? 'Collapse' : 'Expand'} details`}
                          className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-ring sm:px-5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">
                                {auditActionSummary(e.action)}
                              </span>
                              <Badge
                                variant="outline"
                                className={`normal-case ${
                                  failed
                                    ? 'border-red-200 bg-red-50 text-red-600'
                                    : 'border-slate-200 bg-slate-100 text-slate-600'
                                }`}
                              >
                                {failed ? 'failure' : 'completed'}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                              {fmtDateTime(e.at)}
                              {e.admin ? ` · ${e.admin.name}` : ' · system'}
                              {e.reason ? ' · reason recorded' : ''}
                            </p>
                          </div>
                          <ChevronDown
                            className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        {open && (
                          <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                              <div>
                                <dt className="font-semibold uppercase tracking-wider text-slate-500">Action</dt>
                                <dd className="mt-0.5 font-mono text-[11px] text-slate-700">{e.action}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold uppercase tracking-wider text-slate-500">Actor</dt>
                                <dd className="mt-0.5 text-slate-700">
                                  {e.admin ? (
                                    <>
                                      {e.admin.name}
                                      {e.admin.email ? (
                                        <span className="font-mono text-[11px] text-slate-400"> · {e.admin.email}</span>
                                      ) : null}
                                    </>
                                  ) : (
                                    'System (no admin)'
                                  )}
                                </dd>
                              </div>
                              {e.targetType && (
                                <div>
                                  <dt className="font-semibold uppercase tracking-wider text-slate-500">Affected resource</dt>
                                  <dd className="mt-0.5 text-slate-700">
                                    {e.targetType}
                                    {e.targetId ? (
                                      <span className="font-mono text-[11px] text-slate-400"> · {e.targetId.slice(0, 14)}…</span>
                                    ) : null}
                                  </dd>
                                </div>
                              )}
                              {e.reason && (
                                <div className="sm:col-span-2">
                                  <dt className="font-semibold uppercase tracking-wider text-slate-500">Reason</dt>
                                  <dd className="mt-0.5 text-slate-700">{e.reason}</dd>
                                </div>
                              )}
                              {meta.length > 0 && (
                                <div className="sm:col-span-2">
                                  <dt className="font-semibold uppercase tracking-wider text-slate-500">Details</dt>
                                  <dd className="mt-1">
                                    <dl className="flex flex-wrap gap-1.5">
                                      {meta.map((m) => (
                                        <span
                                          key={m.key}
                                          className="rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] text-slate-600"
                                          title={`${m.label}: ${m.value}`}
                                        >
                                          <span className="font-semibold text-slate-500">{m.label}:</span> {m.value}
                                        </span>
                                      ))}
                                    </dl>
                                  </dd>
                                </div>
                              )}
                              {(e.requestId || e.ip) && (
                                <div className="sm:col-span-2">
                                  <dt className="font-semibold uppercase tracking-wider text-slate-500">Correlation</dt>
                                  <dd className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-slate-400">
                                    {e.requestId && <span title={e.requestId}>req {e.requestId.slice(0, 16)}…</span>}
                                    {e.ip && <span>{e.ip}</span>}
                                  </dd>
                                </div>
                              )}
                            </dl>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
                  <p className="text-xs tabular-nums text-slate-500">
                    Page {audit?.page ?? 1} of {totalPages} · {audit?.total ?? 0} event
                    {(audit?.total ?? 0) === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(audit?.page ?? 1) <= 1 || auditLoading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                    >
                      <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(audit?.page ?? 1) >= totalPages || auditLoading}
                      onClick={() => setPage((p) => p + 1)}
                      className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                    >
                      Next
                      <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <p className="mt-2 text-[11px] text-slate-400">
            Read-only trail. Sensitive values (passwords, gateway secrets, activation codes, session
            tokens) are redacted before events are written — they never appear here.
          </p>
        </section>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <SupportSessionDialog
        session={detailSession}
        schoolId={schoolId}
        canAudit={canAudit}
        onEnd={(s) => setConfirmEnd(s)}
        ending={endingBusy}
        onClose={() => setDetailSession(null)}
      />

      {confirmEnd && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmEnd(null) }}>
          <DialogContent className="border-slate-200 bg-white text-slate-900 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display">
                <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
                End support session
              </DialogTitle>
              <DialogDescription>
                End the live read-only session {confirmEnd.admin?.name ?? ''} opened into this school
                (reason: &ldquo;{confirmEnd.reason}&rdquo;)? The oversight view closes immediately and the
                action is audited.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmEnd(null)} className="h-10 border-slate-300 bg-white text-slate-700">
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void endSession(confirmEnd)} disabled={endingBusy} className="h-10">
                {endingBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                End session
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {forceOut && (
        <Dialog open onOpenChange={(o) => { if (!o) setForceOut(null) }}>
          <DialogContent className="border-slate-200 bg-white text-slate-900 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display">
                <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
                Force sign-out — {forceOut.user.name ?? forceOut.user.email}
              </DialogTitle>
              <DialogDescription>
                This revokes <strong>this one session</strong> (
                {deviceLabel(forceOut.userAgent) ?? 'unknown device'}
                {forceOut.ipAddress ? `, ${forceOut.ipAddress}` : ''}, signed in{' '}
                {fmtDateTime(forceOut.createdAt)}). The user is signed out of that session immediately
                and must sign in again — other sessions are untouched. This does NOT change their
                password, permissions, or account. The action is recorded on the platform audit trail
                and the school&apos;s activity log.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForceOut(null)} className="h-10 border-slate-300 bg-white text-slate-700">
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void forceSignOut(forceOut)} disabled={forceBusy} className="h-10">
                {forceBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Force sign-out
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
