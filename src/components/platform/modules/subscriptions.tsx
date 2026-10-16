'use client'

// ============================================================
// SubscriptionsModule — /platform/subscriptions (§8 simplification)
// ------------------------------------------------------------
// THE ROUTINE EXPERIENCE IS A SCHOOL SUBSCRIPTION OVERVIEW:
// a summary row, a searchable/filterable table of every tenant's
// subscription, and a per-school detail drawer (billing model,
// plan, status, validity, override, payment history).
//
// The advanced workflows live behind progressive disclosure — NOT
// top-level tabs:
//   · "Student entitlements" — a secondary area (school FIRST, then
//     student search + assign/history dialogs via subscription-shared).
//   · "Manage plans" — the plan registry + creation form + the
//     commercial-model config switches.
//
// HONESTY CONTRACTS (schema-pending migration):
//   · The registry/plans/school-picker responses may carry
//     `subscriptionSchemaPending: true` — ONE shared banner near the
//     top (pending-banner.tsx) explains what is unavailable; nulls
//     render "—"; mutations fail with SUBSCRIPTION_SYSTEM_PENDING and
//     the publicMessage is surfaced inline.
//   · ERROR ≠ EMPTY: every load tracks a real error state and renders
//     a retryable error panel. Empty states appear ONLY after a
//     successful zero-row response. Skeletons never survive a failure.
//   · All actions stay billing.manage-gated server-side; this UI only
//     sends fields, never trusting client-side gating.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, CalendarX, Check,
  CreditCard, Eye, KeyRound, Loader2, Package, RefreshCw, Search,
  Settings2, ShieldAlert, SlidersHorizontal, Users,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import {
  AssignEntitlementDialog, StudentHistoryDialog,
  StateBadge, dateStr, errMessage, money,
  type StudentRow, type PlanRow,
} from './subscription-shared'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

// ── types ──────────────────────────────────────────────────────────────

interface SubsConfig {
  models: { school: { enabled: boolean }; student: { enabled: boolean }; manual: { enabled: boolean } }
  defaultBillingModel: string
  student: { defaultClaimWindowDays: number; defaultValidityMonths: number }
  school: { defaultGraceDays: number }
}
interface SchoolOption { id: string; name: string; slug: string }

/** Honest registry row shape — pending-migration columns are NULL
 *  (billingModel/planCode/interval/priceSnapshot/currencySnapshot/
 *  paymentCount), never fabricated. */
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
  entitlement: { state: string; businessAllowed: boolean; renewalRequired: boolean }
}

/** GET /api/platform/subscriptions/registry — summary nulls mean the
 *  subsystem is not provisioned on this database (never "zero"). */
interface RegistryData {
  subscriptionSchemaPending?: boolean
  schools: { rows: SubscriptionRow[]; total: number }
  summary: {
    studentEntitlements: Record<string, number> | null
    orders: Record<string, number> | null
    rejectedClaims: number | null
    subscriptionsExpiringWithin30Days: number
  }
}

/** GET /api/platform/schools/[id]/subscription — the payment ledger
 *  (works under schema-pending: legacy columns + PlatformPayment). */
interface SchoolSubscriptionDetail {
  school: { id: string; name: string; slug: string; status: string }
  subscription: {
    status: string
    plan: string
    periodStart: string | null
    periodEnd: string | null
    graceDays: number
    overrideStatus: string | null
    notes: string | null
  } | null
  entitlement: { state: string; businessAllowed: boolean; renewalRequired: boolean; message: string | null }
  payments: Array<{
    id: string
    receiptNo: string | null
    amount: number
    currency: string
    mode: string
    paymentDate: string
    periodMonths: number
    reference: string | null
    notes: string | null
    verification: string
    recordedBy: { name: string; email: string } | null
    statusAfter: string | null
    periodEndAfter: string | null
    createdAt: string
  }>
}

const TENANT_STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'GRACE', label: 'Grace' },
  { value: 'RESTRICTED', label: 'Restricted' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'NOT_ACTIVATED', label: 'Not activated' },
] as const

