'use client'

/**
 * fees-collect-payment — Complete collect payment workflow modal.
 *
 * Stages:
 *   1. find     — find student (by name / ID / admission / roll / class / section)
 *   2. review   — see outstanding, select fee head + amount + mode
 *   3. confirm  — review all details, validate, submit
 *   4. success  — payment recorded, receipt available
 *
 * Validation:
 *   - amount > 0
 *   - payment mode active
 *   - reference number required for non-cash modes
 *   - duplicate reference check
 *   - student exists in canonical record
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Wallet, ShieldCheck, CheckCircle2, AlertCircle, ArrowRight,
  ArrowLeft, IndianRupee, Sparkles, Loader2,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useFeeStore, useFeeData, studentBillableHeads, type BillableHeadOption, type PaymentMode } from '@/lib/store/fee-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { formatINR } from '@/lib/format'
import { ModeIcon, modeAccent, FeeStatusBadge } from './fees-shared'
import { FeeReceiptA5Preview, printReceiptA5, downloadReceiptA5 } from './fee-receipt-a5'
import { MoneyInput } from './money-input'
// SaaS-STAGE-2A (Task 7-b) — school-level online-payments gate. When the
// ACTIVE school's platform configuration disables fee_online_payments,
// every collection persists through the OFFLINE /api/fees/transactions
// branch (manual collection semantics) regardless of mode — the gateway
// order flow is never touched. The gateway remains a CHANNEL: payment
// MODES (UPI/Card/Net Banking chips) stay selectable as before.
import { useFeatureGate } from '@/lib/tenant/store'

type Stage = 'find' | 'review' | 'confirm' | 'processing' | 'success' | 'failed'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selected student (from Pending Dues / Student Accounts). */
  preselectStudentId?: string
  /** Called when a payment is successfully recorded. */
  onRecorded?: () => void
}

// FEE-POLICY — purposes are derived from each head's ACTUAL frequency.
// G6 (PART 3/13) — the hardcoded CORE_FEE_HEADS list and the fabricated
// Term 1/2/3 PURPOSE_OPTIONS are retired. Billable heads + purposes are
// DERIVED from the selected student's applicable fee policy through the
// canonical `studentBillableHeads` selector (fee-store) — one derivation,
// no parallel vocabulary, no charges without a configured source.
const DEFAULT_FEE_HEAD = 'Tuition'

