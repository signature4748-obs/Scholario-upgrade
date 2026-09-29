'use client'

/**
 * VerificationWorkspace — the Principal's STAGE 2 of the two-stage fee
 * collection workflow (MASTER TASK §8, §27, §35): a 100% real-DB island
 * inside the (mock-store) Payments tab — the same pattern as the
 * Classes module's Class → Teachers tab and the Exams module's
 * Invigilation tab.
 *
 *   · Pending queue — every class-teacher collection awaiting the
 *     Principal's decision, with the full trace (student, class, fee,
 *     amount, collected by, when, method, reference);
 *   · Verify — inside one DB transaction the payment becomes final:
 *     unique receipt SCH-YYYY-NNNN, student ledger applied, collector
 *     notified. Reject — with a reason; the ledger was never touched;
 *   · Record Direct Payment (§10) — money that arrived directly at the
 *     office: created already VERIFIED with receipt, and the student's
 *     class teacher is notified so they never think the family still
 *     owes it;
 *   · Recent resolved — the audit feed of verified + rejected
 *     collections with receipts.
 *
 * Optimistic rows with revert-on-error, toasts, emerald flash, and the
 * shared FeeReceiptViewer — the SAME receipt document the teacher sees.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck, Ban, Banknote, CheckCircle2, Clock3, Hash,
  Landmark, Loader2, Plus, Receipt, RefreshCw, ShieldCheck, } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { GradientAvatar } from '@/components/shared/ui'
import { formatINR } from '@/lib/format'
import { api, type ApiError } from '@/lib/exams/api-client'
import { cn } from '@/lib/utils'
import { FeeReceiptViewer } from '@/components/shared/fee-collection/receipt-viewer'
import { methodLabel, sourceStory, txnDate, txnStatusMeta } from '@/components/shared/fee-collection/txn-meta'

interface VerificationTxn {
  id: string
  studentId: string | null
  studentName: string | null
  className: string | null
  feeHeadName: string | null
  amount: number
  method: string
  status: string
  source: string | null
  referenceNumber: string | null
  note: string | null
  receiptNo: string | null
  collectedBy: string | null
  collectedAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

interface DirectStudent {
  id: string
  name: string
  rollNo: string | null
  classLabel: string
  openFees: { id: string; title: string; amount: number; paid: number; outstanding: number; dueDate: string | null }[]
}

interface VerificationPayload {
  pending: VerificationTxn[]
  recent: VerificationTxn[]
  stats: { pendingCount: number; pendingAmount: number; verifiedThisMonth: number; verifiedCountThisMonth: number; rejectedThisMonth: number }
  students: DirectStudent[]
}

export function VerificationWorkspace() {
  const [data, setData] = useState<VerificationPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyTxnId, setBusyTxnId] = useState<string | null>(null)
  const [flashTxnId, setFlashTxnId] = useState<string | null>(null)
  const [rejectTxn, setRejectTxn] = useState<VerificationTxn | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectBusy, setRejectBusy] = useState(false)
  const [receiptTxnId, setReceiptTxnId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [directOpen, setDirectOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const payload = await api<VerificationPayload>('/api/fees/verification', { cache: 'no-store' })
      setData(payload)
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Failed to load the verification queue.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = async (txn: VerificationTxn, body: Record<string, unknown>, okTitle: string) => {
    setBusyTxnId(txn.id)
    try {
      await api('/api/fees/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId: txn.id, ...body }),
      })
      toast.success(okTitle, {
        description: `${txn.studentName ?? 'Student'} · ${formatINR(txn.amount)}${body.action === 'verify' ? ' — receipt issued' : ''}`,
      })
      setFlashTxnId(txn.id)
      await load()
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Action failed'
      toast.error('Action failed', { description: msg })
    } finally {
      setBusyTxnId(null)
      window.setTimeout(() => setFlashTxnId(null), 1600)
    }
  }

  const submitReject = async () => {
    if (!rejectTxn) return
    const reason = rejectReason.trim()
    if (!reason) return
    setRejectBusy(true)
    try {
      await api('/api/fees/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId: rejectTxn.id, action: 'reject', reason }),
      })
      toast.success('Payment rejected', {
        description: `${rejectTxn.studentName ?? 'Student'} · ${formatINR(rejectTxn.amount)} — the collector has been notified with your reason.`,
      })
      setRejectTxn(null)
      setRejectReason('')
      setFlashTxnId(rejectTxn.id)
      await load()
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Rejection failed'
      toast.error('Rejection failed', { description: msg })
    } finally {
      setRejectBusy(false)
      window.setTimeout(() => setFlashTxnId(null), 1600)
    }
  }

  const stats = data?.stats
  const pending = data?.pending ?? []
  const recent = data?.recent ?? []

  return (
    <section className="rounded-2xl border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Payment Verification
            {stats && stats.pendingCount > 0 && (
              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                {stats.pendingCount} awaiting you
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Class-teacher collections become final receipts only when you verify them — one canonical
            ledger for every role.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => void load()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setDirectOpen(true)}>
            <Plus className="h-3 w-3" /> Record Direct Payment
          </Button>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {!data && !error && (
          <div className="space-y-2.5">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Stat strip */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat icon={<Clock3 className="h-3.5 w-3.5" />} label="Awaiting verification" value={formatINR(stats!.pendingAmount, true)} sub={`${stats!.pendingCount} collection${stats!.pendingCount === 1 ? '' : 's'}`} tone={stats!.pendingCount > 0 ? 'amber' : 'slate'} />
              <Stat icon={<BadgeCheck className="h-3.5 w-3.5" />} label="Verified this month" value={formatINR(stats!.verifiedThisMonth, true)} sub={`${stats!.verifiedCountThisMonth} payment${stats!.verifiedCountThisMonth === 1 ? '' : 's'}`} tone="emerald" />
              <Stat icon={<Ban className="h-3.5 w-3.5" />} label="Rejected this month" value={String(stats!.rejectedThisMonth)} sub="returned to collectors" tone={stats!.rejectedThisMonth > 0 ? 'rose' : 'slate'} />
              <Stat icon={<Landmark className="h-3.5 w-3.5" />} label="Ledger" value="Canonical" sub="one source of truth" tone="slate" />
            </div>

            {/* Pending queue — desktop table */}
            {pending.length > 0 ? (
              <>
                <div className="hidden overflow-hidden rounded-xl border md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Student</th>
                        <th className="px-3 py-2 font-semibold">Fee</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 font-semibold">Collected by</th>
                        <th className="px-3 py-2 font-semibold">Date · Method</th>
                        <th className="px-3 py-2 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <AnimatePresence initial={false}>
                        {pending.map((t) => (
                          <motion.tr
                            key={t.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: flashTxnId === t.id ? 0 : 1 }}
                            exit={{ opacity: 0, height: 0 }}
                            className={cn('transition-colors hover:bg-muted/40', flashTxnId === t.id && 'bg-emerald-500/10')}
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <GradientAvatar name={t.studentName ?? 'Student'} size="sm" />
                                <div className="min-w-0">
                                  <p className="max-w-[9rem] truncate text-sm font-medium">{t.studentName}</p>
                                  <p className="truncate text-[10px] text-muted-foreground">{t.className ?? '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="max-w-[8rem] truncate px-3 py-2.5 text-xs text-muted-foreground">{t.feeHeadName ?? '—'}</td>
                            <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">{formatINR(t.amount, true)}</td>
                            <td className="px-3 py-2.5">
                              <p className="max-w-[8rem] truncate text-xs font-medium">{t.collectedBy ?? 'Class teacher'}</p>
                              {t.referenceNumber && <p className="font-mono text-[10px] text-muted-foreground">ref {t.referenceNumber}</p>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                              {txnDate(t.collectedAt ?? t.createdAt)} · {methodLabel(t.method)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { setReceiptTxnId(t.id); setReceiptOpen(true) }}>
                                  View
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] hover:bg-emerald-700"
                                  disabled={busyTxnId === t.id}
                                  onClick={() => void act(t, { action: 'verify' }, 'Payment verified')}
                                >
                                  {busyTxnId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                  Verify
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2.5 text-[11px] text-rose-600 hover:text-rose-700"
                                  disabled={busyTxnId === t.id}
                                  onClick={() => { setRejectTxn(t); setRejectReason('') }}
                                >
                                  Reject
                                </Button>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>

                {/* Pending queue — mobile stacked cards */}
                <div className="space-y-2.5 md:hidden">
                  <AnimatePresence initial={false}>
                    {pending.map((t) => (
                      <motion.div
                        key={t.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={cn('rounded-xl border p-3', flashTxnId === t.id && 'border-emerald-500/40 bg-emerald-500/10')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <GradientAvatar name={t.studentName ?? 'Student'} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{t.studentName}</p>
                              <p className="truncate text-[10px] text-muted-foreground">{t.className} · {t.feeHeadName ?? '—'}</p>
                            </div>
                          </div>
                          <p className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(t.amount, true)}</p>
                        </div>
                        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                          {t.collectedBy ?? 'Class teacher'} · {txnDate(t.collectedAt ?? t.createdAt)} · {methodLabel(t.method)}
                        </p>
                        <div className="mt-2.5 flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="h-7 flex-1 px-2 text-[11px]" onClick={() => { setReceiptTxnId(t.id); setReceiptOpen(true) }}>
                            View
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 flex-1 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                            disabled={busyTxnId === t.id}
                            onClick={() => void act(t, { action: 'verify' }, 'Payment verified')}
                          >
                            {busyTxnId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Verify
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 flex-1 px-2 text-[11px] text-rose-600 hover:text-rose-700"
                            disabled={busyTxnId === t.id}
                            onClick={() => { setRejectTxn(t); setRejectReason('') }}
                          >
                            Reject
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  All collected payments are verified. New class-teacher collections will appear here
                  for your decision.
                </p>
              </div>
            )}

            {/* Recent resolved feed */}
            {recent.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recently resolved
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {recent.map((t) => {
                    const meta = txnStatusMeta(t.status)
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border p-2.5 transition-colors',
                          flashTxnId === t.id ? 'border-emerald-500/40 bg-emerald-500/10' : 'bg-card hover:bg-muted/40',
                        )}
                      >
                        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', meta.chip)}>
                          {t.status === 'SUCCESS' ? <BadgeCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {t.studentName} · {formatINR(t.amount, true)}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {t.feeHeadName ?? '—'} · {sourceStory(t)}
                            {t.status === 'SUCCESS' && t.verifiedBy ? ` · verified by ${t.verifiedBy}` : ''}
                            {t.status === 'REJECTED' && t.rejectionReason ? ` · “${t.rejectionReason}”` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {t.receiptNo && <p className="font-mono text-[10px] text-muted-foreground">{t.receiptNo}</p>}
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-0.5" onClick={() => { setReceiptTxnId(t.id); setReceiptOpen(true) }}>
                            <Receipt className="h-2.5 w-2.5" /> {t.status === 'SUCCESS' ? 'Receipt' : 'View'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reject dialog (§35) */}
      <Dialog open={!!rejectTxn} onOpenChange={(o) => { if (!o) { setRejectTxn(null); setRejectReason('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Ban className="h-4.5 w-4.5 text-rose-600" /> Reject payment?
            </DialogTitle>
            <DialogDescription>
              {rejectTxn && (
                <>
                  {formatINR(rejectTxn.amount)} from <strong>{rejectTxn.studentName}</strong> ({rejectTxn.className}),
                  collected by {rejectTxn.collectedBy ?? 'the class teacher'} on {txnDate(rejectTxn.collectedAt)}.
                  The student&rsquo;s fee balance will not change.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="reject-reason">Reason <span className="text-rose-600">*</span></Label>
            <Textarea
              id="reject-reason"
              className="min-h-[72px] text-sm"
              placeholder="e.g. reference number did not match the bank statement"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">The collector sees this reason and can follow up with the family.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setRejectTxn(null); setRejectReason('') }}>Cancel</Button>
            <Button variant="destructive" className="flex-1 gap-1.5" disabled={!rejectReason.trim() || rejectBusy} onClick={() => void submitReject()}>
              {rejectBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
              Reject payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record direct payment dialog (§10) */}
      <RecordDirectDialog
        open={directOpen}
        onOpenChange={setDirectOpen}
        students={data?.students ?? []}
        onDone={async (msg) => { toast.success('Direct payment recorded', { description: msg }); setFlashTxnId('new'); await load(); window.setTimeout(() => setFlashTxnId(null), 1600) }}
      />

      {/* Shared receipt viewer */}
      <FeeReceiptViewer txnId={receiptTxnId} open={receiptOpen} onOpenChange={setReceiptOpen} />
    </section>
  )
}

function RecordDirectDialog({
  open, onOpenChange, students, onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  students: DirectStudent[]
  onDone: (message: string) => Promise<void> | void
}) {
  const eligible = useMemo(() => students.filter((s) => s.openFees.length > 0), [students])
  const [studentId, setStudentId] = useState('')
  const [feeId, setFeeId] = useState('')
  const [amountRaw, setAmountRaw] = useState('')
  const [method, setMethod] = useState('CASH')
  const [source, setSource] = useState('SCHOOL_OFFICE')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setStudentId(''); setFeeId(''); setAmountRaw(''); setReference(''); setNotes(''); setMethod('CASH'); setSource('SCHOOL_OFFICE'); setError(null) }
  }, [open])

  const student = eligible.find((s) => s.id === studentId)
  const feeItem = student?.openFees.find((f) => f.id === feeId)
  const amount = Number(amountRaw)
  const amountValid = Number.isFinite(amount) && amount > 0 && feeItem ? amount <= feeItem.outstanding : false

  useEffect(() => {
    const first = student?.openFees[0]
    setFeeId(first?.id ?? '')
    setAmountRaw(first ? String(first.outstanding) : '')
  }, [studentId])

  useEffect(() => {
    if (feeItem) setAmountRaw(String(feeItem.outstanding))
  }, [feeId])

  const submit = async () => {
    if (!student || !feeId || !amountValid) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ txn: { receiptNo: string | null; amount: number } }>('/api/fees/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record-direct',
          studentId: student.id,
          feeId,
          amount,
          method,
          source,
          referenceNumber: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      onOpenChange(false)
      await onDone(
        `${student.name} · ${formatINR(result.txn.amount)} — receipt ${result.txn.receiptNo}. The class teacher has been notified.`,
      )
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Could not record the payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4.5 w-4.5 text-emerald-600" /> Record Direct Payment
          </DialogTitle>
          <DialogDescription>
            A family paid directly at the office. The payment is recorded as verified with its receipt —
            the student&rsquo;s class teacher is notified automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Student</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a student" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {eligible.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} · {s.classLabel}</SelectItem>
                ))}
                {eligible.length === 0 && <div className="p-2 text-xs text-muted-foreground">No students with open fees.</div>}
              </SelectContent>
            </Select>
          </div>
          {student && (
            <div className="space-y-1.5">
              <Label className="text-xs">Fee</Label>
              <Select value={feeId} onValueChange={setFeeId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select the fee" /></SelectTrigger>
                <SelectContent>
                  {student.openFees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title} · balance {formatINR(f.outstanding, true)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {feeItem && (
            <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-3 text-center">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Due</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatINR(feeItem.amount, true)}</p>
              </div>
              <div className="border-x">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Paid</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(feeItem.paid, true)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Balance</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">{formatINR(feeItem.outstanding, true)}</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <div className="relative">
                <Banknote className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  inputMode="decimal"
                  className="h-9 pl-8 tabular-nums"
                  placeholder="0"
                  value={amountRaw}
                  onChange={(e) => setAmountRaw(e.target.value.replace(/[^0-9.]/g, ''))}
                />
              </div>
              {feeItem && Number(amountRaw) > feeItem.outstanding && (
                <p className="text-[11px] text-destructive">Exceeds the balance ({formatINR(feeItem.outstanding)}).</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['CASH', 'UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER'].map((m) => (
                    <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Paid through</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHOOL_OFFICE">School Office</SelectItem>
                  <SelectItem value="PRINCIPAL">Principal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reference <span className="text-muted-foreground">(optional)</span></Label>
              <div className="relative">
                <Hash className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-9 pl-8 text-sm" placeholder="UPI / cheque ref" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="direct-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="direct-notes" className="min-h-[56px] text-sm" placeholder="e.g. mother paid at the front desk" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1 gap-1.5" disabled={!amountValid || busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
              {busy ? 'Recording…' : 'Record verified payment'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  icon, label, value, sub, tone = 'slate',
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  tone?: 'slate' | 'emerald' | 'amber' | 'rose'
}) {
  const tones = {
    slate: 'bg-muted text-muted-foreground',
    emerald: 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    amber: 'bg-amber-600/10 text-amber-700 dark:text-amber-400',
    rose: 'bg-rose-600/10 text-rose-700 dark:text-rose-400',
  }
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <div className="flex items-center gap-1.5">
        <span className={cn('grid h-6 w-6 place-items-center rounded-md', tones[tone])}>{icon}</span>
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1.5 truncate text-base font-semibold tabular-nums leading-none">{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
