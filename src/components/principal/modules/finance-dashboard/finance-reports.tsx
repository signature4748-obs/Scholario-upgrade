'use client'

/**
 * FinanceReportsSection — Finance reports that provide a unique cut of the
 * data (not duplicated by the Statements tab, which owns P&L / Balance
 * Sheet / Cash Flow).
 *
 * BATCH2-B5 — HONEST REPORTS: figures previously assembled from
 * src/lib/mock/finance-dashboard.ts (budgets, expense categories,
 * payables, loans, tax estimates) are REMOVED — those reports render
 * honest "requires expense ledger — not available" states. What remains
 * REAL:
 *   · Fee Revenue / Receivables — the server fee ledger (GET
 *     /api/dashboard aggregates + the live dues summary from
 *     GET /api/fees/defaulters?summary=1).
 *   · Payroll Expense — the Salary &amp; Payroll module's own figures
 *     (labelled as such).
 *   · Financial Summary — the real fee-revenue rows plus explicit
 *     not-available markers for every expense/asset/liability metric.
 * The CSV exports carry the same truth.
 *
 * 9 report types (picker kept):
 *   Financial Summary · Fee Revenue · Payroll Expense · Budget vs Actual ·
 *   Expense Report · Income Report · Receivables · Payables · Tax Summary
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileBarChart2, Download, TrendingUp, Receipt,
  ArrowDownRight, ArrowUpRight, IndianRupee, Users, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { useSalaryData } from '@/lib/store/salary-store'
import { downloadCSVFile, safeFileName } from '@/lib/download-file'
import { toCsv } from '@/lib/csv'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FinancePanel, FinanceEmptyState, UnavailableLine, UnavailableNote } from './finance-shared'
import { useServerResource, type SchoolDashboardPayload } from '../fees/use-fee-server-data'
import { toast } from 'sonner'

type ReportType =
  | 'summary' | 'fee-revenue' | 'payroll-expense' | 'budget' | 'expense'
  | 'income' | 'receivables' | 'payables' | 'tax'

interface ReportMeta {
  id: ReportType
  label: string
  description: string
  icon: React.ReactNode
  accent: string
}

const REPORTS: ReportMeta[] = [
  { id: 'summary', label: 'Financial Summary', description: 'Fee-ledger metrics · other books not recorded', icon: <TrendingUp className="h-4 w-4" />, accent: 'bg-emerald-500/10 text-emerald-600' },
  { id: 'fee-revenue', label: 'Fee Revenue', description: 'Fees collected (server ledger)', icon: <Receipt className="h-4 w-4" />, accent: 'bg-emerald-500/10 text-emerald-600' },
  { id: 'payroll-expense', label: 'Payroll Expense', description: 'Staff cost (payroll module)', icon: <Users className="h-4 w-4" />, accent: 'bg-amber-500/10 text-amber-600' },
  { id: 'budget', label: 'Budget vs Actual', description: 'Variance analysis', icon: <FileBarChart2 className="h-4 w-4" />, accent: 'bg-violet-500/10 text-violet-600' },
  { id: 'expense', label: 'Expense Report', description: 'All expenses by category', icon: <ArrowDownRight className="h-4 w-4" />, accent: 'bg-rose-500/10 text-rose-600' },
  { id: 'income', label: 'Income Report', description: 'All income sources', icon: <ArrowUpRight className="h-4 w-4" />, accent: 'bg-emerald-500/10 text-emerald-600' },
  { id: 'receivables', label: 'Receivables', description: 'Outstanding fees (server ledger)', icon: <Receipt className="h-4 w-4" />, accent: 'bg-amber-500/10 text-amber-600' },
  { id: 'payables', label: 'Payables', description: 'Pending obligations', icon: <ArrowDownRight className="h-4 w-4" />, accent: 'bg-rose-500/10 text-rose-600' },
  { id: 'tax', label: 'Tax Summary', description: 'TDS and tax liabilities', icon: <IndianRupee className="h-4 w-4" />, accent: 'bg-cyan-500/10 text-cyan-600' },
]

const NOT_AVAILABLE = 'requires expense ledger — not available'

export function FinanceReportsSection() {
  const [activeReport, setActiveReport] = useState<ReportType>('summary')
  const report = REPORTS.find((r) => r.id === activeReport)!

  // ── server truth ───────────────────────────────────────────────────
  const dashboard = useServerResource<SchoolDashboardPayload>('/api/dashboard')
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  // Payroll — the Salary & Payroll module's own figures (labelled).
  const salaryData = useSalaryData()

  const stats = dashboard.data?.stats
  const billed = stats?.feesTotal
  const collected = stats?.feesPaid
  const outstanding =
    dues?.totalOutstanding ??
    (billed !== undefined && collected !== undefined ? Math.max(0, billed - collected) : undefined)
  const collectionRate = billed && billed > 0 && collected !== undefined ? Math.round((collected / billed) * 1000) / 10 : 0
  const studentsWithDues = dues?.defaulterCount
  const monthlyPayroll = salaryData.analytics.monthlyPayroll
  const payrollBalance = salaryData.currentMonth.payable - salaryData.currentMonth.recorded

  // Real CSV export — mirrors the ReportBody tables: real numbers where
  // the ledger has them, explicit not-available markers elsewhere.
  const handleExportCsv = () => {
    const { headers, rows } = buildReportCsv(activeReport, {
      billed, collected, outstanding, collectionRate, studentsWithDues,
      monthlyPayroll, payrollBalance, monthLabel: salaryData.monthLabel,
      recordedCount: salaryData.currentMonth.recordedCount, staffCount: salaryData.rows.length,
    })
    const filename = safeFileName(`${activeReport}-report`, 'csv')
    downloadCSVFile(toCsv(headers, rows), filename)
    toast.success('Report exported', { description: filename })
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Hard error surface with retry */}
      {dashboard.error && dashboard.data === null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Fee-ledger figures unavailable.</span> {dashboard.error}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={dashboard.reload}>
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {/* Report picker */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {REPORTS.map((r, i) => (
          <motion.button
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => setActiveReport(r.id)}
            className={cn(
              'group rounded-lg border p-2.5 text-left transition-all',
              activeReport === r.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40',
            )}
          >
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-md mb-1.5', r.accent)}>
              {r.icon}
            </span>
            <p className="text-[11px] font-semibold leading-tight">{r.label}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{r.description}</p>
          </motion.button>
        ))}
      </div>

      {/* Active report */}
      <FinancePanel
        title={report.label}
        subtitle={report.description}
        action={<Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleExportCsv}>
          <Download className="h-3 w-3" /> Export CSV
        </Button>}
        bodyClassName="p-0"
      >
        <ReportBody
          type={activeReport}
          loading={dashboard.loading}
          billed={billed}
          collected={collected}
          outstanding={outstanding}
          collectionRate={collectionRate}
          studentsWithDues={studentsWithDues}
          monthlyPayroll={monthlyPayroll}
          payrollBalance={payrollBalance}
          monthLabel={salaryData.monthLabel}
          recordedCount={salaryData.currentMonth.recordedCount}
          staffCount={salaryData.rows.length}
        />
      </FinancePanel>
    </div>
  )
}

