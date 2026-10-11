'use client'

/**
 * FinanceStatementsSection — P&L · Balance Sheet · Cash Flow tabbed.
 *
 * BATCH2-B5 — HONEST STATEMENTS: the fabricated ₹-crore P&L / balance-
 * sheet / cash-flow figures from src/lib/mock/finance-dashboard.ts are
 * REMOVED. Scholario's server ledger covers FEE REVENUE only — there is
 * no expense / bank / asset ledger model yet. So this screen now shows:
 *
 *   · the REAL fee-revenue position from the server (GET /api/dashboard:
 *     Σ Fee.amount billed, Σ Fee.paid collected; outstanding from the
 *     live dues summary GET /api/fees/defaulters?summary=1) — clearly
 *     labelled fee-revenue-only;
 *   · every expense / other-income / asset / liability / equity /
 *     cash-flow line as a visually-distinct muted
 *     "requires expense ledger — not available" row — NEVER a currency
 *     figure.
 *
 * The one real balance-sheet line is Fees Receivable (the outstanding
 * dues the server ledger actually tracks); the one real cash-flow line
 * is operating inflows from fee collections (the server's SUCCESS
 * payment sums). Everything else honestly says it cannot be generated
 * yet. The CSV export carries the same truth (real numbers + explicit
 * not-available markers).
 */

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Banknote, FileText, Download, Info,
  ArrowUpRight, ArrowDownRight, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { downloadCSVFile, safeFileName } from '@/lib/download-file'
import { toCsv } from '@/lib/csv'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FinancePanel, UnavailableLine } from './finance-shared'
import { useServerResource, monthKeyToLabel, type SchoolDashboardPayload } from '../fees/use-fee-server-data'
import { toast } from 'sonner'

type StatementTab = 'pnl' | 'balance' | 'cashflow'

const NOT_AVAILABLE = 'requires expense ledger — not available'

/** Other income lines the old mock invented — now honest placeholders. */
const OTHER_INCOME_LINES = [
  'Transport fees', 'Admission fees', 'Donations & grants', 'Examination fees', 'Miscellaneous income',
]

/** Operating expense lines the old mock invented — now honest placeholders. */
const EXPENSE_LINES = [
  'Staff & payroll', 'Operations & maintenance', 'Utilities', 'Transport', 'Technology', 'Academic resources',
]

