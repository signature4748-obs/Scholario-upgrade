'use client'

/**
 * FeeReceiptViewer — THE canonical receipt document (MASTER TASK §16–§18).
 *
 * One component, one data source (GET /api/fees/receipts/[txnId]),
 * rendered identically from every authorised surface: the teacher's
 * collection table, the principal's verification queue, the student
 * profile payment history.
 *
 *   · VERIFIED              → the official FEE PAYMENT RECEIPT with the
 *                             unique SCH-YYYY-NNNN number, school
 *                             branding, full trace (collected by /
 *                             verified by) and balance due from the
 *                             SAME Fee row every ledger reads.
 *   · UNDER_VERIFICATION    → the PROVISIONAL COLLECTION
 *                             ACKNOWLEDGEMENT — clearly NOT an official
 *                             receipt; no receipt number is claimed.
 *   · REJECTED              → an honest rejection notice with reason.
 *
 * Print: browser print with a receipt-only print stylesheet
 * (File → Save as PDF produces the downloadable copy).
 */

import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GradientAvatar } from '@/components/shared/ui'
import { formatINR } from '@/lib/format'
import { methodLabel, sourceLabel, txnDate, txnDateTime } from './txn-meta'
import {
  BadgeCheck, Ban, Banknote, Building2, Clock3, FileText, Landmark,
  Printer, ShieldCheck, User2,
} from 'lucide-react'

export interface ReceiptPayload {
  txn: {
    id: string
    status: string
    receiptNo: string | null
    amount: number
    method: string
    source: string | null
    referenceNumber: string | null
    note: string | null
    studentName: string | null
    className: string | null
    feeHeadName: string | null
    collectedByName: string | null
    collectedAt: string | null
    verifiedByName: string | null
    verifiedAt: string | null
    rejectedByName: string | null
    rejectedAt: string | null
    rejectionReason: string | null
    createdAt: string
  }
  school: {
    name: string
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    academicYear: string | null
  }
  student: {
    name: string
    admissionNo: string | null
    rollNo: string | null
    classLabel: string
    guardianName: string | null
  } | null
  fee: { title: string; amount: number; paid: number; outstanding: number } | null
}

interface Props {
  txnId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** open the browser print dialog as soon as the receipt loads — the
   *  "Download receipt" shortcut (File → Save as PDF is the canonical
   *  document export path, exactly like the manual Print button). */
  autoPrint?: boolean
}