const NEEDS_REVIEW_STATES = ['GRACE', 'RESTRICTED', 'SUSPENDED']
const DAY_MS = 24 * 60 * 60 * 1000

/** SSR-safe media query (resolved before any overlay can be opened). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    const onChange = () => setMatches(m.matches)
    onChange()
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// ── module ─────────────────────────────────────────────────────────────

export function SubscriptionsModule() {
  const [view, setView] = useState<'overview' | 'students' | 'plans'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [registry, setRegistry] = useState<RegistryData | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  /** Page-level schema-pending signal lifted from any secondary surface. */
  const [secondaryPending, setSecondaryPending] = useState(false)

  const signalPending = useCallback(() => setSecondaryPending(true), [])

  const load = useCallback(async (q: string, status: string) => {
    setLoading(true)
    setError(null)
    try {
      const reg = await platformApi<RegistryData>(
        `/api/platform/subscriptions/registry?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}&pageSize=50`,
      )
      setRegistry(reg)
    } catch (e) {
      // ERROR ≠ EMPTY — a failed request must never look like "no rows".
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load('', '') }, [load])

  /** Search/filter application — the parent owns the query + status state
   *  so the overview is always a single source of truth. */
  const handleSearch = useCallback((q: string, status: string) => {
    setStatusFilter(status)
    void load(q, status)
  }, [load])

  const schemaPending = (registry != null && isSubscriptionSchemaPending(registry)) || secondaryPending

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Subscriptions</h1>
          <p className="mt-1 text-sm text-slate-500">View and manage school subscription status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === 'overview' ? (
            <>
              <Button
                variant="outline" size="sm" onClick={() => setView('students')}
                className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <Users className="h-4 w-4" aria-hidden="true" />Student entitlements
              </Button>
              <Button
                variant="outline" size="sm" onClick={() => setView('plans')}
                className="h-9 border-teal-600 text-teal-700 hover:bg-teal-50"
                aria-label="Manage plans and commercial models"
              >
                <Package className="h-4 w-4" aria-hidden="true" />Manage plans
              </Button>
            </>
          ) : (
            <Button
              variant="outline" size="sm" onClick={() => setView('overview')}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to overview
            </Button>
          )}
        </div>
      </div>

      {/* The ONE shared honest banner — rendered once near the top. */}
      {schemaPending && <SubscriptionPendingBanner />}

      {view === 'students' ? (
        <StudentEntitlementsSection
          onSchemaPending={signalPending}
          onAssigned={() => void load(query, statusFilter)}
        />
      ) : view === 'plans' ? (
        <PlansSection onSchemaPending={signalPending} />
      ) : (
        <OverviewSection
          loading={loading}
          error={error}
          registry={registry}
          query={query}
          statusFilter={statusFilter}
          onQueryChange={setQuery}
          onSearch={handleSearch}
          onRetry={() => void load(query, statusFilter)}
        />
      )}
    </div>
  )
}

// ── overview (the routine experience) ──────────────────────────────────

