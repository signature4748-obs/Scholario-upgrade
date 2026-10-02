'use client'

/**
 * PaymentDetailDialog — full details of one canonical payment row.
 * VoidPaymentDialog — confirmation before voiding a RECORDED payment
 * (the row survives as the audit trail and the month can be re-recorded).
 *
 * PHASE 8B: the fields are exactly the canonical ones — teacher, month,
 * amount, paid-on, method, reference, note, status. No receipts, no
 * gross/net, no confirmation workflow: the principal records, the row
 * is the truth, voiding is the correction path.
 */

import { useState } from 'react'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  useSalaryStore, SalaryApiError, type SalaryPayment,
  METHOD_LABELS, periodLabel,
} from '@/lib/store/salary-store'
import { fmtDayYear, moneyMy, PaymentStatusBadge } from './salary-shared'

function methodLabel(method: string | null): string {
  return method && method in METHOD_LABELS ? METHOD_LABELS[method as keyof typeof METHOD_LABELS] : (method ?? '—')
}

// ─── Payment detail ──────────────────────────────────────────────────

export function PaymentDetailDialog({
  payment, teacherName, open, onOpenChange,
}: {
  payment: SalaryPayment | null
  teacherName?: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  if (!payment) return null
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Teacher', value: teacherName ?? '—' },
    { label: 'Month', value: periodLabel(payment.month) },
    { label: 'Amount', value: moneyMy(payment.amount) },
    { label: 'Paid On', value: fmtDayYear(payment.paidOn) },
    { label: 'Method', value: methodLabel(payment.method) },
    ...(payment.reference ? [{ label: 'Reference', value: <span className="font-mono text-xs">{payment.reference}</span> }] : []),
    ...(payment.note ? [{ label: 'Note', value: payment.note }] : []),
    { label: 'Status', value: <PaymentStatusBadge status={payment.status} /> },
    { label: 'Recorded', value: fmtDayYear(payment.createdAt) },
    { label: 'Last Updated', value: fmtDayYear(payment.updatedAt) },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>{teacherName ?? 'Salary payment'} · {periodLabel(payment.month)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-muted-foreground shrink-0">{r.label}</span>
              <span className="font-medium text-right">{r.value}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Void confirmation ───────────────────────────────────────────────

export function VoidPaymentDialog({
  payment, teacherName, open, onOpenChange, onVoided,
}: {
  payment: SalaryPayment | null
  teacherName?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Called after the server confirms the void (row refresh already applied). */
  onVoided?: (row: SalaryPayment) => void
}) {
  const voidPayment = useSalaryStore((s) => s.voidPayment)
  const [submitting, setSubmitting] = useState(false)

  if (!payment) return null

  const handleVoid = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const row = await voidPayment(payment.id)
      toast.success('Payment voided', {
        description: `${teacherName ?? 'Teacher'} · ${periodLabel(payment.month)} · ${moneyMy(payment.amount)} — the month can be re-recorded.`,
      })
      onOpenChange(false)
      onVoided?.(row)
    } catch (err) {
      toast.error('Could not void payment', {
        description: err instanceof SalaryApiError || err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <Undo2 className="h-4 w-4" />
            </span>
            Void Payment
          </DialogTitle>
          <DialogDescription>
            {teacherName ?? 'Teacher'} · {periodLabel(payment.month)} · {moneyMy(payment.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            The row stays in the payroll history as VOIDED and this month can be recorded again.
            Recorded totals stop counting it.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleVoid()}
            disabled={submitting || payment.status !== 'RECORDED'}
          >
            {submitting ? 'Voiding…' : 'Void Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
