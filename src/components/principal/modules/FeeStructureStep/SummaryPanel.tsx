import { ShoppingCart } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LedgerRow } from './primitives'

/** THREE-STATE (PR-3): UNDEFINED = not configured — the summary renders
 *  "Not configured"/"—" and a completion warning, never a fabricated total. */
export interface SummaryPanelProps {
  registrationFee: number | undefined
  admissionFee: number | undefined
  tuitionFee: number | undefined
  otherHeadsTotal: number
  examTotal: number | undefined
  booksTotal: number
  booksCount: number
  uniformTotal: number
  uniformCount: number
  activityKitTotal: number
  activityKitCount: number
  transportTotal: number
  hostelTotal: number
  grossFee: number | undefined
  scholarshipAmount: number | undefined
  waiverAmount: number | undefined
  netTotal: number | undefined
  initialInstallment: number | undefined
  remainingBalance: number | undefined
}

/** Real-time fee summary card (right column, sticky). */
export function SummaryPanel(props: SummaryPanelProps) {
  const {
    registrationFee, admissionFee, tuitionFee, otherHeadsTotal,
    examTotal, booksTotal, booksCount, uniformTotal, uniformCount,
    activityKitTotal, activityKitCount, transportTotal, hostelTotal,
    grossFee, scholarshipAmount, waiverAmount, netTotal,
    initialInstallment, remainingBalance,
  } = props

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sticky top-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <ShoppingCart className="h-4 w-4" /> Fee Summary
          </h4>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono font-bold text-[10px]">LIVE</Badge>
        </div>

        <div className="space-y-1.5 text-xs font-mono">
          <LedgerRow label="Registration" value={registrationFee} />
          <LedgerRow label="Admission Fee" value={admissionFee} />
          <LedgerRow label="Tuition (Annual)" value={tuitionFee} />
          <LedgerRow label="Development & Tech" value={otherHeadsTotal} />
          {(examTotal ?? 0) > 0 && <LedgerRow label="Exam & Assessment" value={examTotal} />}
          {booksTotal > 0 && <LedgerRow label={`Books (${booksCount})`} value={booksTotal} />}
          {uniformTotal > 0 && <LedgerRow label={`Uniform (${uniformCount})`} value={uniformTotal} />}
          {activityKitTotal > 0 && <LedgerRow label={`Activity Kit (${activityKitCount})`} value={activityKitTotal} />}
          {transportTotal > 0 && <LedgerRow label="Transport" value={transportTotal} />}
          {hostelTotal > 0 && <LedgerRow label="Hostel" value={hostelTotal} />}

          <div className="pt-2 border-t border-border/60 flex justify-between font-bold text-foreground">
            <span>Gross Fee</span>
            <span className={cn('tabular-nums', grossFee === undefined && 'font-sans font-medium italic text-muted-foreground/70')}>
              {grossFee === undefined ? '—' : formatINR(grossFee)}
            </span>
          </div>

          {(scholarshipAmount ?? 0) > 0 && (
            <div className="flex justify-between text-violet-600 dark:text-violet-400">
              <span>Scholarship</span>
              <span className="tabular-nums">− {formatINR(scholarshipAmount ?? 0)}</span>
            </div>
          )}
          {(waiverAmount ?? 0) > 0 && (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>Waiver / Discount</span>
              <span className="tabular-nums">− {formatINR(waiverAmount ?? 0)}</span>
            </div>
          )}

          <div className="pt-2 border-t-2 border-border flex justify-between items-end text-foreground">
            <div>
              <span className="text-[10px] font-sans text-muted-foreground uppercase tracking-widest block font-bold">Total Payable</span>
              <span className={cn('text-2xl font-black font-mono tabular-nums', netTotal === undefined ? 'font-sans text-base font-medium italic text-muted-foreground/70' : 'text-emerald-600 dark:text-emerald-400')}>
                {netTotal === undefined ? 'Not configured' : formatINR(netTotal)}
              </span>
            </div>
          </div>

          {(registrationFee === undefined || admissionFee === undefined || tuitionFee === undefined || examTotal === undefined) && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
              Fee configuration incomplete — required fee heads or exam fees are not configured for this school. Configure them in Fee Management so the wizard and official documents can carry real amounts.
            </p>
          )}

          <div className="pt-2 border-t border-border/60 space-y-1.5">
            <div className="flex justify-between text-amber-600 dark:text-amber-400">
              <span>Initial Installment (40%)</span>
              <span className={cn('tabular-nums', initialInstallment === undefined && 'font-sans italic text-muted-foreground/70')}>
                {initialInstallment === undefined ? '—' : formatINR(initialInstallment)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Remaining Balance</span>
              <span className={cn('tabular-nums', remainingBalance === undefined && 'font-sans italic text-muted-foreground/70')}>
                {remainingBalance === undefined ? '—' : formatINR(remainingBalance)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
