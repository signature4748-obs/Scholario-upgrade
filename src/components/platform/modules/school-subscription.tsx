'use client'

// ============================================================
// SchoolSubscriptionTab — school workspace · Subscription tab
// (REDESIGNED 2026-10-29 — the guided 4-step subscription flow)
// ------------------------------------------------------------
// REPLACES the old five-nested-tabs layout (Snapshot / Plan &
// billing / Codes / Students / Ledger — concepts scattered with no
// end-to-end workflow) with ONE guided page a non-technical
// platform owner can follow top to bottom:
//
//   Summary      — the school's current subscription at a glance
//                  (state, plan, price, validity, renewal) + the
//                  primary action.
//   Step 1       — Plan & pricing: what the school is on and what
//                  it pays; editable AFTER school creation (terms
//                  API — plan, billing model, price, licensed
//                  students, period). Advanced controls (legacy
//                  plan marker, manual entitlement override) live
//                  in a collapsed drawer, explained.
//   Step 2       — Record payment / activate / renew: a guided,
//                  reviewed payment form that activates directly
//                  or issues a one-time activation code.
//   Step 3       — Access & activation codes: how codes work,
//                  the school's codes (status/expiry/redemption),
//                  and per-student entitlement assignment. Staff
//                  codes are honestly marked unsupported.
//   Step 4       — History & status: the immutable payment ledger
//                  (what this school paid SCHOLARIO) and the
//                  recent subscription audit trail.
//
// PLAIN-LANGUAGE CONTRACT (mission terminology):
//   · Plan        — the product tier the school is on (Standard,
//                   Pro…). A label, not a price.
//   · Billing model — how the price is computed: fixed school fee
//                   (SCHOOL_WIDE) or per student (PER_STUDENT) or
//                   mixed (MIXED).
//   · Price       — what THIS school is actually charged (an
//                   agreed override of the catalogue price where
//                   negotiated).
//   · Entitlement — the access those payments unlock for the
//                   school (and, per-student, for a student).
//
// PLATFORM SUBSCRIPTION ≠ SCHOOL FEE COLLECTION: the banner keeps
// the boundary visible (the school's own fee gateway lives in the
// "Fee gateway" tab — different money, different credentials).
//
// All mutations reuse the authoritative endpoints (no second
// subscription system): the same APIs /platform/subscriptions and
// /platform/schools/[id]/subscription* use. Billing mutations are
// step-up-gated (gate() convention — dormant while platform TOTP
// is stood down) and audited server-side with the operator's
// reason.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  CircleDollarSign,
  Info,
  KeyRound,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
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
  AssignEntitlementDialog,
  StudentHistoryDialog,
  type ActivationCodeRow,
  type PlanRow,
  type RegistryRow,
  type StudentRow,
} from './subscription-shared'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
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

/** PATCH …/subscription/terms response. */
interface TermsResult {
  ok: true
  terms: {
    planCode: string | null
    billingModel: string
    interval: string | null
    priceSnapshot: number | null
    currencySnapshot: string | null
    licensedStudents: number | null
    periodStart: string | null
  }
  cataloguePrice?: number
  catalogueCurrency?: string
  message: string
}

interface RecordPaymentResult {
  message: string
  payment?: { receiptNo: string; statusAfter?: string; periodEndAfter?: string }
  activationCode?: { publicRef: string; code: string; expiresAt: string }
}

/** /api/platform/audit?schoolId=&category=subscription events. */
interface AuditEventRow {
  id: string
  at: string
  action: string
  admin: { name: string; email: string | null } | null
  reason: string | null
}

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const
const PAYMENT_MODES = ['ONLINE_PAYMENT', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const
const OVERRIDE_STATES = ['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED'] as const
const CODE_STATUS_FILTERS = ['ALL', 'ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED', 'REPLACED'] as const

// ── Plain-language maps (the anti-jargon layer) ──────────────────────────

const STATE_PLAIN: Record<string, string> = {
  ACTIVE: 'Active',
  GRACE: 'Grace period',
  RESTRICTED: 'Restricted',
  SUSPENDED: 'Suspended',
  NOT_ACTIVATED: 'Not activated',
}

const STATE_PLAIN_HINT: Record<string, string> = {
  ACTIVE: 'Full platform access. Renew before the valid-until date to keep it that way.',
  GRACE: 'Expired recently — the school still has access for the remaining grace days.',
  RESTRICTED: 'Expired — the school can sign in, but business modules are locked until renewal.',
  SUSPENDED: 'Platform-side suspension. Sign-in works; modules are locked.',
  NOT_ACTIVATED: 'This school has not been activated yet (provisioning).',
}

const MODEL_PLAIN: Record<string, string> = {
  SCHOOL_WIDE: 'Fixed school fee',
  PER_STUDENT: 'Per student',
  MIXED: 'Mixed — school fee + per student',
}

const MODEL_EXPLAIN: Record<string, string> = {
  SCHOOL_WIDE:
    'One price for the whole school, whatever its size. Every eligible member is covered by the school\u2019s subscription.',
  PER_STUDENT:
    'The price is multiplied by the licensed student quantity. Each student needs their own access (assigned from Step 3).',
  MIXED:
    'The school fee covers staff-run modules; students still need their own per-student access for student modules.',
}

/** Null-safe plain-language billing-model label. A NULL model (the
 *  schema-pending wire shape) renders as an em-dash — never a fabricated
 *  value (the 2026-10-19 crash/fabrication regression class). */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return '—'
  return MODEL_PLAIN[model] ?? model
}

const STATE_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  GRACE: 'border-amber-200 bg-amber-50 text-amber-700',
  RESTRICTED: 'border-orange-200 bg-orange-50 text-orange-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  NOT_ACTIVATED: 'border-slate-200 bg-slate-100 text-slate-600',
}

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

/** Full INR-style currency rendering (₹1,05,000.00) — exact-as-stored
 *  money for ledgers; the `money` helper is used for compact previews. */
function moneyExact(n: number | null, c: string): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: c,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function EntitlementStateBadge({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className={`normal-case ${STATE_STYLES[state] ?? STATE_STYLES['NOT_ACTIVATED']}`}
      title={STATE_PLAIN_HINT[state] ?? undefined}
    >
      {STATE_PLAIN[state] ?? state.replace(/_/g, ' ')}
    </Badge>
  )
}

/** Inline contextual help — one short sentence, no paragraphs. */
function HelpHint({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={text}>
      <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  )
}

