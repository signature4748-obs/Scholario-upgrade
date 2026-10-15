'use client'

// ============================================================
// SchoolsModule — the platform-wide school ledger (PHASE 6)
// ------------------------------------------------------------
// /platform/schools: searchable, status-filtered, paginated list of
// every tenant with live counts, plus the PENDING provisioning
// dialog (POST /api/platform/schools). Desktop renders a table,
// small screens render cards — same data, no horizontal overflow.
//
// PHASE 10 (two-project topology): every row carries the tenant's
// CANONICAL doors (loginUrl/publicUrl from SCHOOL_APP_BASE_URL —
// never guessed). The table surfaces the login URL with copy
// controls; copies always resolve relative URLs against the
// current origin so the operator hands out a working link.
//
// P0-B (single source of truth): the row now carries the full
// operator truth — demo/production marker (isDemo), the FOUNDING
// principal's email + credential state, BOTH canonical doors with
// copy AND open actions, and a toolbar Refresh. Data comes from the
// authenticated server API only (no mock/seed arrays anywhere).
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Search,
  Plus,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Users,
  GraduationCap,
  BookOpen,
  School as SchoolIcon,
  MapPin,
  CalendarDays,
  Copy,
  Check,
  ExternalLink,
  Globe,
  UserCog,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { ProvisionWizard } from './provision-wizard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ── Types (API contract, worklog Task 6-1 + P0-B additions) ───────────────

interface PrincipalSummary {
  email: string
  name: string | null
  status: string
  credentialState: 'BOOTSTRAP_PENDING' | 'OWNED' | 'UNKNOWN'
  lastLoginAt: string | null
  // Phase 3 — invite-email delivery state (SENT | QUEUED | PENDING |
  // FAILED | NONE).
  invitation?: string
}

interface SubscriptionChip {
  state: string
  businessAllowed: boolean
  renewalRequired: boolean
  planCode: string | null
  billingModel: string | null
  periodEnd: string | null
  graceDays: number | null
}

interface SchoolRow {
  id: string
  name: string
  slug: string
  code: string
  domain: string | null
  city: string | null
  plan: string
  status: string
  board: string
  academicYear: string | null
  featureFlags: string
  isDemo: boolean
  createdAt: string
  counts: { users: number; students: number; teachers: number; classes: number }
  /** The SAME computed entitlement state the school plane enforces. */
  subscription: SubscriptionChip
  // The founding principal's access state (null only for hand-crafted
  // data — the wizard always provisions one).
  principal: PrincipalSummary | null
  // TWO-PROJECT TOPOLOGY — canonical doors (may be RELATIVE when
  // SCHOOL_APP_BASE_URL is unset; the unified deployment serves both
  // planes, so /s/<slug>/login on its own origin is correct).
  loginUrl: string
  publicUrl: string
}

interface SchoolsData {
  total: number
  page: number
  pageSize: number
  schools: SchoolRow[]
  /** KPI aggregates for the CURRENT filter set (DB-derived). */
  summary?: {
    total: number
    byStatus: Record<string, number>
    bySubscriptionState: Record<string, number>
    demo: number
    production: number
    onboardingReady: number | null
    subscriptionsExpiringWithin30Days: number
  }
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'TRIAL'
type SubStateFilter = 'ALL' | 'ACTIVE' | 'GRACE' | 'RESTRICTED' | 'SUSPENDED' | 'NOT_ACTIVATED'
type BillingModelFilter = 'ALL' | 'SCHOOL_WIDE' | 'PER_STUDENT' | 'MIXED'
type DemoFilter = 'ALL' | 'demo' | 'production'
type ReadinessFilter = 'ALL' | 'ready' | 'incomplete'
type SortKey = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'updated_desc'

const SORT_LABELS: Record<SortKey, string> = {
  created_desc: 'Newest first',
  created_asc: 'Oldest first',
  name_asc: 'Name A→Z',
  name_desc: 'Name Z→A',
  updated_desc: 'Recently updated',
}

const SUB_STATE_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  GRACE: 'border-amber-200 bg-amber-50 text-amber-700',
  RESTRICTED: 'border-orange-200 bg-orange-50 text-orange-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  NOT_ACTIVATED: 'border-slate-200 bg-slate-100 text-slate-600',
}

function SubStateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${SUB_STATE_STYLES[state] ?? SUB_STATE_STYLES['NOT_ACTIVATED']}`}>
      {state.replace(/_/g, ' ')}
    </Badge>
  )
}


const num = new Intl.NumberFormat('en-IN')

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

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES['TRIAL']}`}>
      {status}
    </Badge>
  )
}

