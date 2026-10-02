'use client'

/**
 * Salary store — SERVER-SYNCED client cache for the canonical payroll
 * (Phase 8B, Task 8B-7-c).
 *
 * PostgreSQL is the single source of truth. The old localStorage ledger
 * (zustand persist, key 'scholario-salary-v4' + tenant-scoped variants)
 * is RETIRED: nothing is persisted client-side any more — the store is a
 * per-session cache hydrated once from GET /api/salary, and every mutation
 * calls the API and then folds the server's canonical response back into
 * the cache (the teachers-store server-sync pattern).
 *
 * BUSINESS MODEL (strict, school's chosen workflow):
 *   · FIXED MONTHLY salary only — one SalaryStructure row per teacher
 *     (monthlyAmount + optional effectiveFrom/note).
 *   · NO HRA, NO PF, NO tax, NO deductions, NO gross/basic/net arithmetic.
 *     No field for any of those exists in this store.
 *   · The principal configures the monthly salary and records payments;
 *     the teacher sees the SAME canonical rows (their own only).
 *   · Payment status: RECORDED | VOIDED. Totals are sums of RECORDED
 *     amounts — never recomputed payroll math.
 *
 * Honest states: syncStatus 'syncing' | 'synced' | 'error' — a failed
 * fetch keeps the current cache and flags the error so surfaces can offer
 * a retry; mutations throw the server's safe error message (including
 * SALARY_PAYMENT_DUPLICATE with the existing row) so dialogs can surface
 * them. Nothing is ever fabricated while loading.
 */

import { create } from 'zustand'
import { useMemo } from 'react'

// ─── Types ───────────────────────────────────────────────────────────

/** Canonical payment method keys (server enum). */
export type SalaryMethod = 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'OTHER'

/** Display labels for the method keys (UI order). */
export const METHOD_KEYS: SalaryMethod[] = ['BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE', 'OTHER']
export const METHOD_LABELS: Record<SalaryMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
}

/** RECORDED | VOIDED — the canonical payment lifecycle. */
export type PaymentStatus = 'RECORDED' | 'VOIDED'

/** A roster teacher as the salary module sees them (server truth). */
export interface SalaryTeacher {
  id: string
  name: string
  employeeId: string
  department: string
}

/** One teacher's fixed monthly salary (server truth). */
export interface SalaryStructure {
  id: string
  teacherId: string
  monthlyAmount: number
  /** ISO date or null (informational provenance). */
  effectiveFrom: string | null
  note: string | null
  updatedAt: string
}

/** One canonical monthly payment (server truth). */
export interface SalaryPayment {
  id: string
  teacherId: string
  /** 'YYYY-MM' salary month. */
  month: string
  amount: number
  /** ISO datetime the payment was made. */
  paidOn: string
  method: SalaryMethod | null
  reference: string | null
  note: string | null
  status: PaymentStatus
  createdAt: string
  updatedAt: string
}

export interface SetStructureInput {
  teacherId: string
  monthlyAmount: number
  effectiveFrom?: string
  note?: string
}

export interface RecordPaymentInput {
  teacherId: string
  /** 'YYYY-MM' */
  month: string
  amount: number
  paidOn?: string
  method?: SalaryMethod
  reference?: string
  note?: string
}

/** Enriched API error — carries the typed duplicate payload when 409. */
export interface ExistingPaymentInfo extends SalaryPayment {
  teacher?: { id: string; user: { name: string } }
}

export class SalaryApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly existing?: ExistingPaymentInfo | null
  constructor(message: string, status: number, code?: string, existing?: ExistingPaymentInfo | null) {
    super(message)
    this.name = 'SalaryApiError'
    this.status = status
    this.code = code
    this.existing = existing
  }
}

// ─── Server DTOs (mirror src/app/api/salary/serialize.ts) ───────────

interface StructureDto extends SalaryStructure {
  teacher: { id: string; employeeId: string | null; department: string | null; user: { name: string; email?: string | null } }
}

interface PaymentDto extends SalaryPayment {
  teacher: { id: string; employeeId: string | null; user: { name: string } }
}

interface SalaryBootstrap {
  role: 'PRINCIPAL' | 'MANAGEMENT' | 'TEACHER'
  teachers?: Array<{ id: string; name: string; employeeId: string; department: string }>
  structures?: StructureDto[]
  payments?: PaymentDto[]
  /** TEACHER view only — the signed-in teacher's own identity. */
  me?: SalaryTeacher | null
  structure?: StructureDto | null
}

// ─── Period helpers (the honest 'YYYY-MM' universe) ──────────────────

export function currentPeriodKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return periodKey
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

/** The last `count` monthly keys ending at the current month. */
export function periodOptions(count = 6, now = new Date()): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(currentPeriodKey(d))
  }
  return out
}

