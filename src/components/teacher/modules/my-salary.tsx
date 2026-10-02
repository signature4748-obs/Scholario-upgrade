'use client'

/**
 * MySalaryModule — the teacher's "My Salary & Payments" workspace.
 *
 * PHASE 8B: this module renders the teacher's OWN canonical rows — the
 * same SalaryStructure and SalaryPayment rows the principal recorded
 * (GET /api/salary resolves the session's own Teacher row; PostgreSQL is
 * the single source of truth, no localStorage). The principal records
 * payments; the teacher reads them — no confirmation or change-request
 * workflow exists any more.
 *
 * Information architecture (fixed-monthly-salary model):
 *   1. Monthly Salary + Effective From + Latest Payment summary cards.
 *      NO gross / deductions / net breakdown — nothing is auto-computed
 *      or invented.
 *   2. Payslips — one row per month with a RECORDED payment: view the
 *      slip document + a real PDF download.
 *   3. Payment History — every canonical row (RECORDED | VOIDED).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, CalendarDays, Download, FileText, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageTransition } from '@/components/shared/ui'
import { ModuleToolbar } from '../teacher-panel/module-toolbar'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  useSalaryStore, periodLabel, METHOD_LABELS, type SalaryPayment,
} from '@/lib/store/salary-store'
import {
  fmtDay, fmtDayYear, moneyMy, PaymentStatusBadge, PayslipStateBadge, MonthlySalaryBadge,
  SyncErrorStrip,
} from '@/components/principal/modules/salary/salary-shared'
import { PayslipDocument } from '@/components/principal/modules/salary/payslip-document'
import { HubStatCards, type HubStat } from './shared/hub-stat-cards'
import { downloadTeacherPayslip } from './salary-payslip-pdf'

// ─── Per-month derivation ────────────────────────────────────────────

interface PayslipMonth {
  month: string
  monthLabel: string
  /** The month's representative payment (the RECORDED row wins). */
  primary: SalaryPayment
  payments: SalaryPayment[]
}

function methodLabel(method: string | null): string {
  return method && method in METHOD_LABELS ? METHOD_LABELS[method as keyof typeof METHOD_LABELS] : (method ?? '—')
}

// ─── Module ──────────────────────────────────────────────────────────

