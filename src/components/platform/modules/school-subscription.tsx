'use client'

// ============================================================
// SchoolSubscriptionTab — school workspace · Subscription tab
// (REBUILT on the authoritative SUBSCRIPTION & ENTITLEMENT SYSTEM)
// ------------------------------------------------------------
// This is §5 of the Schools-management mission: the clearly
// discoverable subscription section INSIDE each school's workspace.
//
// Internal structure (sub-tabs):
//   Snapshot      — the enforced entitlement state + manual override
//                   (the same evaluation the school plane enforces —
//                   console and locked shell can never disagree).
//   Plan & billing— the authoritative registry row (plan, interval,
//                   price snapshot, period, expiry, billing model),
//                   plan-driven payment recording with DIRECT or
//                   CODE-GATED activation, and the legacy plan marker.
//   Codes         — the school's activation codes: metadata, issuance
//                   status, expiry, redemption state, reissue chain,
//                   revoke — plaintext ONLY at the issuance moment.
//   Students      — per-student entitlements (Model B/C): assign,
//                   lifecycle actions, per-student history.
//   Ledger        — the immutable platform-payment ledger.
//
// PLATFORM SUBSCRIPTION ≠ SCHOOL FEE COLLECTION: the banner on every
// sub-tab states which side of that boundary the operator is on (the
// school's own fee gateway lives in the "Fee gateway" tab).
//
// All mutations reuse the authoritative endpoints (no second
// redemption system): the same APIs /platform/subscriptions uses.
// Billing mutations are step-up-gated (gate() convention — dormant
// while platform TOTP is stood down) and audited server-side with the
// operator's reason.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Info,
  KeyRound,
  ListOrdered,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import {
  StateBadge as SharedStateBadge,
  money,
  dateStr,
  errMessage,
  OneTimeCodeBlock,
  PlanPicker,
  AssignEntitlementDialog,
  StudentHistoryDialog,
  type ActivationCodeRow,
  type PlanRow,
  type RegistryRow,
  type StudentRow,
} from './subscription-shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

// ── Types (API contracts) ────────────────────────────────────────────────

interface PaymentRow {
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
}

interface SubscriptionResponse {
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
  entitlement: {
    state: string
    businessAllowed: boolean
    renewalRequired: boolean
    message: string | null
  }
  payments: PaymentRow[]
}

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const
const PAYMENT_MODES = ['ONLINE_PAYMENT', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const
const OVERRIDE_STATES = ['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED'] as const
const CODE_STATUS_FILTERS = ['ALL', 'ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED', 'REPLACED'] as const

// ── Small local helpers ──────────────────────────────────────────────────

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATE_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  GRACE: 'border-amber-200 bg-amber-50 text-amber-700',
  RESTRICTED: 'border-orange-200 bg-orange-50 text-orange-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  NOT_ACTIVATED: 'border-slate-200 bg-slate-100 text-slate-600',
}

function EntitlementStateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATE_STYLES[state] ?? STATE_STYLES['NOT_ACTIVATED']}`}>
      {state.replace(/_/g, ' ')}
    </Badge>
  )
}

/** The platform-vs-fee-collection boundary banner (mission §5D). */
function BoundaryBanner() {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-xs text-teal-900"
      role="note"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
      <p>
        <span className="font-semibold">Platform subscription</span> — what this school pays SCHOLARIO to use the
        platform. This is separate from the <span className="font-semibold">school fee gateway</span> (what the school
        collects from its own students/parents — configured in the Fee gateway tab). Records, credentials and revenue
        of the two never mix.
      </p>
    </div>
  )
}

// ── Snapshot card (the enforced state + override) ─────────────────────────

function SnapshotCard({
  data,
  registryRow,
  gate,
  onReload,
}: {
  data: SubscriptionResponse
  registryRow: RegistryRow | null
  gate: GateFn
  onReload: () => void
}) {
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideState, setOverrideState] = useState<string>('clear')
  const [overrideReason, setOverrideReason] = useState('')
  const [busy, setBusy] = useState(false)

  const sub = data.subscription
  const ent = data.entitlement

  const applyOverride = async () => {
    setBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; overrideStatus: string | null }>(
          `/api/platform/schools/${data.school.id}/subscription`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              overrideStatus: overrideState === 'clear' ? null : overrideState,
              reason: overrideReason.trim() || undefined,
            }),
          },
        ),
      )
      if (!res) return
      toast.success(
        res.overrideStatus
          ? `Manual override set to ${res.overrideStatus} — applies immediately, audited.`
          : 'Manual override cleared — the computed period state applies again.',
      )
      setOverrideOpen(false)
      setOverrideReason('')
      onReload()
    } catch (e) {
      toast.error('Override failed', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Subscription snapshot">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">Subscription & entitlement snapshot</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The same evaluation the school plane enforces — the console and the school&apos;s locked shell can never
            disagree about this state.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOverrideOpen(true)}
          className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
        >
          <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Manual override…
        </Button>
      </div>
      <div className="space-y-4 p-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <EntitlementStateBadge state={ent.state} />
          <span className="text-xs text-slate-600">
            business modules {ent.businessAllowed ? 'unlocked' : 'locked'} · sign-in{' '}
            {data.school.status === 'PENDING' ? 'blocked (PENDING)' : 'allowed'}
          </span>
          {sub?.overrideStatus && (
            <Badge variant="outline" className="normal-case border-orange-200 bg-orange-50 text-orange-700">
              override: {sub.overrideStatus}
            </Badge>
          )}
          {registryRow?.planCode && (
            <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-700">
              {registryRow.planCode}
            </Badge>
          )}
          {registryRow && (
            <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-700">
              {registryRow.billingModel.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Plan</dt>
            <dd className="mt-0.5 text-slate-900">
              {registryRow?.planDef ? registryRow.planDef.name : sub?.plan ?? '—'}
              {registryRow?.interval && (
                <span className="ml-1 text-[11px] text-slate-500">{registryRow.interval.toLowerCase()}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Period</dt>
            <dd className="mt-0.5 text-slate-900">
              {fmtDate(sub?.periodStart ?? registryRow?.periodStart ?? null)} → {sub?.periodEnd ? fmtDate(sub.periodEnd) : 'No expiry set'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Grace days</dt>
            <dd className="mt-0.5 text-slate-900">{sub?.graceDays ?? registryRow?.graceDays ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Renewal required</dt>
            <dd className="mt-0.5 text-slate-900">{ent.renewalRequired ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Payments</dt>
            <dd className="mt-0.5 text-slate-900 tabular-nums">{registryRow?.paymentCount ?? data.payments.length}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">School lifecycle</dt>
            <dd className="mt-0.5 text-slate-900">{data.school.status}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Stored snapshot status</dt>
            <dd className="mt-0.5 text-slate-900">{sub?.status ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Manual override</dt>
            <dd className="mt-0.5 text-slate-900">{sub?.overrideStatus ?? 'none — computed state'}</dd>
          </div>
        </dl>
        {ent.message && (
          <p className={`rounded-lg border px-3 py-2 text-xs ${ent.state === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : ent.state === 'GRACE' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {ent.message}
          </p>
        )}
      </div>

      {/* Override dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Manual entitlement override</DialogTitle>
            <DialogDescription>
              A platform decision that forces the entitlement state, regardless of the computed period. School
              lifecycle (activate/suspend) is never touched here. Applies immediately, lasts until cleared, step-up
              gated and audited with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Current override</Label>
              <p className="text-sm text-slate-700">{sub?.overrideStatus ?? 'none — computed period state applies'}</p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="override-state">
                New override
              </Label>
              <Select value={overrideState} onValueChange={setOverrideState}>
                <SelectTrigger id="override-state" className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="clear">Clear — computed state applies</SelectItem>
                  {OVERRIDE_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      Force {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="override-reason">
                Reason (audited)
              </Label>
              <Textarea
                id="override-reason"
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why is this override being applied?"
                className="bg-white"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOverrideOpen(false)} className="border-slate-300">
                Cancel
              </Button>
              <Button
                onClick={() => void applyOverride()}
                disabled={busy}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Apply override
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Record payment dialog (plan-driven + legacy) ──────────────────────────

interface RecordPaymentResult {
  message: string
  payment?: { receiptNo: string; statusAfter?: string; periodEndAfter?: string }
  activationCode?: { publicRef: string; code: string; expiresAt: string }
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  currentBillingModel,
  gate,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  currentBillingModel: string
  gate: GateFn
  onRecorded: () => void
}) {
  const [usePlan, setUsePlan] = useState(true)
  const [form, setForm] = useState({
    planCode: '',
    amount: '',
    currency: 'INR',
    mode: 'BANK_TRANSFER',
    paymentDate: todayISO(),
    periodMonths: '12',
    reference: '',
    notes: '',
    issueActivationCode: false,
    claimWindowDays: '30',
    billingModel: '',
  })
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecordPaymentResult | null>(null)

  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        planCode: '',
        amount: '',
        reference: '',
        notes: '',
        issueActivationCode: false,
        billingModel: currentBillingModel,
      }))
      setError(null)
      setResult(null)
    }
  }, [open, currentBillingModel])

  useEffect(() => {
    if (!open) return
    platformApi<{ plans: PlanRow[] }>('/api/platform/subscriptions/plans')
      .then((d) => setPlans(d.plans.filter((p) => p.scope === 'SCHOOL' && p.status === 'ACTIVE' && p.allowOffline)))
      .catch(() => {})
  }, [open])

  // Auto-fill the amount from the selected plan's price (editable — the
  // server rejects a mismatch with an honest error).
  const selectedPlan = plans.find((p) => p.code === form.planCode)
  useEffect(() => {
    if (usePlan && selectedPlan) {
      const price = selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual
      setForm((f) => ({ ...f, amount: price != null ? String(price) : f.amount, currency: selectedPlan.currency }))
    }
  }, [selectedPlan, usePlan])

  const submit = async () => {
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) return setError('Amount must be greater than zero')
    if (amount > 100_000_000) return setError('Amount exceeds the accepted maximum')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.paymentDate)) return setError('Payment date is required')
    if (usePlan && !form.planCode) return setError('Select a plan (or switch to the legacy free-form amount)')
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        amount,
        currency: form.currency,
        mode: form.mode,
        paymentDate: form.paymentDate,
        periodMonths: Number(form.periodMonths),
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }
      if (usePlan) {
        payload.planCode = form.planCode
        payload.issueActivationCode = form.issueActivationCode
        if (form.issueActivationCode) payload.claimWindowDays = Number(form.claimWindowDays || 30)
        if (form.billingModel && form.billingModel !== currentBillingModel) payload.billingModel = form.billingModel
      }
      const res = await gate(() =>
        platformApi<RecordPaymentResult>(`/api/platform/schools/${schoolId}/subscription/payments`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      setResult(res)
      onRecorded()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!result) onOpenChange(v) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Wallet className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Record subscription payment — {schoolName}
          </DialogTitle>
          <DialogDescription>
            A VERIFIED offline payment enters the immutable ledger. With a plan selected this snapshots the plan and
            either activates the subscription directly or (with a code) activates it when the school redeems the code.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm">{result.message}</p>
            {result.activationCode && (
              <OneTimeCodeBlock
                code={result.activationCode}
                hint="Show and copy the code now — it will not be visible again. Deliver it to the school's principal out-of-band; the subscription activates on redemption."
              />
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} className="bg-teal-600 hover:bg-teal-700 text-white">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Package className="h-4 w-4" aria-hidden="true" />
                  Plan-driven payment
                </div>
                <p className="text-xs text-slate-500">
                  Off = legacy free-form amount/months (the pre-registry flow, kept for compatibility).
                </p>
              </div>
              <Switch checked={usePlan} onCheckedChange={setUsePlan} />
            </div>
            {usePlan && (
              <div>
                <Label className="text-xs">Plan (school scope, offline-enabled)</Label>
                <PlanPicker scope="SCHOOL" value={form.planCode} onChange={(v) => setForm((f) => ({ ...f, planCode: v }))} />
                {selectedPlan && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {selectedPlan.name} · {selectedPlan.interval.toLowerCase()} ·{' '}
                    {money(
                      selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual,
                      selectedPlan.currency,
                    )}{' '}
                    · grace {selectedPlan.graceDays}d
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-white"
                />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Payment date</Label>
                <Input
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className="bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Mode</Label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!usePlan && (
                <div>
                  <Label className="text-xs">Period (months)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={form.periodMonths}
                    onChange={(e) => setForm((f) => ({ ...f, periodMonths: e.target.value }))}
                    className="bg-white"
                  />
                </div>
              )}
            </div>
            {usePlan && (
              <div>
                <Label className="text-xs">Billing model (rides this payment)</Label>
                <Select value={form.billingModel || currentBillingModel} onValueChange={(v) => setForm((f) => ({ ...f, billingModel: v }))}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Current: {currentBillingModel.replace(/_/g, ' ')} — the model switch is applied inside the successful
                  payment transaction, never on its own.
                </p>
              </div>
            )}
            <div>
              <Label className="text-xs">Reference / receipt</Label>
              <Input
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="UTR / cheque no. (optional)"
                className="bg-white"
              />
            </div>
            <div>
              <Label className="text-xs">Notes (audited)</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Audit note (optional)"
                className="bg-white"
              />
            </div>
            {usePlan && (
              <>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      Issue activation code
                    </div>
                    <p className="text-xs text-slate-500">
                      The VERIFIED payment is recorded now; the subscription activates when the school redeems the code
                      (offline handshake — nothing activates before redemption).
                    </p>
                  </div>
                  <Switch
                    checked={form.issueActivationCode}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, issueActivationCode: v }))}
                  />
                </div>
                {form.issueActivationCode && (
                  <div>
                    <Label className="text-xs">Claim window (days)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="365"
                      value={form.claimWindowDays}
                      onChange={(e) => setForm((f) => ({ ...f, claimWindowDays: e.target.value }))}
                      className="bg-white"
                    />
                  </div>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-300">
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy} className="bg-teal-600 hover:bg-teal-700 text-white">
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {usePlan && form.issueActivationCode ? 'Record + issue code' : 'Record payment'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Plan & billing card ──────────────────────────────────────────────────

function PlanBillingCard({
  schoolId,
  schoolName,
  registryRow,
  legacyPlan,
  gate,
  onReload,
}: {
  schoolId: string
  schoolName: string
  registryRow: RegistryRow | null
  legacyPlan: string
  gate: GateFn
  onReload: () => void
}) {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [legacyPlanChoice, setLegacyPlanChoice] = useState(legacyPlan)
  const [planReason, setPlanReason] = useState('')
  const [planBusy, setPlanBusy] = useState(false)

  useEffect(() => setLegacyPlanChoice(legacyPlan), [legacyPlan])

  const changeLegacyPlan = async () => {
    if (legacyPlanChoice === legacyPlan) return
    setPlanBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; plan: string }>(`/api/platform/schools/${schoolId}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({
            plan: legacyPlanChoice,
            ...(planReason.trim() ? { reason: planReason.trim() } : {}),
          }),
        }),
      )
      if (!res) return
      toast.success(`Tenant plan marker set to ${res.plan} (audited).`)
      setPlanReason('')
      onReload()
    } catch (e) {
      toast.error('Plan marker change failed', { description: errText(e) })
    } finally {
      setPlanBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Plan and billing">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">Plan & billing</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The authoritative registry plan, period and billing model — plus the offline payment recording that
            activates, renews or extends it.
          </p>
        </div>
        <Button
          onClick={() => setPaymentOpen(true)}
          className="h-9 bg-teal-600 hover:bg-teal-700 text-white focus-ring"
        >
          <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Record payment / renew
        </Button>
      </div>
      <div className="space-y-4 p-4 sm:px-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Registry plan</dt>
            <dd className="mt-0.5 text-slate-900">
              {registryRow?.planDef ? (
                <>
                  {registryRow.planDef.name} <span className="font-mono text-[11px] text-slate-500">{registryRow.planCode}</span>
                </>
              ) : (
                <span className="text-slate-500">no registry plan applied yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Billing model</dt>
            <dd className="mt-0.5 text-slate-900">{(registryRow?.billingModel ?? 'SCHOOL_WIDE').replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Price snapshot</dt>
            <dd className="mt-0.5 text-slate-900">{registryRow ? money(registryRow.priceSnapshot, registryRow.currencySnapshot) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Interval</dt>
            <dd className="mt-0.5 text-slate-900">{registryRow?.interval ? registryRow.interval.toLowerCase() : '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Valid until</dt>
            <dd className="mt-0.5 text-slate-900">{fmtDate(registryRow?.periodEnd ?? null)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Renewal payments</dt>
            <dd className="mt-0.5 text-slate-900 tabular-nums">{registryRow?.paymentCount ?? 0}</dd>
          </div>
        </dl>

        {/* Legacy plan marker — display field, separate from the registry plan */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <Label className="text-xs" htmlFor="legacy-plan">
                Tenant plan marker (legacy field)
              </Label>
              <Select value={legacyPlanChoice} onValueChange={setLegacyPlanChoice}>
                <SelectTrigger id="legacy-plan" className="bg-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs" htmlFor="legacy-plan-reason">
                Reason (audited)
              </Label>
              <Input
                id="legacy-plan-reason"
                value={planReason}
                onChange={(e) => setPlanReason(e.target.value)}
                placeholder="Why is the marker changing?"
                className="bg-white h-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={legacyPlanChoice === legacyPlan || planBusy}
              onClick={() => void changeLegacyPlan()}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              {planBusy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save marker
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Display marker only — the enforced entitlement comes from the snapshot above, and commercial terms from the
            registry plan. Changing the marker does not activate anything.
          </p>
        </div>
      </div>

      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        schoolId={schoolId}
        schoolName={schoolName}
        currentBillingModel={registryRow?.billingModel ?? 'SCHOOL_WIDE'}
        gate={gate}
        onRecorded={onReload}
      />
    </section>
  )
}