// ─── Academic session mapping (Indian academic year: April – March) ──

/** Maps a 'YYYY-MM' period key to its academic session id ('2026-27'). */
export function sessionOfPeriod(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return CURRENT_SESSION.id
  const start = m >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** '2026-27' → '2026–27' (en dash, display label). */
export function sessionLabelOf(sessionId: string): string {
  return sessionId.replace('-', '–')
}

export const CURRENT_SESSION = { id: '2026-27', label: 'Session 2026–27' }

// ─── Derived read helpers (single calculation path) ──────────────────

/** The teacher's configured monthly salary (0 when not configured). */
export function monthlyAmountFor(structures: SalaryStructure[], teacherId: string): number {
  return structures.find((s) => s.teacherId === teacherId)?.monthlyAmount ?? 0
}

/** Sum of RECORDED amounts for one teacher-month (what was actually paid). */
export function recordedPaidFor(payments: SalaryPayment[], teacherId: string, month: string): number {
  return payments
    .filter((p) => p.teacherId === teacherId && p.month === month && p.status === 'RECORDED')
    .reduce((s, p) => s + p.amount, 0)
}

/** Payslip state for a teacher-month: Unpaid · Recorded · Paid (alias). */
export function monthPaymentState(
  payments: SalaryPayment[],
  teacherId: string,
  month: string,
): 'Unpaid' | 'Recorded' {
  const forMonth = payments.filter((p) => p.teacherId === teacherId && p.month === month)
  return forMonth.some((p) => p.status === 'RECORDED') ? 'Recorded' : 'Unpaid'
}

/** Payment events derived from canonical rows — the honest audit trail:
 *  a row's creation is its "recorded" event; a VOIDED row's last update
 *  is its "voided" event. Nothing else is invented. */
export interface SalaryEvent {
  id: string
  kind: 'payment.recorded' | 'payment.voided'
  teacherId: string
  teacherName: string
  month: string
  amount: number
  at: string
}

export function salaryEventsOf(
  payments: SalaryPayment[],
  teacherNames: Record<string, string>,
): SalaryEvent[] {
  const events: SalaryEvent[] = []
  for (const p of payments) {
    const name = teacherNames[p.teacherId] ?? 'Unnamed teacher'
    events.push({
      id: `${p.id}:recorded`,
      kind: 'payment.recorded',
      teacherId: p.teacherId,
      teacherName: name,
      month: p.month,
      amount: p.amount,
      at: p.createdAt,
    })
    if (p.status === 'VOIDED') {
      events.push({
        id: `${p.id}:voided`,
        kind: 'payment.voided',
        teacherId: p.teacherId,
        teacherName: name,
        month: p.month,
        amount: p.amount,
        at: p.updatedAt,
      })
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at))
}

// ─── API transport (session-cookie auth; same-origin) ────────────────

async function salaryApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string; code?: string; existing?: PaymentDto | null }
    | null
  if (!res.ok || !body || body.ok !== true) {
    throw new SalaryApiError(
      body?.error ?? `Request failed (${res.status})`,
      res.status,
      body?.code,
      body?.existing ?? null,
    )
  }
  return body.data as T
}

// ─── Legacy localStorage cleanup ─────────────────────────────────────

/** One-time removal of the retired localStorage payroll ledger (the
 *  persist key 'scholario-salary-v4' and every tenant-scoped variant).
 *  The server is the only source of truth now — stale browser rows must
 *  never reappear. */
function purgeLegacySalaryStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const stale: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && (key === 'scholario-salary-v4' || key.startsWith('scholario-salary-v4::'))) {
        stale.push(key)
      }
    }
    for (const key of stale) window.localStorage.removeItem(key)
  } catch {
    // Storage disabled (Safari private mode) — nothing to purge.
  }
}

// ─── Store ───────────────────────────────────────────────────────────

interface SalaryState {
  /** Session role driving the view shape (null until first sync). */
  role: 'PRINCIPAL' | 'MANAGEMENT' | 'TEACHER' | null
  /** Teacher-view only: the signed-in teacher's own identity. */
  me: SalaryTeacher | null
  /** School roster (principal/management view; empty for teachers). */
  teachers: SalaryTeacher[]
  structures: SalaryStructure[]
  payments: SalaryPayment[]
  /** Teacher names by teacherId (from the canonical rows themselves). */
  teacherNames: Record<string, string>
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error'
  error: string | null
  lastSyncedAt: string | null

  /** Hydrate once per session (module-level guard; force to re-run). */
  hydrate: (opts?: { force?: boolean }) => Promise<boolean>
  setStructure: (input: SetStructureInput) => Promise<SalaryStructure>
  recordPayment: (input: RecordPaymentInput) => Promise<SalaryPayment>
  voidPayment: (paymentId: string) => Promise<SalaryPayment>
}