/** Demo/production marker — the classification truth (P0-B). */
function DemoBadge({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) {
    return (
      <Badge variant="outline" className="normal-case border-slate-200 bg-white text-slate-500" title="Production tenant">
        Production
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="normal-case border-violet-200 bg-violet-50 text-violet-700"
      title="Demo/showcase tenant (seed corpus or demo transform)"
    >
      Demo
    </Badge>
  )
}

// ── Access copy/open controls (PHASE 10 — school access truth) ────────────

/** Resolve a possibly-relative plane URL to an absolute one (click-time only — window exists). */
function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

/**
 * Copy button with inline "Copied" feedback (icon swaps to Check for
 * ~1.5s; the text variant swaps its label). 44×44 touch target, quiet
 * slate styling, and stopPropagation on click + keydown so the
 * surrounding row/card navigation never fires from inside it.
 */
function CopyControl({
  value,
  absolute,
  label,
  text,
}: {
  value: string
  /** Resolve a leading '/' against window.location.origin before copying. */
  absolute?: boolean
  label: string
  /** Optional visible text label (mobile cards); swaps to "Copied" on success. */
  text?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const payload = absolute ? absoluteUrl(value) : value
    void navigator.clipboard.writeText(payload).then(
      () => {
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* clipboard unavailable — no success feedback (honest failure) */
      },
    )
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={
        text
          ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
          : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
      }
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {text ? <span>{copied ? 'Copied' : text}</span> : null}
    </button>
  )
}

/**
 * Open-in-new-tab control for a canonical door. Relative URLs are
 * resolved against the current origin at click time (the unified
 * deployment serves both planes); absolute cross-plane URLs open as
 * they are. stopPropagation keeps the row-click navigation intact.
 */
function OpenControl({
  url,
  label,
  icon,
  text,
}: {
  url: string
  label: string
  icon?: React.ReactNode
  /** Optional visible text label (mobile cards). */
  text?: string
}) {
  const onOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    window.open(absoluteUrl(url), '_blank', 'noopener,noreferrer')
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={
        text
          ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
          : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
      }
    >
      {icon ?? <ExternalLink className="h-4 w-4" aria-hidden="true" />}
      {text ? <span>{text}</span> : null}
    </button>
  )
}