// ── Codes card ───────────────────────────────────────────────────────────

function RevokeReissueDialog({
  code,
  action,
  onClose,
  onDone,
  gate,
}: {
  code: ActivationCodeRow
  action: 'revoke' | 'reissue'
  onClose: () => void
  onDone: () => void
  gate: GateFn
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ publicRef: string; code: string; expiresAt: string; message: string } | null>(null)

  const submit = async () => {
    if (reason.trim().length < 4) {
      toast.error('A reason of at least 4 characters is required (audited).')
      return
    }
    setBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; publicRef: string; message: string; code?: string; expiresAt?: string }>(
          `/api/platform/subscriptions/codes/${code.id}`,
          { method: 'PATCH', body: JSON.stringify({ action, reason: reason.trim() }) },
        ),
      )
      if (!res) return
      if (action === 'reissue' && res.code && res.expiresAt) {
        setIssued({ publicRef: res.publicRef, code: res.code, expiresAt: res.expiresAt, message: res.message })
        onDone()
      } else {
        toast.success(res.message)
        onDone()
        onClose()
      }
    } catch (e) {
      toast.error(`${action} failed`, { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !issued) onClose() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {action === 'revoke' ? 'Revoke activation code' : 'Reissue activation code'}
          </DialogTitle>
          <DialogDescription>
            {action === 'revoke'
              ? `${code.publicRef} becomes permanently unusable. Financial records are unchanged.`
              : `${code.publicRef} becomes REPLACED and a fresh code is issued inheriting the same plan/validity. The plaintext is shown exactly once.`}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="space-y-3">
            <p className="text-sm">{issued.message}</p>
            <OneTimeCodeBlock code={issued} />
            <DialogFooter>
              <Button onClick={onClose} className="bg-teal-600 hover:bg-teal-700 text-white">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs" htmlFor="code-action-reason">
                Reason (audited)
              </Label>
              <Textarea
                id="code-action-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={action === 'revoke' ? 'Why is this code being revoked?' : 'Why is this code being reissued?'}
                className="bg-white"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} className="border-slate-300">
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy}
                variant={action === 'revoke' ? 'destructive' : 'default'}
                className={action === 'reissue' ? 'bg-teal-600 hover:bg-teal-700 text-white' : undefined}
              >
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {action === 'revoke' ? 'Revoke code' : 'Reissue code'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CodesCard({ codes, total, onChanged, gate }: { codes: ActivationCodeRow[]; total: number; onChanged: () => void; gate: GateFn }) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [scopeFilter, setScopeFilter] = useState<string>('ALL')
  const [act, setAct] = useState<{ code: ActivationCodeRow; action: 'revoke' | 'reissue' } | null>(null)

  const filtered = codes.filter(
    (c) =>
      (statusFilter === 'ALL' || c.status === statusFilter) &&
      (scopeFilter === 'ALL' || c.scope === scopeFilter),
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Activation codes">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">Activation codes</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Issued for this school — metadata only; the plaintext exists solely at the issuance moment (hash-at-rest,
            one-time redemption, tenant-bound).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[130px] bg-white" aria-label="Filter codes by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {CODE_STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'ALL' ? 'All statuses' : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-9 w-[150px] bg-white" aria-label="Filter codes by scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="ALL">All scopes</SelectItem>
              <SelectItem value="SCHOOL_SUBSCRIPTION">School subscription</SelectItem>
              <SelectItem value="STUDENT_ENTITLEMENT">Student entitlement</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">Scope</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Validity</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Claim</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-mono text-[11px] font-medium text-slate-900">{c.publicRef}</p>
                  <p className="text-[10px] text-slate-400">issued {dateStr(c.issuedAt)}</p>
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {c.scope === 'SCHOOL_SUBSCRIPTION' ? 'school' : 'student'}
                  {c.student && <p className="text-[10px] text-slate-400">{c.student.user?.name ?? c.student.user?.email}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {c.planCode ?? '—'}
                  {c.interval && <p className="text-[10px] text-slate-400">{c.interval.toLowerCase()}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                  {c.validityMonths ? `${c.validityMonths}mo` : '—'}
                  {c.claimWindowDays && <p className="text-[10px] text-slate-400">window {c.claimWindowDays}d</p>}
                </td>
                <td className="px-3 py-2.5">
                  <SharedStateBadge state={c.status} />
                  {c.replacedBy && <p className="mt-0.5 text-[10px] text-slate-400">→ {c.replacedBy.publicRef}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {c.claimedAt ? dateStr(c.claimedAt) : c.expiresAt ? `by ${dateStr(c.expiresAt)}` : '—'}
                  {c.revokedAt && <p className="text-[10px] text-rose-500">revoked {dateStr(c.revokedAt)}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    {(c.status === 'ISSUED' || c.status === 'EXPIRED') && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                          onClick={() => setAct({ code: c, action: 'reissue' })}
                        >
                          Reissue
                        </Button>
                        {c.status === 'ISSUED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-red-200 bg-white text-red-600 hover:bg-red-50"
                            onClick={() => setAct({ code: c, action: 'revoke' })}
                          >
                            Revoke
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No activation codes match — codes are issued when recording a plan payment with the code option
                  (school scope) or assigning a student entitlement (student scope).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        {filtered.length} of {total} code{total === 1 ? '' : 's'} on record for this school · guessing is rate-limited
        server-side (5 attempts / 15 min)
      </p>

      {act && (
        <RevokeReissueDialog
          code={act.code}
          action={act.action}
          gate={gate}
          onClose={() => setAct(null)}
          onDone={onChanged}
        />
      )}
    </section>
  )
}

// ── Students card ────────────────────────────────────────────────────────

function StudentsCard({
  students,
  billingModel,
  loading,
  onSearch,
  onChanged,
}: {
  students: StudentRow[]
  billingModel: string
  loading: boolean
  onSearch: (q: string) => void
  onChanged: () => void
}) {
  const [q, setQ] = useState('')
  const [assignFor, setAssignFor] = useState<StudentRow | null>(null)
  const [detailFor, setDetailFor] = useState<StudentRow | null>(null)

  const covered = billingModel === 'SCHOOL_WIDE'

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Student entitlements">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">Student entitlements</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {covered
              ? 'Billing model is SCHOOL-WIDE — students are covered by the tenant subscription; per-student rows are informational here.'
              : 'Per-student entitlements (Model B/C) — assign, suspend/reactivate/revoke, and view each student\u2019s full history.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch(q) }}
            placeholder="Search name / email / admission no…"
            aria-label="Search students"
            className="bg-white h-9 pl-9"
          />
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Class</th>
              <th className="px-3 py-2 font-semibold">Entitlement</th>
              <th className="px-3 py-2 font-semibold">Valid until</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-label="Loading students" />
                </td>
              </tr>
            ) : (
              <>
                {students.map((s) => (
                  <tr key={s.studentId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{s.name}</p>
                      <p className="text-[10px] text-slate-400">{s.email}</p>
                      {s.accountLocked && (
                        <Badge variant="outline" className="mt-0.5 normal-case border-orange-200 bg-orange-50 text-[9px] text-orange-700">
                          account locked
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{s.class ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <SharedStateBadge state={s.entitlement.computedState} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums">{dateStr(s.entitlement.validityEnd ?? null)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{s.entitlement.source ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                          onClick={() => setDetailFor(s)}
                        >
                          History
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 bg-teal-600 hover:bg-teal-700 text-white"
                          onClick={() => setAssignFor(s)}
                        >
                          <KeyRound className="mr-1 h-3 w-3" aria-hidden="true" />
                          Assign
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      No students match.
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {assignFor && (
        <AssignEntitlementDialog
          student={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => {
            setAssignFor(null)
            onSearch(q)
            onChanged()
          }}
        />
      )}
      {detailFor && <StudentHistoryDialog student={detailFor} onClose={() => setDetailFor(null)} />}
    </section>
  )
}

// ── Ledger card ──────────────────────────────────────────────────────────

function LedgerCard({ payments }: { payments: PaymentRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Payment ledger">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h3 className="font-display text-sm font-bold text-slate-900">Payment ledger</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Every VERIFIED platform payment this school has made to SCHOLARIO (immutable financial records — receipts
          never rewritten).
        </p>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Receipt</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Mode</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Period</th>
              <th className="px-3 py-2 font-semibold">Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-900">
                  {p.receiptNo ?? '—'}
                  {p.verification !== 'VERIFIED' && (
                    <Badge variant="outline" className="ml-2 normal-case border-amber-200 bg-amber-50 text-[9px] text-amber-700">
                      {p.verification}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-slate-900">
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.amount)}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{p.mode.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">{fmtDate(p.paymentDate)}</td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">{p.periodMonths}mo</td>
                <td className="px-3 py-2.5 text-slate-500">{p.recordedBy?.name ?? '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No platform payments recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Main tab component ───────────────────────────────────────────────────

export function SchoolSubscriptionTab({
  schoolId,
  onNavigateTab,
}: {
  schoolId: string
  /** Deep-link helper — e.g. the boundary banner's "Fee gateway" link. */
  onNavigateTab?: (tab: string) => void
}) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [data, setData] = useState<SubscriptionResponse | null>(null)
  const hasDataRef = useRef(false)
  const [registryRow, setRegistryRow] = useState<RegistryRow | null>(null)
  const [codes, setCodes] = useState<ActivationCodeRow[]>([])
  const [codesTotal, setCodesTotal] = useState(0)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [billingModel, setBillingModel] = useState('SCHOOL_WIDE')
  const [legacyPlan, setLegacyPlan] = useState('STANDARD')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState('snapshot')

  const load = useCallback(async () => {
    // Stale-while-revalidate: the first load shows the skeleton; later
    // refreshes keep the current content mounted (an open one-time-code
    // result dialog must NEVER unmount mid-display).
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const [sub, reg, cod] = await Promise.all([
        platformApi<SubscriptionResponse>(`/api/platform/schools/${schoolId}/subscription`),
        platformApi<{ schools: { rows: RegistryRow[] } }>(`/api/platform/subscriptions/registry?schoolId=${schoolId}`),
        platformApi<{ codes: ActivationCodeRow[]; total: number }>(
          `/api/platform/subscriptions/codes?schoolId=${schoolId}&pageSize=100`,
        ),
      ])
      hasDataRef.current = true
      setData(sub)
      setRegistryRow(reg.schools.rows[0] ?? null)
      setCodes(cod.codes)
      setCodesTotal(cod.total)
      setLegacyPlan(sub.subscription?.plan ?? 'STANDARD')
      setBillingModel(reg.schools.rows[0]?.billingModel ?? 'SCHOOL_WIDE')
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  const loadStudents = useCallback(
    async (q = '') => {
      setStudentsLoading(true)
      try {
        const d = await platformApi<{ school: { billingModel: string }; students: StudentRow[] }>(
          `/api/platform/schools/${schoolId}/students?q=${encodeURIComponent(q)}&pageSize=50`,
        )
        setStudents(d.students)
        if (d.school.billingModel) setBillingModel(d.school.billingModel)
      } catch (e) {
        toast.error('Could not load students', { description: errMessage(e) })
      } finally {
        setStudentsLoading(false)
      }
    },
    [schoolId],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadStudents()
  }, [loadStudents])

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading subscription">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-red-700">Subscription state unavailable</h2>
        </div>
        <p className="mt-2 text-xs text-slate-500">{error ?? 'No data'}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="mt-4 h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <BoundaryBanner />

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="w-full bg-slate-100 border border-slate-200 h-auto flex-wrap p-1 gap-1">
          <TabsTrigger value="snapshot" className="data-[state=active]:bg-white data-[state=active]:text-slate-900 text-slate-600 text-xs">
            Snapshot
          </TabsTrigger>
          <TabsTrigger value="plan" className="data-[state=active]:bg-white data-[state=active]:text-slate-900 text-slate-600 text-xs">
            Plan &amp; billing
          </TabsTrigger>
          <TabsTrigger value="codes" className="data-[state=active]:bg-white data-[state=active]:text-slate-900 text-slate-600 text-xs">
            <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Codes
          </TabsTrigger>
          <TabsTrigger value="students" className="data-[state=active]:bg-white data-[state=active]:text-slate-900 text-slate-600 text-xs">
            <Users className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Students
          </TabsTrigger>
          <TabsTrigger value="ledger" className="data-[state=active]:bg-white data-[state=active]:text-slate-900 text-slate-600 text-xs">
            <ListOrdered className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="snapshot" className="space-y-4">
          <SnapshotCard data={data} registryRow={registryRow} gate={gate} onReload={() => void load()} />
        </TabsContent>

        <TabsContent value="plan" className="space-y-4">
          <PlanBillingCard
            schoolId={schoolId}
            schoolName={data.school.name}
            registryRow={registryRow}
            legacyPlan={legacyPlan}
            gate={gate}
            onReload={() => void load()}
          />
        </TabsContent>

        <TabsContent value="codes" className="space-y-4">
          <CodesCard codes={codes} total={codesTotal} gate={gate} onChanged={() => void load()} />
        </TabsContent>

        <TabsContent value="students" className="space-y-4">
                      <StudentsCard
            students={students}
            billingModel={billingModel}
            loading={studentsLoading}
            onSearch={(q) => void loadStudents(q)}
            onChanged={() => void load()}
          />
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <LedgerCard payments={data.payments} />
        </TabsContent>
      </Tabs>

      {onNavigateTab && (
        <p className="text-[11px] text-slate-400">
          Collecting fees from the school&apos;s own students? That is the{' '}
          <button
            type="button"
            className="font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800"
            onClick={() => onNavigateTab('gateway')}
          >
            Fee gateway
          </button>{' '}
          tab — a separate payment rail with separate credentials.
        </p>
      )}

      {/* Step-up dialog mount (dormant while platform TOTP is stood
          down; renders the MFA prompt when the 10-minute window is
          stale). */}
      {stepUpNode}
    </div>
  )
}
