'use client'

/**
 * SAAS-HARDENING (§3A) — platform console · school detail · Subscription tab.
 *
 * The tenant's entitlement snapshot (the SAME evaluation the school plane
 * enforces), the offline payment recording form (the verified-ledger
 * activation path), the manual entitlement override, and the full
 * platform billing ledger (School pays SCHOLARIO — disjoint from student
 * fees). Mutations are step-up-gated (gate() convention) and audited
 * server-side.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  History,
  IndianRupee,
  Info,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

// ── Types (API contract — GET /api/platform/schools/[id]/subscription) ────

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

// ── Small local helpers ───────────────────────────────────────────────────

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

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Same extension math the server applies (max(now, periodEnd) + 30-day months). */
function projectPeriodEnd(periodEnd: string | null, months: number): Date {
  const current = periodEnd ? new Date(periodEnd) : null
  const base = current && current.getTime() > Date.now() ? current : new Date()
  return new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000)
}

const num = new Intl.NumberFormat('en-IN')

/** State-specific badge colors — emerald ACTIVE · amber GRACE · orange RESTRICTED · red SUSPENDED. */
const STATE_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  GRACE: 'border-amber-200 bg-amber-50 text-amber-700',
  RESTRICTED: 'border-orange-200 bg-orange-50 text-orange-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  NOT_ACTIVATED: 'border-slate-200 bg-slate-100 text-slate-600',
}

function StateBadge({ state, className }: { state: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`normal-case ${STATE_STYLES[state] ?? STATE_STYLES['NOT_ACTIVATED']} ${className ?? ''}`}
    >
      {state}
    </Badge>
  )
}

