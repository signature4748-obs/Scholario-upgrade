'use client'

/**
 * FeesVerificationQueue — the cash-verification workflow, embedded in the
 * Payments operations page (ONE benchmark Panel: "Cash Verification").
 *
 * FINAL UI (spec §3): Cash Verification follows the SAME compact UI
 * language as Recent Payments / Transactions — a clean list/table workflow,
 * NOT oversized cards. ONE unified table carries BOTH verification
 * channels:
 *   • transaction rows ('Under Verification' — teacher collections,
 *     self-submitted manual transfers) → compact Verify / Reject actions;
 *   • legacy cash-request rows (Pending / Collected by Teacher /
 *     Clarification Requested) → Approve / Reject / Request-clarification.
 * Each row scans: student · class · amount · method · collector/source ·
 * date · reference · status · actions — exactly the Transactions table
 * recipe (sticky muted header, 11px uppercase columns, py-2.5 rows,
 * hover:bg-muted/30, responsive column hiding).
 *
 * Confirm modals keep the full impact preview — approve surfaces the
 * Before → After balance tiles — before the Principal commits.
 *
 * Panel chrome: subtitle carries live counts chips (amber pending · violet
 * clarification) + awaiting amount; when nothing is pending anywhere
 * (analytics.pendingVerification + pendingCashRequests === 0) a slim all-clear
 * row replaces the table ("No pending verifications" + emerald Check chip).
 * The Recently Resolved audit collapses into a <details> inside the same panel.
 *
 * Business logic is UNCHANGED from the original approvals implementation:
 *   - Approve  → creates verified transaction + audit record + receipt +
 *                updates the student account
 *   - Reject   → mandatory reason (REJECT_REASONS catalog below) → audit
 *                record (no transaction posted)
 *   - Clarify  → message → audit record, moves to "Clarification Requested"
 * Safety preserved: duplicate approval blocked, mandatory reject reason,
 * loading states, immutable audit entries.
 * Gateway-confirmed payments NEVER appear here — the gateway itself
 * confirmed them, so they are recorded Paid automatically.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, X, AlertCircle, MessageSquare, Loader2, History, ChevronDown, ArrowRight, Banknote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useFeeData, useFeeStore, type CashRequest, type FeeTransaction } from '@/lib/store/fee-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Panel } from '../shared/panel'
import { FeeEmptyState, FeeStatusBadge, ModeIcon, modeAccent, paymentStatusLabel, TxnDateTime, DateTimeText, SourceChip } from './fees-shared'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

// Rejection reasons (structured list + "Other" with custom text) — catalog UNCHANGED.
const REJECT_REASONS = [
  'Incorrect amount',
  'Incorrect student',
  'Duplicate collection',
  'Insufficient evidence',
  'Invalid collection',
  'Other',
] as const

// Queue chip mapping (spec): Pending Principal Acceptance → amber 'Pending',
// Collected by Teacher → sky, Clarification Requested → violet.
function queueChip(status: CashRequest['status']): { label: string; tone: string } {
  switch (status) {
    case 'Pending Principal Acceptance':
      return { label: 'Pending', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    case 'Collected by Teacher':
      return { label: 'Collected', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
    case 'Clarification Requested':
      return { label: 'Clarification', tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
    default:
      return { label: status, tone: '' }
  }
}

function QueueStatusChip({ status }: { status: CashRequest['status'] }) {
  const { label, tone } = queueChip(status)
  return (
    <span
      title={status}
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', tone)}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  )
}

/** Who recorded the payment awaiting verification — SaaS-STAGE-1 keeps ONE
 *  source vocabulary everywhere (shared SourceChip); this helper is kept
 *  for confirmation-modal copy. */
function _collectorLabel(role: FeeTransaction['collectorRole'], collectedBy: string): string {
  if (role === 'teacher') return `Teacher · ${collectedBy}`
  if (role === 'class_teacher') return `Class Teacher · ${collectedBy}`
  if (role === 'self') return 'Student self-service'
  return `Office · ${collectedBy}`
}

