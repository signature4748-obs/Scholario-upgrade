'use client'

// ============================================================
// PaymentsGatewaysModule — /platform/payments
// (PAYMENTS & GATEWAYS REDESIGN — Phase 7)
// ------------------------------------------------------------
// The payment infrastructure control surface:
//   1. Platform gateway — the deployment's OWN provider account
//      (Scholario subscription payments + fee-lane fallback).
//      Configured HERE (billing.manage + step-up); secrets are
//      write-only, AES-256-GCM at rest, audited by length only.
//   2. Explicit resolution order — school override → platform default
//      → labelled unavailable. A school override that is ACTIVE but
//      undecryptable fails CLOSED server-side (never silently charges
//      the platform's own account for school fees).
//   3. School fee-gateway overrides — the list + the ONLY configuration
//      form (school detail shows status + this link instead).
//   4. Webhook health + the pending-verification pipeline.
//
// MONEY SEPARATION (structural, labelled here): platform subscription
// revenue vs school-collected student fees never share accounts,
// credentials, ledgers or webhooks.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, ArrowDown, Check, CreditCard, EyeOff, KeyRound, Landmark,
  Loader2, RefreshCw, ShieldCheck, Trash2, Webhook,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { dateStr, money } from './subscription-shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

// ── wire shapes ────────────────────────────────────────────────────────

interface PlatformGatewayView {
  provider: string | null
  publicKeyId: string | null
  mode: 'live' | 'test' | 'sandbox' | null
  status: string
  lastVerifiedAt: string | null
  webhookSecretConfigured: boolean
  envFallback: boolean
  resolution: string
}

interface SchoolGatewayRow {
  schoolId: string
  school: { id: string; name: string; slug: string }
  provider: string
  publicKeyId: string | null
  mode: 'test' | 'live' | null
  status: string
  lastVerifiedAt: string | null
  webhookSecretConfigured: boolean
  updatedAt: string
}

interface PaymentsOverview {
  subscriptionSchemaPending?: boolean
  gateway: PlatformGatewayView
  schoolGateways: SchoolGatewayRow[]
  webhookHealth: { byStatus: Record<string, number>; lastError: string | null }
  recentPayments: Array<{
    id: string
    school: { id: string; name: string } | null
    amount: number
    currency: string
    mode: string
    periodMonths: number
    paymentDate: string
    receiptNo: string | null
    statusAfter: string | null
  }>
  pending: { orders: number | null; deferredActivations: number | null }
}

