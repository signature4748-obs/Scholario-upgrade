'use client'

// ============================================================
// SchoolsModule — the platform-wide school ledger (PHASE 6 · §6)
// ------------------------------------------------------------
// /platform/schools: searchable, filtered, sorted and paginated list
// of every tenant with live counts, plus the provisioning wizard
// (POST /api/platform/schools). Desktop (md+) renders a compact
// table; small screens render cards — same data, no page-level
// horizontal overflow.
//
// §6 SIMPLIFICATION: the toolbar is ONE compact search field + ONE
// filter popover (every advanced filter, an active-count badge and
// a Clear all) + ONE sort select + a refresh icon button; the six
// KPI cards collapsed into a slim status row; the desktop table
// trimmed to the essential columns with the door/code actions kept
// as compact icon buttons; ERROR ≠ EMPTY — a failed request renders
// the error panel with a retry, NEVER the "no schools" empty state.
//
// SCHEMA-PENDING HONESTY (Task 4 wire contract): when the response
// carries subscriptionSchemaPending, the shared banner explains it,
// the billingModel/subscriptionState filters are visibly disabled
// with the reason (any in-flight value is cleared so the UI never
// claims a filter the server cannot serve), and the planCode/
// billingModel chip line reads "—".
//
// PHASE 10 / P0-B (kept): every row carries the tenant's CANONICAL
// doors (loginUrl/publicUrl from SCHOOL_APP_BASE_URL — never
// guessed) with copy/open controls; copies resolve relative URLs
// against the current origin. Data comes from the authenticated
// server API only (no mock/seed arrays anywhere).
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
  SlidersHorizontal,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

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
  /** Stable internal record prefix (e.g. GVPS-0001) — null only for
   *  rows created before the 2026-10-20 backfill or a pending DB. */
  recordPrefix: string | null
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
  /** Task 4 wire contract: plan/billing chips degrade, filters disabled. */
  subscriptionSchemaPending?: boolean
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'TRIAL' | 'ATTENTION'
type SubStateFilter = 'ALL' | 'ACTIVE' | 'GRACE' | 'RESTRICTED' | 'SUSPENDED' | 'NOT_ACTIVATED'
type BillingModelFilter = 'ALL' | 'SCHOOL_WIDE' | 'PER_STUDENT' | 'MIXED'
type BillingFrequencyFilter = 'ALL' | 'MONTHLY' | 'ANNUAL'
type BoardFilter = 'ALL' | 'CBSE' | 'UP_BOARD' | 'ICSE' | 'STATE' | 'CUSTOM'
type PlanFilter = 'ALL' | 'FREE' | 'STANDARD' | 'PRO' | 'ENTERPRISE'
type DemoFilter = 'ALL' | 'demo' | 'production'
type ReadinessFilter = 'ALL' | 'ready' | 'incomplete'
type ExpiringFilter = 'ALL' | '7' | '30' | '90' | '180'
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

const BILLING_MODEL_LABELS: Record<string, string> = {
  SCHOOL_WIDE: 'school-wide',
  PER_STUDENT: 'per-student',
  MIXED: 'mixed',
}

/**
 * The compact plan/billing line under the subscription state badge.
 * Under `subscriptionSchemaPending` the server degrades planCode and
 * billingModel to null — the chip reads "—" with the reason on the
 * title instead of silently falling back to the legacy plan marker.
 */
function planChipLine(s: SchoolRow, pending: boolean): { text: string; title: string } {
  if (pending) {
    return {
      text: '—',
      title: 'Plan and billing model are unavailable until the pending subscription-system migration',
    }
  }
  const plan = s.subscription.planCode ?? s.plan.toLowerCase()
  const billing = s.subscription.billingModel
    ? BILLING_MODEL_LABELS[s.subscription.billingModel] ?? s.subscription.billingModel
    : null
  return {
    text: billing ? `${plan} · ${billing}` : plan,
    title: s.subscription.planCode ?? 'No registry plan applied',
  }
}

