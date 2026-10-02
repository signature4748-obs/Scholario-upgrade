'use client'

/**
 * Payroll Archive — the Principal's payroll history by academic session.
 *
 * PHASE 8B: read-only, derived LIVE from the canonical server ledger —
 * sessions are the academic-session buckets of the REAL payment months
 * (never invented); the current session is always listed first. There is
 * no client-side frozen snapshot any more: every figure is a sum of
 * RECORDED amounts in the server rows (totals update as payroll
 * continues; VOIDED rows stay visible as the audit trail).
 *
 * PAYROLLARCHIVECARD lives on Settings (bottom section).
 * PAYROLLARCHIVEDIALOG: Level 1 — sessions that actually exist; Level 2 —
 * one session: summary, teacher-wise payroll, full payment history, and
 * a Download Report action (PDF).
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, ArrowRight, Banknote, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Download, FileText, Users, Wallet, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  useSalaryStore, usePayrollSessions, currentPeriodKey, sessionOfPeriod,
  sessionLabelOf, CURRENT_SESSION,
} from '@/lib/store/salary-store'
import { moneyMy, fmtDayYear, PaymentStatusBadge } from './salary-shared'
import { downloadPayrollReport } from './payroll-report-pdf'
import { cn } from '@/lib/utils'

// ─── Settings card ───────────────────────────────────────────────────

export function PayrollArchiveCard() {
  const sessions = usePayrollSessions()
  const [open, setOpen] = useState(false)

  const current = sessions.find((s) => s.isCurrent)
  const completed = sessions.filter((s) => !s.isCurrent)

  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Payroll Records</p>
        </div>

        <p className="text-xs text-muted-foreground">
          Salary &amp; payment records by academic session — read from the school&apos;s server ledger,
          preserved exactly as recorded.
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
                {current.employeesCount} on payroll · {current.paymentsCount} payment{current.paymentsCount === 1 ? '' : 's'} · {moneyMy(current.recordedTotal)} recorded
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
                      <Archive className="h-2 w-2" />Closed
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.employeesCount} teachers · {s.paymentsCount} payments · {moneyMy(s.recordedTotal)} recorded</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center">
            <p className="text-[11px] font-medium text-muted-foreground">No completed sessions yet</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              When {sessionLabelOf(CURRENT_SESSION.id)} ends, its payroll stays readable here — every record exactly as it was recorded.
            </p>
          </div>
        )}

        <Button
          variant="outline" size="sm"
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Archive className="h-3.5 w-3.5" /> View Records <ArrowRight className="h-3 w-3" />
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
  // null = session list · otherwise the selected sessionId
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
          {selectedId ? (
            <SessionArchiveView
              key={selectedId}
              session={sessions.find((s) => s.sessionId === selectedId) ?? null}
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
                  Payroll Records
                </DialogTitle>
                <DialogDescription>
                  Salary &amp; payment records, session by session — read-only, straight from the school ledger.
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
                      <p className="text-xs font-medium text-muted-foreground mt-2">No completed sessions yet</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5 max-w-sm mx-auto">
                        Sessions appear here as soon as the ledger holds payments outside the current one.
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

function SessionRow({ session, onOpen }: { session: ReturnType<typeof usePayrollSessions>[number]; onOpen: () => void }) {
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
              <Archive className="h-2 w-2" />Closed
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {session.employeesCount} teacher{session.employeesCount === 1 ? '' : 's'} · {session.paymentsCount} payment{session.paymentsCount === 1 ? '' : 's'} · {moneyMy(session.recordedTotal)} recorded
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

function SessionArchiveView({ session, onBack, onClose: _onClose }: {
  session: ReturnType<typeof usePayrollSessions>[number] | null
  onBack: () => void
  onClose: () => void
}) {
  const teachers = useSalaryStore((s) => s.teachers)
  const teacherNames = useSalaryStore((s) => s.teacherNames)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)

  const [focusTeacherId, setFocusTeacherId] = useState<string | null>(null)

  const data = useMemo(() => {
    if (!session) return { payments: [] as typeof payments, teachers: [] as typeof teachers }
    const inSession = payments.filter((p) => sessionOfPeriod(p.month) === session.sessionId)
    return { payments: inSession, teachers }
  }, [payments, session, teachers])

  const visiblePayments = focusTeacherId
    ? data.payments.filter((p) => p.teacherId === focusTeacherId)
    : data.payments

  const summary = useMemo(() => {
    const recorded = data.payments.filter((p) => p.status === 'RECORDED')
    // Monthly payroll commitment: the sum of configured salaries of the
    // teachers actually paid in this session (a session-scoped snapshot
    // of the commitment, never invented arithmetic).
    const paidTeacherIds = new Set(data.payments.map((p) => p.teacherId))
    const monthly = structures
      .filter((s) => paidTeacherIds.has(s.teacherId))
      .reduce((sum, s) => sum + s.monthlyAmount, 0)
    return {
      employees: paidTeacherIds.size,
      monthlyPayroll: monthly,
      recordedTotal: recorded.reduce((s, p) => s + p.amount, 0),
      paymentsCount: data.payments.length,
    }
  }, [data.payments, structures])

  // Per-teacher rows: monthly salary (if configured) + recorded total.
  const records = useMemo(() => {
    const byTeacher = new Map<string, { recorded: number; count: number }>()
    for (const p of data.payments) {
      if (p.status !== 'RECORDED') continue
      const cur = byTeacher.get(p.teacherId) ?? { recorded: 0, count: 0 }
      byTeacher.set(p.teacherId, { recorded: cur.recorded + p.amount, count: cur.count + 1 })
    }
    const rows = Array.from(byTeacher.entries()).map(([teacherId, v]) => ({
      teacherId,
      name: teacherNames[teacherId] ?? '—',
      monthly: structures.find((s) => s.teacherId === teacherId)?.monthlyAmount ?? 0,
      recorded: v.recorded,
      count: v.count,
    }))
    return rows.sort((a, b) => b.recorded - a.recorded || a.name.localeCompare(b.name))
  }, [data.payments, structures, teacherNames])

  if (!session) return null

  const handleDownload = () => {
    downloadPayrollReport({
      sessionId: session.sessionId,
      sessionLabel: session.label,
      isCurrent: session.isCurrent,
      teachers: data.teachers,
      structures,
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
              {session.isCurrent ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Current Session</span>
              ) : (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300">
                  <Archive className="h-2 w-2" />Closed
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {session.isCurrent
                ? 'Session in progress — figures update as payroll continues. Read-only here.'
                : 'Historical record from the school ledger. Read-only.'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ArchiveTile label="Teachers Paid" value={String(summary.employees)} icon={<Users className="h-3 w-3" />} />
          <ArchiveTile label="Monthly Payroll" value={moneyMy(summary.monthlyPayroll)} icon={<Wallet className="h-3 w-3" />} />
          <ArchiveTile label="Recorded Paid" value={moneyMy(summary.recordedTotal)} tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />} />
          <ArchiveTile label="Payment Rows" value={String(summary.paymentsCount)} icon={<FileText className="h-3 w-3" />} />
        </div>

        {/* Teacher-wise payroll */}
        <div>
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mb-2">
            Teacher-wise payroll — click a teacher to see their payments
          </p>
          {records.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <Users className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="text-xs font-medium text-muted-foreground mt-2">No payroll records for this session</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="flex items-center gap-3 px-3 py-2 border-b border-border/60 bg-muted/30 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex-1">Teacher</span>
                  <span className="w-24 text-right">Salary / mo</span>
                  <span className="w-24 text-right">Recorded</span>
                  <span className="w-16 text-right">Rows</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {records.map((r) => (
                    <button
                      key={r.teacherId}
                      type="button"
                      onClick={() => setFocusTeacherId(focusTeacherId === r.teacherId ? null : r.teacherId)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/25 transition-colors text-left',
                        focusTeacherId === r.teacherId && 'bg-emerald-500/[0.06]',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.name}</p>
                      </div>
                      <span className="w-24 text-right text-[11px] tabular-nums">{r.monthly > 0 ? moneyMy(r.monthly) : '—'}</span>
                      <span className="w-24 text-right text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{moneyMy(r.recorded)}</span>
                      <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">{r.count}</span>
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
              Payment history{focusTeacherId ? ` — ${teacherNames[focusTeacherId] ?? '—'}` : ''}
            </p>
            {focusTeacherId && (
              <button
                type="button"
                onClick={() => setFocusTeacherId(null)}
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
                {focusTeacherId ? `No payments recorded for this teacher in ${session.label}` : 'No payments recorded in this session'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="flex items-center gap-3 px-3 py-2 border-b border-border/60 bg-muted/30 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="w-20 shrink-0">Date</span>
                  <span className="flex-1 min-w-0">Teacher</span>
                  <span className="w-20 shrink-0">Period</span>
                  <span className="w-16 text-right shrink-0">Amount</span>
                  <span className="w-24 shrink-0">Method</span>
                  <span className="w-24 shrink-0">Reference</span>
                  <span className="w-24 shrink-0 text-right">Status</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {visiblePayments.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/25 transition-colors">
                      <span className="w-20 shrink-0 text-[11px] tabular-nums">{fmtDayYear(p.paidOn)}</span>
                      <span className="flex-1 min-w-0 text-[11px] font-medium truncate">
                        {teacherNames[p.teacherId] ?? '—'}
                        {p.note && (
                          <span className="block text-[9px] text-muted-foreground truncate">{p.note}</span>
                        )}
                      </span>
                      <span className="w-20 shrink-0 text-[11px] text-muted-foreground truncate">{p.month}</span>
                      <span className="w-16 text-right shrink-0 text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{moneyMy(p.amount)}</span>
                      <span className="w-24 shrink-0 text-[11px] truncate">{p.method ?? '—'}</span>
                      <span className="w-24 shrink-0 text-[10px] font-mono text-muted-foreground truncate" title={p.reference ?? undefined}>
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

        {session.isCurrent ? (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3 shrink-0" />
            {session.label} is still in progress — record payments from the Payments tab; totals here update live.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Banknote className="h-3 w-3 shrink-0" />
            Historical record — every row exactly as recorded in the school ledger (as of {fmtDayYear(currentPeriodKey() + '-01')}).
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
