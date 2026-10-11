'use client'

/**
 * FinanceOverviewSection — the Principal's MONEY CONSOLE.
 *
 * BATCH2-B5 — HONEST MONEY: every fee figure flows from the SERVER
 * (GET /api/dashboard school aggregates + the live dues summary from
 * GET /api/fees/defaulters?summary=1; recent collections from
 * GET /api/fees/transactions). The fabricated books from
 * src/lib/mock/finance-dashboard.ts (cash-in-bank, reserves, expense
 * breakdown, vendor/utility obligations) are GONE — those surfaces now
 * render honest "requires expense ledger — not available" states.
 * Payroll figures come from the Salary & Payroll module's store (its own
 * workspace's ledger — labelled as such, out of B5's fee scope).
 *
 * Layout (kept):
 *   1. Four KPI cards — Fees Collected · Fees Outstanding · Payroll this
 *      month · Cash in Bank (honest: not available — no bank ledger)
 *   2. LEFT: "Collections vs Payroll" chart (server fee collections in;
 *      salary-store payroll out). RIGHT: This Month snapshot.
 *   3. Needs Attention (operational feed) + Coming Up (payroll live,
 *      other obligations honestly unavailable).
 *   4. Where Money Goes (honest unavailable) + Recent Money Movement
 *      (server fee collections + recorded salary payments).
 *   5. Deep links into Fee Management and Salary & Payroll.
 */

import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Wallet, CheckCircle2, AlertCircle, Landmark, Users, ArrowRight,
  ArrowUpRight, ArrowDownRight, ShieldCheck, CalendarClock, Receipt, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useFinanceAttention,
  type FinanceAttentionItem,
} from '@/lib/store/finance-store'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { useSalaryData, CURRENT_SESSION, sessionOfPeriod } from '@/lib/store/salary-store'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CHART_PALETTE } from '@/components/shared/premium-charts'
import { FinancePanel, FinanceStat, FinanceEmptyState, severityAccent, UnavailableLine, UnavailableNote } from './finance-shared'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { OpenChartSection } from '../shared/open-chart-section'
import { InVsOutChart, ProgressBar } from './finance-charts'
import { useServerResource, monthKeyToLabel, type SchoolDashboardPayload, type ServerFeeTxn } from '../fees/use-fee-server-data'
import { toast } from 'sonner'

interface Props {
  onNavigate: (tab: 'overview' | 'statements' | 'reports' | 'settings') => void
  /** Cross-module jump (AppShell nav keys — 'fees', 'salary'). */
  onModuleNavigate?: (moduleKey: string) => void
}

