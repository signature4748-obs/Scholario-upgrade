'use client'

/**
 * use-fee-server-data — the SERVER-TRUTH data layer for the principal fee
 * screens (BATCH2-B5).
 *
 * The fee module's four principal screens (Overview / Transactions /
 * Approvals / Student Accounts) previously rendered numbers derived from
 * the client Zustand fee-store — a localStorage-persisted parallel ledger
 * whose amounts and balances were computed in the browser. This module is
 * the replacement data source: every figure flows from the canonical,
 * auth-gated, tenant-scoped API routes:
 *
 *   GET /api/fees                    — fee rows (+ payments + student) —
 *                                      per-student / per-class / per-head
 *                                      balances (amount/paid are numbers)
 *   GET /api/fees/transactions       — the FeeTransaction ledger
 *   GET /api/fees/verification       — verification queue + roster w/
 *                                      class labels + stats
 *   GET /api/dashboard               — school fee aggregates + monthly
 *                                      SUCCESS-payment trend
 *   GET /api/fees/defaulters[?summary=1] — server dues aggregation
 *   GET /api/fees/webhook            — webhook event audit (safe projection)
 *
 * House fetch pattern (same as fees-defaulters.tsx / verification-workspace.tsx):
 * the shared `api()` client unwraps the `{ ok, data }` JSON envelope, the
 * hook keeps an alive-guard, and `reload()` bumps a key to retry. Every
 * consumer renders loading / error+retry / empty / success states — never
 * a fabricated number.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type ApiError } from '@/lib/exams/api-client'
import type { PaymentMode } from '@/lib/store/fee-store'

// ─── payload types (mirror the API routes) ───────────────────────────

/** Payment mirror row embedded in GET /api/fees fee rows (amount as number). */
export interface ServerPaymentRow {
  id: string
  schoolId: string
  feeId: string | null
  amount: number
  method: string | null
  status: string
  transactionId: string | null
  note: string | null
  createdAt: string
}

/** Student projection embedded in GET /api/fees fee rows. */
export interface ServerFeeStudent {
  id: string
  userId: string
  classId: string | null
  rollNo: string | null
  admissionNo: string | null
  guardianName: string | null
  guardianPhone: string | null
  user: { name: string }
}

/** One Fee ledger row from GET /api/fees (money as numbers — Phase 8A). */
export interface ServerFeeRow {
  id: string
  schoolId: string
  studentId: string
  title: string
  amount: number
  paid: number
  type: string | null
  dueDate: string | null
  status: string
  method: string | null
  paidDate: string | null
  createdAt: string
  payments: ServerPaymentRow[]
  student: ServerFeeStudent
}

/** Settlement projection included in GET /api/fees/transactions rows. */
export interface ServerSettlementRef {
  id: string
  payoutId: string | null
  status: string
  periodStart: string
  periodEnd: string
}

/** One FeeTransaction row from GET /api/fees/transactions (amount number). */
export interface ServerFeeTxn {
  id: string
  schoolId: string
  studentId: string | null
  studentName: string | null
  className: string | null
  structureId: string | null
  feeHeadName: string | null
  amount: number
  method: string
  status: string
  source: string | null
  feeId: string | null
  collectedById: string | null
  collectedByName: string | null
  collectedAt: string | null
  verifiedById: string | null
  verifiedByName: string | null
  verifiedAt: string | null
  rejectedById: string | null
  rejectedByName: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  referenceNumber: string | null
  gatewayOrderId: string | null
  gatewayPaymentId: string | null
  gatewayName: string | null
  settlementId: string | null
  settlement: ServerSettlementRef | null
  reconciliationStatus: string
  receiptNo: string | null
  note: string | null
  createdAt: string
}