/** The evaluator message strip mirrors the school plane's honest copy. */
function messageTone(state: string): string {
  if (state === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (state === 'GRACE') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-red-200 bg-red-50 text-red-700'
}

// ── Record Payment dialog (the §3A offline ledger entry) ──────────────────

interface RecordPaymentForm {
  amount: string
  currency: string
  mode: string
  paymentDate: string
  periodMonths: string
  reference: string
  notes: string
}

function emptyPaymentForm(): RecordPaymentForm {
  return {
    amount: '',
    currency: 'INR',
    mode: 'BANK_TRANSFER',
    paymentDate: todayISO(),
    periodMonths: '12',
    reference: '',
    notes: '',
  }
}

function validatePaymentForm(f: RecordPaymentForm): string | null {
  const amount = Number(f.amount)
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than zero'
  if (amount > 100_000_000) return 'Amount exceeds the accepted maximum (10,00,00,000)'
  const months = Number(f.periodMonths)
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return 'Subscription period must be a whole number of months between 1 and 60'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.paymentDate)) return 'Payment date is required'
  return null
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  periodEnd,
  gate,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  periodEnd: string | null
  gate: GateFn
  onRecorded: () => void
}) {
  const [form, setForm] = useState<RecordPaymentForm>(emptyPaymentForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(emptyPaymentForm())
      setError(null)
    }
  }, [open])

  const setField = <K extends keyof RecordPaymentForm>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const months = Number(form.periodMonths)
  const previewEnd = Number.isInteger(months) && months >= 1 && months <= 60
    ? projectPeriodEnd(periodEnd, months)
    : null

  const submit = async () => {
    const problem = validatePaymentForm(form)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{
          ok: true
          payment: { id: string; receiptNo: string; statusAfter: string; periodEndAfter: string }
          message: string
        }>(`/api/platform/schools/${schoolId}/subscription/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(form.amount),
            currency: form.currency,
            mode: form.mode,
            paymentDate: form.paymentDate,
            periodMonths: Number(form.periodMonths),
            ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
            ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          }),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success(
        `Payment recorded — receipt ${res.payment.receiptNo}. Subscription ${res.payment.statusAfter} until ${fmtDate(res.payment.periodEndAfter)}.`,
      )
      onOpenChange(false)
      onRecorded()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
            <Wallet className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Record subscription payment — {schoolName}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Records what the school actually paid SCHOLARIO (offline collection — the school
            pays the platform; this never touches student fees). A verified entry is the only
            cause of activation: the subscription extends{' '}
            {Number.isInteger(months) && months > 0 ? `by ${months} month${months === 1 ? '' : 's'}` : ''}{' '}
            and the tenant unlocks immediately, for this school only. Step-up gated and audited.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount" className="text-xs font-semibold text-slate-700">
              Amount *
            </Label>
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setField('amount', e.target.value)}
              placeholder="24000"
              className="h-11 bg-white border-slate-200 text-slate-900 tabular-nums focus-visible:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-currency" className="text-xs font-semibold text-slate-700">
              Currency
            </Label>
            <Select value={form.currency} onValueChange={(v) => setField('currency', v)}>
              <SelectTrigger id="pay-currency" className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c} className="focus:bg-slate-100">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-mode" className="text-xs font-semibold text-slate-700">
              Payment mode *
            </Label>
            <Select value={form.mode} onValueChange={(v) => setField('mode', v)}>
              <SelectTrigger id="pay-mode" className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m} className="focus:bg-slate-100">
                    {m.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date" className="text-xs font-semibold text-slate-700">
              Payment date *
            </Label>
            <Input
              id="pay-date"
              type="date"
              value={form.paymentDate}
              onChange={(e) => setField('paymentDate', e.target.value)}
              className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-months" className="text-xs font-semibold text-slate-700">
              Period covered (months) *
            </Label>
            <Input
              id="pay-months"
              type="number"
              inputMode="numeric"
              min="1"
              max="60"
              step="1"
              value={form.periodMonths}
              onChange={(e) => setField('periodMonths', e.target.value)}
              className="h-11 bg-white border-slate-200 text-slate-900 tabular-nums focus-visible:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-reference" className="text-xs font-semibold text-slate-700">
              Reference (UTR / cheque no.)
            </Label>
            <Input
              id="pay-reference"
              value={form.reference}
              onChange={(e) => setField('reference', e.target.value)}
              placeholder="UTR123456789"
              maxLength={120}
              className="h-11 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pay-notes" className="text-xs font-semibold text-slate-700">
              Notes (optional, audited)
            </Label>
            <Textarea
              id="pay-notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="e.g. Annual renewal — cheque #4412 deposited at the Mumbai branch…"
              rows={2}
              maxLength={600}
              className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 min-h-[72px]"
            />
          </div>
        </div>

        {previewEnd && (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800"
          >
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              On submit: receipt numbered automatically (SCH-RCP-…), subscription becomes{' '}
              <strong>ACTIVE until {fmtDate(previewEnd.toISOString())}</strong> —{' '}
              {months} month{months === 1 ? '' : 's'} extended from{' '}
              {periodEnd && new Date(periodEnd).getTime() > Date.now()
                ? `the current period end (${fmtDate(periodEnd)})`
                : 'today'}
              .
            </span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
          >
            {busy ? 'Recording…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Manual override control ───────────────────────────────────────────────

function OverrideControl({
  schoolId,
  currentOverride,
  gate,
  onApplied,
}: {
  schoolId: string
  currentOverride: string | null
  gate: GateFn
  onApplied: () => void
}) {
  const [choice, setChoice] = useState<string>('none')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const apply = async () => {
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required — it goes into the platform audit trail')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; overrideStatus: string | null; message: string }>(
          `/api/platform/schools/${schoolId}/subscription`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              overrideStatus: choice === 'none' ? null : choice,
              reason: reason.trim(),
            }),
          },
        ),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success(res.message)
      setReason('')
      setConfirmOpen(false)
      onApplied()
    } catch (e) {
      setError(errText(e))
      setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
          Manual entitlement override
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          A platform decision that forces the entitlement state, regardless of the computed
          period. School lifecycle (activate/suspend) is never touched here. Applies
          immediately, lasts until cleared, step-up gated and audited with your reason.
        </p>
      </div>

      <div className="space-y-4 p-4 sm:px-5">
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Current override:</span>
          {currentOverride ? (
            <StateBadge state={currentOverride} />
          ) : (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500 normal-case">
              none — computed period state applies
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="override-select" className="text-xs font-semibold text-slate-700">
              Set override to
            </Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id="override-select" className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-amber-500/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                <SelectItem value="none" className="focus:bg-slate-100">
                  Clear override (computed state)
                </SelectItem>
                {OVERRIDE_STATES.map((s) => (
                  <SelectItem key={s} value={s} className="focus:bg-slate-100">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="override-reason" className="text-xs font-semibold text-slate-700">
              Reason (required) *
            </Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                choice === 'none'
                  ? 'e.g. Billing dispute resolved — returning the tenant to its computed period state…'
                  : 'e.g. Goodwill 7-day extension while the cheque clears (order #4412)…'
              }
              rows={2}
              maxLength={400}
              className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-amber-500/40 min-h-[72px]"
            />
            <p className="text-[10px] text-slate-400 tabular-nums">{reason.trim().length}/400 · minimum 10</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-slate-200 p-4 sm:px-5">
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          className="h-11 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold focus-ring"
        >
          {busy ? 'Applying…' : choice === 'none' ? 'Clear override' : `Set override to ${choice}`}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-slate-900">
              {choice === 'none'
                ? 'Clear the manual override?'
                : `Set manual override to ${choice}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              {choice === 'none' ? (
                <>
                  The entitlement returns to its computed period state — the override no longer
                  applies. Audited with your reason.
                </>
              ) : (
                <>
                  This immediately forces the school&apos;s entitlement state to{' '}
                  <StateBadge state={choice} /> — overriding the computed period state until the
                  override is cleared. {choice === 'SUSPENDED' || choice === 'RESTRICTED'
                    ? 'Business modules lock for this school the moment it applies.'
                    : 'Business modules unlock for this school the moment it applies.'}{' '}
                  Audited with your reason.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
              className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void apply()}
              disabled={busy}
              className={
                choice === 'SUSPENDED' || choice === 'RESTRICTED'
                  ? 'h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring'
                  : 'h-11 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold focus-ring'
              }
            >
              {busy
                ? 'Applying…'
                : choice === 'none'
                  ? 'Clear override'
                  : `Force ${choice}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Ledger row (shared by table + mobile card) ────────────────────────────

function ModeLabel({ mode }: { mode: string }) {
  return <span className="text-xs text-slate-600">{mode.replace(/_/g, ' ').toLowerCase()}</span>
}

function ResultCell({ statusAfter, periodEndAfter }: { statusAfter: string | null; periodEndAfter: string | null }) {
  if (!statusAfter) return <span className="text-slate-400">—</span>
  return (
    <span className="flex flex-col gap-0.5">
      <StateBadge state={statusAfter} />
      {periodEndAfter && (
        <span className="text-[10px] tabular-nums text-slate-500">until {fmtDate(periodEndAfter)}</span>
      )}
    </span>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolSubscriptionTab({ schoolId }: { schoolId: string }) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [data, setData] = useState<SubscriptionResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setData(
        await platformApi<SubscriptionResponse>(`/api/platform/schools/${schoolId}/subscription`),
      )
    } catch (e) {
      setLoadError(errText(e))
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  const payments = useMemo(
    () =>
      (data?.payments ?? []).slice().sort((a, b) => {
        const pd = new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()
        return pd !== 0 ? pd : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }),
    [data],
  )

  const sub = data?.subscription ?? null
  const ent = data?.entitlement

  return (
    <div className="space-y-4">
      {stepUpNode}

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError}
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

      {data === null && loadError === null && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading subscription">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
            <Skeleton className="h-5 w-56 bg-slate-200" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16 bg-slate-200" />
                  <Skeleton className="h-5 w-24 bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-40 w-full rounded-xl bg-slate-100" />
          <Skeleton className="h-64 w-full rounded-xl bg-slate-100" />
        </div>
      )}

      {data && (
        <>
          {/* ── Entitlement snapshot ─────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-teal-600" aria-hidden="true" />
                  Subscription &amp; entitlement snapshot
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  The same evaluation the school plane enforces — the console and the school&apos;s
                  locked shell can never disagree about this state.
                </p>
              </div>
              <Button
                onClick={() => setRecordOpen(true)}
                className="h-11 shrink-0 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                <IndianRupee className="h-4 w-4" aria-hidden="true" />
                Record payment
              </Button>
            </div>

            <div className="p-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <StateBadge state={ent?.state ?? '—'} className="px-3 py-1 text-sm" />
                {sub?.overrideStatus && (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    override in effect — {sub.overrideStatus}
                  </span>
                )}
                {ent && (
                  <span className="text-[11px] text-slate-500">
                    business modules {ent.businessAllowed ? 'unlocked' : 'locked'} · sign-in{' '}
                    {ent.state === 'NOT_ACTIVATED' ? 'blocked' : 'allowed'}
                  </span>
                )}
              </div>

              {ent?.message && (
                <div
                  role="note"
                  className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${messageTone(ent.state)}`}
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {ent.message}
                </div>
              )}

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Plan</dt>
                  <dd className="mt-1 text-sm text-slate-700">{sub?.plan ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Period start</dt>
                  <dd className="mt-1 text-sm tabular-nums text-slate-700">{fmtDate(sub?.periodStart ?? null)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <CalendarDays className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    Period end
                  </dt>
                  <dd className="mt-1 text-sm tabular-nums text-slate-700">
                    {sub ? (sub.periodEnd ? fmtDate(sub.periodEnd) : 'No expiry set') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Grace days</dt>
                  <dd className="mt-1 text-sm tabular-nums text-slate-700">{sub?.graceDays ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Stored snapshot status</dt>
                  <dd className="mt-1 text-sm text-slate-700">{sub?.status ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Manual override</dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {sub?.overrideStatus ? (
                      <span className="font-semibold text-amber-700">{sub.overrideStatus}</span>
                    ) : (
                      'none — computed state'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">School lifecycle</dt>
                  <dd className="mt-1 text-sm text-slate-700">{data.school.status}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Renewal required</dt>
                  <dd className="mt-1 text-sm text-slate-700">{ent?.renewalRequired ? 'yes' : 'no'}</dd>
                </div>
              </dl>

              {!sub && (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                  No subscription record exists for this school yet — the entitlement currently
                  evaluates with no period set. Recording the first verified payment creates the
                  subscription row atomically.
                </p>
              )}
              {sub?.notes && (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">Notes:</span> {sub.notes}
                </p>
              )}
            </div>
          </div>

          {/* ── Manual override ───────────────────────────────────────── */}
          <OverrideControl
            schoolId={schoolId}
            currentOverride={sub?.overrideStatus ?? null}
            gate={gate}
            onApplied={() => void load()}
          />

          {/* ── Payments ledger ───────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                <History className="h-4 w-4 text-teal-600" aria-hidden="true" />
                Payments ledger
                <span className="font-normal text-xs text-slate-500 tabular-nums">
                  ({payments.length} entr{payments.length === 1 ? 'y' : 'ies'})
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Every activation and extension traces to a VERIFIED entry here (offline
                admin-recorded or signature-verified webhook) — a browser report of payment
                success is never sufficient. Newest first.
              </p>
            </div>

            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                  <IndianRupee className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">No payments recorded yet</p>
                <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
                  This school&apos;s subscription has no ledger entries — activation requires a
                  verified payment. Record one with the button above.
                </p>
              </div>
            ) : (
              <>
                {/* Table (≥ sm) */}
                <div className="hidden sm:block">
                  <div className="max-h-[26rem] overflow-auto custom-scrollbar">
                    <Table className="text-slate-700">
                      <TableHeader>
                        <TableRow className="border-slate-200 hover:bg-transparent sticky top-0 bg-white z-10">
                          <TableHead className="text-slate-500 font-medium">Receipt</TableHead>
                          <TableHead className="text-slate-500 font-medium">Date</TableHead>
                          <TableHead className="text-slate-500 font-medium">Amount</TableHead>
                          <TableHead className="text-slate-500 font-medium">Mode</TableHead>
                          <TableHead className="text-slate-500 font-medium">Period</TableHead>
                          <TableHead className="text-slate-500 font-medium">Reference</TableHead>
                          <TableHead className="text-slate-500 font-medium">Recorded by</TableHead>
                          <TableHead className="text-slate-500 font-medium">Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((p) => (
                          <TableRow key={p.id} className="border-slate-200">
                            <TableCell className="font-mono text-xs text-slate-700">
                              {p.receiptNo ?? <span className="text-slate-400" title="No receipt number on this entry">—</span>}
                              {p.verification === 'VERIFIED' && (
                                <span
                                  className="ml-1.5 inline-flex items-center rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700"
                                  title="Verified entry — only VERIFIED rows activate a subscription"
                                >
                                  verified
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-xs text-slate-600">
                              {fmtDate(p.paymentDate)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-sm font-semibold text-slate-800">
                              {fmtMoney(p.amount, p.currency)}
                            </TableCell>
                            <TableCell>
                              <ModeLabel mode={p.mode} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-xs text-slate-600">
                              {num.format(p.periodMonths)} mo
                            </TableCell>
                            <TableCell className="max-w-[10rem]">
                              {p.reference ? (
                                <span className="block truncate font-mono text-xs text-slate-600" title={p.reference}>
                                  {p.reference}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[9rem]">
                              {p.recordedBy ? (
                                <span className="block truncate text-xs text-slate-600" title={p.recordedBy.email}>
                                  {p.recordedBy.name}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400" title="Webhook-recorded (online) payment">
                                  webhook
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <ResultCell statusAfter={p.statusAfter} periodEndAfter={p.periodEndAfter} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Cards (mobile) */}
                <ul className="space-y-3 p-4 sm:hidden" aria-label="Payments ledger">
                  {payments.map((p) => (
                    <li key={p.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {p.receiptNo ?? '—'}
                        </span>
                        <ResultCell statusAfter={p.statusAfter} periodEndAfter={p.periodEndAfter} />
                      </div>
                      <p className="mt-1.5 text-sm font-semibold tabular-nums text-slate-900">
                        {fmtMoney(p.amount, p.currency)}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600">
                        <span className="tabular-nums">{fmtDate(p.paymentDate)}</span>
                        <span>{p.mode.replace(/_/g, ' ').toLowerCase()} · {num.format(p.periodMonths)} mo</span>
                        {p.reference && (
                          <span className="col-span-2 truncate font-mono text-[11px] text-slate-500" title={p.reference}>
                            ref {p.reference}
                          </span>
                        )}
                        <span className="col-span-2 text-[11px] text-slate-500">
                          {p.recordedBy ? `recorded by ${p.recordedBy.name}` : 'webhook-recorded'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <RecordPaymentDialog
            open={recordOpen}
            onOpenChange={setRecordOpen}
            schoolId={schoolId}
            schoolName={data.school.name}
            periodEnd={sub?.periodEnd ?? null}
            gate={gate}
            onRecorded={() => void load()}
          />
        </>
      )}
    </div>
  )
}
