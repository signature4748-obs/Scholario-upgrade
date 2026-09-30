'use client'

/**
 * ChartsRow1 — the dashboard's primary finance visualization row.
 * FINAL PRODUCT EXCELLENCE GATE redesign.
 *
 * Two surfaces, one coherent story (all figures school-scoped from
 * `GET /api/dashboard` + the dues summary the KPI row already loads):
 *
 *  1. "Fee Collections" (2/3 width, open line chart) — the real monthly
 *     series of SUCCESSFUL payments (the FINAL-GATE API fix dropped
 *     FAILED/PENDING gateway rows that used to inflate this chart).
 *     The display series is continuous: months without payments render
 *     as honest ₹0 points instead of being silently skipped, the Y axis
 *     is anchored to a ₹0 baseline (never a padded "−₹56K" tick that
 *     implied negative collections) and every point carries a human
 *     label ("Apr 26", not a raw "2026-04").
 *
 *  2. "Fee Collection" (1/3 width) — the billed-vs-collected composition.
 *     The retired 160px donut crammed three competing messages into a
 *     hole ("67%", "COLLECTED", "24 overdue" overlapping) while the
 *     amounts it explained were demoted to legend rows. It is replaced
 *     by an analytical stat panel with ONE clear relationship:
 *
 *        Total billed (hero)      Collection rate (secondary stat)
 *        [█ collected ▓ outstanding]  ← a single proportion bar
 *        Collected      ₹20.14L       ← value rows with real hierarchy
 *        Outstanding    ₹9.86L
 *        3 students past due → Outreach   ← actionable, never crammed
 *
 *     billed = collected + outstanding now holds by construction
 *     (`feesPaid` sums Fee.paid across ALL rows — FINAL-GATE API fix —
 *     so the subtraction matches the defaulters API's Σ(amount − paid)
 *     the Pending Fees KPI and the Outreach tab show).
 *
 * Honest states preserved from Phase 7/7.5: skeleton while loading,
 * explicit retry on failure (never an empty state masquerading as "no
 * data"), and true empty states for schools with no billing history.
 */

import { useEffect } from 'react'
import { ArrowRight, AlertTriangle, IndianRupee, RotateCw } from 'lucide-react'
import { motion } from 'framer-motion'
import { AreaTrendChart } from '@/components/shared/premium-charts'
import { Panel } from '../shared/panel'
import { OpenChartSection } from '../shared/open-chart-section'
import { useDashboardFinance } from './use-dashboard-finance'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { useFocusStore } from '@/lib/store/focus-store'
import { Skeleton } from '@/components/ui/skeleton'

export interface ChartsRowProps {
  onNavigate?: (module: string) => void
}

/* Fee chart semantic palette — same colors as FEES_CHART_PALETTE /
   CHART_PALETTE (emerald = collected, rose = outstanding). */
const COLLECTED_COLOR = 'oklch(0.55 0.14 162)'
const OUTSTANDING_COLOR = 'oklch(0.62 0.2 25)'

const formatINRCr = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  return `₹${n.toLocaleString('en-IN')}`
}

/**
 * Collection rate clamped to 0..100 — the numerator (Σ Fee.paid) and the
 * denominator (Σ Fee.amount) can drift on inconsistent rows, so a drift
 * can push the raw ratio above 100 or below 0. Display the clamped value;
 * never render an impossible percentage.
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

/** Small "View Fees →" action shared by both chart headers. */
function ViewFeesAction({ onNavigate }: ChartsRowProps) {
  return (
    <button
      onClick={() => onNavigate?.('fees')}
      className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
      title="Open Fee Management"
    >
      View Fees
      <ArrowRight className="h-3 w-3" />
    </button>
  )
}

/** Skeleton mirroring the Fee Collection card's layout. */
function FeeCardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading fee collection data">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-7 w-24" />
        </div>
        <div className="space-y-1.5 text-right">
          <Skeleton className="h-2.5 w-16 ml-auto" />
          <Skeleton className="h-6 w-12 ml-auto" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  )
}

/* ── Fee Collection stat panel (replaces the retired donut card) ── */

