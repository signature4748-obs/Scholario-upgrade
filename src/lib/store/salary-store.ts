'use client'

/**
 * Salary & Payroll store — Principal's payroll workspace + employee trust model.
 *
 * Employees come from the canonical teacher records + administrative staff.
 * Every rupee flows through one monthly pipeline:
 *
 *   Session Salary (locked net base)
 *     + monthly adjustments
 *     = Net Payable for the month
 *     → Principal records payment(s)
 *     → 🕐 Pending Receipt
 *     → employee confirms ✓ Received (receipt issued, counts as paid)
 *       or reports × Not Received (no receipt, principal notified)
 *
 * Salary changes are never applied directly: the Principal sends a change
 * request while the temporary editing window is open, and the employee
 * accepts or declines it. The editing window expiry is persisted and
 * enforced inside every mutation — an expired window always fails, even
 * if a stale screen is still open.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
// PHASE 7 (Task 7-a) — the fabricated staff universe is RETIRED. The
// employee roster derives from the hydrated teachers-store (server
// truth: GET /api/teachers); payments/adjustments/receipts/audit start
// EMPTY and only ever contain real actions recorded in this store.
import { useTeachersStore, type TeacherRecord } from '@/lib/store/teachers-store'
import { useAuth } from '@/lib/store/auth-store'
// SaaS-STAGE-2A — tenant-scoped persistence (per-school payroll dataset).
import { migrateLegacyScopedStore, createTenantScopedStorage, TENANT_SCOPED_BASES } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

// ─── Types ───────────────────────────────────────────────────────────

export type EmployeeStatus = 'Active' | 'On Leave' | 'Suspended' | 'Resigned' | 'Retired' | 'Inactive'
export type EmployeeType = 'Teaching' | 'Administration' | 'Support' | 'Transport' | 'Finance' | 'Other'
export type PaymentMethod = 'Bank Transfer' | 'UPI' | 'Cash' | 'Cheque'
export type PaymentStatus = 'Pending Receipt' | 'Confirmed' | 'Not Received' | 'Reversed'
export type ChangeRequestStatus = 'Pending' | 'Accepted' | 'Declined'
export type StructureStatus = 'Active' | 'Archived'

export interface Employee {
  id: string
  employeeId: string
  name: string
  avatar: string
  designation: string
  department: string
  employeeType: EmployeeType
  email: string
  phone: string
  joiningDate: string
  status: EmployeeStatus
  salary: number
  attendance: number
  bloodGroup: string
  address: string
  /** 'Other' = not recorded in the school records (never guessed). */
  gender: 'Male' | 'Female' | 'Other'
  bankAccount?: string
  bankIfsc?: string
}

/** A component line inside a reusable structure template. */
export interface StructureComponent {
  id: string
  name: string
  type: 'Earning' | 'Deduction'
  basis: 'Fixed' | 'Percentage'
  /** ₹ when Fixed, % of base when Percentage. */
  value: number
}

/** How a salary structure pays an employee.
 *
 *   'simple'   — ONE fixed monthly salary (the default school workflow:
 *                "Monthly Salary ₹25,000"). No gross/deductions/net
 *                breakdown is computed or displayed.
 *   'detailed' — the Principal has EXPLICITLY configured salary
 *                components (Basic / HRA / PF / Tax …); only the
 *                configured components are ever shown.
 *
 * Absence of the field (legacy persisted data) is treated as 'detailed'
 * to preserve records created before this distinction existed. */
export type SalaryStructureMode = 'simple' | 'detailed'

export interface SalaryStructureTemplate {
  id: string
  name: string
  description: string
  applicableTo: EmployeeType | 'All'
  /** SIMPLE mode: the monthly salary itself. DETAILED mode: the Basic Pay
   *  base the percentage/fixed components resolve against. */
  baseAmount: number
  mode: SalaryStructureMode
  components: StructureComponent[]
  status: StructureStatus
  createdAt: string
}

/** A component line with a resolved ₹ amount (employee's applied salary). */
export interface AppliedComponent {
  name: string
  type: 'Earning' | 'Deduction'
  amount: number
}

export interface SessionSalary {
  structureId: string
  structureName: string
  /** 'simple' → a single Monthly Salary; 'detailed' → component lines. */
  mode: SalaryStructureMode
  base: number
  netBase: number
  earnings: AppliedComponent[]
  deductions: AppliedComponent[]
  effectiveFrom: string
}

export interface SalaryHistoryEntry {
  id: string
  date: string
  fromNet?: number
  toNet: number
  note?: string
  by: string
}

export interface EmployeeSalaryState {
  employeeId: string
  session: string
  salary: SessionSalary
  history: SalaryHistoryEntry[]
}

export interface SalaryChangeRequest {
  id: string
  employeeId: string
  employeeName: string
  currentNet: number
  proposedNet: number
  structureId?: string
  structureName?: string
  effectiveFrom: string
  note?: string
  status: ChangeRequestStatus
  requestedBy: string
  requestedAt: string
  respondedAt?: string
  respondedBy?: string
  declineReason?: string
}

export interface MonthlyAdjustment {
  id: string
  employeeId: string
  employeeName: string
  periodKey: string // '2026-08'
  label: string
  /** Signed: positive adds to the month's payable, negative reduces it. */
  amount: number
  createdAt: string
  createdBy: string
}

export interface SalaryPayment {
  id: string
  employeeId: string
  employeeName: string
  periodKey: string
  monthLabel: string
  netPayable: number
  amount: number
  date: string // YYYY-MM-DD
  method: PaymentMethod
  reference?: string
  bankAccount?: string
  status: PaymentStatus
  recordedBy: string
  recordedAt: string
  confirmedAt?: string
  confirmedBy?: string
  rejectedAt?: string
  rejectedBy?: string
  rejectionReason?: string
  /** Only exists once the employee confirms receipt. */
  receiptNo?: string
  reversedAt?: string
  reversalReason?: string
  followedUpAt?: string
}

export interface PaymentReceipt {
  receiptNo: string
  paymentId: string
  employeeId: string
  employeeName: string
  monthLabel: string
  amount: number
  method: PaymentMethod
  date: string
  confirmedAt: string
  reference?: string
}

// ─── Session payroll archive (frozen, read-only snapshots) ───────────

/** One employee's session totals, FROZEN at archive time — later salary
 *  changes can never rewrite these numbers. */
export interface ArchivedEmployeeRecord {
  employeeId: string
  employeeCode: string // EMP-… / T-…
  name: string
  designation: string
  department: string
  employmentStatus: EmployeeStatus
  /** Net monthly salary as it stood when the session was archived. */
  monthlySalary: number
  totalPayable: number
  totalPaid: number
  outstanding: number
  paymentsCount: number
}