// ─── CSV twin (same values the tables show, plain numbers) ───────────

interface ReportFigures {
  billed: number | undefined
  collected: number | undefined
  outstanding: number | undefined
  collectionRate: number
  studentsWithDues: number | undefined
  monthlyPayroll: number
  payrollBalance: number
  monthLabel: string
  recordedCount: number
  staffCount: number
}

function buildReportCsv(
  type: ReportType,
  f: ReportFigures,
): { headers: string[]; rows: (string | number)[][] } {
  if (type === 'summary') {
    return {
      headers: ['Metric', 'Value', 'Source'],
      rows: [
        ['Fee Revenue (Collected)', f.collected ?? '—', 'server fee ledger'],
        ['Fee Revenue (Billed)', f.billed ?? '—', 'server fee ledger'],
        ['Fees Outstanding', f.outstanding ?? '—', 'server dues aggregation'],
        ['Collection Rate (%)', f.collectionRate, 'server fee ledger'],
        ['Monthly Payroll', f.monthlyPayroll, 'payroll module'],
        ['Total Expenses', NOT_AVAILABLE, ''],
        ['Net Surplus', NOT_AVAILABLE, ''],
        ['Cash Available', NOT_AVAILABLE, ''],
        ['Total Assets', NOT_AVAILABLE, ''],
        ['Total Liabilities', NOT_AVAILABLE, ''],
        ['Net Worth', NOT_AVAILABLE, ''],
      ],
    }
  }
  if (type === 'fee-revenue') {
    return {
      headers: ['Metric', 'Value'],
      rows: [
        ['Fee Revenue (Collected)', f.collected ?? '—'],
        ['Fee Expected (Billed)', f.billed ?? '—'],
        ['Outstanding Fees', f.outstanding ?? '—'],
        ['Collection Rate (%)', f.collectionRate],
        ['Students with Dues', f.studentsWithDues ?? '—'],
      ],
    }
  }
  if (type === 'payroll-expense') {
    return {
      headers: ['Metric', 'Monthly', 'Annualized', 'Source'],
      rows: [
        ['Monthly Payroll', f.monthlyPayroll, f.monthlyPayroll * 12, 'payroll module'],
        [`Unrecorded (${f.monthLabel})`, Math.max(0, f.payrollBalance), '', 'payroll module'],
        ['Recorded payments this month', `${f.recordedCount} of ${f.staffCount} staff`, '', 'payroll module'],
        ['Other staff costs', NOT_AVAILABLE, NOT_AVAILABLE, ''],
      ],
    }
  }
  if (type === 'income') {
    return {
      headers: ['Category', 'Amount (INR)', 'Source'],
      rows: [
        ['Fee revenue — collected', f.collected ?? '—', 'server fee ledger'],
        ['Fee revenue — billed', f.billed ?? '—', 'server fee ledger'],
        ['Transport / admissions / donations', NOT_AVAILABLE, ''],
        ['Total Recorded Revenue', f.collected ?? '—', 'fee revenue only'],
      ],
    }
  }
  if (type === 'receivables') {
    return {
      headers: ['Type', 'Amount (INR)', 'Count', 'Source'],
      rows: [
        ['Outstanding Fees', f.outstanding ?? '—', f.studentsWithDues ?? '—', 'server dues aggregation'],
        ['Other Receivables', NOT_AVAILABLE, '', ''],
        ['Total Receivables', NOT_AVAILABLE, '', ''],
      ],
    }
  }
  if (type === 'payables') {
    return {
      headers: ['Type', 'Amount (INR)', 'Source'],
      rows: [
        ['Payroll Payable', Math.max(0, f.payrollBalance), 'payroll module'],
        ['Vendor Payables', NOT_AVAILABLE, ''],
        ['Loans / long-term liabilities', NOT_AVAILABLE, ''],
        ['Total Payables', NOT_AVAILABLE, ''],
      ],
    }
  }
  // budget / expense / tax — nothing recorded.
  return {
    headers: ['Report', 'Availability'],
    rows: [[type, NOT_AVAILABLE]],
  }
}

