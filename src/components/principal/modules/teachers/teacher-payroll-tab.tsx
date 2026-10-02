'use client'

/**
 * TeacherPayrollTab — the Payroll tab of the Teacher Profile.
 *
 * PHASE 8B: an INDIVIDUAL TEACHER view that reads from the exact same
 * canonical salary cache the Principal's Salary & Payroll module uses —
 * the same fixed monthly salary, the same RECORDED/VOIDED payment rows.
 * The principal sets the monthly salary directly (SetMonthlySalaryDialog,
 * PUT /api/salary/structure); payments are recorded from the Salary
 * module. No independent calculation exists here.
 *
 * Visual language matches the Salary & Payroll module (status pills,
 * financial cards) while the rest of the Teacher Profile keeps its own
 * identity.
 */

import { useMemo, useState } from 'react'
import {
  Eye, FileText, Pencil, Printer, Undo2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useSalaryStore, currentPeriodKey, periodLabel,
} from '@/lib/store/salary-store'
import type { SalaryPayment } from '@/lib/store/salary-store'
import { SetMonthlySalaryDialog } from '../salary/salary-employee-drawer'
import { PaymentDetailDialog, VoidPaymentDialog } from '../salary/payment-dialogs'
import { PayslipDocument, printPayslip } from '../salary/payslip-document'
import {
  fmtDay, moneyMy, PaymentStatusBadge, PayslipStateBadge, MonthlySalaryBadge,
} from '../salary/salary-shared'
import { Panel } from '../shared/panel'

export function TeacherPayrollTab({ teacherId }: { teacherId: string }) {
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)

  const [editOpen, setEditOpen] = useState(false)
  const [payslipOpen, setPayslipOpen] = useState(false)
  const [detail, setDetail] = useState<SalaryPayment | null>(null)
  const [voiding, setVoiding] = useState<SalaryPayment | null>(null)

  const teacher = teachers.find((t) => t.id === teacherId)
  const structure = structures.find((s) => s.teacherId === teacherId) ?? null
  const periodKey = currentPeriodKey()

  const empPayments = useMemo(
    () => payments.filter((p) => p.teacherId === teacherId)
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn)),
    [payments, teacherId],
  )
  const monthPayments = useMemo(
    () => payments.filter((p) => p.teacherId === teacherId && p.month === periodKey),
    [payments, teacherId, periodKey],
  )
  const recordedThisMonth = monthPayments
    .filter((p) => p.status === 'RECORDED')
    .reduce((s, p) => s + p.amount, 0)
  const payState: 'Unpaid' | 'Recorded' = monthPayments.some((p) => p.status === 'RECORDED') ? 'Recorded' : 'Unpaid'
  const primary = monthPayments.find((p) => p.status === 'RECORDED') ?? monthPayments[0] ?? null

  if (!teacher) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">Teacher not found on the roster.</p>
    )
  }

  const stateLabel = payState === 'Recorded' ? 'Recorded' : 'Unpaid'

  return (
    <div className="space-y-4">
      {/* ── Current month summary ── */}
      <Panel
        title="Current Month"
        subtitle={`${periodLabel(periodKey)} · fixed monthly salary`}
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
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Monthly Salary</p>
            <p className="text-sm font-bold tabular-nums mt-0.5">{structure ? moneyMy(structure.monthlyAmount) : '—'}</p>
          </div>
          <div className="rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Recorded</p>
            <p className="text-sm font-bold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">{moneyMy(recordedThisMonth)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Effective From</p>
            <p className="text-sm font-bold mt-0.5">{structure?.effectiveFrom ? fmtDay(structure.effectiveFrom) : '—'}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Status</p>
            <p className="text-sm font-bold mt-0.5">{stateLabel}</p>
          </div>
        </div>
      </Panel>

      {/* ── Salary structure ── */}
      <Panel title="Monthly Salary" subtitle="Fixed salary · one amount per month">
        <div className="flex items-center justify-between gap-2">
          <MonthlySalaryBadge />
        </div>
        <div className="flex items-end justify-between mt-3">
          <div>
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Monthly Salary</p>
            <p className="text-2xl font-bold tabular-nums mt-1 leading-none">{structure ? moneyMy(structure.monthlyAmount) : 'Not set'}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {structure?.effectiveFrom ? `from ${fmtDay(structure.effectiveFrom)}` : 'no effective date set'}
          </p>
        </div>

        {structure?.note && (
          <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t">{structure.note}</p>
        )}

        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] text-muted-foreground">One fixed amount — no components or deductions</p>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3 w-3" /> {structure ? 'Edit Monthly Salary' : 'Set Monthly Salary'}
          </Button>
        </div>
      </Panel>

      {/* ── Payment history ── */}
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
                      {moneyMy(p.amount)} <span className="text-muted-foreground font-normal">· {periodLabel(p.month)}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {p.method ?? '—'} · {fmtDay(p.paidOn)}
                      {p.note ? ` — ${p.note}` : ''}
                    </p>
                  </div>
                  <PaymentStatusBadge status={p.status} />
                  <div className="flex items-center gap-0.5 shrink-0">
                    {p.status === 'RECORDED' && (
                      <button
                        type="button" title="Void" aria-label="Void payment"
                        onClick={() => setVoiding(p)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
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

      {/* ── Dialogs ── */}
      <SetMonthlySalaryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        teacherId={teacherId}
        teacherName={teacher.name}
        structure={structure}
      />
      <PaymentDetailDialog payment={detail} teacherName={teacher.name} open={!!detail} onOpenChange={(o) => !o && setDetail(null)} />
      <VoidPaymentDialog payment={voiding} teacherName={teacher.name} open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} />

      <Dialog open={payslipOpen} onOpenChange={setPayslipOpen}>
        <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                <FileText className="h-4 w-4" />
              </span>
              Payslip · {periodLabel(periodKey)}
            </DialogTitle>
            <DialogDescription>
              {teacher.name}
              {teacher.employeeId ? ` · ${teacher.employeeId}` : ''}
              {teacher.department ? ` · ${teacher.department}` : ''}
            </DialogDescription>
          </DialogHeader>
          <PayslipDocument
            teacher={teacher}
            structure={structure}
            periodKey={periodKey}
            payment={primary}
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
