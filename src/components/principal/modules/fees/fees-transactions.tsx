'use client'

/**
 * FeesTransactionsSection — serious financial transaction table.
 *
 * BATCH2-B5 — SERVER TRUTH: the ledger rows come from
 * GET /api/fees/transactions (the canonical FeeTransaction table — the
 * same rows the verification queue, receipts and webhook settlements
 * read), never the client fee-store. Amounts, statuses, receipts and
 * settlement references are exactly what the server recorded.
 *
 * - KPI cards in the shared Overview SummaryCard language (SaaS-STAGE-1):
 *   Transactions · Total Collected · Avg. Transaction
 * - Filters: search, class, mode, status, fee head, SOURCE
 *   (Office / Teacher / Class Teacher / Online — operational source;
 *   gateway is a channel, never a source).
 * - Row actions: View (canonical receipt document served by
 *   GET /api/fees/receipts/[txnId]) and Print (same document, print
 *   dialog auto-opens — File → Save as PDF is the export path).
 * - Row click: opens a slide-from-right Transaction Detail Drawer showing
 *   student info, fee info, payment info, gateway + settlement info (if
 *   available), rejection info, and the linked fee's live outstanding
 *   balance (from GET /api/fees?studentId=).
 * - Loading / error-with-retry / empty states for every surface.
 */

import { useMemo, useState } from 'react'
import {
  Download, Printer, Eye,
  Receipt as ReceiptIcon, User, Calendar,
  CreditCard, Landmark, ArrowRightLeft, ShieldCheck, AlertCircle,
  FileText, Banknote,
  ArrowUpRight, ReceiptText, IndianRupee, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  useServerResource, serverMethodToMode, txnStatusToDisplay,
  type ServerFeeTxn, type ServerFeeRow,
} from './use-fee-server-data'
import type { CollectorRole } from '@/lib/store/fee-store'
import { formatINR, formatDate, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { FilterToolbar } from '../shared/filter-toolbar'
import { FeePanel, FeeEmptyState, ModeIcon, modeAccent, FeeStatusBadge, DateTimeText, SourceChip } from './fees-shared'
import { FeeReceiptViewer } from '@/components/shared/fee-collection/receipt-viewer'
import { methodLabel, sourceLabel, txnDateTime } from '@/components/shared/fee-collection/txn-meta'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

// ─── source vocabulary (server FeeTransaction.source) ────────────────

const SOURCE_LABELS: Record<string, string> = {
  CLASS_TEACHER: 'Class Teacher',
  PRINCIPAL: 'Office (Principal)',
  SCHOOL_OFFICE: 'Office',
  ONLINE: 'Online',
  BANK_TRANSFER: 'Bank Transfer',
}

/** Server source → the shared SourceChip role vocabulary ('principal'
 *  renders as Office). */
function sourceRoleOf(source: string | null): CollectorRole {
  switch (source) {
    case 'CLASS_TEACHER': return 'class_teacher'
    case 'ONLINE': return 'self'
    default: return 'principal'
  }
}

/** Filter facet value for a row's operational source. */
function sourceKeyOf(source: string | null): string {
  switch (source) {
    case 'CLASS_TEACHER': return 'class_teacher'
    case 'ONLINE': return 'self'
    default: return 'office'
  }
}

interface Props {
  onCollect?: () => void
}

// Source facet options — the server's operational source vocabulary
// (Office / Class Teacher / Online student self-service).
const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'office', label: 'Office' },
  { value: 'class_teacher', label: 'Class Teacher' },
  { value: 'self', label: 'Online / Student' },
]

// Status filter options — server statuses mapped to the display vocabulary.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'UNDER_VERIFICATION', label: 'Under Verification' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
]

// Mode filter options — server method vocabulary.
const MODE_OPTIONS = [
  { value: 'all', label: 'All Modes' },
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'NET_BANKING', label: 'Net Banking' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
]

