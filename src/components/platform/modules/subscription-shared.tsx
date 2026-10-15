'use client'

// ============================================================
// subscription-shared — the EXTRACTED, REUSED subscription UI
// primitives (PR #30 authoritative system).
// ------------------------------------------------------------
// Extracted from SubscriptionsModule so the per-school workspace
// (SchoolSubscriptionTab) and the global console
// (/platform/subscriptions) share ONE implementation of:
//   · AssignEntitlementDialog — Model C assignment (+ code issue)
//   · StudentHistoryDialog   — entitlements/payments/codes history
//   · PlanPicker             — scope-filtered plan registry select
//   · OneTimeCodeBlock       — the one-time plaintext code display
// Plus the shared types/helpers (StudentRow, PlanRow, StateBadge,
// money/dateStr/errMessage).
//
// NO second redemption system: every action here calls the same
// authoritative endpoints the global console uses:
//   POST   /api/platform/students/[id]/subscription
//   PATCH  /api/platform/students/[id]/subscription
//   PATCH  /api/platform/subscriptions/codes/[id]
//   GET    /api/platform/subscriptions/plans
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { Gift, KeyRound, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

// ── shared types ────────────────────────────────────────────────────────

export interface StudentRow {
  studentId: string
  userId: string
  name: string
  email: string
  admissionNo: string | null
  class: string | null
  accountLocked: boolean
  billingModel: string
  entitlement: {
    id?: string
    status?: string
    computedState: string
    validityStart?: string
    validityEnd?: string
    source?: string
    planCode?: string
    coveredBySchool?: boolean
  }
}

export interface PlanRow {
  id: string; code: string; name: string; description: string | null
  scope: string; interval: string
  priceMonthly: number | null; priceAnnual: number | null; pricePerStudent: number | null
  currency: string; graceDays: number
  allowOnline: boolean; allowOffline: boolean
  availableForNew: boolean; availableForRenewal: boolean
  status: string; sortOrder: number
}

export interface RegistryRow {
  subscriptionId: string
  school: { id: string; name: string; slug: string; code: string; status: string; isDemo: boolean }
  billingModel: string
  plan: string
  planDef: { code: string; name: string } | null
  planCode: string | null
  interval: string | null
  priceSnapshot: number | null
  currencySnapshot: string
  periodStart: string | null
  periodEnd: string | null
  graceDays: number
  overrideStatus: string | null
  paymentCount: number
  entitlement: { state: string; businessAllowed: boolean; renewalRequired: boolean }
}

export interface ActivationCodeRow {
  id: string
  publicRef: string
  scope: string
  status: string
  school: { id: string; name: string; slug: string } | null
  student: { id: string; admissionNo: string | null; user: { name: string | null; email: string } } | null
  planCode: string | null
  interval: string | null
  validityMonths: number | null
  claimWindowDays: number | null
  issuedAt: string
  expiresAt: string | null
  claimedAt: string | null
  revokedAt: string | null
  revokeReason: string | null
  replacedBy: { publicRef: string } | null
  paymentRef: string | null
  events?: Array<{ type: string; at: string }>
}

// ── shared helpers ──────────────────────────────────────────────────────

export const money = (n: number | null, c = 'INR') =>
  n === null ? '—' : `${c === 'INR' ? '₹' : ''}${n.toLocaleString('en-IN')}${c === 'INR' ? '' : ' ' + c}`

export const dateStr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : (e as PlatformApiError)?.error ?? 'Request failed'
}

const STATE_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800', GRACE: 'bg-amber-100 text-amber-800',
  RESTRICTED: 'bg-rose-100 text-rose-800', SUSPENDED: 'bg-rose-100 text-rose-800',
  COVERED_BY_SCHOOL: 'bg-teal-100 text-teal-800', PENDING: 'bg-sky-100 text-sky-800',
  EXPIRED: 'bg-zinc-200 text-zinc-700', REVOKED: 'bg-rose-100 text-rose-800',
  ISSUED: 'bg-sky-100 text-sky-800', CLAIMED: 'bg-emerald-100 text-emerald-800',
  REPLACED: 'bg-zinc-200 text-zinc-700', NOT_ACTIVATED: 'bg-zinc-200 text-zinc-700',
  NOT_SUBSCRIBED: 'bg-zinc-200 text-zinc-700', TENANT_RESTRICTED: 'bg-rose-100 text-rose-800',
}

