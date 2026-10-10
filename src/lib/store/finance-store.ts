/**
 * Finance store — the Finance Dashboard's operational attention feed.
 *
 * BATCH2-B5 — the fabricated finance aggregates are RETIRED: the old
 * useFinanceData() assembled P&L / balance-sheet / cash-flow numbers from
 * src/lib/mock/finance-dashboard.ts (₹98.6M tuition etc.) mixed with
 * client-store figures — a production principal was shown invented
 * currency figures. The Statements / Reports / Overview sections now
 * render SERVER truth (/api/dashboard, /api/fees/*) with honest
 * "requires expense ledger — not available" lines for everything the
 * platform has no ledger model for (see those components). The FY period
 * selector went with it: server aggregates are "as recorded", not
 * sliceable demo periods.
 *
 * What remains here is the "Needs Attention" feed — operational counts
 * and action items from the fee/salary/payment-config stores. No
 * fabricated currency figures (the mock-derived reserves item was
 * removed with the books).
 */

import { useMemo } from 'react'
import { useFeeData, useFeeStore, CURRENT_ACADEMIC_YEAR } from './fee-store'
import { useSalaryData } from './salary-store'
// BATCH2-B5 — currency figures in the feed quote the SERVER dues
// aggregation (GET /api/fees/defaulters?summary=1), never client-computed
// ledger numbers.
import { useDuesSummaryStore, selectLiveDues } from './dues-summary-store'
import { formatINR } from '@/lib/format'

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
  // Server dues position (live when a consumer has synced it — the
  // Finance Overview ensures it on mount). Quoted instead of the
  // client-store ledger totals.
  const dues = useDuesSummaryStore(selectLiveDues)
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

    // 6 — Overdue student accounts (collection worklist). The ₹ figure
    //     quotes the SERVER dues aggregation when synced; counts stay
    //     operational (no currency figure is invented client-side).
    if (analytics.overdueCount > 0) {
      items.push({
        id: 'fee-overdue',
        severity: 'warning',
        title: 'Overdue student accounts',
        description: `${analytics.overdueCount} account${analytics.overdueCount > 1 ? 's' : ''} past due${dues ? ` · ${formatINR(dues.totalOutstanding, true)} outstanding overall` : ''}`,
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
  }, [feeData, salaryData, dues, paymentModes, gatewayConfig, upiQrConfigs, bankAccounts])
}