function applyBootstrap(boot: SalaryBootstrap) {
  const payments = (boot.payments ?? []).map((p) => stripPayment(p))
  const teacherNames: Record<string, string> = {}
  for (const t of boot.teachers ?? []) teacherNames[t.id] = t.name
  // Names come from the RAW dtos (they carry teacher.user.name); the
  // stripped cache rows keep only ids.
  for (const p of boot.payments ?? []) teacherNames[p.teacherId] = teacherNames[p.teacherId] ?? pDtoName(p)
  return {
    role: boot.role,
    me: boot.me ?? null,
    teachers: boot.teachers ?? [],
    structures: boot.role === 'TEACHER'
      ? boot.structure ? [stripStructure(boot.structure)] : []
      : (boot.structures ?? []).map((s) => stripStructure(s)),
    payments,
    teacherNames,
    syncStatus: 'synced' as const,
    error: null,
    lastSyncedAt: new Date().toISOString(),
  }
}

function pDtoName(p: PaymentDto): string {
  return p.teacher?.user?.name ?? 'Unnamed teacher'
}

function stripPayment(p: PaymentDto): SalaryPayment {
  return {
    id: p.id,
    teacherId: p.teacherId,
    month: p.month,
    amount: p.amount,
    paidOn: p.paidOn,
    method: (p.method as SalaryMethod | null) ?? null,
    reference: p.reference,
    note: p.note,
    status: p.status === 'VOIDED' ? 'VOIDED' : 'RECORDED',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

function stripStructure(s: StructureDto): SalaryStructure {
  return {
    id: s.id,
    teacherId: s.teacherId,
    monthlyAmount: s.monthlyAmount,
    effectiveFrom: s.effectiveFrom,
    note: s.note,
    updatedAt: s.updatedAt,
  }
}

let hydratePromise: Promise<boolean> | null = null

// NOTE (8B-7-d lint gate): the `get` param is intentionally unused in
// this store's actions — underscore-prefixed to satisfy the unused-args
// rule without changing any behavior.
export const useSalaryStore = create<SalaryState>()((set, _get) => ({
  role: null,
  me: null,
  teachers: [],
  structures: [],
  payments: [],
  teacherNames: {},
  syncStatus: 'idle',
  error: null,
  lastSyncedAt: null,

  hydrate: (opts) => {
    if (typeof window !== 'undefined') purgeLegacySalaryStorage()
    if (hydratePromise && !opts?.force) return hydratePromise
    hydratePromise = (async () => {
      set({ syncStatus: 'syncing' })
      try {
        const boot = await salaryApi<SalaryBootstrap>('/api/salary')
        set(applyBootstrap(boot))
        return true
      } catch (e) {
        // Keep whatever the cache has — never fabricate. Honest error flag.
        set({ syncStatus: 'error', error: e instanceof Error ? e.message : 'Salary sync failed' })
        return false
      }
    })()
    return hydratePromise
  },

  setStructure: async (input) => {
    const dto = await salaryApi<StructureDto>('/api/salary/structure', {
      method: 'PUT',
      body: JSON.stringify({
        teacherId: input.teacherId,
        monthlyAmount: input.monthlyAmount,
        effectiveFrom: input.effectiveFrom || undefined,
        note: input.note || undefined,
      }),
    })
    const row = stripStructure(dto)
    set((st) => ({
      structures: [row, ...st.structures.filter((s) => s.teacherId !== row.teacherId)],
      teacherNames: { ...st.teacherNames, [row.teacherId]: dto.teacher?.user?.name ?? st.teacherNames[row.teacherId] ?? 'Unnamed teacher' },
    }))
    return row
  },

  recordPayment: async (input) => {
    const dto = await salaryApi<PaymentDto>('/api/salary/payments', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: input.teacherId,
        month: input.month,
        amount: input.amount,
        paidOn: input.paidOn || undefined,
        method: input.method || undefined,
        reference: input.reference || undefined,
        note: input.note || undefined,
      }),
    })
    const row = stripPayment(dto)
    set((st) => ({
      payments: [row, ...st.payments.filter((p) => p.id !== row.id)],
      teacherNames: { ...st.teacherNames, [row.teacherId]: pDtoName(dto) },
    }))
    return row
  },

  voidPayment: async (paymentId) => {
    const dto = await salaryApi<PaymentDto>(`/api/salary/payments/${encodeURIComponent(paymentId)}/void`, {
      method: 'POST',
    })
    const row = stripPayment(dto)
    set((st) => ({
      payments: st.payments.map((p) => (p.id === row.id ? row : p)),
    }))
    return row
  },
}))

/** Reset the once-per-session hydration guard (explicit retry / tests). */
export function resetSalarySyncGuard(): void {
  hydratePromise = null
}

// ─── Hook: aggregated read model (principal/management view) ─────────

