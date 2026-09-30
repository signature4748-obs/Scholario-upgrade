'use client'

/**
 * FinanceStatementsSection — P&L · Balance Sheet · Cash Flow tabbed.
 *
 * All numbers reconcile from the finance store.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Banknote, FileText, Download, Info,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFinanceData } from '@/lib/store/finance-store'
import { downloadCSVFile, safeFileName } from '@/lib/download-file'
import { toCsv } from '@/lib/csv'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FinancePanel } from './finance-shared'
import { toast } from 'sonner'

type StatementTab = 'pnl' | 'balance' | 'cashflow'

export function FinanceStatementsSection({ data }: { data: ReturnType<typeof useFinanceData> }) {
  const [tab, setTab] = useState<StatementTab>('pnl')

  // QA-FIX-A: REAL CSV export of the ACTIVE statement tab — the exact rows
  // the statement renders, with plain numbers (no ₹ in numeric cells).
  const handleExport = () => {
    let headers: string[] = []
    let rows: (string | number)[][] = []
    if (tab === 'pnl') {
      headers = ['Section', 'Category', 'Account', 'Amount (INR)', 'YoY Change (%)']
      rows = data.pnlData.map((p) => [
        p.type === 'income' ? 'Revenue' : 'Expenses', p.category, p.account, p.amount, p.yoyChange,
      ])
      rows.push(
        ['Summary', 'Total Revenue', '', data.totalRevenue, ''],
        ['Summary', 'Total Expenses', '', data.totalExpenses, ''],
        ['Summary', 'Net Surplus', '', data.netSurplus, data.surplusMargin],
      )
    } else if (tab === 'balance') {
      headers = ['Type', 'Category', 'Account', 'Amount (INR)']
      rows = data.balanceSheet.map((b) => [b.type, b.category, b.account, b.amount])
      rows.push(
        ['Summary', 'Assets', 'Total Assets', data.totalAssets],
        ['Summary', 'Liabilities', 'Total Liabilities', data.totalLiabilities],
        ['Summary', 'Equity', 'Total Equity', data.totalEquity],
        ['Summary', '', 'Net Worth', data.netWorth],
      )
    } else {
      headers = ['Activity', 'Description', 'Inflow (INR)', 'Outflow (INR)']
      rows = data.cashflow.map((c) => [c.activity, c.description, c.inflow, c.outflow])
      rows.push(
        ['Summary', 'Operating Activities Net', data.operatingNet, ''],
        ['Summary', 'Investing Activities Net', data.investingNet, ''],
        ['Summary', 'Financing Activities Net', data.financingNet, ''],
        ['Summary', 'Net Cash Change', data.netCashChange, ''],
        ['Summary', 'Opening Cash Balance', data.openingCash, ''],
        ['Summary', 'Closing Cash Balance', data.closingCash, ''],
      )
    }
    const filename = safeFileName(`${tab}-statement-illustrative-${data.period.id}`, 'csv')
    downloadCSVFile(toCsv(headers, rows), filename)
    toast.success('Illustrative statement exported', { description: filename })
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* FINAL-GATE honesty banner — these statements are ILLUSTRATIVE
          projections: fee revenue and payroll inputs flow from their live
          modules, but operating expenses, assets, liabilities and
          cash-flow lines have no recorded ledger behind them (an
          expense/ledger model is planned). A production principal must
          never read them as recorded accounts. */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5"
        role="note"
        aria-label="Illustrative statements notice"
      >
        <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-foreground">
          <strong className="font-semibold">Illustrative statements.</strong> Fee revenue and
          payroll figures flow from their live modules; operating expenses, assets and cash-flow
          lines are projections — no expense ledger is recorded yet. Do not read these as
          recorded accounts; they become fully live once the ledger model lands.
        </p>
      </div>

      {/* Statement tabs */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 w-max">
        {[
          { value: 'pnl' as const, label: 'Profit & Loss', icon: <FileText className="h-3.5 w-3.5" /> },
          { value: 'balance' as const, label: 'Balance Sheet', icon: <Wallet className="h-3.5 w-3.5" /> },
          { value: 'cashflow' as const, label: 'Cash Flow', icon: <Banknote className="h-3.5 w-3.5" /> },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5',
              tab === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1 ml-2"
          onClick={handleExport}
        >
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {tab === 'pnl' && (
          <motion.div key="pnl" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <PnLStatement data={data} />
          </motion.div>
        )}
        {tab === 'balance' && (
          <motion.div key="balance" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <BalanceStatement data={data} />
          </motion.div>
        )}
        {tab === 'cashflow' && (
          <motion.div key="cashflow" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <CashFlowStatement data={data} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── P&L Statement ───────────────────────────────────────────────────

function PnLStatement({ data }: { data: ReturnType<typeof useFinanceData> }) {
  const incomeItems = data.pnlData.filter((p) => p.type === 'income')
  const expenseItems = data.pnlData.filter((p) => p.type === 'expense')

  return (
    <div className="space-y-3">
      <FinancePanel
        title={`Profit & Loss Statement`}
        subtitle={data.period.label}
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-border/40">
          {/* Income */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <ArrowUpRight className="h-3.5 w-3.5" /> Revenue
              </p>
              <p className="text-sm font-bold tabular-nums text-emerald-600">{formatINR(data.totalRevenue)}</p>
            </div>
            <div className="space-y-1">
              {incomeItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">{item.category}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{item.account}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-semibold tabular-nums">{formatINR(item.amount, true)}</p>
                    <p className="text-[9px] tabular-nums text-emerald-600">+{item.yoyChange}%</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t-2 border-emerald-500/30">
              <p className="text-xs font-bold">Total Revenue</p>
              <p className="text-sm font-bold tabular-nums text-emerald-600">{formatINR(data.totalRevenue)}</p>
            </div>
          </div>

          {/* Expenses */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <ArrowDownRight className="h-3.5 w-3.5" /> Expenses
              </p>
              <p className="text-sm font-bold tabular-nums text-rose-600">{formatINR(data.totalExpenses)}</p>
            </div>
            <div className="space-y-1">
              {expenseItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">{item.category}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{item.account}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-semibold tabular-nums">{formatINR(item.amount, true)}</p>
                    <p className="text-[9px] tabular-nums text-rose-600">+{item.yoyChange}%</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t-2 border-rose-500/30">
              <p className="text-xs font-bold">Total Expenses</p>
              <p className="text-sm font-bold tabular-nums text-rose-600">{formatINR(data.totalExpenses)}</p>
            </div>
          </div>
        </div>

        {/* Net Surplus */}
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Net Surplus</p>
              <p className="text-[10px] text-muted-foreground">{data.surplusMargin}% surplus margin</p>
            </div>
            <p className={cn(
              'text-2xl font-bold tabular-nums',
              data.netSurplus >= 0 ? 'text-emerald-600' : 'text-rose-600',
            )}>
              {data.netSurplus >= 0 ? '+' : ''}{formatINR(data.netSurplus)}
            </p>
          </div>
        </div>
      </FinancePanel>
    </div>
  )
}

// ─── Balance Sheet ────────────────────────────────────────────────────

function BalanceStatement({ data }: { data: ReturnType<typeof useFinanceData> }) {
  const assets = data.balanceSheet.filter((b) => b.type === 'asset')
  const liabilities = data.balanceSheet.filter((b) => b.type === 'liability')
  const equity = data.balanceSheet.filter((b) => b.type === 'equity')

  return (
    <FinancePanel
      title="Balance Sheet"
      subtitle={`As of ${data.period.label}`}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-border/40">
        {/* Assets */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Assets</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">{formatINR(data.totalAssets)}</p>
          </div>
          {['Current Assets', 'Fixed Assets'].map((cat) => (
            <div key={cat} className="mb-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
              <div className="space-y-1">
                {assets.filter((a) => a.category === cat).map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
                    <p className="text-[11px] font-medium truncate">{a.account}</p>
                    <p className="text-[11px] tabular-nums">{formatINR(a.amount, true)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t-2 border-emerald-500/30">
            <p className="text-xs font-bold">Total Assets</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">{formatINR(data.totalAssets)}</p>
          </div>
        </div>

        {/* Liabilities + Equity */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Liabilities & Equity</p>
            <p className="text-sm font-bold tabular-nums text-rose-600">{formatINR(data.totalLiabilities + data.totalEquity)}</p>
          </div>
          {['Current Liabilities', 'Long-term Liabilities', 'Equity'].map((cat) => (
            <div key={cat} className="mb-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
              <div className="space-y-1">
                {liabilities.filter((l) => l.category === cat).concat(equity.filter((e) => e.category === cat)).map((l) => (
                  <div key={l.id} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
                    <p className="text-[11px] font-medium truncate">{l.account}</p>
                    <p className="text-[11px] tabular-nums">{formatINR(l.amount, true)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t-2 border-rose-500/30">
            <p className="text-xs font-bold">Total Liabilities + Equity</p>
            <p className="text-sm font-bold tabular-nums text-rose-600">{formatINR(data.totalLiabilities + data.totalEquity)}</p>
          </div>
        </div>
      </div>

      {/* Net Worth */}
      <div className="border-t border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider">Net Worth</p>
            <p className="text-[10px] text-muted-foreground">Assets − Liabilities</p>
          </div>
          <p className={cn(
            'text-2xl font-bold tabular-nums',
            data.netWorth >= 0 ? 'text-emerald-600' : 'text-rose-600',
          )}>
            {formatINR(data.netWorth)}
          </p>
        </div>
      </div>
    </FinancePanel>
  )
}

// ─── Cash Flow Statement ─────────────────────────────────────────────

function CashFlowStatement({ data }: { data: ReturnType<typeof useFinanceData> }) {
  const operating = data.cashflow.filter((c) => c.activity === 'operating')
  const investing = data.cashflow.filter((c) => c.activity === 'investing')
  const financing = data.cashflow.filter((c) => c.activity === 'financing')

  return (
    <FinancePanel
      title="Cash Flow Statement"
      subtitle={data.period.label}
      bodyClassName="p-0"
    >
      <div className="divide-y divide-border/40">
        {/* Operating Activities */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Operating Activities</p>
            <p className={cn('text-sm font-bold tabular-nums', data.operatingNet >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {data.operatingNet >= 0 ? '+' : ''}{formatINR(data.operatingNet)}
            </p>
          </div>
          <div className="space-y-1">
            {operating.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-muted-foreground">{c.description}</span>
                <div className="flex items-center gap-3">
                  {c.inflow > 0 && <span className="text-emerald-600 tabular-nums">+{formatINR(c.inflow, true)}</span>}
                  {c.outflow > 0 && <span className="text-rose-600 tabular-nums">-{formatINR(c.outflow, true)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Investing Activities */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Investing Activities</p>
            <p className={cn('text-sm font-bold tabular-nums', data.investingNet >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {data.investingNet >= 0 ? '+' : ''}{formatINR(data.investingNet)}
            </p>
          </div>
          <div className="space-y-1">
            {investing.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-muted-foreground">{c.description}</span>
                <div className="flex items-center gap-3">
                  {c.inflow > 0 && <span className="text-emerald-600 tabular-nums">+{formatINR(c.inflow, true)}</span>}
                  {c.outflow > 0 && <span className="text-rose-600 tabular-nums">-{formatINR(c.outflow, true)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Financing Activities */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">Financing Activities</p>
            <p className={cn('text-sm font-bold tabular-nums', data.financingNet >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {data.financingNet >= 0 ? '+' : ''}{formatINR(data.financingNet)}
            </p>
          </div>
          <div className="space-y-1">
            {financing.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-muted-foreground">{c.description}</span>
                <div className="flex items-center gap-3">
                  {c.inflow > 0 && <span className="text-emerald-600 tabular-nums">+{formatINR(c.inflow, true)}</span>}
                  {c.outflow > 0 && <span className="text-rose-600 tabular-nums">-{formatINR(c.outflow, true)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="border-t border-border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Opening Cash Balance</p>
          <p className="text-sm font-bold tabular-nums">{formatINR(data.openingCash)}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Net Cash Change</p>
          <p className={cn('text-sm font-bold tabular-nums', data.netCashChange >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {data.netCashChange >= 0 ? '+' : ''}{formatINR(data.netCashChange)}
          </p>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs font-bold uppercase tracking-wider">Closing Cash Balance</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatINR(data.closingCash)}</p>
        </div>
      </div>
    </FinancePanel>
  )
}
