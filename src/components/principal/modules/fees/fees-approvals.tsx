'use client'

/**
 * FeesVerificationQueue — the cash-verification workflow, embedded in the
 * Payments operations page (ONE benchmark Panel: "Cash Verification").
 *
 * BATCH2-B5 — SERVER TRUTH: the queue IS the canonical
 * GET /api/fees/verification payload (the same FeeTransaction rows the
 * Payment Verification workspace above it renders — ONE canonical queue,
 * one ledger). The client fee-store's parallel "cash request" channel
 * (Pending Principal Acceptance / Collected by Teacher / Clarification
 * Requested) had NO server model behind it — it is GONE; every row and
 * every rupee now comes from the server, and decisions land through
 * POST /api/fees/verification:
 *
 *   · Verify  → one DB transaction: unique SCH- receipt minted, student
 *               ledger applied, collector notified (server-side).
 *   · Reject  → mandatory reason (REJECT_REASONS catalog); the ledger is
 *               never touched, the collector is notified with the reason.
 *
 * ONE unified table in the SAME compact Transactions UI language
 * (sticky muted header, 11px uppercase columns, py-2.5 rows,
 * hover:bg-muted/30, responsive column hiding): student · class ·
 * amount · method · collector/source · date · reference · status ·
 * actions. Loading / error-with-retry / all-clear / empty states — no
 * fabricated numbers.
 *
 * Gateway-confirmed payments NEVER appear here — the gateway itself
 * confirmed them, so they are recorded Paid automatically.
 */

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, X, AlertCircle, Loader2, History, ChevronDown, ArrowRight, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, type ApiError } from '@/lib/exams/api-client'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Panel } from '../shared/panel'
import { FeeStatusBadge, ModeIcon, modeAccent } from './fees-shared'
import {
  useServerResource, serverMethodToMode, txnStatusToDisplay,
  type VerificationPayload, type VerificationTxn, type ServerFeeRow,
} from './use-fee-server-data'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

// Rejection reasons (structured list + "Other" with custom text).
const REJECT_REASONS = [
  'Incorrect amount',
  'Incorrect student',
  'Duplicate collection',
  'Insufficient evidence',
  'Invalid collection',
  'Other',
] as const