export function CollectPaymentModal({ open, onOpenChange, preselectStudentId, onRecorded }: Props) {
  const students = useStudentsStore((s) => s.students)
  const recordPayment = useFeeStore((s) => s.recordPayment)
  const paymentModes = useFeeStore((s) => s.paymentModes)
  const receiptSettings = useFeeStore((s) => s.receiptSettings)
  // SaaS-STAGE-2A (Task 7-b) — school-level online-payments gate.
  const gate = useFeatureGate()
  const onlinePayments = gate.isSubFeatureEnabled('fee_online_payments')
  // FEE-POLICY single-source: every rupee shown here derives from the
  // canonical computeAccount pipeline — identical to the Student Accounts
  // tab and the student drawer (no duplicated due-math).
  const { accounts: feeAccounts } = useFeeData()
  const feeAccountMap = useMemo(() => new Map(feeAccounts.map((a) => [a.studentId, a])), [feeAccounts])

  const [stage, setStage] = useState<Stage>('find')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(preselectStudentId ?? null)
  const [amount, setAmount] = useState<number>(0)
  const [purpose, setPurpose] = useState<string>('')
  const [feeHead, setFeeHead] = useState<string>(DEFAULT_FEE_HEAD)
  // ─── WHAT THE PAYMENT IS FOR (Core fee vs Additional charge) ─────
  // When set, the payment is recorded with category='ADDITIONAL' and
  // bound to the charge — it reduces the student's ADDITIONAL outstanding
  // only, never the core fee balance.
  const [additionalChargeId, setAdditionalChargeId] = useState<string | null>(null)
  const [mode, setMode] = useState<PaymentMode>('UPI')
  const [referenceNo, setReferenceNo] = useState('')
  const [meta, setMeta] = useState<{ bankName?: string; chequeNumber?: string; chequeDate?: string; cardLast4?: string; upiId?: string; neftUtr?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [recordedTxnId, setRecordedTxnId] = useState<string | null>(null)
  const [processingStep, setProcessingStep] = useState(0) // 0=validate, 1=record, 2=receipt
  // Guard against double-click re-entry into handleSubmit. The Pay button is
  // also disabled during processing, but the ref is the authoritative guard
  // because React state updates are asynchronous — a fast double-click can
  // fire handleSubmit twice before the `disabled` prop re-renders the button.
  const submittingRef = useRef(false)

  // Reset on open
  useEffect(() => {
    if (open) {
      setStage(preselectStudentId ? 'review' : 'find')
      setSelectedId(preselectStudentId ?? null)
      setAmount(0)
      setPurpose('')
      setFeeHead(DEFAULT_FEE_HEAD)
      setAdditionalChargeId(null)
      setMode('UPI')
      setReferenceNo('')
      setMeta({})
      setError(null)
      setRecordedTxnId(null)
    }
  }, [open, preselectStudentId])

  const selectedStudent = useMemo(() => students.find((s) => s.id === selectedId) ?? null, [students, selectedId])
  const additionalCharges = useFeeStore((s) => s.additionalCharges)
  const allTransactions = useFeeStore((s) => s.transactions)

  // The selected student's ACTIVE additional charges + their paid amounts
  // (from transactions bound to each charge). Mirrors computeAccount's
  // matching logic so the split the Principal sees here is exactly what
  // the student account + reporting will show after recording.
  const myAdditionalCharges = useMemo(() => {
    if (!selectedStudent) return []
    const classKey = selectedStudent.classId
    return additionalCharges
      .filter((c) => {
        if (c.status !== 'Active') return false
        if (c.studentIds && c.studentIds.length > 0) return c.studentIds.includes(selectedStudent.id)
        return classKey != null && c.applicableClassIds.includes(classKey)
      })
      .map((c) => {
        const paid = allTransactions
          .filter((t) => t.additionalChargeId === c.id && t.studentId === selectedStudent.id
            && (t.status === 'Success' || t.status === 'Under Verification'))
          .reduce((sum, t) => sum + t.amount, 0)
        return { charge: c, outstanding: Math.max(0, c.amount - paid) }
      })
  }, [selectedStudent, additionalCharges, allTransactions])
  const additionalOutstanding = myAdditionalCharges.reduce((sum, c) => sum + c.outstanding, 0)
  const selectedCharge = additionalChargeId ? myAdditionalCharges.find((c) => c.charge.id === additionalChargeId) : undefined

  const searchResults = useMemo(() => {
    if (!search) return students.slice(0, 8)
    const q = search.toLowerCase()
    return students.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.admissionNo.toLowerCase().includes(q) ||
      s.rollNo.toLowerCase().includes(q) ||
      s.className.toLowerCase().includes(q) ||
      s.section.toLowerCase().includes(q),
    ).slice(0, 12)
  }, [students, search])

  // Canonical figures for the SELECTED student (outstanding excludes late
  // fee; totalDue includes it — identical to Student Accounts).
  const selectedAccount = selectedStudent
    ? feeAccounts.find((a) => a.studentId === selectedStudent.id)
    : undefined
  const outstanding = selectedAccount?.outstanding ?? 0
  const lateFee = selectedAccount?.lateFee ?? 0
  const totalDue = selectedAccount?.totalDue ?? 0

  // G6 — the selected student's billable heads, derived from THEIR fee
  // policy (structure heads incl. per-student optional opt-ins, per-exam
  // schedule entries, Late Fee when the rule is on). Re-derived whenever
  // the student changes so the dropdown can never offer a charge without
  // a configured source.
  const billableHeads = useMemo<BillableHeadOption[]>(
    () => (selectedStudent ? studentBillableHeads(selectedStudent.id) : []),
    [selectedStudent],
  )
  const purposeForHead = (value: string): string =>
    billableHeads.find((o) => o.value === value)?.purpose ?? billableHeads[0]?.purpose ?? 'Fee payment'

  // Keep the selected head valid for THIS student: when the student
  // changes (or the derived list first becomes available), fall back to
  // Tuition if present, else the first billable option.
  useEffect(() => {
    if (billableHeads.length === 0) return
    const current = billableHeads.find((o) => o.value === feeHead)
    if (!current) {
      const fallback = billableHeads.find((o) => o.value === DEFAULT_FEE_HEAD) ?? billableHeads[0]
      setFeeHead(fallback.value)
      setPurpose(fallback.purpose)
    } else if (!purpose) {
      setPurpose(current.purpose)
    }
    // billableHeads is the driver; feeHead/purpose are intentionally read
    // once per derivation (a stale-closure re-run would clobber user picks).
  }, [billableHeads])

  const handleSubmit = () => {
    // Idempotency guard: prevent re-entry from a double-click or a stale
    // timer. The button is also disabled during processing, but state updates
    // are async so the ref is the authoritative gate.
    if (submittingRef.current) return
    if (!selectedStudent) return
    setError(null)
    submittingRef.current = true
    setStage('processing')
    setProcessingStep(0)
    // Animate the 3-step indicator so the principal sees live progress,
    // not just a static spinner. Steps: Validate → Record → Generate Receipt.
    const t1 = setTimeout(() => setProcessingStep(1), 450)
    const t2 = setTimeout(() => setProcessingStep(2), 950)
    const t3 = setTimeout(() => {
      const result = recordPayment({
        studentId: selectedStudent.id,
        amount,
        mode,
        purpose,
        feeHead,
        collectedBy: 'Principal',
        // PAY-REWORK-1: the Principal/school office IS the authorised finance
        // role — money confirmed at the counter is verified at record time
        // (any mode). Teacher/self submissions verify through the queue.
        collectorRole: 'principal',
        referenceNo: referenceNo || undefined,
        meta,
        // The payment's financial category — Core fee / Exam fee, or
        // ADDITIONAL when collected against an event-based charge (never
        // silently part of Tuition/regular fee collection).
        ...(selectedCharge ? { additionalChargeId: selectedCharge.charge.id, category: 'ADDITIONAL' as const } : {}),
      })
      submittingRef.current = false
      if (result.success && result.transaction) {
        setRecordedTxnId(result.transaction.id)
        setStage('success')
        onRecorded?.()
        toast.success('Payment recorded', {
          description: `${result.transaction.receiptNo} · ${formatINR(result.transaction.amount)} via ${result.transaction.mode}`,
        })

        // PHASE 9 — DB-backed persistence (additive, fire-and-forget).
        //
        // The Zustand `recordPayment` already wrote to the in-memory store
        // (so all the existing UI surfaces stay in sync). We additionally
        // persist the same transaction to the new Prisma `FeeTransaction`
        // table so the Reconcile & Settlements tab can surface it.
        //
        // For online modes (UPI / Card / Net Banking), we also fire
        // /api/fees/orders to create a Razorpay-style order row with
        // notes.studentId + notes.feeHead so the webhook can later
        // auto-reconcile when the gateway sends payment.captured.
        //
        // SaaS-STAGE-2A (Task 7-b) — SCHOOL GATE: when the ACTIVE school's
        // platform configuration disables fee_online_payments, the gateway
        // order branch is NEVER used — every payment (any mode) persists
        // through the offline /api/fees/transactions branch (manual
        // collection semantics) and the "Gateway order created" toast is
        // suppressed. Modes stay selectable (gateway is a channel).
        //
        // Failures are non-fatal: the in-memory record is the system of
        // record for the UI; the DB write is the audit trail. A failure
        // just means the operator may need to manually reconcile later
        // (which the Reconcile tab supports).
        const isOnline = onlinePayments && (mode === 'UPI' || mode === 'Card' || mode === 'Net Banking')
        const dbPersist = isOnline
          ? fetch('/api/fees/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentId: selectedStudent.id,
                studentName: selectedStudent.name,
                className: selectedStudent.className,
                feeHeadName: feeHead,
                amount,
                method: mode,
                gateway: 'razorpay',
                notes: { studentId: selectedStudent.id, feeHead, studentName: selectedStudent.name },
              }),
            }).then((r) => r.json()).catch(() => null)
          : fetch('/api/fees/transactions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentId: selectedStudent.id,
                studentName: selectedStudent.name,
                className: selectedStudent.className,
                feeHeadName: feeHead,
                amount,
                method: mode,
                receiptNo: result.transaction.receiptNo,
                note: purpose,
              }),
            }).then((r) => r.json()).catch(() => null)
        dbPersist.then((json: any) => {
          // Gateway order toast ONLY on the online branch (suppressed when
          // online payments are disabled for the school).
          if (isOnline && json?.ok && json?.data?.orderId) {
            // For online payments, surface the order id so the principal
            // (or parent) can complete payment via the gateway. In a real
            // deployment, the Razorpay checkout JS would auto-open here.
            toast.info('Gateway order created', {
              description: `Order ${json.data.orderId} · awaiting payment.captured webhook for auto-reconciliation`,
            })
          }
        })
      } else {
        setError(result.error ?? 'Payment failed.')
        setStage('failed')
      }
    }, 1500)
    // Best-effort cleanup if the modal closes mid-flight.
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }

  // "Collect Another" — reset the form to the find stage without closing
  // the modal, so the principal can chain multiple collections efficiently.
  const collectAnother = () => {
    setSelectedId(null)
    setAmount(0)
    setPurpose('')
    setFeeHead(DEFAULT_FEE_HEAD)
    setMode('UPI')
    setReferenceNo('')
    setMeta({})
    setError(null)
    setRecordedTxnId(null)
    setStage('find')
  }

  const recordedTxn = useFeeStore((s) => recordedTxnId ? s.transactions.find((t) => t.id === recordedTxnId) : null)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <Wallet className="h-4 w-4" />
            </div>
            Collect Fee Payment
          </DialogTitle>
          <DialogDescription>
            Stage {stage === 'find' ? 1 : stage === 'review' ? 2 : stage === 'confirm' ? 3 : stage === 'processing' ? 4 : stage === 'success' ? 5 : 4} of 5 — {stageDescription(stage)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1">
          <AnimatePresence mode="wait">
            {/* ─── Stage 1: FIND STUDENT ─── */}
            {stage === 'find' && (
              <motion.div key="find" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3 py-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, ID, admission no, roll no, class, section…"
                    className="pl-8 h-9 text-xs"
                  />
                </div>
                <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                  {searchResults.map((s) => {
                    const out = feeAccountMap.get(s.id)?.outstanding ?? 0
                    return (
                      <button
                        key={s.id}
                        onClick={() => { setSelectedId(s.id); setStage('review'); setAmount(out > 0 ? out : s.feeTotal) }}
                        className="w-full text-left rounded-lg border border-border/60 hover:border-primary/40 hover:bg-muted/30 px-3 py-2 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold shrink-0">
                            {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{s.name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{s.admissionNo} · {s.className}-{s.section} · Roll {s.rollNo}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {out > 0 ? (
                            <>
                              <p className="text-[10px] text-muted-foreground">Outstanding</p>
                              <p className="text-xs font-bold text-rose-600 tabular-nums">{formatINR(out, true)}</p>
                            </>
                          ) : (
                            <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20">Paid</Badge>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {searchResults.length === 0 && (
                    <div className="py-8 text-center">
                      <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">No students match your search.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ─── Stage 2: REVIEW ─── */}
            {stage === 'review' && selectedStudent && (
              <motion.div key="review" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3 py-2">
                <SelectedStudentCard student={selectedStudent} outstanding={outstanding} lateFee={lateFee} totalDue={totalDue} />

                {/* Outstanding split — Core Fees vs Additional Charges.
                    The two are never mixed; the operator always knows what
                    they are collecting against. */}
                {(additionalOutstanding > 0 || myAdditionalCharges.length > 0) && (
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-wider mb-1.5">Outstanding</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Core Fees</p>
                        <p className="text-sm font-bold tabular-nums text-rose-600">{formatINR(totalDue, true)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Additional Charges</p>
                        <p className="text-sm font-bold tabular-nums text-violet-600 dark:text-violet-400">{formatINR(additionalOutstanding, true)}</p>
                        <p className="text-[9px] text-muted-foreground">{myAdditionalCharges.length} charge{myAdditionalCharges.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment For — a core fee head OR an additional charge */}
                {myAdditionalCharges.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Payment For</Label>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAdditionalChargeId(null)
                          setFeeHead(DEFAULT_FEE_HEAD)
                          setPurpose(purposeForHead(DEFAULT_FEE_HEAD))
                          setAmount(outstanding > 0 ? outstanding : 0)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                          !additionalChargeId ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className="text-xs font-medium">School Fees (Core)</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{formatINR(totalDue, true)} due</span>
                      </button>
                      {myAdditionalCharges.map(({ charge, outstanding: chargeOutstanding }) => (
                        <button
                          key={charge.id}
                          type="button"
                          onClick={() => {
                            setAdditionalChargeId(charge.id)
                            setFeeHead(charge.name)
                            setPurpose(`Additional Charge — ${charge.name}`)
                            setAmount(chargeOutstanding)
                          }}
                          className={cn(
                            'w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                            additionalChargeId === charge.id ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/40',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="text-xs font-medium block truncate">{charge.name}</span>
                            <span className="text-[9px] text-muted-foreground">
                              {charge.category} · due {charge.dueDate}
                            </span>
                          </span>
                          <span className={cn(
                            'text-[10px] tabular-nums font-semibold shrink-0',
                            chargeOutstanding > 0 ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600',
                          )}>
                            {chargeOutstanding > 0 ? `${formatINR(chargeOutstanding, true)} due` : 'Paid'}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedCharge && (
                      <p className="text-[10px] text-violet-600 dark:text-violet-300 flex items-center gap-1">
                        <Sparkles className="h-2.5 w-2.5" />
                        Recording against the additional charge — core fee balance stays unchanged.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Amount (₹)</Label>
                    <MoneyInput
                      value={amount || null}
                      onChange={(v) => setAmount(v ?? 0)}
                      className="font-display font-semibold"
                      ariaLabel="Payment amount"
                    />
                    {amount > outstanding && outstanding > 0 && !selectedCharge && (
                      <p className="text-[10px] text-amber-600 flex items-center gap-1">
                        <AlertCircle className="h-2.5 w-2.5" /> Exceeds core outstanding by {formatINR(amount - outstanding, true)}
                      </p>
                    )}
                    {selectedCharge && amount > selectedCharge.outstanding && (
                      <p className="text-[10px] text-amber-600 flex items-center gap-1">
                        <AlertCircle className="h-2.5 w-2.5" /> Exceeds charge outstanding by {formatINR(amount - selectedCharge.outstanding, true)}
                      </p>
                    )}
                  </div>
                  {!selectedCharge && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Fee Head</Label>
                      <select
                        value={feeHead}
                        onChange={(e) => { setFeeHead(e.target.value); setPurpose(purposeForHead(e.target.value)) }}
                        className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs"
                      >
                        {billableHeads.map((h) => (
                          <option key={h.value} value={h.value}>
                            {h.label}{h.kind === 'optional' ? ' (optional)' : h.kind === 'exam' ? ' · per exam' : h.kind === 'late-fee' ? ' · penalty' : ''}
                          </option>
                        ))}
                      </select>
                      {billableHeads.length === 0 && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-2.5 w-2.5" /> No configured fee heads apply to this student.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {!selectedCharge && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Purpose</Label>
                    <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs">
                      {Array.from(new Set([purpose, ...billableHeads.map((h) => h.purpose)])).filter(Boolean).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <Label className="text-[11px] mb-1.5 block">Payment Method</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {paymentModes.filter((m) => m.active).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMode(m.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all',
                          mode === m.id ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', modeAccent(m.id))}>
                          <ModeIcon mode={m.id} className="h-3 w-3" />
                        </span>
                        <span className="text-[10px] font-medium truncate">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mode-specific reference fields */}
                <ModeReferenceFields mode={mode} referenceNo={referenceNo} setReferenceNo={setReferenceNo} meta={meta} setMeta={setMeta} />
              </motion.div>
            )}

            {/* ─── Stage 3: CONFIRM ─── */}
            {stage === 'confirm' && selectedStudent && (
              <motion.div key="confirm" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3 py-2">
                {error && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
                  </div>
                )}
                <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-2">Confirm Payment</p>
                  <div className="space-y-1.5 text-xs">
                    <ConfirmRow label="Student" value={selectedStudent.name} />
                    <ConfirmRow label="Student ID" value={selectedStudent.admissionNo} />
                    <ConfirmRow label="Class" value={`${selectedStudent.className}-${selectedStudent.section}`} />
                    <ConfirmRow label="Fee Head" value={feeHead} />
                    <ConfirmRow label="Purpose" value={purpose} />
                    <ConfirmRow label="Amount" value={formatINR(amount)} bold />
                    <ConfirmRow label="Payment Mode" value={mode} />
                    {referenceNo && <ConfirmRow label="Reference No" value={referenceNo} />}
                    {meta.bankName && <ConfirmRow label="Bank" value={meta.bankName} />}
                    {meta.chequeNumber && <ConfirmRow label="Cheque No" value={meta.chequeNumber} />}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <p className="text-[11px] text-muted-foreground">Receipt will be generated on success.</p>
                </div>
              </motion.div>
            )}

            {/* ─── Stage 4: PROCESSING (multi-step indicator) ─── */}
            {stage === 'processing' && (
              <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-10 text-center">
                <div className="relative">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                    className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-emerald-500/20 border-t-emerald-500"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 text-emerald-500" />
                  </div>
                </div>
                <p className="text-sm font-semibold mt-4">
                  {['Validating payment details…', 'Recording transaction…', 'Generating receipt…'][processingStep]}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatINR(amount)} via {mode} · {selectedStudent?.name}</p>
                {/* Step indicator: 3 dots that fill as processing advances */}
                <div className="flex items-center gap-1.5 mt-4">
                  {['Validate', 'Record', 'Receipt'].map((label, i) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors',
                        i <= processingStep ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted/50 text-muted-foreground/60')}>
                        <div className={cn('h-1.5 w-1.5 rounded-full', i < processingStep ? 'bg-emerald-500' : i === processingStep ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40')} />
                        <span className="text-[9px] font-medium uppercase tracking-wide">{label}</span>
                      </div>
                      {i < 2 && <div className={cn('h-px w-3 transition-colors', i < processingStep ? 'bg-emerald-500/40' : 'bg-border')} />}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-4 flex items-center gap-1.5">
                  <ShieldCheck className="h-3 w-3" /> Do not close this window
                </p>
              </motion.div>
            )}

            {/* ─── Stage 4b: FAILED (retry) ─── */}
            {stage === 'failed' && (
              <motion.div key="failed" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-3 py-2">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 200, delay: 0.05 }}
                  className="flex flex-col items-center text-center py-3"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-lg mb-2">
                    <AlertCircle className="h-8 w-8" />
                  </div>
                  <p className="font-display text-base font-bold text-rose-700 dark:text-rose-400">Payment Not Recorded</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">No money was moved. No receipt was issued.</p>
                </motion.div>
                {error && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
                  </div>
                )}
                <div className="rounded-lg bg-muted/30 border border-border p-2.5 flex items-start gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground">
                    No money was moved. A payment can never be recorded twice by accident —
                    check the Transactions tab before retrying.
                  </p>
                </div>
              </motion.div>
            )}

            {/* ─── Stage 5: SUCCESS + RECEIPT ─── */}
            {stage === 'success' && recordedTxn && (
              <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3 py-2">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                  className="flex flex-col items-center text-center py-3"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg mb-2">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <p className="font-display text-base font-bold text-emerald-700 dark:text-emerald-400">Payment Recorded</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{recordedTxn.receiptNo} · {formatINR(recordedTxn.amount)}</p>
                </motion.div>

                <div className="flex justify-center overflow-x-auto">
                  {/* Canonical dual-copy receipt sheet (spec §14-18):
                      A5 landscape 1 student/page · A4 portrait 2/page.
                      SaaS-STAGE-1: thermal renderer consolidated away. */}
                  <FeeReceiptA5Preview
                    transaction={recordedTxn}
                    settings={receiptSettings}
                    onPrint={() => { printReceiptA5(recordedTxn, receiptSettings); useFeeStore.getState().markReceiptHandled(recordedTxn.id, 'Principal'); toast.success('Print dialog opened') }}
                    onDownload={() => { downloadReceiptA5(recordedTxn, receiptSettings); useFeeStore.getState().markReceiptHandled(recordedTxn.id, 'Principal'); toast.success('Receipt downloaded', { description: `${recordedTxn.receiptNo}.html` }) }}
                  />
                </div>

                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5 flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="text-[10px] text-muted-foreground">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">Payment recorded</p>
                    <p>Student balance, transactions, and reports updated.</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter>
          {stage === 'find' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={() => setStage('find')}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
              <Button
                onClick={() => setStage('confirm')}
                disabled={!amount || amount <= 0}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
              >
                Review <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {stage === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => setStage('review')}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
              <Button
                onClick={handleSubmit}
                disabled={!amount || amount <= 0 || submittingRef.current}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white min-w-[140px]"
              >
                <IndianRupee className="h-3.5 w-3.5" /> Pay {formatINR(amount)}
              </Button>
            </>
          )}
          {stage === 'success' && (
            <>
              <Button variant="outline" onClick={collectAnother}>
                <Wallet className="h-3.5 w-3.5" /> Collect Another
              </Button>
              <Button onClick={() => onOpenChange(false)} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white">
                <CheckCircle2 className="h-3.5 w-3.5" /> Done
              </Button>
            </>
          )}
          {stage === 'failed' && (
            <>
              <Button variant="outline" onClick={() => setStage('review')}><ArrowLeft className="h-3.5 w-3.5" /> Edit Details</Button>
              <Button
                onClick={() => setStage('confirm')}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
              >
                <ArrowRight className="h-3.5 w-3.5" /> Retry Confirm
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function stageDescription(stage: Stage): string {
  switch (stage) {
    case 'find': return 'Find student'
    case 'review': return 'Review outstanding + enter payment'
    case 'confirm': return 'Confirm details'
    case 'processing': return 'Recording payment'
    case 'success': return 'Receipt generated'
    case 'failed': return 'Payment not recorded'
  }
}

function SelectedStudentCard({ student, outstanding, lateFee, totalDue }: { student: ReturnType<typeof useStudentsStore.getState>['students'][0]; outstanding: number; lateFee: number; totalDue: number }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold shrink-0">
            {student.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{student.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{student.admissionNo} · {student.className}-{student.section} · Roll {student.rollNo}</p>
          </div>
        </div>
        <FeeStatusBadge status={student.feeStatus === 'Paid' ? 'Paid' : student.feeStatus === 'Partial' ? 'Partially Paid' : 'Overdue'} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2.5">
        <div className="rounded-md bg-card/60 px-2 py-1.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Outstanding</p>
          <p className="text-sm font-bold text-rose-600 tabular-nums">{formatINR(outstanding, true)}</p>
        </div>
        <div className="rounded-md bg-card/60 px-2 py-1.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Late Fee</p>
          <p className="text-sm font-bold text-amber-600 tabular-nums">{lateFee > 0 ? formatINR(lateFee, true) : '—'}</p>
        </div>
        <div className="rounded-md bg-card/60 px-2 py-1.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Total Due</p>
          <p className="text-sm font-bold tabular-nums">{formatINR(totalDue, true)}</p>
        </div>
      </div>
    </div>
  )
}

function ModeReferenceFields({ mode, referenceNo, setReferenceNo, meta, setMeta }: {
  mode: PaymentMode
  referenceNo: string
  setReferenceNo: (v: string) => void
  meta: { bankName?: string; chequeNumber?: string; chequeDate?: string; cardLast4?: string; upiId?: string; neftUtr?: string }
  setMeta: (m: typeof meta) => void
}) {
  if (mode === 'Cash') {
    return (
      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 flex items-start gap-2">
        <AlertCircle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground">Cash payment will require Principal verification before receipt is issued.</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">Reference No / Transaction ID</Label>
      <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder={mode === 'UPI' ? 'UPI-XXXXXXXXXX' : mode === 'Cheque' ? 'CHQ-XXXX' : mode === 'Card' ? 'CARD-****1234' : 'Reference number'} className="text-xs font-mono" />
      {mode === 'Cheque' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">Bank Name</Label>
            <Input value={meta.bankName ?? ''} onChange={(e) => setMeta({ ...meta, bankName: e.target.value })} placeholder="HDFC / ICICI…" className="text-xs" />
          </div>
          <div>
            <Label className="text-[10px]">Cheque Date</Label>
            <Input type="date" value={meta.chequeDate ?? ''} onChange={(e) => setMeta({ ...meta, chequeDate: e.target.value })} className="text-xs" />
          </div>
        </div>
      )}
    </div>
  )
}

function ConfirmRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(bold && 'font-bold')}>{value}</span>
    </div>
  )
}
