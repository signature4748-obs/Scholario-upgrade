/**
 * Finance store — single source of truth for the Finance Dashboard.
 *
 * Aggregates from:
 *   - Fee Management (fee-store.ts) → Fee Revenue + Receivables
 *   - Salary & Payroll (salary-store.ts) → Payroll Expense + Payables
 *   - P&L data (mock/finance-dashboard.ts) → Operating expenses, other income
 *   - Balance sheet data → Assets / Liabilities / Net Worth
 *
 * All dashboard numbers derive from this store — no independent hardcoding
 * in different components. Numbers reconcile mathematically:
 *   Revenue - Expenses = Net Surplus
 *   Assets - Liabilities = Net Worth
 *   Opening Cash + Cash In - Cash Out = Closing Cash
 *   Budget - Actual = Variance
 */

import { useMemo } from 'react'
import { useFeeData, useFeeStore, CURRENT_ACADEMIC_YEAR } from './fee-store'
import {
  useSalaryData, currentPeriodKey, periodOptions, recordedPaidFor, salaryEventsOf, useSalaryStore,
} from './salary-store'
import { formatINR } from '@/lib/format'
import {
  pnlData, balanceSheet, cashflow, financeStats,
} from '@/lib/mock/finance-dashboard'

// ─── Periods ─────────────────────────────────────────────────────────

export interface FinancePeriod {
  id: string
  label: string
  shortLabel: string
  fiscalYear: string
}

export const FINANCE_PERIODS: FinancePeriod[] = [
  { id: 'fy25-26', label: 'FY 2025–26', shortLabel: 'FY 25-26', fiscalYear: '2025-26' },
  { id: 'fy24-25', label: 'FY 2024–25', shortLabel: 'FY 24-25', fiscalYear: '2024-25' },
  { id: 'q1-26', label: 'Q1 2025-26', shortLabel: 'Q1', fiscalYear: '2025-26' },
  { id: 'q2-26', label: 'Q2 2025-26', shortLabel: 'Q2', fiscalYear: '2025-26' },
  { id: 'q3-26', label: 'Q3 2025-26', shortLabel: 'Q3', fiscalYear: '2025-26' },
  { id: 'q4-26', label: 'Q4 2025-26', shortLabel: 'Q4', fiscalYear: '2025-26' },
]

// ─── Hook: useFinanceData ────────────────────────────────────────────

