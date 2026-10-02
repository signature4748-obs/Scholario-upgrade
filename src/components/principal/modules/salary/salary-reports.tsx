'use client'

/**
 * SalaryReportsSection — month summary, department totals, method split,
 * and a CSV export of the month's canonical payments.
 *
 * PHASE 8B: every figure is a sum of RECORDED amounts from the canonical
 * ledger (voided rows are excluded from totals, kept in exports as the
 * audit trail). Department totals show the configured monthly-salary
 * commitment — no net/gross arithmetic exists.
 */

import { useMemo, useState } from 'react'
import { Check, Download, Landmark, Undo2, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSalaryStore, useSalaryData, periodOptions, periodLabel } from '@/lib/store/salary-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { SalaryPanel, CompactEmpty, moneyMy } from './salary-shared'

export function SalaryReportsSection() {
  const payments = useSalaryStore((s) => s.payments)
  const teacherNames = useSalaryStore((s) => s.teacherNames)
  const data = useSalaryData()
  const months = useMemo(() => periodOptions(6), [])
  const [month, setMonth] = useState(months[0])

  const monthPayments = useMemo(
    () => payments.filter((p) => p.month === month),
    [payments, month],
  )
  const recorded = monthPayments.filter((p) => p.status === 'RECORDED')
  const voided = monthPayments.filter((p) => p.status === 'VOIDED')

  const methods = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>()
    recorded.forEach((p) => {
      const key = p.method ?? '—'
      const cur = map.get(key) ?? { count: 0, amount: 0 }
      map.set(key, { count: cur.count + 1, amount: cur.amount + p.amount })
    })
    return Array.from(map.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount)
  }, [recorded])

  const recordedTotal = recorded.reduce((s, p) => s + p.amount, 0)
  const maxDept = Math.max(1, ...data.departmentTotals.map((d) => d.monthly))

  const handleExport = () => {
    const header = 'Teacher,Month,Amount,PaidOn,Method,Reference,Status,Note\n'
    const body = monthPayments
      .slice()
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
      .map((p) => [
        `"${teacherNames[p.teacherId] ?? '—'}"`, p.month, String(p.amount), p.paidOn.slice(0, 10),
        p.method ?? '', p.reference ?? '', p.status, (p.note ?? '').replace(/"/g, "'"),
      ].join(','))
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `salary-payments-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Export ready', { description: `salary-payments-${month}.csv` })
  }

  return (
    <div className="space-y-4">
      {/* Month + export toolbar — the "Reports" tab already establishes
          context, so no page heading. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="z-[70]">
              {months.map((m) => <SelectItem key={m} value={m} className="text-xs">{periodLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* KPIs for the selected month — Fee Management design language */}
      <SummaryCardGrid columns={4}>
        <SummaryCard icon={<Check className="h-4 w-4" />} label="Recorded" value={moneyMy(recordedTotal)} sub={`${recorded.length} payments`} tone="emerald" delay={0} />
        <SummaryCard icon={<Undo2 className="h-4 w-4" />} label="Voided" value={moneyMy(voided.reduce((s, p) => s + p.amount, 0))} sub={`${voided.length} entries (audit trail)`} tone="slate" delay={0.05} />
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Month Payroll" value={moneyMy(data.currentMonth.payable)} sub={`${data.analytics.configuredCount} salary set`} tone="sky" delay={0.1} />
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Staff" value={data.rows.length} sub={`${data.departmentTotals.length} departments`} tone="violet" delay={0.15} />
      </SummaryCardGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Department totals — configured monthly-salary commitment */}
        <SalaryPanel title="Monthly Salary by Department" subtitle={data.monthLabel}>
          {data.departmentTotals.length === 0 ? (
            <CompactEmpty icon={<Users className="h-3.5 w-3.5" />}>No teachers on the roster yet</CompactEmpty>
          ) : (
            <div className="space-y-2.5">
              {data.departmentTotals.map((d) => (
                <div key={d.dept}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium">{d.dept} <span className="text-muted-foreground">· {d.staff}</span></span>
                    <span className="tabular-nums text-muted-foreground">{moneyMy(d.monthly)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', d.recorded >= d.monthly && d.monthly > 0 ? 'bg-emerald-500' : 'bg-sky-500/70')}
                      style={{ width: `${Math.max(3, (d.monthly / maxDept) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SalaryPanel>

        {/* Method split (recorded, selected month) */}
        <SalaryPanel title="Recorded by Method" subtitle={periodLabel(month)}>
          {methods.length === 0 ? (
            <CompactEmpty icon={<Check className="h-3.5 w-3.5" />}>No recorded payments this month</CompactEmpty>
          ) : (
            <div className="space-y-2.5">
              {methods.map((m) => (
                <div key={m.method} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{m.method} <span className="text-muted-foreground">· {m.count}</span></span>
                      <span className="tabular-nums font-semibold">{moneyMy(m.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${recordedTotal > 0 ? Math.max(3, (m.amount / recordedTotal) * 100) : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SalaryPanel>
      </div>
    </div>
  )
}