export const StateBadge = ({ state }: { state: string }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_BADGE[state] ?? 'bg-zinc-200 text-zinc-700'}`}>
    {state.replace(/_/g, ' ').toLowerCase()}
  </span>
)

// ── one-time activation code display ────────────────────────────────────

export interface OneTimeCode {
  publicRef: string
  code: string
  expiresAt: string
}

/**
 * The single authorized moment the plaintext code is displayed: amber
 * panel, select-all mono text, explicit "never visible again" copy.
 * Copy uses navigator.clipboard with honest failure (no fake success).
 */
export function OneTimeCodeBlock({ code, hint }: { code: OneTimeCode; hint?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    void navigator.clipboard.writeText(code.code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {
        /* clipboard unavailable — honest failure, user can select-all */
      },
    )
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        {code.publicRef}
      </div>
      <div className="mt-2 select-all rounded bg-white p-2 font-mono text-lg tracking-widest" aria-label="Activation code — shown once">
        {code.code}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-amber-800">
          {hint ?? 'Show and copy the code now — it will not be visible again. Deliver it to the intended recipient out-of-band.'}
          {code.expiresAt ? ` Redeemable until ${dateStr(code.expiresAt)}.` : ''}
        </p>
        <Button size="sm" variant="outline" onClick={onCopy} className="shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

// ── plan picker ─────────────────────────────────────────────────────────

/** Scope-filtered select over the ACTIVE plan registry (live fetch).
 *  Honest empty states: schema-pending (registry table absent) is NOT
 *  the same message as "no active plans configured". */
export function PlanPicker({ scope, value, onChange }: { scope: 'SCHOOL' | 'STUDENT'; value: string; onChange: (code: string) => void }) {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [pending, setPending] = useState(false)
  useEffect(() => {
    platformApi<{ subscriptionSchemaPending?: boolean; plans: PlanRow[] }>('/api/platform/subscriptions/plans')
      .then((d) => {
        setPlans(d.plans.filter((p) => p.scope === scope && p.status === 'ACTIVE'))
        setPending(isSubscriptionSchemaPending(d))
      })
      .catch(() => {})
  }, [scope])
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
      <SelectContent>
        {plans.map((p) => (
          <SelectItem key={p.code} value={p.code}>
            {p.name} ({p.scope === 'STUDENT' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? money(p.priceMonthly, p.currency) : money(p.priceAnnual, p.currency)})
          </SelectItem>
        ))}
        {plans.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {pending ? 'Plan registry is not provisioned on this database yet.' : `No active ${scope.toLowerCase()} plans configured.`}
          </div>
        )}
      </SelectContent>
    </Select>
  )
}

// ── assign entitlement dialog (Model C) ─────────────────────────────────

/**
 * Assign a per-student entitlement: records the offline payment
 * (or COMPLIMENTARY — separately permission-gated server-side) and
 * either activates directly or issues a student activation code.
 */
export function AssignEntitlementDialog({ student, onClose, onDone }: { student: StudentRow; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ message: string; activationCode?: OneTimeCode } | null>(null)
  /** Inline submit error — the durable surface for API failures (incl.
   *  the honest SUBSCRIPTION_SYSTEM_PENDING publicMessage). */
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [form, setForm] = useState({
    planCode: '', mode: 'CASH', amount: '', currency: 'INR', paymentDate: new Date().toISOString().slice(0, 10),
    reference: '', notes: '', validityMonths: '12', validityStart: '', validityEnd: '',
    issueActivationCode: true, claimWindowDays: '30',
  })

  const submit = async () => {
    if (!form.planCode) { toast.error('Select a plan first.'); return }
    if (form.mode === 'COMPLIMENTARY' && (!form.notes || form.notes.trim().length < 10)) {
      toast.error('Complimentary grants require an audit note (at least 10 characters) explaining why.')
      return
    }
    setSaving(true)
    setSubmitError(null)
    try {
      const d = await platformApi<{ message: string; activationCode?: OneTimeCode }>(
        `/api/platform/students/${student.studentId}/subscription`,
        {
          method: 'POST',
          body: JSON.stringify({
            planCode: form.planCode,
            mode: form.mode,
            amount: form.mode === 'COMPLIMENTARY' ? 0 : Number(form.amount || 0),
            currency: form.currency,
            paymentDate: form.paymentDate,
            reference: form.reference || undefined,
            notes: form.notes || undefined,
            validityMonths: Number(form.validityMonths || 12),
            validityStart: form.validityStart ? new Date(form.validityStart).toISOString() : undefined,
            validityEnd: form.validityEnd ? new Date(form.validityEnd).toISOString() : undefined,
            issueActivationCode: form.issueActivationCode,
            claimWindowDays: Number(form.claimWindowDays || 30),
          }),
        },
      )
      setResult(d)
      onDone()
    } catch (e) {
      // Inline (durable) instead of a transient toast — the operator
      // keeps the form state and can retry after fixing the cause.
      setSubmitError(errMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !result) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign student subscription</DialogTitle>
          <DialogDescription>
            {student.name} — record the payment and activate directly or issue a student activation code.
            Complimentary assignments use the separate permission-protected workflow.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm">{result.message}</p>
            {result.activationCode && (
              <OneTimeCodeBlock
                code={result.activationCode}
                hint="Show and copy the code now — it will not be visible again. Deliver it to the student out-of-band."
              />
            )}
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            {submitError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Assignment failed: {submitError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Plan</Label><PlanPicker scope="STUDENT" value={form.planCode} onChange={(v) => { setForm((f) => ({ ...f, planCode: v })) }} /></div>
              <div>
                <Label className="text-xs">Payment mode</Label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER', 'COMPLIMENTARY'].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.mode !== 'COMPLIMENTARY' && (
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs">Amount</Label><Input type="number" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" /></div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Payment date</Label><Input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Validity (months)</Label><Input type="number" min="1" max="36" value={form.validityMonths} onChange={(e) => setForm((f) => ({ ...f, validityMonths: e.target.value }))} /></div>
              <div><Label className="text-xs">Start date (optional, future)</Label><Input type="date" value={form.validityStart} onChange={(e) => setForm((f) => ({ ...f, validityStart: e.target.value }))} /></div>
            </div>
            <div>
              <Label className="text-xs">End date (optional — overrides months)</Label>
              <Input type="date" value={form.validityEnd} onChange={(e) => setForm((f) => ({ ...f, validityEnd: e.target.value }))} />
            </div>
            <div><Label className="text-xs">Reference / receipt</Label><Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no. (optional)" /></div>
            <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Audit note (optional)" /></div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-4 w-4" />Issue activation code</div>
                <p className="text-xs text-muted-foreground">The student claims the code in their portal. Recommended for offline payments.</p>
              </div>
              <Switch checked={form.issueActivationCode} onCheckedChange={(v) => setForm((f) => ({ ...f, issueActivationCode: v }))} />
            </div>
            {form.issueActivationCode && (
              <div><Label className="text-xs">Claim window (days)</Label><Input type="number" min="1" max="365" value={form.claimWindowDays} onChange={(e) => setForm((f) => ({ ...f, claimWindowDays: e.target.value }))} /></div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {form.mode === 'COMPLIMENTARY' ? <Gift className="mr-1 h-4 w-4" /> : <Wallet className="mr-1 h-4 w-4" />}
                {form.issueActivationCode ? 'Record + issue code' : 'Record + activate'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── student history dialog ──────────────────────────────────────────────

/** GET /api/platform/students/[id]/subscription response shape. */
interface StudentHistoryData {
  entitlements: Array<{ id: string; status: string; planCode: string | null; validityStart: string; validityEnd: string; source: string; revokeReason: string | null }>
  payments: Array<{ id: string; receiptNo: string | null; amount: number; currency: string; mode: string; paymentDate: string; reference: string | null }>
  codes: Array<{ id: string; publicRef: string; status: string; expiresAt: string; claimedAt: string | null }>
}

/**
 * Per-student subscription history: entitlements / payments / codes,
 * with the lifecycle actions (revoke/suspend/reactivate — reason ≥ 10
 * chars, audited server-side) and code reissue (plaintext ONCE).
 * A failed load renders a retryable error panel — NEVER a skeleton
 * forever and never a fake "no history" empty state.
 */
export function StudentHistoryDialog({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const [data, setData] = useState<StudentHistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await platformApi<StudentHistoryData>(`/api/platform/students/${student.studentId}/subscription`))
    } catch (e) {
      // ERROR ≠ EMPTY — the history panel must not look like "no data".
      setError(errMessage(e))
    }
  }, [student.studentId])

  useEffect(() => { void load() }, [load])

  const act = async (action: 'revoke' | 'suspend' | 'reactivate') => {
    // Server requires a reason (min 10) for every lifecycle action —
    // withdrawing/adjusting a paid entitlement is destructive.
    const reason =
      action === 'reactivate'
        ? 'Reactivated by operator'
        : window.prompt(`Reason for ${action}? (at least 10 characters — recorded in the audit trail)`)
    if (action !== 'reactivate' && (!reason || reason.trim().length < 10)) {
      if (reason !== null) toast.error('A reason of at least 10 characters is required.')
      return
    }
    setBusy(action)
    try {
      await platformApi(`/api/platform/students/${student.studentId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason: reason?.trim() }),
      })
      toast.success(`Entitlement ${action}d — financial records unchanged.`)
      await load()
    } catch (e) {
      toast.error(`${action} failed`, { description: errMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const reissue = async (codeId: string) => {
    const reason = window.prompt('Reason for reissue? (the old code becomes unusable)')
    if (!reason || reason.trim().length < 4) return
    setBusy(codeId)
    try {
      const d = await platformApi<{ code: string; publicRef: string; message: string }>(`/api/platform/subscriptions/codes/${codeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reissue', reason: reason.trim() }),
      })
      toast.success(d.message)
      window.alert(`New activation code (${d.publicRef}):\n\n${d.code}\n\nCopy it now — it will not be visible again.`)
      await load()
    } catch (e) {
      toast.error('Reissue failed', { description: errMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{student.name} — subscription history</DialogTitle>
          <DialogDescription>Entitlements, payments and codes. Financial records are immutable.</DialogDescription>
        </DialogHeader>
        {error && !data ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-700">Could not load the subscription history: {error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          </div>
        ) : !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Tabs defaultValue="entitlements">
            <TabsList>
              <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="codes">Codes</TabsTrigger>
            </TabsList>
            <TabsContent value="entitlements" className="space-y-2">
              {data.entitlements.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <div>
                    <StateBadge state={e.status} /> <span className="ml-2 text-xs text-muted-foreground">{e.source} · {dateStr(e.validityStart)} → {dateStr(e.validityEnd)}</span>
                    {e.revokeReason && <div className="text-xs text-rose-700">Revoked: {e.revokeReason}</div>}
                  </div>
                </div>
              ))}
              {data.entitlements.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No entitlements yet.</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={busy === 'revoke'} onClick={() => void act('revoke')}>Revoke live</Button>
                <Button size="sm" variant="outline" disabled={busy === 'suspend'} onClick={() => void act('suspend')}>Suspend live</Button>
                <Button size="sm" variant="outline" disabled={busy === 'reactivate'} onClick={() => void act('reactivate')}>Reactivate</Button>
              </div>
            </TabsContent>
            <TabsContent value="payments" className="space-y-2">
              {data.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="font-mono text-xs">{p.receiptNo}</span>
                  <span>{money(p.amount, p.currency)} · {p.mode.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-muted-foreground">{dateStr(p.paymentDate)}</span>
                </div>
              ))}
              {data.payments.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No payments recorded.</p>}
            </TabsContent>
            <TabsContent value="codes" className="space-y-2">
              {data.codes.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="font-mono text-xs">{c.publicRef}</span>
                  <StateBadge state={c.status} />
                  <span className="text-xs text-muted-foreground">expires {dateStr(c.expiresAt)}</span>
                  {(c.status === 'ISSUED' || c.status === 'EXPIRED') && (
                    <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => void reissue(c.id)}>
                      {busy === c.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Reissue
                    </Button>
                  )}
                </div>
              ))}
              {data.codes.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No codes issued.</p>}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
