'use client'

/**
 * SalaryPayslipsSection — payslips for RECORDED payments.
 *
 * PHASE 8B: a salary slip is issued for each teacher-month whose payment
 * is RECORDED in the canonical ledger. Unpaid months and VOIDED rows
 * carry no active slip. Viewing a slip opens the school salary-slip
 * document (PayslipDocument) built from the same canonical structure +
 * payment rows the whole module uses.
 */

import { useMemo, useState } from 'react'
import { BadgeCheck, ChevronRight, FileText, Printer } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useSalaryStore, periodOptions, periodLabel,
} from '@/lib/store/salary-store'
import { useSalaryUI } from './salary-ui-context'
import { moneyMy, SalaryEmptyState } from './salary-shared'
import { PayslipDocument, printPayslip } from './payslip-document'

export function SalaryPayslipsSection() {
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)
  const { openEmployee } = useSalaryUI()

  const months = useMemo(() => periodOptions(6), [])
  const [month, setMonth] = useState(months[0])
  const [viewing, setViewing] = useState<string | null>(null) // teacherId

  // Only months with at least one RECORDED payment carry an issued slip.
  const rows = useMemo(() => {
    return teachers
      .map((t) => {
        const structure = structures.find((s) => s.teacherId === t.id) ?? null
        const monthPayments = payments.filter((p) => p.teacherId === t.id && p.month === month)
        const primary = monthPayments.find((p) => p.status === 'RECORDED') ?? null
        return { teacher: t, structure, primary, monthPayments }
      })
      .filter((r) => r.primary !== null) // ← issued slips only
      .sort((a, b) => a.teacher.name.localeCompare(b.teacher.name))
  }, [teachers, structures, payments, month])

  const viewRow = viewing ? rows.find((r) => r.teacher.id === viewing) ?? null : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[70]">
              {months.map((m) => <SelectItem key={m} value={m} className="text-xs">{periodLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {rows.length} issued {rows.length === 1 ? 'payslip' : 'payslips'}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <SalaryEmptyState
            icon={<FileText className="h-5 w-5" />}
            title={`No payslips for ${periodLabel(month)} yet`}
            description="A salary slip is issued when a payment is recorded for the month. Record it from the Payments tab."
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] min-h-[240px] overflow-y-auto salary-scroll">
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <button
                  key={r.teacher.id}
                  type="button"
                  onClick={() => setViewing(r.teacher.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[10px] font-semibold bg-muted">
                      {r.teacher.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{r.teacher.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {r.teacher.department || '—'} · {moneyMy(r.primary!.amount)}
                    </p>
                  </div>
                  <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Salary slip document */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
          {viewRow && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    <FileText className="h-4 w-4" />
                  </span>
                  Payslip · {periodLabel(month)}
                </DialogTitle>
                <DialogDescription>
                  {viewRow.teacher.name}
                  {viewRow.teacher.employeeId ? ` · ${viewRow.teacher.employeeId}` : ''}
                  {viewRow.teacher.department ? ` · ${viewRow.teacher.department}` : ''}
                </DialogDescription>
              </DialogHeader>

              <PayslipDocument
                teacher={viewRow.teacher}
                structure={viewRow.structure}
                periodKey={month}
                payment={viewRow.primary}
              />

              <div className="flex justify-between items-center gap-2 flex-wrap print:hidden">
                <Button
                  variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => printPayslip()}
                >
                  <Printer className="h-3.5 w-3.5" /> Print / Save PDF
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-8 text-xs"
                  onClick={() => { setViewing(null); openEmployee(viewRow.teacher.id) }}
                >
                  Open Payroll →
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
