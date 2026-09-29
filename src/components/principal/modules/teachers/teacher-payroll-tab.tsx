'use client'

/**
 * TeacherPayrollTab — the Payroll tab of the Teacher Profile.
 *
 * An INDIVIDUAL EMPLOYEE view that reads from the exact same salary
 * store the Principal's Salary & Payroll module uses: the same session
 * salary structure, the same monthly adjustments, the same payment
 * records and receipts, the same salary history. No independent
 * calculation exists here — Teacher Profile Payroll = Salary & Payroll
 * employee drawer = payment record = payslip.
 *
 * Visual language matches the Salary & Payroll module (status pills,
 * financial cards, component rows) while the rest of the Teacher
 * Profile keeps its own identity.
 */

import { useMemo, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, Check, Eye, FileText, IndianRupee, Pencil, Printer,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useSalaryStore, currentPeriodKey, periodLabel, netPayableFor, confirmedPaidFor, monthPaymentState,
} from '@/lib/store/salary-store'
import type { SalaryPayment } from '@/lib/store/salary-store'
import {
  EditSalaryDialog,
} from '../salary/salary-employee-drawer'
import { PaymentDetailDialog, ReceiptViewDialog } from '../salary/payment-dialogs'
import { PayslipDocument, printPayslip } from '../salary/payslip-document'
import {
  fmtDay, fmtDayYear, moneyMy, LockedBadge, SessionSalaryBadge, PaymentStatusBadge,
  PayslipStateBadge, RequestStatusBadge, useEditingWindow,
} from '../salary/salary-shared'
import { Panel } from '../shared/panel'