/** The numbered section shell — one guided page, no nested tabs. */
function StepSection({
  step,
  id,
  title,
  intro,
  actions,
  children,
}: {
  step: number | null
  id: string
  title: string
  intro: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {step != null && (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white"
            >
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h3 id={`${id}-heading`} className="font-display text-sm font-bold text-slate-900">
              {title}
            </h3>
            <p className="mt-0.5 max-w-2xl text-[11px] leading-snug text-slate-500">{intro}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-4 p-4 sm:px-5">{children}</div>
    </section>
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

// ── Step 1 · Plan & pricing editor ───────────────────────────────────────

/**
 * TermsDialog — set or renegotiate this school's commercial terms at any
 * time (the capability the old UI lacked: plan, billing model, price,
 * licensed students and start date were wizard-only).
 *
 * HONEST CONTRACT, said in the dialog itself: saving terms records the
 * AGREED price only — it is not a payment and never activates anything.
 * The paid period moves only when a verified payment is recorded (Step 2).
 */
function TermsDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  registryRow,
  plans,
  plansLoading,
  plansError,
  onRetryPlans,
  gate,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  registryRow: RegistryRow | null
  plans: PlanRow[]
  plansLoading: boolean
  plansError: string | null
  onRetryPlans: () => void
  gate: GateFn
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    planCode: '',
    billingModel: 'SCHOOL_WIDE',
    interval: 'ANNUAL',
    price: '',
    currency: 'INR',
    licensedStudents: '',
    periodStart: '',
    reason: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the form from the CURRENT terms when the dialog OPENS (an
  // open-transition — not every registryRow change: a parent reload must
  // never clobber the form mid-edit). Current terms are read through a
  // ref so the seed always sees the latest row.
  const registryRef = useRef(registryRow)
  registryRef.current = registryRow
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true
      const reg = registryRef.current
      setForm({
        planCode: reg?.planCode ?? '',
        billingModel: reg?.billingModel ?? 'SCHOOL_WIDE',
        interval: reg?.interval ?? 'ANNUAL',
        price: reg?.priceSnapshot != null ? String(reg.priceSnapshot) : '',
        currency: reg?.currencySnapshot ?? 'INR',
        licensedStudents: reg?.licensedStudents != null ? String(reg.licensedStudents) : '',
        periodStart: reg?.periodStart ? reg.periodStart.slice(0, 10) : '',
        reason: '',
      })
      setError(null)
    }
    if (!open) wasOpenRef.current = false
  }, [open])

  const selectedPlan = plans.find((p) => p.code === form.planCode) ?? null
  const isStudentBased = form.billingModel === 'PER_STUDENT'

  // Choosing a plan pre-fills the catalogue price + interval (editable —
  // a negotiated price is recorded exactly as agreed).
  useEffect(() => {
    if (open && selectedPlan && form.planCode) {
      const catalogue =
        selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual
      setForm((f) => ({
        ...f,
        interval: selectedPlan.interval,
        currency: selectedPlan.currency,
        // Only pre-fill the price when the operator has not typed one
        // (switching plans re-anchors the price on the new catalogue).
        price: catalogue != null && f.price === '' ? String(catalogue) : f.price,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.planCode, open])

  const priceNum = Number(form.price)
  const priceValid = form.price !== '' && Number.isFinite(priceNum) && priceNum > 0
  const licensedNum = form.licensedStudents.trim() === '' ? null : Number(form.licensedStudents)
  const totalPreview =
    isStudentBased && priceValid && licensedNum != null ? priceNum * licensedNum : null

  const validationProblem = (() => {
    if (isStudentBased && form.interval === 'MONTHLY') {
      return 'Per-student billing is charged yearly only — the billing period switches to Annual.'
    }
    if (isStudentBased && (licensedNum == null || !Number.isInteger(licensedNum) || licensedNum < 1)) {
      return 'Enter the licensed student count (the quantity the per-student price multiplies).'
    }
    if (form.price !== '' && !priceValid) return 'Price must be a number greater than zero.'
    if (form.reason.trim().length < 4) return 'Add a short reason (at least 4 characters) — it is recorded in the audit trail.'
    return null
  })()

  const submit = async () => {
    if (validationProblem) {
      setError(validationProblem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        reason: form.reason.trim(),
        ...(form.planCode ? { planCode: form.planCode } : { planCode: null }),
        billingModel: form.billingModel,
        ...(isStudentBased && form.interval === 'MONTHLY' ? { interval: 'ANNUAL' } : { interval: form.interval }),
        ...(form.price !== '' ? { price: priceNum } : { price: null }),
        currency: form.currency,
        ...(isStudentBased ? { licensedStudents: licensedNum } : { licensedStudents: null }),
        ...(form.periodStart ? { periodStart: form.periodStart } : {}),
      }
      const res = await gate(() =>
        platformApi<TermsResult>(`/api/platform/schools/${schoolId}/subscription/terms`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success('Plan & pricing saved', {
        description:
          'The agreed terms are on record. No payment was recorded — activate or renew from Step 2 when the school pays.',
      })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <CircleDollarSign className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Plan &amp; pricing — {schoolName}
          </DialogTitle>
          <DialogDescription>
            The commercial terms this school is billed under. Saving records the agreed plan and price only — it is not
            a payment and does not activate anything.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Plan */}
          <div>
            <Label className="text-xs" htmlFor="terms-plan">
              Plan <HelpHint text="The product tier the school is on — a label naming the package, not the price itself." />
            </Label>
            {plansError ? (
              <div
                role="alert"
                className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
              >
                <p className="min-w-0 text-xs text-red-700">Plans could not be loaded — {plansError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetryPlans}
                  disabled={plansLoading}
                  className="h-8 shrink-0 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : (
              <Select
                value={form.planCode || '__none__'}
                onValueChange={(v) => setForm((f) => ({ ...f, planCode: v === '__none__' ? '' : v }))}
                disabled={plansLoading}
              >
                <SelectTrigger id="terms-plan" className="bg-white" aria-label="Plan">
                  <SelectValue placeholder={plansLoading ? 'Loading plans…' : 'No plan linked'} />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="__none__">No plan linked (terms only)</SelectItem>
                  {plans
                    .filter((p) => p.scope === 'SCHOOL' && p.status === 'ACTIVE')
                    .map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name} —{' '}
                        {money(p.interval === 'MONTHLY' ? p.priceMonthly : p.priceAnnual, p.currency)} /{' '}
                        {p.interval === 'MONTHLY' ? 'month' : 'year'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            {selectedPlan && (
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                {selectedPlan.description?.trim()
                  ? selectedPlan.description
                  : 'What this plan includes is not described in the catalogue — the plan name and price are the recorded facts.'}
                {selectedPlan.limits && typeof (selectedPlan.limits as Record<string, unknown>).maxStudents === 'number' && (
                  <>
                    {' '}
                    Includes up to{' '}
                    {Number((selectedPlan.limits as Record<string, unknown>).maxStudents).toLocaleString('en-IN')}{' '}
                    students.
                  </>
                )}
              </p>
            )}
          </div>

          {/* Billing model */}
          <div>
            <Label className="text-xs" htmlFor="terms-model">
              Billing model <HelpHint text="How the price is calculated: one fee for the school, or per student." />
            </Label>
            <Select
              value={form.billingModel}
              onValueChange={(v) => setForm((f) => ({ ...f, billingModel: v }))}
            >
              <SelectTrigger id="terms-model" className="bg-white" aria-label="Billing model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {(['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'] as const).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODEL_PLAIN[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">{MODEL_EXPLAIN[form.billingModel]}</p>
          </div>

          {/* Price + currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs" htmlFor="terms-price">
                {isStudentBased ? 'Price per student' : 'Price charged to this school'}{' '}
                <HelpHint text="The agreed commercial price for this school — it can differ from the catalogue price." />
              </Label>
              <Input
                id="terms-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder={selectedPlan ? String(
                  selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual,
                ) : 'e.g. 24000'}
                className="bg-white"
              />
              {selectedPlan && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Catalogue price:{' '}
                  {money(
                    selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual,
                    selectedPlan.currency,
                  )}
                  {priceValid && ' — edit only if a different price was agreed.'}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs" htmlFor="terms-currency">
                Currency
              </Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              >
                <SelectTrigger id="terms-currency" className="bg-white" aria-label="Currency">
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
          </div>

          {/* Licensed students (per-student billing only) */}
          {isStudentBased && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="terms-licensed">
                  Licensed student limit
                </Label>
                <Input
                  id="terms-licensed"
                  inputMode="numeric"
                  value={form.licensedStudents}
                  onChange={(e) => setForm((f) => ({ ...f, licensedStudents: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="e.g. 350"
                  className="bg-white"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  The billable student quantity the per-student price multiplies.
                </p>
              </div>
              <div>
                <Label className="text-xs" htmlFor="terms-start">
                  Subscription start date
                </Label>
                <Input
                  id="terms-start"
                  type="date"
                  value={form.periodStart}
                  onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                  className="bg-white"
                />
                <p className="mt-1 text-[11px] text-slate-500">The paid period begins with the first payment.</p>
              </div>
            </div>
          )}

          {!isStudentBased && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="terms-interval">
                  Billing period
                </Label>
                <Select
                  value={form.interval}
                  onValueChange={(v) => setForm((f) => ({ ...f, interval: v }))}
                >
                  <SelectTrigger id="terms-interval" className="bg-white" aria-label="Billing period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="ANNUAL">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs" htmlFor="terms-start">
                  Subscription start date
                </Label>
                <Input
                  id="terms-start"
                  type="date"
                  value={form.periodStart}
                  onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                  className="bg-white"
                />
                <p className="mt-1 text-[11px] text-slate-500">The paid period begins with the first payment.</p>
              </div>
            </div>
          )}

          {/* Live price preview — the operator sees exactly what will be
              charged, computed from the entered values. */}
          <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Effective price preview</p>
            {priceValid ? (
              <div className="space-y-1 text-sm">
                {isStudentBased ? (
                  <>
                    <div className="flex flex-wrap justify-between gap-2 text-slate-600">
                      <span>
                        {money(priceNum, form.currency)} per student / year
                        {licensedNum != null && <> × {licensedNum.toLocaleString('en-IN')} licensed students</>}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5">
                      <span className="font-semibold text-slate-700">Annual amount</span>
                      <span className="font-semibold text-slate-900">
                        {totalPreview != null ? money(totalPreview, form.currency) : '— enter the student count'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-600">
                      {form.interval === 'MONTHLY' ? 'Monthly school fee' : 'Annual school fee'} — covers every
                      eligible member
                    </span>
                    <span className="font-semibold text-slate-900">{money(priceNum, form.currency)}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Enter the agreed price to see the breakdown.</p>
            )}
          </div>

          <div>
            <Label className="text-xs" htmlFor="terms-reason">
              Reason (audited)
            </Label>
            <Input
              id="terms-reason"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Renewal negotiation — agreed ₹300 per student"
              className="bg-white"
            />
          </div>

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
              Save plan &amp; pricing
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Step 2 · Record payment / activate / renew ───────────────────────────

/**
 * RecordPaymentDialog — the guided payment flow (form → review → result).
 *
 * The form always shows WHAT is being paid for (school, plan, price,
 * billing period covered) before anything is submitted; the review step
 * restates it and warns about look-alike recent payments; the result
 * surfaces the immutable receipt (and the one-time code when the offline
 * handshake was chosen).
 *
 * HONEST CONTRACT: only a VERIFIED payment recorded here ever activates
 * or renews the subscription — selecting a plan or saving terms never
 * does. A look-alike duplicate inside 10 minutes is refused server-side
 * unless the operator explicitly re-confirms here.
 */
function RecordPaymentDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  registryRow,
  plans,
  plansLoading,
  plansError,
  onRetryPlans,
  recentPayments,
  gate,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  registryRow: RegistryRow | null
  plans: PlanRow[]
  plansLoading: boolean
  plansError: string | null
  onRetryPlans: () => void
  recentPayments: PaymentRow[]
  gate: GateFn
  onRecorded: () => void
}) {
  const [phase, setPhase] = useState<'form' | 'review' | 'result'>('form')
  const [form, setForm] = useState({
    planCode: '',
    amount: '',
    currency: 'INR',
    mode: 'BANK_TRANSFER',
    paymentDate: todayISO(),
    reference: '',
    notes: '',
    issueActivationCode: false,
    claimWindowDays: '30',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Server-side duplicate refusal awaiting explicit re-confirmation. */
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)
  const [result, setResult] = useState<RecordPaymentResult | null>(null)

  const offlinePlans = useMemo(
    () => plans.filter((p) => p.scope === 'SCHOOL' && p.status === 'ACTIVE' && p.allowOffline),
    [plans],
  )
  const selectedPlan = offlinePlans.find((p) => p.code === form.planCode) ?? null

  // The CHARGE this payment should carry, from the school's configured
  // terms first (negotiated unit price, per-student total) and the plan's
  // catalogue price otherwise — the same arithmetic the server validates.
  const suggestedAmount = useMemo(() => {
    if (!selectedPlan) return null
    const model = registryRow?.billingModel ?? 'SCHOOL_WIDE'
    const negotiated =
      registryRow?.planCode === selectedPlan.code && registryRow?.priceSnapshot != null
        ? registryRow.priceSnapshot
        : null
    const catalogue =
      selectedPlan.interval === 'MONTHLY' ? selectedPlan.priceMonthly : selectedPlan.priceAnnual
    const unit = negotiated ?? catalogue ?? null
    if (unit == null) return null
    if (model === 'PER_STUDENT' && negotiated != null && registryRow?.licensedStudents != null) {
      return unit * registryRow.licensedStudents
    }
    return unit
  }, [selectedPlan, registryRow])

  // Seed the form ONLY when the dialog OPENS (an open-transition, not
  // every registryRow change): a successful submit reloads the parent —
  // a fresh registryRow object must NEVER reset the dialog mid-display
  // (the one-time activation code / receipt result would be lost
  // otherwise — the code is shown exactly once). Current terms are read
  // through a ref so the seed always sees the latest row.
  const registryRef = useRef(registryRow)
  registryRef.current = registryRow
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true
      const reg = registryRef.current
      setPhase('form')
      setDuplicateNotice(null)
      setError(null)
      setResult(null)
      setForm((f) => ({
        ...f,
        // Pre-select the school's linked plan when it is purchasable
        // offline; otherwise start clean.
        planCode:
          reg?.planCode && offlinePlans.some((p) => p.code === reg.planCode) ? reg.planCode : '',
        amount: '',
        reference: '',
        notes: '',
        issueActivationCode: false,
        currency: reg?.currencySnapshot ?? 'INR',
        paymentDate: todayISO(),
      }))
    }
    if (!open) wasOpenRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Follow the plan/terms choice with the suggested amount (editable —
  // the server validates the final number against the agreed price).
  useEffect(() => {
    if (open && suggestedAmount != null && phase === 'form') {
      setForm((f) => ({
        ...f,
        amount: String(suggestedAmount),
        currency: selectedPlan?.currency ?? f.currency,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.planCode, open, phase])

  const amountNum = Number(form.amount)
  const amountValid = form.amount !== '' && Number.isFinite(amountNum) && amountNum > 0
  const coveredMonths = selectedPlan ? (selectedPlan.interval === 'MONTHLY' ? 1 : 12) : 12

  /** Look-alike recent payment (client-side pre-warning; the server
   *  re-checks inside 10 minutes and refuses unless re-confirmed). NOTE:
   *  computed in BOTH phases — the review step must surface the warning
   *  too, and its presence is what the confirmed submit reports. */
  const lookAlike = useMemo(() => {
    if (!amountValid) return null
    const dateKey = form.paymentDate
    return (
      recentPayments.find(
        (p) =>
          Math.abs(p.amount - amountNum) < 0.01 &&
          p.currency === form.currency &&
          p.mode === form.mode &&
          p.paymentDate.slice(0, 10) === dateKey,
      ) ?? null
    )
  }, [recentPayments, amountNum, amountValid, form.currency, form.mode, form.paymentDate])

  const validationProblem = (() => {
    if (phase !== 'form') return null
    if (!form.planCode) return 'Select the plan this payment is for.'
    if (!amountValid) return 'Amount paid must be a number greater than zero.'
    if (amountNum > 100_000_000) return 'Amount exceeds the accepted maximum.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.paymentDate)) return 'Payment date is required.'
    return null
  })()

  const submit = async (confirmedDuplicate: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        planCode: form.planCode,
        amount: amountNum,
        currency: form.currency,
        mode: form.mode,
        paymentDate: form.paymentDate,
        periodMonths: coveredMonths,
        issueActivationCode: form.issueActivationCode,
        ...(form.issueActivationCode ? { claimWindowDays: Number(form.claimWindowDays || 30) } : {}),
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        ...(confirmedDuplicate ? { confirmDuplicate: true } : {}),
      }
      const res = await gate(() =>
        platformApi<RecordPaymentResult>(`/api/platform/schools/${schoolId}/subscription/payments`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      setResult(res)
      setPhase('result')
      setDuplicateNotice(null)
      onRecorded()
    } catch (e) {
      const msg = errText(e)
      const code = (e as PlatformApiError)?.code
      if (code === 'CONFLICT') {
        // Server duplicate guard — surface the earlier receipt and let
        // the operator explicitly record anyway (genuine second payment).
        setDuplicateNotice(msg)
        setPhase('form')
      } else {
        setError(msg)
        setPhase('form')
      }
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
            Record payment — {schoolName}
          </DialogTitle>
          <DialogDescription>
            {phase === 'form' &&
              'Record what the school actually paid. A verified payment activates or renews the subscription — nothing else does.'}
            {phase === 'review' && 'Review before recording — payments are immutable once saved.'}
            {phase === 'result' && 'Payment recorded.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'result' && result ? (
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
        ) : phase === 'review' ? (
          <div className="space-y-3">
            {/* The review restates everything the record will say. */}
            <dl className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">School</dt>
                <dd className="text-right font-medium text-slate-900">{schoolName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Plan &amp; price</dt>
                <dd className="text-right text-slate-900">
                  {selectedPlan?.name ?? '—'}
                  {suggestedAmount != null && (
                    <span className="block text-[11px] text-slate-500">
                      {registryRow?.billingModel === 'PER_STUDENT' && registryRow?.priceSnapshot != null && registryRow?.licensedStudents != null
                        ? `${money(registryRow.priceSnapshot, form.currency)} per student × ${registryRow.licensedStudents.toLocaleString('en-IN')} licensed students`
                        : money(suggestedAmount, form.currency)}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Billing period covered</dt>
                <dd className="text-right text-slate-900">
                  {coveredMonths} month{coveredMonths === 1 ? '' : 's'} from {fmtDate(form.paymentDate)}
                  {registryRow?.periodEnd && new Date(registryRow.periodEnd) > new Date() && (
                    <span className="block text-[11px] text-slate-500">
                      extends the current period (valid until {fmtDate(registryRow.periodEnd)})
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Amount paid</dt>
                <dd className="text-right font-semibold tabular-nums text-slate-900">
                  {moneyExact(amountValid ? amountNum : null, form.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Payment date / method</dt>
                <dd className="text-right text-slate-900">
                  {fmtDate(form.paymentDate)} · {form.mode.replace(/_/g, ' ').toLowerCase()}
                </dd>
              </div>
              {form.reference.trim() && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="text-right font-mono text-xs text-slate-700">{form.reference.trim()}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Activation</dt>
                <dd className="text-right text-slate-900">
                  {form.issueActivationCode ? (
                    <>
                      By activation code
                      <span className="block text-[11px] text-slate-500">
                        recorded now, activates when the school redeems the code
                      </span>
                    </>
                  ) : (
                    <>
                      Immediately
                      <span className="block text-[11px] text-slate-500">subscription becomes active on submission</span>
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {lookAlike && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <span className="font-semibold">Possible duplicate:</span> a payment of{' '}
                {moneyExact(lookAlike.amount, lookAlike.currency)} by {lookAlike.mode.replace(/_/g, ' ').toLowerCase()}{' '}
                on {fmtDate(lookAlike.paymentDate)} is already on the ledger
                {lookAlike.receiptNo ? ` (receipt ${lookAlike.receiptNo})` : ''}. Continue only if this is genuinely a
                separate payment.
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPhase('form')} className="border-slate-300">
                Back to edit
              </Button>
              <Button
                onClick={() => void submit(lookAlike != null)}
                disabled={busy}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {form.issueActivationCode ? 'Record + issue code' : 'Record payment'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Context: what this payment is FOR. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p>
                <span className="font-semibold text-slate-800">{schoolName}</span> pays SCHOLARIO for platform access.
                Current terms:{' '}
                {registryRow?.planDef?.name ?? registryRow?.planCode ?? 'no plan linked yet'} ·{' '}
                {modelLabel(registryRow?.billingModel)}
                {registryRow?.priceSnapshot != null && (
                  <> · {money(registryRow.priceSnapshot, registryRow.currencySnapshot ?? 'INR')}</>
                )}
                {registryRow?.billingModel === 'PER_STUDENT' &&
                  registryRow?.licensedStudents != null &&
                  registryRow?.priceSnapshot != null && (
                    <span className="block mt-0.5">
                      = {money(registryRow.priceSnapshot * registryRow.licensedStudents, registryRow.currencySnapshot ?? 'INR')}{' '}
                      per year ({money(registryRow.priceSnapshot, registryRow.currencySnapshot ?? 'INR')} ×{' '}
                      {registryRow.licensedStudents.toLocaleString('en-IN')} licensed students)
                    </span>
                  )}
              </p>
            </div>

            {/* Plan */}
            <div>
              <Label className="text-xs" htmlFor="pay-plan">
                Plan this payment is for
              </Label>
              {plansError ? (
                <div
                  role="alert"
                  className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                >
                  <p className="min-w-0 text-xs text-red-700">Plans could not be loaded — {plansError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetryPlans}
                    disabled={plansLoading}
                    className="h-8 shrink-0 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Retry
                  </Button>
                </div>
              ) : (
                <Select value={form.planCode} onValueChange={(v) => setForm((f) => ({ ...f, planCode: v }))} disabled={plansLoading}>
                  <SelectTrigger id="pay-plan" className="bg-white" aria-label="Plan">
                    <SelectValue placeholder={plansLoading ? 'Loading plans…' : 'Select plan…'} />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {offlinePlans.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name} — {money(p.interval === 'MONTHLY' ? p.priceMonthly : p.priceAnnual, p.currency)} /{' '}
                        {p.interval === 'MONTHLY' ? 'month' : 'year'}
                      </SelectItem>
                    ))}
                    {offlinePlans.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-slate-500">
                        No active offline-enabled school plans configured — create plans in the subscription console
                        first.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Amount / currency / date */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs" htmlFor="pay-amount">
                  Amount paid
                </Label>
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') }))}
                  className="bg-white"
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="pay-currency">
                  Currency
                </Label>
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger id="pay-currency" className="bg-white" aria-label="Currency">
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
                <Label className="text-xs" htmlFor="pay-date">
                  Payment date
                </Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className="bg-white"
                />
              </div>
            </div>

            {/* Mode + reference */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="pay-mode">
                  Payment method
                </Label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
                  <SelectTrigger id="pay-mode" className="bg-white" aria-label="Payment method">
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
              <div>
                <Label className="text-xs" htmlFor="pay-reference">
                  Reference / receipt no.
                </Label>
                <Input
                  id="pay-reference"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="UTR / cheque no. (optional)"
                  className="bg-white"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs" htmlFor="pay-notes">
                Notes (audited)
              </Label>
              <Textarea
                id="pay-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Audit note (optional)"
                className="bg-white"
              />
            </div>

            {/* Activation mode */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  Activate by activation code
                </div>
                <p className="text-xs text-slate-500">
                  Off: the subscription activates the moment this verified payment is recorded. On: hand the school a
                  one-time code — the payment is recorded now, activation happens when they redeem it.
                </p>
              </div>
              <Switch
                checked={form.issueActivationCode}
                onCheckedChange={(v) => setForm((f) => ({ ...f, issueActivationCode: v }))}
                aria-label="Activate by activation code"
              />
            </div>
            {form.issueActivationCode && (
              <div>
                <Label className="text-xs" htmlFor="pay-window">
                  Claim window (days the code can be redeemed)
                </Label>
                <Input
                  id="pay-window"
                  type="number"
                  min="1"
                  max="365"
                  value={form.claimWindowDays}
                  onChange={(e) => setForm((f) => ({ ...f, claimWindowDays: e.target.value }))}
                  className="bg-white"
                />
              </div>
            )}

            {/* Client-side look-alike warning (the server re-checks). */}
            {lookAlike && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <span className="font-semibold">Possible duplicate:</span> {moneyExact(lookAlike.amount, lookAlike.currency)}{' '}
                by {lookAlike.mode.replace(/_/g, ' ').toLowerCase()} on {fmtDate(lookAlike.paymentDate)} is already on
                the ledger{lookAlike.receiptNo ? ` (receipt ${lookAlike.receiptNo})` : ''}.
              </div>
            )}

            {/* Server-side duplicate refusal — explicit confirmation path. */}
            {duplicateNotice && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <p>{duplicateNotice}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void submit(true)}
                  className="h-8 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                >
                  {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Record anyway — this is a separate payment
                </Button>
              </div>
            )}

            {validationProblem && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {validationProblem}
              </p>
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
              <Button
                onClick={() => {
                  if (validationProblem) {
                    setError(validationProblem)
                    return
                  }
                  setError(null)
                  setPhase('review')
                }}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                Review payment
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Summary header — the current subscription at a glance ────────────────

/**
 * The prominent top card: state in plain language, the plan and price,
 * validity and renewal posture — plus the page's primary action (record
 * a payment). This is the answer to "where do I see what's going on".
 * Exported for the schema-pending render regression test.
 */
export function SummaryHeader({
  data,
  registryRow,
  onRecordPayment,
}: {
  data: SubscriptionResponse
  registryRow: RegistryRow | null
  onRecordPayment: () => void
}) {
  const ent = data.entitlement
  const sub = data.subscription
  const model = registryRow?.billingModel ?? 'SCHOOL_WIDE'
  const currency = registryRow?.currencySnapshot ?? 'INR'
  const unitPrice = registryRow?.priceSnapshot ?? null
  const licensed = registryRow?.licensedStudents ?? null

  const renewalLine = (() => {
    if (ent.state === 'ACTIVE') {
      return sub?.periodEnd ? `Renews by ${fmtDate(sub.periodEnd)}` : 'No expiry set — active until changed'
    }
    if (ent.renewalRequired) return 'Renewal required now'
    return null
  })()

  return (
    <section
      aria-label="Current subscription summary"
      className="rounded-xl border border-slate-200 bg-gradient-to-br from-teal-50/70 via-white to-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <EntitlementStateBadge state={ent.state} />
            {registryRow?.planDef?.name && (
              <Badge variant="outline" className="normal-case border-slate-200 bg-white text-slate-700">
                {registryRow.planDef.name}
              </Badge>
            )}
            {sub?.overrideStatus && (
              <Badge variant="outline" className="normal-case border-orange-200 bg-orange-50 text-orange-700">
                manual override: {STATE_PLAIN[sub.overrideStatus] ?? sub.overrideStatus}
              </Badge>
            )}
          </div>
          {/* One-line commercial reality: model + price + math. */}
          <p className="text-sm text-slate-700">
            {modelLabel(registryRow?.billingModel)}
            {unitPrice != null && (
              <>
                {' — '}
                {model === 'PER_STUDENT' ? (
                  <>
                    {money(unitPrice, currency)} per student / year
                    {licensed != null && (
                      <span className="text-slate-500">
                        {' '}
                        × {licensed.toLocaleString('en-IN')} licensed ={' '}
                        <span className="font-semibold text-slate-900">
                          {money(unitPrice * licensed, currency)}
                        </span>{' '}
                        / year
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-slate-900">{money(unitPrice, currency)}</span>
                    {(registryRow?.interval ?? '') === 'MONTHLY' ? ' / month' : (registryRow?.interval ?? '') === 'ANNUAL' ? ' / year' : ''}
                  </>
                )}
              </>
            )}
            {unitPrice == null && (
              <span className="text-slate-500"> — no price agreed yet (set it in Step 1)</span>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {sub?.periodEnd
              ? `Valid until ${fmtDate(sub.periodEnd)}${renewalLine ? ' · ' + renewalLine : ''}`
              : 'No paid period recorded yet — activate by recording the first payment (Step 2).'}
            {ent.message && <span className="block pt-1 text-slate-600">{ent.message}</span>}
          </p>
        </div>
        <Button
          onClick={onRecordPayment}
          className="h-10 shrink-0 bg-teal-600 px-4 text-sm font-semibold hover:bg-teal-700 text-white focus-ring"
        >
          <Wallet className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {data.payments.length === 0 ? 'Record payment & activate' : 'Record payment / renew'}
        </Button>
      </div>
    </section>
  )
}

// ── Step 1 body — the terms table + advanced drawer ──────────────────────

/** One dl entry with an optional help line under the value. */
function Term({ label, value, help }: { label: string; value: React.ReactNode; help?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
      {help && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{help}</p>}
    </div>
  )
}

/**
 * Advanced controls, collapsed by default: the legacy display marker and
 * the manual entitlement override. Both kept (existing capabilities),
 * both explained — neither is part of the normal workflow.
 */
function AdvancedControls({
  schoolId,
  legacyPlan,
  overrideStatus,
  gate,
  onReload,
}: {
  schoolId: string
  legacyPlan: string
  overrideStatus: string | null
  gate: GateFn
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [legacyPlanChoice, setLegacyPlanChoice] = useState(legacyPlan)
  const [planReason, setPlanReason] = useState('')
  const [planBusy, setPlanBusy] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideState, setOverrideState] = useState<string>('clear')
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideBusy, setOverrideBusy] = useState(false)

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
      toast.success(`Display label set to ${res.plan} (audited).`)
      setPlanReason('')
      onReload()
    } catch (e) {
      toast.error('Label change failed', { description: errText(e) })
    } finally {
      setPlanBusy(false)
    }
  }

  const applyOverride = async () => {
    setOverrideBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; overrideStatus: string | null }>(`/api/platform/schools/${schoolId}/subscription`, {
          method: 'PATCH',
          body: JSON.stringify({
            overrideStatus: overrideState === 'clear' ? null : overrideState,
            reason: overrideReason.trim() || undefined,
          }),
        }),
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
      setOverrideBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          Advanced — display label &amp; manual override
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-200 px-3 py-3">
          {/* Legacy plan marker */}
          <div>
            <p className="text-[11px] leading-snug text-slate-500">
              The <span className="font-semibold text-slate-700">display label</span> (FREE / STANDARD / PRO /
              ENTERPRISE) is shown to the school in its portal. It is a label only — billing follows the plan and
              price above, and access follows the payment state. Changing it never activates anything.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="min-w-[160px]">
                <Label className="text-xs" htmlFor="legacy-plan">
                  Display label
                </Label>
                <Select value={legacyPlanChoice} onValueChange={setLegacyPlanChoice}>
                  <SelectTrigger id="legacy-plan" className="h-9 bg-white">
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
                  placeholder="Why is the label changing?"
                  className="h-9 bg-white"
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
                Save label
              </Button>
            </div>
          </div>

          {/* Manual entitlement override */}
          <div className="border-t border-slate-200 pt-3">
            <p className="text-[11px] leading-snug text-slate-500">
              A <span className="font-semibold text-slate-700">manual override</span> forces the school&apos;s access
              state (active, restricted…) regardless of the paid period — a platform decision like a goodwill
              extension. It lasts until cleared, is step-up gated, audited, and never changes payment history.
              Current: {overrideStatus ? STATE_PLAIN[overrideStatus] ?? overrideStatus : 'none — the paid period decides'}.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOverrideOpen(true)}
              className="mt-2 h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {overrideStatus ? 'Change override…' : 'Set override…'}
            </Button>
          </div>
        </div>
      )}

      {/* Override dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Manual access override</DialogTitle>
            <DialogDescription>
              Forces the school&apos;s access state regardless of the paid period. School lifecycle (activate/suspend)
              is never touched here. Applies immediately, lasts until cleared, step-up gated and audited with your
              reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Current override</Label>
              <p className="text-sm text-slate-700">
                {overrideStatus ? STATE_PLAIN[overrideStatus] ?? overrideStatus : 'none — the paid period decides'}
              </p>
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
                  <SelectItem value="clear">Clear — the paid period decides</SelectItem>
                  {OVERRIDE_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      Force {STATE_PLAIN[s] ?? s}
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
                disabled={overrideBusy}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {overrideBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Apply override
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Step 1 · the plan & pricing panel (exported for tests) ───────────────

/**
 * PlanPricingPanel — the Step 1 body: the terms table (plan / model /
 * price / licensed students / period / start / validity / renewal), the
 * spelled-out per-student calculation (or the fixed-fee explanation), the
 * empty state with a direct next action, and the advanced drawer.
 *
 * Exported for the schema-pending render regression test — the pending
 * wire shape (billingModel / planCode / priceSnapshot all NULL) must
 * render honest em-dashes, never crash and never fabricate values.
 */
export function PlanPricingPanel({
  schoolId,
  data,
  registryRow,
  legacyPlan,
  onEditTerms,
  gate,
  onReload,
}: {
  schoolId: string
  data: SubscriptionResponse
  registryRow: RegistryRow | null
  legacyPlan: string
  onEditTerms: () => void
  gate: GateFn
  onReload: () => void
}) {
  const registry = registryRow
  const currency = registry?.currencySnapshot ?? 'INR'
  const billingModel = registry?.billingModel ?? null
  const isPerStudent = billingModel === 'PER_STUDENT'

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Term
          label="Plan"
          value={
            registry?.planDef ? (
              <>
                {registry.planDef.name} <span className="font-mono text-[11px] text-slate-500">{registry.planCode}</span>
              </>
            ) : registry?.planCode ? (
              <span className="font-mono text-[13px]">{registry.planCode}</span>
            ) : (
              <span className="text-slate-500">not linked yet</span>
            )
          }
          help="The product tier — a name, not a price."
        />
        <Term label="Billing model" value={modelLabel(billingModel)} help="How the price is calculated." />
        <Term
          label="Price charged to this school"
          value={registry?.priceSnapshot != null ? money(registry.priceSnapshot, currency) : '—'}
          help={isPerStudent ? 'Per student, per year (an agreed price can differ from the catalogue).' : 'The agreed fee for the billing period.'}
        />
        {isPerStudent && (
          <Term
            label="Licensed student limit"
            value={registry?.licensedStudents != null ? `${registry.licensedStudents.toLocaleString('en-IN')} students` : '—'}
            help="The quantity the per-student price multiplies."
          />
        )}
        <Term
          label="Billing period"
          value={(registry?.interval ?? '').toLowerCase() || '—'}
          help={isPerStudent ? 'Per-student billing is yearly only.' : 'How often the school is billed.'}
        />
        <Term label="Subscription start date" value={fmtDate(registry?.periodStart ?? data.subscription?.periodStart ?? null)} />
        <Term
          label="Valid until"
          value={data.subscription?.periodEnd ? fmtDate(data.subscription.periodEnd) : 'No paid period yet'}
          help="Moves only when a verified payment is recorded."
        />
        <Term
          label="Renewal status"
          value={
            <span className={data.entitlement.renewalRequired ? 'font-medium text-amber-700' : 'text-slate-900'}>
              {data.entitlement.renewalRequired ? 'Renewal required' : 'Up to date'}
            </span>
          }
        />
      </dl>

      {/* The per-student calculation, spelled out. */}
      {isPerStudent && registry?.priceSnapshot != null && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-semibold text-slate-700">Annual amount calculation</p>
          <p className="mt-1 text-slate-700">
            {money(registry.priceSnapshot, currency)} per student / year
            {registry?.licensedStudents != null && (
              <>
                {' × '}
                {registry.licensedStudents.toLocaleString('en-IN')} licensed students ={' '}
                <span className="font-semibold text-slate-900">
                  {money(registry.priceSnapshot * registry.licensedStudents, currency)}
                </span>{' '}
                per year
              </>
            )}
            {registry?.licensedStudents == null && (
              <span className="text-slate-500"> — set the licensed student count to see the total</span>
            )}
          </p>
        </div>
      )}

      {/* Fixed-fee explanation when not per-student. */}
      {!isPerStudent && registry?.priceSnapshot != null && (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Fixed school fee: one price for the whole school regardless of size — every eligible member is covered by
          this subscription. (Per-student billing is a separate model; switch it above if the school should be
          billed per licensed student.)
        </p>
      )}

      {/* Empty state with a direct next action. */}
      {registry?.priceSnapshot == null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3">
          <p className="text-xs text-slate-600">
            No commercial terms recorded yet — pricing was not configured when this school was created. Set the plan,
            billing model and price now; it takes effect with the first recorded payment.
          </p>
          <Button size="sm" onClick={onEditTerms} className="h-8 bg-teal-600 hover:bg-teal-700 text-white">
            Set plan &amp; pricing
          </Button>
        </div>
      )}

      <AdvancedControls
        schoolId={schoolId}
        legacyPlan={legacyPlan}
        overrideStatus={data.subscription?.overrideStatus ?? null}
        gate={gate}
        onReload={onReload}
      />
    </>
  )
}

// ── Step 3 · codes ───────────────────────────────────────────────────────

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
    <div>
      {/* How codes work — the plain-language contract. */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
        <p>
          <span className="font-semibold text-slate-800">How codes work:</span> a one-time activation code unlocks a
          subscription or a student&apos;s access when redeemed in the school portal. The code is shown{' '}
          <span className="font-semibold">only once</span> at issuance — only its hash is stored afterwards, so copy
          it and deliver it to the principal (or student) out-of-band. Codes expire if not redeemed within their claim
          window and can be revoked or reissued here.
        </p>
        <p className="mt-1">
          <span className="font-semibold text-slate-800">Where codes come from:</span> school-subscription codes are
          issued while recording a payment (Step 2 — &ldquo;activate by activation code&rdquo;); student codes while
          assigning a student entitlement below. There is deliberately no &ldquo;free-standing&rdquo; school code — a
          code always delivers something that was paid for or explicitly granted.
        </p>
        <p className="mt-1">
          <span className="font-semibold text-slate-800">Who can hold one:</span> school subscriptions and students.
          Codes for teachers/staff are <span className="font-semibold">not supported</span> — the entitlement model has
          no staff-scope code, and student codes do not work for staff.
        </p>
      </div>

      <div className="overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">Unlocks</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Validity</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Redeemed</th>
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
                  {c.scope === 'SCHOOL_SUBSCRIPTION' ? 'School subscription' : 'One student\u2019s access'}
                  {c.student && <p className="text-[10px] text-slate-400">{c.student.user?.name ?? c.student.user?.email}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {c.planCode ?? '—'}
                  {c.interval && <p className="text-[10px] text-slate-400">{c.interval.toLowerCase()}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                  {c.validityMonths ? `${c.validityMonths}mo` : '—'}
                  {c.claimWindowDays && <p className="text-[10px] text-slate-400">redeem within {c.claimWindowDays}d</p>}
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
                  No activation codes yet — issue one with a payment (Step 2) or when assigning a student entitlement
                  below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          {filtered.length} of {total} code{total === 1 ? '' : 's'} on record for this school
          {total > codes.length && <> — showing the first {codes.length}; more exist beyond this view</>} · guessing is
          rate-limited server-side (5 attempts / 15 min)
        </p>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px] bg-white text-xs" aria-label="Filter codes by status">
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
            <SelectTrigger className="h-8 w-[150px] bg-white text-xs" aria-label="Filter codes by what they unlock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="ALL">Everything</SelectItem>
              <SelectItem value="SCHOOL_SUBSCRIPTION">School subscription</SelectItem>
              <SelectItem value="STUDENT_ENTITLEMENT">Student access</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {act && (
        <RevokeReissueDialog
          code={act.code}
          action={act.action}
          gate={gate}
          onClose={() => setAct(null)}
          onDone={onChanged}
        />
      )}
    </div>
  )
}

// ── Step 3 · student entitlements ────────────────────────────────────────

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
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[11px] leading-relaxed text-slate-500">
          {covered
            ? 'Billing is a fixed school fee — every student is covered by the school\u2019s subscription automatically. Nothing to assign here unless the billing model changes to per-student.'
            : 'Billing is per student — each student needs their own access: assign it (records the payment, then activates directly or issues the student a one-time code).'}
        </p>
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
      <div className="overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Class</th>
              <th className="px-3 py-2 font-semibold">Access</th>
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
                      {covered ? (
                        <Badge variant="outline" className="normal-case border-teal-200 bg-teal-50 text-teal-700">
                          covered by school
                        </Badge>
                      ) : (
                        <SharedStateBadge state={s.entitlement.computedState} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                      {covered ? '—' : dateStr(s.entitlement.validityEnd ?? null)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{covered ? '—' : s.entitlement.source ?? '—'}</td>
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
                          {covered ? 'Grant' : 'Assign'}
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
    </div>
  )
}

// ── Step 4 · ledger + recent changes ─────────────────────────────────────

/** The subscription GET serves at most this many ledger rows per load
 *  (server-side `take: 100`). When a full page comes back we cannot
 *  know whether older records exist — the footer must say so honestly
 *  instead of silently looking complete. */
const LEDGER_PAGE_SIZE = 100

function LedgerCard({ payments }: { payments: PaymentRow[] }) {
  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        Every payment this school has made to <span className="font-semibold text-slate-700">SCHOLARIO</span> for
        platform access — an immutable financial record; receipts are never rewritten. (The school&apos;s own fee
        collection from its students lives in the Fee gateway tab.)
      </p>
      <div className="overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Receipt</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Method</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Period covered</th>
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
                  {/* Exact-as-stored money: amounts live in Decimal(12,2),
                      so paise render exactly as recorded — never rounded
                      away by a maximumFractionDigits: 0 format. */}
                  {moneyExact(p.amount, p.currency)}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{p.mode.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">{fmtDate(p.paymentDate)}</td>
                <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                  {p.periodMonths} month{p.periodMonths === 1 ? '' : 's'}
                  {p.periodEndAfter && <p className="text-[10px] text-slate-400">until {dateStr(p.periodEndAfter)}</p>}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{p.recordedBy?.name ?? '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No payments recorded yet — the first verified payment activates the subscription (Step 2).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* HONEST TRUNCATION — a full page (take: 100) means older records
          may exist beyond this view; the note says so instead of letting
          the table silently look complete. */}
      {payments.length >= LEDGER_PAGE_SIZE && (
        <p className="mt-2 text-[11px] text-slate-400" role="note">
          Showing the first {LEDGER_PAGE_SIZE} recorded payments — older records may exist beyond this view.
        </p>
      )}
    </div>
  )
}

/** Plain-language rendering of audit actions (recent changes feed). */
function auditActionPlain(action: string): string {
  if (action === 'platform.billing.terms_updated') return 'Plan & pricing updated'
  if (action === 'platform.billing.payment_recorded') return 'Payment recorded'
  if (action === 'platform.billing.subscription_override') return 'Manual override changed'
  if (action === 'platform.billing.plan_created') return 'Plan created'
  if (action === 'platform.billing.plan_updated') return 'Plan updated'
  if (action === 'platform.billing.config_updated') return 'Subscription configuration updated'
  return action.replace(/^platform\.billing\./, '').replace(/_/g, ' ')
}

function RecentChangesCard({ schoolId }: { schoolId: string }) {
  const [events, setEvents] = useState<AuditEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setForbidden(false)
    try {
      const d = await platformApi<{ events: AuditEventRow[] }>(
        `/api/platform/audit?schoolId=${schoolId}&category=subscription&page=1`,
      )
      setEvents(d.events.slice(0, 8))
    } catch (e) {
      const code = (e as PlatformApiError)?.code
      if (code === 'FORBIDDEN') {
        setForbidden(true)
      } else {
        setError(errMessage(e))
      }
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">
        Recent changes need the audit permission — open the Support &amp; audit tab for the full history.
      </p>
    )
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
        <p className="min-w-0 text-xs text-red-700">Could not load recent changes — {error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()} className="h-8 border-slate-300 bg-white">
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }
  if (!events) {
    return <Skeleton className="h-24 w-full rounded-lg" />
  }
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">
        No subscription changes recorded for this school yet.
      </p>
    )
  }
  return (
    <ol className="space-y-2" aria-label="Recent subscription changes">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2.5 text-xs">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-slate-800">
              <span className="font-medium">{auditActionPlain(e.action)}</span>
              {e.admin?.name && <span className="text-slate-500"> — {e.admin.name}</span>}
            </p>
            {e.reason && <p className="truncate text-[11px] text-slate-400" title={e.reason}>{e.reason}</p>}
            <p className="text-[10px] text-slate-400">{dateStr(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
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
  const [schemaPending, setSchemaPending] = useState(false)
  const [codes, setCodes] = useState<ActivationCodeRow[]>([])
  const [codesTotal, setCodesTotal] = useState(0)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [billingModel, setBillingModel] = useState('SCHOOL_WIDE')
  const [legacyPlan, setLegacyPlan] = useState('STANDARD')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  // The plan catalogue — ONE fetch feeding the terms dialog, the payment
  // dialog and the summary (the old layout re-fetched per sub-tab).
  // HONEST PLANS LOAD — a failed fetch never masquerades as "no plans
  // exist": both dialogs surface the error with a retry action.
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [plansError, setPlansError] = useState<string | null>(null)
  const [plansLoading, setPlansLoading] = useState(false)

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    setPlansError(null)
    try {
      const d = await platformApi<{ subscriptionSchemaPending?: boolean; plans: PlanRow[] }>(
        '/api/platform/subscriptions/plans',
      )
      setPlans(d.plans)
    } catch (e) {
      // ERROR ≠ EMPTY — clear the list so no stale plan drives the
      // price auto-fill, and keep the reason visible with a retry.
      setPlans([])
      setPlansError(errText(e))
    } finally {
      setPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const load = useCallback(async () => {
    // Stale-while-revalidate: the first load shows the skeleton; later
    // refreshes keep the current content mounted (an open one-time-code
    // result dialog must NEVER unmount mid-display).
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const [sub, reg, cod] = await Promise.all([
        platformApi<SubscriptionResponse>(`/api/platform/schools/${schoolId}/subscription`),
        platformApi<{ subscriptionSchemaPending?: boolean; schools: { rows: RegistryRow[] } }>(
          `/api/platform/subscriptions/registry?schoolId=${schoolId}`,
        ),
        platformApi<{ codes: ActivationCodeRow[]; total: number }>(
          `/api/platform/subscriptions/codes?schoolId=${schoolId}&pageSize=100`,
        ),
      ])
      hasDataRef.current = true
      setData(sub)
      setRegistryRow(reg.schools.rows[0] ?? null)
      setSchemaPending(isSubscriptionSchemaPending(reg))
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
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
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

  const registry = registryRow
  const currency = registry?.currencySnapshot ?? 'INR'
  const isPerStudent = (registry?.billingModel ?? 'SCHOOL_WIDE') === 'PER_STUDENT'

  return (
    <div className="space-y-5">
      {/* The guided page heading — one line, plain language. */}
      <div>
        <h2 className="font-display text-base font-bold text-slate-900">Subscription</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          What {data.school.name} pays SCHOLARIO, on what terms, and the access those payments unlock — set pricing
          (1), record payments (2), manage codes &amp; access (3), review history (4).
        </p>
      </div>

      {/* The current subscription at a glance + the primary action. */}
      <SummaryHeader data={data} registryRow={registry} onRecordPayment={() => setPaymentOpen(true)} />

      <BoundaryBanner />

      {/* Schema-pending honesty — the same wire flag the Subscriptions
          page consumes: the registry row exists, but its plan/billing
          fields are unavailable on this database until the owner-gated
          migration is applied (compact banner inside the tab). */}
      {schemaPending && <SubscriptionPendingBanner compact />}

      {/* ── Step 1 — Plan & pricing ── */}
      <StepSection
        step={1}
        id="section-plan-pricing"
        title="Plan & pricing"
        intro="The commercial terms this school is billed under — set them now or renegotiate later; an agreed price alone never activates anything."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTermsOpen(true)}
            className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <Package className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Edit plan &amp; pricing
          </Button>
        }
      >
        <PlanPricingPanel
          schoolId={schoolId}
          data={data}
          registryRow={registry}
          legacyPlan={legacyPlan}
          onEditTerms={() => setTermsOpen(true)}
          gate={gate}
          onReload={() => void load()}
        />
      </StepSection>

      {/* ── Step 2 — Record payment / activate / renew ── */}
      <StepSection
        step={2}
        id="section-record-payment"
        title="Record payment · activate or renew"
        intro="Only a verified payment recorded here activates or renews the subscription — a plan selection or label never does. Review before saving; payments are immutable."
        actions={
          <Button
            onClick={() => setPaymentOpen(true)}
            className="h-9 bg-teal-600 hover:bg-teal-700 text-white focus-ring"
          >
            <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Record payment…
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Payments on record</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{data.payments.length}</p>
            <p className="text-[11px] text-slate-500">receipts in the immutable ledger (Step 4)</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current state</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{STATE_PLAIN[data.entitlement.state] ?? data.entitlement.state}</p>
            <p className="text-[11px] text-slate-500">
              {data.subscription?.periodEnd ? `valid until ${fmtDate(data.subscription.periodEnd)}` : 'no paid period yet'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Next payment should be</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {registry?.priceSnapshot != null
                ? isPerStudent && registry?.licensedStudents != null
                  ? money(registry.priceSnapshot * registry.licensedStudents, currency)
                  : money(registry.priceSnapshot, currency)
                : '—'}
            </p>
            <p className="text-[11px] text-slate-500">
              {registry?.priceSnapshot != null
                ? isPerStudent && registry?.licensedStudents != null
                  ? `${money(registry.priceSnapshot, currency)} × ${registry.licensedStudents.toLocaleString('en-IN')} licensed students`
                  : 'the agreed price for one billing period'
                : 'set the price in Step 1 first'}
            </p>
          </div>
        </div>
      </StepSection>

      {/* ── Step 3 — Access & activation codes ── */}
      <StepSection
        step={3}
        id="section-access-codes"
        title="Access & activation codes"
        intro="One-time codes unlock subscriptions or a student's access when redeemed in the school portal — issued with a payment (school) or an entitlement assignment (student)."
      >
        <CodesCard codes={codes} total={codesTotal} gate={gate} onChanged={() => void load()} />
        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-display text-sm font-bold text-slate-900">Student entitlements</h4>
          <p className="mt-0.5 mb-3 text-[11px] text-slate-500">
            Per-student access under per-student billing — each student&apos;s own subscription to the student modules.
          </p>
          <StudentsCard
            students={students}
            billingModel={billingModel}
            loading={studentsLoading}
            onSearch={(q) => void loadStudents(q)}
            onChanged={() => void load()}
          />
        </div>
      </StepSection>

      {/* ── Step 4 — History & status ── */}
      <StepSection
        step={4}
        id="section-history-status"
        title="History & status"
        intro="The immutable payment ledger — what this school paid SCHOLARIO — and the audit trail of who changed what."
      >
        <LedgerCard payments={data.payments} />
        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-display text-sm font-bold text-slate-900">Recent changes</h4>
          <p className="mt-0.5 mb-3 text-[11px] text-slate-500">
            Who changed this school&apos;s plan, pricing, payments or overrides — from the platform audit trail.
          </p>
          <RecentChangesCard schoolId={schoolId} />
        </div>
      </StepSection>

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

      {/* Dialogs (kept mounted at this level so a reload never unmounts a
          one-time code display mid-flight). */}
      <TermsDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        schoolId={schoolId}
        schoolName={data.school.name}
        registryRow={registry}
        plans={plans}
        plansLoading={plansLoading}
        plansError={plansError}
        onRetryPlans={() => void loadPlans()}
        gate={gate}
        onSaved={() => void load()}
      />
      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        schoolId={schoolId}
        schoolName={data.school.name}
        registryRow={registry}
        plans={plans}
        plansLoading={plansLoading}
        plansError={plansError}
        onRetryPlans={() => void loadPlans()}
        recentPayments={data.payments}
        gate={gate}
        onRecorded={() => void load()}
      />

      {/* Step-up dialog mount (dormant while platform TOTP is stood
          down; renders the MFA prompt when the 10-minute window is
          stale). */}
      {stepUpNode}
    </div>
  )
}
