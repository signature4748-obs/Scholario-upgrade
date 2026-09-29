'use client'

/**
 * RecentPayments — "Recent / Active Payments" panel on the Payments page
 * (PAY-REWORK-1 spec §8/§10/§12/§13/§20/§21 + FINAL PAYMENTS UI POLISH §1/§2).
 *
 *   Payments = NEW / ACTIONABLE payment activity.
 *   Transactions = the completed historical ledger.
 *
 * A payment stays here while it is NEW or ACTIONABLE — i.e. while it is
 * still awaiting verification, or until its receipt has been printed or
 * downloaded (receiptHandledAt). Once the receipt is issued the payment
 * LEAVES this list and settles into Transactions — the record itself is
 * NEVER deleted; it remains fully searchable in Transactions and on the
 * student's account. Gateway-confirmed payments arrive here already Paid
 * (never queued for manual verification) with receipt actions available
 * immediately.
 *
 * UI (FINAL PAYMENTS UI POLISH): the EXACT Transactions ledger table
 * recipe — sticky muted header (11px uppercase columns), py-2.5 rows,
 * border-t border-border/30, hover:bg-muted/30, mono receipt, mode chip
 * with the premium ModeIcon, subtle status pill, date + small secondary
 * time, and right-aligned icon actions. No oversized cards, no scan-line
 * paragraphs, no unnecessary descriptions.
 *
 * Bulk receipts: contextual selection — the bulk bar exists ONLY while a
 * selection is made (header checkbox column provides select-all; no
 * permanent toolbar). Pagination follows the paper-size setting
 * (A5 = 1 student/page, A4 = 2 students/page).
 */

import { useMemo, useState } from 'react'
import { ArrowRight, Printer, Download, X, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useFeeStore, useFeeData, type FeeTransaction } from '@/lib/store/fee-store'
import { useApplicationsStore } from '@/lib/store/applications-store'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Panel } from '../../shared/panel'
import { FeeStatusBadge, ModeIcon, modeAccent, paymentStatusLabel, TxnDateTime, txnRecordedAt, SourceChip } from '../fees-shared'
import { ReceiptRowActions, ReceiptViewDialog, printReceiptsA5Bulk, downloadReceiptsA5Bulk } from '../fee-receipt-a5'
import { toast } from 'sonner'

const MAX_ROWS = 8

