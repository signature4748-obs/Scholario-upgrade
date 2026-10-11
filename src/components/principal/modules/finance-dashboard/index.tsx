'use client'

/**
 * FinanceDashboardModule — Principal's School Financial Control Center.
 *
 * Thin re-export of FinanceShell which orchestrates the tab workspace:
 *   Overview · Statements · Reports · Settings
 *
 * BATCH2-B5 — figures come from the server fee ledger (/api/dashboard,
 * /api/fees/*) plus the Salary & Payroll module's own payroll numbers;
 * every expense/asset/liability line honestly states it requires an
 * expense ledger. No fabricated statements remain.
 */

export { FinanceShell as FinanceDashboardModule } from './finance-shell'