// ─── Report bodies ───────────────────────────────────────────────────

function ReportBody({
  type, loading, billed, collected, outstanding, collectionRate, studentsWithDues,
  monthlyPayroll, payrollBalance, monthLabel, recordedCount, staffCount,
}: ReportFigures & { type: ReportType; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-1 p-3" aria-busy="true" aria-label="Loading report figures">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
            <div className="ml-auto h-3 w-20 animate-pulse rounded bg-muted/50" />
          </div>
        ))}
      </div>
    )
  }

  if (type === 'summary') {
    return (
      <ReportTable
        headers={['Metric', 'Value', 'Source']}
        rows={[
          ['Fee Revenue (Collected)', collected !== undefined ? formatINR(collected, true) : '—', 'server fee ledger'],
          ['Fee Revenue (Billed)', billed !== undefined ? formatINR(billed, true) : '—', 'server fee ledger'],
          ['Fees Outstanding', outstanding !== undefined ? formatINR(outstanding, true) : '—', 'server dues aggregation'],
          ['Collection Rate', `${collectionRate}%`, 'server fee ledger'],
          ['Monthly Payroll', formatINR(monthlyPayroll, true), 'payroll module'],
          ['Total Expenses', NOT_AVAILABLE, ''],
          ['Net Surplus', NOT_AVAILABLE, ''],
          ['Cash Available', NOT_AVAILABLE, ''],
          ['Total Assets / Liabilities / Net Worth', NOT_AVAILABLE, ''],
        ]}
      />
    )
  }

  if (type === 'fee-revenue') {
    return (
      <ReportTable
        headers={['Metric', 'Value']}
        rows={[
          ['Fee Revenue (Collected)', collected !== undefined ? formatINR(collected, true) : '—'],
          ['Fee Expected (Billed)', billed !== undefined ? formatINR(billed, true) : '—'],
          ['Outstanding Fees', outstanding !== undefined ? formatINR(outstanding, true) : '—'],
          ['Collection Rate', `${collectionRate}%`],
          ['Students with Dues', String(studentsWithDues ?? '—')],
        ]}
      />
    )
  }

  if (type === 'payroll-expense') {
    return (
      <ReportTable
        headers={['Metric', 'Monthly', 'Annualized', 'Source']}
        rows={[
          ['Monthly Payroll', formatINR(monthlyPayroll, true), formatINR(monthlyPayroll * 12, true), 'payroll module'],
          [`Unrecorded (${monthLabel})`, formatINR(Math.max(0, payrollBalance), true), '—', 'payroll module'],
          ['Recorded payments this month', `${recordedCount} of ${staffCount} staff`, '—', 'payroll module'],
          ['Other staff costs', NOT_AVAILABLE, NOT_AVAILABLE, ''],
        ]}
      />
    )
  }

  if (type === 'income') {
    return (
      <ReportTable
        headers={['Category', 'Amount', 'Source']}
        rows={[
          ['Fee revenue — collected', collected !== undefined ? formatINR(collected, true) : '—', 'server fee ledger'],
          ['Fee revenue — billed', billed !== undefined ? formatINR(billed, true) : '—', 'server fee ledger'],
          ['Transport fees', NOT_AVAILABLE, ''],
          ['Admission fees', NOT_AVAILABLE, ''],
          ['Donations & grants', NOT_AVAILABLE, ''],
        ]}
        totals={['Total Recorded Revenue', collected !== undefined ? formatINR(collected, true) : '—', 'fee revenue only']}
      />
    )
  }

  if (type === 'receivables') {
    return (
      <ReportTable
        headers={['Type', 'Amount', 'Count', 'Source']}
        rows={[
          ['Outstanding Fees', outstanding !== undefined ? formatINR(outstanding, true) : '—', studentsWithDues !== undefined ? `${studentsWithDues} students` : '—', 'server dues aggregation'],
          ['Other Receivables', NOT_AVAILABLE, '—', ''],
          ['Total Receivables', NOT_AVAILABLE, '—', ''],
        ]}
      />
    )
  }

  if (type === 'payables') {
    return (
      <ReportTable
        headers={['Type', 'Amount', 'Source']}
        rows={[
          ['Payroll Payable', formatINR(Math.max(0, payrollBalance), true), 'payroll module'],
          ['Vendor Payables', NOT_AVAILABLE, ''],
          ['Loan Repayment', NOT_AVAILABLE, ''],
          ['Total Payables', NOT_AVAILABLE, ''],
        ]}
      />
    )
  }

  // budget / expense / tax — honest unavailable state.
  return (
    <div className="p-4 space-y-3">
      <UnavailableNote>
        <strong className="font-semibold text-foreground">Not available.</strong> This report needs an
        expense / budget / tax ledger the platform has not built yet — Scholario&apos;s books record fee
        revenue (and payroll in the Salary &amp; Payroll module). No figures are shown because none are
        recorded.
      </UnavailableNote>
      <div className="space-y-1">
        {type === 'budget' && (
          <>
            <UnavailableLine label="Budget lines (salaries, operations, tech, academics)" note="no budget ledger" />
            <UnavailableLine label="Actual spend vs budget variance" note="no expense ledger" />
          </>
        )}
        {type === 'expense' && (
          <>
            <UnavailableLine label="Expense categories" />
            <UnavailableLine label="Vendor / utility / maintenance spend" />
          </>
        )}
        {type === 'tax' && (
          <>
            <UnavailableLine label="TDS filings" note="no tax ledger" />
            <UnavailableLine label="Provident fund / professional tax" note="no tax ledger" />
          </>
        )}
      </div>
    </div>
  )
}

function ReportTable({ headers, rows, totals }: { headers: string[]; rows: string[][]; totals?: string[] }) {
  return (
    <div className="overflow-x-auto max-h-[36rem]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={cn(
                'px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground',
                i === 0 ? 'text-left' : 'text-right',
              )}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
              {row.map((cell, j) => (
                <td key={j} className={cn(
                  'px-3 py-2 text-[11px]',
                  j === 0 ? 'text-left font-medium' : 'text-right tabular-nums',
                  cell.includes('not available') && 'text-muted-foreground',
                )}>{cell}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} className="py-8"><FinanceEmptyState icon={<FileBarChart2 className="h-6 w-6" />} title="No data" description="No records for this report." /></td></tr>
          )}
          {totals && rows.length > 0 && (
            <tr className="border-t-2 border-border bg-muted/40 font-bold">
              {totals.map((cell, j) => (
                <td key={j} className={cn(
                  'px-3 py-2 text-[11px]',
                  j === 0 ? 'text-left font-bold' : 'text-right tabular-nums font-bold',
                )}>{cell}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