/** A completed session's payroll, preserved exactly as it happened.
 *  Payments are frozen copies of the original records (which already
 *  snapshot netPayable at record time) — never recomputed. */
export interface SessionPayrollArchive {
  sessionId: string
  sessionLabel: string
  archivedAt: string
  archivedBy: string
  records: ArchivedEmployeeRecord[]
  payments: SalaryPayment[]
  summary: {
    employees: number
    totalPayroll: number
    totalPaid: number
    totalOutstanding: number
    paymentsCount: number
  }
}

/** Same shape as an archive, but computed from the LIVE store — used for
 *  the in-progress session's read-only overview and for the archive action. */
export interface SessionPayrollSnapshot {
  sessionId: string
  sessionLabel: string
  records: ArchivedEmployeeRecord[]
  payments: SalaryPayment[]
  summary: SessionPayrollArchive['summary']
}

export type AuditAction =
  | 'payment.recorded'
  | 'payment.confirmed'
  | 'payment.not_received'
  | 'payment.reversed'
  | 'payment.followed_up'
  | 'session.archived'
  | 'salary.change_requested'
  | 'salary.change_accepted'
  | 'salary.change_declined'
  | 'adjustment.added'
  | 'structure.created'
  | 'structure.updated'
  | 'structure.archived'
  | 'structure.restored'
  | 'editing.enabled'
  | 'editing.expired'
  | 'settings.updated'

export interface AuditEntry {
  id: string
  action: AuditAction
  title: string
  detail: string
  actor: string
  timestamp: string // ISO
}

export interface EditPermission {
  enabled: boolean
  expiresAt: number | null
  enabledBy?: string
  enabledAt?: string
}

export interface PaymentSettings {
  defaultMethod: PaymentMethod
  referenceRequired: Record<PaymentMethod, boolean>
}

// ─── Academic session mapping (Indian academic year: April – March) ───

/** Maps a monthly period key ('2026-08') to its academic session id
 *  ('2026-27'). April–December belong to the session that starts that
 *  calendar year; January–March belong to the session started a year
 *  earlier. This is how the archive groups real records by session. */
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

/** All monthly period keys of an academic session, in order. `upTo`
 *  (inclusive) caps the range — the live session only counts months that
 *  have actually begun, so future months never inflate payroll figures. */
export function sessionPeriodRange(sessionId: string, upTo?: string): string[] {
  const [a, b] = sessionId.split('-').map(Number)
  // '2026-27' → start 2026, end 2027. Accept 4-digit or 2-digit parts.
  const startYear = a >= 100 ? a : 2000 + a
  const endYear = b >= 100 ? b : startYear + 1
  const endMonthCal = 3 // March of the following calendar year
  const out: string[] = []
  for (let y = startYear, m = 4; ; m++) {
    if (m > 12) { m = 1; y++ }
    const pk = `${y}-${String(m).padStart(2, '0')}`
    if (upTo && pk > upTo) break
    out.push(pk)
    if (y === endYear && m === endMonthCal) break
    if (out.length > 24) break // safety net — never loops unbounded
  }
  return out
}

/**
 * Builds a session payroll snapshot from REAL store data — the single
 * source used both by the in-progress session's read-only overview and by
 * `archiveSession` when freezing a completed session. Per employee, every
 * month of the session (up to `upTo`) contributes net payable via the same
 * helpers the Payments tab uses, so the numbers always match the running
 * payroll. Payment rows are the original records — netPayable was already
 * snapshotted when each payment was recorded.
 */
export function buildSessionPayrollSnapshot(
  state: Pick<SalaryState, 'employees' | 'salaries' | 'adjustments' | 'payments'>,
  sessionId: string,
  upTo?: string,
): SessionPayrollSnapshot {
  const periods = sessionPeriodRange(sessionId, upTo)
  const inSession = (pk: string) => periods.includes(pk)
  const sessionPayments = state.payments.filter((p) => inSession(p.periodKey))

  const records: ArchivedEmployeeRecord[] = []
  for (const e of state.employees) {
    const state_ = state.salaries[e.id]
    const empPayments = sessionPayments.filter((p) => p.employeeId === e.id)
    if (!state_ && empPayments.length === 0) continue // never on payroll this session
    const joinKey = e.joiningDate?.slice(0, 7) ?? ''
    let totalPayable = 0
    for (const pk of periods) {
      if (joinKey && pk < joinKey) continue // not employed yet that month
      const payable = netPayableFor(state, e.id, pk)
      if (payable > 0) totalPayable += payable
    }
    const totalPaid = empPayments.filter((p) => p.status === 'Confirmed').reduce((s, p) => s + p.amount, 0)
    const livePayments = empPayments.filter((p) => p.status !== 'Reversed')
    records.push({
      employeeId: e.id,
      employeeCode: e.employeeId,
      name: e.name,
      designation: e.designation,
      department: e.department,
      employmentStatus: e.status,
      monthlySalary: state_?.salary.netBase ?? 0,
      totalPayable,
      totalPaid,
      outstanding: Math.max(0, totalPayable - totalPaid),
      paymentsCount: livePayments.length,
    })
  }
  records.sort((x, y) => y.totalPayable - x.totalPayable || x.name.localeCompare(y.name))

  const paid = sessionPayments.filter((p) => p.status === 'Confirmed')
  return {
    sessionId,
    sessionLabel: sessionLabelOf(sessionId),
    records,
    payments: [...sessionPayments].sort((a, b) => b.date.localeCompare(a.date)),
    summary: {
      employees: records.length,
      totalPayroll: records.reduce((s, r) => s + r.totalPayable, 0),
      totalPaid: paid.reduce((s, p) => s + p.amount, 0),
      totalOutstanding: records.reduce((s, r) => s + r.outstanding, 0),
      paymentsCount: sessionPayments.filter((p) => p.status !== 'Reversed').length,
    },
  }
}

// ─── Constants ───────────────────────────────────────────────────────

/** The acting principal's REAL name, resolved from the signed-in session
 *  (Phase 7: the fabricated "Dr. Ananya Iyer" persona is retired — new
 *  payments / audit entries are attributed to the actual signed-in
 *  principal). Falls back to the role label when the session is not
 *  resolvable. */
function principalActor(): string {
  const user = useAuth.getState().user
  return user?.name?.trim() || 'Principal'
}

export const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000 // 3 hours
export const CURRENT_SESSION = { id: '2026-27', label: 'Session 2026–27' }

const METHODS: PaymentMethod[] = ['Bank Transfer', 'UPI', 'Cash', 'Cheque']

