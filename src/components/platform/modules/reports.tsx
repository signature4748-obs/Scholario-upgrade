'use client'

// ============================================================
// ReportsAuditModule — /platform/reports (PAYMENTS & GATEWAYS REDESIGN)
// ------------------------------------------------------------
// Renewals, expiry, reconciliation and audit history — the oversight
// surface for the subscription system:
//   · Renewals & expiry — configurable horizon worklist (7/30/90/180d),
//     expired counts, unpaid open-access rows (legacy fail-open),
//     registry-wide buckets.
//   · Reconciliation — the scheduled subscription-reconcile JobRun trail
//     + what the sweeps would expire right now + the platform.billing.*
//     audit feed.
//   · Audit log — the full audit viewer (AuditModule embedded; the old
//     /platform/audit route keeps working as an alias to this tab).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, CalendarClock, CalendarX, RefreshCw, ScrollText,
  ShieldAlert, ShieldCheck, Waypoints,
} from 'lucide-react'
import { platformApi } from '../platform-client'
import {
  dateStr, errMessage,
  type RegistryRow,
} from './subscription-shared'
import { AuditModule } from './audit'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface OperationsData {
  subscriptionSchemaPending?: boolean
  renewals: {
    horizonDays: number
    expiring7: number
    expiring30: number
    expiring90: number
    expired: number
    activePaidSubscriptions: number
    unpaidOpenAccess: number
  }
  actionList: Array<{
    schoolId: string
    schoolName: string
    state: string
    subscriptionState: string
    paymentState: string
    periodEnd: string | null
    nextAction: string
  }>
  reconcile: {
    runs: Array<{
      jobId: string
      jobName: string
      trigger: string
      status: string
      startedAt: string
      finishedAt: string | null
      durationMs: number | null
      resultSummary: string | null
      error: string | null
    }>
    sweep: { codesExpiringSoon: number | null; lapsedEntitlements: number | null; staleOrders: number | null }
  }
  auditFeed: Array<{
    id: string
    action: string
    adminId: string | null
    targetType: string | null
    targetId: string | null
    schoolId: string | null
    reason: string | null
    createdAt: string
  }>
}

interface RegistryData {
  subscriptionSchemaPending?: boolean
  schools: { rows: RegistryRow[]; total: number }
  summary: { subscriptionsExpiringWithin30Days: number }
}

const HORIZONS = ['7', '30', '90', '180'] as const