/** The founding principal line: email + credential/invite state hints. */
function PrincipalLine({ principal }: { principal: PrincipalSummary | null }) {
  if (!principal) {
    return <p className="truncate text-[11px] text-slate-400">no principal on record</p>
  }
  const inviteFailed = principal.invitation === 'FAILED'
  return (
    <p
      className="flex min-w-0 items-center gap-1 truncate text-[11px] text-slate-500"
      title={`Founding principal: ${principal.name ?? principal.email}${principal.lastLoginAt ? ` · last sign-in ${new Date(principal.lastLoginAt).toLocaleString()}` : ' · never signed in'}${principal.invitation ? ` · invite email: ${principal.invitation}` : ''}`}
    >
      <UserCog className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
      <span className="truncate font-mono">{principal.email}</span>
      {principal.credentialState === 'BOOTSTRAP_PENDING' && (
        <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-medium text-amber-700" title="One-time bootstrap credential not yet replaced by the principal">
          bootstrap
        </span>
      )}
      {/* Phase 3 — invite-delivery warning chip: only surfaces when the
          delivery failed while the credential is still pending (the
          school record's Access card is the management surface). */}
      {inviteFailed && principal.credentialState === 'BOOTSTRAP_PENDING' && (
        <span
          className="shrink-0 rounded border border-red-200 bg-red-50 px-1 text-[10px] font-medium text-red-600"
          title="Invite email failed — confirm credential delivery or re-issue it from the school record's Access card"
        >
          invite failed
        </span>
      )}
    </p>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolsModule() {
  const { can } = usePlatformSession()
  const router = useRouter()

  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [subscriptionState, setSubscriptionState] = useState<SubStateFilter>('ALL')
  const [billingModel, setBillingModel] = useState<BillingModelFilter>('ALL')
  const [demo, setDemo] = useState<DemoFilter>('ALL')
  const [readiness, setReadiness] = useState<ReadinessFilter>('ALL')
  const [sort, setSort] = useState<SortKey>('created_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SchoolsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const requestId = useRef(0)

  const filtersActive =
    q !== '' || status !== 'ALL' || subscriptionState !== 'ALL' || billingModel !== 'ALL' || demo !== 'ALL' || readiness !== 'ALL'

  // Debounced search (~300ms) → resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status !== 'ALL') params.set('status', status)
      if (subscriptionState !== 'ALL') params.set('subscriptionState', subscriptionState)
      if (billingModel !== 'ALL') params.set('billingModel', billingModel)
      if (demo !== 'ALL') params.set('demo', demo)
      if (readiness !== 'ALL') params.set('readiness', readiness)
      if (sort !== 'created_desc') params.set('sort', sort)
      params.set('page', String(page))
      params.set('summary', '1')
      const result = await platformApi<SchoolsData>(`/api/platform/schools?${params.toString()}`)
      if (id === requestId.current) setData(result)
    } catch (e) {
      if (id === requestId.current) {
        const err = e as PlatformApiError
        setError(err.error || 'Failed to load schools')
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [q, status, subscriptionState, billingModel, demo, readiness, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const canProvision = can('schools.provision')
  const showSkeletonRows = loading || !data

  const openSchool = (id: string) => router.push(`/platform/schools/${id}`)

  return (
    <section aria-labelledby="schools-heading" className="space-y-4 sm:space-y-5">
      {/* Page header */}
      <div>
        <h1
          id="schools-heading"
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900"
        >
          Schools
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Every tenant on the platform{data ? ` · ${num.format(data.total)} total` : ''} · click a school to
          manage it
        </p>
      </div>

      {/* KPI summary — every number DB-derived for the CURRENT filter
          set (the same query that feeds the table below; zero records
          and unavailable data are distinct from a failed load). */}
      {data?.summary && (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          aria-label="Schools summary for the current filters"
        >
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Schools</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{num.format(data.summary.total)}</p>
            <p className="text-[10px] text-slate-400 tabular-nums">{data.summary.demo} demo · {data.summary.production} production</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Active</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-800">{num.format(data.summary.byStatus.ACTIVE ?? 0)}</p>
            <p className="text-[10px] text-emerald-600/80 tabular-nums">susp {data.summary.byStatus.SUSPENDED ?? 0} · pend {data.summary.byStatus.PENDING ?? 0}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Subscription active</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{num.format(data.summary.bySubscriptionState.ACTIVE ?? 0)}</p>
            <p className="text-[10px] text-slate-400 tabular-nums">grace {data.summary.bySubscriptionState.GRACE ?? 0} · restr {data.summary.bySubscriptionState.RESTRICTED ?? 0}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Expiring ≤30d</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-amber-800">{num.format(data.summary.subscriptionsExpiringWithin30Days)}</p>
            <p className="text-[10px] text-amber-600/80">subscriptions</p>
          </div>
          <div className="rounded-xl border border-teal-200 bg-teal-50/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-600">Setup complete</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-teal-800">
              {data.summary.onboardingReady === null ? '—' : num.format(data.summary.onboardingReady)}
            </p>
            <p className="text-[10px] text-teal-600/80">all 5 required sections</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lifecycle</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
              {num.format((data.summary.byStatus.ACTIVE ?? 0) + (data.summary.byStatus.PENDING ?? 0) + (data.summary.byStatus.SUSPENDED ?? 0) + (data.summary.byStatus.TRIAL ?? 0))}
            </p>
            <p className="text-[10px] text-slate-400 tabular-nums">trial {data.summary.byStatus.TRIAL ?? 0}</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, slug, code, domain…"
            aria-label="Search schools"
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11 pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as StatusFilter)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Filter by lifecycle status"
              className="h-11 w-full sm:w-36 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="ALL" className="focus:bg-slate-100">
                All statuses
              </SelectItem>
              <SelectItem value="ACTIVE" className="focus:bg-slate-100">
                ACTIVE
              </SelectItem>
              <SelectItem value="SUSPENDED" className="focus:bg-slate-100">
                SUSPENDED
              </SelectItem>
              <SelectItem value="PENDING" className="focus:bg-slate-100">
                PENDING
              </SelectItem>
              <SelectItem value="TRIAL" className="focus:bg-slate-100">
                TRIAL
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={subscriptionState}
            onValueChange={(v) => {
              setSubscriptionState(v as SubStateFilter)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Filter by subscription state"
              className="h-11 w-full sm:w-40 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Subscription" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="ALL" className="focus:bg-slate-100">
                All subscriptions
              </SelectItem>
              <SelectItem value="ACTIVE" className="focus:bg-slate-100">
                Active
              </SelectItem>
              <SelectItem value="GRACE" className="focus:bg-slate-100">
                Grace
              </SelectItem>
              <SelectItem value="RESTRICTED" className="focus:bg-slate-100">
                Restricted
              </SelectItem>
              <SelectItem value="SUSPENDED" className="focus:bg-slate-100">
                Suspended
              </SelectItem>
              <SelectItem value="NOT_ACTIVATED" className="focus:bg-slate-100">
                Not activated
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={billingModel}
            onValueChange={(v) => {
              setBillingModel(v as BillingModelFilter)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Filter by billing model"
              className="h-11 w-full sm:w-40 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Billing model" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="ALL" className="focus:bg-slate-100">
                All models
              </SelectItem>
              <SelectItem value="SCHOOL_WIDE" className="focus:bg-slate-100">
                School-wide
              </SelectItem>
              <SelectItem value="PER_STUDENT" className="focus:bg-slate-100">
                Per-student
              </SelectItem>
              <SelectItem value="MIXED" className="focus:bg-slate-100">
                Mixed
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={demo}
            onValueChange={(v) => {
              setDemo(v as DemoFilter)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Filter by demo or production classification"
              className="h-11 w-full sm:w-36 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="ALL" className="focus:bg-slate-100">
                Demo + production
              </SelectItem>
              <SelectItem value="demo" className="focus:bg-slate-100">
                Demo only
              </SelectItem>
              <SelectItem value="production" className="focus:bg-slate-100">
                Production only
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={readiness}
            onValueChange={(v) => {
              setReadiness(v as ReadinessFilter)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Filter by onboarding readiness"
              className="h-11 w-full sm:w-40 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Readiness" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              <SelectItem value="ALL" className="focus:bg-slate-100">
                Any readiness
              </SelectItem>
              <SelectItem value="ready" className="focus:bg-slate-100">
                Setup complete
              </SelectItem>
              <SelectItem value="incomplete" className="focus:bg-slate-100">
                Setup incomplete
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as SortKey)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Sort schools"
              className="h-11 w-full sm:w-44 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            >
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 text-slate-900">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k} className="focus:bg-slate-100">
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {/* Refresh — re-fetches the live ledger (P0-B). */}
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh schools list"
            className="h-11 w-11 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800 focus-ring"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
          {canProvision && (
            <Button
              onClick={() => setProvisionOpen(true)}
              className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add School
            </Button>
          )}
        </div>
      </div>

      {/* Load error */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Ledger — table on sm+, cards below */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {showSkeletonRows ? (
          <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading schools">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-44 bg-slate-200" />
                <Skeleton className="h-6 w-20 bg-slate-200" />
                <Skeleton className="hidden sm:block h-4 flex-1 bg-slate-200" />
                <Skeleton className="hidden lg:block h-4 w-20 bg-slate-200" />
              </div>
            ))}
          </div>
        ) : data && data.schools.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <SchoolIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900">No schools match</p>
            <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
              {filtersActive
                ? 'Nothing matches the current search and filters — try clearing them.'
                : 'No schools have been provisioned yet.'}
            </p>
            {filtersActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  setStatus('ALL')
                  setSubscriptionState('ALL')
                  setBillingModel('ALL')
                  setDemo('ALL')
                  setReadiness('ALL')
                  setPage(1)
                }}
                className="mt-4 h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table (sm+) */}
            <div className="hidden sm:block overflow-x-auto custom-scrollbar">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-500 font-semibold h-11">School</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Status</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Subscription</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Login URL</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Website</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Users</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Students</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Teachers</TableHead>
                    <TableHead className="text-slate-500 font-semibold">City</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Created</TableHead>
                    <TableHead className="w-28" aria-label="Row actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.schools.map((s) => (
                    <TableRow
                      key={s.id}
                      onClick={() => openSchool(s.id)}
                      className="cursor-pointer border-slate-200 hover:bg-slate-50 focus:bg-slate-100 focus:outline-none"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openSchool(s.id)
                        }
                      }}
                      aria-label={`Open ${s.name}`}
                    >
                      <TableCell className="max-w-[16rem] py-3">
                        <p className="truncate font-semibold text-slate-900">{s.name}</p>
                        <p className="truncate font-mono text-[11px] text-slate-500">
                          {s.slug} · {s.code}
                        </p>
                        <PrincipalLine principal={s.principal} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={s.status} />
                          <DemoBadge isDemo={s.isDemo} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem]">
                        <div className="flex flex-col items-start gap-1">
                          <SubStateBadge state={s.subscription.state} />
                          <p className="max-w-full truncate font-mono text-[10px] text-slate-500" title={s.subscription.planCode ?? 'No registry plan applied'}>
                            {s.subscription.planCode ?? s.plan.toLowerCase()}
                            {s.subscription.billingModel ? ` · ${s.subscription.billingModel === 'SCHOOL_WIDE' ? 'school-wide' : s.subscription.billingModel === 'PER_STUDENT' ? 'per-student' : 'mixed'}` : ''}
                          </p>
                          {s.subscription.periodEnd && (
                            <p className="text-[10px] text-slate-400 tabular-nums">
                              until {new Date(s.subscription.periodEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[12rem] py-3">
                        <div className="flex min-w-0 items-center gap-0.5">
                          <p
                            className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500"
                            title={s.loginUrl}
                          >
                            {s.loginUrl}
                          </p>
                          <CopyControl
                            value={s.loginUrl}
                            absolute
                            label={`Copy ${s.name} login URL`}
                          />
                          <OpenControl
                            url={s.loginUrl}
                            label={`Open ${s.name} login page in a new tab`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[11rem] py-3">
                        <div className="flex min-w-0 items-center gap-0.5">
                          <p
                            className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500"
                            title={s.publicUrl}
                          >
                            {s.publicUrl}
                          </p>
                          <CopyControl
                            value={s.publicUrl}
                            absolute
                            label={`Copy ${s.name} website preview URL`}
                          />
                          <OpenControl
                            url={s.publicUrl}
                            label={`Open ${s.name} public website in a new tab`}
                            icon={<Globe className="h-4 w-4" aria-hidden="true" />}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.users)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.students)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.teachers)}
                      </TableCell>
                      <TableCell className="text-slate-600">{s.city ?? '—'}</TableCell>
                      <TableCell className="text-slate-500 tabular-nums" title={new Date(s.createdAt).toLocaleString()}>
                        {timeAgo(s.createdAt)}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          <CopyControl value={s.code} label={`Copy ${s.name} school code`} />
                          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards (<sm) */}
            <div className="sm:hidden divide-y divide-slate-200" aria-label="Schools">
              {data?.schools.map((s) => (
                // The card is a div[role=button] (NOT a <button>) so the
                // copy/open controls inside remain valid interactive elements;
                // they stopPropagation to keep card = open detail only.
                <motion.div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openSchool(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openSchool(s.id)
                    }
                  }}
                  whileTap={{ scale: 0.985 }}
                  className="w-full min-h-[44px] cursor-pointer text-left p-4 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
                  aria-label={`Open ${s.name}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-sm text-slate-900">{s.name}</p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {s.slug} · {s.code}
                  </p>
                  <div className="mt-1">
                    <PrincipalLine principal={s.principal} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={s.status} />
                    <DemoBadge isDemo={s.isDemo} />
                    <SubStateBadge state={s.subscription.state} />
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {s.city ?? '—'}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                    {s.subscription.planCode ?? s.plan.toLowerCase()}
                    {s.subscription.periodEnd ? ` · until ${new Date(s.subscription.periodEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.users)} users
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <GraduationCap className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.students)} students
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <BookOpen className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.teachers)} teachers
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {timeAgo(s.createdAt)}
                    </span>
                  </div>
                  {/* Access actions — the canonical doors: copy AND open
                      (login + website), plus the school code; never
                      triggers card navigation. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CopyControl
                      value={s.loginUrl}
                      absolute
                      label={`Copy ${s.name} login URL`}
                      text="Login URL"
                    />
                    <OpenControl
                      url={s.loginUrl}
                      label={`Open ${s.name} login page in a new tab`}
                      text="Open Login"
                    />
                    <CopyControl
                      value={s.publicUrl}
                      absolute
                      label={`Copy ${s.name} website preview URL`}
                      text="Website URL"
                    />
                    <OpenControl
                      url={s.publicUrl}
                      label={`Open ${s.name} public website in a new tab`}
                      icon={<Globe className="h-4 w-4" aria-hidden="true" />}
                      text="Open Website"
                    />
                    <CopyControl value={s.code} label={`Copy ${s.name} school code`} text="Code" />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {page} of {totalPages}
                {data ? ` · ${num.format(data.total)} school${data.total === 1 ? '' : 's'}` : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  ← Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {canProvision && (
        <ProvisionWizard
          open={provisionOpen}
          onOpenChange={setProvisionOpen}
          onProvisioned={() => {
            setPage(1)
            void load()
          }}
        />
      )}
    </section>
  )
}