interface SchoolOption { id: string; name: string }

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  DISABLED: 'border-slate-200 bg-slate-100 text-slate-500',
  NOT_CONFIGURED: 'border-slate-200 bg-slate-100 text-slate-500',
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'NOT_CONFIGURED' ? 'Not configured' : status
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES.NOT_CONFIGURED}`}>
      {label}
    </Badge>
  )
}

// ── module ─────────────────────────────────────────────────────────────

export function PaymentsGatewaysModule() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { gate, node: stepUpNode } = useStepUpGate()

  const [data, setData] = useState<PaymentsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Override config dialog state (?school=<id> deep link from a school page)
  const [overrideFor, setOverrideFor] = useState<{ schoolId: string; schoolName: string } | null>(null)
  const [newOverrideOpen, setNewOverrideOpen] = useState(false)
  const [disableFor, setDisableFor] = useState<SchoolGatewayRow | null>(null)
  const [disableBusy, setDisableBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<PaymentsOverview>('/api/platform/payments/overview')
      setData(d)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Deep link: /platform/payments?school=<id> opens that school's override.
  useEffect(() => {
    const sid = searchParams.get('school')
    if (!sid || !data) return
    const row = data.schoolGateways.find((g) => g.schoolId === sid)
    if (row) setOverrideFor({ schoolId: row.schoolId, schoolName: row.school.name })
    // Unknown school id (e.g. no override yet) — open the new-override
    // dialog so the operator can pick/configure; the dialog itself
    // preselects the school from the picker list.
    else setNewOverrideOpen(true)
    // Consume once per mount.
    router.replace('/platform/payments')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const disableSchoolGateway = async () => {
    if (!disableFor) return
    setDisableBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; message: string }>(
          `/api/platform/schools/${disableFor.schoolId}/payment-gateway`,
          { method: 'DELETE' },
        ),
      )
      if (!res) return
      toast.success(res.message)
      setDisableFor(null)
      await load()
    } catch (e) {
      toast.error('Disable failed', { description: errText(e) })
    } finally {
      setDisableBusy(false)
    }
  }

  const gw = data?.gateway

  return (
    <div className="space-y-5">
      {stepUpNode}

      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Payments &amp; Gateways</h1>
        <p className="mt-1 text-sm text-slate-500">
          Payment infrastructure: the platform gateway, school overrides, and checkout readiness. Secrets are never displayed.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Could not load payments overview: {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="h-52 w-full rounded-xl bg-slate-100" aria-label="Loading payments overview" />
      ) : null}

      {data && (
        <>
          {/* ── 1. Platform gateway ─────────────────────────────────── */}
          <PlatformGatewayCard gateway={gw} onChanged={() => void load()} />

          {/* ── 2. Resolution order ─────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="resolution-heading">
            <h2 id="resolution-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ArrowDown className="h-4 w-4 text-teal-600" aria-hidden="true" />Resolution order (applied server-side)
            </h2>
            <ol className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
              <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">1 · School override</span><br />The school&apos;s own ACTIVE fee gateway (its account collects its own fees).</li>
              <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">2 · Platform default</span><br />The platform gateway above (then any deployment env configuration).</li>
              <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">3 · Unavailable</span><br />Checkout is honestly unavailable — never a hidden rail.</li>
            </ol>
            <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
              A school override whose stored credentials cannot be verified <span className="font-semibold">fails closed</span> —
              the platform account is never charged for that school&apos;s fees. Fix the override in this section.
            </p>
          </section>

          {/* ── 3. School overrides ─────────────────────────────────── */}
          <section className="space-y-2" aria-labelledby="overrides-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="overrides-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Landmark className="h-4 w-4" aria-hidden="true" />School fee-gateway overrides
                <span className="text-xs font-normal text-slate-500">(school-collected student fees — separate money)</span>
              </h2>
              <Button size="sm" onClick={() => setNewOverrideOpen(true)} className="bg-teal-600 font-semibold text-white hover:bg-teal-700">
                <CreditCard className="h-4 w-4" aria-hidden="true" />New school override
              </Button>
            </div>

            {data.schoolGateways.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
                <p className="text-sm font-medium text-slate-600">No school-specific gateways configured.</p>
                <p className="mt-1 text-xs text-slate-500">Every school resolves to the platform default gateway above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[820px] text-sm">
                  <caption className="sr-only">School fee-gateway overrides with mode, status, verification and webhook configuration</caption>
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2.5">School</th>
                      <th scope="col" className="px-3 py-2.5">Mode</th>
                      <th scope="col" className="px-3 py-2.5">Status</th>
                      <th scope="col" className="px-3 py-2.5">Verified</th>
                      <th scope="col" className="px-3 py-2.5">Webhook</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schoolGateways.map((g) => (
                      <tr key={g.schoolId} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {g.school.name}
                          <div className="text-xs font-normal text-slate-500">{g.school.slug}</div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {g.mode ? <Badge variant="outline" className={`normal-case ${g.mode === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{g.mode} keys</Badge> : '—'}
                          <div className="font-mono text-[11px] text-slate-400">{g.publicKeyId ?? ''}</div>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={g.status} /></td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {g.lastVerifiedAt ? dateStr(g.lastVerifiedAt) : <span className="text-slate-400">not verified</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{g.webhookSecretConfigured ? 'configured' : '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="outline" className="border-slate-300 text-slate-700"
                              onClick={() => setOverrideFor({ schoolId: g.schoolId, schoolName: g.school.name })}
                            >
                              Configure
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                              disabled={g.status === 'DISABLED'}
                              onClick={() => setDisableFor(g)}
                              aria-label={`Disable fee gateway for ${g.school.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── 4. Health + pipeline ────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="wh-health-heading">
              <h2 id="wh-health-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Webhook className="h-4 w-4 text-teal-600" aria-hidden="true" />Webhook health (24h)
              </h2>
              {data.subscriptionSchemaPending ? (
                <p className="mt-2 text-xs text-slate-500">Webhook event tracking is not provisioned on this database yet.</p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {Object.entries(data.webhookHealth.byStatus).length === 0 && <li className="text-slate-400">No webhook events in the last 24 hours.</li>}
                    {Object.entries(data.webhookHealth.byStatus).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between">
                        <span className="capitalize">{k}</span>
                        <span className="font-semibold tabular-nums text-slate-800">{v}</span>
                      </li>
                    ))}
                  </ul>
                  {data.webhookHealth.lastError && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">Last error: {data.webhookHealth.lastError}</p>
                  )}
                </>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="pipeline-heading">
              <h2 id="pipeline-heading" className="text-sm font-semibold text-slate-900">Pending verification</h2>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                <li className="flex items-center justify-between"><span>Open online orders</span><span className="font-semibold tabular-nums text-slate-800">{data.pending.orders ?? '—'}</span></li>
                <li className="flex items-center justify-between"><span>Code-gated activations awaiting redemption</span><span className="font-semibold tabular-nums text-slate-800">{data.pending.deferredActivations ?? '—'}</span></li>
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">Only verified, correctly signed and idempotent payment events can activate entitlements.</p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="recentpay-heading">
              <h2 id="recentpay-heading" className="text-sm font-semibold text-slate-900">Recent platform payments</h2>
              <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {data.recentPayments.length === 0 && <li className="text-slate-400">No payments recorded yet.</li>}
                {data.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5 last:border-0">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] text-slate-600">{p.receiptNo ?? '—'}</div>
                      <div className="truncate text-[11px] text-slate-500">{p.school?.name ?? '—'} · {dateStr(p.paymentDate)} · {p.mode.replace(/_/g, ' ').toLowerCase()}</div>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-800">{money(p.amount, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}

      {/* Override configuration dialog — the ONLY fee-gateway config form */}
      {overrideFor && (
        <GatewayConfigDialog
          kind="school"
          title={`Fee gateway override — ${overrideFor.schoolName}`}
          description="This school's OWN fee-collection account (school-collected student fees — separate money from SCHOLARIO subscriptions). Secrets are AES-256-GCM encrypted at rest and never displayed again. Saving requires step-up verification and is audited (lengths only)."
          endpoint={`/api/platform/schools/${overrideFor.schoolId}/payment-gateway`}
          existingKeyId={data?.schoolGateways.find((g) => g.schoolId === overrideFor.schoolId)?.publicKeyId ?? null}
          existingStatus={data?.schoolGateways.find((g) => g.schoolId === overrideFor.schoolId)?.status ?? 'ACTIVE'}
          onClose={() => setOverrideFor(null)}
          onSaved={() => { setOverrideFor(null); void load() }}
        />
      )}
      {newOverrideOpen && (
        <SchoolPickerThenConfigureDialog
          onClose={() => setNewOverrideOpen(false)}
          onPicked={(school) => { setNewOverrideOpen(false); setOverrideFor(school) }}
        />
      )}
      {disableFor && (
        <AlertDialog open onOpenChange={(o) => { if (!o && !disableBusy) setDisableFor(null) }}>
          <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Disable the fee gateway for {disableFor.school.name}?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-500">
                Student-fee checkout for this school immediately falls back to the platform default gateway. The
                configuration (encrypted secrets) is kept and can be re-enabled by saving a configuration — step-up
                gated and audited.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDisableFor(null)} disabled={disableBusy} className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring">Cancel</Button>
              <Button onClick={() => void disableSchoolGateway()} disabled={disableBusy} className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring">
                {disableBusy ? 'Disabling…' : 'Disable gateway'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

// ── platform gateway card ──────────────────────────────────────────────

function PlatformGatewayCard({ gateway, onChanged }: { gateway: PlatformGatewayView | undefined; onChanged: () => void }) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [configOpen, setConfigOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const configured = Boolean(gateway && gateway.status !== 'NOT_CONFIGURED')
  const ready = gateway?.status === 'ACTIVE'

  const disable = async () => {
    setBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; message: string }>('/api/platform/payments/gateway', { method: 'DELETE' }),
      )
      if (!res) return
      toast.success(res.message)
      setDisableOpen(false)
      onChanged()
    } catch (e) {
      toast.error('Disable failed', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="platform-gw-heading">
      {stepUpNode}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 id="platform-gw-heading" className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Platform gateway — SCHOLARIO subscriptions
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The platform&apos;s own provider account. School-collected student fees never run through it.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => setConfigOpen(true)} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {configured ? 'Reconfigure' : 'Configure gateway'}
          </Button>
          {configured && (
            <Button
              variant="outline" onClick={() => setDisableOpen(true)} disabled={busy || gateway?.status === 'DISABLED'}
              className="h-10 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold focus-ring"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {gateway?.status === 'DISABLED' ? 'Disabled' : 'Disable'}
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-4 sm:px-5">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Provider</dt>
          <dd className="mt-1 text-sm capitalize text-slate-700">{gateway?.provider ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mode</dt>
          <dd className="mt-1 text-sm text-slate-700">
            {gateway?.publicKeyId ? (
              <>
                <span className="font-mono text-xs">{gateway.publicKeyId}</span>
                {gateway.mode === 'test' && <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700 normal-case">test</Badge>}
                {gateway.mode === 'live' && <Badge variant="outline" className="ml-2 border-emerald-200 bg-emerald-50 text-emerald-700 normal-case">live</Badge>}
              </>
            ) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</dt>
          <dd className="mt-1"><StatusBadge status={gateway?.status ?? 'NOT_CONFIGURED'} /></dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checkout readiness</dt>
          <dd className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
            <ShieldCheck className={`h-4 w-4 ${ready ? 'text-emerald-600' : 'text-slate-300'}`} aria-hidden="true" />
            {ready ? 'Subscription checkout is live on this account' : gateway?.envFallback ? 'Falls back to deployment env configuration' : 'Not ready — subscription checkout unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last verified</dt>
          <dd className="mt-1 text-sm text-slate-700">{gateway?.lastVerifiedAt ? dateStr(gateway.lastVerifiedAt) : <span className="text-slate-400">not verified yet</span>}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Webhook secret</dt>
          <dd className="mt-1 text-sm text-slate-700">{gateway?.webhookSecretConfigured ? 'configured' : '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Effective resolution</dt>
          <dd className="mt-1 text-sm text-slate-700">{gateway?.resolution ?? '—'}</dd>
        </div>
      </dl>

      {configOpen && (
        <GatewayConfigDialog
          kind="platform"
          title="Platform gateway"
          description="Secrets are AES-256-GCM encrypted at rest and never displayed again. Saving requires step-up verification and is audited (lengths only)."
          endpoint="/api/platform/payments/gateway"
          existingKeyId={gateway?.publicKeyId ?? null}
          existingStatus={gateway?.status === 'PENDING' || gateway?.status === 'DISABLED' ? gateway.status : 'ACTIVE'}
          onClose={() => setConfigOpen(false)}
          onSaved={() => { setConfigOpen(false); onChanged() }}
        />
      )}

      <AlertDialog open={disableOpen} onOpenChange={(o) => { if (!o && !busy) setDisableOpen(false) }}>
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Disable the platform gateway?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              Subscription checkout and the fee-lane fallback immediately stop using this account (the deployment env
              configuration, if any, is used). The encrypted configuration is kept for re-enabling.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDisableOpen(false)} disabled={busy} className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring">Cancel</Button>
            <Button onClick={() => void disable()} disabled={busy} className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring">
              {busy ? 'Disabling…' : 'Disable gateway'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ── gateway config form (shared by platform + school override dialogs) ──

interface GatewayForm {
  publicKeyId: string
  keySecret: string
  webhookSecret: string
  status: string
  notes: string
}

const GATEWAY_STATUSES = ['ACTIVE', 'PENDING', 'DISABLED'] as const

function GatewayConfigDialog({
  kind, title, description, endpoint, existingKeyId, existingStatus, onClose, onSaved,
}: {
  kind: 'platform' | 'school'
  title: string
  description: string
  endpoint: string
  existingKeyId: string | null
  existingStatus: string
  onClose: () => void
  onSaved: () => void
}) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [form, setForm] = useState<GatewayForm>({
    publicKeyId: existingKeyId ?? '',
    keySecret: '',
    webhookSecret: '',
    status: existingStatus,
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setField = <K extends keyof GatewayForm>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    const publicKeyId = form.publicKeyId
    if (publicKeyId.trim().length < 4) return 'Public key id is required (min 4 characters)'
    if (!/^rzp_(live|test)_/.test(publicKeyId.trim())) {
      return 'Razorpay key ids look like rzp_live_… or rzp_test_…'
    }
    if (form.keySecret.trim().length < 8) return 'Key secret is required (min 8 characters) — it cannot be read back, so enter it on every save'
    if (form.webhookSecret.trim().length > 0 && form.webhookSecret.trim().length < 8) {
      return 'Webhook secret (when provided) must be at least 8 characters'
    }
    return null
  }

  const save = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; message: string }>(
          endpoint,
          {
            method: 'PUT',
            body: JSON.stringify({
              provider: 'razorpay',
              publicKeyId: form.publicKeyId.trim(),
              keySecret: form.keySecret.trim(),
              status: form.status,
              ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
              ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            }),
          },
        ),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success(res.message)
      setForm((f) => ({ ...f, keySecret: '', webhookSecret: '' }))
      onSaved()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        {stepUpNode}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <KeyRound className="h-4 w-4 text-teal-600" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pcfg-key-id" className="text-xs font-semibold text-slate-700">Public key id *</Label>
            <Input
              id="pcfg-key-id"
              value={form.publicKeyId}
              onChange={(e) => setField('publicKeyId', e.target.value)}
              placeholder="rzp_live_XXXXXXXXXXXXXX"
              maxLength={120}
              autoComplete="off"
              className="h-11 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-teal-500/40"
            />
            <p className="text-[10px] text-slate-400">
              Razorpay key ids look like <span className="font-mono">rzp_live_…</span> or <span className="font-mono">rzp_test_…</span> — browser-safe (checkout needs it).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pcfg-key-secret" className="text-xs font-semibold text-slate-700">Key secret *</Label>
            <Input
              id="pcfg-key-secret"
              type="password"
              value={form.keySecret}
              onChange={(e) => setField('keySecret', e.target.value)}
              placeholder={existingKeyId ? 'stored encrypted — enter a new value to replace' : 'paste the key secret from the Razorpay dashboard'}
              maxLength={200}
              autoComplete="new-password"
              className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            />
            <p className="flex items-start gap-1.5 text-[10px] text-slate-400">
              <EyeOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Write-only: the stored secret cannot be read back, so it must be entered on every save.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pcfg-wh-secret" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Webhook className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              Webhook secret (optional)
            </Label>
            <Input
              id="pcfg-wh-secret"
              type="password"
              value={form.webhookSecret}
              onChange={(e) => setField('webhookSecret', e.target.value)}
              placeholder={existingKeyId ? 'stored encrypted — enter a new value to replace' : 'webhook signing secret'}
              maxLength={200}
              autoComplete="new-password"
              className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            />
            <p className="text-[10px] text-slate-400">Providing a value stores or rotates it; leaving it blank removes any stored webhook secret on save.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pcfg-status" className="text-xs font-semibold text-slate-700">Status</Label>
            <Select value={form.status} onValueChange={(v) => setField('status', v)}>
              <SelectTrigger id="pcfg-status" className="h-11 w-full bg-white border-slate-200 text-slate-900"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                {GATEWAY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="focus:bg-slate-100">
                    {s}
                    {s === existingStatus ? ' (current)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pcfg-notes" className="text-xs font-semibold text-slate-700">Notes (optional, audited)</Label>
            <Textarea
              id="pcfg-notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder={kind === 'school' ? 'e.g. Keys issued by the school\u2019s bursar — account KYC verified…' : 'e.g. Platform Razorpay account for subscription collections…'}
              rows={2}
              maxLength={400}
              className="bg-white border-slate-200 text-slate-900 min-h-[72px]"
            />
            <p className="text-[10px] text-slate-400">Not shown back on this page — leaving blank keeps any existing note.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button onClick={() => void save()} disabled={busy} className="bg-teal-600 font-semibold text-white hover:bg-teal-700">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Saving…' : 'Save configuration'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Pick a school first, then the same configuration dialog opens for it. */
function SchoolPickerThenConfigureDialog({
  onClose, onPicked,
}: {
  onClose: () => void
  onPicked: (school: { schoolId: string; schoolName: string }) => void
}) {
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    platformApi<{ schools: Array<{ id: string; name: string }> }>('/api/platform/schools?pageSize=200')
      .then((d) => { if (alive) setSchools(d.schools) })
      .catch((e) => { if (alive) setError(errText(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Configure a school fee-gateway override</DialogTitle>
          <DialogDescription>
            Pick the school whose OWN fee collection account you are configuring. Its fees will run on its own
            credentials — never on the platform&apos;s account.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading schools…</div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="override-school" className="text-xs font-semibold text-slate-700">School</Label>
              <Select value={schoolId} onValueChange={setSchoolId}>
                <SelectTrigger id="override-school" className="h-10 border-slate-300 bg-white"><SelectValue placeholder="Select a school…" /></SelectTrigger>
                <SelectContent className="bg-white">
                  {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button
              disabled={!schoolId}
              onClick={() => {
                const school = schools.find((s) => s.id === schoolId)
                if (school) onPicked({ schoolId: school.id, schoolName: school.name })
              }}
              className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
            >
              <Check className="h-4 w-4" aria-hidden="true" />Continue
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
