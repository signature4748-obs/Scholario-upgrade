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
 */

import { ArrowRight } from 'lucide-react'
import {
  AreaTrendChart,
  DonutChart,
} from '@/components/shared/premium-charts'
import { Panel } from '../shared/panel'
import { OpenChartSection } from '../shared/open-chart-section'
import { useDashboardFinance } from './use-dashboard-finance'
import { Skeleton } from '@/components/ui/skeleton'
import { IndianRupee } from 'lucide-react'

export interface ChartsRowProps {
  onNavigate?: (module: string) => void
}

const formatINRCr = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  return `₹${n.toLocaleString('en-IN')}`
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

export function ChartsRow1({ onNavigate }: ChartsRowProps) {
  const finance = useDashboardFinance()

  const outstanding = Math.max(0, finance.feesTotal - finance.feesPaid)
  const collectionRate =
    finance.feesTotal > 0 ? Math.round((finance.feesPaid / finance.feesTotal) * 100) : 0

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
          ) : hasFees ? (
            <DonutChart
              data={[
                { name: 'Collected', value: finance.feesPaid, color: 'oklch(0.55 0.14 162)' },
                { name: 'Outstanding', value: outstanding, color: 'oklch(0.62 0.2 25)' },
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
      </Panel>
    </div>
  )
}