export function RecentPayments({
  data,
  onOpenTransactions,
}: {
  data: ReturnType<typeof useFeeData>
  onOpenTransactions?: () => void
}) {
  const receiptSettings = useFeeStore((s) => s.receiptSettings)
  const applications = useApplicationsStore((s) => s.applications)
  // APPS-FIN-LINK-1 — application-bound payments (tour submissions) show
  // WHICH form they belong to. Content-addressed lookup: rows whose
  // application no longer resolves simply render without the sub-line.
  const appTitleById = useMemo(
    () => new Map(applications.map((a) => [a.id, a.title])) as Map<string, string>,
    [applications],
  )
  const { transactions } = data
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewing, setViewing] = useState<FeeTransaction | null>(null)

  // Recent / actionable slice — NEWEST FIRST regardless of store order
  // (seed rows arrive in ledger order; live rows are prepended). A payment
  // is actionable while it is pending/failed OR its receipt has not been
  // issued yet. As soon as the receipt is printed or downloaded the payment
  // settles into Transactions/history (never deleted).
  const recent = useMemo(
    () =>
      transactions
        .filter((t) => {
          if (t.status !== 'Success') return true // pending/failed = actionable
          return !t.receiptHandledAt // receipt issued → settled into Transactions
        })
        .slice()
        .sort(
          (a, b) => (txnRecordedAt(b)?.getTime() ?? 0) - (txnRecordedAt(a)?.getTime() ?? 0),
        ),
    [transactions],
  )

  const visible = recent.slice(0, MAX_ROWS)
  const overflow = recent.length - visible.length

  // Bulk selection works on receipt-able rows (verified payments).
  const selectable = visible.filter((t) => t.status === 'Success')
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id))
  const selectedItems = transactions
    .filter((t) => selected.has(t.id) && t.status === 'Success')
    .map((transaction) => ({ transaction }))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((_prev) => (allSelected ? new Set() : new Set(selectable.map((t) => t.id))))
  }

  const clearSelection = () => setSelected(new Set())

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return
    const ok = printReceiptsA5Bulk(selectedItems, receiptSettings)
    if (ok) {
      toast.success(`Printing ${selectedItems.length} receipt${selectedItems.length === 1 ? '' : 's'}`, {
        description: receiptSettings.paperSize === 'A4' ? '2 receipts per A4 sheet.' : 'One A5 sheet per payment.',
      })
      const mark = useFeeStore.getState().markReceiptHandled
      selectedItems.forEach(({ transaction }) => mark(transaction.id, 'Principal'))
      clearSelection()
    } else {
      toast.error('Pop-up blocked', { description: 'Allow pop-ups for this site to print receipts.' })
    }
  }

  const handleBulkDownload = () => {
    if (selectedItems.length === 0) return
    downloadReceiptsA5Bulk(selectedItems, receiptSettings)
    toast.success('Receipt file downloaded', {
      description:
        receiptSettings.paperSize === 'A4'
          ? `${Math.ceil(selectedItems.length / 2)} A4 sheet${selectedItems.length > 2 ? 's' : ''} · 2 receipts per sheet.`
          : `${selectedItems.length} A5 sheet${selectedItems.length === 1 ? '' : 's'} · one per payment.`,
    })
    const mark = useFeeStore.getState().markReceiptHandled
    selectedItems.forEach(({ transaction }) => mark(transaction.id, 'Principal'))
    clearSelection()
  }

  return (
    <Panel
      title="Recent Payments"
      subtitle={
        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{recent.length} recent · actionable</span>
          {selected.size > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {selected.size} selected
            </span>
          )}
        </span>
      }
      action={
        selected.size > 0 ? (
          /* Contextual bulk bar — exists only while a selection is made */
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={clearSelection}>
              <X className="h-3 w-3" /> Clear
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={handleBulkDownload}>
              <Download className="h-3 w-3" /> Download receipts
            </Button>
            <Button size="sm" className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleBulkPrint}>
              <Printer className="h-3 w-3" /> Print receipts
            </Button>
          </div>
        ) : (
          onOpenTransactions && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-muted-foreground" onClick={onOpenTransactions}>
              Transactions <ArrowRight className="h-3 w-3" />
            </Button>
          )
        )
      }
      bodyClassName="p-0"
      className={cn(selected.size > 0 && 'ring-1 ring-emerald-500/30')}
    >
      {recent.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs font-medium">No payments awaiting action</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">New collections and issued receipts appear here first — the complete history lives in Transactions.</p>
        </div>
      ) : (
        /* ONE Transactions-style table — sticky muted header, dense rows,
           right-aligned actions (FINAL PAYMENTS UI POLISH §1). */
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="h-10 bg-muted shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                {selectable.length > 0 && (
                  <th className="pl-3 pr-1 bg-muted">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all verified payments for bulk receipt actions"
                      className="h-3.5 w-3.5"
                    />
                  </th>
                )}
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden 2xl:table-cell">Receipt</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Student</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Class</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden md:table-cell">Fee Head</th>
                <th className="text-right px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Amount</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden sm:table-cell">Mode</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden md:table-cell">Source</th>
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Date</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Status</th>
                <th className="text-right pl-3 pr-4 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const canSelect = t.status === 'Success'
                return (
                  <tr
                    key={t.id}
                    className={cn(
                      'border-t border-border/30 hover:bg-muted/30 transition-colors',
                      selected.has(t.id) && 'bg-emerald-500/[0.04]',
                    )}
                  >
                    {selectable.length > 0 && (
                      <td className="pl-3 pr-1 py-2.5">
                        {canSelect ? (
                          <Checkbox
                            checked={selected.has(t.id)}
                            onCheckedChange={() => toggle(t.id)}
                            aria-label={`Select receipt ${t.receiptNo} for ${t.studentName}`}
                            className="h-3.5 w-3.5"
                          />
                        ) : (
                          <span className="block h-3.5 w-3.5" aria-hidden />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap hidden 2xl:table-cell">{t.receiptNo}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <p className="font-medium leading-tight">{t.studentName}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{t.admissionNo}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{t.className}</td>
                    <td className="px-3 py-2.5 text-xs hidden md:table-cell max-w-[220px]">
                      <span className="block truncate text-muted-foreground" title={t.feeHead}>{t.feeHead}</span>
                      {t.applicationId && appTitleById.get(t.applicationId) && (
                        <span
                          className="block truncate text-[10px] text-muted-foreground/75 mt-px"
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
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {/* Operational source (SaaS-STAGE-1): one shared chip —
                          Office / Teacher / Class Teacher / Student. */}
                      <SourceChip role={t.collectorRole} collectedBy={t.collectedBy} maxW="max-w-[130px]" />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                      <TxnDateTime transaction={t} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <FeeStatusBadge status={paymentStatusLabel(t.status, 'principal')} />
                    </td>
                    <td className="pl-3 pr-4 py-2.5 text-right">
                      {t.status === 'Success' ? (
                        <div className="inline-flex justify-end">
                          <ReceiptRowActions transaction={t} settings={receiptSettings} onView={setViewing} />
                        </div>
                      ) : (
                        <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                          {t.status === 'Under Verification' ? 'Awaiting verification' : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {overflow > 0 && (
        <button
          type="button"
          onClick={onOpenTransactions}
          className="w-full px-4 py-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1 border-t border-border/60"
        >
          {overflow} settled payment{overflow === 1 ? '' : 's'} in Transactions <ArrowRight className="h-3 w-3" />
        </button>
      )}

      {/* All-clear helper when everything has settled */}
      {recent.length > 0 && selectable.length > 0 && selected.size === 0 && recent.every((t) => t.status === 'Success' && t.receiptHandledAt) && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border/60 text-[10px] text-muted-foreground">
          <CheckCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
          All caught up — receipts issued. These payments now live in Transactions.
        </div>
      )}

      <ReceiptViewDialog
        transaction={viewing}
        settings={receiptSettings}
        open={viewing !== null}
        onOpenChange={(open) => { if (!open) setViewing(null) }}
      />
    </Panel>
  )
}