export function FeesVerificationQueue({ data }: { data: ReturnType<typeof useFeeData> }) {
  const { cashRequests, accounts, analytics, transactions } = data
  const approveCashRequest = useFeeStore((s) => s.approveCashRequest)
  const rejectCashRequest = useFeeStore((s) => s.rejectCashRequest)
  const requestClarification = useFeeStore((s) => s.requestClarification)
  const approveDirectCashTxn = useFeeStore((s) => s.approveDirectCashTxn)
  const rejectDirectCashTxn = useFeeStore((s) => s.rejectDirectCashTxn)

  // Modal state
  const [approvingReq, setApprovingReq] = useState<CashRequest | null>(null)
  const [rejectingReq, setRejectingReq] = useState<CashRequest | null>(null)
  const [clarifyReq, setClarifyReq] = useState<CashRequest | null>(null)
  const [rejectReason, setRejectReason] = useState<string>('')
  const [rejectNote, setRejectNote] = useState<string>('')
  const [clarifyMessage, setClarifyMessage] = useState<string>('')
  const [actionLoading, setActionLoading] = useState(false)

  // DIRECT cash entries — cash recorded straight into the ledger (student
  // self-service / application payments) that still awaits verification.
  const directPending = transactions.filter((t) => t.status === 'Under Verification').slice(0, 8)
  const [rejectingDirect, setRejectingDirect] = useState<FeeTransaction | null>(null)
  const [rejectingDirectReason, setRejectingDirectReason] = useState('')

  const pending = cashRequests.filter((r) => r.status === 'Pending Principal Acceptance' || r.status === 'Collected by Teacher' || r.status === 'Clarification Requested')
  const resolved = cashRequests.filter((r) => r.status === 'Confirmed by Principal' || r.status === 'Rejected')

  const pendingAcceptanceCount = pending.filter((r) => r.status !== 'Clarification Requested').length
  const clarificationCount = pending.filter((r) => r.status === 'Clarification Requested').length

  // The ONE queue = transaction-level verifications + the teacher cash-request
  // queue — subtitle counts reflect BOTH channels (spec §3: single workflow).
  const queueCount = pending.length + directPending.length
  const pendingAmount =
    pending.reduce((s, r) => s + r.amount, 0) +
    directPending.reduce((s, t) => s + t.amount, 0)

  // Slim all-clear condition (spec §6): nothing pending across BOTH channels
  // — transaction-level verifications AND the teacher cash-request queue.
  const combinedZero = analytics.pendingVerification + analytics.pendingCashRequests === 0

  // Compute the student's current outstanding for the approve modal
  const getStudentOutstanding = (studentId: string): number => {
    const acct = accounts.find((a) => a.studentId === studentId)
    return acct?.outstanding ?? 0
  }

  const handleApprove = () => {
    if (!approvingReq) return
    setActionLoading(true)
    approveCashRequest(approvingReq.id, 'Principal')
    toast.success('Payment approved successfully', {
      description: `Receipt issued for ${approvingReq.studentName}. Transaction posted to ledger.`,
    })
    setActionLoading(false)
    setApprovingReq(null)
  }

  const handleReject = () => {
    if (!rejectingReq) return
    const reason = rejectReason === 'Other' ? rejectNote : rejectReason
    if (!reason.trim()) {
      toast.error('Reason required', { description: 'Please select or enter a rejection reason.' })
      return
    }
    setActionLoading(true)
    rejectCashRequest(rejectingReq.id, 'Principal', reason)
    toast.error('Cash request rejected', {
      description: `${rejectingReq.studentName} — ${reason}. Teacher will be notified.`,
    })
    setActionLoading(false)
    setRejectingReq(null)
    setRejectReason('')
    setRejectNote('')
  }

  const handleClarify = () => {
    if (!clarifyReq) return
    if (!clarifyMessage.trim()) {
      toast.error('Message required', { description: 'Please enter a clarification message.' })
      return
    }
    setActionLoading(true)
    requestClarification(clarifyReq.id, 'Principal', clarifyMessage)
    toast.info('Clarification requested', {
      description: `${clarifyReq.studentName} — awaiting teacher response.`,
    })
    setActionLoading(false)
    setClarifyReq(null)
    setClarifyMessage('')
  }

  return (
    <>
      {/* ── Cash Verification panel (queue + collapsed resolved history) ── */}
      <Panel
        title="Cash Verification"
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {(pendingAcceptanceCount > 0 || directPending.length > 0) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {queueCount} pending
              </span>
            )}
            {clarificationCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-300">
                {clarificationCount} clarification{clarificationCount === 1 ? '' : 's'}
              </span>
            )}
            {pending.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatINR(pendingAmount, true)} awaiting
              </span>
            )}
            {pending.length === 0 && directPending.length === 0 && !combinedZero && (
              <span className="text-[10px] text-muted-foreground">No cash collections in the queue</span>
            )}
          </span>
        }
        bodyClassName="p-0"
      >
        {pending.length === 0 && directPending.length === 0 ? (
          combinedZero ? (
            /* Slim all-clear row (spec) — every verification channel empty */
            <div className="flex items-center gap-2.5 px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600" aria-hidden>
                <Check className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs text-muted-foreground">No pending verifications</p>
            </div>
          ) : (
            /* Queue locally empty but other verifications exist (e.g. online
               payments under review) — keep the fuller empty state */
            <div className="px-4 pb-4">
              <FeeEmptyState
                icon={<Check className="h-6 w-6" />}
                title="All caught up"
                description="No cash collections are waiting for your verification."
              />
            </div>
          )
        ) : (
          /* ONE compact verification table — the Transactions UI language
             (spec §3: clean list/table workflow, NO oversized cards).
             Both verification channels render as the same row anatomy:
             student · class · amount · method · source · date · reference ·
             status · actions; only the actions differ per channel. */
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
                {directPending.map((t) => (
                  <tr key={t.id} className="border-t border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="font-medium leading-tight">{t.studentName}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{t.admissionNo} · {t.feeHead}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">{t.className}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{formatINR(t.amount)}</td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1', modeAccent(t.mode))}>
                        <ModeIcon mode={t.mode} className="h-2.5 w-2.5" />
                        {t.mode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {/* Operational source (SaaS-STAGE-1): shared chip vocabulary */}
                      <SourceChip role={t.collectorRole} collectedBy={t.collectedBy} maxW="max-w-[130px]" />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden lg:table-cell"><TxnDateTime transaction={t} /></td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground hidden 2xl:table-cell">{t.referenceNo ?? '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <FeeStatusBadge status={paymentStatusLabel(t.status, 'principal')} />
                    </td>
                    <td className="pl-3 pr-4 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-[10px] gap-1 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                          aria-label={`Reject ${t.studentName}'s payment`}
                          title="Reject"
                          onClick={() => { setRejectingDirect(t); setRejectingDirectReason('') }}
                        >
                          <X className="h-3 w-3" /> <span className="hidden 2xl:inline">Reject</span>
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          aria-label={`Verify ${t.studentName}'s payment`}
                          title="Verify"
                          onClick={() => {
                            const r = approveDirectCashTxn(t.id, 'Principal')
                            if (r.success) toast.success('Cash verified', { description: `${t.receiptNo} posted as successful for ${t.studentName}.` })
                            else toast.error('Could not verify', { description: r.error })
                          }}
                        >
                          <Check className="h-3 w-3" /> <span className="hidden 2xl:inline">Verify</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Teacher cash-request queue — same row anatomy; decisions
                    run through the confirmation modals below. */}
                {pending.map((r) => {
                  const isPending = r.status === 'Pending Principal Acceptance' || r.status === 'Collected by Teacher'
                  const isClarification = r.status === 'Clarification Requested'
                  const actionable = isPending || isClarification
                  return (
                    <tr key={r.id} className="border-t border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5">
                        <p className="font-medium leading-tight">{r.studentName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{r.admissionNo} · {r.feeHead}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">{r.className}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{formatINR(r.amount)}</td>
                      <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ring-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20">
                          <Banknote className="h-2.5 w-2.5" />
                          Cash
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <SourceChip role="teacher" collectedBy={r.collectedBy} maxW="max-w-[130px]" />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden lg:table-cell"><DateTimeText date={r.collectedAt} instant={r.collectedAt.includes('T') ? r.collectedAt : null} /></td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground hidden 2xl:table-cell">{r.referenceNo ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center"><QueueStatusChip status={r.status} /></td>
                      <td className="pl-3 pr-4 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:bg-muted"
                            aria-label={`Request clarification from ${r.collectedBy} about ${r.studentName}'s payment`}
                            title="Request Clarification"
                            onClick={() => { setClarifyReq(r); setClarifyMessage('') }}
                            disabled={!actionable}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-[10px] gap-1 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
                            aria-label={`Reject ${r.studentName}'s cash collection`}
                            title="Reject"
                            onClick={() => { setRejectingReq(r); setRejectReason(''); setRejectNote('') }}
                            disabled={!actionable}
                          >
                            <X className="h-3 w-3" /> <span className="hidden 2xl:inline">Reject</span>
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            aria-label={`Approve ${r.studentName}'s cash collection`}
                            title="Approve"
                            onClick={() => setApprovingReq(r)}
                            disabled={!actionable}
                          >
                            <Check className="h-3 w-3" /> <span className="hidden 2xl:inline">Approve</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Recently resolved — collapsed audit inside the same panel ── */}
        {resolved.length > 0 && (
          <details className="border-t border-border/60">
            <summary className="flex items-center justify-between gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden px-4 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30">
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3 w-3" aria-hidden />
                Recently resolved ({resolved.length})
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </summary>
            <div className="divide-y divide-border border-t border-border/50 px-4">
              {resolved.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 py-2">
                  <span className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
                    r.status === 'Confirmed by Principal' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' : 'bg-rose-500/10 text-rose-600 ring-rose-500/20',
                  )}>
                    {r.status === 'Confirmed by Principal' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {r.studentName} · <span className="text-muted-foreground font-mono text-[10px]">{r.admissionNo}</span>
                    </p>
                    <p className="text-[9px] text-muted-foreground truncate">
                      {r.collectedBy} · {formatDate(r.submittedAt)}
                      {r.reason && <span className="text-amber-600 italic"> — "{r.reason}"</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold tabular-nums">{formatINR(r.amount, true)}</p>
                    <FeeStatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </Panel>

      {/* ── Confirmation modals (business logic unchanged) ───────────── */}
      <AnimatePresence>
        {approvingReq && (
          <ApproveModal
            req={approvingReq}
            currentOutstanding={getStudentOutstanding(approvingReq.studentId)}
            loading={actionLoading}
            onClose={() => setApprovingReq(null)}
            onConfirm={handleApprove}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rejectingReq && (
          <RejectModal
            req={rejectingReq}
            reason={rejectReason}
            setReason={setRejectReason}
            note={rejectNote}
            setNote={setRejectNote}
            loading={actionLoading}
            onClose={() => setRejectingReq(null)}
            onConfirm={handleReject}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {clarifyReq && (
          <ClarifyModal
            req={clarifyReq}
            message={clarifyMessage}
            setMessage={setClarifyMessage}
            loading={actionLoading}
            onClose={() => setClarifyReq(null)}
            onConfirm={handleClarify}
          />
        )}
      </AnimatePresence>

      {/* ── Direct cash reject (mandatory reason, no money recorded) ── */}
      <Dialog open={!!rejectingDirect} onOpenChange={(o) => !o && setRejectingDirect(null)}>
        <DialogContent className="max-w-sm z-[70]">
          <DialogHeader>
            <DialogTitle className="text-sm">Reject direct cash entry</DialogTitle>
            <DialogDescription className="text-xs">
              {rejectingDirect && `${rejectingDirect.studentName} · ${formatINR(rejectingDirect.amount, true)} · ${rejectingDirect.receiptNo}. Nothing has been posted; the entry becomes Failed with your reason on record.`}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-[64px] text-xs"
            placeholder="Reason (required) — shown in the audit trail"
            value={rejectingDirectReason}
            onChange={(e) => setRejectingDirectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRejectingDirect(null)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!rejectingDirectReason.trim()}
              onClick={() => {
                if (!rejectingDirect) return
                const r = rejectDirectCashTxn(rejectingDirect.id, 'Principal', rejectingDirectReason.trim())
                if (r.success) toast.error('Direct cash rejected', { description: `${rejectingDirect.receiptNo} — ${rejectingDirectReason.trim()}` })
                else toast.error('Could not reject', { description: r.error })
                setRejectingDirect(null)
              }}
            >
              Reject entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Approve Modal ──────────────────────────────────────────────────

function ApproveModal({ req, currentOutstanding, loading, onClose, onConfirm }: {
  req: CashRequest
  currentOutstanding: number
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  useDismissOnEscape(onClose)
  const balanceAfter = Math.max(0, currentOutstanding - req.amount)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Approve cash payment"
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
            Approve Cash Payment?
          </h3>
        </div>
        <div className="p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Student</span>
            <span className="font-medium">{req.studentName}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Class</span>
            <span className="font-medium">{req.className}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Fee Head</span>
            <span className="font-medium">{req.feeHead}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount Submitted</span>
            <span className="font-bold tabular-nums text-emerald-600">{formatINR(req.amount, true)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Collected By</span>
            <span className="font-medium">{req.collectedBy}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Collected At</span>
            <span className="font-medium">{formatDate(req.collectedAt)}</span>
          </div>

          {/* Balance impact — Before → After tiny tile pair (benchmark recipe) */}
          <div className="pt-2 mt-2 border-t border-border/40">
            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
              <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Before</p>
                <p className="text-sm font-bold tabular-nums text-rose-600 mt-0.5">{formatINR(currentOutstanding, true)}</p>
              </div>
              <ArrowRight className="self-center h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5">
                <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">After</p>
                <p className="text-sm font-bold tabular-nums text-emerald-600 mt-0.5">{formatINR(balanceAfter, true)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2 mt-2">
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300">
              This will approve the cash collection, generate a receipt, post the transaction, update the student's fee account, reduce outstanding dues, and create an audit entry.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {loading ? 'Approving...' : 'Approve & Issue Receipt'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Reject Modal ───────────────────────────────────────────────────

function RejectModal({ req, reason, setReason, note, setNote, loading, onClose, onConfirm }: {
  req: CashRequest
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
      aria-label="Reject cash payment"
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
            Reject Cash Payment
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{req.studentName} · {formatINR(req.amount, true)}</p>
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
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider" htmlFor="cash-reject-note">Additional Note (optional)</label>
            <textarea
              id="cash-reject-note"
              value={note && reason !== 'Other' ? note : ''}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add any additional context…"
              rows={2}
              className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 mt-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-rose-500/30"
            />
          </div>
          <div className="rounded-md bg-rose-500/5 border border-rose-500/20 p-2">
            <p className="text-[10px] text-rose-700 dark:text-rose-300">
              No transaction will be posted. No receipt will be issued. Student balance will NOT change. The collector will be notified with the reason.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-rose-600 hover:bg-rose-700 text-white" onClick={onConfirm} disabled={loading || !reason}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {loading ? 'Rejecting...' : 'Reject Payment'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Clarify Modal ──────────────────────────────────────────────────

function ClarifyModal({ req, message, setMessage, loading, onClose, onConfirm }: {
  req: CashRequest
  message: string
  setMessage: (v: string) => void
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
      aria-label="Request clarification"
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
            <MessageSquare className="h-4 w-4 text-amber-600" />
            Request Clarification
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{req.studentName} · {formatINR(req.amount, true)}</p>
        </div>
        <div className="p-4 space-y-2">
          <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider" htmlFor="cash-clarify-message">Message to Collector <span className="text-rose-600">*</span></label>
          <textarea
            id="cash-clarify-message"
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Please upload the original deposit slip and confirm the amount collected."
            rows={3}
            className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
          <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2">
            <p className="text-[10px] text-amber-700 dark:text-amber-300">
              The collector will be notified. The request will move to "Clarification Requested" status until the teacher responds.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
            {loading ? 'Sending...' : 'Send Clarification'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
