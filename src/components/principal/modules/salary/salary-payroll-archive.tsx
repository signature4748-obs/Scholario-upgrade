'use client'

/**
 * Payroll Archive — the Principal's historical payroll records.
 *
 * PAYROLLARCHIVECARD lives on Settings (bottom section): shows the session
 * that is in progress, every completed session that has been preserved,
 * and opens the archive browser.
 *
 * PAYROLLARCHIVEDIALOG is a read-only, session-based viewer:
 *   Level 1 — sessions that actually exist (current + archived; the list
 *             is derived from real data, never invented).
 *   Level 2 — one session: summary, employee-wise payroll, full payment
 *             history, and a Download Report action (PDF).
 *
 * Archived sessions render from their FROZEN snapshot — later salary
 * changes cannot rewrite them. The in-progress session renders live from
 * the same store every other tab reads, clearly labelled as ongoing.
 * Nothing here is editable — records only.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, ArrowRight, Banknote, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Download, FileText, Lock, Users, Wallet, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  useSalaryStore, usePayrollSessions, buildSessionPayrollSnapshot,
  currentPeriodKey, sessionLabelOf, CURRENT_SESSION,
} from '@/lib/store/salary-store'
import type {
  ArchivedEmployeeRecord, PayrollSessionInfo, SalaryPayment,
} from '@/lib/store/salary-store'
import { moneyMy, fmtDayYear, PaymentStatusBadge } from './salary-shared'
import { downloadPayrollReport } from './payroll-report-pdf'
import { cn } from '@/lib/utils'

// ─── Settings card ───────────────────────────────────────────────────

export function PayrollArchiveCard() {
  const sessions = usePayrollSessions()
  const archives = useSalaryStore((s) => s.archives)
  const [open, setOpen] = useState(false)

  const current = sessions.find((s) => s.isCurrent)
  const completed = sessions.filter((s) => !s.isCurrent)

  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Payroll Archive</p>
        </div>

        <p className="text-xs text-muted-foreground">
          Salary &amp; payment records from past academic sessions — preserved exactly as they happened, ready for audits and school records.
        </p>

        {/* Current session — always real, always separated */}
        {current && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                {current.label}
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Current Session</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {current.employeesCount} on payroll · {current.paymentsCount} payment{current.paymentsCount === 1 ? '' : 's'} so far
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted/60 transition-colors"
              aria-label="View current session payroll"
            >
              View <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Completed sessions */}
        {completed.length > 0 ? (
          <div className="divide-y divide-border/60 rounded-lg border border-border overflow-hidden">
            {completed.map((s) => (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => setOpen(true)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/25 transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    {s.label}
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300">
                      <Lock className="h-2 w-2" />Archived
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.employeesCount} employees · {s.paymentsCount} payments</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center">
            <p className="text-[11px] font-medium text-muted-foreground">No completed sessions yet</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              {archives.length === 0
                ? `When ${sessionLabelOf(CURRENT_SESSION.id)} ends, its payroll is preserved here — every record stays exactly as it was.`
                : 'Archived sessions will appear here.'}
            </p>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Archive className="h-3.5 w-3.5" /> View Archive <ArrowRight className="h-3 w-3" />
        </Button>
      </div>

      <PayrollArchiveDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

// ─── Archive browser ─────────────────────────────────────────────────

export function PayrollArchiveDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const sessions = usePayrollSessions()
  const archives = useSalaryStore((s) => s.archives)
  // null = session list · otherwise the selected sessionId
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = selectedId ? sessions.find((s) => s.sessionId === selectedId) ?? null : null
  const completed = sessions.filter((s) => !s.isCurrent)

  const closeSession = () => setSelectedId(null)
  const handleOpenChange = (o: boolean) => {
    onOpenChange(o)
    if (!o) setSelectedId(null) // reset drill-down when the dialog closes
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <div className="max-h-[82vh] overflow-y-auto overscroll-contain">
          {selected ? (
            <SessionArchiveView
              key={selected.sessionId}
              session={selected}
              onBack={closeSession}
              onClose={() => handleOpenChange(false)}
            />
          ) : (
            <div className="p-5">
              <DialogHeader className="p-0 text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Archive className="h-4 w-4" />
                  </span>
                  Payroll Archive
                </DialogTitle>
                <DialogDescription>
                  Salary &amp; payment records, session by session — historical records are read-only.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {sessions.filter((s) => s.isCurrent).map((s) => (
                  <SessionRow key={s.sessionId} session={s} onOpen={() => setSelectedId(s.sessionId)} />
                ))}

                <div>
                  <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mb-2">Completed Sessions</p>
                  {completed.length > 0 ? (
                    <div className="space-y-2">
                      {completed.map((s) => (
                        <SessionRow key={s.sessionId} session={s} onOpen={() => setSelectedId(s.sessionId)} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                      <Archive className="h-5 w-5 mx-auto text-muted-foreground/50" />
                      <p className="text-xs font-medium text-muted-foreground mt-2">Nothing archived yet</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5 max-w-sm mx-auto">
                        {archives.length === 0
                          ? 'When an academic session ends, its complete payroll — every salary, payment and receipt — is preserved here automatically.'
                          : 'Archived sessions will appear here.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SessionRow({ session, onOpen }: { session: PayrollSessionInfo; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-emerald-500/40 hover:shadow-sm transition-all text-left"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{session.label}</span>
          {session.isCurrent ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">Current Session</span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300 shrink-0">
              <Lock className="h-2 w-2" />Archived
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {session.employeesCount} employee{session.employeesCount === 1 ? '' : 's'} · {session.paymentsCount} payment{session.paymentsCount === 1 ? '' : 's'}
          {session.isCurrent ? ' · in progress' : ''}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground shrink-0">
        Open <ChevronRight className="h-3 w-3" />
      </span>
    </button>
  )
}

// ─── One session, read-only ──────────────────────────────────────────

type DataSource =
  | { kind: 'archived'; records: ArchivedEmployeeRecord[]; payments: SalaryPayment[]; archivedAt: string; archivedBy: string }
  | { kind: 'live'; records: ArchivedEmployeeRecord[]; payments: SalaryPayment[] }

function SessionArchiveView({ session, onBack, onClose: _onClose }: {
  session: PayrollSessionInfo
  onBack: () => void
  onClose: () => void
}) {
  const archives = useSalaryStore((s) => s.archives)
  const employees = useSalaryStore((s) => s.employees)
  const salaries = useSalaryStore((s) => s.salaries)
  const adjustments = useSalaryStore((s) => s.adjustments)
  const payments = useSalaryStore((s) => s.payments)

  const [focusEmployeeId, setFocusEmployeeId] = useState<string | null>(null)

  const data: DataSource = useMemo(() => {
    const archive = archives.find((a) => a.sessionId === session.sessionId)
    if (archive) {
      return {
        kind: 'archived',
        records: archive.records,
        payments: archive.payments,
        archivedAt: archive.archivedAt,
        archivedBy: archive.archivedBy,
      }
    }
    // In-progress session — live from the same store every tab reads.
    const snap = buildSessionPayrollSnapshot(
      { employees, salaries, adjustments, payments },
      session.sessionId,
      currentPeriodKey(),
    )
    return { kind: 'live', records: snap.records, payments: snap.payments }
  }, [archives, session.sessionId, employees, salaries, adjustments, payments])

  const focused = data.records.find((r) => r.employeeId === focusEmployeeId) ?? null
  const visiblePayments = focused
    ? data.payments.filter((p) => p.employeeId === focused.employeeId)
    : data.payments

  const summary = useMemo(() => ({
    employees: data.records.length,
    totalPayroll: data.records.reduce((s, r) => s + r.totalPayable, 0),
    totalPaid: data.payments.filter((p) => p.status === 'Confirmed').reduce((s, p) => s + p.amount, 0),
    totalOutstanding: data.records.reduce((s, r) => s + r.outstanding, 0),
    paymentsCount: data.payments.filter((p) => p.status !== 'Reversed').length,
  }), [data])

  const handleDownload = () => {
    downloadPayrollReport({
      sessionId: session.sessionId,
      sessionLabel: session.label,
      kind: data.kind,
      archivedAt: data.kind === 'archived' ? data.archivedAt : undefined,
      archivedBy: data.kind === 'archived' ? data.archivedBy : undefined,
      records: data.records,
      payments: data.payments,
      summary,
    })
    toast.success('Report downloaded', {
      description: `Payroll-Report-${session.sessionId}.pdf — ready for records, audits and sharing.`,
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 border-b border-border px-5 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onBack}>
            <ChevronLeft className="h-3.5 w-3.5" /> All sessions
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" /> Download Report
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Archive className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold flex items-center gap-2">
              {session.label}
              {data.kind === 'archived' ? (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300">
                  <Lock className="h-2 w-2" />Archived
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Current Session</span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {data.kind === 'archived'
                ? `Historical record — archived ${fmtDayYear(data.archivedAt)} by ${data.archivedBy}. Read-only.`
                : 'Session in progress — figures update as payroll continues. Read-only here.'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <ArchiveTile label="Employees" value={String(summary.employees)} icon={<Users className="h-3 w-3" />} />
          <ArchiveTile label="Total Payroll" value={moneyMy(summary.totalPayroll)} icon={<Wallet className="h-3 w-3" />} />
          <ArchiveTile label="Total Paid" value={moneyMy(summary.totalPaid)} tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />} />
          <ArchiveTile label="Outstanding" value={moneyMy(summary.totalOutstanding)} tone={summary.totalOutstanding > 0 ? 'rose' : 'emerald'} icon={<Banknote className="h-3 w-3" />} />
          <ArchiveTile label="Payments" value={String(summary.paymentsCount)} icon={<FileText className="h-3 w-3" />} />
        </div>

        {/* Employee-wise payroll */}
        <div>
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mb-2">
            Employee-wise payroll — click an employee to see their payments
          </p>
          {data.records.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <Users className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="text-xs font-medium text-muted-foreground mt-2">No payroll records for this session</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="flex items-center gap-3 px-3 py-2 border-b border-border/60 bg-muted/30 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex-1">Employee</span>
                  <span className="w-20 text-right">Salary / mo</span>
                  <span className="w-20 text-right">Payable</span>
                  <span className="w-20 text-right">Paid</span>
                  <span className="w-20 text-right">Outstanding</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {data.records.map((r) => (
                    <button
                      key={r.employeeId}
                      type="button"
                      onClick={() => setFocusEmployeeId(focusEmployeeId === r.employeeId ? null : r.employeeId)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/25 transition-colors text-left',
                        focusEmployeeId === r.employeeId && 'bg-emerald-500/[0.06]',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.name}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{r.employeeCode} · {r.designation} · {r.department}</p>
                      </div>
                      <span className="w-20 text-right text-[11px] tabular-nums">{r.monthlySalary ? moneyMy(r.monthlySalary) : '—'}</span>
                      <span className="w-20 text-right text-[11px] font-semibold tabular-nums">{moneyMy(r.totalPayable)}</span>
                      <span className="w-20 text-right text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{moneyMy(r.totalPaid)}</span>
                      <span className={cn(
                        'w-20 text-right text-[11px] font-bold tabular-nums',
                        r.outstanding > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                      )}>
                        {r.outstanding > 0 ? moneyMy(r.outstanding) : 'Clear'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Payment history */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">
              Payment history{focused ? ` — ${focused.name}` : ''}
            </p>
            {focused && (
              <button
                type="button"
                onClick={() => setFocusEmployeeId(null)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium hover:bg-muted/60 transition-colors"
              >
                <X className="h-2.5 w-2.5" /> Show all
              </button>
            )}
          </div>
          {visiblePayments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <FileText className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="text-xs font-medium text-muted-foreground mt-2">
                {focused ? `No payments recorded for ${focused.name} in ${session.label}` : 'No payments recorded in this session'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="flex items-center gap-3 px-3 py-2 border-b border-border/60 bg-muted/30 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="w-20 shrink-0">Date</span>
                  <span className="flex-1 min-w-0">Employee</span>
                  <span className="w-20 shrink-0">Period</span>
                  <span className="w-16 text-right shrink-0">Payable</span>
                  <span className="w-16 text-right shrink-0">Paid</span>
                  <span className="w-20 shrink-0">Method</span>
                  <span className="w-24 shrink-0">Reference</span>
                  <span className="w-24 shrink-0 text-right">Status</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {visiblePayments.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/25 transition-colors">
                      <span className="w-20 shrink-0 text-[11px] tabular-nums">{fmtDayYear(p.date)}</span>
                      <span className="flex-1 min-w-0 text-[11px] font-medium truncate">
                        {p.employeeName}
                        {(p.rejectionReason || p.reversalReason) && (
                          <span className="block text-[9px] text-muted-foreground truncate">
                            {p.rejectionReason ? `“${p.rejectionReason}”` : p.reversalReason}
                          </span>
                        )}
                      </span>
                      <span className="w-20 shrink-0 text-[11px] text-muted-foreground truncate">{p.monthLabel}</span>
                      <span className="w-16 text-right shrink-0 text-[11px] tabular-nums">{p.netPayable ? moneyMy(p.netPayable) : '—'}</span>
                      <span className="w-16 text-right shrink-0 text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{moneyMy(p.amount)}</span>
                      <span className="w-20 shrink-0 text-[11px] truncate">{p.method}</span>
                      <span className="w-24 shrink-0 text-[10px] font-mono text-muted-foreground truncate" title={p.reference}>
                        {p.reference ?? '—'}
                      </span>
                      <span className="w-24 shrink-0 flex justify-end"><PaymentStatusBadge status={p.status} /></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {data.kind === 'archived' && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Lock className="h-3 w-3 shrink-0" />
            This is a historical record — preserved {fmtDayYear(data.archivedAt)}. Current salary changes never rewrite it.
          </p>
        )}
        {data.kind === 'live' && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3 shrink-0" />
            {session.label} is still in progress — record and confirm payments from the Payments tab.
          </p>
        )}
      </div>
    </div>
  )
}

function ArchiveTile({ label, value, tone, icon }: {
  label: string
  value: string
  tone?: 'emerald' | 'rose'
  icon?: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg bg-muted/40 px-2.5 py-2"
    >
      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={cn(
        'text-sm font-bold tabular-nums leading-tight mt-0.5',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400',
      )}>{value}</p>
    </motion.div>
  )
}
