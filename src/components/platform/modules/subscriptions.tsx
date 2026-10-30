'use client'

// ============================================================
// SubscriptionsModule — /platform/subscriptions (control centre)
// ------------------------------------------------------------
// PAYMENTS & GATEWAYS REDESIGN — the single authoritative overview of
// all school subscriptions. The four STATUS PLANES are separated
// server-side (registry route) and rendered verbatim:
//
//   A. Account access  — allowed / blocked (sign-in level).
//   B. Payment state   — UNPAID / PENDING / PAID (money plane).
//   C. Subscription    — active-paid / legacy-open-access / grace /
//                        expired / suspended / override / not-activated.
//   D. Entitlements    — per-student/staff rows live in the
//                        "Student entitlements" view (?view=students).
//
// A legacy fail-open tenant is labelled "Access allowed — no verified
// payment recorded." and is NEVER counted as an active subscription.
//
// Plan management moved to /platform/plans; renewal & reconciliation
// reporting moved to /platform/reports. Clicking a school opens ITS
// subscription detail (Schools → [school] → Subscription).
//
// HONESTY CONTRACTS (unchanged): schema-pending renders the shared
// banner; ERROR ≠ EMPTY (retryable error panels); registry-wide KPIs
// come from the API summary, never page-scoped rows.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, CalendarClock, CalendarX, Check,
  KeyRound, Loader2, RefreshCw, Search,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Users,
} from 'lucide-react'
import { platformApi } from '../platform-client'
import {
  AssignEntitlementDialog, StudentHistoryDialog,
  StateBadge, dateStr, errMessage,
  type StudentRow,
} from './subscription-shared'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// ── types ──────────────────────────────────────────────────────────────

interface SchoolOption { id: string; name: string; slug: string }

/** Honest registry row shape — the status planes are computed
 *  server-side; pending-migration columns are NULL, never fabricated. */
interface SubscriptionRow {
  subscriptionId: string
  school: { id: string; name: string; slug: string; code: string; status: string; isDemo: boolean }
  billingModel: string | null
  plan: string
  planDef: { code: string; name: string } | null
  planCode: string | null
  interval: string | null
  priceSnapshot: number | null
  currencySnapshot: string | null
  periodStart: string | null
  periodEnd: string | null
  graceDays: number
  overrideStatus: string | null
  notes: string | null
  paymentCount: number | null
  licensedStudents?: number | null
  pendingPayments: number
  paymentState: 'UNPAID' | 'PENDING' | 'PAID'
  accessState: 'allowed' | 'blocked'
  subscriptionState: string
  openAccess: boolean
  daysToExpiry: number | null
  nextAction: string
  entitlement: { state: string; businessAllowed: boolean; renewalRequired: boolean }
}

interface RegistryData {
  subscriptionSchemaPending?: boolean
  schools: { rows: SubscriptionRow[]; total: number; page: number; pageSize: number }
  summary: {
    tenantStates?: Record<string, number>
    subscriptionsExpired?: number
    activePaidSubscriptions?: number
    unpaidOpenAccess?: number
    pendingVerification?: number
    studentEntitlements: Record<string, number> | null
    orders: Record<string, number> | null
    rejectedClaims: number | null
    subscriptionsExpiringWithin30Days: number
  }
  planOptions?: Array<{ code: string; name: string }>
}

const TENANT_STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'GRACE', label: 'Grace' },
  { value: 'RESTRICTED', label: 'Restricted' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'NOT_ACTIVATED', label: 'Not activated' },
] as const

const NEEDS_REVIEW_STATES = ['GRACE', 'RESTRICTED', 'SUSPENDED']
const num = new Intl.NumberFormat('en-IN')

/** Plain-language labels for the server-computed subscription states. */
const SUB_STATE_PLAIN: Record<string, string> = {
  'active-paid': 'Active — paid',
  'legacy-open-access': 'Access allowed — no verified payment recorded.',
  'grace-period': 'Grace period',
  'expired': 'Expired',
  'suspended': 'Suspended',
  'not-activated': 'Not activated',
  'override-active': 'Override — active',
  'override-grace': 'Override — grace',
  'override-restricted': 'Override — restricted',
  'override-suspended': 'Override — suspended',
}