export function FeesVerificationQueue() {
  // ── the canonical server queue ────────────────────────────────────
  const queue = useServerResource<VerificationPayload>('/api/fees/verification')
  const pending = queue.data?.pending ?? []
  const recent = queue.data?.recent ?? []
  const stats = queue.data?.stats

  // Modal state
  const [approvingTxn, setApprovingTxn] = useState<VerificationTxn | null>(null)
  const [rejectingTxn, setRejectingTxn] = useState<VerificationTxn | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectNote, setRejectNote] = useState<string>('')
  const [busyTxnId, setBusyTxnId] = useState<string | null>(null)

  // The student's CURRENT outstanding for the approve modal's impact
  // preview — server fee rows for that student (GET /api/fees?studentId=).
  const outstandingRes = useServerResource<ServerFeeRow[]>(
    approvingTxn?.studentId ? `/api/fees?studentId=${approvingTxn.studentId}` : null,
  )
  const currentOutstanding = useMemo(
    () => (outstandingRes.data ?? []).reduce((s, f) => s + Math.max(0, f.amount - f.paid), 0),
    [outstandingRes.data],
  )

  // ── server actions (POST /api/fees/verification) ───────────────────
  const act = async (txn: VerificationTxn, body: Record<string, unknown>, okTitle: string) => {
    setBusyTxnId(txn.id)
    try {
      await api('/api/fees/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId: txn.id, ...body }),
      })
      toast.success(okTitle, {
        description: `${txn.studentName ?? 'Student'} · ${formatINR(txn.amount)}${body.action === 'verify' ? ' — receipt issued, ledger updated' : ' — the collector has been notified'}`,
      })
      queue.reload()
      return true
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? (e as ApiError).message : 'Action failed — please retry.'
      toast.error('Could not complete the action', { description: msg })
      return false
    } finally {
      setBusyTxnId(null)
    }
  }

  const handleApprove = async () => {
    if (!approvingTxn) return
    const ok = await act(approvingTxn, { action: 'verify' }, 'Payment verified')
    if (ok) setApprovingTxn(null)
  }

  const handleReject = async () => {
    if (!rejectingTxn) return
    const reason = rejectReason === 'Other' ? rejectNote : rejectReason
    if (!reason.trim()) {
      toast.error('Reason required', { description: 'Please select or enter a rejection reason.' })
      return
    }
    const ok = await act(rejectingTxn, { action: 'reject', reason: reason.trim() }, 'Payment rejected')
    if (ok) {
      setRejectingTxn(null)
      setRejectReason('')
      setRejectNote('')
    }
  }

  const queueCount = pending.length
  const pendingAmount = pending.reduce((s, t) => s + t.amount, 0)

  return (
    <>
      {/* ── Cash Verification panel (queue + collapsed resolved history) ── */}
      <Panel
        title="Cash Verification"
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {queueCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {queueCount} pending
              </span>
            )}
            {queueCount > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatINR(pendingAmount, true)} awaiting
              </span>
            )}
            {stats && stats.verifiedThisMonth > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                · {formatINR(stats.verifiedThisMonth, true)} verified this month
              </span>
            )}
            <button
              type="button"
              onClick={queue.reload}
              aria-label="Refresh verification queue"
              title="Refresh"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
            </button>
          </span>
        }
        bodyClassName="p-0"
      >
        {queue.loading ? (
          /* Loading skeleton — the Transactions table recipe */
          <div className="space-y-1 p-3" aria-busy="true" aria-label="Loading verification queue">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted/50" />
                <div className="ml-auto h-3 w-14 animate-pulse rounded bg-muted/50" />
                <div className="h-3 w-14 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        ) : queue.error && queue.data === null ? (
          /* Error — honest, retryable */
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-6">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Verification queue unavailable.</span> {queue.error}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={queue.reload}
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Retry
            </Button>
          </div>
        ) : pending.length === 0 ? (
          /* Slim all-clear row — the server queue is empty */
          <div className="flex items-center gap-2.5 px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600" aria-hidden>
              <Check className="h-3.5 w-3.5" />
            </span>
            <p className="text-xs text-muted-foreground">No pending verifications</p>
          </div>
        ) : (
          /* ONE compact verification table — the Transactions UI language:
             student · class · amount · method · source · date · reference ·
             status · actions. Every row is a canonical FeeTransaction. */
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="h-10 bg-muted shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                  <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Student</th>
                  <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Class</th>
                  <th className="text-right px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Amount</th>
                  <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden sm:table-cell">Method</th>
                  <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden md:table-cell">Source</th>
                  <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Date</th>
                  <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden 2xl:table-cell">Reference</th>
                  <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Status</th>
                  <th className="text-right pl-3 pr-4 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* Canonical payment records awaiting verification — teacher
                    collections + self-submitted manual transfers. Verify posts
                    the SAME record as successful; reject preserves the reason
                    on it. No second payment copy is ever created. */}
                {pending.map((t) => {
                  const mode = serverMethodToMode(t.method)
                  return (
                    <motion.tr
                      key={t.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: busyTxnId === t.id ? 0.5 : 1 }}
                      exit={{ opacity: 0 }}
                      className="border-t border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium leading-tight">{t.studentName ?? 'Student'}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{t.feeHeadName ?? '—'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">{t.className ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{formatINR(t.amount)}</td>
                      <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1', modeAccent(mode))}>
                          <ModeIcon mode={mode} className="h-2.5 w-2.5" />
                          {mode}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <p className="text-[10px] text-muted-foreground truncate max-w-[130px]" title={t.collectedBy ?? undefined}>
                          {t.collectedBy ?? 'School record'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                        {formatDate(t.collectedAt ?? t.createdAt)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground hidden 2xl:table-cell">{t.referenceNumber ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <FeeStatusBadge status={txnStatusToDisplay(t.status)} />
                      </td>
                      <td className="pl-3 pr-4 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-[10px] gap-1 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                            aria-label={`Reject ${t.studentName ?? 'student'}'s payment`}
                            title="Reject"
                            disabled={busyTxnId === t.id}
                            onClick={() => { setRejectingTxn(t); setRejectReason(''); setRejectNote('') }}
                          >
                            <X className="h-3 w-3" /> <span className="hidden 2xl:inline">Reject</span>
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            aria-label={`Verify ${t.studentName ?? 'student'}'s payment`}
                            title="Verify"
                            disabled={busyTxnId === t.id}
                            onClick={() => { setApprovingTxn(t) }}
                          >
                            {busyTxnId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} <span className="hidden 2xl:inline">Verify</span>
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Recently resolved — collapsed audit inside the same panel ── */}
        {recent.length > 0 && (
          <details className="border-t border-border/60">
            <summary className="flex items-center justify-between gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden px-4 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30">
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3 w-3" aria-hidden />
                Recently resolved ({recent.length})
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </summary>
            <div className="divide-y divide-border border-t border-border/50 px-4">
              {recent.map((r) => {
                const resolved = r.status === 'SUCCESS'
                return (
                  <div key={r.id} className="flex items-center gap-2.5 py-2">
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
                      resolved ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' : 'bg-rose-500/10 text-rose-600 ring-rose-500/20',
                    )}>
                      {resolved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {r.studentName ?? 'Student'} · <span className="text-muted-foreground font-mono text-[10px]">{r.receiptNo ?? '—'}</span>
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate">
                        {r.collectedBy ?? 'School record'} · {formatDate(r.verifiedAt ?? r.rejectedAt ?? r.createdAt)}
                        {r.rejectionReason && <span className="text-amber-600 italic"> — "{r.rejectionReason}"</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold tabular-nums">{formatINR(r.amount, true)}</p>
                      <FeeStatusBadge status={txnStatusToDisplay(r.status)} />
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        )}
      </Panel>

      {/* ── Confirmation modals (server actions) ───────────────────── */}
      <AnimatePresence>
        {approvingTxn && (
          <ApproveModal
            txn={approvingTxn}
            currentOutstanding={
              approvingTxn.studentId == null ||
              outstandingRes.loading ||
              (outstandingRes.error !== null && outstandingRes.data === null)
                ? null
                : currentOutstanding
            }
            loading={busyTxnId === approvingTxn.id}
            onClose={() => setApprovingTxn(null)}
            onConfirm={() => void handleApprove()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rejectingTxn && (
          <RejectModal
            txn={rejectingTxn}
            reason={rejectReason}
            setReason={setRejectReason}
            note={rejectNote}
            setNote={setRejectNote}
            loading={!!rejectingTxn && busyTxnId === rejectingTxn.id}
            onClose={() => setRejectingTxn(null)}
            onConfirm={() => void handleReject()}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Approve Modal ──────────────────────────────────────────────────

function ApproveModal({ txn, currentOutstanding, loading, onClose, onConfirm }: {
  txn: VerificationTxn
  /** null while the student's server fee rows load — the tiles show "…". */
  currentOutstanding: number | null
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  useDismissOnEscape(onClose)
  const balanceAfter = currentOutstanding !== null ? Math.max(0, currentOutstanding - txn.amount) : null
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Verify cash payment"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            Verify Payment?
          </h3>
        </div>
        <div className="p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Student</span>
            <span className="font-medium">{txn.studentName ?? 'Student'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Class</span>
            <span className="font-medium">{txn.className ?? '—'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Fee Head</span>
            <span className="font-medium">{txn.feeHeadName ?? '—'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount Submitted</span>
            <span className="font-bold tabular-nums text-emerald-600">{formatINR(txn.amount, true)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Collected By</span>
            <span className="font-medium">{txn.collectedBy ?? 'School record'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Collected At</span>
            <span className="font-medium">{formatDate(txn.collectedAt ?? txn.createdAt)}</span>
          </div>

          {/* Balance impact — Before → After tiles from the student's LIVE
              server fee rows (loading shows "…" — never a guess). */}
          <div className="pt-2 mt-2 border-t border-border/40">
            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
              <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Before</p>
                <p className="text-sm font-bold tabular-nums text-rose-600 mt-0.5">
                  {currentOutstanding !== null ? formatINR(currentOutstanding, true) : '…'}
                </p>
              </div>
              <ArrowRight className="self-center h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5">
                <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">After</p>
                <p className="text-sm font-bold tabular-nums text-emerald-600 mt-0.5">
                  {balanceAfter !== null ? formatINR(balanceAfter, true) : '…'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2 mt-2">
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300">
              Verifying mints the official SCH- receipt inside one server transaction, posts the
              payment to the student's fee ledger, reduces the outstanding dues and notifies the collector.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {loading ? 'Verifying…' : 'Verify & Issue Receipt'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Reject Modal ───────────────────────────────────────────────────

function RejectModal({ txn, reason, setReason, note, setNote, loading, onClose, onConfirm }: {
  txn: VerificationTxn
  reason: string
  setReason: (v: string) => void
  note: string
  setNote: (v: string) => void
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  useDismissOnEscape(onClose)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Reject payment"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            Reject Payment
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{txn.studentName ?? 'Student'} · {formatINR(txn.amount, true)}</p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Reason <span className="text-rose-600">*</span></label>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    'text-xs px-2 py-1.5 rounded-md border text-left transition-colors',
                    reason === r
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {reason === 'Other' && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider" htmlFor="cash-reject-custom-reason">Custom Reason <span className="text-rose-600">*</span></label>
              <input
                id="cash-reject-custom-reason"
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Enter custom reason…"
                className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 mt-1.5 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
          )}
          <div className="rounded-md bg-rose-500/5 border border-rose-500/20 p-2">
            <p className="text-[10px] text-rose-700 dark:text-rose-300">
              No transaction will be posted. No receipt will be issued. The student's ledger is never
              touched. The collector will be notified with the reason.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-rose-600 hover:bg-rose-700 text-white" onClick={onConfirm} disabled={loading || !reason}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {loading ? 'Rejecting…' : 'Reject Payment'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
