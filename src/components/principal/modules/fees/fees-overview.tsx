'use client'

/**
 * FeesOverviewSection — the Fee Management landing view: a FINANCIAL
 * COMMAND CENTRE. The Principal grasps the school's position in seconds:
 *
 *   1. Four KPI cards (Total Expected · Collected · Outstanding ·
 *      Students With Dues) — clickable, wired to Outreach/Accounts/Transactions.
 *   2. LEFT COLUMN (2/3): Collection Trend (OPEN chart — sits directly on
 *      the page surface) with Class-wise Collection DIRECTLY UNDERNEATH.
 *      RIGHT COLUMN (1/3): Breakdown (expected obligation by fee head,
 *      thin CSS bars).
 *   3. Outstanding Dues + Needs Attention — one two-column grid of
 *      ACTIONABLE panels.
 *   4. Recent Payments (summary only) + Payment Modes mix.
 *
 * BATCH2-B5 — SERVER TRUTH: every figure derives from the canonical API
 * routes, never the client fee-store:
 *   · KPI totals / trend → GET /api/dashboard (Σ Fee.amount, Σ Fee.paid,
 *     monthly SUCCESS Payment sums — the same aggregates the principal
 *     dashboard renders);
 *   · per-student / per-class / per-fee-head breakdowns → GET /api/fees
 *     (fee rows with amount/paid as numbers, grouped client-side);
 *   · Students With Dues → the live dues-summary store (GET
 *     /api/fees/defaulters?summary=1 — server aggregation);
 *   · recent payments + mode mix → GET /api/fees/transactions (SUCCESS
 *     window, honestly labelled);
 *   · class labels → GET /api/fees/verification roster.
 * Loading / error-with-retry / empty / success states for every surface —
 * no fabricated numbers anywhere.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Wallet, CheckCircle2, AlertCircle, Users, ArrowRight, CheckCheck, Banknote, Send,
  PieChart, TrendingUp, AlertTriangle, IndianRupee, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { LiveChip } from '../shared/live-chip'
import { Panel } from '../shared/panel'
import { OpenChartSection } from '../shared/open-chart-section'
import { ModuleEmptyState } from '../shared/empty-state'
import { ModeIcon, modeAccent } from './fees-shared'
import { MiniAreaChart, FEES_CHART_PALETTE } from './fees-charts'
import {
  useServerResource, deriveAccounts, deriveClassWise, classLabelMapOf,
  serverMethodToMode, monthKeyToLabel,
  type ServerFeeRow, type SchoolDashboardPayload, type VerificationPayload,
  type ServerFeeTxn, type DerivedFeeAccount,
} from './use-fee-server-data'
import type { FeeTab } from './fees-shared'

interface Props {
  onNavigate: (tab: FeeTab) => void
  /** Session label (the identity cascade's academic year) — display only. */
  academicYear: string
}

/** Fee-head breakdown dot colours (semantic hues, no blues/indigos). */
const HEAD_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#64748b']

/** Avatar initials for student rows ("Aarav Sharma" → "AS"). */
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => (p[0] ?? '').toUpperCase()).join('')
}

/** Minimal days-overdue chip (spec chip recipe: emerald/amber/rose/slate tints).
 *  Escalation: Due soon → slate · ≤30d → amber · >30d → rose. */
function OverdueChip({ days }: { days: number | null }) {
  const d = days ?? 0
  const tone =
    d <= 0 ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
      : d <= 30 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', tone)}>
      {d <= 0 ? 'Due soon' : `${d}d overdue`}
    </span>
  )
}

/** Row skeleton shared by the list panels while the server responds. */
function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-3" aria-busy="true" aria-label="Loading fee data">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted/70" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted/50" />
          <div className="h-3 w-14 animate-pulse rounded bg-muted/50" />
        </div>
      ))}
    </div>
  )
}