const SUB_STATE_STYLES: Record<string, string> = {
  'active-paid': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'legacy-open-access': 'border-amber-300 bg-amber-50 text-amber-800',
  'grace-period': 'border-amber-200 bg-amber-50 text-amber-700',
  'expired': 'border-orange-200 bg-orange-50 text-orange-700',
  'suspended': 'border-red-200 bg-red-50 text-red-600',
  'not-activated': 'border-slate-200 bg-slate-100 text-slate-600',
  'override-active': 'border-sky-200 bg-sky-50 text-sky-700',
  'override-grace': 'border-amber-200 bg-amber-50 text-amber-700',
  'override-restricted': 'border-orange-200 bg-orange-50 text-orange-700',
  'override-suspended': 'border-red-200 bg-red-50 text-red-600',
}

const PAYMENT_STATE_STYLES: Record<string, string> = {
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  UNPAID: 'border-slate-200 bg-slate-100 text-slate-600',
}

function SubStateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={`whitespace-normal text-left text-[11px] leading-tight ${SUB_STATE_STYLES[state] ?? 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {SUB_STATE_PLAIN[state] ?? state}
    </Badge>
  )
}

function PaymentStateBadge({ state }: { state: string }) {
  const label = state === 'PAID' ? 'Paid' : state === 'PENDING' ? 'Pending verification' : 'Unpaid'
  return (
    <Badge variant="outline" className={`text-[11px] ${PAYMENT_STATE_STYLES[state] ?? ''}`}>{label}</Badge>
  )
}

// ── module ─────────────────────────────────────────────────────────────

export function SubscriptionsModule() {
  const router = useRouter()
  const searchParams = useSearchParams()
  /** URL-addressable views (?view=students) — deep links land exactly
   *  where the operator expects (pre-redesign the views were state-only). */
  const view = searchParams.get('view') === 'students' ? 'students' : 'overview'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [registry, setRegistry] = useState<RegistryData | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [billingFilter, setBillingFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [secondaryPending, setSecondaryPending] = useState(false)

  const signalPending = useCallback(() => setSecondaryPending(true), [])

  const buildQs = useCallback(
    (q: string, pageNo: number) => {
      const p = new URLSearchParams()
      if (q) p.set('q', q)
      if (statusFilter) p.set('status', statusFilter)
      if (paymentFilter) p.set('paymentState', paymentFilter)
      if (billingFilter) p.set('billingModel', billingFilter)
      if (planFilter) p.set('plan', planFilter)
      if (expiryFilter) p.set('expiringDays', expiryFilter)
      p.set('page', String(pageNo))
      p.set('pageSize', '50')
      return p.toString()
    },
    [statusFilter, paymentFilter, billingFilter, planFilter, expiryFilter],
  )

  const load = useCallback(async (q: string, pageNo: number) => {
    setLoading(true)
    setError(null)
    try {
      const reg = await platformApi<RegistryData>(`/api/platform/subscriptions/registry?${buildQs(q, pageNo)}`)
      setRegistry(reg)
    } catch (e) {
      // ERROR ≠ EMPTY — a failed request must never look like "no rows".
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [buildQs])

  useEffect(() => { void load('', 1) }, [load])

  /** Any filter change resets the pager — the cohort changed. */
  const applyFilters = (patch: Partial<{ status: string; payment: string; billing: string; plan: string; expiry: string }>) => {
    if (patch.status !== undefined) setStatusFilter(patch.status)
    if (patch.payment !== undefined) setPaymentFilter(patch.payment)
    if (patch.billing !== undefined) setBillingFilter(patch.billing)
    if (patch.plan !== undefined) setPlanFilter(patch.plan)
    if (patch.expiry !== undefined) setExpiryFilter(patch.expiry)
    setPage(1)
    // load() reads the filter state via buildQs; state updates land before
    // the effect-less call? No — call load AFTER setState batches resolve.
    setTimeout(() => void load(query, 1), 0)
  }

  const handlePageChange = (next: number) => {
    setPage(next)
    void load(query, next)
  }

  const openSchool = (id: string) => router.push(`/platform/schools/${id}?tab=subscription`)

  const schemaPending = (registry != null && isSubscriptionSchemaPending(registry)) || secondaryPending
  const activeFilterCount = [statusFilter, paymentFilter, billingFilter, planFilter, expiryFilter].filter(Boolean).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Subscriptions</h1>
          <p className="mt-1 text-sm text-slate-500">
            The control centre for every school&apos;s subscription — payment, access and subscription state kept separate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === 'overview' ? (
            <Button
              variant="outline" size="sm" onClick={() => router.push('/platform/subscriptions?view=students')}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <Users className="h-4 w-4" aria-hidden="true" />Student entitlements
            </Button>
          ) : (
            <Button
              variant="outline" size="sm" onClick={() => router.push('/platform/subscriptions')}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              ← Back to control centre
            </Button>
          )}
        </div>
      </div>

      {schemaPending && <SubscriptionPendingBanner />}

      {view === 'students' ? (
        <StudentEntitlementsSection
          onSchemaPending={signalPending}
          onAssigned={() => void load(query, page)}
        />
      ) : (
        <ControlCentreSection
          loading={loading}
          error={error}
          registry={registry}
          query={query}
          onQueryChange={setQuery}
          onSearch={() => { setPage(1); void load(query, 1) }}
          statusFilter={statusFilter}
          paymentFilter={paymentFilter}
          billingFilter={billingFilter}
          planFilter={planFilter}
          expiryFilter={expiryFilter}
          activeFilterCount={activeFilterCount}
          onFiltersChange={applyFilters}
          page={page}
          onPageChange={handlePageChange}
          onRetry={() => void load(query, page)}
          onOpenSchool={openSchool}
        />
      )}
    </div>
  )
}

// ── control centre (overview) ──────────────────────────────────────────

function ControlCentreSection({
  loading, error, registry, query, onQueryChange, onSearch,
  statusFilter, paymentFilter, billingFilter, planFilter, expiryFilter,
  activeFilterCount, onFiltersChange, page, onPageChange, onRetry, onOpenSchool,
}: {
  loading: boolean
  error: string | null
  registry: RegistryData | null
  query: string
  onQueryChange: (q: string) => void
  onSearch: () => void
  statusFilter: string
  paymentFilter: string
  billingFilter: string
  planFilter: string
  expiryFilter: string
  activeFilterCount: number
  onFiltersChange: (patch: Partial<{ status: string; payment: string; billing: string; plan: string; expiry: string }>) => void
  page: number
  onPageChange: (next: number) => void
  onRetry: () => void
  onOpenSchool: (id: string) => void
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const rows = registry?.schools.rows ?? []
  const pageSize = registry?.schools.pageSize ?? 50
  const total = registry?.schools.total ?? 0
  const totalPages = registry ? Math.max(1, Math.ceil(total / pageSize)) : 1
  const summary = registry?.summary

  // REGISTRY-WIDE KPIs from the API summary (computed live over ALL rows).
  const activePaid = summary?.activePaidSubscriptions ?? 0
  const openAccess = summary?.unpaidOpenAccess ?? 0
  const pendingVerification = summary?.pendingVerification ?? 0
  const expiringSoon = summary?.subscriptionsExpiringWithin30Days ?? 0
  const expired = summary?.subscriptionsExpired ?? 0
  const suspended = summary?.tenantStates?.SUSPENDED ?? 0
  const needsAction = summary
    ? NEEDS_REVIEW_STATES.reduce((sum, s) => sum + (summary.tenantStates?.[s] ?? 0), 0)
    : 0

  return (
    <div className="space-y-4">
      {/* KPI row — the status planes, labelled explicitly */}
      {loading && !registry ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-3 w-20 bg-slate-200" />
              <Skeleton className="mt-3 h-7 w-12 bg-slate-200" />
            </div>
          ))}
        </div>
      ) : registry && !error ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <SummaryStat
            icon={<ShieldCheck className="h-4 w-4" />} label="Active — paid" value={activePaid}
            tone="text-emerald-700"
            active={statusFilter === 'ACTIVE' && paymentFilter === 'PAID'}
            onClick={() => onFiltersChange(statusFilter === 'ACTIVE' && paymentFilter === 'PAID' ? { status: '', payment: '' } : { status: 'ACTIVE', payment: 'PAID' })}
          />
          <SummaryStat
            icon={<ShieldAlert className="h-4 w-4" />} label="Unpaid — access allowed" value={openAccess}
            tone="text-amber-700" title="Legacy open access: the school can sign in but no verified payment is recorded."
            active={statusFilter === 'ACTIVE' && paymentFilter === 'UNPAID'}
            onClick={() => onFiltersChange(statusFilter === 'ACTIVE' && paymentFilter === 'UNPAID' ? { status: '', payment: '' } : { status: 'ACTIVE', payment: 'UNPAID' })}
          />
          <SummaryStat
            icon={<Loader2 className="h-4 w-4" />} label="Payments pending verification" value={pendingVerification}
            active={paymentFilter === 'PENDING'}
            onClick={() => onFiltersChange(paymentFilter === 'PENDING' ? { payment: '' } : { payment: 'PENDING' })}
          />
          <SummaryStat
            icon={<CalendarClock className="h-4 w-4" />} label="Expiring soon (30d)" value={expiringSoon}
            active={expiryFilter === '30'}
            onClick={() => onFiltersChange(expiryFilter === '30' ? { expiry: '' } : { expiry: '30' })}
          />
          <SummaryStat
            icon={<CalendarX className="h-4 w-4" />} label="Expired" value={expired} tone="text-orange-700"
            active={statusFilter === 'RESTRICTED'}
            onClick={() => onFiltersChange(statusFilter === 'RESTRICTED' ? { status: '' } : { status: 'RESTRICTED' })}
          />
          <SummaryStat
            icon={<AlertTriangle className="h-4 w-4" />} label="Suspended" value={suspended} tone="text-red-600"
            active={statusFilter === 'SUSPENDED'}
            onClick={() => onFiltersChange(statusFilter === 'SUSPENDED' ? { status: '' } : { status: 'SUSPENDED' })}
          />
        </div>
      ) : null}
      {registry && !error && needsAction > 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
          <span className="font-semibold text-slate-800">{needsAction}</span> school{needsAction === 1 ? '' : 's'} need administrative action (grace / expired / suspended). Use the filters or the Reports &amp; Audit worklist.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Could not load subscriptions: {error}</span>
          </p>
          <Button variant="outline" size="sm" onClick={onRetry} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {/* Search + filters */}
      {!error && (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search subscriptions by school name, slug or code"
              placeholder="Search school name / slug / code…"
              className="h-10 border-slate-300 bg-white pl-9"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch() }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
            <Select value={billingFilter || 'all'} onValueChange={(v) => onFiltersChange({ billing: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by billing model"><SelectValue placeholder="Billing model" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All billing models</SelectItem>
                <SelectItem value="SCHOOL_WIDE">School-wide</SelectItem>
                <SelectItem value="PER_STUDENT">Per student</SelectItem>
                <SelectItem value="MIXED">Mixed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter || 'all'} onValueChange={(v) => onFiltersChange({ payment: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by payment status"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All payment states</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="PENDING">Pending verification</SelectItem>
                <SelectItem value="UNPAID">Unpaid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter || 'all'} onValueChange={(v) => onFiltersChange({ plan: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by plan"><SelectValue placeholder="Plan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                {(registry?.planOptions ?? []).map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={expiryFilter || 'all'} onValueChange={(v) => onFiltersChange({ expiry: v === 'all' ? '' : v })}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by expiry window"><SelectValue placeholder="Expiry" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any expiry</SelectItem>
                <SelectItem value="7">Expiring in 7 days</SelectItem>
                <SelectItem value="30">Expiring in 30 days</SelectItem>
                <SelectItem value="90">Expiring in 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline" size="sm"
                aria-label="Filter subscriptions by computed status"
                aria-expanded={filterOpen}
                className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Status
                {activeFilterCount > 0 && (
                  <Badge variant="outline" className="ml-1 border-teal-200 bg-teal-50 text-[10px] text-teal-700">{activeFilterCount}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription status</p>
              <div className="mt-1.5 space-y-0.5">
                {TENANT_STATUS_FILTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={statusFilter === s.value}
                    onClick={() => onFiltersChange({ status: statusFilter === s.value ? '' : s.value })}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    {s.label}
                    {statusFilter === s.value && <Check className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <div className="mt-2 border-t border-slate-200 pt-2">
                <Button
                  variant="ghost" size="sm"
                  className="w-full text-xs text-slate-600"
                  disabled={activeFilterCount === 0}
                  onClick={() => onFiltersChange({ status: '', payment: '', billing: '', plan: '', expiry: '' })}
                >
                  Clear all filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Registry table (desktop) / cards (mobile) */}
      {loading && !registry ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
          </div>
        </div>
      ) : !error && (
        <>
          <p className="text-xs text-slate-500" aria-live="polite">
            Showing {rows.length} of {total} school subscriptions
          </p>

          {/* Mobile card list */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <div key={r.subscriptionId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-slate-900">{r.school.name}</p>
                      {r.school.isDemo && <Badge variant="outline" className="text-[10px]">demo</Badge>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{r.school.slug}</p>
                  </div>
                  {r.accessState === 'blocked' ? (
                    <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-600">Access blocked</Badge>
                  ) : (
                    <SubStateBadge state={r.subscriptionState} />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>{r.billingModel ? r.billingModel.replace(/_/g, ' ').toLowerCase() : 'billing —'}</span>
                  <span>Plan: {r.planDef ? r.planDef.name : r.planCode ?? r.plan}</span>
                  <span>Payment: {r.paymentState.toLowerCase()}</span>
                  <span>Valid until: {r.periodEnd ? dateStr(r.periodEnd) : '—'}</span>
                  {r.licensedStudents != null && <span>Licensed: {r.licensedStudents}</span>}
                </div>
                {r.nextAction !== 'None' && (
                  <p className="mt-1.5 text-xs font-medium text-slate-700">Next: {r.nextAction}</p>
                )}
                <Button
                  variant="outline" size="sm" onClick={() => onOpenSchool(r.school.id)}
                  className="mt-2 w-full border-slate-300 text-slate-700"
                  aria-label={`Open subscription details for ${r.school.name}`}
                >
                  Open subscription
                </Button>
              </div>
            ))}
            {rows.length === 0 && <EmptyState title="No subscriptions match." hint="Try a different search or clear the filters." />}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[1080px] text-sm">
              <caption className="sr-only">School subscriptions with billing model, plan, payment status, access status, validity, licensed quantity, payments and next action</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">School</th>
                  <th scope="col" className="px-3 py-2.5">Billing model</th>
                  <th scope="col" className="px-3 py-2.5">Plan</th>
                  <th scope="col" className="px-3 py-2.5">Payment</th>
                  <th scope="col" className="px-3 py-2.5">Access / subscription</th>
                  <th scope="col" className="px-3 py-2.5">Valid until</th>
                  <th scope="col" className="px-3 py-2.5">Licensed</th>
                  <th scope="col" className="px-3 py-2.5">Payments</th>
                  <th scope="col" className="px-3 py-2.5">Next action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.subscriptionId}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60"
                    onClick={() => onOpenSchool(r.school.id)}
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {r.school.name}
                      {r.school.isDemo && <Badge variant="outline" className="ml-2 text-[10px]">demo</Badge>}
                      <div className="text-xs font-normal text-slate-500">{r.school.slug}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {r.billingModel ? r.billingModel.replace(/_/g, ' ').toLowerCase() : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {r.planDef ? r.planDef.name : r.planCode ?? r.plan}
                      {r.interval && <div className="text-xs text-slate-500">{r.interval.toLowerCase()}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <PaymentStateBadge state={r.paymentState} />
                    </td>
                    <td className="px-3 py-2.5">
                      {r.accessState === 'blocked' ? (
                        <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[11px] text-slate-600">Access blocked</Badge>
                      ) : (
                        <SubStateBadge state={r.subscriptionState} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {r.periodEnd ? dateStr(r.periodEnd) : '—'}
                      {r.openAccess && <div className="text-[11px] font-medium text-amber-700">No paid period on record</div>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{r.licensedStudents ?? '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">
                      {r.paymentCount == null ? '—' : r.paymentCount}
                      {r.pendingPayments > 0 && <div className="text-[11px] text-amber-700">{r.pendingPayments} pending</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.nextAction}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                      <EmptyState title="No subscriptions match." hint="Try a different search or clear the filters." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pager */}
          {total > 0 && (
            <nav
              aria-label="Subscription registry pages"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <p className="text-xs tabular-nums text-slate-500">
                Page {page} of {totalPages}
                {registry ? ` · ${num.format(total)} subscription${total === 1 ? '' : 's'}` : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm" disabled={page <= 1 || loading}
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  ← Previous
                </Button>
                <Button
                  variant="outline" size="sm" disabled={page >= totalPages || loading}
                  onClick={() => onPageChange(page + 1)}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Next →
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

function SummaryStat({ icon, label, value, tone, title, onClick, active }: { icon: React.ReactNode; label: string; value: number; tone?: string; title?: string; onClick?: () => void; active?: boolean }) {
  // Click-to-filter (PHASE 3): a KPI card IS a group — clicking it drills
  // the registry into that cohort (rendered as a real button when wired).
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={Boolean(active)}
        title={title ?? label}
        className={`rounded-xl border bg-white p-3 text-left shadow-sm transition-colors sm:p-4 ${active ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200 hover:border-teal-300'}`}
      >
        <div className="flex items-center gap-1.5 text-slate-500">
          {icon}
          <span className="text-xs leading-tight">{label}</span>
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</div>
      </button>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" title={title}>
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-xs leading-tight">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

// ── student entitlements (secondary area — school FIRST) ───────────────

function StudentEntitlementsSection({
  onSchemaPending, onAssigned,
}: {
  onSchemaPending: () => void
  onAssigned: () => void
}) {
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [schoolsLoading, setSchoolsLoading] = useState(true)
  const [schoolsError, setSchoolsError] = useState<string | null>(null)
  const [schoolId, setSchoolId] = useState('')
  const [students, setStudents] = useState<StudentRow[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState<string | null>(null)
  const [studentsPending, setStudentsPending] = useState(false)
  const [q, setQ] = useState('')
  const [assignFor, setAssignFor] = useState<StudentRow | null>(null)
  const [detailFor, setDetailFor] = useState<StudentRow | null>(null)

  const loadSchools = useCallback(async () => {
    setSchoolsLoading(true)
    setSchoolsError(null)
    try {
      const d = await platformApi<{ subscriptionSchemaPending?: boolean; schools: Array<{ id: string; name: string; slug: string }> }>(
        '/api/platform/schools?pageSize=200',
      )
      setSchools(d.schools.map((s) => ({ id: s.id, name: s.name, slug: s.slug })))
      if (isSubscriptionSchemaPending(d)) onSchemaPending()
    } catch (e) {
      setSchoolsError(errMessage(e))
    } finally {
      setSchoolsLoading(false)
    }
  }, [onSchemaPending])

  useEffect(() => { void loadSchools() }, [loadSchools])

  const loadStudents = useCallback(async (sid: string, query2 = '') => {
    if (!sid) return
    setStudentsLoading(true)
    setStudentsError(null)
    try {
      const d = await platformApi<{ subscriptionSchemaPending?: boolean; school: { billingModel: string }; students: StudentRow[] }>(
        `/api/platform/schools/${sid}/students?q=${encodeURIComponent(query2)}&pageSize=50`,
      )
      setStudents(d.students)
      setStudentsPending(isSubscriptionSchemaPending(d))
      if (isSubscriptionSchemaPending(d)) onSchemaPending()
    } catch (e) {
      setStudentsError(errMessage(e))
    } finally {
      setStudentsLoading(false)
    }
  }, [onSchemaPending])

  const assignDisabled = studentsPending
  const assignHint = assignDisabled
    ? 'Assignment is unavailable until the pending subscription-system migration is applied.'
    : `Assign a subscription to this student`

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Users className="h-4 w-4 text-teal-600" aria-hidden="true" />Student entitlements
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Per-student subscriptions for per-student (B) and manual (C) billing schools. Pick a school first.
        </p>
      </div>

      {/* School picker */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {schoolsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-14 bg-slate-200" />
            <Skeleton className="h-10 w-full bg-slate-200" />
          </div>
        ) : schoolsError ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-600">Could not load the school list: {schoolsError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadSchools()} className="border-slate-300 bg-white text-slate-700">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          </div>
        ) : (
          <>
            <Label htmlFor="student-school" className="text-xs text-slate-500">School</Label>
            <Select value={schoolId} onValueChange={(v) => { setSchoolId(v); setStudentsError(null); void loadStudents(v) }}>
              <SelectTrigger id="student-school" className="mt-1 h-10 border-slate-300 bg-white" aria-label="Select a school">
                <SelectValue placeholder="Select a school…" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-slate-500">
              Students and their entitlements load after you pick a school.
            </p>
          </>
        )}
      </div>

      {/* Student workspace */}
      {schoolId && !schoolsError && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Search students by name, email or admission number"
                placeholder="Search name / admission no…"
                className="h-10 border-slate-300 bg-white pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void loadStudents(schoolId, q) }}
              />
            </div>
            <Button
              variant="outline" size="sm" onClick={() => void loadStudents(schoolId, q)}
              className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Search
            </Button>
          </div>

          {studentsLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="space-y-3 p-4">
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
              </div>
            </div>
          ) : studentsError ? (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-red-600">Could not load students: {studentsError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadStudents(schoolId, q)} className="border-slate-300 bg-white text-slate-700">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {students.map((s) => (
                  <div key={s.studentId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-slate-900">{s.name}</p>
                          {s.accountLocked && <Badge variant="outline" className="text-[10px]">account locked</Badge>}
                        </div>
                        <p className="truncate text-xs text-slate-500">{s.email}</p>
                      </div>
                      <StateBadge state={s.entitlement.computedState} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>Class: {s.class ?? '—'}</span>
                      <span>Valid until: {dateStr(s.entitlement.validityEnd ?? null)}</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 border-slate-300 text-slate-700" onClick={() => setDetailFor(s)}>History</Button>
                      <Button
                        size="sm" className="flex-1 bg-teal-600 font-semibold text-white hover:bg-teal-700"
                        disabled={assignDisabled} title={assignHint} onClick={() => setAssignFor(s)}
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />Assign
                      </Button>
                    </div>
                  </div>
                ))}
                {students.length === 0 && <EmptyState title="No students match." hint="Try a different search." />}
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">Students of the selected school with entitlement state and actions</caption>
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2.5">Student</th>
                      <th scope="col" className="px-3 py-2.5">Class</th>
                      <th scope="col" className="px-3 py-2.5">Status</th>
                      <th scope="col" className="px-3 py-2.5">Valid until</th>
                      <th scope="col" className="px-3 py-2.5">Source</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.studentId} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {s.name}
                          {s.accountLocked && <Badge variant="outline" className="ml-2 text-[10px]">account locked</Badge>}
                          <div className="text-xs font-normal text-slate-500">{s.email}</div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{s.class ?? '—'}</td>
                        <td className="px-3 py-2.5"><StateBadge state={s.entitlement.computedState} /></td>
                        <td className="px-3 py-2.5 text-slate-700">{dateStr(s.entitlement.validityEnd ?? null)}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{s.entitlement.source ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" size="sm" className="border-slate-300 text-slate-700" onClick={() => setDetailFor(s)}>History</Button>
                            <Button
                              size="sm" className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
                              disabled={assignDisabled} title={assignHint} onClick={() => setAssignFor(s)}
                            >
                              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />Assign
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                          <EmptyState title="No students match." hint="Try a different search." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {assignFor && (
        <AssignEntitlementDialog
          student={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); void loadStudents(schoolId, q); onAssigned() }}
        />
      )}
      {detailFor && (
        <StudentHistoryDialog student={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </div>
  )
}
