'use client'

/**
 * FeesOverviewSection — the Fee Management landing view: a FINANCIAL
 * COMMAND CENTRE. The Principal grasps the school's position in seconds:
 *
 *   1. Four KPI cards (Total Expected · Collected · Outstanding ·
 *      Students With Dues) — clickable, wired to Outreach/Accounts/Transactions.
 *   2. LEFT COLUMN (2/3): Collection Trend (OPEN chart — sits directly on
 *      the page surface, same pattern as Analytics/Dashboard/Finance) with
 *      Class-wise Collection DIRECTLY UNDERNEATH — the class rows occupy
 *      exactly the vertical space the oversized chart container used to
 *      waste. RIGHT COLUMN (1/3): Breakdown (expected obligation by fee
 *      head, thin CSS bars). One intelligently composed dashboard row —
 *      no full-width stacking, no wasted space, no extra page height.
 *   3. Outstanding Dues + Needs Attention — one two-column grid of
 *      ACTIONABLE panels.
 *   4. Recent Payments (summary only) + Payment Modes mix.
 *
 * All numbers derive from useFeeData() — the same single calculation path
 * the Payments page, Transactions ledger, and Student Accounts consume.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Wallet, CheckCircle2, AlertCircle, Users, ArrowRight, CheckCheck, Banknote, Send,
  PieChart, TrendingUp, AlertTriangle, IndianRupee,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFeeData, CURRENT_ACADEMIC_YEAR } from '@/lib/store/fee-store'
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
import type { FeeTab } from './fees-shared'

interface Props {
  data: ReturnType<typeof useFeeData>
  onNavigate: (tab: FeeTab) => void
}

/** Stream-aware display: classWise rows key by classId (C14-PCM…) while
 *  className collapses streams — re-attach so 11 PCM ≠ 11 PCB rows. */
function classDisplayName(className: string, classId: string): string {
  const m = /^(C1[45])-(PCM|PCB|PCMB)$/.exec(classId || '')
  if (m) {
    const base = className.replace(/\s*—\s*Science.*$/, '')
    return `${base} (${m[2]})`
  }
  return className
}

/** Avatar initials for student rows ("Aarav Sharma" → "AS"). */
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => (p[0] ?? '').toUpperCase()).join('')
}

/** Minimal days-overdue chip (spec chip recipe: emerald/amber/rose/slate tints).
 *  Escalation: Due soon → slate · ≤30d → amber · >30d → rose. */
function OverdueChip({ days }: { days: number }) {
  const tone =
    days <= 0 ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
      : days <= 30 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', tone)}>
      {days <= 0 ? 'Due soon' : `${days}d overdue`}
    </span>
  )
}