export function FeesTransactionsSection({ onCollect: _onCollect }: Props) {
  // ── the canonical server ledger ────────────────────────────────────
  const ledger = useServerResource<ServerFeeTxn[]>('/api/fees/transactions?limit=200')
  const transactions = useMemo(() => ledger.data ?? [], [ledger.data])

  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [classFilter, setClassFilter] = useState('all')
  const [feeHeadFilter, setFeeHeadFilter] = useState('all')
  // OPERATIONAL SOURCE filter (SaaS-STAGE-1) — Office / Teacher /
  // Class Teacher / Online. Gateway is a channel, not a source.
  const [sourceFilter, setSourceFilter] = useState('all')

  // Canonical receipt document (GET /api/fees/receipts/[txnId]).
  const [receiptTxn, setReceiptTxn] = useState<ServerFeeTxn | null>(null)
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(false)
  useDismissOnEscape(() => setReceiptTxn(null), !!receiptTxn)

  const [detailTxn, setDetailTxn] = useState<ServerFeeTxn | null>(null)

  const classes = useMemo(() => {
    const set = new Set(transactions.map((t) => t.className).filter((c): c is string => !!c))
    return Array.from(set).sort()
  }, [transactions])
  const feeHeads = useMemo(() => {
    const set = new Set(transactions.map((t) => t.feeHeadName).filter((h): h is string => !!h))
    return Array.from(set).sort()
  }, [transactions])

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const q = search.toLowerCase().trim()
      if (q && !(t.studentName ?? '').toLowerCase().includes(q) && !(t.receiptNo ?? '').toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false
      if (modeFilter !== 'all' && t.method !== modeFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (classFilter !== 'all' && t.className !== classFilter) return false
      if (feeHeadFilter !== 'all' && t.feeHeadName !== feeHeadFilter) return false
      if (sourceFilter !== 'all' && sourceKeyOf(t.source) !== sourceFilter) return false
      return true
    })
  }, [transactions, search, modeFilter, statusFilter, classFilter, feeHeadFilter, sourceFilter])

  // ─── Summary metrics ────────────────────────────────────────────────
  // Only count transactions with status === 'SUCCESS' for amount totals.
  // The Total count reflects ALL rows matching the current filters, and
  // the Success count shows how many of those have settled.
  const successFiltered = useMemo(
    () => filtered.filter((t) => t.status === 'SUCCESS'),
    [filtered],
  )
  const totalAmount = successFiltered.reduce((s, t) => s + t.amount, 0)
  const successCount = successFiltered.length
  const totalCount = filtered.length
  const avgAmount = successCount > 0 ? Math.round(totalAmount / successCount) : 0

  const activeFiltersCount = (modeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (classFilter !== 'all' ? 1 : 0) + (feeHeadFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0)

  // Reset ghost in the toolbar.
  const handleResetFilters = () => {
    setModeFilter('all'); setStatusFilter('all'); setClassFilter('all'); setFeeHeadFilter('all'); setSourceFilter('all')
  }

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.info('Nothing to export', { description: 'No transactions match the current filters.' })
      return
    }
    const headers = ['Receipt No', 'Transaction ID', 'Student', 'Class', 'Fee Head', 'Amount', 'Mode', 'Source', 'Status', 'Recorded At', 'Collected By', 'Verified By', 'Reference No', 'Gateway', 'Gateway Payment ID', 'Settlement Payout', 'Reconciliation']
    const rows = filtered.map((t) => [
      t.receiptNo ?? '', t.id, t.studentName ?? '', t.className ?? '', t.feeHeadName ?? '',
      String(t.amount), methodLabel(t.method), sourceLabel(t.source), txnStatusToDisplay(t.status),
      t.createdAt, t.collectedByName ?? '',
      t.verifiedByName ?? '', t.referenceNumber ?? '',
      t.gatewayName ?? '', t.gatewayPaymentId ?? '', t.settlement?.payoutId ?? '', t.reconciliationStatus,
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

  const openReceipt = (t: ServerFeeTxn, autoPrint: boolean) => {
    setReceiptAutoPrint(autoPrint)
    setReceiptTxn(t)
  }

  return (
    <div className="space-y-4">
      {/* 0 — hard error surface with retry */}
      {ledger.error && ledger.data === null && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Transaction ledger unavailable.</span> {ledger.error}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={ledger.reload}>
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {/* KPI cards — amounts from server rows, Success only; the
          Transactions card carries the success vs other split. */}
      <SummaryCardGrid columns={3}>
        <SummaryCard
          label="Transactions"
          value={ledger.loading ? '—' : totalCount}
          tone="slate"
          icon={<ReceiptText className="h-4 w-4" />}
          sub={ledger.loading ? 'loading…' : `${successCount} successful · ${totalCount - successCount} other`}
        />
        <SummaryCard
          label="Total Collected"
          value={ledger.loading ? '—' : formatINR(totalAmount, true)}
          tone="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
          sub="successful only · across filtered rows"
          delay={0.05}
        />
        <SummaryCard
          label="Avg. Transaction"
          value={ledger.loading ? '—' : formatINR(avgAmount, true)}
          tone="teal"
          icon={<ArrowUpRight className="h-4 w-4" />}
          sub="per successful payment"
          delay={0.1}
        />
      </SummaryCardGrid>

      {/* Toolbar — shared responsive FilterToolbar: desktop = search +
          Class/Mode/Status/Fee Head/Source inline; tablet/mobile = ONE
          compact Filters button → filter sheet. */}
      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search student / receipt / transaction ID…"
        activeCount={activeFiltersCount}
        onReset={handleResetFilters}
        filters={[
          { id: 'class', label: 'Class', value: classFilter, onChange: setClassFilter, placeholder: 'All Classes', options: [{ value: 'all', label: 'All Classes' }, ...classes.map((c) => ({ value: c, label: c }))] },
          { id: 'mode', label: 'Mode', value: modeFilter, onChange: setModeFilter, placeholder: 'All Modes', options: MODE_OPTIONS },
          { id: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter, placeholder: 'All Status', options: STATUS_OPTIONS },
          { id: 'head', label: 'Fee Head', value: feeHeadFilter, onChange: setFeeHeadFilter, placeholder: 'All Heads', options: [{ value: 'all', label: 'All Heads' }, ...feeHeads.map((h) => ({ value: h, label: h }))] },
          { id: 'source', label: 'Source', value: sourceFilter, onChange: setSourceFilter, placeholder: 'All Sources', options: SOURCE_OPTIONS },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        }
      />

      {/* Transactions table — module ledger recipe: flush p-0 body inside the
          rounded-xl bordered panel; SOLID sticky header row; py-2.5 text-xs
          cells; hover:bg-muted/30 rows */}
      <FeePanel bodyClassName="p-0">
        {ledger.loading ? (
          <div className="space-y-1 p-3" aria-busy="true" aria-label="Loading transactions">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
                <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted/50" />
                <div className="h-3 w-14 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        ) : (
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
                  const mode = serverMethodToMode(t.method)
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setDetailTxn(t)}
                    >
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{t.receiptNo ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs">
                        <p className="font-medium">{t.studentName ?? '—'}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{t.feeHeadName ?? '—'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{t.className ?? '—'}</td>
                      {/* Fee Head with the settlement payout reference when the
                          money moved through a gateway payout batch. */}
                      <td className="px-3 py-2.5 text-xs hidden md:table-cell max-w-[220px]">
                        <span className="block truncate text-muted-foreground" title={t.feeHeadName ?? ''}>{t.feeHeadName ?? '—'}</span>
                        {t.settlement?.payoutId && (
                          <span className="block truncate text-[10px] text-muted-foreground/75 mt-px" title={`Gateway payout ${t.settlement.payoutId} · ${t.settlement.status}`}>
                            <span aria-hidden>↳ </span>payout {t.settlement.payoutId}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{formatINR(t.amount)}</td>
                      <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1', modeAccent(mode))}>
                          <ModeIcon mode={mode} className="h-2.5 w-2.5" />
                          {mode}
                        </span>
                      </td>
                      {/* Operational source (SaaS-STAGE-1): shared chip vocabulary */}
                      <td className="px-3 py-2.5 text-center hidden xl:table-cell">
                        <SourceChip role={sourceRoleOf(t.source)} collectedBy={t.collectedByName ?? undefined} maxW="max-w-[120px]" />
                      </td>
                      <td className="px-3 py-2.5 text-center"><FeeStatusBadge status={txnStatusToDisplay(t.status)} /></td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                        <DateTimeText date={t.createdAt} instant={t.createdAt} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div
                          className="inline-flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button onClick={() => setDetailTxn(t)} className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-primary/10 transition-colors" title="View details" aria-label={`View details of ${t.receiptNo ?? t.id}`}>
                            <Eye className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => openReceipt(t, true)}
                            disabled={!t.receiptNo}
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title={t.receiptNo ? 'View / print receipt' : 'No receipt issued'} aria-label={`Print receipt ${t.receiptNo ?? ''}`}
                          >
                            <Printer className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="py-12"><FeeEmptyState icon={<ReceiptIcon className="h-6 w-6" />} title={transactions.length === 0 ? 'No transactions recorded yet' : 'No transactions match your filters'} description={transactions.length === 0 ? 'Payments recorded through any counter appear here as the school ledger.' : 'Try adjusting the search or filter criteria.'} /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </FeePanel>

      {/* Canonical receipt document — GET /api/fees/receipts/[txnId];
          the SAME receipt the verification workspace and teacher surfaces
          render. Print (and File → Save as PDF) through the viewer. */}
      <FeeReceiptViewer
        txnId={receiptTxn ? receiptTxn.id : null}
        open={!!receiptTxn}
        onOpenChange={(o) => { if (!o) setReceiptTxn(null) }}
        autoPrint={receiptAutoPrint}
      />

      {/* Transaction detail drawer (slide-from-right) */}
      <TransactionDetailDrawer
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
        onViewReceipt={(t) => openReceipt(t, false)}
        onPrint={(t) => openReceipt(t, true)}
      />
    </div>
  )
}

// ─── Transaction Detail Drawer ──────────────────────────────────────

interface DrawerProps {
  txn: ServerFeeTxn | null
  onClose: () => void
  onViewReceipt: (t: ServerFeeTxn) => void
  onPrint: (t: ServerFeeTxn) => void
}

function TransactionDetailDrawer({ txn, onClose, onViewReceipt, onPrint }: DrawerProps) {
  // Live fee position for the linked student — GET /api/fees?studentId=
  // (server truth for the outstanding balance line). Plain derivation —
  // no memo needed for a .find over the fetched rows.
  const feeRows = useServerResource<ServerFeeRow[]>(txn?.studentId ? `/api/fees?studentId=${txn.studentId}` : null)
  const linkedFee = txn?.feeId
    ? (feeRows.data ?? []).find((f) => f.id === txn.feeId) ?? null
    : null

  if (!txn) return null

  const hasGateway = !!txn.gatewayName || !!txn.gatewayPaymentId || !!txn.gatewayOrderId || !!txn.settlement
  const isRejected = txn.status === 'REJECTED'

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
            {txn.receiptNo ?? 'No receipt issued'} · {txn.id}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Status banner */}
          <div className={cn(
            'rounded-lg border px-3 py-2 flex items-center justify-between',
            txn.status === 'SUCCESS' && 'bg-emerald-500/[0.04] border-emerald-500/20',
            txn.status === 'PENDING' && 'bg-amber-500/[0.04] border-amber-500/20',
            txn.status === 'UNDER_VERIFICATION' && 'bg-sky-500/[0.04] border-sky-500/20',
            (txn.status === 'FAILED' || txn.status === 'REJECTED') && 'bg-rose-500/[0.04] border-rose-500/20',
            txn.status === 'REFUNDED' && 'bg-violet-500/[0.04] border-violet-500/20',
          )}>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Status</p>
              <p className="text-base font-bold mt-0.5">{txnStatusToDisplay(txn.status)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Amount</p>
              <p className={cn('text-xl font-bold tabular-nums mt-0.5', txn.status === 'SUCCESS' ? 'text-emerald-600' : (txn.status === 'FAILED' || txn.status === 'REJECTED') ? 'text-rose-600' : '')}>
                {formatINR(txn.amount)}
              </p>
            </div>
          </div>

          {/* Student info */}
          <DetailSection icon={<User className="h-3.5 w-3.5" />} title="Student Information">
            <DetailRow label="Student Name" value={txn.studentName ?? '—'} />
            <DetailRow label="Class" value={txn.className ?? '—'} />
          </DetailSection>

          {/* Fee info */}
          <DetailSection icon={<FileText className="h-3.5 w-3.5" />} title="Fee Information">
            <DetailRow label="Fee Head" value={txn.feeHeadName ?? '—'} />
            {linkedFee && (
              <>
                <DetailRow label="Fee Billed" value={formatINR(linkedFee.amount)} />
                <DetailRow label="Fee Paid (now)" value={formatINR(linkedFee.paid)} accent="emerald" />
                <DetailRow label="Fee Outstanding (now)" value={formatINR(Math.max(0, linkedFee.amount - linkedFee.paid))} accent="rose" />
              </>
            )}
          </DetailSection>

          {/* Payment info */}
          <DetailSection icon={<CreditCard className="h-3.5 w-3.5" />} title="Payment Information">
            <DetailRow
              label="Mode"
              value={
                <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1', modeAccent(serverMethodToMode(txn.method)))}>
                  <ModeIcon mode={serverMethodToMode(txn.method)} className="h-2.5 w-2.5" />
                  {methodLabel(txn.method)}
                </span>
              }
            />
            <DetailRow label="Receipt No" value={txn.receiptNo ?? '—'} mono />
            <DetailRow label="Transaction ID" value={txn.id} mono />
            <DetailRow label="Recorded" value={txnDateTime(txn.createdAt)} />
            {txn.collectedAt && <DetailRow label="Collected At" value={txnDateTime(txn.collectedAt)} />}
            {txn.verifiedAt && <DetailRow label="Verified At" value={`${formatDate(txn.verifiedAt)} · ${formatRelativeTime(txn.verifiedAt)}`} />}
            {txn.referenceNumber && <DetailRow label="Reference No" value={txn.referenceNumber} mono />}
            {txn.note && <DetailRow label="Note" value={txn.note} />}
          </DetailSection>

          {/* Gateway info (only if applicable) */}
          {hasGateway && (
            <DetailSection icon={<Landmark className="h-3.5 w-3.5" />} title="Gateway Information">
              {txn.gatewayName && <DetailRow label="Gateway" value={<span className="capitalize">{txn.gatewayName}</span>} />}
              {txn.gatewayPaymentId && <DetailRow label="Gateway Payment ID" value={txn.gatewayPaymentId} mono />}
              {txn.gatewayOrderId && <DetailRow label="Gateway Order ID" value={txn.gatewayOrderId} mono />}
              {txn.settlement && (
                <DetailRow
                  label="Settlement"
                  value={
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold capitalize',
                      txn.settlement.status === 'settled' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      txn.settlement.status === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      txn.settlement.status === 'failed' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                      txn.settlement.status === 'reversed' && 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
                    )}>
                      {txn.settlement.status}
                    </span>
                  }
                />
              )}
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
            </DetailSection>
          )}

          {/* Rejection info (if applicable) */}
          {isRejected && (
            <DetailSection icon={<AlertCircle className="h-3.5 w-3.5" />} title="Rejection">
              {txn.rejectedByName && <DetailRow label="Rejected By" value={txn.rejectedByName} />}
              {txn.rejectedAt && <DetailRow label="Rejected At" value={txnDateTime(txn.rejectedAt)} />}
              <DetailRow label="Reason" value={txn.rejectionReason ?? '—'} />
            </DetailSection>
          )}

          {/* Offline info (when collected in person) */}
          {txn.collectedByName && (
            <DetailSection icon={<Banknote className="h-3.5 w-3.5" />} title="Collection">
              <DetailRow label="Collected By" value={txn.collectedByName} />
              <DetailRow label="Operational Source" value={SOURCE_LABELS[txn.source ?? ''] ?? txn.source ?? 'School Office'} />
              <DetailRow
                label="Verification"
                value={
                  txn.verifiedByName
                    ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-2.5 w-2.5" /> Verified by {txn.verifiedByName}</span>
                    : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">Pending verification</span>
                }
              />
            </DetailSection>
          )}

          {/* Audit info */}
          <DetailSection icon={<Calendar className="h-3.5 w-3.5" />} title="Audit Information">
            <DetailRow label="Recorded On" value={txnDateTime(txn.createdAt)} />
            <DetailRow label="Collected By" value={txn.collectedByName ?? '—'} />
            {txn.verifiedByName && <DetailRow label="Verified By" value={txn.verifiedByName} />}
            {txn.verifiedAt && <DetailRow label="Verified At" value={`${formatDate(txn.verifiedAt)} · ${formatRelativeTime(txn.verifiedAt)}`} />}
          </DetailSection>
        </div>

        {/* Footer actions — the canonical receipt document; Print also
            covers download via File → Save as PDF. */}
        <div className="border-t border-border bg-card px-4 py-3 flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!txn.receiptNo}
            onClick={() => onViewReceipt(txn)}
          >
            <Eye className="h-3.5 w-3.5" /> View Receipt
          </Button>
          <Button
            size="sm"
            className="gap-1 bg-emerald-600 hover:bg-emerald-700"
            disabled={!txn.receiptNo}
            onClick={() => onPrint(txn)}
          >
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!txn.receiptNo}
            onClick={() => onPrint(txn)}
          >
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
