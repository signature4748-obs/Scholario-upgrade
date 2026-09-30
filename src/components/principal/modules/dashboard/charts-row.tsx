'use client'

/**
 * ChartsRow1 — the dashboard's primary visualization row.
 *
 * PHASE 7 — REAL DATA CONTRACT: both charts read the canonical
 * school-scoped aggregate from `GET /api/dashboard`
 * (use-dashboard-finance). The retired mock inputs
 * (revenueAnalytics ₹1.16–2.42 Cr / feeAnalytics 88.6% donut) are GONE:
 *   · "Fee Collections" line chart = the REAL 6-month Payment trend;
 *     a school with no payments renders an honest empty state.
 *   · "Fee Collection" donut = REAL billed vs collected vs outstanding;
 *     ₹0 billed renders an honest empty state (not a fake 88.6%).
 *
 * Chart 1 was "Revenue vs Expenses" — there is no expense ledger in the
 * data model, so that series was pure fabrication; it is now the real
 * collections trend (expenses analytics belongs to a future expense
 * model, honestly absent).
 *
 * PHASE 7.5-D — honest failure + precise semantics:
 *   · a failed fetch renders an explicit retry state (the old code
 *     rendered the EMPTY state on error — indistinguishable from "no
 *     data"); the retry button calls the hook's `refresh()`;
 *   · the donut's "Outstanding" segment is a cross-system subtraction
 *     (Σ billed − Σ collected — two aggregate systems that can disagree
 *     with the Payment-row trend), so the segment labels say exactly
 *     what the numbers are: "Collected (payments recorded)" vs
 *     "Outstanding (billed − collected)";
 *   · the center collection-rate is clamped 0..100 via `safePercent()`
 *     (feesPaid can legitimately exceed feesTotal when the two
 *     aggregate systems drift — never render 103% or a negative rate).
 */

import { ArrowRight, AlertTriangle, IndianRupee, RotateCw } from 'lucide-react'
import {
  AreaTrendChart,
  DonutChart,
} from '@/components/shared/premium-charts'
import { Panel } from '../shared/panel'
import { OpenChartSection } from '../shared/open-chart-section'
import { useDashboardFinance } from './use-dashboard-finance'
import { Skeleton } from '@/components/ui/skeleton'

export interface ChartsRowProps {
  onNavigate?: (module: string) => void
}

const formatINRCr = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  return `₹${n.toLocaleString('en-IN')}`
}

/**
 * Collection rate clamped to 0..100 — the numerator (Σ Fee.paid) and the
 * denominator (Σ Fee.amount) come from different aggregate systems, so a
 * drift can push the raw ratio above 100 or below 0. Display the clamped
 * value; never render an impossible percentage.
 */
function safePercent(paid: number, total: number): number {
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((paid / total) * 100)))
}

function ChartEmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-1.5 text-center">
      <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center">
        <IndianRupee className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-[240px]">{hint}</p>}
    </div>
  )
}

/** Honest failure state — a Retry button wired to the hook's refresh(). */
function ChartErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-1.5 text-center" role="alert">
      <div className="h-10 w-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
        <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">Couldn’t load finance data</p>
      <p className="text-xs text-muted-foreground max-w-[240px]">
        The school finance aggregates failed to load.
      </p>
      <button
        onClick={onRetry}
        className="mt-1.5 inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-muted hover:bg-muted/70 text-[11px] font-semibold text-foreground transition-colors focus-ring"
      >
        <RotateCw className="h-3 w-3" aria-hidden="true" />
        Retry
      </button>
    </div>
  )
}

export function ChartsRow1({ onNavigate }: ChartsRowProps) {
  const { refresh, ...finance } = useDashboardFinance()

  // Cross-system subtraction, labelled as exactly that (see header note).
  const outstanding = Math.max(0, finance.feesTotal - finance.feesPaid)
  const collectionRate = safePercent(finance.feesPaid, finance.feesTotal)

  const hasTrend = finance.trend.some((d) => d.amount > 0)
  const hasFees = finance.feesTotal > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Fee Collections — 2/3 width, OPEN smooth line chart (no card border) */}
      <OpenChartSection
        className="lg:col-span-2"
        title="Fee Collections"
        subtitle="Last 6 months · recorded payments"
        action={
          <button
            onClick={() => onNavigate?.('fees')}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            title="Open Fee Management"
          >
            View Fees
            <ArrowRight className="h-3 w-3" />
          </button>
        }
      >
        {finance.status === 'loading' ? (
          <div className="h-[200px] flex items-end gap-3 px-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="flex-1" style={{ height: `${40 + ((i * 37) % 100)}px` }} />
            ))}
          </div>
        ) : finance.status === 'error' ? (
          <ChartErrorState onRetry={refresh} />
        ) : hasTrend ? (
          <AreaTrendChart
            data={finance.trend}
            height={200}
            formatValue={formatINRCr}
            labelKey="month"
            primaryKey="amount"
            primaryLabel="Collected"
            primaryColor="oklch(0.55 0.14 162)"
            showArea={false}
          />
        ) : (
          <ChartEmptyState
            message="No fee collections recorded yet"
            hint="Collections appear here as payments are recorded in Fee Management."
          />
        )}
      </OpenChartSection>

      {/* Fee Collection — 1/3 width, DonutChart (real billed vs collected) */}
      <Panel
        title="Fee Collection"
        subtitle="Billed vs collected"
        action={
          <button
            onClick={() => onNavigate?.('fees')}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            title="Open Fee Management"
          >
            View Fees
            <ArrowRight className="h-3 w-3" />
          </button>
        }
      >
        <div className="flex items-center justify-center py-2">
          {finance.status === 'loading' ? (
            <div className="h-[160px] w-[160px] flex items-center justify-center" aria-busy="true">
              <Skeleton className="h-[160px] w-[160px] rounded-full" />
            </div>
          ) : finance.status === 'error' ? (
            <ChartErrorState onRetry={refresh} />
          ) : hasFees ? (
            <DonutChart
              data={[
                {
                  // Short legend labels: the long parenthetical semantics
                  // moved to the footnote below — long names truncated the
                  // legend values in the 1/3-width card (PHASE 7.5 QA fix).
                  name: 'Collected',
                  value: finance.feesPaid,
                  color: 'oklch(0.55 0.14 162)',
                },
                {
                  name: 'Outstanding',
                  value: outstanding,
                  color: 'oklch(0.62 0.2 25)',
                },
              ]}
              centerValue={`${collectionRate}%`}
              centerLabel="Collected"
              centerSub={
                finance.overdue > 0 ? `${finance.overdue} overdue` : 'all current'
              }
              formatValue={formatINRCr}
              size={160}
              thickness={18}
            />
          ) : (
            <ChartEmptyState
              message="No fee structures billed yet"
              hint="The donut reflects real totals once fee structures are configured and billed."
            />
          )}
        </div>
        {/* Honest semantics footnote — the donut's two systems labelled
            exactly (payments ledger vs billed−collected subtraction). */}
        {hasFees && finance.status !== 'loading' && finance.status !== 'error' && (
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground border-t border-border/60 pt-2">
            Collected = recorded payments · Outstanding = billed − collected
          </p>
        )}
      </Panel>
    </div>
  )
}