/** Verification queue DTO (toFeeTxnDto — the one DTO every surface renders). */
export interface VerificationTxn {
  id: string
  studentId: string | null
  studentName: string | null
  className: string | null
  feeId: string | null
  feeHeadName: string | null
  amount: number
  method: string
  status: string
  source: string | null
  referenceNumber: string | null
  note: string | null
  receiptNo: string | null
  collectedBy: string | null
  collectedAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

/** Roster entry powering class-label resolution (GET /api/fees/verification). */
export interface VerificationStudent {
  id: string
  name: string
  rollNo: string | null
  classLabel: string
  openFees: Array<{
    id: string
    title: string
    amount: number
    paid: number
    outstanding: number
    dueDate: string | null
  }>
}

export interface VerificationStats {
  pendingCount: number
  pendingAmount: number
  verifiedThisMonth: number
  verifiedCountThisMonth: number
  rejectedThisMonth: number
}

export interface VerificationPayload {
  pending: VerificationTxn[]
  recent: VerificationTxn[]
  stats: VerificationStats
  students: VerificationStudent[]
}

/** GET /api/dashboard — school-scope aggregates (principal/management). */
export interface SchoolDashboardPayload {
  scope: 'SCHOOL'
  stats: {
    students: number
    teachers: number
    feesTotal: number
    feesPaid: number
    overdue: number
    attendanceRate: number
  }
  trend: Array<{ month: string; amount: number }>
}

/** GET /api/fees/webhook — safe projection (no rawPayload / signature). */
export interface WebhookEventRow {
  id: string
  schoolId: string
  eventId: string
  eventType: string
  gatewayName: string
  status: string
  matchedTransactionId: string | null
  error: string | null
  receivedAt: string
  processedAt: string | null
}

// ─── the fetch hook ──────────────────────────────────────────────────

export interface ServerResource<T> {
  data: T | null
  error: string | null
  /** true only before the FIRST successful/failed response lands. */
  loading: boolean
  /** bump to re-fetch (retry button / post-action refresh). */
  reload: () => void
}

/**
 * useServerResource — one URL, the house fetch pattern. `url === null`
 * skips the fetch entirely (used for on-demand per-student fetches).
 */
export function useServerResource<T>(url: string | null): ServerResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (url === null) return
    let alive = true
    setData(null)
    setError(null)
    ;(async () => {
      try {
        const payload = await api<T>(url, { cache: 'no-store' })
        if (!alive) return
        setData(payload)
      } catch (e) {
        if (!alive) return
        const msg = e && typeof e === 'object' && 'message' in e
          ? (e as ApiError).message
          : 'Could not load data from the server.'
        setError(msg)
      }
    })()
    return () => { alive = false }
  }, [url, reloadKey])

  return { data, error, loading: data === null && error === null, reload }
}

// ─── shared derivation helpers (server rows → display vocabulary) ────

/** Server method ('CASH', 'NET_BANKING'…) → the module's display mode. */
export function serverMethodToMode(method: string | null | undefined): PaymentMode {
  switch ((method ?? '').toUpperCase().replace(' ', '_')) {
    case 'UPI': return 'UPI'
    case 'CARD': return 'Card'
    case 'NET_BANKING': return 'Net Banking'
    case 'CASH': return 'Cash'
    case 'CHEQUE': return 'Cheque'
    case 'BANK_TRANSFER': return 'Bank Transfer'
    default: return 'Cash'
  }
}

/** FeeTransaction status → the display status the module's badges speak. */
export function txnStatusToDisplay(status: string): string {
  switch (status) {
    case 'SUCCESS': return 'Success'
    case 'UNDER_VERIFICATION': return 'Under Verification'
    case 'REJECTED': return 'Rejected'
    case 'PENDING': return 'Pending'
    case 'FAILED': return 'Failed'
    default: return status === 'REFUNDED' ? 'Refunded' : status
  }
}

/** Fee row status → the display status the account grid speaks. */
export function feeStatusToDisplay(status: string): string {
  switch (status) {
    case 'PAID': return 'Paid'
    case 'PARTIAL': return 'Partially Paid'
    case 'OVERDUE': return 'Overdue'
    case 'UNPAID': return 'Due'
    default: return status
  }
}

/** Outstanding of one fee line (server money — plain arithmetic). */
export function feeOutstanding(f: { amount: number; paid: number }): number {
  return Math.max(0, Math.round((f.amount - f.paid) * 100) / 100)
}

/** Honest days-overdue (null when not past due / no due date). */
export function daysOverdueOf(dueDate: string | null): number | null {
  if (!dueDate) return null
  const ms = Date.now() - new Date(dueDate).getTime()
  if (Number.isNaN(ms) || ms <= 0) return null
  return Math.floor(ms / 86_400_000)
}

/** Account status across a student's fee lines (worst-case semantics):
 *  any overdue line (server-maintained status, or a past due date with a
 *  remaining balance) makes the account Overdue. */
export type AccountStatus = 'Paid' | 'Partially Paid' | 'Due' | 'Overdue'

export function accountStatusOf(
  lines: Array<{ status: string; amount: number; paid: number; dueDate?: string | null }>,
): AccountStatus {
  const outstanding = lines.reduce((s, l) => s + feeOutstanding(l), 0)
  if (outstanding <= 0) return 'Paid'
  const anyOverdue = lines.some(
    (l) => feeOutstanding(l) > 0 && (l.status === 'OVERDUE' || daysOverdueOf(l.dueDate ?? null) !== null),
  )
  if (anyOverdue) return 'Overdue'
  const paidSomething = lines.some((l) => l.paid > 0)
  return paidSomething ? 'Partially Paid' : 'Due'
}

/**
 * Receipt txn id resolvable from a Payment mirror row — the canonical
 * ledger writes Payment.transactionId as either the FeeTransaction id
 * (gateway / verification flows) or `manual:{FeeTransaction.id}` (office
 * flows). Returns null for legacy rows with no transaction reference.
 */