export function ReportsAuditModule({ initialTab }: { initialTab?: 'renewals' | 'reconcile' | 'audit' }) {
  const [tab, setTab] = useState<string>(initialTab ?? 'renewals')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Reports &amp; Audit</h1>
        <p className="mt-1 text-sm text-slate-500">
          Renewals, expiry, reconciliation runs and the audit history of the subscription system.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-10 bg-slate-100 p-1">
          <TabsTrigger value="renewals" className="h-8 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Renewals &amp; expiry
          </TabsTrigger>
          <TabsTrigger value="reconcile" className="h-8 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />Reconciliation
          </TabsTrigger>
          <TabsTrigger value="audit" className="h-8 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />Audit log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="renewals" className="mt-4 space-y-4">
          <RenewalsReport />
        </TabsContent>
        <TabsContent value="reconcile" className="mt-4 space-y-4">
          <Reconciliation />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditModule />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── renewals & expiry ──────────────────────────────────────────────────

function RenewalsReport() {
  const router = useRouter()
  const [horizon, setHorizon] = useState<string>('30')
  const [ops, setOps] = useState<OperationsData | null>(null)
  const [worklist, setWorklist] = useState<RegistryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [opsData, reg] = await Promise.all([
        platformApi<OperationsData>(`/api/platform/reports/operations?horizonDays=${horizon}`),
        platformApi<RegistryData>(`/api/platform/subscriptions/registry?expiringDays=${horizon}&pageSize=100`),
      ])
      setOps(opsData)
      setWorklist(reg)
      setPending(isSubscriptionSchemaPending(opsData) || isSubscriptionSchemaPending(reg))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [horizon])

  useEffect(() => { void load() }, [load])

  const rows = [...(worklist?.schools.rows ?? [])].sort((a, b) => {
    const ea = a.periodEnd ? new Date(a.periodEnd).getTime() : Number.POSITIVE_INFINITY
    const eb = b.periodEnd ? new Date(b.periodEnd).getTime() : Number.POSITIVE_INFINITY
    return ea - eb
  })
  const nowMs = Date.now()
  const daysLeft = (iso: string): number =>
    Math.max(0, Math.ceil((new Date(iso).getTime() - nowMs) / 86_400_000))

  const UrgencyBadge = ({ iso }: { iso: string }) => {
    const d = daysLeft(iso)
    const cls =
      d <= 7 ? 'border-red-200 bg-red-50 text-red-700'
        : d <= 14 ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    return <Badge variant="outline" className={`text-[10px] ${cls}`}>{d === 0 ? 'expires today' : `${d}d left`}</Badge>
  }

  return (
    <div className="space-y-4">
      {pending && <SubscriptionPendingBanner compact />}

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Could not load the report: {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {loading && !ops ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-3 w-20 bg-slate-200" />
              <Skeleton className="mt-3 h-7 w-12 bg-slate-200" />
            </div>
          ))}
        </div>
      ) : ops && !error ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Registry-wide buckets (fixed) — worklist follows the selected horizon.</p>
            <Select value={horizon} onValueChange={(v) => setHorizon(v)}>
              <SelectTrigger className="h-9 w-[170px] border-slate-300 bg-white" aria-label="Worklist horizon">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HORIZONS.map((h) => <SelectItem key={h} value={h}>Horizon: {h} days</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="Active — paid" value={ops.renewals.activePaidSubscriptions} tone="text-emerald-700" />
            <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Unpaid — access allowed" value={ops.renewals.unpaidOpenAccess} tone="text-amber-700" />
            <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Expiring ≤7d" value={ops.renewals.expiring7} />
            <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Expiring ≤30d" value={ops.renewals.expiring30} />
            <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Expiring ≤90d" value={ops.renewals.expiring90} />
            <Kpi icon={<CalendarX className="h-4 w-4" />} label="Expired" value={ops.renewals.expired} tone="text-orange-700" />
          </div>

          {/* Worklist table */}
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-slate-600">Nothing expires within {horizon} days.</p>
              <p className="mt-1 text-xs text-slate-500">The registry-wide buckets above still describe the whole registry.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[860px] text-sm">
                <caption className="sr-only">School subscriptions expiring within the horizon, soonest first, with next actions</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">School</th>
                    <th scope="col" className="px-3 py-2.5">Plan</th>
                    <th scope="col" className="px-3 py-2.5">Payment</th>
                    <th scope="col" className="px-3 py-2.5">Valid until</th>
                    <th scope="col" className="px-3 py-2.5">Urgency</th>
                    <th scope="col" className="px-3 py-2.5">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.subscriptionId}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60"
                      onClick={() => router.push(`/platform/schools/${r.school.id}?tab=subscription`)}
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {r.school.name}
                        <div className="text-xs font-normal text-slate-500">{r.school.slug}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{r.planDef ? r.planDef.name : r.planCode ?? r.plan}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className={`text-[11px] ${r.paymentState === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : r.paymentState === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                          {r.paymentState?.toLowerCase() ?? '—'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{r.periodEnd ? dateStr(r.periodEnd) : '—'}</td>
                      <td className="px-3 py-2.5">{r.periodEnd ? <UrgencyBadge iso={r.periodEnd} /> : '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{r.nextAction ?? 'Prepare renewal'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-xs leading-tight">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

// ── reconciliation ─────────────────────────────────────────────────────

function Reconciliation() {
  const [ops, setOps] = useState<OperationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setOps(await platformApi<OperationsData>('/api/platform/reports/operations?horizonDays=30'))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Could not load reconciliation data: {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {loading && !ops ? (
        <Skeleton className="h-40 w-full rounded-xl bg-slate-100" />
      ) : ops && !error ? (
        <>
          {ops.subscriptionSchemaPending && <SubscriptionPendingBanner compact />}

          {/* Sweep preview — what the next run would reconcile */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="sweep-heading">
            <h2 id="sweep-heading" className="text-sm font-semibold text-slate-900">Sweep state right now</h2>
            <p className="mt-0.5 text-xs text-slate-500">The scheduled reconciliation is idempotent; enforcement is live-computed regardless.</p>
            <ul className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5">
                <span>Issued codes expiring ≤7d</span>
                <span className="font-semibold tabular-nums text-slate-800">{ops.reconcile.sweep.codesExpiringSoon ?? '—'}</span>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5">
                <span>Lapsed live entitlements</span>
                <span className="font-semibold tabular-nums text-slate-800">{ops.reconcile.sweep.lapsedEntitlements ?? '—'}</span>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5">
                <span>Stale pending orders (&gt;1h)</span>
                <span className="font-semibold tabular-nums text-slate-800">{ops.reconcile.sweep.staleOrders ?? '—'}</span>
              </li>
            </ul>
          </section>

          {/* JobRun trail */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="runs-heading">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 id="runs-heading" className="text-sm font-semibold text-slate-900">Reconciliation runs (JobRun trail)</h2>
            </div>
            {ops.reconcile.runs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">
                No reconciliation runs recorded yet. The daily cron (03:20 UTC) records one row per hour bucket here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ops.reconcile.runs.map((r) => (
                  <li key={r.jobId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] text-slate-700">{r.jobId}</div>
                      <div className="text-[11px] text-slate-500">
                        {dateStr(r.startedAt)} · trigger {r.trigger}
                        {r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.resultSummary && <span className="max-w-[320px] truncate text-[11px] text-slate-500" title={r.resultSummary}>{r.resultSummary}</span>}
                      <Badge variant="outline" className={`text-[10px] ${r.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : r.status === 'failed' ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                        {r.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Subscription audit feed */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="audit-feed-heading">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 id="audit-feed-heading" className="text-sm font-semibold text-slate-900">Recent subscription audit events</h2>
              <p className="mt-0.5 text-xs text-slate-500">platform.billing.* — the privileged mutation trail. The full viewer lives in the Audit log tab.</p>
            </div>
            {ops.auditFeed.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">No subscription audit events recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ops.auditFeed.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-700">{a.action}</span>
                      {a.schoolId && <span className="text-[11px] text-slate-400">school {a.schoolId.slice(0, 8)}…</span>}
                      <span className="text-[11px] text-slate-400">{dateStr(a.createdAt)}</span>
                    </div>
                    {a.reason && <p className="mt-0.5 text-[11px] text-slate-500">{a.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