export function FeesOverviewSection({ onNavigate, academicYear }: Props) {
  // ── server data (B5) ───────────────────────────────────────────────
  const dashboard = useServerResource<SchoolDashboardPayload>('/api/dashboard')
  const feeRows = useServerResource<ServerFeeRow[]>('/api/fees')
  const verification = useServerResource<VerificationPayload>('/api/fees/verification')
  const recentTxns = useServerResource<ServerFeeTxn[]>('/api/fees/transactions?status=SUCCESS&limit=100')

  // The Outreach-facing KPI reads the LIVE server aggregation (same numbers
  // the Outreach tab shows) — the dues-summary store wraps
  // GET /api/fees/defaulters?summary=1 and shares one fetch with the
  // principal dashboard KPI.
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  const stats = dashboard.data?.stats
  const rows = useMemo(() => feeRows.data ?? [], [feeRows.data])
  const accounts = useMemo(
    () => deriveAccounts(rows, classLabelMapOf(verification.data?.students ?? [])),
    [rows, verification.data],
  )
  const classRows = useMemo(() => deriveClassWise(accounts), [accounts])

  // KPI totals — Σ Fee.amount / Σ Fee.paid straight from the server's
  // school aggregates (algebra agrees with the defaulters API: billed =
  // collected + outstanding).
  const totalExpected = stats?.feesTotal
  const totalCollected = stats?.feesPaid
  const collectionRate = totalExpected && totalExpected > 0 && totalCollected !== undefined
    ? Math.round((totalCollected / totalExpected) * 1000) / 10
    : 0
  const totalOutstanding =
    dues?.totalOutstanding ??
    (totalExpected !== undefined && totalCollected !== undefined ? Math.max(0, totalExpected - totalCollected) : undefined)
  const overdueCount = stats?.overdue ?? dues?.overdueCount
  const studentsWithDues = dues?.defaulterCount

  // Largest outstanding balances — the collection worklist (max 25 kept,
  // scroll cap shows ~5 at a time). deriveAccounts pre-sorts desc.
  const topDues = useMemo(
    () => accounts.filter((a) => a.outstanding > 0).slice(0, 25),
    [accounts],
  )

  // Classes with students carrying dues (KPI sub-line).
  const classesWithDues = useMemo(
    () => new Set(accounts.filter((a) => a.outstanding > 0).map((a) => a.className)).size,
    [accounts],
  )

  // Aging worklist — most overdue first (Needs Attention panel).
  const urgentActions = useMemo(
    () =>
      [...accounts]
        .filter((a) => a.outstanding > 0)
        .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1))
        .slice(0, 25),
    [accounts],
  )

  // Recent successful payments — a concise activity SUMMARY (the complete
  // authoritative history lives in the Transactions section).
  const recentPayments = useMemo(
    () => (recentTxns.data ?? []).slice(0, 6),
    [recentTxns.data],
  )

  // Payment mode mix — share of successfully collected amount across the
  // fetched SUCCESS window (honestly labelled below).
  const modeMix = useMemo(() => {
    const totals = new Map<string, number>()
    let sum = 0
    for (const t of recentTxns.data ?? []) {
      totals.set(t.method, (totals.get(t.method) ?? 0) + t.amount)
      sum += t.amount
    }
    return Array.from(totals.entries())
      .map(([method, value]) => ({ mode: serverMethodToMode(method), value, pct: sum > 0 ? Math.round((value / sum) * 100) : 0 }))
      .sort((a, b) => b.value - a.value)
  }, [recentTxns.data])

  // Breakdown — expected obligation per fee head (server fee rows).
  const categories = useMemo(() => {
    const byHead = new Map<string, number>()
    for (const f of rows) byHead.set(f.title, (byHead.get(f.title) ?? 0) + f.amount)
    return Array.from(byHead.entries())
      .map(([name, value], i) => ({ name, value, color: HEAD_COLORS[i % HEAD_COLORS.length] }))
      .sort((a, b) => b.value - a.value)
  }, [rows])
  const catTotal = useMemo(() => categories.reduce((sum, c) => sum + c.value, 0), [categories])
  const catMax = categories[0]?.value ?? 0
  const visibleCategories = categories.slice(0, 6)
  const hiddenCategories = Math.max(0, categories.length - visibleCategories.length)

  // Collection trend — the dashboard's monthly SUCCESS-payment sums
  // (server Payment rows), mapped onto the chart's month labels.
  const trend = useMemo(
    () => (dashboard.data?.trend ?? []).map((m) => ({ month: monthKeyToLabel(m.month), collected: m.amount })),
    [dashboard.data],
  )
  const trendHasData = trend.some((m) => m.collected > 0)

  // Class-wise — compact subset that fits the LEFT column beneath the
  // trend chart; "View all" expands every class with a scroll cap.
  const [allClasses, setAllClasses] = useState(false)
  const CLASSWISE_PREVIEW = 5
  const visibleClassRows = allClasses ? classRows : classRows.slice(0, CLASSWISE_PREVIEW)
  const hiddenClassCount = Math.max(0, classRows.length - visibleClassRows.length)

  // Shared error surface — any hard-failed fetch with nothing to show.
  const failedSources = [
    { label: 'school aggregates', res: dashboard },
    { label: 'fee ledger', res: feeRows },
    { label: 'verification roster', res: verification },
    { label: 'recent transactions', res: recentTxns },
  ]
  const hardError = failedSources.find((s) => s.res.error && s.res.data === null)
  const reloadAll = () => { dashboard.reload(); feeRows.reload(); verification.reload(); recentTxns.reload() }
  const loading = dashboard.loading || feeRows.loading

  /* Shared row anatomy — avatar + identity + right-aligned amount/chip. */
  const listPanelBtnClass =
    'w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left focus:outline-none focus-visible:bg-muted/40'

  /** One dues list row (Outstanding Dues + Needs Attention share it). */
  const duesRow = (a: DerivedFeeAccount, i: number, amount: number) => (
    <motion.button
      key={a.studentId}
      type="button"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.04 }}
      onClick={() => onNavigate('accounts')}
      aria-label={`Open fee account for ${a.studentName}, outstanding ${formatINR(a.outstanding, true)}`}
      className={listPanelBtnClass}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500/10 ring-1 ring-slate-500/20 text-[9px] font-semibold text-slate-600 dark:text-slate-300">
        {initialsOf(a.studentName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{a.studentName}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {a.className}{a.rollNo ? ` · Roll ${a.rollNo}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatINR(amount, true)}</span>
        <OverdueChip days={a.daysOverdue} />
      </div>
    </motion.button>
  )

  return (
    <div className="space-y-4">
      {/* 0 — hard error surface: a source failed with nothing to render. */}
      {hardError && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Fee overview unavailable.</span>{' '}
            Could not load the {hardError.label} — {hardError.res.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={reloadAll}
          >
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {/* 1 — KPI cards: the Principal's four questions (server truth) */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Expected"
          value={totalExpected !== undefined ? formatINR(totalExpected, true) : '—'}
          sub={stats ? `${stats.students} students · server ledger` : 'loading…'}
          tone="slate"
          delay={0}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Collected"
          value={totalCollected !== undefined ? formatINR(totalCollected, true) : '—'}
          sub={stats ? `${collectionRate}% collected` : 'loading…'}
          tone="emerald"
          delay={0.05}
          onClick={() => onNavigate('transactions')}
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Outstanding"
          value={totalOutstanding !== undefined ? formatINR(totalOutstanding, true) : '—'}
          sub={overdueCount !== undefined ? `${overdueCount} overdue fee lines` : 'loading…'}
          tone="rose"
          delay={0.1}
          onClick={() => onNavigate('accounts')}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="Students With Dues"
          value={studentsWithDues ?? '—'}
          sub={
            dues
              ? `across ${dues.classesWithDues} classes · ${formatINR(dues.totalOutstanding, true)} outstanding`
              : `across ${classesWithDues} classes · reminders ready`
          }
          chip={dues ? <LiveChip /> : undefined}
          tone="amber"
          delay={0.15}
          onClick={() => onNavigate('outreach')}
        />
      </SummaryCardGrid>

      {/* 2 — ONE composed dashboard row. LEFT (2/3): Collection Trend
          (server SUCCESS-payment sums) + Class-wise Collection packed
          DIRECTLY underneath. RIGHT (1/3): Breakdown panel. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT column — trend + class-wise, stacked with no dead space */}
        <div className="lg:col-span-2 min-w-0 space-y-4">
          <OpenChartSection
            title="Collection Trend"
            subtitle={`${academicYear} · collected (server payment ledger)`}
            className="min-w-0"
            action={
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: FEES_CHART_PALETTE.collected }} /> Collected
                </span>
              </div>
            }
          >
            {dashboard.loading ? (
              <div className="h-[150px] w-full animate-pulse rounded-lg bg-muted/40" aria-busy="true" aria-label="Loading collection trend" />
            ) : trendHasData ? (
              <MiniAreaChart data={trend} height={150} format={(n) => formatINR(n, true)} showArea />
            ) : (
              <ModuleEmptyState
                className="my-2"
                icon={<TrendingUp className="h-5 w-5" />}
                title="No collections yet"
                description="Collections will appear here as payments are recorded."
              />
            )}
          </OpenChartSection>

          {/* Class-wise Collection — fills the previously wasted vertical
              space under the chart. Bars are relative to each class's own
              expected amount; amounts come from the server fee rows. */}
          <Panel
            title="Class-wise Collection"
            subtitle={`${academicYear} · ${classRows.length} classes · collected vs expected`}
            action={
              classRows.length > CLASSWISE_PREVIEW ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={() => setAllClasses((v) => !v)}
                  aria-expanded={allClasses}
                >
                  {allClasses ? 'Show less' : `View all ${classRows.length} classes`} <ArrowRight className="h-3 w-3" />
                </Button>
              ) : undefined
            }
            bodyClassName="p-0"
          >
            {loading ? (
              <ListSkeleton rows={4} />
            ) : visibleClassRows.length > 0 ? (
              <div className={cn('divide-y divide-border py-1', allClasses && 'max-h-[280px] overflow-y-auto custom-scrollbar')}>
                {visibleClassRows.map((c, i) => (
                  <motion.div
                    key={c.classLabel}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.25) }}
                    className="px-4 py-2 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Class identity */}
                      <div className="min-w-0 w-[150px] shrink-0">
                        <p className="text-xs font-semibold truncate">{c.classLabel}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">{c.students} student{c.students === 1 ? '' : 's'}</p>
                      </div>
                      {/* Progress bar — collected share of this class's expectation */}
                      <div className="flex-1 min-w-0 h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(c.collectionRate > 0 ? 2 : 0, Math.min(100, c.collectionRate))}%` }}
                          transition={{ duration: 0.5, delay: Math.min(i * 0.04, 0.3) }}
                          className={cn(
                            'h-full rounded-full',
                            c.collectionRate >= 75 ? 'bg-emerald-500/80'
                              : c.collectionRate >= 40 ? 'bg-amber-500/80'
                                : c.expected === 0 ? 'bg-slate-300/60 dark:bg-slate-600/40'
                                  : 'bg-rose-500/70',
                          )}
                        />
                      </div>
                      {/* Amounts + rate — right-aligned mono rhythm */}
                      <div className="hidden sm:block w-[200px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground truncate">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(c.collected, true)}</span>
                        {' / '}{formatINR(c.expected, true)}
                      </div>
                      <span className="w-[52px] shrink-0 text-right text-xs font-semibold tabular-nums">{Math.round(c.collectionRate)}%</span>
                    </div>
                    {/* Mobile compact second line (amounts hidden above) */}
                    <p className="sm:hidden mt-1 text-[10px] tabular-nums text-muted-foreground">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(c.collected, true)}</span>
                      {' / '}{formatINR(c.expected, true)}{c.outstanding > 0 ? ` · ${formatINR(c.outstanding, true)} due` : ''}
                    </p>
                  </motion.div>
                ))}
                {hiddenClassCount > 0 && !allClasses && (
                  <button
                    type="button"
                    onClick={() => setAllClasses(true)}
                    className="w-full px-4 py-2 text-left text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +{hiddenClassCount} more classes — view all
                  </button>
                )}
              </div>
            ) : (
              <ModuleEmptyState
                icon={<Users className="h-5 w-5" />}
                title="No fee accounts yet"
                description="Enrol students and assign fee structures to see class-wise collections."
              />
            )}
          </Panel>
        </div>

        {/* Expected obligation per fee head — honest policy view (bars are
            relative to the largest head, share % is of total expected). */}
        <Panel title="Breakdown" subtitle={`${academicYear} · expected by fee head`} className="h-full" bodyClassName="p-0">
          {loading ? (
            <ListSkeleton rows={5} />
          ) : visibleCategories.length > 0 ? (
            <div className="divide-y divide-border py-1">
              {visibleCategories.map((c, i) => (
                <motion.div
                  key={c.name}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {catTotal > 0 ? Math.round((c.value / catTotal) * 100) : 0}% of expected
                      </p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums shrink-0">{formatINR(c.value, true)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${catMax > 0 ? Math.max(3, Math.round((c.value / catMax) * 100)) : 0}%` }}
                      transition={{ duration: 0.5, delay: i * 0.06 }}
                      className="h-full rounded-full"
                      style={{ background: c.color }}
                    />
                  </div>
                </motion.div>
              ))}
              {hiddenCategories > 0 && (
                <p className="px-4 py-2 text-[10px] text-muted-foreground">+{hiddenCategories} more heads</p>
              )}
            </div>
          ) : (
            <ModuleEmptyState
              icon={<PieChart className="h-5 w-5" />}
              title="No fee heads configured"
              description="Set up fee structures to see the expected amount broken down by fee head."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => onNavigate('structures')}
                >
                  Configure Fee Structures
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            />
          )}
        </Panel>
      </div>

      {/* 3 — Outstanding Dues + Needs Attention (merged actionable pair).
          Every row navigates to Student Accounts; chips carry the aging
          signal inline so no separate buckets section is needed. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400">
                <IndianRupee className="h-3.5 w-3.5" aria-hidden />
              </span>
              Outstanding Dues
            </span>
          }
          subtitle={`${topDues.length} student${topDues.length === 1 ? '' : 's'} · every account with a balance, largest first`}
          className="h-full"
          action={
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-emerald-500/40 text-[11px] text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                onClick={() => onNavigate('outreach')}
                title="Defaulter outreach — send fee reminders"
              >
                <Send className="h-3 w-3" /> Send reminders
                {dues && (
                  <span className="inline-flex items-center gap-1 text-emerald-600/80 dark:text-emerald-400/80">
                    · {dues.defaulterCount} live
                  </span>
                )}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={() => onNavigate('accounts')}>
                View accounts <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <ListSkeleton rows={5} />
          ) : topDues.length > 0 ? (
            <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
              {topDues.map((a, i) => duesRow(a, i, a.outstanding))}
            </div>
          ) : (
            <ModuleEmptyState
              icon={<CheckCheck className="h-5 w-5" />}
              title="All student accounts are clear"
              description="No outstanding dues to follow up on right now."
            />
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              </span>
              Needs Attention
            </span>
          }
          subtitle={`${urgentActions.length} urgent · aging worklist, most overdue first`}
          className="h-full"
          action={
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={() => onNavigate('accounts')}>
              Follow up <ArrowRight className="h-3 w-3" />
            </Button>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <ListSkeleton rows={5} />
          ) : (
            <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
              {urgentActions.map((a, i) => duesRow(a, i, a.outstanding))}
              {urgentActions.length === 0 && (
                <ModuleEmptyState
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  title="All fees are paid"
                  description="No dues to follow up on."
                />
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* 4 — Recent Payments + Payment Modes (concise activity summary).
          Recent Payments is a SUMMARY only — "All transactions" goes to the
          authoritative ledger. Payment Modes is the analytical mix. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0">
          <Panel
            title="Recent Payments"
            subtitle="latest collections across all counters"
            className="h-full"
            action={
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={() => onNavigate('transactions')}>
                All transactions <ArrowRight className="h-3 w-3" />
              </Button>
            }
            bodyClassName="p-0"
          >
            {recentTxns.loading ? (
              <ListSkeleton rows={4} />
            ) : recentPayments.length > 0 ? (
              <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
                {recentPayments.map((t, i) => {
                  const mode = serverMethodToMode(t.method)
                  return (
                    <motion.button
                      key={t.id}
                      type="button"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => onNavigate('transactions')}
                      aria-label={`View transaction for ${t.studentName}, ${formatINR(t.amount, true)} via ${mode}`}
                      className={listPanelBtnClass}
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1', modeAccent(mode))}>
                        <ModeIcon mode={mode} className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{t.studentName ?? 'Student'}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t.className ?? '—'} · {formatDate(t.collectedAt ?? t.createdAt)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(t.amount, true)}</p>
                        <p className="text-[9px] text-muted-foreground font-mono">{t.receiptNo ?? '—'}</p>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            ) : (
              <ModuleEmptyState
                icon={<Banknote className="h-5 w-5" />}
                title="No payments recorded yet"
                description="Successful payments will appear here as they come in."
              />
            )}
          </Panel>
        </div>

        <Panel title="Payment Modes" subtitle="share of collected · latest 100 payments" className="h-full" bodyClassName="pt-1">
          {recentTxns.loading ? (
            <ListSkeleton rows={4} />
          ) : modeMix.length > 0 ? (
            <div className="space-y-2">
              {modeMix.map((m, i) => (
                <motion.div
                  key={m.mode}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <ModeIcon mode={m.mode} className="h-3 w-3 text-muted-foreground" />
                      {m.mode}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{m.pct}% · {formatINR(m.value, true)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, m.pct)}%` }}
                      transition={{ duration: 0.5, delay: i * 0.06 }}
                      className="h-full rounded-full bg-emerald-500/80"
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <ModuleEmptyState
              framed={false}
              className="py-6"
              icon={<Wallet className="h-5 w-5" />}
              title="No payments yet"
              description="The collected-amount mix by payment mode will appear here."
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