function FeeCollectionCard({ onNavigate }: ChartsRowProps) {
  const { refresh, ...finance } = useDashboardFinance()
  // Dues summary — the SAME server aggregation the Pending Fees KPI and
  // the Outreach tab read (the KPI row's ensure() warms the store; the
  // extra ensure() here coalesces into it — zero duplicate requests).
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  const billed = finance.feesTotal
  // Displayed collected is clamped to billed so the parts always sum to
  // the whole (raw Σ paid can exceed billed only on drifted rows — the
  // rate is clamped the same way; see safePercent).
  const collected = Math.min(finance.feesPaid, billed)
  const outstanding = Math.max(0, billed - finance.feesPaid)
  const rate = safePercent(finance.feesPaid, billed)

  const hasFees = billed > 0
  const ready = finance.status === 'ready'

  const openOutreach = () => {
    if (!onNavigate) return
    useFocusStore.getState().setFocus({
      type: 'fee-outreach',
      id: 'fee-outreach',
      title: 'Fee defaulter outreach',
      moduleKey: 'fees',
    })
    onNavigate('fees')
  }

  const overdueActive = (dues?.overdueCount ?? 0) > 0

  return (
    <Panel
      title="Fee Collection"
      subtitle="Billed vs collected · all-time"
      action={<ViewFeesAction onNavigate={onNavigate} />}
      bodyClassName={ready && hasFees ? 'p-4 pt-2' : undefined}
    >
      {finance.status === 'loading' ? (
        <FeeCardSkeleton />
      ) : finance.status === 'error' ? (
        <ChartErrorState onRetry={refresh} />
      ) : hasFees ? (
        <div className="flex flex-col gap-4">
          {/* Hero pair — the base amount and the health ratio */}
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total billed
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight leading-tight text-foreground">
                {formatINRCr(billed)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Collection rate
              </p>
              <p
                className="mt-0.5 text-xl font-bold tabular-nums leading-tight"
                style={{ color: rate >= 50 ? COLLECTED_COLOR : OUTSTANDING_COLOR }}
              >
                {rate}%
              </p>
            </div>
          </div>

          {/* One proportion: collected share of billed */}
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Collected ${formatINRCr(collected)} of ${formatINRCr(billed)} billed (${rate}%); outstanding ${formatINRCr(outstanding)}`}
          >
            <motion.div
              className="h-full"
              style={{ background: COLLECTED_COLOR }}
              initial={{ width: 0 }}
              animate={{ width: `${rate}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="h-full"
              style={{ background: OUTSTANDING_COLOR }}
              initial={{ width: 0 }}
              animate={{ width: `${100 - rate}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
            />
          </div>

          {/* Composition rows — the amounts with real hierarchy */}
          <div className="grid grid-cols-1 gap-1.5">
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLLECTED_COLOR }} aria-hidden="true" />
                Collected
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {formatINRCr(collected)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-2">
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OUTSTANDING_COLOR }} aria-hidden="true" />
                Outstanding
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {formatINRCr(outstanding)}
              </span>
            </div>
          </div>

          {/* Overdue — an actionable line, never crammed into a chart */}
          {dues && (dues.defaulterCount > 0 || dues.overdueCount > 0) && (
            <button
              onClick={openOutreach}
              className={[
                'group -mx-1 flex w-[calc(100%+8px)] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                overdueActive
                  ? 'border-amber-500/25 bg-amber-500/[0.07] hover:bg-amber-500/[0.12]'
                  : 'border-border bg-muted/30 hover:bg-muted/50',
                'focus-ring',
              ].join(' ')}
            >
              <AlertTriangle
                className={`h-3.5 w-3.5 shrink-0 ${overdueActive ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-xs text-foreground">
                {overdueActive ? (
                  <>
                    <b className="tabular-nums">{dues.overdueCount}</b>
                    {` student${dues.overdueCount === 1 ? '' : 's'} past due`}
                    {dues.defaulterCount > dues.overdueCount && (
                      <>
                        {' · '}
                        <b className="tabular-nums">{dues.defaulterCount}</b>
                        {` with dues`}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <b className="tabular-nums">{dues.defaulterCount}</b>
                    {` student${dues.defaulterCount === 1 ? '' : 's'} with dues · none past due`}
                  </>
                )}
              </span>
              <ArrowRight
                className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          )}

          {/* Honest semantics footnote */}
          <p className="text-[10px] leading-relaxed text-muted-foreground border-t border-border/60 pt-2">
            Collected = payments recorded · Outstanding = billed − collected
          </p>
        </div>
      ) : (
        <ChartEmptyState
          message="No fee structures billed yet"
          hint="The composition appears here once fee structures are configured and billed."
        />
      )}
    </Panel>
  )
}

/* ── Row composition ── */

export function ChartsRow1({ onNavigate }: ChartsRowProps) {
  const { refresh, ...finance } = useDashboardFinance()

  const hasTrend = finance.trend.some((d) => d.amount > 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Fee Collections — 2/3 width, OPEN smooth line chart (no card border) */}
      <OpenChartSection
        className="lg:col-span-2"
        title="Fee Collections"
        subtitle="Monthly · successful payments"
        action={<ViewFeesAction onNavigate={onNavigate} />}
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
            data={finance.trendDisplay}
            height={200}
            formatValue={formatINRCr}
            labelKey="label"
            primaryKey="amount"
            primaryLabel="Collected"
            primaryColor={COLLECTED_COLOR}
            showArea={false}
          />
        ) : (
          <ChartEmptyState
            message="No fee collections recorded yet"
            hint="Collections appear here as payments are recorded in Fee Management."
          />
        )}
      </OpenChartSection>

      {/* Fee Collection — 1/3 width, composition stat panel (was the donut) */}
      <FeeCollectionCard onNavigate={onNavigate} />
    </div>
  )
}