// ─── Salary scales ───────────────────────────────────────────────────
//
// DEFAULT = SIMPLE MONTHLY SALARY (the school's chosen workflow):
// every seeded structure pays one fixed monthly amount — no HRA / PF /
// Professional Tax components are invented. The Principal can build a
// DETAILED structure later (the UI supports it); nothing detailed is
// seeded.

const _ded = (id: string, name: string, basis: 'Fixed' | 'Percentage', value: number): StructureComponent =>
  ({ id, name, type: 'Deduction', basis, value })
const _earn = (id: string, name: string, basis: 'Fixed' | 'Percentage', value: number): StructureComponent =>
  ({ id, name, type: 'Earning', basis, value })

const SEED_STRUCTURES: SalaryStructureTemplate[] = [
  {
    id: 'STR-01', name: 'Primary Teaching', applicableTo: 'Teaching',
    description: 'Nursery to Class 5 · monthly salary', baseAmount: 7500, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:00:00.000Z',
    components: [],
  },
  {
    id: 'STR-02', name: 'Middle School Teaching', applicableTo: 'Teaching',
    description: 'Class 6 to Class 9 · monthly salary', baseAmount: 11800, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:05:00.000Z',
    components: [],
  },
  {
    id: 'STR-03', name: 'HOD & Senior Teaching', applicableTo: 'Teaching',
    description: 'HODs · Class 9–12 · monthly salary', baseAmount: 26500, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:10:00.000Z',
    components: [],
  },
  {
    id: 'STR-04', name: 'Senior Leadership', applicableTo: 'Administration',
    description: 'Principal and leadership · monthly salary', baseAmount: 35000, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:15:00.000Z',
    components: [],
  },
  {
    id: 'STR-05', name: 'Office & Administration', applicableTo: 'Administration',
    description: 'Office and accounts staff · monthly salary', baseAmount: 12500, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:20:00.000Z',
    components: [],
  },
  {
    id: 'STR-06', name: 'Support Staff', applicableTo: 'Support',
    description: 'Lab and security staff · monthly salary', baseAmount: 8400, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:25:00.000Z',
    components: [],
  },
  {
    id: 'STR-07', name: 'Transport Staff', applicableTo: 'Transport',
    description: 'Drivers and conductors · monthly salary', baseAmount: 9600, mode: 'simple', status: 'Active', createdAt: '2026-04-01T09:30:00.000Z',
    components: [],
  },
  {
    id: 'STR-08', name: 'Legacy 2019 Scale', applicableTo: 'All',
    description: 'Retired scale from an earlier session', baseAmount: 4500, mode: 'simple', status: 'Archived', createdAt: '2019-04-01T09:00:00.000Z',
    components: [],
  },
]

// ─── Employees (derived from the hydrated teachers-store) ──────────

/** Map one hydrated TeacherRecord onto the payroll Employee shape.
 *  Fields with no source in the teacher's record map to EMPTY values —
 *  bank details are NEVER fabricated (Phase 7). */
export function employeeFromTeacher(t: TeacherRecord): Employee {
  const status: EmployeeStatus =
    t.status === 'On Leave' ? 'On Leave'
    : t.status === 'Suspended' ? 'Suspended'
    : t.status === 'Relieved' ? 'Inactive'
    : 'Active'
  return {
    id: t.id, // canonical DB teacher id — same universe as the Teachers module
    employeeId: t.employeeId,
    name: t.name,
    avatar: t.avatar,
    designation: t.designation,
    department: t.department,
    employeeType: 'Teaching',
    email: t.email,
    phone: t.phone,
    joiningDate: t.joiningDate,
    status,
    salary: t.salary,
    attendance: t.attendance,
    bloodGroup: t.bloodGroup,
    address: t.currentAddress,
    gender: t.gender === 'Male' ? 'Male' : t.gender === 'Female' ? 'Female' : 'Other',
    // No bank details on file — recorded only when the principal enters them.
    bankAccount: undefined,
    bankIfsc: undefined,
  }
}

function employeesFromTeachers(teachers: TeacherRecord[]): Employee[] {
  return teachers
    .filter((t) => t.status !== 'Relieved') // relieved staff are off the payroll pool
    .map(employeeFromTeacher)
}

// ─── Apply a scale ──────────────────────────────────────────────────

function buildSession(template: SalaryStructureTemplate, base: number, effectiveFrom: string, exactNet?: number): SessionSalary {
  const mode = template.mode ?? 'detailed'

  // SIMPLE — one fixed Monthly Salary. The monthly amount IS the salary:
  // no Basic/HRA/PF components are invented, nothing is derived.
  if (mode === 'simple') {
    const monthly = exactNet ?? base
    return {
      structureId: template.id,
      structureName: template.name,
      mode,
      base: monthly,
      netBase: monthly,
      earnings: [{ name: 'Monthly Salary', type: 'Earning', amount: monthly }],
      deductions: [],
      effectiveFrom,
    }
  }

  const earnings: AppliedComponent[] = [
    { name: 'Basic Pay', type: 'Earning', amount: base },
    ...template.components
      .filter((c) => c.type === 'Earning')
      .map((c) => ({ name: c.name, type: 'Earning' as const, amount: c.basis === 'Percentage' ? Math.round(base * c.value / 100) : c.value })),
  ]
  const deductions: AppliedComponent[] = template.components
    .filter((c) => c.type === 'Deduction')
    .map((c) => ({ name: c.name, type: 'Deduction' as const, amount: c.basis === 'Percentage' ? Math.round(base * c.value / 100) : c.value }))
  let netBase = earnings.reduce((s, c) => s + c.amount, 0) - deductions.reduce((s, c) => s + c.amount, 0)
  // Absorb rupee-level rounding into Basic Pay so the net lands exactly.
  if (exactNet !== undefined && netBase !== exactNet) {
    earnings[0] = { ...earnings[0], amount: earnings[0].amount + (exactNet - netBase) }
    netBase = exactNet
  }
  return { structureId: template.id, structureName: template.name, mode, base, netBase, earnings, deductions, effectiveFrom }
}

/** Places an employee on a scale for a target GROSS earnings total. */
export function applyStructure(template: SalaryStructureTemplate, targetGross: number, effectiveFrom: string): SessionSalary {
  // Simple scale — gross == net == the monthly salary.
  if ((template.mode ?? 'detailed') === 'simple') return buildSession(template, targetGross, effectiveFrom)
  const pctEarnings = template.components.filter((c) => c.type === 'Earning' && c.basis === 'Percentage')
    .reduce((s, c) => s + c.value, 0) / 100
  const fixedEarnings = template.components.filter((c) => c.type === 'Earning' && c.basis === 'Fixed')
    .reduce((s, c) => s + c.value, 0)
  const base = Math.round((targetGross - fixedEarnings) / (1 + pctEarnings))
  return buildSession(template, base, effectiveFrom)
}