function OverviewSection({
  loading, error, registry, query, statusFilter, onQueryChange, onSearch, onRetry,
}: {
  loading: boolean
  error: string | null
  registry: RegistryData | null
  query: string
  statusFilter: string
  onQueryChange: (q: string) => void
  onSearch: (q: string, status: string) => void
  onRetry: () => void
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<SubscriptionRow | null>(null)

  const rows = registry?.schools.rows ?? []
  const now = Date.now()
  const active = rows.filter((r) => r.entitlement.state === 'ACTIVE').length
  const expiringSoon = rows.filter((r) => {
    if (!r.periodEnd) return false
    const end = new Date(r.periodEnd).getTime()
    return end >= now && end <= now + 30 * DAY_MS
  }).length
  const expired = rows.filter((r) => r.periodEnd != null && new Date(r.periodEnd).getTime() < now).length
  const needsReview = rows.filter((r) => NEEDS_REVIEW_STATES.includes(r.entitlement.state)).length

  const applyStatus = (value: string) => {
    const next = statusFilter === value ? '' : value
    setFilterOpen(false)
    onSearch(query, next)
  }

  return (
    <div className="space-y-4">
      {/* Compact summary row — only when real data loaded (never on
          failure, never fabricated zeros). */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-3 w-20 bg-slate-200" />
              <Skeleton className="mt-3 h-7 w-12 bg-slate-200" />
            </div>
          ))}
        </div>
      ) : registry && !error ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryStat icon={<Building2 className="h-4 w-4" />} label="Active subscriptions" value={active} />
          <SummaryStat icon={<CalendarClock className="h-4 w-4" />} label="Expiring soon (30d)" value={expiringSoon} />
          <SummaryStat icon={<CalendarX className="h-4 w-4" />} label="Expired" value={expired} />
          <SummaryStat icon={<ShieldAlert className="h-4 w-4" />} label="Schools needing review" value={needsReview} />
        </div>
      ) : null}

      {/* Load error — the durable surface (retry), never an empty state. */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Could not load subscriptions: {error}</span>
          </p>
          <Button
            variant="outline" size="sm" onClick={onRetry}
            className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {/* Search + the ONE compact filter control */}
      {!error && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search subscriptions by school name, slug or code"
              placeholder="Search school name / slug / code…"
              className="h-10 border-slate-300 bg-white pl-9"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch(query, statusFilter) }}
            />
          </div>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline" size="sm"
                aria-label="Filter subscriptions by status"
                aria-expanded={filterOpen}
                className="h-10 w-full border-slate-300 bg-white text-slate-700 hover:bg-slate-100 sm:w-auto"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filter
                {statusFilter && (
                  <Badge variant="outline" className="ml-1 border-teal-200 bg-teal-50 text-[10px] text-teal-700">1</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <div className="mt-1.5 space-y-0.5">
                {TENANT_STATUS_FILTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={statusFilter === s.value}
                    onClick={() => applyStatus(s.value)}
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
                  disabled={!statusFilter}
                  onClick={() => { setFilterOpen(false); onSearch(query, '') }}
                >
                  Clear all
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Registry table (desktop) / cards (mobile) */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
          </div>
        </div>
      ) : !error && (
        <>
          <p className="text-xs text-slate-500" aria-live="polite">
            Showing {rows.length} of {registry?.schools.total ?? 0} school subscriptions
            {statusFilter ? ` · status: ${TENANT_STATUS_FILTERS.find((s) => s.value === statusFilter)?.label ?? statusFilter}` : ''}
          </p>

          {/* Mobile card list (no horizontal scroll at phone widths) */}
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
                  <StateBadge state={r.entitlement.state} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>Plan: {r.planDef ? r.planDef.name : r.plan}</span>
                  <span>Valid until: {dateStr(r.periodEnd)}</span>
                  <span>Payments: {r.paymentCount == null ? '—' : r.paymentCount}</span>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setDetailRow(r)}
                  className="mt-2 w-full border-slate-300 text-slate-700"
                  aria-label={`View subscription details for ${r.school.name}`}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />View
                </Button>
              </div>
            ))}
            {rows.length === 0 && <EmptyState title="No subscriptions match." hint="Try a different search or clear the filters." />}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">School subscriptions with current plan, status, validity and payment count</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">School</th>
                  <th scope="col" className="px-3 py-2.5">Current plan</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5">Valid until</th>
                  <th scope="col" className="px-3 py-2.5">Payments</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subscriptionId} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {r.school.name}
                      {r.school.isDemo && <Badge variant="outline" className="ml-2 text-[10px]">demo</Badge>}
                      <div className="text-xs font-normal text-slate-500">{r.school.slug}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {r.planDef ? r.planDef.name : r.plan}
                      {r.interval && <div className="text-xs text-slate-500">{r.interval.toLowerCase()}</div>}
                    </td>
                    <td className="px-3 py-2.5"><StateBadge state={r.entitlement.state} /></td>
                    <td className="px-3 py-2.5 text-slate-700">{dateStr(r.periodEnd)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-700">{r.paymentCount == null ? '—' : r.paymentCount}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setDetailRow(r)}
                        className="border-slate-300 text-slate-700"
                        aria-label={`View subscription details for ${r.school.name}`}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />View
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                      <EmptyState title="No subscriptions match." hint="Try a different search or clear the filters." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Per-school detail overlay — Drawer on mobile, Dialog on desktop */}
      {detailRow && <SchoolDetailOverlay row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  )
}

function SummaryStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</div>
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

// ── per-school detail overlay ──────────────────────────────────────────

function SchoolDetailOverlay({ row, onClose }: { row: SubscriptionRow; onClose: () => void }) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [detail, setDetail] = useState<SchoolSubscriptionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await platformApi<SchoolSubscriptionDetail>(`/api/platform/schools/${row.school.id}/subscription`))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [row.school.id])

  useEffect(() => { void load() }, [load])

  const sections = (
    <SchoolDetailSections row={row} detail={detail} loading={loading} error={error} onRetry={() => void load()} />
  )

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{row.school.name}</DialogTitle>
            <DialogDescription>
              Subscription details · {row.school.slug} · code {row.school.code}
            </DialogDescription>
          </DialogHeader>
          {sections}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{row.school.name}</DrawerTitle>
          <DrawerDescription>Subscription details · {row.school.slug} · code {row.school.code}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-4">{sections}</div>
      </DrawerContent>
    </Drawer>
  )
}

function SchoolDetailSections({
  row, detail, loading, error, onRetry,
}: {
  row: SubscriptionRow
  detail: SchoolSubscriptionDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Subscription snapshot (operator-facing labels, plain English) */}
      <section aria-labelledby="sub-detail-snapshot">
        <h3 id="sub-detail-snapshot" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription</h3>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2.5 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
          <DetailField label="Status">
            <StateBadge state={row.entitlement.state} />
            <span className="ml-2 text-xs text-slate-500">
              {row.entitlement.businessAllowed ? 'business modules unlocked' : 'business modules locked'}
              {row.entitlement.renewalRequired ? ' · renewal required' : ''}
            </span>
          </DetailField>
          <DetailField label="Current plan">
            {row.planDef ? row.planDef.name : row.plan}
            {row.planCode && <div className="font-mono text-xs text-slate-500">{row.planCode}</div>}
          </DetailField>
          <DetailField label="Billing model">
            {row.billingModel ? row.billingModel.replace(/_/g, ' ').toLowerCase() : '—'}
          </DetailField>
          <DetailField label="Grace period">{row.graceDays} days after expiry</DetailField>
          <DetailField label="Started">{dateStr(row.periodStart)}</DetailField>
          <DetailField label="Valid until">{dateStr(row.periodEnd)}</DetailField>
          <DetailField label="Manual override">
            {row.overrideStatus ? row.overrideStatus.toLowerCase() : 'None — computed state applies'}
          </DetailField>
          <DetailField label="Notes">
            <span className="whitespace-pre-wrap break-words text-slate-700">{row.notes ?? '—'}</span>
          </DetailField>
        </dl>
      </section>

      {/* Payment history — the per-school payment ledger fetch */}
      <section aria-labelledby="sub-detail-payments">
        <div className="flex items-center justify-between">
          <h3 id="sub-detail-payments" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment history</h3>
          {detail && <span className="text-xs text-slate-500 tabular-nums">{detail.payments.length} recorded</span>}
        </div>
        <div className="mt-2">
          {loading ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-red-600">Could not load payment history: {error}</p>
              <Button variant="outline" size="sm" onClick={onRetry} className="border-slate-300 bg-white text-slate-700">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
              </Button>
            </div>
          ) : detail && detail.payments.length > 0 ? (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {detail.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-slate-700">{p.receiptNo ?? '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {dateStr(p.paymentDate)} · {p.mode.replace(/_/g, ' ').toLowerCase()}
                      {p.periodMonths ? ` · ${p.periodMonths} mo` : ''}
                      {p.recordedBy ? ` · by ${p.recordedBy.name}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums text-slate-900">{money(p.amount, p.currency)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No payments recorded yet." hint="Payments appear here once the school's subscription is renewed through the platform." />
          )}
        </div>
      </section>
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
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
  // School picker state — retryable error, never a toast-only failure.
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [schoolsLoading, setSchoolsLoading] = useState(true)
  const [schoolsError, setSchoolsError] = useState<string | null>(null)
  const [schoolId, setSchoolId] = useState('')
  // Student registry state for the selected school.
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

      {/* School picker — the FIRST required step (retryable error state) */}
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

      {/* Student workspace — only after a school is selected */}
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
              {/* Mobile card list */}
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

              {/* Desktop table */}
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

      {/* Preserved workflows: assign + history dialogs (subscription-shared) */}
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

// ── plans & commercial models (secondary area) ─────────────────────────

function PlansSection({ onSchemaPending }: { onSchemaPending: () => void }) {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [config, setConfig] = useState<SubsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<{ subscriptionSchemaPending?: boolean; plans: PlanRow[]; config: SubsConfig }>(
        '/api/platform/subscriptions/plans',
      )
      setPlans(d.plans)
      setConfig(d.config)
      setPending(isSubscriptionSchemaPending(d))
      if (isSubscriptionSchemaPending(d)) onSchemaPending()
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [onSchemaPending])

  useEffect(() => { void load() }, [load])

  const saveConfig = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await platformApi('/api/platform/subscriptions/config', { method: 'PATCH', body: JSON.stringify(patch) })
      toast.success('Configuration saved')
      void load()
    } catch (e) {
      toast.error('Config save failed', { description: errMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const archive = async (id: string) => {
    try {
      await platformApi(`/api/platform/subscriptions/plans/${id}`, { method: 'DELETE' })
      toast.success('Plan archived')
      void load()
    } catch (e) {
      toast.error('Archive failed', { description: errMessage(e) })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Package className="h-4 w-4 text-teal-600" aria-hidden="true" />Plans &amp; commercial models
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          The plan registry schools purchase from, plus which subscription models are offered.
        </p>
      </div>

      {/* Commercial-model config — always served (pre-migration settings) */}
      {config && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="plans-config-heading">
          <h3 id="plans-config-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Settings2 className="h-4 w-4" aria-hidden="true" />Commercial models
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">Which subscription models are offered. New schools default to the selected billing model.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(['school', 'student', 'manual'] as const).map((k) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 capitalize">{k === 'school' ? 'Per-school (A)' : k === 'student' ? 'Per-student (B)' : 'Manual (C)'}</div>
                  <div className="text-xs text-slate-500">{k === 'school' ? 'monthly / annual' : k === 'student' ? 'annual per student' : 'operator-assigned'}</div>
                </div>
                <Switch
                  checked={config.models[k].enabled}
                  disabled={saving}
                  onCheckedChange={(v) => void saveConfig({ models: { ...config.models, [k]: { enabled: v } } })}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Default billing model</div>
              <Select value={config.defaultBillingModel} onValueChange={(v) => void saveConfig({ defaultBillingModel: v })}>
                <SelectTrigger className="h-9 w-[170px] border-slate-300 bg-white" aria-label="Default billing model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Student claim window</div>
              <Input className="h-9 w-20 border-slate-300 bg-white" type="number" min="1" max="365" defaultValue={config.student.defaultClaimWindowDays}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultClaimWindowDays) void saveConfig({ student: { ...config.student, defaultClaimWindowDays: v } }) }}
                aria-label="Student claim window in days" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Student validity (months)</div>
              <Input className="h-9 w-20 border-slate-300 bg-white" type="number" min="1" max="36" defaultValue={config.student.defaultValidityMonths}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultValidityMonths) void saveConfig({ student: { ...config.student, defaultValidityMonths: v } }) }}
                aria-label="Student entitlement validity in months" />
            </div>
          </div>
        </section>
      )}

      {/* Plan registry */}
      <section className="space-y-2" aria-labelledby="plans-registry-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="plans-registry-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Package className="h-4 w-4" aria-hidden="true" />Plan registry
          </h3>
          {/* Consistent with the entitlements dialog's disabled Assign
              buttons: while the plan registry table itself is pending,
              a submit would only fail with the typed 503 — surface that
              up front instead of letting the operator fill the form
              first. */}
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={pending}
            title={pending ? 'The plan registry is created by the pending subscription-system migration — new plans become available once it is applied.' : undefined}
            className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />New plan
          </Button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-600">Could not load the plan registry: {error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()} className="border-slate-300 bg-white text-slate-700">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          </div>
        ) : plans.length === 0 ? (
          // Honest distinction: pending migration ≠ "none configured".
          pending ? (
            <EmptyState
              title="Plan registry is not provisioned on this database yet."
              hint="Plans are stored in a table created by the pending subscription-system migration. Commercial-model configuration above remains fully available."
            />
          ) : (
            <EmptyState title="No plans configured yet." hint="Create the first plan schools can purchase." />
          )
        ) : (
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">The plan registry with scope, price, policies and availability</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Plan</th>
                  <th scope="col" className="px-3 py-2.5">Scope</th>
                  <th scope="col" className="px-3 py-2.5">Price</th>
                  <th scope="col" className="px-3 py-2.5">Policies</th>
                  <th scope="col" className="px-3 py-2.5">Availability</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {p.name}
                      <div className="font-mono text-xs text-slate-500">{p.code}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline">{p.scope}</Badge>
                      <div className="text-xs text-slate-500">{p.interval.toLowerCase()}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {p.scope === 'STUDENT' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? `${money(p.priceMonthly, p.currency)}/mo` : `${money(p.priceAnnual, p.currency)}/yr`}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {p.allowOnline ? 'online' : '—'} · {p.allowOffline ? 'offline' : '—'} · grace {p.graceDays}d
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      <Badge variant="outline" className={p.status === 'ACTIVE' ? 'border-emerald-300 text-emerald-700' : ''}>{p.status}</Badge>
                      {p.availableForNew ? ' new' : ''}{p.availableForRenewal ? ' renewal' : ''}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        size="sm" variant="outline" className="border-slate-300 text-slate-700"
                        onClick={() => { if (window.confirm(`Archive plan ${p.code}? Historical purchases keep their snapshots.`)) void archive(p.id) }}
                      >
                        Archive
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile plan cards (registry table is wide) */}
        {!loading && !error && plans.length > 0 && (
          <div className="space-y-2 md:hidden">
            {plans.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                    <p className="font-mono text-xs text-slate-500">{p.code}</p>
                  </div>
                  <Badge variant="outline" className={p.status === 'ACTIVE' ? 'border-emerald-300 text-emerald-700' : ''}>{p.status}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>{p.scope === 'STUDENT' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? `${money(p.priceMonthly, p.currency)}/mo` : `${money(p.priceAnnual, p.currency)}/yr`}</span>
                  <span>{p.scope.toLowerCase()} · {p.interval.toLowerCase()}</span>
                  <span>grace {p.graceDays}d</span>
                </div>
                <div className="mt-1.5 text-xs text-slate-500">
                  {p.availableForNew ? 'new' : '—'} · {p.availableForRenewal ? 'renewal' : '—'} · {p.allowOnline ? 'online' : '—'} · {p.allowOffline ? 'offline' : '—'}
                </div>
                <Button
                  size="sm" variant="outline" className="mt-2 w-full border-slate-300 text-slate-700"
                  onClick={() => { if (window.confirm(`Archive plan ${p.code}? Historical purchases keep their snapshots.`)) void archive(p.id) }}
                >
                  Archive
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {creating && <PlanCreateDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function PlanCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false)
  /** Inline submit error — the durable surface (SUBSCRIPTION_SYSTEM_PENDING
   *  publicMessage is shown here, not only as a transient toast). */
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitPending, setSubmitPending] = useState(false)
  const [form, setForm] = useState({
    code: '', name: '', description: '', scope: 'STUDENT', interval: 'ANNUAL',
    price: '', currency: 'INR', graceDays: '14', allowOnline: true, allowOffline: true,
    availableForNew: true, availableForRenewal: true, sortOrder: '0',
  })

  const submit = async () => {
    setSaving(true)
    setSubmitError(null)
    setSubmitPending(false)
    try {
      await platformApi('/api/platform/subscriptions/plans', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.toUpperCase().trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          scope: form.scope,
          interval: form.interval,
          ...(form.scope === 'STUDENT'
            ? { pricePerStudent: Number(form.price || 0) }
            : form.interval === 'MONTHLY'
              ? { priceMonthly: Number(form.price || 0) }
              : { priceAnnual: Number(form.price || 0) }),
          currency: form.currency,
          graceDays: Number(form.graceDays || 14),
          allowOnline: form.allowOnline,
          allowOffline: form.allowOffline,
          availableForNew: form.availableForNew,
          availableForRenewal: form.availableForRenewal,
          sortOrder: Number(form.sortOrder || 0),
        }),
      })
      toast.success(`Plan ${form.code.toUpperCase()} created`)
      onCreated()
    } catch (e) {
      // errMessage(e) returns the publicMessage from the error envelope;
      // the pending-migration failure (SUBSCRIPTION_SYSTEM_PENDING, 503)
      // gets the amber "unavailable" treatment instead of a red error.
      const code = (e as PlatformApiError)?.code
      setSubmitPending(code === 'SUBSCRIPTION_SYSTEM_PENDING')
      setSubmitError(errMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>Prices are the platform&apos;s product prices — schools see them at renewal; students see student-scope plans.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {submitError && (
            <div role="alert" className={`rounded-lg border p-3 text-sm ${submitPending ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {submitPending ? 'Plan creation is unavailable on this database: ' : 'Plan creation failed: '}
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs" htmlFor="plan-code">Code</Label><Input id="plan-code" className="border-slate-300 bg-white" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="STUDENT-ANNUAL" /></div>
            <div><Label className="text-xs" htmlFor="plan-name">Name</Label><Input id="plan-name" className="border-slate-300 bg-white" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Student Annual" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="plan-scope">Scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v, interval: v === 'STUDENT' ? 'ANNUAL' : f.interval }))}>
                <SelectTrigger id="plan-scope" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SCHOOL">SCHOOL (Model A)</SelectItem><SelectItem value="STUDENT">STUDENT (Model B/C)</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="plan-interval">Interval</Label>
              <Select value={form.interval} onValueChange={(v) => setForm((f) => ({ ...f, interval: v }))} disabled={form.scope === 'STUDENT'}>
                <SelectTrigger id="plan-interval" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="MONTHLY">MONTHLY</SelectItem><SelectItem value="ANNUAL">ANNUAL</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs" htmlFor="plan-price">{form.scope === 'STUDENT' ? 'Per-student price' : form.interval === 'MONTHLY' ? 'Monthly price' : 'Annual price'}</Label><Input id="plan-price" className="border-slate-300 bg-white" type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
            <div>
              <Label className="text-xs" htmlFor="plan-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="plan-currency" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs" htmlFor="plan-grace">Grace days</Label><Input id="plan-grace" className="border-slate-300 bg-white" type="number" min="0" max="90" value={form.graceDays} onChange={(e) => setForm((f) => ({ ...f, graceDays: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs" htmlFor="plan-description">Description</Label><Textarea id="plan-description" className="border-slate-300 bg-white" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow online payment</span><Switch checked={form.allowOnline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOnline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow offline payment</span><Switch checked={form.allowOffline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOffline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for new</span><Switch checked={form.availableForNew} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForNew: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for renewal</span><Switch checked={form.availableForRenewal} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForRenewal: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button onClick={() => void submit()} disabled={saving} className="bg-teal-600 font-semibold text-white hover:bg-teal-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Create plan
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