export function useFinanceData(periodId: string = 'fy25-26') {
  const feeData = useFeeData(CURRENT_ACADEMIC_YEAR)
  const salaryData = useSalaryData()
  // PHASE 8B — canonical payment events + teacher names for the honest
  // activity feed (derived from the server ledger, never a local log).
  const teacherNames = useSalaryStore((s) => s.teacherNames)

  return useMemo(() => {
    // ── Revenue ────────────────────────────────────────────────────
    // Derive fee revenue from fee-store (collected amount).
    const feeRevenue = feeData.analytics.totalCollected
    const feeExpected = feeData.analytics.totalExpected
    const feeOutstanding = feeData.analytics.totalOutstanding
    const feeCollectionRate = feeData.analytics.collectionRate

    // Other revenue (from P&L data: transport, admissions, donations, etc.)
    // Excluding the tuition/fee income which is already in feeRevenue.
    const otherIncomeItems = pnlData.filter((p) =>
      p.type === 'income' &&
      !p.category.toLowerCase().includes('tuition') &&
      !p.category.toLowerCase().includes('transport fees')  // transport is in fee structure
    )
    const otherRevenue = otherIncomeItems.reduce((s, p) => s + p.amount, 0)

    // For demo coherence, we use the canonical financeStats.monthlyRevenue
    // for the trend chart and aggregate to fiscal-year totals.
    const monthlyRevenue = financeStats.monthlyRevenue
    const totalRevenue = monthlyRevenue.reduce((s, m) => s + m.revenue, 0)
    const totalExpenses = monthlyRevenue.reduce((s, m) => s + m.expense, 0)
    const netSurplus = totalRevenue - totalExpenses
    const surplusMargin = totalRevenue > 0 ? Math.round((netSurplus / totalRevenue) * 1000) / 10 : 0

    // ── Expenses ────────────────────────────────────────────────────
    // Derive payroll expense from salary-store (current month calculated).
    const monthlyPayroll = salaryData.analytics.monthlyPayroll
    const annualizedPayroll = monthlyPayroll * 12

    // ── LIVE PAYROLL LEDGER (Employee Accounts parity) ─────────────
    // Operational payroll cash metrics mirrored from the Salary & Payroll
    // module — the Finance Dashboard and the payroll workspace always
    // agree. PHASE 8B: the model is a fixed monthly salary per teacher;
    // "outstanding" = configured salaries minus RECORDED payments across
    // the last 6 periods; "paid" = the sum of RECORDED amounts.
    const payrollPeriods = periodOptions(6)
    const payrollCurrentPeriod = currentPeriodKey()
    let payrollOutstanding = 0
    for (const r of salaryData.rows) {
      if (r.monthly <= 0) continue
      for (const pk of payrollPeriods) {
        if (pk > payrollCurrentPeriod) continue
        const recorded = recordedPaidFor(salaryData.payments, r.teacher.id, pk)
        payrollOutstanding += Math.max(0, r.monthly - recorded)
      }
    }
    const payrollPaidSession = salaryData.payments
      .filter((p) => p.status === 'RECORDED')
      .reduce((s, p) => s + p.amount, 0)
    const payrollUnrecordedCount = salaryData.currentMonth.unrecorded.length

    // ── FEE-PLAN SESSION HEALTH (Fee Structures parity) ────────────
    // How many per-class fee plans for the active session are published
    // (have a current version) vs still drafts/not-configured.
    const structureSession = {
      session: CURRENT_ACADEMIC_YEAR,
      total: feeData.feeStructures.length,
      published: feeData.feeStructures.filter((st) =>
        feeData.versions.some((v) => v.structureId === st.id && v.status === 'current'),
      ).length,
    }

    // Use P&L data expense breakdown for category analysis.
    const expenseBreakdown = financeStats.expenseBreakdown
    // Replace the salaries line with the canonical payroll-derived figure.
    const payrollDerivedExpense = expenseBreakdown.map((e) =>
      e.name === 'Salaries' ? { ...e, value: annualizedPayroll, label: 'Staff & Payroll' } : e
    )

    // ── Cash Position ──────────────────────────────────────────────
    const cashAvailable = balanceSheet.find((b) => b.account === 'Cash & Bank Balance')?.amount ?? financeStats.cashOnHand
    const monthlyOperatingExpense = totalExpenses / 12
    const reserveCoverage = monthlyOperatingExpense > 0 ? Math.round((cashAvailable / monthlyOperatingExpense) * 10) / 10 : 0

    // ── Cash Flow ───────────────────────────────────────────────────
    const operatingNet = cashflow.filter((c) => c.activity === 'operating').reduce((s, c) => s + c.inflow - c.outflow, 0)
    const investingNet = cashflow.filter((c) => c.activity === 'investing').reduce((s, c) => s + c.inflow - c.outflow, 0)
    const financingNet = cashflow.filter((c) => c.activity === 'financing').reduce((s, c) => s + c.inflow - c.outflow, 0)
    const netCashChange = operatingNet + investingNet + financingNet
    const openingCash = cashAvailable - netCashChange
    const closingCash = cashAvailable

    // ── Balance Sheet ──────────────────────────────────────────────
    const currentAssets = balanceSheet.filter((b) => b.type === 'asset' && b.category === 'Current Assets').reduce((s, b) => s + b.amount, 0)
    const fixedAssets = balanceSheet.filter((b) => b.type === 'asset' && b.category === 'Fixed Assets').reduce((s, b) => s + b.amount, 0)
    const totalAssets = currentAssets + fixedAssets
    const currentLiabilities = balanceSheet.filter((b) => b.type === 'liability' && b.category === 'Current Liabilities').reduce((s, b) => s + b.amount, 0)
    const longTermLiabilities = balanceSheet.filter((b) => b.type === 'liability' && b.category === 'Long-term Liabilities').reduce((s, b) => s + b.amount, 0)
    const totalLiabilities = currentLiabilities + longTermLiabilities
    const totalEquity = balanceSheet.filter((b) => b.type === 'equity').reduce((s, b) => s + b.amount, 0)
    const netWorth = totalAssets - totalLiabilities

    // ── Receivables ────────────────────────────────────────────────
    const feeReceivables = feeOutstanding
    const otherReceivables = balanceSheet.find((b) => b.account === 'Fees Receivable')?.amount ?? 0
    const totalReceivables = feeReceivables + otherReceivables
    const receivableStudentCount = feeData.analytics.pendingCount

    // ── Payables ────────────────────────────────────────────────────
    const payrollPayable = balanceSheet.find((b) => b.account === 'Salary Payable')?.amount ?? monthlyPayroll
    const vendorPayables = balanceSheet.find((b) => b.account === 'Vendor Payables')?.amount ?? 0
    const totalPayables = payrollPayable + vendorPayables + longTermLiabilities / 12 // monthly loan portion

    // ── Budget vs Actual ────────────────────────────────────────────
    const budgetData = financeStats.budgetVsActual.map((b) => {
      // Override Salaries actual with payroll-derived figure
      if (b.category === 'Salaries') {
        return { ...b, actual: annualizedPayroll, category: 'Staff' }
      }
      return b
    })
    const totalBudget = budgetData.reduce((s, b) => s + b.budget, 0)
    const totalActual = budgetData.reduce((s, b) => s + b.actual, 0)
    const totalVariance = totalBudget - totalActual
    const budgetUtilization = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 1000) / 10 : 0

    // ── Quarterly ──────────────────────────────────────────────────
    const quarterly = financeStats.quarterlyRevExp.map((q) => ({
      ...q,
      surplus: q.revenue - q.expense,
    }))
    const quarterlySurplus = quarterly.map((q) => ({ quarter: q.quarter, surplus: q.surplus }))
    const bestQuarter = quarterly.reduce((best, q) => q.surplus > best.surplus ? q : best, quarterly[0])
    const lowestQuarter = quarterly.reduce((low, q) => q.surplus < low.surplus ? q : low, quarterly[0])

    // ── Financial Health ───────────────────────────────────────────
    const currentRatio = currentLiabilities > 0 ? Math.round((currentAssets / currentLiabilities) * 100) / 100 : 0
    const debtToEquity = totalEquity > 0 ? Math.round((totalLiabilities / totalEquity) * 100) / 100 : 0
    const operatingEfficiency = totalRevenue > 0 ? Math.round((totalExpenses / totalRevenue) * 1000) / 10 : 0
    const collectionRate = feeCollectionRate

    const healthMetrics = [
      { label: 'Current Ratio', value: `${currentRatio.toFixed(2)}×`, status: currentRatio >= 2 ? 'Healthy' : currentRatio >= 1 ? 'Watch' : 'Attention', severity: currentRatio >= 2 ? 'healthy' : currentRatio >= 1 ? 'watch' : 'attention' },
      { label: 'Debt to Equity', value: `${debtToEquity.toFixed(2)}×`, status: debtToEquity <= 0.5 ? 'Healthy' : debtToEquity <= 1 ? 'Watch' : 'Attention', severity: debtToEquity <= 0.5 ? 'healthy' : debtToEquity <= 1 ? 'watch' : 'attention' },
      { label: 'Surplus Margin', value: `${surplusMargin}%`, status: surplusMargin >= 20 ? 'Healthy' : surplusMargin >= 10 ? 'Watch' : 'Attention', severity: surplusMargin >= 20 ? 'healthy' : surplusMargin >= 10 ? 'watch' : 'attention' },
      { label: 'Operating Efficiency', value: `${operatingEfficiency}%`, status: operatingEfficiency <= 60 ? 'Healthy' : operatingEfficiency <= 75 ? 'Watch' : 'Attention', severity: operatingEfficiency <= 60 ? 'healthy' : operatingEfficiency <= 75 ? 'watch' : 'attention' },
      { label: 'Reserve Coverage', value: `${reserveCoverage} months`, status: reserveCoverage >= 3 ? 'Healthy' : reserveCoverage >= 1 ? 'Watch' : 'Attention', severity: reserveCoverage >= 3 ? 'healthy' : reserveCoverage >= 1 ? 'watch' : 'attention' },
      { label: 'Collection Rate', value: `${collectionRate}%`, status: collectionRate >= 85 ? 'Healthy' : collectionRate >= 70 ? 'Watch' : 'Attention', severity: collectionRate >= 85 ? 'healthy' : collectionRate >= 70 ? 'watch' : 'attention' },
    ]
    const overallHealth = healthMetrics.filter((m) => m.severity === 'attention').length > 0 ? 'Attention'
      : healthMetrics.filter((m) => m.severity === 'watch').length > 0 ? 'Watch'
      : 'Healthy'

    // ── Alerts ────────────────────────────────────────────────────
    const alerts: Array<{ id: string; title: string; description: string; severity: 'critical' | 'warning' | 'info'; action?: string; /** Where the action button lands: a finance tab ('overview'|'statements'|'reports') or an AppShell module key ('fees'|'salary'). */ actionModule?: string }> = []
    if (feeOutstanding > 1000000) {
      alerts.push({ id: 'fee-outstanding', title: 'Outstanding Fees', description: `${formatINR(feeOutstanding, true)} pending from ${receivableStudentCount} students`, severity: 'warning', action: 'View Pending Dues', actionModule: 'fees' })
    }
    const techBudget = budgetData.find((b) => b.category === 'Tech')
    if (techBudget && techBudget.actual > techBudget.budget) {
      alerts.push({ id: 'tech-overrun', title: 'Technology Budget Exceeded', description: `${formatINR(techBudget.actual - techBudget.budget, true)} over budget`, severity: 'critical', action: 'View Budget', actionModule: 'reports' })
    }
    if (payrollUnrecordedCount > 0) {
      alerts.push({ id: 'payroll-unrecorded', title: 'Salary Payments Not Recorded', description: `${payrollUnrecordedCount} salary payment${payrollUnrecordedCount > 1 ? 's' : ''} not recorded for ${salaryData.monthLabel}`, severity: 'warning', action: 'Open Payroll', actionModule: 'salary' })
    }
    if (collectionRate < 85) {
      alerts.push({ id: 'collection-low', title: 'Fee Collection Below Target', description: `${collectionRate}% collected — target 85%`, severity: 'warning', action: 'View Fee Management', actionModule: 'fees' })
    }
    if (reserveCoverage < 3) {
      alerts.push({ id: 'reserve-low', title: 'Cash Reserve Below Target', description: `${reserveCoverage} months coverage — target 3+ months`, severity: 'info' })
    }

    // ── Recent Activity ────────────────────────────────────────────
    const recentActivity: Array<{ id: string; date: string; type: 'income' | 'expense' | 'payroll' | 'adjustment'; description: string; amount: number; status: string }> = [
      ...feeData.analytics.recentCollections.slice(0, 3).map((t) => ({
        id: t.id, date: t.date, type: 'income' as const,
        description: `Fee payment from ${t.studentName}`,
        amount: t.amount, status: t.status,
      })),
      ...salaryEventsOf(salaryData.payments, teacherNames).slice(0, 2).map((e) => ({
        id: e.id, date: e.at.split('T')[0], type: 'payroll' as const,
        description: `${e.kind === 'payment.voided' ? 'Salary payment voided' : 'Salary payment recorded'} — ${e.teacherName} · ${e.month}`,
        amount: e.amount, status: e.kind === 'payment.voided' ? 'Voided' : 'Recorded',
      })),
      // A couple of expense entries from P&L
      { id: 'exp-1', date: '2025-11-28', type: 'expense' as const, description: 'Vendor payment — Lab equipment supplier', amount: 840000, status: 'Paid' },
      { id: 'exp-2', date: '2025-11-25', type: 'expense' as const, description: 'Utility bill — Electricity', amount: 280000, status: 'Paid' },
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)

    // ── Upcoming Obligations ───────────────────────────────────────
    // The payroll line is REAL: when unpaid payroll exists (Employee
    // Accounts ledger) it shows the actual unpaid portion; otherwise the
    // forward-looking monthly payroll. Mock vendor/utility lines follow.
    const upcomingObligations = [
      payrollOutstanding > 0
        ? { id: 'obl-1', title: 'Payroll — unpaid portion', amount: payrollOutstanding, due: 'End of month', severity: 'warning' as const }
        : { id: 'obl-1', title: 'Payroll', amount: monthlyPayroll, due: 'End of month', severity: 'info' as const },
      { id: 'obl-2', title: 'Utilities', amount: 420000, due: '25th of month', severity: 'info' as const },
      { id: 'obl-3', title: 'Vendor Payments', amount: 860000, due: '28th of month', severity: 'info' as const },
      { id: 'obl-4', title: 'Loan Repayment', amount: 400000, due: '5th next month', severity: 'info' as const },
    ]

    // ── Monthly trend (revenue vs expense) ─────────────────────────
    const monthlyTrend = monthlyRevenue.map((m) => ({
      month: m.month,
      revenue: m.revenue,
      expense: m.expense,
      surplus: m.revenue - m.expense,
    }))

    return {
      period: FINANCE_PERIODS.find((p) => p.id === periodId) ?? FINANCE_PERIODS[0],

      // Top summary
      totalRevenue,
      totalExpenses,
      netSurplus,
      surplusMargin,
      cashAvailable,
      monthlyOperatingExpense,
      reserveCoverage,

      // Revenue breakdown
      feeRevenue,
      feeExpected,
      feeOutstanding,
      feeCollectionRate,
      otherRevenue,
      otherIncomeItems,

      // Expenses
      expenseBreakdown: payrollDerivedExpense,
      monthlyPayroll,
      annualizedPayroll,

      // Live payroll ledger (Employee Accounts parity) — PHASE 8B:
      // fixed monthly salaries + RECORDED payments (server canonical).
      payrollPaidSession,
      payrollOutstanding,
      payrollUnrecordedCount,

      // Fee-plan session health (Fee Structures parity)
      structureSession,

      // Cash flow
      operatingNet,
      investingNet,
      financingNet,
      netCashChange,
      openingCash,
      closingCash,

      // Balance sheet
      currentAssets,
      fixedAssets,
      totalAssets,
      currentLiabilities,
      longTermLiabilities,
      totalLiabilities,
      totalEquity,
      netWorth,

      // Receivables / Payables
      feeReceivables,
      otherReceivables,
      totalReceivables,
      receivableStudentCount,
      payrollPayable,
      vendorPayables,
      totalPayables,
      upcomingObligations,

      // Budget
      budgetData,
      totalBudget,
      totalActual,
      totalVariance,
      budgetUtilization,

      // Quarterly
      quarterly,
      quarterlySurplus,
      bestQuarter,
      lowestQuarter,

      // Financial health
      currentRatio,
      debtToEquity,
      operatingEfficiency,
      collectionRate,
      healthMetrics,
      overallHealth,

      // Alerts & activity
      alerts,
      recentActivity,

      // Charts
      monthlyTrend,
      monthlyRevenue,

      // Raw data
      pnlData,
      balanceSheet,
      cashflow,
    }
  }, [feeData, salaryData, teacherNames, periodId])
}