/** Last activity truth: the founding principal's last sign-in, else the school's creation. */
function lastActivity(s: SchoolRow): { iso: string; label: string; title: string } {
  if (s.principal?.lastLoginAt) {
    return {
      iso: s.principal.lastLoginAt,
      label: timeAgo(s.principal.lastLoginAt),
      title: `Principal last signed in ${new Date(s.principal.lastLoginAt).toLocaleString()}`,
    }
  }
  return {
    iso: s.createdAt,
    label: timeAgo(s.createdAt),
    title: `School created ${new Date(s.createdAt).toLocaleString()}`,
  }
}

// ── Access copy/open controls (PHASE 10 — school access truth) ────────────

/** Resolve a possibly-relative plane URL to an absolute one (click-time only — window exists). */
function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

/**
 * Copy button with inline "Copied" feedback (icon swaps to Check for
 * ~1.5s; the text variant swaps its label). Default = 44×44 touch
 * target (mobile cards); `compact` = the desktop table's h-8 icon
 * button. Quiet slate styling, and stopPropagation on click +
 * keydown so the surrounding row/card navigation never fires from
 * inside it. Labels stay accessible via aria-label + title.
 */
function CopyControl({
  value,
  absolute,
  label,
  text,
  compact,
}: {
  value: string
  /** Resolve a leading '/' against window.location.origin before copying. */
  absolute?: boolean
  label: string
  /** Optional visible text label (mobile cards); swaps to "Copied" on success. */
  text?: string
  /** Compact desktop-table variant (h-8 icon button). */
  compact?: boolean
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

  const cls = compact
    ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
    : text
      ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
      : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'

  return (
    <button
      type="button"
      onClick={onCopy}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={cls}
    >
      {copied ? (
        <Check className={compact ? 'h-3.5 w-3.5 text-emerald-600' : 'h-4 w-4 text-emerald-600'} aria-hidden="true" />
      ) : (
        <Copy className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
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
  compact,
}: {
  url: string
  label: string
  icon?: React.ReactNode
  /** Optional visible text label (mobile cards). */
  text?: string
  /** Compact desktop-table variant (h-8 icon button). */
  compact?: boolean
}) {
  const onOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    window.open(absoluteUrl(url), '_blank', 'noopener,noreferrer')
  }
  const cls = compact
    ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
    : text
      ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
      : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
  return (
    <button
      type="button"
      onClick={onOpen}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={cls}
    >
      {icon ?? <ExternalLink className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />}
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

// ── Advanced-filter popover (§6 — every filter in ONE compact control) ────

interface FilterOption {
  value: string
  label: string
}

const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'ATTENTION', label: 'Needs attention (pending or trial)' },
]

const PLAN_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'All plans' },
  { value: 'FREE', label: 'Free' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'PRO', label: 'Pro' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
]

const SUB_STATE_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'All subscriptions' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'GRACE', label: 'Grace' },
  { value: 'RESTRICTED', label: 'Restricted' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'NOT_ACTIVATED', label: 'Not activated' },
]

const BILLING_MODEL_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'All models' },
  { value: 'SCHOOL_WIDE', label: 'School-wide' },
  { value: 'PER_STUDENT', label: 'Per-student' },
  { value: 'MIXED', label: 'Mixed' },
]

const BILLING_FREQUENCY_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'Any frequency' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ANNUAL', label: 'Yearly' },
]

const BOARD_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'All boards' },
  { value: 'CBSE', label: 'CBSE' },
  { value: 'UP_BOARD', label: 'UP Board' },
  { value: 'ICSE', label: 'ICSE (legacy)' },
  { value: 'STATE', label: 'State (legacy)' },
  { value: 'CUSTOM', label: 'Custom (legacy)' },
]

const DEMO_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'Demo + production' },
  { value: 'demo', label: 'Demo only' },
  { value: 'production', label: 'Production only' },
]

const READINESS_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'Any readiness' },
  { value: 'ready', label: 'Setup complete' },
  { value: 'incomplete', label: 'Setup incomplete' },
]