/** Places an employee on a scale for an exact target NET salary. */
export function applyStructureToNet(template: SalaryStructureTemplate, targetNet: number, effectiveFrom: string): SessionSalary {
  // Simple scale — the target net IS the monthly salary, exactly.
  if ((template.mode ?? 'detailed') === 'simple') return buildSession(template, targetNet, effectiveFrom)
  const pctEarnings = template.components.filter((c) => c.type === 'Earning' && c.basis === 'Percentage')
    .reduce((s, c) => s + c.value, 0) / 100
  const fixedEarnings = template.components.filter((c) => c.type === 'Earning' && c.basis === 'Fixed')
    .reduce((s, c) => s + c.value, 0)
  const pctDeductions = template.components.filter((c) => c.type === 'Deduction' && c.basis === 'Percentage')
    .reduce((s, c) => s + c.value, 0) / 100
  const fixedDeductions = template.components.filter((c) => c.type === 'Deduction' && c.basis === 'Fixed')
    .reduce((s, c) => s + c.value, 0)
  // net = base·(1 + pctE − pctD) + fixedE − fixedD
  const denom = 1 + pctEarnings - pctDeductions
  const base = Math.round((targetNet - fixedEarnings + fixedDeductions) / denom)
  return buildSession(template, base, effectiveFrom, targetNet)
}

// ─── Time helpers ────────────────────────────────────────────────────

export function currentPeriodKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function periodOptions(count = 6, now = new Date()): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(currentPeriodKey(d))
  }
  return out
}

/**
 * Next internal Cash payment reference for the school/tenant: `CASH-YYYY-NNNN`.
 * Derived from every reference already on file (reversed included), so a
 * number is never reused, numbering is sequential and consistent, and the
 * sequence stays independent per school because each tenant owns its store.
 */