export function TeacherPayrollTab({ teacherId }: { teacherId: string }) {
  const employees = useSalaryStore((s) => s.employees)
  const salaries = useSalaryStore((s) => s.salaries)
  const payments = useSalaryStore((s) => s.payments)
  const receipts = useSalaryStore((s) => s.receipts)
  const changeRequests = useSalaryStore((s) => s.changeRequests)
  const adjustments = useSalaryStore((s) => s.adjustments)

  const [editOpen, setEditOpen] = useState(false)
  const [payslipOpen, setPayslipOpen] = useState(false)
  const [detail, setDetail] = useState<SalaryPayment | null>(null)
  const [receiptNo, setReceiptNo] = useState<string | null>(null)

  const { allowed, label: _label } = useEditingWindow()

  const employee = employees.find((e) => e.id === teacherId)
  const state = salaries[teacherId]
  const periodKey = currentPeriodKey()

  const empPayments = useMemo(
    () => payments.filter((p) => p.employeeId === teacherId)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [payments, teacherId],
  )
  const empRequests = useMemo(
    () => changeRequests.filter((r) => r.employeeId === teacherId),
    [changeRequests, teacherId],
  )
  const monthAdjustments = useMemo(
    () => adjustments.filter((a) => a.employeeId === teacherId && a.periodKey === periodKey),
    [adjustments, teacherId, periodKey],
  )
  const monthPayments = useMemo(
    () => payments.filter((p) => p.employeeId === teacherId && p.periodKey === periodKey && p.status !== 'Reversed'),
    [payments, teacherId, periodKey],
  )

  const receipt = receipts.find((r) => r.receiptNo === receiptNo) ?? null

  if (!employee || !state) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">No salary record found.</p>
    )
  }

  const payable = netPayableFor({ salaries, adjustments }, teacherId, periodKey)
  const confirmed = confirmedPaidFor(payments, teacherId, periodKey)
  const balance = Math.max(0, payable - confirmed)
  const payState = monthPaymentState(payments, teacherId, periodKey)
  const pendingRequest = empRequests.find((r) => r.status === 'Pending')
  const stateLabel = payState === 'Paid' ? 'Confirmed' : payState === 'Pending' ? 'Pending Receipt' : 'Unpaid'

  return (
    <div className="space-y-4">
      {/* ── Current month summary ── */}
      <Panel
        title="Current Month"
        subtitle={`${periodLabel(periodKey)} · net payable`}
        action={
          <div className="flex items-center gap-2">
            <PayslipStateBadge state={payState} label={stateLabel} />
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setPayslipOpen(true)}>
              <FileText className="h-3 w-3" /> Payslip
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Net Payable</p>
            <p className="text-sm font-bold tabular-nums mt-0.5">{moneyMy(payable)}</p>
          </div>
          <div className="rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Paid</p>
            <p className="text-sm font-bold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">{moneyMy(confirmed)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Balance</p>
            <p className="text-sm font-bold tabular-nums mt-0.5">{moneyMy(balance)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Status</p>
            <p className="text-sm font-bold mt-0.5">{stateLabel}</p>
          </div>
        </div>
        {monthAdjustments.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {monthAdjustments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs rounded-lg bg-muted/40 px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  {a.amount >= 0
                    ? <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                    : <ArrowDownRight className="h-3 w-3 text-rose-600" />}
                  {a.label}
                </span>
                <span className={cn('font-semibold tabular-nums', a.amount >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {a.amount >= 0 ? '+' : '−'}{moneyMy(Math.abs(a.amount))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Salary structure / breakdown ── */}
      <Panel title="Salary Structure" subtitle="Applied to this month">
        <div className="flex items-center justify-between gap-2">
          <SessionSalaryBadge />
          <LockedBadge />
        </div>
        <div className="flex items-end justify-between mt-3">
          <div>
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Net Base / month</p>
            <p className="text-2xl font-bold tabular-nums mt-1 leading-none">{moneyMy(state.salary.netBase)}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">from {fmtDayYear(state.salary.effectiveFrom)}</p>
        </div>

        <div className="mt-4 space-y-1">
          {state.salary.earnings.map((c) => (
            <div key={`e-${c.name}`} className="flex justify-between text-xs">
              <span className="text-muted-foreground">+ {c.name}</span>
              <span className="font-medium tabular-nums">{moneyMy(c.amount)}</span>
            </div>
          ))}
          {state.salary.deductions.map((c) => (
            <div key={`d-${c.name}`} className="flex justify-between text-xs">
              <span className="text-muted-foreground">− {c.name}</span>
              <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">{moneyMy(c.amount)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] text-muted-foreground">{state.salary.structureName}</p>
          <Button
            size="sm"
            variant={allowed ? 'default' : 'outline'}
            className={cn('h-8 text-xs gap-1.5', allowed && 'bg-emerald-600 hover:bg-emerald-700 text-white')}
            onClick={() => (allowed ? setEditOpen(true) : toast.error('Salary editing is locked', { description: 'Enable editing in Salary & Payroll → Settings first.' }))}
          >
            <Pencil className="h-3 w-3" /> Edit Salary
          </Button>
        </div>

        {pendingRequest && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Salary change sent</p>
              <RequestStatusBadge status={pendingRequest.status} />
            </div>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1 tabular-nums">
              {moneyMy(pendingRequest.currentNet)} → {moneyMy(pendingRequest.proposedNet)} · from {periodLabel(pendingRequest.effectiveFrom.slice(0, 7))}
            </p>
          </div>
        )}
      </Panel>

      {/* ── Histories ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Payment history */}
        <Panel title="Payment History" subtitle={`${empPayments.length} payment${empPayments.length === 1 ? '' : 's'} recorded`}>
          {empPayments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No payments recorded yet.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto -mx-4 salary-scroll">
              <div className="divide-y divide-border">
                {empPayments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold tabular-nums">
                        {moneyMy(p.amount)} <span className="text-muted-foreground font-normal">· {p.monthLabel}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {p.method} · {fmtDay(p.date)}
                        {p.rejectionReason ? ` — “${p.rejectionReason}”` : ''}
                        {p.reversalReason ? ` — ${p.reversalReason}` : ''}
                      </p>
                    </div>
                    <PaymentStatusBadge status={p.status} />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {p.receiptNo && (
                        <button
                          type="button" title="Receipt" aria-label="View receipt"
                          onClick={() => setReceiptNo(p.receiptNo!)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <IndianRupee className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button" title="View" aria-label="View payment"
                        onClick={() => setDetail(p)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Salary history */}
        <Panel title="Salary History" subtitle={`${state.history.length} change${state.history.length === 1 ? '' : 's'}`}>
          <div className="max-h-80 overflow-y-auto -mx-4 salary-scroll">
            <div className="divide-y divide-border">
              {empRequests.map((r) => (
                <div key={r.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold tabular-nums">
                      {moneyMy(r.currentNet)} → {moneyMy(r.proposedNet)}
                    </p>
                    <RequestStatusBadge status={r.status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 truncate">
                    {fmtDayYear(r.requestedAt)} · sent by {r.requestedBy}
                    {r.note ? ` · ${r.note}` : ''}
                    {r.declineReason ? ` · “${r.declineReason}”` : ''}
                  </p>
                </div>
              ))}
              {state.history.map((h) => (
                <div key={h.id} className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tabular-nums">
                      {h.fromNet !== undefined ? `${moneyMy(h.fromNet)} → ${moneyMy(h.toNet)}` : moneyMy(h.toNet)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">
                      {fmtDayYear(h.date)} · by {h.by}{h.note ? ` · ${h.note}` : ''}
                    </p>
                  </div>
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                </div>
              ))}
              {empRequests.length === 0 && state.history.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No salary changes yet.</p>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Dialogs ── */}
      <EditSalaryDialog open={editOpen} onOpenChange={setEditOpen} employeeId={teacherId} currentNet={state.salary.netBase} />
      <PaymentDetailDialog payment={detail} open={!!detail} onOpenChange={(o) => !o && setDetail(null)} />
      <ReceiptViewDialog receipt={receipt} open={!!receipt} onOpenChange={(o) => !o && setReceiptNo(null)} />

      <Dialog open={payslipOpen} onOpenChange={setPayslipOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                <FileText className="h-4 w-4" />
              </span>
              Payslip · {periodLabel(periodKey)}
            </DialogTitle>
            <DialogDescription>
              {employee.name} · {employee.designation} · {employee.employeeId}
            </DialogDescription>
          </DialogHeader>
          <PayslipDocument
            employee={employee}
            session={state.salary}
            periodKey={periodKey}
            adjustments={monthAdjustments}
            payments={monthPayments}
            payable={payable}
          />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => printPayslip()}>
              <Printer className="h-3.5 w-3.5" /> Print / Save PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