export function FinanceStatementsSection() {
  const [tab, setTab] = useState<StatementTab>('pnl')

  // ── server truth ───────────────────────────────────────────────────
  const dashboard = useServerResource<SchoolDashboardPayload>('/api/dashboard')
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  const stats = dashboard.data?.stats
  const billed = stats?.feesTotal
  const collected = stats?.feesPaid
  const outstanding =
    dues?.totalOutstanding ??
    (billed !== undefined && collected !== undefined ? Math.max(0, billed - collected) : undefined)
  const collectionRate = billed && billed > 0 && collected !== undefined ? Math.round((collected / billed) * 1000) / 10 : 0
  const studentsWithDues = dues?.defaulterCount

  // Monthly operating inflows — the server's SUCCESS payment sums (the
  // only cash-flow lines the ledger can honestly produce).
  const monthlyInflows = useMemo(
    () => (dashboard.data?.trend ?? []).map((m) => ({ label: monthKeyToLabel(m.month), amount: m.amount })),
    [dashboard.data],
  )
  const inflowTotal = monthlyInflows.reduce((s, m) => s + m.amount, 0)

  // Real CSV export — the exact rows the statements render: real numbers,
  // explicit not-available markers, no invented figures.
  const handleExport = () => {
    const rows: (string | number)[][] = [
      ['Fee revenue', 'Billed (fee ledger)', 'server', billed ?? '—'],
      ['Fee revenue', 'Collected (fee ledger)', 'server', collected ?? '—'],
      ['Fee revenue', 'Outstanding (dues aggregation)', 'server', outstanding ?? '—'],
      ['Fee revenue', 'Collection rate (%)', 'server', collectionRate],
      ['P&L', 'Other income lines', NOT_AVAILABLE, ''],
      ...EXPENSE_LINES.map((e) => ['P&L — Expenses', e, NOT_AVAILABLE, ''] as (string | number)[]),
      ['P&L', 'Net surplus', NOT_AVAILABLE, ''],
      ['Balance sheet', 'Fees receivable (outstanding dues)', 'server', outstanding ?? '—'],
      ['Balance sheet', 'Cash & bank / fixed assets', NOT_AVAILABLE, ''],
      ['Balance sheet', 'Liabilities & equity', NOT_AVAILABLE, ''],
      ['Balance sheet', 'Net worth', NOT_AVAILABLE, ''],
      ['Cash flow', 'Operating inflows — fee collections', 'server', inflowTotal],
      ...monthlyInflows.map((m) => ['Cash flow — monthly fee collections', m.label, 'server', m.amount] as (string | number)[]),
      ['Cash flow', 'Operating outflows', NOT_AVAILABLE, ''],
      ['Cash flow', 'Investing / financing activities', NOT_AVAILABLE, ''],
      ['Cash flow', 'Net cash change / closing balance', NOT_AVAILABLE, ''],
    ]
    const filename = safeFileName('statements-fee-revenue-only', 'csv')
    downloadCSVFile(toCsv(['Statement', 'Line', 'Source', 'Amount (INR)'], rows), filename)
    toast.success('Fee-revenue statement exported', { description: filename })
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Honest banner — replaces the old "illustrative" notice. These
          statements are NOT available in full: the platform has no
          expense/ledger model. Real figures below are fee-revenue-only. */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5"
        role="note"
        aria-label="Statements availability notice"
      >
        <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-foreground">
          <strong className="font-semibold">Statements are not available in full.</strong> Scholario&apos;s ledger
          records <strong className="font-semibold">fee revenue only</strong> — expense, bank, asset and liability
          books do not exist yet. Real figures below come from the server fee ledger and are labelled
          fee-revenue-only; every other line honestly says it requires an expense ledger.
        </p>
      </div>

      {/* Loading / error surfaces */}
      {dashboard.loading && (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading fee revenue figures">
          <div className="h-16 w-full animate-pulse rounded-xl bg-muted/40" />
          <div className="h-48 w-full animate-pulse rounded-xl bg-muted/40" />
        </div>
      )}
      {dashboard.error && dashboard.data === null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Fee revenue figures unavailable.</span> {dashboard.error}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={dashboard.reload}>
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </Button>
        </div>
      )}

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
          disabled={dashboard.loading}
        >
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {tab === 'pnl' && (
          <motion.div key="pnl" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <PnLStatement
              billed={billed}
              collected={collected}
              outstanding={outstanding}
              collectionRate={collectionRate}
            />
          </motion.div>
        )}
        {tab === 'balance' && (
          <motion.div key="balance" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <BalanceStatement outstanding={outstanding} studentsWithDues={studentsWithDues} />
          </motion.div>
        )}
        {tab === 'cashflow' && (
          <motion.div key="cashflow" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <CashFlowStatement monthlyInflows={monthlyInflows} inflowTotal={inflowTotal} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── P&L Statement ───────────────────────────────────────────────────

function PnLStatement({
  billed, collected, outstanding, collectionRate,
}: {
  billed: number | undefined
  collected: number | undefined
  outstanding: number | undefined
  collectionRate: number
}) {
  return (
    <div className="space-y-3">
      <FinancePanel
        title="Profit &amp; Loss Statement"
        subtitle="fee-revenue-only · expense lines require an expense ledger"
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-border/40">
          {/* Revenue — the fee ledger is real; other income is not. */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <ArrowUpRight className="h-3.5 w-3.5" /> Revenue
              </p>
              <p className="text-sm font-bold tabular-nums text-emerald-600">
                {collected !== undefined ? formatINR(collected) : '—'}
                <span className="ml-1.5 text-[9px] font-semibold text-muted-foreground">fee revenue only</span>
              </p>
            </div>
            <div className="space-y-1">
              {/* Real fee-revenue lines (server ledger). */}
              <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">Fee revenue — collected</p>
                  <p className="text-[9px] text-muted-foreground truncate">Σ Fee.paid · server fee ledger</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-semibold tabular-nums text-emerald-600">{collected !== undefined ? formatINR(collected, true) : '—'}</p>
                  <p className="text-[9px] tabular-nums text-muted-foreground">{collectionRate}% of billed</p>
                </div>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">Fee revenue — billed</p>
                  <p className="text-[9px] text-muted-foreground truncate">Σ Fee.amount · server fee ledger</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-semibold tabular-nums">{billed !== undefined ? formatINR(billed, true) : '—'}</p>
                  <p className="text-[9px] tabular-nums text-muted-foreground">{outstanding !== undefined ? `${formatINR(outstanding, true)} outstanding` : ''}</p>
                </div>
              </div>
              {OTHER_INCOME_LINES.map((label) => (
                <UnavailableLine key={label} label={label} note="no income ledger" />
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t-2 border-emerald-500/30">
              <p className="text-xs font-bold">Total Recorded Revenue</p>
              <p className="text-sm font-bold tabular-nums text-emerald-600">
                {collected !== undefined ? formatINR(collected) : '—'}
                <span className="ml-1.5 text-[9px] font-semibold text-muted-foreground">fee revenue only</span>
              </p>
            </div>
          </div>

          {/* Expenses — none recorded anywhere; every line is honest. */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <ArrowDownRight className="h-3.5 w-3.5" /> Expenses
              </p>
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border"
                title={NOT_AVAILABLE}
              >
                not recorded
              </span>
            </div>
            <div className="space-y-1">
              {EXPENSE_LINES.map((label) => (
                <UnavailableLine key={label} label={label} />
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t-2 border-rose-500/30 opacity-60">
              <p className="text-xs font-bold text-muted-foreground">Total Expenses</p>
              <span className="text-[9px] font-semibold text-muted-foreground">{NOT_AVAILABLE}</span>
            </div>
          </div>
        </div>

        {/* Net Surplus — cannot be derived without expenses. */}
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net Surplus</p>
              <p className="text-[10px] text-muted-foreground">revenue minus expenses — expenses are not recorded</p>
            </div>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground ring-1 ring-border shrink-0"
              title={NOT_AVAILABLE}
            >
              {NOT_AVAILABLE}
            </span>
          </div>
        </div>
      </FinancePanel>
    </div>
  )
}

// ─── Balance Sheet ────────────────────────────────────────────────────

function BalanceStatement({ outstanding, studentsWithDues }: { outstanding: number | undefined; studentsWithDues: number | undefined }) {
  return (
    <FinancePanel
      title="Balance Sheet"
      subtitle="as recorded now · fee-revenue-only"
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-border/40">
        {/* Assets — Fees Receivable is real; everything else is not. */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Assets</p>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border"
              title="only fees receivable is tracked by the server ledger"
            >
              1 of N lines live
            </span>
          </div>
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Receivables (server ledger)</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-1 border-b border-border/30">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">Fees Receivable</p>
                  <p className="text-[9px] text-muted-foreground truncate">
                    outstanding dues{studentsWithDues !== undefined ? ` · ${studentsWithDues} student${studentsWithDues === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <p className="text-[11px] tabular-nums font-semibold text-emerald-600">{outstanding !== undefined ? formatINR(outstanding, true) : '—'}</p>
              </div>
            </div>
          </div>
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Cash &amp; Fixed Assets</p>
            <div className="space-y-1">
              <UnavailableLine label="Cash &amp; Bank Balance" note="no bank ledger" />
              <UnavailableLine label="Fixed Assets (land, buildings, equipment)" note="no asset ledger" />
              <UnavailableLine label="Investments &amp; deposits" note="no asset ledger" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t-2 border-emerald-500/30 opacity-60">
            <p className="text-xs font-bold text-muted-foreground">Total Assets</p>
            <span className="text-[9px] font-semibold text-muted-foreground">{NOT_AVAILABLE}</span>
          </div>
        </div>

        {/* Liabilities + Equity — nothing recorded. */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Liabilities &amp; Equity</p>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border"
              title={NOT_AVAILABLE}
            >
              not recorded
            </span>
          </div>
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Current Liabilities</p>
            <div className="space-y-1">
              <UnavailableLine label="Salary payable" />
              <UnavailableLine label="Vendor payables" />
            </div>
          </div>
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Long-term Liabilities</p>
            <div className="space-y-1">
              <UnavailableLine label="Loans &amp; borrowings" />
            </div>
          </div>
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Equity</p>
            <div className="space-y-1">
              <UnavailableLine label="Corpus / reserves &amp; surplus" note="no equity ledger" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t-2 border-rose-500/30 opacity-60">
            <p className="text-xs font-bold text-muted-foreground">Total Liabilities + Equity</p>
            <span className="text-[9px] font-semibold text-muted-foreground">{NOT_AVAILABLE}</span>
          </div>
        </div>
      </div>

      {/* Net Worth — cannot be derived. */}
      <div className="border-t border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net Worth</p>
            <p className="text-[10px] text-muted-foreground">assets − liabilities — neither side is recorded</p>
          </div>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground ring-1 ring-border shrink-0"
            title={NOT_AVAILABLE}
          >
            {NOT_AVAILABLE}
          </span>
        </div>
      </div>
    </FinancePanel>
  )
}

// ─── Cash Flow Statement ─────────────────────────────────────────────

function CashFlowStatement({ monthlyInflows, inflowTotal }: {
  monthlyInflows: Array<{ label: string; amount: number }>
  inflowTotal: number
}) {
  return (
    <FinancePanel
      title="Cash Flow Statement"
      subtitle="operating inflows are real (fee collections); outflows are not recorded"
      bodyClassName="p-0"
    >
      <div className="divide-y divide-border/40">
        {/* Operating Activities — the fee-collection inflows are the one
            real cash-flow line the server ledger produces. */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Operating Activities — inflows</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">
              {formatINR(inflowTotal)}
              <span className="ml-1.5 text-[9px] font-semibold text-muted-foreground">fee collections</span>
            </p>
          </div>
          <div className="space-y-1">
            {monthlyInflows.length > 0 ? monthlyInflows.map((m) => (
              <div key={m.label} className="flex items-center justify-between py-1 text-[11px]">
                <span className="text-muted-foreground">Fee collections · {m.label}</span>
                <span className="text-emerald-600 tabular-nums">+{formatINR(m.amount, true)}</span>
              </div>
            )) : (
              <p className="py-2 text-[11px] text-muted-foreground">No collections recorded yet.</p>
            )}
            <div className="flex items-center justify-between py-1 text-[11px] opacity-60">
              <span className="text-muted-foreground">Salary &amp; operating outflows</span>
              <span className="text-[9px] font-semibold text-muted-foreground">{NOT_AVAILABLE}</span>
            </div>
          </div>
        </div>

        {/* Investing Activities — nothing recorded. */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Investing Activities</p>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border"
              title={NOT_AVAILABLE}
            >
              not recorded
            </span>
          </div>
          <div className="space-y-1">
            <UnavailableLine label="Capital expenditure (labs, buses, infrastructure)" />
            <UnavailableLine label="Investment purchases / sales" />
          </div>
        </div>

        {/* Financing Activities — nothing recorded. */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">Financing Activities</p>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border"
              title={NOT_AVAILABLE}
            >
              not recorded
            </span>
          </div>
          <div className="space-y-1">
            <UnavailableLine label="Loan receipts / repayments" />
            <UnavailableLine label="Corpus contributions" />
          </div>
        </div>
      </div>

      {/* Summary — opening/net-change/closing cannot be derived without
          recorded outflows and bank balances. */}
      <div className="border-t border-border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted-foreground">Opening Cash Balance</p>
          <span className="text-[9px] font-semibold text-muted-foreground shrink-0" title={NOT_AVAILABLE}>{NOT_AVAILABLE}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted-foreground">Net Cash Change</p>
          <span className="text-[9px] font-semibold text-muted-foreground shrink-0" title={NOT_AVAILABLE}>{NOT_AVAILABLE}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Closing Cash Balance</p>
          <span className="text-[9px] font-semibold text-muted-foreground shrink-0" title={NOT_AVAILABLE}>{NOT_AVAILABLE}</span>
        </div>
      </div>
    </FinancePanel>
  )
}
