'use client'

/**
 * FinanceOverviewSection — the Principal's MONEY CONSOLE.
 *
 * Rebuilt around one principle: every headline number must reconcile with
 * the module the Principal actually operates. Fees figures come from the
 * live fee store (Fee Management parity), payroll figures from the live
 * salary store (Salary & Payroll parity), and only the bank/reserve
 * snapshot comes from the books. No CFO ratios, no decorative sparklines,
 * no mock activity rows — those live in Statements / Reports where the
 * management committee and auditors need them.
 *
 * Layout (mirrors the Fee/Salary Overview anatomy):
 *   1. Four KPI cards — the Principal's four money questions:
 *      Fees Collected · Fees Outstanding · Payroll this month · Cash in Bank
 *   2. LEFT (2/3): "Collections vs Payroll" open chart — REAL monthly
 *      money-in (fee collections) vs money-out (confirmed salary) for the
 *      session, trimmed at the current month. RIGHT (1/3): This Month —
 *      in / out / net + session collection progress + reserve line.
 *   3. Needs Attention (2/3, unified live feed from both stores, every
 *      row actionable) + Coming Up (1/3, scheduled obligations).
 *   4. Where Money Goes (1/3, annual expense bars) + Recent Money
 *      Movement (2/3, REAL fee collections + confirmed salary payments
 *      merged, newest first).
 *   5. Deep links into Fee Management and Salary & Payroll.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Wallet, CheckCircle2, AlertCircle, Landmark, Users, ArrowRight,
  ArrowUpRight, ArrowDownRight, ShieldCheck, CalendarClock, Receipt,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useFinanceData, useFinanceAttention,
  type FinanceAttentionItem, formatINRCompact,
} from '@/lib/store/finance-store'
import { useFeeData, CURRENT_ACADEMIC_YEAR } from '@/lib/store/fee-store'
import { useSalaryData, CURRENT_SESSION, sessionOfPeriod } from '@/lib/store/salary-store'
// PHASE 8B — salary figures are the canonical server payroll: payable =
// the sum of configured monthly salaries; "paid" = the sum of RECORDED
// payment amounts (status RECORDED, month 'YYYY-MM').
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CHART_PALETTE } from '@/components/shared/premium-charts'
import { FinancePanel, FinanceStat, FinanceEmptyState, severityAccent } from './finance-shared'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { OpenChartSection } from '../shared/open-chart-section'
import { InVsOutChart, HorizontalBars, ProgressBar } from './finance-charts'
import { toast } from 'sonner'

interface Props {
  data: ReturnType<typeof useFinanceData>
  onNavigate: (tab: 'overview' | 'statements' | 'reports' | 'settings') => void
  /** Cross-module jump (AppShell nav keys — 'fees', 'salary'). */
  onModuleNavigate?: (moduleKey: string) => void
}