export function FinanceOverviewSection({ onNavigate, onModuleNavigate }: Props) {
  // ── server truth (B5) ──────────────────────────────────────────────
  const dashboard = useServerResource<SchoolDashboardPayload>('/api/dashboard')
  const recentTxns = useServerResource<ServerFeeTxn[]>('/api/fees/transactions?status=SUCCESS&limit=8')
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  // Payroll — the Salary & Payroll module's own ledger (out of B5's fee
  // scope; labelled wherever it renders).
  const salaryData = useSalaryData()

  const attention = useFinanceAttention()

  const jumpTo = (moduleKey: string, label: string) => {
    if (onModuleNavigate) onModuleNavigate(moduleKey)
    else toast.info(`Navigate to ${label}`, { description: 'Open it from the sidebar' })
  }

  const handleAttention = (item: FinanceAttentionItem) => {
    if (item.module === 'finance-settings') onNavigate('settings')
    else if (item.module === 'statements' || item.module === 'reports') onNavigate(item.module)
    else if (item.module) jumpTo(item.module, item.cta)
  }

  const stats = dashboard.data?.stats
  const totalCollected = stats?.feesPaid
  const totalExpected = stats?.feesTotal
  const collectionRate = totalExpected && totalExpected > 0 && totalCollected !== undefined
    ? Math.round((totalCollected / totalExpected) * 1000) / 10
    : 0
  const totalOutstanding =
    dues?.totalOutstanding ??
    (totalExpected !== undefined && totalCollected !== undefined ? Math.max(0, totalExpected - totalCollected) : undefined)
  const studentsWithDues = dues?.defaulterCount ?? 0

  const { currentMonth, monthLabel } = salaryData
  const payrollBalance = currentMonth.payable - currentMonth.recorded

  // ── REAL monthly series: fees in (server SUCCESS-payment sums, from
  //    /api/dashboard trend) vs salary out (payroll module's RECORDED
  //    payments), joined on the server's YYYY-MM month keys.
  const inVsOut = useMemo(() => {
    const outByMonth = new Map<string, number>()
    for (const p of salaryData.payments) {
      if (p.status !== 'RECORDED') continue
      if (sessionOfPeriod(p.month) !== CURRENT_SESSION.id) continue
      outByMonth.set(p.month, (outByMonth.get(p.month) ?? 0) + p.amount)
    }
    return (dashboard.data?.trend ?? []).map((m) => ({
      month: monthKeyToLabel(m.month),
      in: m.amount,
      out: outByMonth.get(m.month) ?? 0,
    }))
  }, [dashboard.data, salaryData.payments])
  const chartHasData = inVsOut.some((m) => m.in > 0 || m.out > 0)

  // This month's fee collections — the server trend bucket for the
  // current calendar month.
  const nowMonthKey = new Date().toISOString().slice(0, 7)
  const monthFeeIn = useMemo(
    () => (dashboard.data?.trend ?? []).find((m) => m.month === nowMonthKey)?.amount ?? 0,
    [dashboard.data, nowMonthKey],
  )

  // ── Recent money movement — REAL entries only: server fee collections
  //    + recorded salary payments, merged, newest first.
  const recentMovement = useMemo(() => {
    const feeRows = (recentTxns.data ?? []).map((t) => ({
      id: `fee-${t.id}`,
      kind: 'in' as const,
      title: `${t.studentName ?? 'Student'}${t.className ? ` · ${t.className}` : ''}`,
      sub: `Fee${t.feeHeadName ? ` — ${t.feeHeadName}` : ''} · server ledger`,
      date: t.createdAt,
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
  }, [recentTxns.data, salaryData.payments, salaryData.teachers])

  const netThisMonth = monthFeeIn - currentMonth.recorded

  return (
    <div className="space-y-4">
      {/* 1 — KPI cards: the Principal's four money questions. Fee figures
          reconcile with the server ledger; payroll with the payroll
          module; Cash in Bank is honestly unavailable. */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Fees Collected"
          value={totalCollected !== undefined ? formatINR(totalCollected, true) : '—'}
          sub={stats ? `${collectionRate}% of ${formatINR(totalExpected ?? 0, true)} billed · server ledger` : 'loading…'}
          tone="emerald"
          delay={0}
          onClick={() => jumpTo('fees', 'Fee Management')}
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Fees Outstanding"
          value={totalOutstanding !== undefined ? formatINR(totalOutstanding, true) : '—'}
          sub={`${studentsWithDues} student${studentsWithDues === 1 ? '' : 's'} with dues · server aggregation`}
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
        {/* Honest unavailable KPI — no bank/ledger model exists. */}
        <SummaryCard
          icon={<Landmark className="h-4 w-4" />}
          label="Cash in Bank"
          value={
            <span
              className="inline-flex items-center gap-1.5 text-base text-muted-foreground"
              title="requires bank/ledger model — not available"
            >
              <Info className="h-4 w-4" aria-hidden /> not available
            </span>
          }
          sub="no bank/ledger model recorded yet"
          tone="slate"
          delay={0.15}
          onClick={() => onNavigate('statements')}
        />
      </SummaryCardGrid>

      {/* 2 — ONE composed row. LEFT: the real money flow. RIGHT: this
          month's movement snapshot. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 min-w-0">
          <OpenChartSection
            title="Collections vs Payroll"
            subtitle={`${CURRENT_SESSION.label.replace('Session ', '')} · money in from fees (server) vs salary paid (payroll module)`}
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
            {dashboard.loading ? (
              <div className="h-[190px] w-full animate-pulse rounded-lg bg-muted/40" aria-busy="true" aria-label="Loading collections trend" />
            ) : chartHasData ? (
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

        {/* This month — fees in (server, this calendar month) vs salary
            out (payroll module, this month). Both windows stated. */}
        <FinancePanel title="This Month" subtitle="fees: server calendar month · payroll: this month">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <FinanceStat label="Money In" value={`+${formatINR(monthFeeIn, true)}`} accent="emerald" />
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
                <span className="font-bold tabular-nums">{collectionRate}% <span className="text-muted-foreground font-normal">/ 85% target</span></span>
              </div>
              <ProgressBar value={collectionRate} max={100} />
            </div>
            {/* Bank/reserve figures do not exist — honest note instead of
                the old fabricated months-of-cover line. */}
            <UnavailableNote>
              <strong className="font-semibold text-foreground">Bank &amp; reserve position:</strong> not
              available — the platform records no bank balance or expense ledger, so months-of-cover
              cannot be computed honestly.
            </UnavailableNote>
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

        {/* Coming Up — only the payroll line is live; vendor/utility/loan
            obligations have no ledger, so they render honestly muted. */}
        <FinancePanel title="Coming Up" subtitle="scheduled obligations · only payroll is recorded">
          <div className="space-y-1">
            <div className="flex items-center justify-between rounded-md hover:bg-muted/30 px-1.5 py-1.5 transition-colors">
              <div className="min-w-0 flex items-center gap-2">
                <CalendarClock className={cn('h-3.5 w-3.5 shrink-0', payrollBalance > 0 ? 'text-amber-600' : 'text-muted-foreground')} />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">
                    Payroll{payrollBalance > 0 ? ' — unpaid portion' : ` · ${monthLabel}`}
                  </p>
                  <p className="text-[9px] text-muted-foreground">end of month · payroll module</p>
                </div>
              </div>
              <span className={cn('text-[11px] font-bold tabular-nums shrink-0', payrollBalance > 0 ? 'text-amber-600' : 'text-foreground')}>
                {formatINR(payrollBalance > 0 ? payrollBalance : currentMonth.payable, true)}
              </span>
            </div>
            <UnavailableLine label="Utilities" />
            <UnavailableLine label="Vendor payments" />
            <UnavailableLine label="Loan repayment" note="no loan ledger" />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 mt-2 pt-2 px-1.5">
            <p className="text-[10px] text-muted-foreground">Total recorded this month</p>
            <p className="text-xs font-bold tabular-nums">
              {formatINR(payrollBalance > 0 ? payrollBalance : currentMonth.payable, true)}
              <span className="ml-1 text-[9px] font-semibold text-muted-foreground">payroll only</span>
            </p>
          </div>
        </FinancePanel>
      </div>

      {/* 4 — Where money goes (honestly unavailable) + real recent movement. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <FinancePanel
          title="Where Money Goes"
          subtitle="annual operating spend · requires an expense ledger"
          action={<Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => onNavigate('reports')}>Reports <ArrowRight className="h-3 w-3" /></Button>}
        >
          <UnavailableNote>
            <strong className="font-semibold text-foreground">Not available.</strong> The platform records
            fee revenue only — salaries, utilities, vendors and maintenance have no expense ledger yet,
            so no spend breakdown can be shown honestly. Payroll figures live in the Salary &amp; Payroll
            module&apos;s own workspace.
          </UnavailableNote>
        </FinancePanel>

        <FinancePanel
          className="lg:col-span-2"
          title="Recent Money Movement"
          subtitle="fee collections (server) and salary payments (payroll module)"
        >
          {recentTxns.loading && recentMovement.length === 0 ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading recent movement">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                  <div className="h-7 w-7 animate-pulse rounded-md bg-muted/60" />
                  <div className="h-3 w-40 animate-pulse rounded bg-muted/50" />
                  <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted/50" />
                </div>
              ))}
            </div>
          ) : recentMovement.length === 0 ? (
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
                  {totalCollected !== undefined ? `${formatINR(totalCollected, true)} collected · ${collectionRate}% of billed` : 'loading server ledger…'}
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
                    ? <><span className="text-amber-600 font-semibold">{formatINR(payrollBalance, true)}</span> to record · {monthLabel}</>
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