// ─── Format helpers ──────────────────────────────────────────────────

export function formatINRCompact(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n}`
}

export { formatDate, formatRelativeTime } from '@/lib/format'

// ─── Unified "Needs Attention" feed ──────────────────────────────────
// One actionable list assembled from the LIVE operational stores — the
// same items the Fee Management and Salary & Payroll overviews surface,
// deduplicated and ordered by severity (critical → warning → info).
// Consumed by the Finance shell (Overview tab badge) and the Overview's
// Needs Attention panel.

export interface FinanceAttentionItem {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  cta: string
  /** Where the CTA lands: an AppShell module key, the central finance
   * settings tab, or a finance dashboard tab. */
  module?: 'fees' | 'salary' | 'statements' | 'reports' | 'finance-settings'
}

export function useFinanceAttention(): FinanceAttentionItem[] {
  const feeData = useFeeData(CURRENT_ACADEMIC_YEAR)
  const salaryData = useSalaryData()
  // Payment infrastructure state (central Finance Settings) — the command
  // centre should surface configuration problems, not just balances.
  const paymentModes = useFeeStore((s) => s.paymentModes)
  const gatewayConfig = useFeeStore((s) => s.gatewayConfig)
  const upiQrConfigs = useFeeStore((s) => s.upiQrConfigs)
  const bankAccounts = useFeeStore((s) => s.bankAccounts)

  return useMemo(() => {
    const items: FinanceAttentionItem[] = []
    const { analytics } = feeData

    // 1 — Salary payments not recorded for the current month (money the
    //     school owes its staff; fixed monthly salary minus RECORDED
    //     payments — the canonical server ledger, PHASE 8B).
    const payrollBalance = salaryData.currentMonth.payable - salaryData.currentMonth.recorded
    const unpaidStaff = salaryData.currentMonth.unrecorded.length
    if (payrollBalance > 0) {
      items.push({
        id: 'payroll-unpaid',
        severity: 'critical',
        title: 'Payroll not recorded',
        description: `${formatINR(payrollBalance, true)} of ${salaryData.monthLabel} payroll not recorded · ${unpaidStaff} staff`,
        cta: 'Open Payroll',
        module: 'salary',
      })
    }

    // 4 — Online fee payments sitting under verification.
    if (analytics.pendingVerification > 0) {
      items.push({
        id: 'fee-verification',
        severity: 'warning',
        title: 'Fee payments to verify',
        description: `${analytics.pendingVerification} payment${analytics.pendingVerification > 1 ? 's' : ''} under verification — receipts finalize after this`,
        cta: 'Verify',
        module: 'fees',
      })
    }

    // 5 — Parent cash-deposit requests needing Principal acceptance.
    if (analytics.pendingCashRequests > 0) {
      items.push({
        id: 'fee-cash-requests',
        severity: 'warning',
        title: 'Cash requests need acceptance',
        description: `${analytics.pendingCashRequests} cash collection request${analytics.pendingCashRequests > 1 ? 's' : ''} waiting for your acceptance`,
        cta: 'Review',
        module: 'fees',
      })
    }

    // 6 — Overdue student accounts (collection worklist).
    if (analytics.overdueCount > 0) {
      items.push({
        id: 'fee-overdue',
        severity: 'warning',
        title: 'Overdue student accounts',
        description: `${analytics.overdueCount} account${analytics.overdueCount > 1 ? 's' : ''} past due · ${formatINR(analytics.totalOutstanding, true)} outstanding overall`,
        cta: 'Open Accounts',
        module: 'fees',
      })
    }

    // 7 — Class fee plans not yet published for the active session.
    const total = feeData.feeStructures.length
    const published = feeData.feeStructures.filter((st) =>
      feeData.versions.some((v) => v.structureId === st.id && v.status === 'current'),
    ).length
    if (total > 0 && published < total) {
      items.push({
        id: 'fee-plans',
        severity: 'info',
        title: 'Fee plans not published',
        description: `${total - published} of ${total} classes not configured for ${CURRENT_ACADEMIC_YEAR}`,
        cta: 'Open Fee Structures',
        module: 'fees',
      })
    }

    // 8 — Additional collections drafted but never published — work stuck
    //     BEFORE it can collect money (APPS-IA-1 drafts are invisible to
    //     students until published; the Principal is the only one who can
    //     unblock them).
    const draftCharges = feeData.additionalCharges.filter((c) => c.status === 'Draft')
    if (draftCharges.length > 0) {
      items.push({
        id: 'collection-drafts',
        severity: 'info',
        title: 'Draft collections not published',
        description: `${draftCharges.length} draft collection${draftCharges.length > 1 ? 's' : ''} waiting — students can\u2019t pay until published`,
        cta: 'Open Collections',
        module: 'fees',
      })
    }

    // 9 — Reserves below the 3-month operating target.
    const cashAvailable = balanceSheet.find((b) => b.account === 'Cash & Bank Balance')?.amount ?? 0
    const monthlyOperatingExpense = financeStats.monthlyRevenue.reduce((s, m) => s + m.expense, 0) / 12
    const reserveCoverage = monthlyOperatingExpense > 0 ? Math.round((cashAvailable / monthlyOperatingExpense) * 10) / 10 : 0
    if (reserveCoverage < 3) {
      items.push({
        id: 'reserve-low',
        severity: 'info',
        title: 'Reserves below target',
        description: `${reserveCoverage} months of costs in bank — target is 3+ months`,
        cta: 'View Statements',
        module: 'statements',
      })
    }

    // 9-10 — PAYMENT INFRASTRUCTURE (central Finance Settings parity).
    // Availability mirrors the settings logic: UPI needs an active QR or a
    // connected gateway; Card/Net Banking need a gateway; Bank Transfer
    // needs an active bank account.
    const gatewayLive = !!gatewayConfig && (gatewayConfig.status === 'connected' || gatewayConfig.status === 'test_mode')

    if (gatewayConfig?.status === 'test_mode') {
      items.push({
        id: 'gateway-test-mode',
        severity: 'warning',
        title: 'Payment gateway in test mode',
        description: 'Card, net-banking and gateway UPI payments only run test transactions — switch to live before opening to parents.',
        cta: 'Open Settings',
        module: 'finance-settings',
      })
    }

    const unconfigured: string[] = []
    for (const m of paymentModes) {
      if (!m.active) continue
      if (m.id === 'Cash' || m.id === 'Cheque') continue
      if (m.id === 'Bank Transfer' && bankAccounts.some((b) => b.status === 'active')) continue
      if (m.id === 'UPI' && (upiQrConfigs.some((c) => c.status === 'active') || gatewayLive)) continue
      if ((m.id === 'Card' || m.id === 'Net Banking') && gatewayLive) continue
      unconfigured.push(m.label)
    }
    if (unconfigured.length > 0) {
      items.push({
        id: 'payments-unconfigured',
        severity: 'warning',
        title: 'Payment methods need configuration',
        description: `${unconfigured.join(', ')} enabled but not yet usable by parents — finish the setup in Finance Settings.`,
        cta: 'Open Settings',
        module: 'finance-settings',
      })
    }

    const order: Record<FinanceAttentionItem['severity'], number> = { critical: 0, warning: 1, info: 2 }
    return items.sort((a, b) => order[a.severity] - order[b.severity])
  }, [feeData, salaryData, paymentModes, gatewayConfig, upiQrConfigs, bankAccounts])
}