export function useSalaryData() {
  const role = useSalaryStore((s) => s.role)
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)
  const syncStatus = useSalaryStore((s) => s.syncStatus)

  return useMemo(() => {
    const periodKey = currentPeriodKey()
    const monthLabel = periodLabel(periodKey)

    // Per-teacher row: configured monthly salary + what is RECORDED this
    // month. No payable arithmetic beyond the sum of recorded amounts.
    const rows = teachers.map((t) => {
      const structure = structures.find((s) => s.teacherId === t.id) ?? null
      const monthly = structure?.monthlyAmount ?? 0
      const recorded = payments.filter(
        (p) => p.teacherId === t.id && p.month === periodKey && p.status === 'RECORDED',
      )
      const recordedTotal = recorded.reduce((s, p) => s + p.amount, 0)
      const state: 'Unpaid' | 'Recorded' = recorded.length > 0 ? 'Recorded' : 'Unpaid'
      return {
        teacher: t,
        structure,
        monthly,
        recordedTotal,
        recordedCount: recorded.length,
        state,
      }
    })

    const monthPayments = payments.filter((p) => p.month === periodKey)
    const recorded = monthPayments.filter((p) => p.status === 'RECORDED')
    const voided = monthPayments.filter((p) => p.status === 'VOIDED')

    const methodSplit = METHOD_KEYS.map((m) => ({
      method: m,
      count: recorded.filter((p) => p.method === m).length,
      amount: recorded.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0),
    })).filter((m) => m.count > 0)

    const deptMap = new Map<string, { staff: number; monthly: number; recorded: number }>()
    for (const r of rows) {
      const dept = r.teacher.department || 'Unassigned'
      const cur = deptMap.get(dept) ?? { staff: 0, monthly: 0, recorded: 0 }
      deptMap.set(dept, {
        staff: cur.staff + 1,
        monthly: cur.monthly + r.monthly,
        recorded: cur.recorded + r.recordedTotal,
      })
    }

    const withSalary = rows.filter((r) => r.monthly > 0)
    return {
      role,
      syncStatus,
      teachers,
      structures,
      payments,
      rows,
      periodKey,
      monthLabel,
      currentMonth: {
        /** Payroll commitment: sum of configured monthly salaries. */
        payable: withSalary.reduce((s, r) => s + r.monthly, 0),
        /** Sum of RECORDED amounts this month. */
        recorded: recorded.reduce((s, p) => s + p.amount, 0),
        recordedCount: recorded.length,
        voidedCount: voided.length,
        voidedTotal: voided.reduce((s, p) => s + p.amount, 0),
        /** Teachers with a salary configured but nothing recorded yet. */
        unrecorded: withSalary.filter((r) => r.state === 'Unpaid'),
      },
      methodSplit,
      departmentTotals: Array.from(deptMap.entries())
        .map(([dept, v]) => ({ dept, ...v }))
        .sort((a, b) => b.monthly - a.monthly),
      analytics: {
        monthlyPayroll: withSalary.reduce((s, r) => s + r.monthly, 0),
        configuredCount: withSalary.length,
        staffCount: teachers.length,
        paymentsCount: payments.length,
      },
    }
  }, [role, teachers, structures, payments, syncStatus])
}

// ─── Hook: payroll sessions that actually exist (canonical months) ───

export interface PayrollSessionInfo {
  sessionId: string
  label: string
  isCurrent: boolean
  paymentsCount: number
  /** Sum of RECORDED amounts in the session. */
  recordedTotal: number
  /** Distinct teachers with at least one payment row in the session. */
  employeesCount: number
}

/** Sessions derived from REAL payment months — the current session is
 *  always listed first; a session with no rows never appears. */
export function usePayrollSessions(): PayrollSessionInfo[] {
  const payments = useSalaryStore((s) => s.payments)

  return useMemo(() => {
    const ids = new Set<string>([CURRENT_SESSION.id])
    for (const p of payments) ids.add(sessionOfPeriod(p.month))
    return Array.from(ids)
      .sort((x, y) => {
        if (x === CURRENT_SESSION.id) return -1
        if (y === CURRENT_SESSION.id) return 1
        return y.localeCompare(x)
      })
      .map((sessionId) => {
        const inSession = payments.filter((p) => sessionOfPeriod(p.month) === sessionId)
        const recorded = inSession.filter((p) => p.status === 'RECORDED')
        return {
          sessionId,
          label: sessionLabelOf(sessionId),
          isCurrent: sessionId === CURRENT_SESSION.id,
          paymentsCount: inSession.length,
          recordedTotal: recorded.reduce((s, p) => s + p.amount, 0),
          employeesCount: new Set(inSession.map((p) => p.teacherId)).size,
        }
      })
  }, [payments])
}

export { formatINR, formatDate } from '@/lib/format'
