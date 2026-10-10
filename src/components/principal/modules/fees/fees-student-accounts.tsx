'use client'

/**
 * FeesStudentAccountsSection — Principal's student fee account search + workspace.
 *
 * BATCH2-B5 — SERVER TRUTH: every balance comes from the server fee
 * ledger. The grid groups GET /api/fees fee rows per student (billed =
 * Σ Fee.amount, paid = Σ Fee.paid, outstanding = Σ (amount − paid)); the
 * drawer re-fetches that student's rows from GET /api/fees?studentId= so
 * the position stays live. Class labels resolve through the
 * GET /api/fees/verification roster. Receipts render from the canonical
 * GET /api/fees/receipts/[txnId] document (Payment.transactionId → txn).
 *
 * The client fee-store's parallel concepts (fabricated per-student
 * "net payable" from client fee structures, concession records, optional-
 * head applicability) had no server model — they are replaced by honest
 * muted "not available on the server ledger" notes. No fabricated
 * numbers are rendered anywhere.
 *
 * Phase 2 (structure kept): when a student is selected → the fee account
 * workspace drawer with THREE top-level tabs:
 *
 *   Account  — the student's current financial position: fee lines,
 *              dues/outstanding, and the detailed Fee Ledger one
 *              contextual action away ("View Fee Ledger →").
 *   Payments — recorded PAYMENT history (server Payment mirror rows) with
 *              canonical receipt actions.
 *   History  — auditable account activity (fee lines raised + payments
 *              recorded — the server rows themselves).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, X, Wallet, ChevronRight, ArrowLeft,
  AlertCircle, FileText, History, ShieldCheck, User,
  RefreshCw, AlertTriangle, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useServerResource, deriveAccounts, classLabelMapOf, feeStatusToDisplay,
  serverMethodToMode, txnStatusToDisplay, receiptTxnIdOf, feeOutstanding,
  type ServerFeeRow, type VerificationPayload, type DerivedFeeAccount, type ServerPaymentRow,
} from './use-fee-server-data'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FeePanel, FeeStat, FeeStatusBadge, FeeEmptyState, ModeIcon, modeAccent, FeePill, statusAccent } from './fees-shared'
import { FeeReceiptViewer } from '@/components/shared/fee-collection/receipt-viewer'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

interface Props {
  onCollect: (studentId: string) => void
  /** Deep-link request from the command palette (fee result) — opens the
   *  matching student's fee account workspace directly. */
  focusStudent?: { name: string; ts: number } | null
}

/**
 * GRID CAP RULE — always render the FIRST 24 accounts of the *filtered*
 * result set. Filtering composes BEFORE the cap, so a narrowed filter set
 * is never truncated unless it exceeds 24 on its own.
 */
const MAX_VISIBLE_ACCOUNTS = 24

/** Status facet options — the display statuses derived from server rows. */
const STATUS_FILTERS = ['Paid', 'Partially Paid', 'Due', 'Overdue'] as const

// ─── Local stat tile (same chrome as before) ─────────────────────────

const TILE_ACCENTS = {
  default: '',
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
} as const

function StatTile({ label, value, sub, accent = 'default', align = 'left', className }: {
  label: string
  value: string | number
  sub?: string
  /** @default 'default' */
  accent?: 'default' | 'emerald' | 'rose' | 'amber'
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <div className={cn('rounded-lg bg-muted/40 px-2.5 py-1.5', align === 'right' && 'text-right', className)}>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', TILE_ACCENTS[accent])}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

/** One grid card skeleton while the server ledger loads. */
function AccountCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4" aria-busy="true" aria-label="Loading fee accounts">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted/70" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-28 animate-pulse rounded bg-muted/60" />
          <div className="h-2.5 w-20 animate-pulse rounded bg-muted/50" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-12 animate-pulse rounded-lg bg-muted/40" />
        <div className="h-12 animate-pulse rounded-lg bg-muted/40" />
        <div className="h-12 animate-pulse rounded-lg bg-muted/40" />
      </div>
    </div>
  )
}