export function nextCashReference(existingReferences: Array<string | undefined>, year: number): string {
  const prefix = `CASH-${year}-`
  let max = 0
  for (const ref of existingReferences) {
    if (ref && ref.startsWith(prefix)) {
      const n = Number(ref.slice(prefix.length))
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// ─── Store ───────────────────────────────────────────────────────────

export interface RecordPaymentInput {
  employeeId: string
  periodKey: string
  amount: number
  date: string
  method: PaymentMethod
  reference?: string
  bankAccount?: string
}

export interface ChangeRequestInput {
  employeeId: string
  proposedNet: number
  structureId?: string
  effectiveFrom: string
  note?: string
}

export interface AdjustmentInput {
  employeeId: string
  periodKey: string
  label: string
  amount: number
}

interface SalaryState {
  employees: Employee[]
  structures: SalaryStructureTemplate[]
  salaries: Record<string, EmployeeSalaryState>
  changeRequests: SalaryChangeRequest[]
  adjustments: MonthlyAdjustment[]
  payments: SalaryPayment[]
  receipts: PaymentReceipt[]
  audit: AuditEntry[]
  editPermission: EditPermission
  settings: PaymentSettings
  receiptSeq: number
  /** Completed sessions preserved as frozen, read-only payroll records. */
  archives: SessionPayrollArchive[]

  recordPayment: (input: RecordPaymentInput) => SalaryPayment
  confirmReceipt: (paymentId: string, actor?: string) => void
  reportNotReceived: (paymentId: string, reason: string, actor?: string) => void
  reversePayment: (paymentId: string, reason: string) => void
  markFollowedUp: (paymentId: string) => void

  requestSalaryChange: (input: ChangeRequestInput) => void
  respondToChangeRequest: (requestId: string, accept: boolean, reason?: string) => void
  addAdjustment: (input: AdjustmentInput) => void

  createStructure: (input: Omit<SalaryStructureTemplate, 'id' | 'status' | 'createdAt'>) => void
  updateStructure: (id: string, patch: Partial<Omit<SalaryStructureTemplate, 'id' | 'createdAt'>>) => void
  duplicateStructure: (id: string) => void
  setStructureStatus: (id: string, status: StructureStatus) => void

  enableEditing: () => void
  normalizeEditPermission: () => void
  updateSettings: (patch: Partial<PaymentSettings>) => void

  /** Freeze a completed session's payroll into a read-only archive.
   *  Guards: the current (in-progress) session can never be archived,
   *  a session cannot be archived twice, and empty sessions are refused. */
  archiveSession: (sessionId: string, actor?: string) => SessionPayrollArchive
}

// SaaS-STAGE-2A — one-time legacy copy into the demo school's namespace
// (before store creation / hydration).
migrateLegacyScopedStore(TENANT_SCOPED_BASES.salary, DEFAULT_TENANT_ID)

/* ------------------------------------------------------------------ */
/*  Persisted-state migration (Phase 7, Task 7-a)                      */
/* ------------------------------------------------------------------ */

/** The persisted payroll slice (see partialize below). */
type SalaryPersistedState = Pick<
  SalaryState,
  | 'structures' | 'salaries' | 'changeRequests' | 'adjustments' | 'payments'
  | 'receipts' | 'audit' | 'editPermission' | 'settings' | 'receiptSeq' | 'archives'
>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * v0 (the un-versioned seeded era) → v1: purge the FABRICATED payroll —
 * seeded employees' salaries, the NEFT/UPI payment history, festival
 * bonuses, advance recoveries, receipts, change requests, the seed audit
 * trail and the frozen session archives built on top of them. Structure
 * templates and payment settings are school CONFIGURATION (not
 * identities) and survive. The employee list is never persisted — it
 * derives from the hydrated teachers-store, so real tenant staff appear
 * as soon as the roster syncs.
 */
function migrateSalaryStore(persisted: unknown): SalaryPersistedState {
  const devWarn = (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[salary-store migrate]', ...args)
    }
  }

  // Fabricated slices are purged regardless of shape — only the config
  // slices (structures / settings) are even attempted.
  if (!isPlainObject(persisted)) {
    devWarn('persisted state is not an object — starting the honest (empty) payroll')
    return emptyPayrollSnapshot()
  }
  devWarn(
    'purging the seeded payroll (employees/salaries/payments/receipts/audit) — ' +
      'the employee list now derives from the server teacher roster'
  )

  const snapshot = emptyPayrollSnapshot()

  const rawStructures = persisted.structures
  if (Array.isArray(rawStructures)) {
    const structures = rawStructures.filter(
      (s): s is SalaryStructureTemplate => isPlainObject(s) && typeof s.id === 'string' && typeof s.name === 'string'
    )
    if (structures.length > 0) snapshot.structures = structures
  }
  const rawSettings = persisted.settings
  if (isPlainObject(rawSettings) && typeof rawSettings.defaultMethod === 'string' && isPlainObject(rawSettings.referenceRequired)) {
    const referenceRequired = rawSettings.referenceRequired as Record<string, unknown>
    if (METHODS.every((m) => typeof referenceRequired[m] === 'boolean')) {
      snapshot.settings = rawSettings as unknown as PaymentSettings
    }
  }
  // editPermission is always reset OFF (an expired/unversioned window must
  // never survive the purge); payment history starts empty.
  return snapshot
}

function emptyPayrollSnapshot(): SalaryPersistedState {
  return {
    structures: SEED_STRUCTURES,
    salaries: {},
    changeRequests: [],
    adjustments: [],
    payments: [],
    receipts: [],
    audit: [],
    editPermission: { enabled: false, expiresAt: null },
    settings: {
      defaultMethod: 'Bank Transfer',
      referenceRequired: { 'Bank Transfer': true, UPI: false, Cash: false, Cheque: true },
    },
    receiptSeq: 0,
    archives: [],
  }
}

export const useSalaryStore = create<SalaryState>()(
  persist<SalaryState, [], [], SalaryPersistedState>(
    (set, get) => {
      const log = (action: AuditAction, title: string, detail: string, actor: string) =>
        set((st) => ({ audit: [{ id: `AUD-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, action, title, detail, actor, timestamp: new Date().toISOString() }, ...st.audit] }))

      /** Guard: every salary mutation runs through this. Throws when locked. */
      const assertEditingAllowed = () => {
        const { editPermission } = get()
        const live = editPermission.enabled && editPermission.expiresAt !== null && Date.now() < editPermission.expiresAt
        if (live) return
        if (editPermission.enabled) {
          // Window just expired — normalise and record it once.
          set({ editPermission: { enabled: false, expiresAt: null } })
          log('editing.expired', 'Editing window ended', 'Salary editing', 'System')
        }
        throw new Error('Salary editing is locked. Enable editing in Settings first.')
      }

      return {
        // PHASE 7 — employees derive from the hydrated teachers-store (the
        // bridge below keeps them in sync); payments/adjustments/receipts/
        // audit start EMPTY and only ever hold real recorded actions.
        employees: employeesFromTeachers(useTeachersStore.getState().teachers),
        structures: SEED_STRUCTURES,
        salaries: {},
        changeRequests: [],
        adjustments: [],
        payments: [],
        receipts: [],
        audit: [],
        receiptSeq: 0,
        editPermission: { enabled: false, expiresAt: null },
        archives: [],
        settings: {
          defaultMethod: 'Bank Transfer',
          referenceRequired: { 'Bank Transfer': true, UPI: false, Cash: false, Cheque: true },
        },

        // ── Payments ──
        recordPayment: (input) => {
          const emp = get().employees.find((e) => e.id === input.employeeId)
          if (!emp) throw new Error('Select an employee.')
          if (!input.amount || input.amount <= 0) throw new Error('Enter a valid amount.')
          if (!input.date) throw new Error('Select a payment date.')
          const { settings } = get()
          if (settings.referenceRequired[input.method] && !input.reference?.trim()) {
            throw new Error(`Reference number is required for ${input.method}.`)
          }
          const payable = netPayableFor(get(), input.employeeId, input.periodKey)
          // Cash has no external transaction number — the school's internal
          // payment reference is generated here, once, and persists with the
          // payment. UPI / Bank Transfer / Cheque keep the Principal-entered ref.
          const reference = input.method === 'Cash'
            ? nextCashReference(
                get().payments.map((p) => p.reference),
                Number(String(input.date).slice(0, 4)) || new Date().getFullYear(),
              )
            : input.reference?.trim() || undefined
          const payment: SalaryPayment = {
            id: `PAY-${Date.now().toString(36)}`,
            employeeId: input.employeeId,
            employeeName: emp.name,
            periodKey: input.periodKey,
            monthLabel: periodLabel(input.periodKey),
            netPayable: payable,
            amount: input.amount,
            date: input.date,
            method: input.method,
            reference,
            bankAccount: input.method === 'Bank Transfer' ? (input.bankAccount || emp.bankAccount) : undefined,
            status: 'Pending Receipt',
            recordedBy: principalActor(),
            recordedAt: new Date().toISOString(),
          }
          set((st) => ({ payments: [payment, ...st.payments] }))
          log('payment.recorded', 'Payment recorded', `${emp.name} · ${inr(input.amount)} · ${payment.monthLabel}`, principalActor())
          return payment
        },

        confirmReceipt: (paymentId, actor) => {
          const st = get()
          const p = st.payments.find((x) => x.id === paymentId)
          if (!p || p.status !== 'Pending Receipt') return
          const now = new Date()
          const receiptNo = `RCP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-${(st.receiptSeq + 1).toString().padStart(4, '0')}`
          const confirmedAt = now.toISOString()
          const receipt: PaymentReceipt = {
            receiptNo, paymentId: p.id, employeeId: p.employeeId, employeeName: p.employeeName,
            monthLabel: p.monthLabel, amount: p.amount, method: p.method, date: p.date,
            confirmedAt, reference: p.reference,
          }
          set({
            payments: st.payments.map((x) => x.id === paymentId
              ? { ...x, status: 'Confirmed' as PaymentStatus, confirmedAt, confirmedBy: actor ?? p.employeeName, receiptNo }
              : x),
            receipts: [receipt, ...st.receipts],
            receiptSeq: st.receiptSeq + 1,
          })
          log('payment.confirmed', 'Payment confirmed', `${p.employeeName} · ${inr(p.amount)}`, actor ?? p.employeeName)
        },

        reportNotReceived: (paymentId, reason, actor) => {
          const st = get()
          const p = st.payments.find((x) => x.id === paymentId)
          if (!p || p.status !== 'Pending Receipt') return
          if (!reason.trim()) throw new Error('Tell us what happened so the school can follow up.')
          const rejectedAt = new Date().toISOString()
          set({
            payments: st.payments.map((x) => x.id === paymentId
              ? { ...x, status: 'Not Received' as PaymentStatus, rejectedAt, rejectedBy: actor ?? p.employeeName, rejectionReason: reason.trim() }
              : x),
          })
          log('payment.not_received', 'Payment not received', `${p.employeeName} · ${inr(p.amount)} — ${reason.trim()}`, actor ?? p.employeeName)
        },

        reversePayment: (paymentId, reason) => {
          const st = get()
          const p = st.payments.find((x) => x.id === paymentId)
          if (!p || (p.status !== 'Confirmed' && p.status !== 'Pending Receipt')) return
          if (!reason.trim()) throw new Error('Enter a reason for reversing this payment.')
          set({
            payments: st.payments.map((x) => x.id === paymentId
              ? { ...x, status: 'Reversed' as PaymentStatus, reversedAt: new Date().toISOString(), reversalReason: reason.trim() }
              : x),
            receipts: st.receipts.filter((r) => r.paymentId !== paymentId),
          })
          log('payment.reversed', 'Payment reversed', `${p.employeeName} · ${inr(p.amount)} — ${reason.trim()}`, principalActor())
        },

        markFollowedUp: (paymentId) => {
          const st = get()
          const p = st.payments.find((x) => x.id === paymentId)
          if (!p || (p.status !== 'Not Received' && p.status !== 'Pending Receipt')) return
          set({ payments: st.payments.map((x) => x.id === paymentId ? { ...x, followedUpAt: new Date().toISOString() } : x) })
          log('payment.followed_up', 'Follow-up recorded', `${p.employeeName} · ${inr(p.amount)}`, principalActor())
        },

        // ── Salary changes (employee approval) ──
        requestSalaryChange: (input) => {
          assertEditingAllowed()
          const st = get()
          const emp = st.employees.find((e) => e.id === input.employeeId)
          const current = st.salaries[input.employeeId]
          if (!emp || !current) throw new Error('Select an employee.')
          if (!input.proposedNet || input.proposedNet <= 0) throw new Error('Enter a valid net salary.')
          if (input.proposedNet === current.salary.netBase) throw new Error('The new amount is the same as the current salary.')
          const structureName = input.structureId ? st.structures.find((s) => s.id === input.structureId)?.name : undefined
          const req: SalaryChangeRequest = {
            id: `CR-${Date.now().toString(36)}`,
            employeeId: input.employeeId,
            employeeName: emp.name,
            currentNet: current.salary.netBase,
            proposedNet: input.proposedNet,
            structureId: input.structureId,
            structureName,
            effectiveFrom: input.effectiveFrom,
            note: input.note?.trim() || undefined,
            status: 'Pending',
            requestedBy: principalActor(),
            requestedAt: new Date().toISOString(),
          }
          set({ changeRequests: [req, ...st.changeRequests] })
          log('salary.change_requested', 'Salary change sent', `${emp.name} · ${inr(current.salary.netBase)} → ${inr(input.proposedNet)}`, principalActor())
        },

        respondToChangeRequest: (requestId, accept, reason) => {
          const st = get()
          const req = st.changeRequests.find((r) => r.id === requestId)
          const current = req ? st.salaries[req.employeeId] : undefined
          if (!req || !current || req.status !== 'Pending') return
          const respondedAt = new Date().toISOString()

          if (accept) {
            // The employee approved this exact net — the applied salary
            // must land on it, whichever scale is used.
            const targetStructure = st.structures.find((s) => s.id === req.structureId)
              ?? st.structures.find((s) => s.id === current.salary.structureId)
            const newSalary: SessionSalary = targetStructure
              ? applyStructureToNet(targetStructure, req.proposedNet, req.effectiveFrom)
              : (() => {
                  // No scale available — scale every line proportionally.
                  const factor = current.salary.netBase > 0 ? req.proposedNet / current.salary.netBase : 1
                  const scaleLine = (c: AppliedComponent): AppliedComponent => ({ ...c, amount: Math.round(c.amount * factor) })
                  const earnings = current.salary.earnings.map(scaleLine)
                  const deductions = current.salary.deductions.map(scaleLine)
                  const netBase = earnings.reduce((s, c) => s + c.amount, 0) - deductions.reduce((s, c) => s + c.amount, 0)
                  return {
                    ...current.salary,
                    base: Math.round(current.salary.base * factor),
                    netBase,
                    earnings,
                    deductions,
                    effectiveFrom: req.effectiveFrom,
                  }
                })()
            const historyEntry: SalaryHistoryEntry = {
              id: `H-${Date.now().toString(36)}`,
              date: req.effectiveFrom,
              fromNet: current.salary.netBase,
              toNet: req.proposedNet,
              note: req.note,
              by: req.employeeName,
            }
            set({
              changeRequests: st.changeRequests.map((r) => r.id === requestId ? { ...r, status: 'Accepted' as ChangeRequestStatus, respondedAt, respondedBy: req.employeeName } : r),
              salaries: {
                ...st.salaries,
                [req.employeeId]: { ...current, salary: newSalary, history: [historyEntry, ...current.history] },
              },
            })
            log('salary.change_accepted', 'Salary change accepted', `${req.employeeName} · ${inr(req.currentNet)} → ${inr(req.proposedNet)}`, req.employeeName)
          } else {
            set({
              changeRequests: st.changeRequests.map((r) => r.id === requestId
                ? { ...r, status: 'Declined' as ChangeRequestStatus, respondedAt, respondedBy: req.employeeName, declineReason: reason?.trim() || undefined }
                : r),
            })
            log('salary.change_declined', 'Salary change declined', `${req.employeeName} · ${inr(req.currentNet)} → ${inr(req.proposedNet)}`, req.employeeName)
          }
        },

        addAdjustment: (input) => {
          assertEditingAllowed()
          const st = get()
          const emp = st.employees.find((e) => e.id === input.employeeId)
          if (!emp) throw new Error('Select an employee.')
          if (!input.label.trim()) throw new Error('Enter what this adjustment is for.')
          if (!input.amount || input.amount === 0) throw new Error('Enter a valid amount.')
          const adj: MonthlyAdjustment = {
            id: `ADJ-${Date.now().toString(36)}`,
            employeeId: input.employeeId,
            employeeName: emp.name,
            periodKey: input.periodKey,
            label: input.label.trim(),
            amount: input.amount,
            createdAt: new Date().toISOString(),
            createdBy: principalActor(),
          }
          set({ adjustments: [adj, ...st.adjustments] })
          const sign = input.amount > 0 ? '+' : '−'
          log('adjustment.added', 'Adjustment added', `${emp.name} · ${input.label.trim()} ${sign}${inr(Math.abs(input.amount))} · ${periodLabel(input.periodKey)}`, principalActor())
        },

        // ── Structure templates ──
        createStructure: (input) => {
          const st = get()
          const structure: SalaryStructureTemplate = {
            ...input,
            id: `STR-${Date.now().toString(36)}`,
            status: 'Active',
            createdAt: new Date().toISOString(),
          }
          set({ structures: [...st.structures, structure] })
          log('structure.created', 'Structure created', `${structure.name} · ${structure.applicableTo}`, principalActor())
        },

        updateStructure: (id, patch) => {
          const st = get()
          const old = st.structures.find((s) => s.id === id)
          set({ structures: st.structures.map((s) => s.id === id ? { ...s, ...patch } : s) })
          if (old) log('structure.updated', 'Structure updated', old.name, principalActor())
        },

        duplicateStructure: (id) => {
          const st = get()
          const src = st.structures.find((s) => s.id === id)
          if (!src) return
          const copy: SalaryStructureTemplate = {
            ...src,
            id: `STR-${Date.now().toString(36)}`,
            name: `${src.name} (Copy)`,
            status: 'Active',
            createdAt: new Date().toISOString(),
          }
          set({ structures: [...st.structures, copy] })
          log('structure.created', 'Structure duplicated', `${src.name} → ${copy.name}`, principalActor())
        },

        setStructureStatus: (id, status) => {
          const st = get()
          const src = st.structures.find((s) => s.id === id)
          set({ structures: st.structures.map((s) => s.id === id ? { ...s, status } : s) })
          if (src) log(status === 'Archived' ? 'structure.archived' : 'structure.restored', status === 'Archived' ? 'Structure archived' : 'Structure restored', src.name, principalActor())
        },

        // ── Editing window ──
        enableEditing: () => {
          const now = Date.now()
          set({
            editPermission: {
              enabled: true,
              expiresAt: now + EDIT_WINDOW_MS,
              enabledBy: principalActor(),
              enabledAt: new Date().toISOString(),
            },
          })
          const hours = Math.floor(EDIT_WINDOW_MS / 3600000)
          log('editing.enabled', 'Editing enabled', `${hours}-hour window`, principalActor())
        },

        normalizeEditPermission: () => {
          const { editPermission } = get()
          if (editPermission.enabled && editPermission.expiresAt !== null && Date.now() >= editPermission.expiresAt) {
            set({ editPermission: { enabled: false, expiresAt: null } })
            log('editing.expired', 'Editing window ended', 'Salary editing', 'System')
          }
        },

        updateSettings: (patch) => {
          set((st) => ({ settings: { ...st.settings, ...patch } }))
          log('settings.updated', 'Preferences updated', 'Salary & Payroll', principalActor())
        },

        // ── Session archive ──
        archiveSession: (sessionId, actor) => {
          const st = get()
          if (sessionId === CURRENT_SESSION.id) {
            throw new Error('This session is still in progress — it can be archived once it ends.')
          }
          if (st.archives.some((a) => a.sessionId === sessionId)) {
            throw new Error('That session has already been archived.')
          }
          const snapshot = buildSessionPayrollSnapshot(st, sessionId)
          if (snapshot.records.length === 0) {
            throw new Error('No payroll records exist for that session.')
          }
          const archive: SessionPayrollArchive = {
            ...snapshot,
            archivedAt: new Date().toISOString(),
            archivedBy: actor ?? principalActor(),
          }
          set({ archives: [archive, ...st.archives] })
          log('session.archived', 'Session archived', `${archive.sessionLabel} · ${snapshot.summary.employees} employees · ${snapshot.summary.paymentsCount} payments`, actor ?? principalActor())
          return archive
        },
      }
    },
    {
      name: 'scholario-salary-v4',
      // SaaS-STAGE-2A — tenant-scoped: each school has its own payroll
      // dataset (structures, salaries, payments, receipts, audit).
      // PHASE 7 (Task 7-a) — v1: persisted browsers held the fabricated
      // seed payroll (employees with fake bank accounts, NEFT payment
      // history, bonuses, seed audit). The migration purges every seeded
      // slice; structure templates + settings (school configuration, not
      // identities) survive. Employees are never persisted — they derive
      // from the hydrated teachers-store.
      version: 1,
      migrate: migrateSalaryStore,
      storage: createTenantScopedStorage(TENANT_SCOPED_BASES.salary),
      partialize: (st) => ({
        structures: st.structures,
        salaries: st.salaries,
        changeRequests: st.changeRequests,
        adjustments: st.adjustments,
        payments: st.payments,
        receipts: st.receipts,
        audit: st.audit,
        editPermission: st.editPermission,
        settings: st.settings,
        receiptSeq: st.receiptSeq,
        archives: st.archives,
      }),
      onRehydrateStorage: () => (state) => {
        // Expiry survives refresh: an expired window rehydrates as OFF.
        if (state) state.normalizeEditPermission()
      },
    },
  ),
)

/* ------------------------------------------------------------------ */
/*  Employees bridge (Phase 7) — the payroll staff list follows the    */
/*  canonical faculty roster. Whenever the teachers-store's roster     */
/*  changes (server sync, add-teacher wizard, termination), the        */
/*  salary-store's employee list is re-derived from it. Empty roster   */
/*  ⇒ empty employee list — never a fabricated staff universe.        */
/* ------------------------------------------------------------------ */

function applyTeachersToEmployees(teachers: TeacherRecord[]): void {
  useSalaryStore.setState({ employees: employeesFromTeachers(teachers) })
}

if (typeof window !== 'undefined') {
  // Present-state reconciliation (initial import / persisted hydration).
  applyTeachersToEmployees(useTeachersStore.getState().teachers)
  // Reactive follow — one universe, kept live.
  useTeachersStore.subscribe((state, prev) => {
    if (state.teachers !== prev.teachers) applyTeachersToEmployees(state.teachers)
  })
}

// ─── Derived helpers ─────────────────────────────────────────────────

interface PayableSource {
  salaries: Record<string, EmployeeSalaryState>
  adjustments: MonthlyAdjustment[]
}

export function netPayableFor(src: PayableSource, employeeId: string, periodKey: string): number {
  const state = src.salaries[employeeId]
  // The salary as it stood DURING `periodKey`: the latest change effective
  // on or before that month. A future-dated raise (e.g. accepted today but
  // effective from next month) must never rewrite past months' payable —
  // those months were earned under the previous salary. Falls back to the
  // current net only when no history exists at all.
  const applicable = [...(state?.history ?? [])]
    .filter((h) => h.date.slice(0, 7) <= periodKey)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const base = applicable?.toNet ?? state?.salary.netBase ?? 0
  const adj = src.adjustments
    .filter((a) => a.employeeId === employeeId && a.periodKey === periodKey)
    .reduce((s, a) => s + a.amount, 0)
  return base + adj
}

export function confirmedPaidFor(payments: SalaryPayment[], employeeId: string, periodKey: string): number {
  return payments
    .filter((p) => p.employeeId === employeeId && p.periodKey === periodKey && p.status === 'Confirmed')
    .reduce((s, p) => s + p.amount, 0)
}

/** Payslip state for an employee-month: Unpaid · Pending · Paid. */
export function monthPaymentState(payments: SalaryPayment[], employeeId: string, periodKey: string): 'Unpaid' | 'Pending' | 'Paid' {
  const forMonth = payments.filter((p) => p.employeeId === employeeId && p.periodKey === periodKey)
  if (forMonth.some((p) => p.status === 'Confirmed')) return 'Paid'
  if (forMonth.some((p) => p.status === 'Pending Receipt')) return 'Pending'
  return 'Unpaid'
}

export function editPermissionLive(editPermission: EditPermission): { allowed: boolean; msLeft: number } {
  const msLeft = editPermission.expiresAt ? editPermission.expiresAt - Date.now() : 0
  return { allowed: editPermission.enabled && msLeft > 0, msLeft: Math.max(0, msLeft) }
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

// ─── Hook: aggregated read model ─────────────────────────────────────

export function useSalaryData() {
  const employees = useSalaryStore((s) => s.employees)
  const structures = useSalaryStore((s) => s.structures)
  const salaries = useSalaryStore((s) => s.salaries)
  const changeRequests = useSalaryStore((s) => s.changeRequests)
  const adjustments = useSalaryStore((s) => s.adjustments)
  const payments = useSalaryStore((s) => s.payments)
  const receipts = useSalaryStore((s) => s.receipts)
  const audit = useSalaryStore((s) => s.audit)

  return useMemo(() => {
    const periodKey = currentPeriodKey()
    const label = periodLabel(periodKey)
    const active = employees.filter((e) => e.status === 'Active' || e.status === 'On Leave')

    const rows = active.map((e) => {
      const payable = netPayableFor({ salaries, adjustments }, e.id, periodKey)
      const confirmed = confirmedPaidFor(payments, e.id, periodKey)
      const state = monthPaymentState(payments, e.id, periodKey)
      return { employee: e, payable, confirmed, balance: Math.max(0, payable - confirmed), state }
    })

    const payable = rows.reduce((s, r) => s + r.payable, 0)
    const confirmed = rows.reduce((s, r) => s + r.confirmed, 0)
    const monthPayments = payments.filter((p) => p.periodKey === periodKey)
    const pending = monthPayments.filter((p) => p.status === 'Pending Receipt')
    const notReceived = monthPayments.filter((p) => p.status === 'Not Received' && !p.followedUpAt)
    const pendingAmount = pending.reduce((s, p) => s + p.amount, 0)

    const methodSplit = METHODS.map((m) => ({
      method: m,
      count: monthPayments.filter((p) => p.method === m && p.status !== 'Reversed').length,
      amount: monthPayments.filter((p) => p.method === m && p.status === 'Confirmed').reduce((s, p) => s + p.amount, 0),
    })).filter((m) => m.count > 0)

    const deptMap = new Map<string, { staff: number; payable: number; confirmed: number }>()
    rows.forEach((r) => {
      const cur = deptMap.get(r.employee.department) ?? { staff: 0, payable: 0, confirmed: 0 }
      deptMap.set(r.employee.department, { staff: cur.staff + 1, payable: cur.payable + r.payable, confirmed: cur.confirmed + r.confirmed })
    })

    const structureUsage: Record<string, number> = {}
    Object.values(salaries).forEach((s) => {
      structureUsage[s.salary.structureId] = (structureUsage[s.salary.structureId] ?? 0) + 1
    })

    const pendingChangeRequests = changeRequests.filter((r) => r.status === 'Pending')

    return {
      employees, structures, salaries, changeRequests, adjustments, payments, receipts, audit,
      rows, periodKey, monthLabel: label,
      currentMonth: {
        payable, confirmed,
        pending: { count: pending.length, amount: pendingAmount },
        notReceived: { count: notReceived.length, amount: notReceived.reduce((s, p) => s + p.amount, 0) },
        paid: monthPayments.filter((p) => p.status === 'Confirmed').length,
      },
      pendingChangeRequests,
      methodSplit,
      departmentTotals: Array.from(deptMap.entries()).map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.payable - a.payable),
      structureUsage,
      analytics: {
        monthlyPayroll: payable,
        netPayable: payable,
        pendingAdjustments: pendingChangeRequests.length,
        employeeCount: active.length,
      },
    }
  }, [employees, structures, salaries, changeRequests, adjustments, payments, receipts, audit])
}

// ─── Hook: sessions that actually exist (for the Payroll Archive) ────

export interface PayrollSessionInfo {
  sessionId: string
  label: string
  isCurrent: boolean
  /** Frozen archive exists for this session. */
  archived: boolean
  paymentsCount: number
  employeesCount: number
}

/** Derives the sessions REAL payroll data references — never invents one.
 *  The current session is always listed first (it is where live payroll
 *  lives); completed/archived sessions follow, newest first. */
export function usePayrollSessions(): PayrollSessionInfo[] {
  const employees = useSalaryStore((s) => s.employees)
  const payments = useSalaryStore((s) => s.payments)
  const adjustments = useSalaryStore((s) => s.adjustments)
  const salaries = useSalaryStore((s) => s.salaries)
  const archives = useSalaryStore((s) => s.archives)

  return useMemo(() => {
    const ids = new Set<string>([CURRENT_SESSION.id])
    for (const p of payments) ids.add(sessionOfPeriod(p.periodKey))
    for (const a of adjustments) ids.add(sessionOfPeriod(a.periodKey))
    for (const a of archives) ids.add(a.sessionId)

    return Array.from(ids)
      .sort((x, y) => {
        if (x === CURRENT_SESSION.id) return -1
        if (y === CURRENT_SESSION.id) return 1
        return y.localeCompare(x)
      })
      .map((sessionId) => {
        const archive = archives.find((a) => a.sessionId === sessionId)
        const isCurrent = sessionId === CURRENT_SESSION.id
        if (archive) {
          return {
            sessionId,
            label: archive.sessionLabel,
            isCurrent,
            archived: true,
            paymentsCount: archive.summary.paymentsCount,
            employeesCount: archive.summary.employees,
          }
        }
        const live = isCurrent
          ? buildSessionPayrollSnapshot({ employees, salaries, adjustments, payments }, sessionId, currentPeriodKey())
          : null
        const sessionPayments = payments.filter((p) => sessionOfPeriod(p.periodKey) === sessionId && p.status !== 'Reversed')
        return {
          sessionId,
          label: sessionLabelOf(sessionId),
          isCurrent,
          archived: false,
          paymentsCount: sessionPayments.length,
          employeesCount: live?.summary.employees ?? 0,
        }
      })
  }, [payments, adjustments, salaries, archives, employees])
}

export { formatINR, formatDate } from '@/lib/format'