const EXPIRING_OPTIONS: readonly FilterOption[] = [
  { value: 'ALL', label: 'Any renewal date' },
  { value: '7', label: 'Expiring ≤ 7 days' },
  { value: '30', label: 'Expiring ≤ 30 days' },
  { value: '90', label: 'Expiring ≤ 90 days' },
  { value: '180', label: 'Expiring ≤ 180 days' },
]

/** One compact labelled Select inside the filter popover. */
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly FilterOption[]
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] font-medium text-slate-500">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-label={label}
          className="h-9 w-full bg-white border-slate-200 text-xs text-slate-900 focus-visible:ring-teal-500/40"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white border-slate-200 text-slate-900">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs focus:bg-slate-100">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolsModule() {
  const { can } = usePlatformSession()
  const router = useRouter()

  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [plan, setPlan] = useState<PlanFilter>('ALL')
  const [subscriptionState, setSubscriptionState] = useState<SubStateFilter>('ALL')
  const [billingModel, setBillingModel] = useState<BillingModelFilter>('ALL')
  const [demo, setDemo] = useState<DemoFilter>('ALL')
  const [readiness, setReadiness] = useState<ReadinessFilter>('ALL')
  const [expiringDays, setExpiringDays] = useState<ExpiringFilter>('ALL')
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('ALL')
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequencyFilter>('ALL')
  const [sort, setSort] = useState<SortKey>('created_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SchoolsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  /** URL-param ingestion gate — the first fetch waits until the
   *  mount-time URL has been parsed (deep links like
   *  /platform/schools?status=ATTENTION or ?new=1 must apply before
   *  the initial request fires, not after). */
  const [urlParsed, setUrlParsed] = useState(false)
  const requestId = useRef(0)

  // Honest schema-pending signal from the LAST successful response.
  const schemaPending = data !== null && isSubscriptionSchemaPending(data)

  const filterCount =
    (status !== 'ALL' ? 1 : 0) +
    (plan !== 'ALL' ? 1 : 0) +
    (subscriptionState !== 'ALL' ? 1 : 0) +
    (billingModel !== 'ALL' ? 1 : 0) +
    (billingFrequency !== 'ALL' ? 1 : 0) +
    (boardFilter !== 'ALL' ? 1 : 0) +
    (demo !== 'ALL' ? 1 : 0) +
    (readiness !== 'ALL' ? 1 : 0) +
    (expiringDays !== 'ALL' ? 1 : 0)

  const filtersActive = q !== '' || filterCount > 0

  // Debounced search (~300ms) → resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Mount-time URL params (deep links from the Overview metric cards
  // and the add-school shortcut): `status=<filter>` and `new=1`
  // (auto-open the provision wizard). Read once from
  // window.location.search (client-only — no prerender involvement);
  // a ref guard keeps it one-shot even if the session identity
  // refreshes (the wizard must not re-open on its own).
  const urlParamsParsed = useRef(false)
  useEffect(() => {
    if (urlParamsParsed.current) return
    urlParamsParsed.current = true
    try {
      const sp = new URLSearchParams(window.location.search)
      const st = sp.get('status')
      if (
        st === 'ACTIVE' ||
        st === 'SUSPENDED' ||
        st === 'PENDING' ||
        st === 'TRIAL' ||
        st === 'ATTENTION'
      ) {
        setStatus(st)
      }
      if (sp.get('new') === '1' && can('schools.provision')) {
        // The wizard is a full-page workspace now — redirect there and
        // leave the legacy parameter behind (also fixes the edge where
        // a client-side query change after mount would never re-open
        // the old modal).
        router.replace('/platform/schools/new')
      }
    } catch {
      /* no usable location — defaults apply */
    }
    setUrlParsed(true)
    // `router` is stable in the App Router; the ref guard above keeps
    // this parse one-shot regardless of session-driven `can` refreshes.
  }, [can, router])

  // SCHEMA-PENDING honesty: the server cannot serve the billingModel /
  // billingFrequency filters (and the popover disables the subscription
  // filters with the reason) — clear any in-flight values so the toolbar
  // never claims a filter that is not being applied. Self-healing: a
  // response from a migrated database re-enables the controls.
  useEffect(() => {
    if (!schemaPending) return
    if (billingModel !== 'ALL') setBillingModel('ALL')
    if (billingFrequency !== 'ALL') setBillingFrequency('ALL')
    if (subscriptionState !== 'ALL') setSubscriptionState('ALL')
  }, [schemaPending, billingModel, billingFrequency, subscriptionState])

  const clearAllFilters = () => {
    setSearchInput('')
    setQ('')
    setStatus('ALL')
    setPlan('ALL')
    setSubscriptionState('ALL')
    setBillingModel('ALL')
    setBillingFrequency('ALL')
    setBoardFilter('ALL')
    setDemo('ALL')
    setReadiness('ALL')
    setExpiringDays('ALL')
    setPage(1)
  }

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status !== 'ALL') params.set('status', status)
      if (plan !== 'ALL') params.set('plan', plan)
      if (subscriptionState !== 'ALL') params.set('subscriptionState', subscriptionState)
      if (billingModel !== 'ALL') params.set('billingModel', billingModel)
      if (billingFrequency !== 'ALL') params.set('billingFrequency', billingFrequency)
      if (boardFilter !== 'ALL') params.set('board', boardFilter)
      if (demo !== 'ALL') params.set('demo', demo)
      if (readiness !== 'ALL') params.set('readiness', readiness)
      if (expiringDays !== 'ALL') params.set('expiringDays', expiringDays)
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
  }, [q, status, plan, subscriptionState, billingModel, billingFrequency, boardFilter, demo, readiness, expiringDays, sort, page])

  useEffect(() => {
    if (!urlParsed) return
    void load()
  }, [load, urlParsed])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const canProvision = can('schools.provision')
  const showSkeletonRows = loading || !data

  const openSchool = (id: string) => router.push(`/platform/schools/${id}`)

  return (
    <section aria-labelledby="schools-heading" className="space-y-4">
      {/* Page header — title, description, primary action */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            id="schools-heading"
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900"
          >
            Schools
          </h1>
          <p className="mt-1 text-sm text-slate-500">Manage school accounts and access.</p>
        </div>
        {canProvision && (
          <Button
            onClick={() => router.push('/platform/schools/new')}
            className="h-10 bg-teal-600 font-semibold text-white hover:bg-teal-700 focus-ring"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add school
          </Button>
        )}
      </div>

      {/* Slim status row — DB-derived for the CURRENT filter set (the
          same query that feeds the table; zero records and a failed
          load are distinct states). */}
      {!error && data?.summary ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Schools status summary for the current filters"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
            <span className="font-bold tabular-nums text-slate-900">{num.format(data.summary.total)}</span>
            school{data.summary.total === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <span className="font-bold tabular-nums">{num.format(data.summary.byStatus.ACTIVE ?? 0)}</span>
            active
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50/70 px-2.5 py-1 text-[11px] font-medium text-red-600">
            <span className="font-bold tabular-nums">{num.format(data.summary.byStatus.SUSPENDED ?? 0)}</span>
            suspended
          </span>
        </div>
      ) : null}

      {/* Schema-pending honesty — the ONE shared banner (Task 4). */}
      {schemaPending ? <SubscriptionPendingBanner /> : null}

      {/* Toolbar — ONE search + ONE filter popover + ONE sort + refresh */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Enter flushes immediately (debounce still settles the same value).
                setQ(searchInput.trim())
                setPage(1)
              }
            }}
            placeholder="Search name, slug, code, prefix, contact…"
            aria-label="Search schools"
            className="h-10 bg-white border-slate-200 pl-9 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Advanced filters — every filter in ONE popover with an
              active-count badge and a Clear all reset. */}
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                aria-label={
                  filterCount > 0 ? `Advanced filters (${filterCount} active)` : 'Advanced filters'
                }
                className="h-10 shrink-0 border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-ring"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                Filters
                {filterCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[10px] font-semibold tabular-nums text-white"
                  >
                    {filterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 border-slate-200 bg-white p-4 text-slate-900"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">Advanced filters</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  disabled={filterCount === 0 && q === ''}
                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800 focus-ring"
                >
                  Clear all
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FilterSelect
                  id="flt-status"
                  label="Status"
                  value={status}
                  onChange={(v) => {
                    setStatus(v as StatusFilter)
                    setPage(1)
                  }}
                  options={STATUS_OPTIONS}
                />
                <FilterSelect
                  id="flt-plan"
                  label="Plan"
                  value={plan}
                  onChange={(v) => {
                    setPlan(v as PlanFilter)
                    setPage(1)
                  }}
                  options={PLAN_OPTIONS}
                />
                <FilterSelect
                  id="flt-substate"
                  label="Subscription"
                  value={subscriptionState}
                  onChange={(v) => {
                    setSubscriptionState(v as SubStateFilter)
                    setPage(1)
                  }}
                  options={SUB_STATE_OPTIONS}
                  disabled={schemaPending}
                />
                <FilterSelect
                  id="flt-billing"
                  label="Billing model"
                  value={billingModel}
                  onChange={(v) => {
                    setBillingModel(v as BillingModelFilter)
                    setPage(1)
                  }}
                  options={BILLING_MODEL_OPTIONS}
                  disabled={schemaPending}
                />
                <FilterSelect
                  id="flt-freq"
                  label="Billing frequency"
                  value={billingFrequency}
                  onChange={(v) => {
                    setBillingFrequency(v as BillingFrequencyFilter)
                    setPage(1)
                  }}
                  options={BILLING_FREQUENCY_OPTIONS}
                  disabled={schemaPending}
                />
                <FilterSelect
                  id="flt-board"
                  label="Board"
                  value={boardFilter}
                  onChange={(v) => {
                    setBoardFilter(v as BoardFilter)
                    setPage(1)
                  }}
                  options={BOARD_OPTIONS}
                />
                {schemaPending ? (
                  <p
                    className="col-span-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700"
                    role="note"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    Billing model, frequency &amp; subscription state — unavailable until the pending migration.
                  </p>
                ) : null}
                <FilterSelect
                  id="flt-readiness"
                  label="Readiness"
                  value={readiness}
                  onChange={(v) => {
                    setReadiness(v as ReadinessFilter)
                    setPage(1)
                  }}
                  options={READINESS_OPTIONS}
                />
                <FilterSelect
                  id="flt-demo"
                  label="Type"
                  value={demo}
                  onChange={(v) => {
                    setDemo(v as DemoFilter)
                    setPage(1)
                  }}
                  options={DEMO_OPTIONS}
                />
                <FilterSelect
                  id="flt-expiring"
                  label="Renewal window"
                  value={expiringDays}
                  onChange={(v) => {
                    setExpiringDays(v as ExpiringFilter)
                    setPage(1)
                  }}
                  options={EXPIRING_OPTIONS}
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort */}
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as SortKey)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label="Sort schools"
              className="h-10 w-full min-w-0 flex-1 border-slate-200 bg-white text-slate-900 focus-visible:ring-teal-500/40 sm:w-44 sm:flex-none"
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

          {/* Refresh — re-fetches the live ledger (P0-B). */}
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh schools list"
            className="h-10 w-10 shrink-0 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800 focus-ring"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* ERROR ≠ EMPTY: a failed request renders this panel (retry
          re-runs the load) — never the table, never "no schools". */}
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-semibold">Could not load schools</span>
              <span className="block text-xs text-red-500">{error}</span>
            </span>
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
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
            /* EMPTY (successful zero rows) — distinct from an error. */
            <div className="m-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                <SchoolIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">No schools match your filters.</p>
              <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
                {filtersActive
                  ? 'Nothing matches the current search and filters — try clearing them.'
                  : 'No schools have been provisioned yet.'}
              </p>
              {filtersActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllFilters}
                  className="mt-4 h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table (md+) — compact columns; the door/code
                  actions live in the Actions column as icon buttons. */}
              <div className="hidden overflow-x-auto custom-scrollbar md:block">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="border-slate-200 hover:bg-transparent">
                      <TableHead className="h-11 font-semibold text-slate-500">School</TableHead>
                      <TableHead className="font-semibold text-slate-500">Status</TableHead>
                      <TableHead className="font-semibold text-slate-500">Subscription</TableHead>
                      <TableHead className="text-right font-semibold text-slate-500">Users</TableHead>
                      <TableHead className="font-semibold text-slate-500">Last activity</TableHead>
                      <TableHead className="w-52" aria-label="Row actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.schools.map((s) => {
                      const planLine = planChipLine(s, schemaPending)
                      const activity = lastActivity(s)
                      return (
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
                            <p
                              className="truncate font-mono text-[11px] text-slate-500"
                              title={`slug: ${s.slug} · school code: ${s.code}${s.recordPrefix ? ` · record prefix: ${s.recordPrefix}` : ''}`}
                            >
                              {s.slug} · code {s.code}
                              {s.recordPrefix ? ` · prefix ${s.recordPrefix}` : ''}
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
                              <p
                                className="max-w-full truncate font-mono text-[10px] text-slate-500"
                                title={planLine.title}
                              >
                                {planLine.text}
                              </p>
                              {s.subscription.periodEnd && (
                                <p className="text-[10px] tabular-nums text-slate-400">
                                  until{' '}
                                  {new Date(s.subscription.periodEnd).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-slate-700">
                            {num.format(s.counts.users)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="tabular-nums text-slate-500" title={activity.title}>
                              {activity.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <CopyControl
                                value={s.loginUrl}
                                absolute
                                label={`Copy ${s.name} login URL`}
                                compact
                              />
                              <OpenControl
                                url={s.loginUrl}
                                label={`Open ${s.name} login page in a new tab`}
                                compact
                              />
                              <CopyControl
                                value={s.publicUrl}
                                absolute
                                label={`Copy ${s.name} website preview URL`}
                                compact
                              />
                              <OpenControl
                                url={s.publicUrl}
                                label={`Open ${s.name} public website in a new tab`}
                                icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}
                                compact
                              />
                              <CopyControl value={s.code} label={`Copy ${s.name} school code`} compact />
                              <ChevronRight className="ml-1 h-4 w-4 text-slate-400" aria-hidden="true" />
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards (<md) — full-width, stacked; the card is a
                  div[role=button] (NOT a <button>) so the copy/open
                  controls inside remain valid interactive elements;
                  they stopPropagation to keep card = open detail only. */}
              <div className="divide-y divide-slate-200 md:hidden" aria-label="Schools">
                {data?.schools.map((s) => {
                  const planLine = planChipLine(s, schemaPending)
                  const activity = lastActivity(s)
                  return (
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
                      className="w-full min-h-[44px] cursor-pointer p-4 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
                      aria-label={`Open ${s.name}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{s.name}</p>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      </div>
                      <p
                        className="mt-0.5 truncate font-mono text-[11px] text-slate-500"
                        title={`slug: ${s.slug} · school code: ${s.code}${s.recordPrefix ? ` · record prefix: ${s.recordPrefix}` : ''}`}
                      >
                        {s.slug} · code {s.code}
                        {s.recordPrefix ? ` · prefix ${s.recordPrefix}` : ''}
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
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={planLine.title}>
                        {planLine.text}
                        {s.subscription.periodEnd
                          ? ` · until ${new Date(s.subscription.periodEnd).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}`
                          : ''}
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
                        <span className="inline-flex items-center gap-1 tabular-nums" title={activity.title}>
                          <CalendarDays className="h-3 w-3" aria-hidden="true" />
                          {activity.label}
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
                  )
                })}
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
                <p className="text-xs tabular-nums text-slate-500">
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
      )}
    </section>
  )
}