export function receiptTxnIdOf(p: { transactionId: string | null }): string | null {
  if (!p.transactionId) return null
  return p.transactionId.startsWith('manual:') ? p.transactionId.slice('manual:'.length) : p.transactionId
}

/** studentId → class display label (from the verification roster). */
export function classLabelMapOf(students: VerificationStudent[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const s of students) map.set(s.id, s.classLabel)
  return map
}

/** 'YYYY-MM' (dashboard trend month key) → short month label ('Jul'). */
export function monthKeyToLabel(key: string): string {
  const d = new Date(`${key}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return key
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

// ─── per-student account derivation (GET /api/fees rows) ─────────────

export interface DerivedFeeLine {
  id: string
  title: string
  type: string | null
  amount: number
  paid: number
  outstanding: number
  dueDate: string | null
  status: string
  payments: ServerPaymentRow[]
  createdAt: string
}

export interface DerivedFeeAccount {
  studentId: string
  studentName: string
  admissionNo: string | null
  rollNo: string | null
  className: string
  guardianName: string | null
  guardianPhone: string | null
  billed: number
  paid: number
  outstanding: number
  status: AccountStatus
  feeLines: DerivedFeeLine[]
  paymentCount: number
  oldestDueAt: string | null
  daysOverdue: number | null
  lastPaymentAt: string | null
}

/**
 * Group the server's fee rows into per-student accounts. Every figure is
 * server-sourced: billed = Σ Fee.amount, paid = Σ Fee.paid, outstanding
 * = Σ (amount − paid). Class labels resolve through the verification
 * roster (the same Class.name the server composes); unknown students fall
 * back to 'Unassigned'.
 */
export function deriveAccounts(
  feeRows: ServerFeeRow[],
  classLabels: Map<string, string>,
): DerivedFeeAccount[] {
  const byStudent = new Map<string, { rows: ServerFeeRow[]; student: ServerFeeStudent }>()
  for (const f of feeRows) {
    const entry = byStudent.get(f.studentId)
    if (entry) entry.rows.push(f)
    else byStudent.set(f.studentId, { rows: [f], student: f.student })
  }

  const accounts: DerivedFeeAccount[] = []
  for (const [studentId, { rows, student }] of byStudent) {
    const feeLines: DerivedFeeLine[] = rows.map((f) => ({
      id: f.id,
      title: f.title,
      type: f.type,
      amount: f.amount,
      paid: f.paid,
      outstanding: feeOutstanding(f),
      dueDate: f.dueDate,
      status: f.status,
      payments: f.payments,
      createdAt: f.createdAt,
    }))
    const billed = rows.reduce((s, f) => s + f.amount, 0)
    const paid = rows.reduce((s, f) => s + f.paid, 0)
    let oldestDueAt: string | null = null
    for (const f of rows) {
      if (f.dueDate && feeOutstanding(f) > 0 && (!oldestDueAt || f.dueDate < oldestDueAt)) {
        oldestDueAt = f.dueDate
      }
    }
    const paymentDates = rows.flatMap((f) => f.payments.map((p) => p.createdAt)).sort()
    accounts.push({
      studentId,
      studentName: student.user?.name ?? 'Unknown student',
      admissionNo: student.admissionNo,
      rollNo: student.rollNo,
      className: classLabels.get(studentId) ?? 'Unassigned',
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      billed,
      paid,
      outstanding: Math.max(0, Math.round((billed - paid) * 100) / 100),
      status: accountStatusOf(rows),
      feeLines,
      paymentCount: rows.reduce((s, f) => s + f.payments.length, 0),
      oldestDueAt,
      daysOverdue: daysOverdueOf(oldestDueAt),
      lastPaymentAt: paymentDates.length > 0 ? paymentDates[paymentDates.length - 1] : null,
    })
  }
  return accounts.sort((a, b) => b.outstanding - a.outstanding)
}

// ─── class-wise aggregation (over the derived accounts) ──────────────

export interface DerivedClassRow {
  classLabel: string
  students: number
  expected: number
  collected: number
  outstanding: number
  collectionRate: number
}

export function deriveClassWise(accounts: DerivedFeeAccount[]): DerivedClassRow[] {
  const byClass = new Map<string, DerivedClassRow>()
  for (const a of accounts) {
    const row = byClass.get(a.className) ?? {
      classLabel: a.className, students: 0, expected: 0, collected: 0, outstanding: 0, collectionRate: 0,
    }
    row.students += 1
    row.expected += a.billed
    row.collected += a.paid
    row.outstanding += a.outstanding
    byClass.set(a.className, row)
  }
  const rows = [...byClass.values()]
  for (const r of rows) {
    r.collectionRate = r.expected > 0 ? Math.round((r.collected / r.expected) * 1000) / 10 : 0
  }
  // Largest outstanding balance at top — the collection worklist order.
  return rows.sort((a, b) => b.outstanding - a.outstanding || b.expected - a.expected)
}