export function FeesStudentAccountsSection({ onCollect, focusStudent }: Props) {
  // ── server data (B5) ───────────────────────────────────────────────
  const feeRowsRes = useServerResource<ServerFeeRow[]>('/api/fees')
  const verificationRes = useServerResource<VerificationPayload>('/api/fees/verification')

  const accounts = useMemo(
    () => deriveAccounts(feeRowsRes.data ?? [], classLabelMapOf(verificationRes.data?.students ?? [])),
    [feeRowsRes.data, verificationRes.data],
  )

  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  // The drawer keeps the SELECTED STUDENT ID, not an account snapshot —
  // the drawer fetches that student's server fee rows itself, so the
  // position stays live (refresh after actions re-reads the ledger).
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Consume the deep-link: match by student name (exact → prefix →
  // contains) and open the account drawer; fall back to an honest info
  // toast when the roster doesn't include that student.
  const handledFocusTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focusStudent || handledFocusTs.current === focusStudent.ts) return
    handledFocusTs.current = focusStudent.ts
    const name = focusStudent.name.toLowerCase().trim()
    const match =
      accounts.find((a) => a.studentName.toLowerCase() === name) ??
      accounts.find((a) => name.startsWith(a.studentName.toLowerCase())) ??
      accounts.find((a) => a.studentName.toLowerCase().includes(name))
    if (match) {
      setSelectedId(match.studentId)
      toast.success(`Opened ${match.studentName}'s fee account`, { description: 'Deep-linked from global search' })
    } else {
      toast.info(`${focusStudent.name} — fee directory`, {
        description: 'No fee rows found for this student on the school ledger yet.',
      })
    }
  }, [focusStudent?.ts, accounts])

  // Class facet — unique classNames (server class labels) in
  // first-appearance order.
  const uniqueClasses = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.className))),
    [accounts],
  )

  // Composed filtering: query match AND class AND status.
  const filteredAccounts = useMemo(() => {
    const q = search.toLowerCase().trim()
    return accounts.filter((a) => {
      const matchesQuery =
        !q ||
        a.studentName.toLowerCase().includes(q) ||
        a.studentId.toLowerCase().includes(q) ||
        (a.admissionNo ?? '').toLowerCase().includes(q) ||
        (a.rollNo ?? '').toLowerCase().includes(q) ||
        a.className.toLowerCase().includes(q)
      const matchesClass = classFilter === 'all' || a.className === classFilter
      const matchesStatus = statusFilter === 'all' || a.status === statusFilter
      return matchesQuery && matchesClass && matchesStatus
    })
  }, [accounts, search, classFilter, statusFilter])

  // Apply the single grid cap after composition.
  const visibleAccounts = useMemo(
    () => filteredAccounts.slice(0, MAX_VISIBLE_ACCOUNTS),
    [filteredAccounts],
  )

  const clearFilters = () => {
    setSearch('')
    setClassFilter('all')
    setStatusFilter('all')
  }

  const loading = feeRowsRes.loading

  return (
    <div className="space-y-4">
      {/* Hard error surface with retry */}
      {feeRowsRes.error && feeRowsRes.data === null && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Student fee accounts unavailable.</span> {feeRowsRes.error}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={feeRowsRes.reload}>
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {/* Filter toolbar — SearchFilterBar pattern: search + Class and
          Status Select facets, with a results summary beside the filters. */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, admission no, class…"
            className="pl-9 pr-8 h-9 text-xs"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Results summary — roster size vs rendered count */}
          <span role="status" className="hidden sm:block text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
            {loading ? 'loading…' : `${accounts.length} student${accounts.length === 1 ? '' : 's'} · showing ${visibleAccounts.length}`}
          </span>

          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-9 text-[11px] w-[130px] text-xs"><SelectValue placeholder="All Classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {uniqueClasses.map((cls) => (
                <SelectItem key={cls} value={cls}>{cls}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-[11px] w-[130px] text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <AccountCardSkeleton key={i} />)
          : visibleAccounts.map((a, i) => (
            <motion.button
              key={a.studentId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.28) }}
              onClick={() => setSelectedId(a.studentId)}
              aria-label={`Open account for ${a.studentName}`}
              className="group rounded-xl border border-border bg-card p-4 text-left hover:border-emerald-500/40 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold',
                    a.status === 'Paid' ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                    : a.status === 'Overdue' ? 'bg-gradient-to-br from-rose-500 to-pink-600'
                    : 'bg-gradient-to-br from-amber-500 to-orange-600',
                  )}>
                    {a.studentName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{a.studentName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      {a.admissionNo ?? '—'} · {a.className}{a.rollNo ? ` · Roll ${a.rollNo}` : ''}
                    </p>
                  </div>
                </div>
                <FeeStatusBadge status={a.status} />
              </div>
              {/* Payable / Paid / Due — numbers strictly right-aligned under
                  their micro-labels; Due turns rose when anything is owed
                  and flips to an emerald "Clear" state otherwise. */}
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Payable" value={formatINR(a.billed, true)} align="right" className="px-2 py-1.5" />
                <StatTile label="Paid" value={formatINR(a.paid, true)} accent="emerald" align="right" className="px-2 py-1.5" />
                {a.outstanding > 0
                  ? <StatTile label="Due" value={formatINR(a.outstanding, true)} accent="rose" align="right" className="px-2 py-1.5" />
                  : <StatTile label="Due" value="Clear" accent="emerald" align="right" className="px-2 py-1.5" />}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/40 text-[10px] text-muted-foreground">
                {/* Server Payment mirror rows — the card can never
                    contradict the account's Paid tile (Σ payments = paid). */}
                <span>{a.paymentCount} payment record{a.paymentCount === 1 ? '' : 's'}</span>
                <span className="inline-flex items-center gap-0.5 group-hover:text-emerald-600 transition-colors">
                  Open Account <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </motion.button>
          ))}
        {!loading && visibleAccounts.length === 0 && (
          <div className="col-span-full">
            <FeeEmptyState
              icon={<User className="h-6 w-6" />}
              title={accounts.length === 0 ? 'No fee accounts on the ledger yet' : 'No students match these filters'}
              description={accounts.length === 0 ? 'Fee rows created for enrolled students appear here with their server ledger balances.' : 'Try a different name, admission no, or relax the class / status filters.'}
              action={accounts.length > 0 ? (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined}
            />
          </div>
        )}
      </div>

      {/* Student Fee Account Drawer */}
      <AnimatePresence>
        {selectedId && (
          <StudentFeeAccountDrawer
            studentId={selectedId}
            classLabel={accounts.find((a) => a.studentId === selectedId)?.className}
            onCollect={() => onCollect(selectedId)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Student Fee Account Drawer ──────────────────────────────────────

// THREE top-level tabs (same IA): Account · Payments · History. The Fee
// Ledger stays a CONTEXTUAL SUB-VIEW of Account (ledgerOpen) — progressive
// disclosure, not information deletion.
type AccountTab = 'account' | 'payments' | 'history'

function StudentFeeAccountDrawer({ studentId, classLabel, onClose, onCollect }: {
  studentId: string
  classLabel: string | undefined
  onClose: () => void
  onCollect: () => void
}) {
  const [tab, setTab] = useState<AccountTab>('account')
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [receiptTxnId, setReceiptTxnId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)

  // That student's server fee rows — the drawer's ONE data source. The
  // url mounts with the drawer, so every open re-reads the live ledger;
  // the header refresh button re-reads it after actions.
  const rowsRes = useServerResource<ServerFeeRow[]>(`/api/fees?studentId=${studentId}`)
  const account = useMemo(
    () => deriveAccounts(rowsRes.data ?? [], new Map([[studentId, classLabel ?? 'Unassigned']]))[0] ?? null,
    [rowsRes.data, studentId, classLabel],
  )

  // Escape dismisses the top-most layer: the receipt preview when one is
  // open, otherwise the drawer itself (backdrop click already does both).
  useDismissOnEscape(() => {
    if (receiptOpen) setReceiptOpen(false)
    else onClose()
  })

  // Tab switch wrapper — the ledger sub-view lives under the Account tab
  // only; leaving Account always collapses it.
  const goTab = (t: AccountTab) => {
    setLedgerOpen(false)
    setTab(t)
  }

  const openReceipt = (txnId: string) => {
    setReceiptTxnId(txnId)
    setReceiptOpen(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Fee account — ${account?.studentName ?? 'student'}`}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 350, damping: 35 }}
        className="bg-card border-l border-border w-full max-w-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer header — opaque bg-card so scrim/content never bleeds
            through while the drawer body scrolls beneath. */}
        <div className="shrink-0 border-b border-border bg-card px-5 py-3.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onClose}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground"
                aria-label="Refresh this account from the server ledger"
                title="Refresh from server"
                onClick={rowsRes.reload}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', rowsRes.loading && 'animate-spin')} aria-hidden />
              </Button>
              {account && <FeeStatusBadge status={account.status} />}
            </div>
          </div>
          {rowsRes.loading || !account ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading fee account">
              <div className="h-10 w-48 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-64 animate-pulse rounded bg-muted/50" />
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-3">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />)}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white font-bold',
                  account.status === 'Paid' ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  : account.status === 'Overdue' ? 'bg-gradient-to-br from-rose-500 to-pink-600'
                  : 'bg-gradient-to-br from-amber-500 to-orange-600',
                )}>
                  {account.studentName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold truncate">{account.studentName}</h2>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">
                    {account.admissionNo ?? '—'}{account.rollNo ? ` · Roll ${account.rollNo}` : ''} · {account.className}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Guardian: {account.guardianName ?? '—'} · {account.guardianPhone ?? '—'}
                  </p>
                </div>
                {account.outstanding > 0 && (
                  <Button size="sm" className="h-8 text-xs gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shrink-0" onClick={onCollect}>
                    <Wallet className="h-3.5 w-3.5" /> Collect
                  </Button>
                )}
              </div>
              {/* Summary stat strip — server ledger figures only. */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-3">
                <StatTile label="Billed" value={formatINR(account.billed, true)} />
                <StatTile label="Paid" value={formatINR(account.paid, true)} accent="emerald" />
                <StatTile label="Outstanding" value={formatINR(account.outstanding, true)} accent="rose" />
                <StatTile label="Fee Lines" value={account.feeLines.length} />
                <StatTile label="Payments" value={account.paymentCount} />
                <StatTile label="Last Payment" value={account.lastPaymentAt ? formatDate(account.lastPaymentAt) : '—'} />
              </div>
            </>
          )}
          {rowsRes.error && rowsRes.data === null && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <p className="min-w-0 flex-1 text-[10px] text-muted-foreground">Could not load this account — {rowsRes.error}</p>
              <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={rowsRes.reload}>
                <RefreshCw className="h-2.5 w-2.5" /> Retry
              </Button>
            </div>
          )}
        </div>

        {/* Tabs — exactly three top-level sections. */}
        <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-1.5 flex items-center gap-0.5 overflow-x-auto">
          {[
            { value: 'account' as const, label: 'Account', icon: <User className="h-3 w-3" /> },
            { value: 'payments' as const, label: 'Payments', icon: <Wallet className="h-3 w-3" /> },
            { value: 'history' as const, label: 'History', icon: <ShieldCheck className="h-3 w-3" /> },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => goTab(t.value)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap',
                tab === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {rowsRes.loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading fee account">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : !account ? (
            <FeeEmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No fee rows for this student"
              description="This student has no fee lines on the school ledger yet."
            />
          ) : tab === 'account' ? (
            ledgerOpen
              ? (
                <div className="space-y-3">
                  {/* Contextual ledger sub-view — server fee lines + payments
                      with a running balance. */}
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 -ml-2" onClick={() => setLedgerOpen(false)}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Account
                  </Button>
                  <AccountLedger account={account} onViewReceipt={openReceipt} />
                </div>
              )
              : <AccountHome account={account} onCollect={onCollect} onOpenLedger={() => setLedgerOpen(true)} />
          ) : tab === 'payments' ? (
            <AccountPayments account={account} onViewReceipt={openReceipt} />
          ) : (
            <AccountHistory account={account} />
          )}
        </div>

        {/* Canonical receipt document (GET /api/fees/receipts/[txnId]). */}
        <FeeReceiptViewer
          txnId={receiptOpen ? receiptTxnId : null}
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
        />
      </motion.div>
    </motion.div>
  )
}

/** Type label for a fee line — the server's own Fee.type, title-cased,
 *  with an honest fallback. No invented categories. */
function feeTypeLabel(type: string | null): string {
  if (!type) return 'Fee'
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase().replace(/_/g, ' ')
}

function AccountOverview({ account }: { account: DerivedFeeAccount }) {
  return (
    <div className="space-y-3">
      {/* Account position — EVERY server fee line with its own balance. */}
      <FeePanel title="Account Position" subtitle="server fee ledger · every fee line">
        <div className="space-y-1">
          {account.feeLines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium truncate">{l.title}</p>
                <p className="text-[9px] text-muted-foreground truncate">
                  {feeTypeLabel(l.type)} · {l.dueDate ? `due ${formatDate(l.dueDate)}` : 'no due date'} · raised {formatDate(l.createdAt)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] font-bold tabular-nums">{formatINR(l.amount, true)}</p>
                <p className={cn('text-[9px] tabular-nums', l.outstanding === 0 ? 'text-emerald-600 font-semibold' : 'text-amber-600')}>
                  {l.outstanding === 0 ? 'Paid' : `${formatINR(l.paid, true)} paid · ${formatINR(l.outstanding, true)} due`}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border/60 mt-2 pt-2 text-[11px]">
          <span className="text-muted-foreground font-medium">Ledger totals</span>
          <span className="font-bold tabular-nums">
            <span className="text-emerald-600">{formatINR(account.paid, true)}</span>
            {' paid of '}
            <span>{formatINR(account.billed, true)}</span>
          </span>
        </div>
      </FeePanel>

      {/* Honesty note — the client-store concepts that had no server
          model (concessions, optional-head applicability) cannot appear
          as numbers here. */}
      <div
        className="flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5"
        role="note"
      >
        <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">Concessions &amp; optional charges:</strong> not
          part of the server fee ledger yet — they cannot adjust these balances. Granting them in a
          local demo store would show numbers the school's books do not record.
        </p>
      </div>
    </div>
  )
}

// ─── Account tab composition ─────────────────────────────────────────

function AccountHome({ account, onCollect, onOpenLedger }: { account: DerivedFeeAccount; onCollect: () => void; onOpenLedger: () => void }) {
  return (
    <div className="space-y-3">
      <AccountOverview account={account} />
      <AccountDues account={account} onCollect={onCollect} />
      <LedgerAccessCard onOpen={onOpenLedger} />
    </div>
  )
}

/** Secondary contextual action — opens the detailed Fee Ledger
 *  (Date · Description · Type · Charge · Payment · Balance) built from
 *  the server's fee lines and payment rows. */
function LedgerAccessCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="View the detailed fee ledger"
      className="group w-full flex items-center gap-2.5 rounded-lg border border-dashed border-border hover:border-emerald-500/40 bg-muted/20 hover:bg-muted/40 transition-colors px-3 py-2.5 text-left"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-emerald-500/10 group-hover:text-emerald-600 transition-colors">
        <History className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold">View Fee Ledger</span>
        <span className="block text-[10px] text-muted-foreground">every charge and payment, with running balance</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
    </button>
  )
}

// ─── Fee Ledger (contextual sub-view) ────────────────────────────────

interface LedgerRow {
  id: string
  date: string
  description: string
  typeLabel: string
  charge: number
  payment: number
  receiptNo: string | null
  receiptTxnId: string | null
}

/** Server fee lines + payment rows → chronological ledger rows with a
 *  running balance (billed-to-date − paid-to-date). The balance walk
 *  lives at module level: a pure derivation of the server rows. */
function ledgerRowsOf(account: DerivedFeeAccount): Array<LedgerRow & { balance: number }> {
  const rows: LedgerRow[] = []
  for (const line of account.feeLines) {
    rows.push({
      id: `line-${line.id}`,
      date: line.createdAt,
      description: line.title,
      typeLabel: feeTypeLabel(line.type),
      charge: line.amount,
      payment: 0,
      receiptNo: null,
      receiptTxnId: null,
    })
    for (const p of line.payments) {
      rows.push({
        id: `pay-${p.id}`,
        date: p.createdAt,
        description: `Payment · ${line.title}`,
        typeLabel: 'Payment',
        charge: 0,
        payment: p.amount,
        receiptNo: null,
        receiptTxnId: receiptTxnIdOf(p),
      })
    }
  }
  const sorted = rows.sort((a, b) => a.date.localeCompare(b.date))
  let running = 0
  return sorted.map((e) => {
    running += e.charge - e.payment
    return { ...e, balance: Math.max(0, Math.round(running * 100) / 100) }
  })
}

function AccountLedger({ account, onViewReceipt }: { account: DerivedFeeAccount; onViewReceipt: (txnId: string) => void }) {
  const withBalance = useMemo(() => ledgerRowsOf(account), [account])
  return (
    <FeePanel title="Fee Ledger" subtitle="server rows · chronological charge + payment history" bodyClassName="p-0">
      <div className="overflow-x-auto max-h-[28rem]">
        <table className="w-full text-xs min-w-[32rem]">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Description</th>
              <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Type</th>
              <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Charge</th>
              <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Payment</th>
              <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map((e) => (
              <tr key={e.id} className="border-t border-border/40 hover:bg-muted/30">
                <td className="px-3 py-2.5 text-muted-foreground text-[10px] whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="px-3 py-2.5">
                  <p className="font-medium text-[11px]">{e.description}</p>
                  {e.receiptTxnId ? (
                    <button
                      type="button"
                      onClick={() => onViewReceipt(e.receiptTxnId!)}
                      className="text-[9px] text-muted-foreground font-mono underline decoration-dotted hover:text-foreground"
                    >
                      view receipt
                    </button>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn(
                    'inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap',
                    e.payment > 0 ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  )}>
                    {e.typeLabel}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">
                  {e.charge > 0 ? formatINR(e.charge) : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">
                  {e.payment > 0 ? formatINR(e.payment) : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatINR(e.balance, true)}</td>
              </tr>
            ))}
            {withBalance.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No ledger entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </FeePanel>
  )
}

// ─── Payments tab (server Payment mirror rows) ───────────────────────

function AccountPayments({ account, onViewReceipt }: { account: DerivedFeeAccount; onViewReceipt: (txnId: string) => void }) {
  // PAID ↔ PAYMENTS INVARIANT: everything counted in the account's Paid
  // tile appears here — the payment rows embedded in the server's fee
  // rows are the exact records the ledger writer created.
  const payments = useMemo(
    () =>
      account.feeLines.flatMap((line) =>
        line.payments.map((p) => ({ ...p, feeTitle: line.title })),
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [account.feeLines],
  )
  return (
    <FeePanel title="Payment History" subtitle={`${payments.length} payment record${payments.length === 1 ? '' : 's'} · server ledger`} bodyClassName="p-0">
      <div className="overflow-x-auto max-h-[28rem]">
        <table className="w-full text-xs min-w-[32rem]">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Fee</th>
              <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Amount</th>
              <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Mode</th>
              <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
              <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const mode = serverMethodToMode(p.method)
              const txnId = receiptTxnIdOf(p)
              return (
                <tr key={p.id} className="border-t border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2.5 text-muted-foreground text-[10px] whitespace-nowrap">{formatDate(p.createdAt)}</td>
                  <td className="px-3 py-2.5 text-[11px] font-medium truncate max-w-[160px]" title={p.feeTitle}>{p.feeTitle}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{formatINR(p.amount)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1', modeAccent(mode))}>
                      <ModeIcon mode={mode} className="h-2.5 w-2.5" />
                      {mode}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><FeeStatusBadge status={txnStatusToDisplay(p.status)} /></td>
                  <td className="px-3 py-2.5 text-right">
                    {txnId ? (
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => onViewReceipt(txnId)}
                        aria-label="View the canonical receipt document"
                      >
                        <FileText className="h-3 w-3" /> View
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground" title="Legacy record — no receipt transaction reference">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {payments.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">
                No payments recorded yet. Payments recorded through Collect appear here with their receipts.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground border-t border-border/40 px-3 py-2">
        Open any recorded payment to view or print its receipt. Legacy rows without a receipt reference honestly show “—”.
      </p>
    </FeePanel>
  )
}

// ─── History tab (auditable server activity) ─────────────────────────

function AccountHistory({ account }: { account: DerivedFeeAccount }) {
  const events = useMemo(() => {
    const items: Array<{ id: string; at: string; kind: 'fee' | 'payment'; title: string; detail: string; amount: number }> = []
    for (const line of account.feeLines) {
      items.push({
        id: `fee-${line.id}`,
        at: line.createdAt,
        kind: 'fee',
        title: `Fee line raised — ${line.title}`,
        detail: `${feeTypeLabel(line.type)} · billed ${formatINR(line.amount, true)}${line.dueDate ? ` · due ${formatDate(line.dueDate)}` : ''}`,
        amount: line.amount,
      })
      for (const p of line.payments as ServerPaymentRow[]) {
        items.push({
          id: `pay-${p.id}`,
          at: p.createdAt,
          kind: 'payment',
          title: 'Payment recorded',
          detail: `${formatINR(p.amount, true)} via ${serverMethodToMode(p.method)}${p.note ? ` · ${p.note}` : ''}`,
          amount: p.amount,
        })
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at))
  }, [account.feeLines])

  return (
    <FeePanel title="Activity History" subtitle="fee lines and payments · server ledger trail">
      <div className="space-y-2">
        {events.length > 0 ? events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-md border border-border/40 px-2 py-1.5">
            <span className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
              e.kind === 'payment' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-sky-500/10 text-sky-600',
            )}>
              <ShieldCheck className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium">{e.title}</p>
              <p className="text-[9px] text-muted-foreground">{formatDate(e.at)} · {e.detail}</p>
            </div>
          </div>
        )) : (
          <FeeEmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No activity yet" description="Fee lines and payments appear here as the school records them." />
        )}
      </div>
    </FeePanel>
  )
}

// ─── Dues & Outstanding (server sums + aging) ────────────────────────

function AccountDues({ account, onCollect }: { account: DerivedFeeAccount; onCollect: () => void }) {
  const openLines = account.feeLines.filter((l) => feeOutstanding(l) > 0)
  return (
    <FeePanel title="Dues & Outstanding" subtitle="server fee ledger">
      <div className="space-y-3">
        <div>
          <div className="grid grid-cols-3 gap-2">
            <FeeStat label="Outstanding" value={formatINR(account.outstanding, true)} accent="rose" />
            <FeeStat label="Open Lines" value={openLines.length} />
            <FeeStat label="Total Due" value={formatINR(account.outstanding, true)} />
          </div>
          {account.daysOverdue && account.daysOverdue > 0 && account.outstanding > 0 && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 flex items-start gap-2 mt-2">
              <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-700 dark:text-rose-300">
                This account is <strong>{account.daysOverdue} days overdue</strong>
                {account.oldestDueAt ? ` (earliest open due date ${formatDate(account.oldestDueAt)})` : ''}.
              </p>
            </div>
          )}
        </div>
        {/* Open fee lines — the worklist Collect pays against. */}
        {openLines.length > 0 && (
          <div className="space-y-1.5">
            {openLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">{l.title}</p>
                  <p className="text-[9px] text-muted-foreground">{l.dueDate ? `due ${formatDate(l.dueDate)}` : 'no due date'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-bold tabular-nums">{formatINR(l.outstanding, true)}</p>
                  <FeePill accent={statusAccent(feeStatusToDisplay(l.status))}>{feeStatusToDisplay(l.status)}</FeePill>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground">Last payment: {account.lastPaymentAt ? formatDate(account.lastPaymentAt) : 'No payments yet'}</p>
          {account.outstanding > 0 && (
            <Button size="sm" className="h-7 text-[10px] gap-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white" onClick={onCollect}>
              <Wallet className="h-3 w-3" /> Collect Now
            </Button>
          )}
        </div>
      </div>
    </FeePanel>
  )
}
