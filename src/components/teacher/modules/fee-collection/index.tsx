'use client'

/**
 * FeeCollectionModule — the Class Teacher's "Fees & Payments" workspace
 * (MASTER TASK §7, §13–§15, §25, §33–§34).
 *
 * Appointment-gated: the server only returns classes the signed-in
 * teacher is currently the class teacher of — no appointment means the
 * module honestly says so (§42).
 *
 * Composition (My-Timetable design language — one visual system):
 *   ModuleToolbar (scope line + Collect Fee) → class pills →
 *   CLASS FINANCIAL OVERVIEW (5 compact HubStatCards, class-level) →
 *   MONTH ACTIVITY (lightweight ‹ month › nav + month-scoped figures —
 *   a DIFFERENT purpose from the class overview, never a repeat) →
 *   compact filter toolbar → payment records SectionCard
 *   (table ≥ lg, stacked transaction cards below).
 *
 * Everything derives from ONE fetch of GET /api/teacher/fee-collection:
 *   · Collect Fee (STAGE 1 — honest "awaiting verification" result);
 *   · per-student ledger sheet + the shared receipt viewer.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GradientAvatar, PageTransition } from '@/components/shared/ui'
import { formatINR } from '@/lib/format'
import { useFocusStore } from '@/lib/store/focus-store'
import { FeeReceiptViewer } from '@/components/shared/fee-collection/receipt-viewer'
import { methodLabel, sourceLabel, sourceStory, txnDate, txnStatusMeta } from '@/components/shared/fee-collection/txn-meta'
import { useFeeCollection } from './hooks'
import type { FeeTxn } from './types'
import { CollectFeeDialog } from './collect-dialog'
import { StudentLedgerSheet } from './student-ledger'
import { HubStudentProfileSheet } from '../shared/hub-student-profile-sheet'
import { ModuleToolbar } from '../../teacher-panel/module-toolbar'
import {
  HubEmptyState,
  HubModuleSkeleton,
  HubSectionError,
  HubStatCards,
  type HubStat,
} from '../shared/hub-stat-cards'
import { ClassSelect } from '../shared/class-select'
import { SectionCard } from '../shared/section-card'
import {
  AlertTriangle, ArrowLeftRight, BadgeCheck, Banknote, CalendarDays, ChevronLeft,
  ChevronRight, Clock3, Receipt, Search, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected'
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Awaiting verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
]

export function FeeCollectionModule() {
  const { data, loading, error, reload, month: _month, changeMonth, collect } = useFeeCollection()
  const [classIdx, setClassIdx] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [methodFilter, setMethodFilter] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [collectOpen, setCollectOpen] = useState(false)
  const [collectStudent, setCollectStudent] = useState<string | undefined>(undefined)
  const [ledgerStudentId, setLedgerStudentId] = useState<string | null>(null)
  const [profileStudentId, setProfileStudentId] = useState<string | null>(null)
  const [receiptTxnId, setReceiptTxnId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)

  // Cross-module deep link (My Class → View collection / Fee Collection):
  // the focus store carries the exact class to open, consumed once on mount.
  useEffect(() => {
    const focus = useFocusStore.getState().focus
    if (focus && focus.type === 'class' && focus.moduleKey === 'fee-collection') {
      const idx = data?.classes.findIndex((c) => c.classId === focus.id) ?? -1
      if (idx >= 0) setClassIdx(idx)
      useFocusStore.getState().clearFocus()
    }
  }, [data])

  const klass = data?.classes?.[Math.min(classIdx, (data?.classes.length ?? 1) - 1)] ?? null
  const students = klass?.students ?? []
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])

  const filtered = useMemo(() => {
    let rows = klass?.transactions ?? []
    if (statusFilter === 'pending') rows = rows.filter((t) => t.status === 'UNDER_VERIFICATION')
    else if (statusFilter === 'verified') rows = rows.filter((t) => t.status === 'SUCCESS')
    else if (statusFilter === 'rejected') rows = rows.filter((t) => t.status === 'REJECTED')
    if (methodFilter !== 'ALL') rows = rows.filter((t) => t.method === methodFilter)
    if (sourceFilter !== 'ALL') rows = rows.filter((t) => t.source === sourceFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((t) =>
        (t.studentName ?? '').toLowerCase().includes(q) ||
        (t.feeHeadName ?? '').toLowerCase().includes(q) ||
        (t.receiptNo ?? '').toLowerCase().includes(q) ||
        (t.collectedBy ?? '').toLowerCase().includes(q))
    }
    return rows
  }, [klass, statusFilter, methodFilter, sourceFilter, search])

  const hasActiveFilter =
    statusFilter !== 'all' || methodFilter !== 'ALL' || sourceFilter !== 'ALL' || search.trim() !== ''

  // ── Unavailable / loading / error states (§42) ─────────────────────

  if (loading) {
    return <HubModuleSkeleton />
  }
  if (error) {
    return <HubSectionError message={error} onRetry={reload} />
  }
  if (!data || data.classes.length === 0) {
    return (
      <HubEmptyState
        icon={Wallet}
        title="Fees & Payments is unavailable"
        hint="You are not currently assigned as a Class Teacher, so there is no class fee collection for you to manage. Fee records become available the moment the Principal appoints you to a class."
      />
    )
  }

  const s = klass!.summary
  const collectedPct = s.totalBilled > 0 ? Math.round((s.collected / s.totalBilled) * 100) : 0

  /** CLASS-LEVEL financial overview (all-time). The month bar below has a
   *  different purpose (this month's activity) — figures must never repeat
   *  the same semantic without that context. */
  const stats: HubStat[] = [
    {
      key: 'billed',
      label: 'Total billed',
      value: formatINR(s.totalBilled, true),
      icon: Banknote,
      tone: 'slate',
      context: `${klass!.label} · ${klass!.studentCount} students`,
    },
    {
      key: 'collected',
      label: 'Verified collected',
      value: formatINR(s.collected, true),
      icon: BadgeCheck,
      tone: 'emerald',
      context: `${collectedPct}% of billed`,
    },
    {
      key: 'awaiting',
      label: 'Awaiting verification',
      value: formatINR(s.awaitingVerificationAmount, true),
      icon: Clock3,
      tone: s.awaitingVerificationCount > 0 ? 'amber' : 'slate',
      context:
        s.awaitingVerificationCount > 0
          ? `${s.awaitingVerificationCount} collection${s.awaitingVerificationCount === 1 ? '' : 's'} pending`
          : 'All collections verified',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: formatINR(s.outstanding, true),
      icon: ArrowLeftRight,
      tone: 'slate',
      context: `${s.fullyPaid} fully paid`,
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: String(s.overdueStudents),
      icon: AlertTriangle,
      tone: s.overdueStudents > 0 ? 'rose' : 'slate',
      context: s.overdueStudents > 0 ? 'students past due date' : 'no overdue students',
    },
  ]

  return (
    <PageTransition className="space-y-4">
      {/* quiet toolbar: scope line + Collect Fee (shell header carries the
          module name — never repeated here) */}
      <ModuleToolbar
        context="Collect payments for your class — every rupee is verified by the Principal before it becomes a final receipt."
        action={
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => { setCollectStudent(undefined); setCollectOpen(true) }}
          >
            <Wallet className="h-3.5 w-3.5" /> Collect Fee
          </Button>
        }
      />

      {/* Compact class selector (multi-class teachers only) — the SAME
          selector language as Student Growth / Directory / My Class */}
      {data.classes.length > 1 && (
        <ClassSelect
          classes={data.classes.map((c, i) => ({
            id: String(i),
            label: c.label,
            meta: String(c.studentCount),
          }))}
          value={String(Math.min(classIdx, data.classes.length - 1))}
          onChange={(id) => setClassIdx(Number(id ?? 0))}
          ariaLabel="Select class"
        />
      )}

      {/* CLASS FINANCIAL OVERVIEW — compact metric grid, one system with
          My Timetable. Mobile 2-col (5th metric spans both), tablet 3,
          desktop 5-across. */}
      <HubStatCards
        stats={stats}
        className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5 [&>*:nth-child(5)]:col-span-2 md:[&>*:nth-child(5)]:col-span-1"
      />

      {/* MONTH ACTIVITY — a lightweight period navigation control, NOT a
          card. Month-scoped figures only (the class overview above is
          all-time — different purpose, no duplication). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <p className="flex min-w-[9.5rem] items-center justify-center gap-1.5 text-sm font-semibold">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {klass!.month.label}
          </p>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeMonth(1)} aria-label="Next month">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            This month
          </span>
          <span className="text-muted-foreground">
            Verified{' '}
            <strong className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatINR(klass!.month.verifiedAmount, true)}
            </strong>{' '}
            <span className="text-muted-foreground/70">
              {klass!.month.verifiedCount} payment{klass!.month.verifiedCount === 1 ? '' : 's'}
            </span>
          </span>
          <span className="text-muted-foreground">
            Awaiting{' '}
            <strong className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {formatINR(klass!.month.pendingAmount, true)}
            </strong>{' '}
            <span className="text-muted-foreground/70">
              {klass!.month.pendingCount} payment{klass!.month.pendingCount === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      </div>

      {/* Compact filter toolbar — one wrapping row, no nested containers */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder="Search student, fee, receipt…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search payments"
          />
        </div>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="h-9 w-[8rem] text-xs" aria-label="Payment method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {['CASH', 'UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER'].map((m) => (
              <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-9 w-[9rem] text-xs" aria-label="Payment source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All sources</SelectItem>
            {['CLASS_TEACHER', 'SCHOOL_OFFICE', 'PRINCIPAL'].map((src) => (
              <SelectItem key={src} value={src}>{sourceLabel(src)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex w-full items-center gap-2 overflow-x-auto pb-0.5 sm:w-auto sm:flex-1 sm:pb-0">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors',
                statusFilter === f.key
                  ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
            Showing {filtered.length} of {klass!.transactions.length}
          </span>
        </div>
      </div>

      {/* Payment records — table ≥ lg (matches the shell sidebar
          breakpoint, same philosophy as My Timetable's grid), stacked
          transaction cards below. */}
      <SectionCard
        icon={Receipt}
        title="Payment records"
        meta={hasActiveFilter ? `${filtered.length} of ${klass!.transactions.length} shown` : `${klass!.transactions.length} total`}
        className="hidden lg:block"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Student</th>
                <th className="px-4 py-2.5 font-semibold">Fee</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Method</th>
                <th className="px-4 py-2.5 font-semibold">Source</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((t) => (
                <TxnRow
                  key={t.id}
                  txn={t}
                  onLedger={() => t.studentId && setLedgerStudentId(t.studentId)}
                  onReceipt={() => { setReceiptTxnId(t.id); setReceiptOpen(true) }}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    {hasActiveFilter ? 'No payments match these filters.' : 'No payments recorded for this class yet — collect your first fee.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Transaction cards — mobile + tablet portrait (§33) */}
      <div className="space-y-2.5 lg:hidden">
        {filtered.map((t) => (
          <MobileTxnCard
            key={t.id}
            txn={t}
            onLedger={() => t.studentId && setLedgerStudentId(t.studentId)}
            onReceipt={() => { setReceiptTxnId(t.id); setReceiptOpen(true) }}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
            {hasActiveFilter ? 'No payments match these filters.' : 'No payments recorded for this class yet.'}
          </div>
        )}
      </div>

      {/* Collect Fee (STAGE 1) */}
      {collectOpen && (
        <CollectFeeDialog
          open={collectOpen}
          onOpenChange={setCollectOpen}
          klass={klass!}
          studentId={collectStudent}
          onCollect={collect}
        />
      )}

      {/* Student ledger */}
      <StudentLedgerSheet
        student={ledgerStudentId ? (studentById.get(ledgerStudentId) ?? null) : null}
        open={!!ledgerStudentId}
        onOpenChange={(o) => { if (!o) setLedgerStudentId(null) }}
        txns={klass?.transactions ?? []}
        onCollect={(sid) => { setCollectStudent(sid); setCollectOpen(true) }}
        onViewReceipt={(id) => { setLedgerStudentId(null); setReceiptTxnId(id); setReceiptOpen(true) }}
        onViewProfile={(id) => setProfileStudentId(id)}
      />

      {/* The ONE canonical student profile (§25 — same canonical page as
          Directory / My Class; fee tab first for the fee workflow context) */}
      <HubStudentProfileSheet
        studentId={profileStudentId}
        onOpenChange={(o) => { if (!o) setProfileStudentId(null) }}
        initialTab={profileStudentId != null && ledgerStudentId != null ? 'fees' : undefined}
      />

      {/* Shared receipt viewer */}
      <FeeReceiptViewer txnId={receiptTxnId} open={receiptOpen} onOpenChange={setReceiptOpen} />
    </PageTransition>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────

function TxnRow({ txn, onLedger, onReceipt }: { txn: FeeTxn; onLedger: () => void; onReceipt: () => void }) {
  const meta = txnStatusMeta(txn.status)
  return (
    <tr className="group transition-colors hover:bg-muted/40">
      <td className="px-4 py-2.5">
        <button className="flex items-center gap-2.5 text-left" onClick={onLedger}>
          <GradientAvatar name={txn.studentName ?? 'Student'} size="sm" />
          <span className="min-w-0">
            <span className="block max-w-[10rem] truncate text-sm font-medium group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
              {txn.studentName ?? 'Student'}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">{txn.className ?? ''}</span>
          </span>
        </button>
      </td>
      <td className="max-w-[9rem] truncate px-4 py-2.5 text-xs text-muted-foreground" title={txn.feeHeadName ?? undefined}>{txn.feeHeadName ?? '—'}</td>
      <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">{formatINR(txn.amount, true)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{txnDate(txn.collectedAt ?? txn.createdAt)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{methodLabel(txn.method)}</td>
      <td className="max-w-[10rem] px-4 py-2.5">
        <span className="block truncate text-xs font-medium">{sourceLabel(txn.source)}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sourceStory(txn)}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.chip)}>
          <span className={cn('h-1 w-1 rounded-full', meta.dot)} />
          {meta.short}
        </span>
        {txn.status === 'SUCCESS' && txn.receiptNo && (
          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{txn.receiptNo}</span>
        )}
        {txn.status === 'REJECTED' && txn.rejectionReason && (
          <span className="mt-0.5 block max-w-[10rem] truncate text-[10px] text-rose-600 dark:text-rose-400" title={txn.rejectionReason}>
            “{txn.rejectionReason}”
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] gap-1" onClick={onReceipt}>
          <Receipt className="h-3 w-3" />
          {txn.status === 'SUCCESS' ? 'Receipt' : 'View'}
        </Button>
      </td>
    </tr>
  )
}

function MobileTxnCard({ txn, onLedger, onReceipt }: { txn: FeeTxn; onLedger: () => void; onReceipt: () => void }) {
  const meta = txnStatusMeta(txn.status)
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <button className="flex min-w-0 items-center gap-2.5 text-left" onClick={onLedger}>
          <GradientAvatar name={txn.studentName ?? 'Student'} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{txn.studentName ?? 'Student'}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {txn.className} · {txnDate(txn.collectedAt ?? txn.createdAt)}
            </span>
          </span>
        </button>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(txn.amount, true)}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.chip)}>
            <span className={cn('h-1 w-1 rounded-full', meta.dot)} />
            {meta.label}
          </span>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {txn.feeHeadName ?? '—'} · {methodLabel(txn.method)} · {sourceStory(txn)}
          </p>
          {txn.receiptNo && <p className="truncate font-mono text-[10px] text-muted-foreground">{txn.receiptNo}</p>}
        </div>
        <Button variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-[11px] gap-1" onClick={onReceipt}>
          <Receipt className="h-3 w-3" />
          {txn.status === 'SUCCESS' ? 'Receipt' : 'View'}
        </Button>
      </div>
    </div>
  )
}