export function FeesOverviewSection({ data, onNavigate }: Props) {
  const { analytics, accounts, transactions } = data

  // Round-7 — the Outreach-facing KPI reads the LIVE server aggregation
  // (same numbers the Outreach tab shows); the ledger analytics remain the
  // story for the cards that navigate into the ledger views (accounts /
  // transactions). Sync is idempotent — this module and the dashboard KPI
  // share one fetch.
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  // Session label read from the ledger itself (honest — never hardcoded).
  const yearLabel = useMemo(() => {
    const years = new Set(transactions.map((t) => t.academicYear).filter(Boolean))
    return Array.from(years)[0] ?? CURRENT_ACADEMIC_YEAR
  }, [transactions])

  // Largest outstanding balances — the collection worklist (max 25 kept,
  // scroll cap shows ~5 at a time).
  const topDues = useMemo(
    () => [...accounts].filter((a) => a.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 25),
    [accounts],
  )

  // Classes with students carrying dues (KPI sub-line).
  const classesWithDues = useMemo(
    () => new Set(accounts.filter((a) => a.outstanding > 0).map((a) => a.classId)).size,
    [accounts],
  )

  // Recent successful payments — a concise activity SUMMARY (the complete
  // authoritative history lives in the Transactions section).
  const recentPayments = useMemo(
    () =>
      [...transactions]
        .filter((t) => t.status === 'Success')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 6),
    [transactions],
  )

  // Payment mode mix — share of successfully collected amount.
  const modeMix = useMemo(() => {
    const totals = new Map<string, number>()
    let sum = 0
    for (const t of transactions) {
      if (t.status !== 'Success') continue
      totals.set(t.mode, (totals.get(t.mode) ?? 0) + t.amount)
      sum += t.amount
    }
    return Array.from(totals.entries())
      .map(([mode, value]) => ({ mode, value, pct: sum > 0 ? Math.round((value / sum) * 100) : 0 }))
      .sort((a, b) => b.value - a.value)
  }, [transactions])

  // Breakdown — expected obligation per fee head (store pre-sorts desc).
  const categories = analytics.byCategory
  const catTotal = useMemo(() => categories.reduce((sum, c) => sum + c.value, 0), [categories])
  const catMax = categories[0]?.value ?? 0
  const visibleCategories = categories.slice(0, 6)
  const hiddenCategories = Math.max(0, categories.length - visibleCategories.length)

  const trendHasData = analytics.monthly.some((m) => m.collected > 0 || m.pending > 0)

  // Class-wise collection progress — REAL per-class figures aggregated from
  // the live student fee accounts (analytics.classWise groups by classId over
  // netPayable/paid/outstanding). Most-relevant first: largest outstanding
  // balance at top (the store's order). Initially the top 8 rows keep the
  // section compact; "View all" expands every class with a scroll cap.
  const [allClasses, setAllClasses] = useState(false)
  // Compact subset that fits the LEFT column beneath the trend chart —
  // the section borrows the previously-wasted vertical space instead of
  // lengthening the page. Expanded view scrolls inside a capped column.
  const CLASSWISE_PREVIEW = 5
  const classRows = analytics.classWise
  const visibleClassRows = allClasses ? classRows : classRows.slice(0, CLASSWISE_PREVIEW)
  const hiddenClassCount = Math.max(0, classRows.length - visibleClassRows.length)

  /* Shared row anatomy — avatar + identity + right-aligned amount/chip. */
  const listPanelBtnClass =
    'w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left focus:outline-none focus-visible:bg-muted/40'

  return (
    <div className="space-y-4">
      {/* 1 — KPI cards: the Principal's four questions */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Expected"
          value={formatINR(analytics.totalExpected, true)}
          sub={`${accounts.length} students`}
          tone="slate"
          delay={0}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Collected"
          value={formatINR(analytics.totalCollected, true)}
          sub={`${analytics.collectionRate}% collected`}
          tone="emerald"
          delay={0.05}
          onClick={() => onNavigate('transactions')}
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Outstanding"
          value={formatINR(analytics.totalOutstanding, true)}
          sub={
            analytics.totalLateFee > 0
              ? `incl. ${formatINR(analytics.totalLateFee, true)} late fee`
              : `${analytics.overdueCount} overdue`
          }
          tone="rose"
          delay={0.1}
          onClick={() => onNavigate('accounts')}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="Students With Dues"
          value={dues ? dues.defaulterCount : analytics.pendingCount}
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
          (open chart, trimmed height) + Class-wise Collection packed
          DIRECTLY underneath — the class rows use the vertical space the
          chart used to waste. RIGHT (1/3): Breakdown panel. items-start
          keeps each column at its natural height; the row never grows
          taller than its content demands. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* LEFT column — trend + class-wise, stacked with no dead space */}
        <div className="lg:col-span-2 min-w-0 space-y-4">
          <OpenChartSection
            title="Collection Trend"
            subtitle={`${yearLabel} · collected vs pending`}
            className="min-w-0"
            action={
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: FEES_CHART_PALETTE.collected }} /> Collected
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: FEES_CHART_PALETTE.pending }} /> Pending
                </span>
              </div>
            }
          >
            {trendHasData ? (
              <MiniAreaChart data={analytics.monthly} height={150} format={(n) => formatINR(n, true)} showArea />
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
              space under the chart. Same visual philosophy as Payment
              Modes: compact Panel, horizontal bars, no giant cards. Bars
              are relative to each class's own expected amount (collected /
              expected share), amounts come from the live fee accounts. */}
          <Panel
            title="Class-wise Collection"
            subtitle={`${yearLabel} · ${classRows.length} classes · collected vs expected`}
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
            {visibleClassRows.length > 0 ? (
              <div className={cn('divide-y divide-border py-1', allClasses && 'max-h-[280px] overflow-y-auto custom-scrollbar')}>
                {visibleClassRows.map((c, i) => (
                  <motion.div
                    key={c.classId}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.25) }}
                    className="px-4 py-2 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Class identity */}
                      <div className="min-w-0 w-[150px] shrink-0">
                        <p className="text-xs font-semibold truncate">{classDisplayName(c.className, c.classId)}</p>
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
                      {/* Amounts + rate — right-aligned mono rhythm like Payment Modes */}
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
                title="No classes yet"
                description="Enrol students and assign fee structures to see class-wise collections."
              />
            )}
          </Panel>
        </div>

        {/* Expected obligation per fee head — honest policy view (bars are
            relative to the largest head, share % is of total expected). */}
        <Panel title="Breakdown" subtitle={`${yearLabel} · expected by fee head`} className="h-full" bodyClassName="p-0">
          {visibleCategories.length > 0 ? (
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
          subtitle={
            dues
              ? `${topDues.length} ledger accounts · every account with a balance, largest first`
              : `${topDues.length} student${topDues.length === 1 ? '' : 's'} · every account with a balance, largest first`
          }
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
          {topDues.length > 0 ? (
            <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
              {topDues.map((a, i) => (
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
                      {classDisplayName(a.className, a.classId)} · {a.section} · {a.admissionNo}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className="text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatINR(a.outstanding, true)}</span>
                    <OverdueChip days={a.daysOverdue} />
                  </div>
                </motion.button>
              ))}
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
          subtitle={`${analytics.urgentActions.length} urgent · aging worklist, most overdue first`}
          className="h-full"
          action={
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={() => onNavigate('accounts')}>
              Follow up <ArrowRight className="h-3 w-3" />
            </Button>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
            {analytics.urgentActions.map((a, i) => (
              <motion.button
                key={a.studentId}
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => onNavigate('accounts')}
                aria-label={`Follow up on ${a.studentName}, ${a.daysOverdue > 0 ? `${a.daysOverdue} days overdue` : 'due soon'}, total due ${formatINR(a.totalDue, true)}`}
                className={listPanelBtnClass}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/10 ring-1 ring-rose-500/20 text-[9px] font-semibold text-rose-600 dark:text-rose-300 tabular-nums">
                  {initialsOf(a.studentName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{a.studentName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {classDisplayName(a.className, a.classId)} · {a.section} · {a.admissionNo}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatINR(a.totalDue, true)}</span>
                  <OverdueChip days={a.daysOverdue} />
                </div>
              </motion.button>
            ))}
            {analytics.urgentActions.length === 0 && (
              <ModuleEmptyState
                icon={<CheckCircle2 className="h-5 w-5" />}
                title="All fees are paid"
                description="No dues to follow up on."
              />
            )}
          </div>
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
            {recentPayments.length > 0 ? (
              <div className="divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar py-1">
                {recentPayments.map((t, i) => (
                  <motion.button
                    key={t.id}
                    type="button"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => onNavigate('transactions')}
                    aria-label={`View transaction for ${t.studentName}, ${formatINR(t.amount, true)} via ${t.mode}`}
                    className={listPanelBtnClass}
                  >
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1', modeAccent(t.mode))}>
                      <ModeIcon mode={t.mode} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{t.studentName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.className} · {formatDate(t.date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(t.amount, true)}</p>
                      <p className="text-[9px] text-muted-foreground font-mono">{t.receiptNo}</p>
                    </div>
                  </motion.button>
                ))}
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

        <Panel title="Payment Modes" subtitle="share of collected" className="h-full" bodyClassName="pt-1">
          {modeMix.length > 0 ? (
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
                      <ModeIcon mode={m.mode as never} className="h-3 w-3 text-muted-foreground" />
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