export function FeeReceiptViewer({ txnId, open, onOpenChange, autoPrint = false }: Props) {
  const [data, setData] = useState<ReceiptPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Retry affordance — bumps to force a real refetch of the same txn.
  const [retryTick, setRetryTick] = useState(0)
  const autoPrintDone = useRef(false)

  useEffect(() => {
    if (!open || !txnId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    autoPrintDone.current = false
    fetch(`/api/fees/receipts/${txnId}`, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; data?: ReceiptPayload } | null
        if (!res.ok || !json || json.ok !== true || !json.data) {
          throw new Error(json?.error || `Request failed (${res.status})`)
        }
        return json.data
      })
      .then((d) => {
        if (cancelled) return
        setData(d)
        if (autoPrint && !autoPrintDone.current) {
          autoPrintDone.current = true
          // let the document paint before the print dialog opens
          window.setTimeout(() => window.print(), 350)
        }
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, txnId, autoPrint, retryTick])

  const t = data?.txn
  const isVerified = t?.status === 'SUCCESS'
  const isPending = t?.status === 'UNDER_VERIFICATION'
  const isRejected = t?.status === 'REJECTED'

  // The DialogTitle must ALWAYS be rendered (Radix a11y contract) — even
  // while loading or on error — so the label is derived from state instead
  // of being gated behind the loaded-data branch.
  const titleText = error
    ? 'Receipt unavailable'
    : !t
      ? 'Loading receipt…'
      : isVerified
        ? 'Fee Payment Receipt'
        : isPending
          ? 'Collection Acknowledgement'
          : 'Payment Notice'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="p-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-emerald-600" />
            {titleText}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {error
              ? 'The receipt could not be loaded. Please try again.'
              : 'Fee collection document for the selected student transaction.'}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-4 p-5">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}
        {error && (
          <div className="p-5">
            <p className="text-sm text-destructive">{error}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                The receipt is on the school server — a retry usually resolves this.
              </p>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setRetryTick((t) => t + 1)}>
                Try again
              </Button>
            </div>
          </div>
        )}
        {data && t && (
          <div>

            {/* Receipt-only print stylesheet: everything outside the
                sheet is hidden when the user prints / saves as PDF. */}
            <style>{`
              @media print {
                body * { visibility: hidden !important; }
                #fee-receipt-print, #fee-receipt-print * { visibility: visible !important; }
                #fee-receipt-print { position: absolute; inset: 0; width: 100%; }
                .no-print { display: none !important; }
              }
            `}</style>

            <div id="fee-receipt-print" className="px-5 pb-2 pt-4">
              {/* School letterhead */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                    <Building2 className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight">{data.school.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[data.school.address, data.school.city].filter(Boolean).join(', ') || '—'}
                      {data.school.phone ? ` · ${data.school.phone}` : ''}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {isVerified ? 'Official Receipt' : 'Provisional'}
                  </p>
                  <p className="font-mono text-xs font-semibold tabular-nums">
                    {t.receiptNo ?? 'No receipt yet'}
                  </p>
                </div>
              </div>

              {/* Status banner */}
              {isPending && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">Collection recorded — awaiting Principal verification</p>
                    <p className="mt-0.5 text-amber-700/90 dark:text-amber-400/90">
                      This acknowledgement confirms the money was received by the class teacher. It is
                      <strong> not a final school receipt</strong> — that is issued after the Principal verifies the payment.
                      The student&rsquo;s fee balance does not change until then.
                    </p>
                  </div>
                </div>
              )}
              {isRejected && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-semibold text-rose-800 dark:text-rose-300">Payment rejected — no money was credited</p>
                    <p className="mt-0.5 text-rose-700/90 dark:text-rose-400/90">
                      Rejected by {t.rejectedByName ?? 'the Principal'} on {txnDate(t.rejectedAt)}.
                      {t.rejectionReason ? ` Reason: “${t.rejectionReason}”` : ''}
                      {' '}The student&rsquo;s fee balance was not changed.
                    </p>
                  </div>
                </div>
              )}

              {/* Student */}
              <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
                <GradientAvatar name={data.student?.name ?? t.studentName ?? 'Student'} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{data.student?.name ?? t.studentName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {data.student?.classLabel ?? t.className ?? 'Unassigned'}
                    {data.student?.rollNo ? ` · Roll ${data.student.rollNo}` : ''}
                    {data.student?.admissionNo ? ` · Adm. ${data.student.admissionNo}` : ''}
                  </p>
                  {data.student?.guardianName && (
                    <p className="truncate text-[11px] text-muted-foreground">Guardian: {data.student.guardianName}</p>
                  )}
                </div>
                {isVerified && (
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <BadgeCheck className="h-4 w-4" />
                  </div>
                )}
              </div>

              {/* Fee + amount */}
              <div className="mt-3 rounded-xl border divide-y">
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fee</p>
                    <p className="truncate text-sm font-medium">{t.feeHeadName ?? data.fee?.title ?? 'School fee'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</p>
                    <p className="text-sm font-bold tabular-nums">{formatINR(t.amount)}</p>
                  </div>
                </div>
                {data.fee && (
                  <div className="flex items-center justify-between gap-3 p-3 text-[11px]">
                    <span className="text-muted-foreground">
                      Fee total {formatINR(data.fee.amount)} · paid {formatINR(data.fee.paid)}
                    </span>
                    <span className={data.fee.outstanding > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'font-semibold text-emerald-700 dark:text-emerald-400'}>
                      Balance due {formatINR(data.fee.outstanding)}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment trace */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <Trace icon={<Banknote className="h-3.5 w-3.5" />} label="Method" value={methodLabel(t.method)} />
                <Trace icon={<Landmark className="h-3.5 w-3.5" />} label="Source" value={sourceLabel(t.source)} />
                <Trace icon={<User2 className="h-3.5 w-3.5" />} label="Collected by" value={t.collectedByName ?? '—'} />
                <Trace icon={<Clock3 className="h-3.5 w-3.5" />} label="Collected on" value={txnDateTime(t.collectedAt)} />
                {isVerified && (
                  <>
                    <Trace icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Verified by" value={t.verifiedByName ?? '—'} />
                    <Trace icon={<BadgeCheck className="h-3.5 w-3.5" />} label="Verified on" value={txnDate(t.verifiedAt)} />
                  </>
                )}
                {t.referenceNumber && <Trace icon={<FileText className="h-3.5 w-3.5" />} label="Reference" value={t.referenceNumber} />}
                {data.school.academicYear && <Trace icon={<Building2 className="h-3.5 w-3.5" />} label="Academic year" value={data.school.academicYear} />}
              </div>

              {t.note && (
                <p className="mt-3 rounded-lg bg-muted/60 p-2.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Note:</span> {t.note}
                </p>
              )}

              {/* Signatures */}
              {isVerified && (
                <div className="mt-5 grid grid-cols-2 gap-6 pb-2">
                  <div className="border-t border-dashed pt-1.5 text-center text-[10px] text-muted-foreground">
                    Collector — {t.collectedByName ?? 'Class Teacher'}
                  </div>
                  <div className="border-t border-dashed pt-1.5 text-center text-[10px] text-muted-foreground">
                    Authorised Signatory — {t.verifiedByName ?? 'Principal'}
                  </div>
                </div>
              )}
            </div>

            {/* Actions (screen only) */}
            <div className="no-print flex items-center justify-between gap-2 border-t p-4">
              <p className="text-[11px] text-muted-foreground">
                {isVerified
                  ? `Receipt ${t.receiptNo} · computer generated`
                  : 'Provisional document · not a final receipt'}
              </p>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />
                {isVerified ? 'Print / Save PDF' : 'Print acknowledgement'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Trace({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 truncate font-medium" title={value}>{value}</p>
    </div>
  )
}