export function FinanceOverviewSection({ data, onNavigate, onModuleNavigate }: Props) {
  const attention = useFinanceAttention()
  const feeData = useFeeData(CURRENT_ACADEMIC_YEAR)
  const salaryData = useSalaryData()

  const jumpTo = (moduleKey: string, label: string) => {
    if (onModuleNavigate) onModuleNavigate(moduleKey)
    else toast.info(`Navigate to ${label}`, { description: 'Open it from the sidebar' })
  }

  const handleAttention = (item: FinanceAttentionItem) => {
    if (item.module === 'finance-settings') onNavigate('settings')
    else if (item.module === 'statements' || item.module === 'reports') onNavigate(item.module)
    else if (item.module) jumpTo(item.module, item.cta)
  }

  const { analytics } = feeData
  const { currentMonth, monthLabel } = salaryData
  const payrollBalance = currentMonth.payable - currentMonth.recorded

  // ── REAL monthly series: fees in (collections) vs salary out (confirmed
  //    payments this session), month-aligned, trimmed at the current month.
  //    Joined on FY month INDEX (Apr=0 … Mar=11), never on locale-formatted
  //    labels — Chrome's ICU returns "Sept" while our display series uses
  //    "Sep", which silently dropped September payroll from the chart and
  //    broke the trim-to-current-month slice.
  const inVsOut = useMemo(() => {
    const fyIndexOf = (calendarMonth: number) => (calendarMonth - 3 + 12) % 12
    const outByIdx = new Map<number, number>()
    for (const p of salaryData.payments) {
      if (p.status !== 'RECORDED') continue
      if (sessionOfPeriod(p.month) !== CURRENT_SESSION.id) continue
      const m = Number(p.month.split('-')[1])
      if (!Number.isFinite(m)) continue
      const idx = fyIndexOf(m - 1)
      outByIdx.set(idx, (outByIdx.get(idx) ?? 0) + p.amount)
    }
    const months = analytics.monthly // display series Apr→Dec = FY indices 0–8
    const nowIdx = fyIndexOf(new Date().getMonth())
    const visible = nowIdx < months.length ? months.slice(0, nowIdx + 1) : months
    // Slice always starts at FY index 0, so array position === FY index.
    return visible.map((m, i) => ({ month: m.month, in: m.collected, out: outByIdx.get(i) ?? 0 }))
  }, [analytics.monthly, salaryData.payments])
  const chartHasData = inVsOut.some((m) => m.in > 0 || m.out > 0)

  // ── Recent money movement — REAL entries only: fee collections +
  //    confirmed salary payments, merged, newest first.
  const recentMovement = useMemo(() => {
    const feeRows = analytics.recentCollections
      .filter((t) => t.status === 'Success')
      .map((t) => ({
        id: `fee-${t.id}`,
        kind: 'in' as const,
        title: `${t.studentName}${t.className ? ` · ${t.className}` : ''}`,
        sub: `Fee${t.feeHead ? ` — ${t.feeHead}` : ''} · ${t.mode}`,
        date: t.date,
        amount: t.amount,
      }))
    const salaryRows = salaryData.payments
      .filter((p) => p.status === 'RECORDED')
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
      .slice(0, 5)
      .map((p) => ({
        id: `sal-${p.id}`,
        kind: 'out' as const,
        title: salaryData.teachers.find((t) => t.id === p.teacherId)?.name ?? 'Teacher',
        sub: `Salary · ${p.month} · ${p.method ?? '—'}`,
        date: p.paidOn,
        amount: p.amount,
      }))
    return [...feeRows, ...salaryRows]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
  }, [analytics.recentCollections, salaryData.payments, salaryData.teachers])

  // Annual expense picture (P&L baseline; salaries line is live payroll).
  const expenseBars = data.expenseBreakdown.slice(0, 6).map((e) => ({
    label: e.name, value: e.value, color: e.color,
  }))

  const netThisMonth = analytics.monthCollection - currentMonth.recorded

  return (
    <div className="space-y-4">
      {/* 1 — KPI cards: the Principal's four money questions. Every figure
          reconciles with the module that owns it. */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Fees Collected"
          value={formatINR(analytics.totalCollected, true)}
          sub={`${analytics.collectionRate}% of ${formatINR(analytics.totalExpected, true)} expected`}
          tone="emerald"
          delay={0}
          onClick={() => jumpTo('fees', 'Fee Management')}
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Fees Outstanding"
          value={formatINR(analytics.totalOutstanding, true)}
          sub={`${analytics.pendingCount} students · ${analytics.overdueCount} overdue`}
          tone="rose"
          delay={0.05}
          onClick={() => jumpTo('fees', 'Fee Management')}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label={`Payroll · ${monthLabel}`}
          value={formatINR(currentMonth.payable, true)}
          sub={
            payrollBalance > 0
              ? `${currentMonth.recordedCount}/${salaryData.rows.length} paid · ${formatINR(payrollBalance, true)} to record`
              : `${currentMonth.recordedCount}/${salaryData.rows.length} paid · clear`
          }
          tone={payrollBalance > 0 ? 'amber' : 'teal'}
          delay={0.1}
          onClick={() => jumpTo('salary', 'Salary & Payroll')}
        />
        <SummaryCard
          icon={<Landmark className="h-4 w-4" />}
          label="Cash in Bank"
          value={formatINRCompact(data.cashAvailable)}
          sub={`Illustrative · ${data.reserveCoverage} months reserve estimate`}
          tone="violet"
          delay={0.15}
          onClick={() => onNavigate('statements')}
        />
      </SummaryCardGrid>

      {/* 2 — ONE composed row. LEFT: the session's real money flow.
          RIGHT: this month's movement snapshot. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 min-w-0">
          <OpenChartSection
            title="Collections vs Payroll"
            subtitle={`${CURRENT_SESSION.label.replace('Session ', '')} · money in from fees vs salary paid · real ledger`}
            className="min-w-0"
            action={
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHART_PALETTE[0] }} /> Fees In
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHART_PALETTE[2] }} /> Salary Out
                </span>
              </div>
            }
          >
            {chartHasData ? (
              <InVsOutChart
                data={inVsOut}
                height={190}
                showArea={false}
                format={(n) => formatINR(n, true)}
                primaryColor={CHART_PALETTE[0]}
                secondaryColor={CHART_PALETTE[2]}
              />
            ) : (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No collections or salary payments recorded yet this session.
              </p>
            )}
          </OpenChartSection>
        </div>

        {/* Label honesty: the two series use DIFFERENT windows — fees are a
            rolling 30-day collection total (fee-store monthCollection), payroll
            is the current calendar month's confirmed total. State both. */}
        <FinancePanel title="This Month" subtitle="fees: last 30 days · payroll: this month">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <FinanceStat label="Money In" value={`+${formatINR(analytics.monthCollection, true)}`} accent="emerald" />
              <FinanceStat label="Salary Out" value={`-${formatINR(currentMonth.recorded, true)}`} accent="rose" />
              <FinanceStat
                label="Net"
                value={`${netThisMonth >= 0 ? '+' : '-'}${formatINR(Math.abs(netThisMonth), true)}`}
                accent={netThisMonth >= 0 ? 'emerald' : 'rose'}
              />
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
              <div className="flex items-center justify-between text-[10px] mb-1.5">
                <span className="text-muted-foreground font-medium">Session collection</span>
                <span className="font-bold tabular-nums">{analytics.collectionRate}% <span className="text-muted-foreground font-normal">/ 85% target</span></span>
              </div>
              <ProgressBar value={analytics.collectionRate} max={100} />
            </div>
            <div className="flex items-center justify-between text-[10px] px-0.5">
              <span className="text-muted-foreground flex items-center gap-1">
                {/* Illustrative — reserve coverage derives from the projected
                    balance sheet (see Cash in Bank KPI + Statements banner). */}
                <Landmark className="h-3 w-3" /> Bank covers {data.reserveCoverage} months of costs · illustrative
              </span>
              <button
                onClick={() => onNavigate('statements')}
                className="text-primary font-semibold hover:underline shrink-0"
              >
                Statements →
              </button>
            </div>
          </div>
        </FinancePanel>
      </div>

      {/* 3 — Needs Attention (unified, actionable) + Coming Up. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <FinancePanel
          className="lg:col-span-2"
          title="Needs Attention"
          subtitle={attention.length > 0 ? `${attention.length} item${attention.length > 1 ? 's' : ''} across fees and payroll` : 'nothing pending'}
        >
          {attention.length === 0 ? (
            <FinanceEmptyState
              icon={<ShieldCheck className="h-5 w-5" />}
              title="All clear"
              description="No payroll, verification or collection items need you right now."
            />
          ) : (
            <div className="divide-y divide-border/50 max-h-[340px] overflow-y-auto custom-scrollbar -mx-1 px-1">
              {attention.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-start gap-2.5 py-2.5"
                >
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 mt-0.5', severityAccent(item.severity))}>
                    <AlertCircle className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-tight">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-0.5 shrink-0 mt-0.5"
                    onClick={() => handleAttention(item)}
                  >
                    {item.cta} <ArrowRight className="h-2.5 w-2.5" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </FinancePanel>

        {/* Only the payroll line is live (unpaid portion or forward monthly
            payroll); vendor/utility/loan lines are projected amounts from the
            illustrative books — the total is therefore an estimate too. */}
        <FinancePanel title="Coming Up" subtitle="scheduled obligations · only payroll is live">
          <div className="space-y-1">
            {data.upcomingObligations.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-md hover:bg-muted/30 px-1.5 py-1.5 transition-colors">
                <div className="min-w-0 flex items-center gap-2">
                  <CalendarClock className={cn('h-3.5 w-3.5 shrink-0', o.severity === 'warning' ? 'text-amber-600' : 'text-muted-foreground')} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">{o.title}</p>
                    <p className="text-[9px] text-muted-foreground">{o.due}</p>
                  </div>
                </div>
                <span className={cn('text-[11px] font-bold tabular-nums shrink-0', o.severity === 'warning' ? 'text-amber-600' : 'text-foreground')}>
                  {formatINR(o.amount, true)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border/50 mt-2 pt-2 px-1.5">
            <p className="text-[10px] text-muted-foreground">Total due this month</p>
            <p className="text-xs font-bold tabular-nums">
              {formatINR(data.upcomingObligations.reduce((s, o) => s + o.amount, 0), true)}
            </p>
          </div>
        </FinancePanel>
      </div>

      {/* 4 — Where money goes + real recent movement. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <FinancePanel
          title="Where Money Goes"
          subtitle="annual operating spend · payroll line live (annualized), other lines illustrative"
          action={<Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => onNavigate('reports')}>Reports <ArrowRight className="h-3 w-3" /></Button>}
        >
          <HorizontalBars data={expenseBars} formatValue={(n) => formatINR(n, true)} />
        </FinancePanel>

        <FinancePanel
          className="lg:col-span-2"
          title="Recent Money Movement"
          subtitle="live from fees and payroll"
        >
          {recentMovement.length === 0 ? (
            <FinanceEmptyState icon={<Receipt className="h-5 w-5" />} title="No activity yet" description="Fee collections and salary payments will appear here." />
          ) : (
            <div className="divide-y divide-border/50 -mx-1 px-1 max-h-[300px] overflow-y-auto custom-scrollbar">
              {recentMovement.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-2.5 py-2"
                >
                  <span className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
                    a.kind === 'in'
                      ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
                  )}>
                    {a.kind === 'in' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium truncate">{a.title}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{a.sub}</p>
                  </div>
                  <p className={cn(
                    'text-xs font-bold tabular-nums shrink-0',
                    a.kind === 'in' ? 'text-emerald-600' : 'text-amber-600',
                  )}>
                    {a.kind === 'in' ? '+' : '-'}{formatINR(a.amount, true)}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </FinancePanel>
      </div>

      {/* 5 — Deep links into the two money modules. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => jumpTo('fees', 'Fee Management')}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3.5 text-left hover:border-emerald-500/40 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">Fee Management</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {formatINRCompact(analytics.totalCollected)} collected · {analytics.collectionRate}% of session
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
          </div>
        </button>

        <button
          onClick={() => jumpTo('salary', 'Salary & Payroll')}
          className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3.5 text-left hover:border-violet-500/40 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20">
                <Receipt className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">Salary &amp; Payroll</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {payrollBalance > 0
                    ? <><span className="text-amber-600 font-semibold">{formatINRCompact(payrollBalance)}</span> to record · {monthLabel}</>
                    : <>{monthLabel} payroll clear · {currentMonth.recordedCount} payments</>}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-600 group-hover:translate-x-1 transition-all" />
          </div>
        </button>
      </div>
    </div>
  )
}
