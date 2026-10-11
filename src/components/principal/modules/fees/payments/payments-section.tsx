'use client'

/**
 * PaymentsSection — the OPERATIONS page of Fee Management.
 *
 *   Payments is for ACTIONS. Transactions is for HISTORY. Overview is for INSIGHTS.
 *
 * Contents (FINAL PAYMENTS UI POLISH — page order is fixed):
 *   1. Payment summary — Today / Week / Month as the SAME compact
 *      Overview-style SummaryCards (tinted bg, icon, uppercase label,
 *      large tabular value, one useful sub line — payment counts computed
 *      with the exact same filters as the ledger analytics). No bulky
 *      treatment, no extra metrics. The primary "Collect Fee" CTA sits
 *      RIGHT (opens the collection wizard).
 *   2. Recent Payments — NEW / ACTIONABLE payment activity as a
 *      Transactions-style compact table (dense rows, tiny mode icons,
 *      subtle status pills, date + small secondary time, right-aligned
 *      receipt actions; contextual bulk receipt print/download).
 *      A payment leaves this list the moment its receipt is printed or
 *      downloaded — it settles into Transactions (never deleted)
 *      (→ payments/recent-payments).
 *   3. Cash Verification — the verification workflow in the exact same
 *      compact table language (→ fees-approvals). Gateway-confirmed
 *      payments never appear here — they are recorded Paid automatically.
 *   4. Additional Collections — ALWAYS LAST. First-class collections with
 *      a full lifecycle (Draft → Active → Closed → Archived): the Principal
 *      can CREATE them right here (+ New Collection — no form required,
 *      §APPS-IA-1), record payments, and cross-check the linked form where
 *      one exists (→ fees-additional-charges).
 *
 * What deliberately does NOT live here: financial KPIs, the collection trend,
 * payment-mode analytics (→ Overview) and the complete transaction ledger
 * (→ Transactions) — a payment settles there once its receipt is issued.
 */

import { IndianRupee, CalendarDays, CalendarRange, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFeeData } from '@/lib/store/fee-store'
import { formatINR } from '@/lib/format'
// SaaS-STAGE-2A (Task 7-b) — the open-collect affordances follow the
// ACTIVE school's fee_collect sub-feature. Cash Verification and the
// tables are core operations and stay. SummaryCards untouched.
import { useFeatureGate } from '@/lib/tenant/store'
import { SummaryCard, SummaryCardGrid } from '../../shared/summary-card'
import { FeesVerificationQueue } from '../fees-approvals'
import { FeesAdditionalCharges } from '../fees-additional-charges'
import { RecentPayments } from './recent-payments'
import { VerificationWorkspace } from './verification-workspace'

interface Props {
  data: ReturnType<typeof useFeeData>
  onCollect: () => void
  onOpenTransactions?: () => void
}

/** Payment count for a bucket — mirrors the analytics Success-only filter
 *  (the same source the value above it sums), so sub and value never disagree. */
const countLabel = (n: number) =>
  n === 0 ? 'no payments yet' : `${n} payment${n === 1 ? '' : 's'}`

export function PaymentsSection({ data, onCollect, onOpenTransactions }: Props) {
  const { analytics, transactions } = data
  // SaaS-STAGE-2A (Task 7-b) — the Collect Fee CTA (and any open-collect
  // entry point) renders only when the school's platform configuration
  // enables fee_collect. The store enforces the same gate at action time.
  const gate = useFeatureGate()
  const canCollect = gate.isSubFeatureEnabled('fee_collect')

  // Operational snapshot — successful collections landing right now
  // (same Success-only source as the ledger; counts share the filters).
  const success = transactions.filter((t) => t.status === 'Success')
  const today = new Date().toISOString().split('T')[0]
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7)
  const monthStart = new Date(); monthStart.setMonth(monthStart.getMonth() - 1)

  return (
    <div className="space-y-4">
      {/* 0 — PAYMENT VERIFICATION (real canonical ledger) — the two-stage
          collection workflow's principal side: class-teacher collections
          awaiting the Principal's decision + direct office payments.
          Lives FIRST: it is the operational heart of this tab. */}
      <VerificationWorkspace />

      {/* 1 — Payment summary + primary action. Overview-style compact
          summary cards; the "Payments" tab already establishes context,
          so no page heading — the page opens straight into live figures. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SummaryCardGrid columns={3} className="flex-1 min-w-[280px] max-w-2xl [&>*]:min-w-0">
          <SummaryCard
            icon={<CalendarDays className="h-4 w-4" />}
            label="Today"
            value={formatINR(analytics.todayCollection, true)}
            sub={countLabel(success.filter((t) => t.date === today).length)}
            tone="emerald"
          />
          <SummaryCard
            icon={<CalendarRange className="h-4 w-4" />}
            label="This Week"
            value={formatINR(analytics.weekCollection, true)}
            sub={countLabel(success.filter((t) => new Date(t.date) >= weekStart).length)}
            tone="teal"
          />
          <SummaryCard
            icon={<IndianRupee className="h-4 w-4" />}
            label="This Month"
            value={formatINR(analytics.monthCollection, true)}
            sub={countLabel(success.filter((t) => new Date(t.date) >= monthStart).length)}
            tone="slate"
          />
        </SummaryCardGrid>
        {/* Primary action — same treatment as Salary & Payroll → Payments'
            "Record Payment" (white outline, subtle border, Wallet icon,
            identical height/typography/radius): one shared enterprise
            design system across money modules.
            SaaS-STAGE-2A (Task 7-b) — hidden when fee_collect is disabled
            for the school; verification + tables stay. */}
        {canCollect && (
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={onCollect}
            >
              <Wallet className="h-3 w-3" /> Collect Fee
            </Button>
          </div>
        )}
      </div>

      {/* 2 — Recent / Active Payments (current actionable activity +
          contextual bulk receipt actions) */}
      <RecentPayments data={data} onOpenTransactions={onOpenTransactions} />

      {/* 3 — Cash Verification (compact table; renders its own all-clear
          slim row when nothing is pending). BATCH2-B5: the queue is the
          canonical GET /api/fees/verification payload — same server rows
          the Payment Verification workspace above renders. */}
      <FeesVerificationQueue />

      {/* 4 — Additional Collections — ALWAYS LAST (lifecycle-aware:
          creation + payment status per collection; forms link optionally) */}
      <FeesAdditionalCharges data={data} onCollect={canCollect ? onCollect : undefined} />
    </div>
  )
}
