'use client'

/**
 * FeesTransactionsSection — serious financial transaction table.
 *
 * - KPI cards in the shared Overview SummaryCard language (SaaS-STAGE-1):
 *   Transactions · Total Collected · Avg. Transaction
 * - Filters: search, class, mode, status, fee head, type, SOURCE
 *   (Office / Teacher / Class Teacher / Student — operational source;
 *   gateway is a channel, never a source). Desktop = inline selects via
 *   the shared FilterToolbar; tablet/mobile = ONE compact Filters button
 *   opening the filter sheet (reusable pattern for the whole app).
 * - Row actions: View, Print, Download (with tooltips) — no redundant Reprint
 * - Row click: opens a slide-from-right Transaction Detail Drawer showing
 *   student info, fee info, payment info, gateway info (if available),
 *   offline info, balance before/after, receipt actions, and audit info.
 *
 * Phase 4 fixes (FEE-SETTINGS-TXN):
 *   - Summary metrics count ONLY successful transactions for amounts
 *     (Total Amount / Avg. Transaction). The Transactions count shows the
 *     success vs other split so the operator sees settled vs pending.
 *   - Export generates a real CSV from the filtered rows.
 *   - Detail drawer wired to real FeeTransaction fields (incl. gateway,
 *     settlement, reconciliation, refund fields).
 *
 * SaaS-STAGE-1 receipt consolidation: ONE canonical A5/A4 dual-copy
 * receipt engine (fee-receipt-a5.tsx) — the legacy thermal renderer and
 * the '80mm' paper option are retired.
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Download, Printer, Eye,
  Receipt as ReceiptIcon, User, Calendar,
  CreditCard, Landmark, ArrowRightLeft, ShieldCheck, AlertCircle,
  FileText, Banknote, Smartphone, Wallet,
  ArrowUpRight, ReceiptText, IndianRupee,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  useFeeData, useFeeStore, txnCategory, collectorSourceLabel,
  type FeeTransaction, type PaymentMode, type PaymentStatus, type TransactionCategory,
} from '@/lib/store/fee-store'
import { useApplicationsStore } from '@/lib/store/applications-store'
import { formatINR, formatDate, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { FilterToolbar } from '../shared/filter-toolbar'
import { FeePanel, FeeEmptyState, ModeIcon, modeAccent, FeeStatusBadge, TxnDateTime, SourceChip, txnSourceKey } from './fees-shared'
import { FeeReceiptA5Preview, printReceiptA5, downloadReceiptA5 } from './fee-receipt-a5'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

// ─── Financial type badge (Core Fee / Examination Fee / Additional) ────

const TXN_TYPE_META: Record<TransactionCategory, { label: string; className: string }> = {
  CORE: { label: 'Core Fee', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20' },
  EXAMINATION: { label: 'Exam Fee', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/20' },
  ADDITIONAL: { label: 'Additional', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20' },
}

// Category dot tones used where the Type column merges into the Fee Head
// cell (spec §7): Core = emerald, Examination = cyan, Additional = violet.
const TXN_TYPE_DOT: Record<TransactionCategory, { label: string; dot: string }> = {
  CORE: { label: 'Core Fee', dot: 'bg-emerald-500' },
  EXAMINATION: { label: 'Examination Fee', dot: 'bg-cyan-500' },
  ADDITIONAL: { label: 'Additional Charge', dot: 'bg-violet-500' },
}

export function TransactionTypeBadge({ category, className }: { category: TransactionCategory; className?: string }) {
  const meta = TXN_TYPE_META[category] ?? TXN_TYPE_META.CORE
  return (
    <span className={cn('inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap', meta.className, className)}>
      {meta.label}
    </span>
  )
}

export function txnCategoryLabel(category: TransactionCategory): string {
  return (TXN_TYPE_META[category] ?? TXN_TYPE_META.CORE).label
}

interface Props {
  data: ReturnType<typeof useFeeData>
  onCollect?: () => void
}

// Mobile-only source facet label mapping (kept beside the table).
const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'office', label: 'Office' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'class_teacher', label: 'Class Teacher' },
  { value: 'self', label: 'Student self-service' },
]

export function FeesTransactionsSection({ data }: Props) {
  const { transactions, accounts } = data
  const receiptSettings = useFeeStore((s) => s.receiptSettings)
  const applications = useApplicationsStore((s) => s.applications)
  // APPS-FIN-LINK-1 — application-bound payments resolve to their form title
  // so the ledger (and the detail drawer) show WHICH application a payment
  // belongs to. Rows whose application no longer resolves render unchanged.
  const appTitleById = useMemo(
    () => new Map(applications.map((a) => [a.id, a.title])) as Map<string, string>,
    [applications],
  )

  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | PaymentMode>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all')
  const [classFilter, setClassFilter] = useState('all')
  const [feeHeadFilter, setFeeHeadFilter] = useState('all')
  // FINANCIAL TYPE filter — Core Fee / Examination Fee / Additional Charge.
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionCategory>('all')
  // OPERATIONAL SOURCE filter (SaaS-STAGE-1) — Office / Teacher /
  // Class Teacher / Student self-service. Gateway is a channel, not a source.
  const [sourceFilter, setSourceFilter] = useState('all')
  const [viewReceipt, setViewReceipt] = useState<FeeTransaction | null>(null)

  // Escape closes the receipt preview modal (backdrop click already does).
  useDismissOnEscape(() => setViewReceipt(null), !!viewReceipt)

  // Canonical A5/A4 receipt engine only (thermal consolidated away).
  const doPrint = (t: FeeTransaction) => {
    printReceiptA5(t, receiptSettings)
    useFeeStore.getState().markReceiptHandled(t.id, 'Principal')
    toast.success('Print dialog opened')
  }
  const doDownload = (t: FeeTransaction) => {
    downloadReceiptA5(t, receiptSettings)
    useFeeStore.getState().markReceiptHandled(t.id, 'Principal')
    toast.success('Receipt downloaded', { description: `${t.receiptNo}.html` })
  }
  const [detailTxn, setDetailTxn] = useState<FeeTransaction | null>(null)

  const classes = useMemo(() => {
    const set = new Set(transactions.map((t) => t.className))
    return Array.from(set).sort()
  }, [transactions])
  const feeHeads = useMemo(() => {
    const set = new Set(transactions.map((t) => t.feeHead))
    return Array.from(set).sort()
  }, [transactions])

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const q = search.toLowerCase().trim()
      if (q && !t.studentName.toLowerCase().includes(q) && !t.receiptNo.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q) && !t.admissionNo.toLowerCase().includes(q)) return false
      if (modeFilter !== 'all' && t.mode !== modeFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (classFilter !== 'all' && t.className !== classFilter) return false
      if (feeHeadFilter !== 'all' && t.feeHead !== feeHeadFilter) return false
      if (typeFilter !== 'all' && txnCategory(t) !== typeFilter) return false
      if (sourceFilter !== 'all' && txnSourceKey(t) !== sourceFilter) return false
      return true
    })
  }, [transactions, search, modeFilter, statusFilter, classFilter, feeHeadFilter, typeFilter, sourceFilter])

  // ─── Summary metrics (FIX) ────────────────────────────────────────
  // Only count transactions with status === 'Success' for amount totals.
  // The Total count reflects ALL rows matching the current filters, and
  // the Success count shows how many of those have settled — so the
  // operator sees pending/failed volume separately.
  const successFiltered = useMemo(
    () => filtered.filter((t) => t.status === 'Success'),
    [filtered],
  )
  const totalAmount = successFiltered.reduce((s, t) => s + t.amount, 0)
  const successCount = successFiltered.length
  const totalCount = filtered.length
  const avgAmount = successCount > 0 ? Math.round(totalAmount / successCount) : 0

  const activeFiltersCount = (modeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (classFilter !== 'all' ? 1 : 0) + (feeHeadFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0)

  // Reset ghost in the toolbar — same fields the old collapsible panel's
  // "Clear Filters" button cleared (search text intentionally untouched).
  const handleResetFilters = () => {
    setModeFilter('all'); setStatusFilter('all'); setClassFilter('all'); setFeeHeadFilter('all'); setTypeFilter('all'); setSourceFilter('all')
  }

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.info('Nothing to export', { description: 'No transactions match the current filters.' })
      return
    }
    const headers = ['Receipt No', 'Transaction ID', 'Student', 'Admission No', 'Class', 'Fee Head', 'Type', 'Amount', 'Mode', 'Source', 'Status', 'Date', 'Collected By', 'Verified By', 'Reference No', 'Gateway', 'Gateway Payment ID', 'Settlement ID', 'UTR', 'Academic Year']
    const rows = filtered.map((t) => [
      t.receiptNo, t.id, t.studentName, t.admissionNo, t.className, t.feeHead,
      txnCategoryLabel(txnCategory(t)),
      String(t.amount), t.mode, collectorSourceLabel(t.collectorRole), t.status, t.date, t.collectedBy,
      t.verifiedBy ?? '', t.referenceNo ?? '',
      t.gateway ?? '', t.gatewayPaymentId ?? '', t.settlementId ?? '', t.utr ?? '', t.academicYear,
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => {
        const s = String(c ?? '')
        // Quote + escape per RFC 4180
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Export downloaded', { description: `${filtered.length} transaction(s) exported to CSV.` })
  }

  return (
    <div className="space-y-4">
      {/* KPI cards — the shared Overview SummaryCard language (SaaS-STAGE-1):
          amounts from Success only; the Transactions card carries the
          success vs other split as its sub line. */}
      <SummaryCardGrid columns={3}>
        <SummaryCard
          label="Transactions"
          value={totalCount}
          tone="slate"
          icon={<ReceiptText className="h-4 w-4" />}
          sub={`${successCount} successful · ${totalCount - successCount} other`}
        />
        <SummaryCard
          label="Total Collected"
          value={formatINR(totalAmount, true)}
          tone="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
          sub="successful only · across filtered rows"
          delay={0.05}
        />
        <SummaryCard
          label="Avg. Transaction"
          value={formatINR(avgAmount, true)}
          tone="teal"
          icon={<ArrowUpRight className="h-4 w-4" />}
          sub="per successful payment"
          delay={0.1}
        />
      </SummaryCardGrid>

      {/* Toolbar — shared responsive FilterToolbar (SaaS-STAGE-1):
          desktop = search + Class/Mode/Status/Fee Head/Type/Source inline;
          tablet/mobile = ONE compact Filters button → filter sheet. */}
      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search student / receipt / transaction ID…"
        activeCount={activeFiltersCount}
        onReset={handleResetFilters}
        filters={[
          { id: 'class', label: 'Class', value: classFilter, onChange: setClassFilter, placeholder: 'All Classes', options: [{ value: 'all', label: 'All Classes' }, ...classes.map((c) => ({ value: c, label: c }))] },
          { id: 'mode', label: 'Mode', value: modeFilter, onChange: (v) => setModeFilter(v as 'all' | PaymentMode), placeholder: 'All Modes', options: [{ value: 'all', label: 'All Modes' }, { value: 'UPI', label: 'UPI' }, { value: 'Card', label: 'Card' }, { value: 'Net Banking', label: 'Net Banking' }, { value: 'Cash', label: 'Cash' }, { value: 'Cheque', label: 'Cheque' }, { value: 'Bank Transfer', label: 'Bank Transfer' }] },
          { id: 'status', label: 'Status', value: statusFilter, onChange: (v) => setStatusFilter(v as 'all' | PaymentStatus), placeholder: 'All Status', options: [{ value: 'all', label: 'All Status' }, { value: 'Success', label: 'Success' }, { value: 'Pending', label: 'Pending' }, { value: 'Under Verification', label: 'Under Verification' }, { value: 'Failed', label: 'Failed' }, { value: 'Refunded', label: 'Refunded' }] },
          { id: 'head', label: 'Fee Head', value: feeHeadFilter, onChange: setFeeHeadFilter, placeholder: 'All Heads', options: [{ value: 'all', label: 'All Heads' }, ...feeHeads.map((h) => ({ value: h, label: h }))] },
          { id: 'type', label: 'Type', value: typeFilter, onChange: (v) => setTypeFilter(v as 'all' | TransactionCategory), placeholder: 'All Types', options: [{ value: 'all', label: 'All Types' }, { value: 'CORE', label: 'Core Fee' }, { value: 'EXAMINATION', label: 'Examination Fee' }, { value: 'ADDITIONAL', label: 'Additional Charge' }] },
          { id: 'source', label: 'Source', value: sourceFilter, onChange: setSourceFilter, placeholder: 'All Sources', options: SOURCE_OPTIONS },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        }
      />

      {/* Transactions table — module ledger recipe: flush p-0 body inside the
          rounded-xl bordered panel; SOLID sticky header row (opaque bg so
          scrolled rows never bleed through — the old muted/40 translucent
          tint let the first row show through the header); py-2.5 text-xs
          cells; hover:bg-muted/30 rows */}
      <FeePanel bodyClassName="p-0">
        <div className="overflow-x-auto max-h-[36rem]">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="h-10 bg-muted shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Receipt</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Student</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Class</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden md:table-cell">Fee Head</th>
                <th className="text-right px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Amount</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden sm:table-cell">Mode</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden xl:table-cell">Source</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Status</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Date</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const dotMeta = TXN_TYPE_DOT[txnCategory(t)] ?? TXN_TYPE_DOT.CORE
                return (
                  <tr
                    key={t.id}
                    className="border-t border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setDetailTxn(t)}
                  >
                    <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{t.receiptNo}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <p className="font-medium">{t.studentName}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{t.admissionNo}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{t.className}</td>
                    {/* Fee Head + merged category chip (Type column removed): tiny
                        colored dot — Core emerald / Exam cyan / Additional violet */}
                    <td className="px-3 py-2.5 text-xs hidden md:table-cell max-w-[220px]">
                      <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full" title={`${dotMeta.label} · ${t.feeHead}`}>
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotMeta.dot)} aria-hidden />
                        <span className="truncate text-muted-foreground">{t.feeHead}</span>
                      </span>
                      {t.applicationId && appTitleById.get(t.applicationId) && (
                        <span
                          className="block truncate text-[10px] text-muted-foreground/75 mt-px pl-3"
                          title={`Payment linked to application: ${appTitleById.get(t.applicationId)}`}
                        >
                          <span aria-hidden>↳ </span>{appTitleById.get(t.applicationId)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{formatINR(t.amount)}</td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1', modeAccent(t.mode))}>
                        <ModeIcon mode={t.mode} className="h-2.5 w-2.5" />
                        {t.mode}
                      </span>
                    </td>
                    {/* Operational source (SaaS-STAGE-1): Office / Teacher /
                        Class Teacher / Student — never the gateway channel. */}
                    <td className="px-3 py-2.5 text-center hidden xl:table-cell">
                      <SourceChip role={t.collectorRole} collectedBy={t.collectedBy} maxW="max-w-[120px]" />
                    </td>
                    <td className="px-3 py-2.5 text-center"><FeeStatusBadge status={t.status} /></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap"><TxnDateTime transaction={t} /></td>
                    <td className="px-3 py-2.5 text-center">
                      <div
                        className="inline-flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => setDetailTxn(t)} className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-primary/10 transition-colors" title="View details" aria-label={`View details of ${t.receiptNo}`}>
                          <Eye className="h-3 w-3" />
                        </button>
                        <button onClick={() => doPrint(t)} className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Print receipt" aria-label={`Print receipt ${t.receiptNo}`}>
                          <Printer className="h-3 w-3" />
                        </button>
                        <button onClick={() => doDownload(t)} className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Download receipt" aria-label={`Download receipt ${t.receiptNo}`}>
                          <Download className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="py-12"><FeeEmptyState icon={<ReceiptIcon className="h-6 w-6" />} title="No transactions match your filters" description="Try adjusting the search or filter criteria." /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </FeePanel>

      {/* Receipt preview modal */}
      <AnimatePresence>
        {viewReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Receipt ${viewReceipt.receiptNo} preview`}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setViewReceipt(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-xl p-4 max-h-[90vh] overflow-y-auto w-[min(56rem,calc(100vw-2rem))]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* THE canonical A5/A4 dual-copy receipt (thermal consolidated away) */}
              <FeeReceiptA5Preview
                transaction={viewReceipt}
                settings={receiptSettings}
                onClose={() => setViewReceipt(null)}
                onPrint={() => doPrint(viewReceipt)}
                onDownload={() => doDownload(viewReceipt)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction detail drawer (slide-from-right) */}
      <TransactionDetailDrawer
        txn={detailTxn}
        accounts={accounts}
        receiptSettings={receiptSettings}
        applicationTitle={detailTxn?.applicationId ? appTitleById.get(detailTxn.applicationId) : undefined}
        onClose={() => setDetailTxn(null)}
        onViewReceipt={(t) => setViewReceipt(t)}
        onPrint={doPrint}
        onDownload={doDownload}
      />
    </div>
  )
}

// ─── Transaction Detail Drawer ──────────────────────────────────────

interface DrawerProps {
  txn: FeeTransaction | null
  accounts: ReturnType<typeof useFeeData>['accounts']
  receiptSettings: ReturnType<typeof useFeeStore.getState>['receiptSettings']
  /** Resolved application title when this payment is bound to an
   *  Applications & Forms submission (undefined otherwise). */
  applicationTitle?: string
  onClose: () => void
  onViewReceipt: (t: FeeTransaction) => void
  onPrint: (t: FeeTransaction) => void
  onDownload: (t: FeeTransaction) => void
}

function TransactionDetailDrawer({ txn, accounts, receiptSettings: _receiptSettings, applicationTitle, onClose, onViewReceipt, onPrint, onDownload }: DrawerProps) {
  if (!txn) return null

  // Look up the student account + ledger to compute balance before/after.
  const account = accounts.find((a) => a.studentId === txn.studentId)
  let balanceBefore: number | null = null
  let balanceAfter: number | null = null
  if (account) {
    const idx = account.ledger.findIndex((e) => e.id === `LED-${txn.studentId}-${txn.id}`)
    if (idx >= 0) {
      balanceAfter = account.ledger[idx].balance
      balanceBefore = idx > 0 ? account.ledger[idx - 1].balance : 0
    }
  }

  const isOnline = txn.paymentSource === 'online' || txn.paymentSource === 'gateway' || !!txn.gateway
  const hasGateway = !!txn.gateway || !!txn.gatewayPaymentId || !!txn.gatewayOrderId || !!txn.settlementId
  const isOffline = txn.paymentSource === 'offline' || ['Cash', 'Cheque', 'Bank Transfer'].includes(txn.mode)
  const isRefunded = txn.status === 'Refunded' || !!txn.refundedAmount

  return (
    <Sheet open={!!txn} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <ReceiptIcon className="h-4 w-4 text-emerald-600" />
            Transaction Detail
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            {txn.receiptNo} · {txn.id}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Status banner */}
          <div className={cn(
            'rounded-lg border px-3 py-2 flex items-center justify-between',
            txn.status === 'Success' && 'bg-emerald-500/[0.04] border-emerald-500/20',
            txn.status === 'Pending' && 'bg-amber-500/[0.04] border-amber-500/20',
            txn.status === 'Under Verification' && 'bg-sky-500/[0.04] border-sky-500/20',
            txn.status === 'Failed' && 'bg-rose-500/[0.04] border-rose-500/20',
            txn.status === 'Refunded' && 'bg-violet-500/[0.04] border-violet-500/20',
          )}>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Status</p>
              <p className="text-base font-bold mt-0.5">{txn.status}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Amount</p>
              <p className={cn('text-xl font-bold tabular-nums mt-0.5', txn.status === 'Success' ? 'text-emerald-600' : txn.status === 'Failed' ? 'text-rose-600' : '')}>
                {formatINR(txn.amount)}
              </p>
            </div>
          </div>

          {/* Student info */}
          <DetailSection icon={<User className="h-3.5 w-3.5" />} title="Student Information">
            <DetailRow label="Student Name" value={txn.studentName} />
            <DetailRow label="Admission No" value={txn.admissionNo} mono />
            <DetailRow label="Class" value={txn.className} />
            {account && <DetailRow label="Roll No" value={account.rollNo || '—'} />}
            {account && <DetailRow label="Guardian" value={`${account.guardianName} · ${account.guardianPhone}`} />}
          </DetailSection>

          {/* Fee info */}
          <DetailSection icon={<FileText className="h-3.5 w-3.5" />} title="Fee Information">
            <DetailRow
              label="Type"
              value={<TransactionTypeBadge category={txnCategory(txn)} />}
            />
            <DetailRow label="Fee Head / Charge" value={txn.feeHead} />
            {applicationTitle && <DetailRow label="Linked Application" value={applicationTitle} />}
            <DetailRow label="Purpose" value={txn.purpose} />
            <DetailRow label="Academic Year" value={txn.academicYear} />
            {account && (
              <>
                <DetailRow label="Net Payable" value={formatINR(account.netPayable)} />
                <DetailRow label="Outstanding" value={formatINR(account.outstanding)} />
              </>
            )}
          </DetailSection>

          {/* Payment info */}
          <DetailSection icon={<CreditCard className="h-3.5 w-3.5" />} title="Payment Information">
            <DetailRow
              label="Mode"
              value={
                <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1', modeAccent(txn.mode))}>
                  <ModeIcon mode={txn.mode} className="h-2.5 w-2.5" />
                  {txn.mode}
                </span>
              }
            />
            <DetailRow label="Status" value={<FeeStatusBadge status={txn.status} />} />
            <DetailRow label="Receipt No" value={txn.receiptNo} mono />
            <DetailRow label="Transaction ID" value={txn.id} mono />
            <DetailRow label="Date / Time" value={`${formatDate(txn.date)} ${txn.verifiedAt ? `· verified ${formatRelativeTime(txn.verifiedAt)}` : ''}`} />
            {txn.referenceNo && <DetailRow label="Reference No" value={txn.referenceNo} mono />}
            {txn.meta?.bankName && <DetailRow label="Bank" value={txn.meta.bankName} />}
            {txn.meta?.chequeNumber && <DetailRow label="Cheque No" value={`${txn.meta.chequeNumber}${txn.meta.chequeDate ? ` · ${formatDate(txn.meta.chequeDate)}` : ''}`} mono />}
            {txn.meta?.cardLast4 && <DetailRow label="Card Last 4" value={`**** ${txn.meta.cardLast4}`} mono />}
            {txn.meta?.upiId && <DetailRow label="UPI ID" value={txn.meta.upiId} mono />}
            {txn.meta?.neftUtr && <DetailRow label="NEFT UTR" value={txn.meta.neftUtr} mono />}
          </DetailSection>

          {/* Gateway info (only if applicable) */}
          {hasGateway && (
            <DetailSection icon={<Landmark className="h-3.5 w-3.5" />} title="Gateway Information">
              {txn.gateway && <DetailRow label="Gateway" value={<span className="capitalize">{txn.gateway}</span>} />}
              {txn.gatewayPaymentId && <DetailRow label="Gateway Payment ID" value={txn.gatewayPaymentId} mono />}
              {txn.gatewayOrderId && <DetailRow label="Gateway Order ID" value={txn.gatewayOrderId} mono />}
              {txn.settlementId && <DetailRow label="Settlement ID" value={txn.settlementId} mono />}
              {txn.settlementStatus && (
                <DetailRow
                  label="Settlement Status"
                  value={
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold capitalize',
                      txn.settlementStatus === 'settled' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      txn.settlementStatus === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      txn.settlementStatus === 'failed' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                      txn.settlementStatus === 'reversed' && 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
                    )}>
                      {txn.settlementStatus}
                    </span>
                  }
                />
              )}
              {txn.utr && <DetailRow label="UTR" value={txn.utr} mono />}
              {txn.gatewayFee !== undefined && <DetailRow label="Gateway Fee" value={formatINR(txn.gatewayFee)} accent="rose" />}
              {txn.taxOnFee !== undefined && <DetailRow label="Tax on Fee" value={formatINR(txn.taxOnFee)} accent="rose" />}
              {txn.netAmount !== undefined && <DetailRow label="Net Amount" value={formatINR(txn.netAmount)} accent="emerald" />}
              {txn.reconciliationStatus && (
                <DetailRow
                  label="Reconciliation"
                  value={
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold capitalize',
                      txn.reconciliationStatus === 'reconciled' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      txn.reconciliationStatus === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      txn.reconciliationStatus === 'unreconciled' && 'bg-muted text-muted-foreground',
                      txn.reconciliationStatus === 'exception' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                    )}>
                      <ArrowRightLeft className="h-2.5 w-2.5" />
                      {txn.reconciliationStatus}
                    </span>
                  }
                />
              )}
            </DetailSection>
          )}

          {/* Refund info (if applicable) */}
          {isRefunded && (
            <DetailSection icon={<AlertCircle className="h-3.5 w-3.5" />} title="Refund Information">
              {txn.refundedAmount !== undefined && <DetailRow label="Refunded Amount" value={formatINR(txn.refundedAmount)} accent="rose" />}
              {txn.refundReason && <DetailRow label="Reason" value={txn.refundReason} />}
            </DetailSection>
          )}

          {/* Offline info (if applicable) */}
          {isOffline && (
            <DetailSection icon={<Banknote className="h-3.5 w-3.5" />} title="Offline Collection">
              <DetailRow label="Collected By" value={txn.collectedBy} />
              <DetailRow
                label="Verification"
                value={
                  txn.verifiedBy
                    ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-2.5 w-2.5" /> Verified by {txn.verifiedBy}</span>
                    : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">Pending verification</span>
                }
              />
              {txn.verifiedAt && <DetailRow label="Verified At" value={`${formatDate(txn.verifiedAt)} · ${formatRelativeTime(txn.verifiedAt)}`} />}
            </DetailSection>
          )}

          {/* Online collection info (if applicable) */}
          {isOnline && !hasGateway && (
            <DetailSection icon={<Smartphone className="h-3.5 w-3.5" />} title="Online Collection">
              <DetailRow label="Collected By" value={txn.collectedBy} />
              <DetailRow label="Source" value={<span className="capitalize">{txn.paymentSource ?? 'online'}</span>} />
            </DetailSection>
          )}

          {/* Balance before / after (if computable from the student ledger) */}
          {balanceAfter !== null && (
            <DetailSection icon={<Wallet className="h-3.5 w-3.5" />} title="Account Balance Impact">
              <DetailRow label="Balance Before" value={balanceBefore !== null ? formatINR(Math.max(0, balanceBefore)) : '—'} />
              <DetailRow label="Payment Applied" value={`− ${formatINR(txn.amount)}`} accent="emerald" />
              <DetailRow label="Balance After" value={formatINR(Math.max(0, balanceAfter))} />
            </DetailSection>
          )}

          {/* Audit info */}
          <DetailSection icon={<Calendar className="h-3.5 w-3.5" />} title="Audit Information">
            <DetailRow label="Recorded On" value={formatDate(txn.date)} />
            <DetailRow label="Collected By" value={txn.collectedBy} />
            {txn.verifiedBy && <DetailRow label="Verified By" value={txn.verifiedBy} />}
            {txn.verifiedAt && <DetailRow label="Verified At" value={`${formatDate(txn.verifiedAt)} · ${formatRelativeTime(txn.verifiedAt)}`} />}
            <DetailRow label="Academic Year" value={txn.academicYear} />
          </DetailSection>
        </div>

        {/* Footer actions */}
        <div className="border-t border-border bg-card px-4 py-3 flex items-center gap-2 flex-wrap">
          <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onViewReceipt(txn)}>
            <Eye className="h-3.5 w-3.5" /> View Receipt
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => onPrint(txn)}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => onDownload(txn)}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
          </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Drawer sub-components ───────────────────────────────────────────

function DetailSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground">{icon}</span>
        <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">{title}</p>
      </div>
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 space-y-1">
        {children}
      </div>
    </div>
  )
}

function DetailRow({
  label, value, mono, accent,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  accent?: 'emerald' | 'rose' | 'amber'
}) {
  const accentClass = {
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
  }[accent ?? ''] ?? ''
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn('font-medium text-right min-w-0 break-words', mono && 'font-mono text-[10px]', accentClass)}>{value || '—'}</span>
    </div>
  )
}