export function MySalaryModule() {
  // Own-scope data: in a TEACHER session the salary cache holds ONLY the
  // signed-in teacher's canonical rows (server-resolved).
  const role = useSalaryStore((s) => s.role)
  const me = useSalaryStore((s) => s.me)
  const structure = useSalaryStore((s) => s.structures[0] ?? null)
  const payments = useSalaryStore((s) => s.payments)
  const syncStatus = useSalaryStore((s) => s.syncStatus)
  const hydrate = useSalaryStore((s) => s.hydrate)

  const [payslipMonth, setPayslipMonth] = useState<PayslipMonth | null>(null)

  // Canonical hydration — once per session (guard inside the store).
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const myPayments = useMemo(
    () => [...payments].sort((a, b) => b.month.localeCompare(a.month) || b.paidOn.localeCompare(a.paidOn)),
    [payments],
  )
  const recordedPayments = myPayments.filter((p) => p.status === 'RECORDED')
  const latestRecorded = recordedPayments[0] ?? null

  // One row per month that has a payment, newest first.
  const payslipMonths = useMemo<PayslipMonth[]>(() => {
    const byMonth = new Map<string, SalaryPayment[]>()
    for (const p of myPayments) {
      const list = byMonth.get(p.month) ?? []
      list.push(p)
      byMonth.set(p.month, list)
    }
    return Array.from(byMonth.entries())
      .map(([month, list]) => {
        const primary = list.find((p) => p.status === 'RECORDED') ?? list[0]
        return { month, monthLabel: periodLabel(month), primary, payments: list }
      })
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [myPayments])

  // Identity: the server-resolved own teacher row (canonical Teacher id),
  // falling back to the store's cached `me` — never a guessed record.
  const teacherIdentity = useMemo(
    () => ({
      name: me?.name ?? 'Teacher',
      employeeId: me?.employeeId ?? '',
      department: me?.department ?? '',
    }),
    [me],
  )

  const handleDownloadPayslip = (m: PayslipMonth) => {
    if (m.primary.status !== 'RECORDED') return
    downloadTeacherPayslip({
      teacherName: teacherIdentity.name,
      employeeId: teacherIdentity.employeeId,
      designation: teacherIdentity.department,
      monthLabel: m.monthLabel,
      monthlySalary: structure?.monthlyAmount ?? 0,
      amountPaid: m.primary.amount,
      payment: {
        paidOn: m.primary.paidOn,
        method: m.primary.method ? methodLabel(m.primary.method) : null,
        reference: m.primary.reference,
      },
    })
    toast.success('Payslip downloaded', { description: `${m.monthLabel} · ${moneyMy(m.primary.amount)}` })
  }

  // ── Loading / not-available states (honest, never fabricated) ──────
  if (syncStatus === 'syncing' && payments.length === 0 && !structure) {
    return (
      <PageTransition className="space-y-4">
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 animate-pulse shadow-lg shadow-emerald-500/30" />
        </div>
        <p className="text-xs text-muted-foreground text-center">Loading your salary details…</p>
      </PageTransition>
    )
  }

  if (role === 'TEACHER' && !me) {
    return (
      <PageTransition>
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            Your staff record is not available yet — the office will publish your salary details.
          </p>
        </div>
      </PageTransition>
    )
  }

  // ── Summary cards ─────────────────────────────────────────────────
  const stats: HubStat[] = structure ? [
    {
      key: 'monthly', label: 'Monthly Salary', value: moneyMy(structure.monthlyAmount), icon: Wallet, tone: 'emerald',
      context: 'Fixed salary · per month',
    },
    ...(structure.effectiveFrom ? [{
      key: 'effective', label: 'Effective From', value: fmtDayYear(structure.effectiveFrom), icon: CalendarDays,
    }] : []),
    ...(latestRecorded ? [{
      key: 'latest', label: 'Latest Payment',
      value: moneyMy(latestRecorded.amount), icon: BadgeCheck,
      context: `${latestRecorded.month ? periodLabel(latestRecorded.month) : ''} · ${methodLabel(latestRecorded.method)}`,
    }] : []),
  ] : [
    {
      key: 'monthly', label: 'Monthly Salary', value: '—', icon: Wallet,
      context: 'Not configured yet',
    },
  ]

  return (
    <PageTransition className="space-y-4 sm:space-y-5">
      <ModuleToolbar
        context={`${teacherIdentity.name}${teacherIdentity.department ? ` · ${teacherIdentity.department}` : ''}`}
        action={<MonthlySalaryBadge />}
      />

      {syncStatus === 'error' && (
        <SyncErrorStrip onRetry={() => void hydrate({ force: true })} />
      )}

      {/* ── 1 · Current salary summary ─────────────────────────────── */}
      {structure ? (
        <HubStatCards stats={stats} />
      ) : (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            No monthly salary has been configured for you yet — the school office sets it.
          </p>
        </div>
      )}

      {/* ── 2 · Payslips ───────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-4 pt-4 pb-3 sm:px-5">
          <p className="text-sm font-bold">Payslips</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            A payslip is available for each month the school recorded your payment.
          </p>
        </div>
        {payslipMonths.length === 0 ? (
          <p className="border-t border-border py-6 text-center text-xs text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {payslipMonths.map((m) => {
              const recorded = m.primary.status === 'RECORDED'
              return (
                <div key={m.month} className="flex items-center gap-3 px-4 py-3 flex-wrap sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">
                      {m.monthLabel}
                      <span className="font-normal text-muted-foreground"> · Paid {moneyMy(m.primary.amount)}</span>
                    </p>
                    {!recorded && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        This payment entry was voided by the school
                      </p>
                    )}
                  </div>
                  {recorded
                    ? <PayslipStateBadge state="Recorded" label="Paid" />
                    : <PaymentStatusBadge status="VOIDED" />}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                      disabled={!recorded} onClick={() => setPayslipMonth(m)}
                    >
                      <FileText className="h-3.5 w-3.5" /> View Payslip
                    </Button>
                    <Button
                      variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                      disabled={!recorded} onClick={() => handleDownloadPayslip(m)}
                    >
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 3 · Payment history ────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-4 pt-4 pb-3 sm:px-5">
          <p className="text-sm font-bold">Payment History</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Every payment recorded by the school for your salary account.
          </p>
        </div>
        {myPayments.length === 0 ? (
          <p className="border-t border-border py-6 text-center text-xs text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Month</TableHead>
                  <TableHead className="h-9 px-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground text-right">Amount Paid</TableHead>
                  <TableHead className="h-9 px-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="h-9 px-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Paid Date</TableHead>
                  <TableHead className="h-9 px-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground text-right">Payslip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myPayments.map((p) => {
                  const month = payslipMonths.find((m) => m.month === p.month)
                  const slipReady = p.status === 'RECORDED'
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="px-3 py-2.5 text-xs font-semibold">{periodLabel(p.month)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-xs tabular-nums text-right font-bold">{moneyMy(p.amount)}</TableCell>
                      <TableCell className="px-3 py-2.5"><PaymentStatusBadge status={p.status} /></TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDay(p.paidOn)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right">
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 w-7 p-0"
                          disabled={!slipReady}
                          title={slipReady ? 'View payslip' : 'Payslip available for recorded payments'}
                          onClick={() => { if (month) setPayslipMonth(month) }}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span className="sr-only">View payslip for {periodLabel(p.month)}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Payslip document — the same slip the school issues, on screen */}
      <Dialog open={!!payslipMonth} onOpenChange={(o) => !o && setPayslipMonth(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {payslipMonth && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <FileText className="h-4 w-4" />
                  </span>
                  Payslip · {payslipMonth.monthLabel}
                </DialogTitle>
                <DialogDescription>
                  {payslipMonth.primary.status === 'RECORDED'
                    ? `Recorded by the school · ${fmtDayYear(payslipMonth.primary.paidOn)}`
                    : 'This payment entry was voided by the school'}
                </DialogDescription>
              </DialogHeader>

              <PayslipDocument
                teacher={teacherIdentity}
                structure={structure}
                periodKey={payslipMonth.month}
                payment={payslipMonth.primary.status === 'RECORDED' ? payslipMonth.primary : null}
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => handleDownloadPayslip(payslipMonth)}
                >
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageTransition>
  )
}
