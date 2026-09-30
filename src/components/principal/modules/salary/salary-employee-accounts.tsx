'use client'

/**
 * SalaryEmployeeAccountsSection — the payroll-side twin of
 * Fee Management → Student Accounts.
 *
 * Opens straight into the workspace (no explanatory copy — the interface
 * explains itself): live summary → search + filters → employee cards.
 * Each card is one staff member's payroll position — identity, monthly
 * salary, this-month payable, session paid and what's still due — and the
 * whole card opens the existing employee account drawer.
 *
 * Every figure comes from the SAME store the Payments/Payslips tabs read;
 * no second employee database exists.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Banknote, CheckCircle2, ChevronRight, Clock, Search, Users, Wallet, X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  useSalaryStore, useSalaryData, currentPeriodKey, periodOptions,
  netPayableFor, confirmedPaidFor, CURRENT_SESSION, sessionLabelOf,
} from '@/lib/store/salary-store'
import type { Employee, EmployeeStatus } from '@/lib/store/salary-store'
import { useSalaryUI } from './salary-ui-context'
import { moneyMy, fmtDayYear } from './salary-shared'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<EmployeeStatus, string> = {
  Active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'On Leave': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Suspended: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  Resigned: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  Retired: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  Inactive: 'bg-muted text-muted-foreground',
}

/** Avatar gradient follows the payroll position — same language as the
 *  student fee cards: clear → emerald, something due → amber/rose. */
function avatarTone(due: number, paid: number): string {
  if (due <= 0) return 'bg-gradient-to-br from-emerald-500 to-teal-600'
  if (paid > 0) return 'bg-gradient-to-br from-amber-500 to-orange-600'
  return 'bg-gradient-to-br from-rose-500 to-pink-600'
}

interface AccountRow {
  employee: Employee
  /** Simple salary model (one fixed monthly amount) — honest labels. */
  isSimple: boolean
  grossMonthly: number
  payableCurrent: number
  paidSession: number
  pendingAmount: number
  outstanding: number
  paymentsCount: number
}

export function SalaryEmployeeAccountsSection() {
  const { openEmployee } = useSalaryUI()
  const employees = useSalaryStore((s) => s.employees)
  const salaries = useSalaryStore((s) => s.salaries)
  const adjustments = useSalaryStore((s) => s.adjustments)
  const payments = useSalaryStore((s) => s.payments)
  const rows = useSalaryData().rows

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const periodKey = currentPeriodKey()
  // Bounded payroll lookback — the last 6 monthly periods up to the
  // current one. Months before the employee's joining date are excluded
  // so nobody accrues "due" for months they weren't employed.
  const lookbackPeriods = useMemo(() => periodOptions(6), [])
  const sessionLabel = sessionLabelOf(CURRENT_SESSION.id)

  const accountRows = useMemo<AccountRow[]>(() => {
    return employees.map((e) => {
      const state = salaries[e.id]
      // True gross = every earning line (basic + allowances), not just basic pay.
      const grossMonthly = state ? state.salary.earnings.reduce((s, c) => s + c.amount, 0) : 0
      // Simple mode: the single line IS the Monthly Salary — label it honestly.
      const isSimple = state ? (state.salary.mode ?? 'detailed') === 'simple' : false
      const row = rows.find((r) => r.employee.id === e.id)
      const payableCurrent = row?.payable ?? 0

      const empPayments = payments.filter((p) => p.employeeId === e.id)
      const paidSession = empPayments.filter((p) => p.status === 'Confirmed').reduce((s, p) => s + p.amount, 0)
      const pendingAmount = empPayments.filter((p) => p.status === 'Pending Receipt' || p.status === 'Not Received').reduce((s, p) => s + p.amount, 0)

      // Outstanding = unpaid payroll across the last 6 periods (current
      // month included), for periods after the joining date. Uses the same
      // netPayable/confirmedPaid helpers as the Payments tab — one source.
      let outstanding = 0
      for (const pk of lookbackPeriods) {
        if (pk > periodKey) continue
        const joinKey = e.joiningDate?.slice(0, 7) ?? ''
        if (joinKey && pk < joinKey) continue
        const payable = netPayableFor({ salaries, adjustments }, e.id, pk)
        if (payable <= 0) continue
        const confirmed = confirmedPaidFor(payments, e.id, pk)
        outstanding += Math.max(0, payable - confirmed)
      }

      return {
        employee: e,
        grossMonthly,
        isSimple,
        payableCurrent,
        paidSession,
        pendingAmount,
        outstanding,
        paymentsCount: empPayments.filter((p) => p.status !== 'Reversed').length,
      }
    })
  }, [employees, salaries, adjustments, payments, rows, lookbackPeriods, periodKey])

  const deptOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(),
    [employees],
  )
  const statusOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.status))),
    [employees],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accountRows
      .filter((r) => {
        if (deptFilter !== 'all' && r.employee.department !== deptFilter) return false
        if (statusFilter !== 'all' && r.employee.status !== statusFilter) return false
        if (q) {
          const hay = `${r.employee.name} ${r.employee.employeeId} ${r.employee.designation} ${r.employee.department} ${r.employee.email}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Active staff first, then by name — Student Accounts ordering spirit.
        const active = (e: Employee) => (e.status === 'Active' ? 0 : e.status === 'On Leave' ? 1 : 2)
        return active(a.employee) - active(b.employee) || a.employee.name.localeCompare(b.employee.name)
      })
  }, [accountRows, search, deptFilter, statusFilter])

  const totals = useMemo(() => ({
    employees: filtered.length,
    grossMonthly: filtered.reduce((s, r) => s + r.grossMonthly, 0),
    paidSession: filtered.reduce((s, r) => s + r.paidSession, 0),
    outstanding: filtered.reduce((s, r) => s + r.outstanding, 0),
    pending: filtered.reduce((s, r) => s + r.pendingAmount, 0),
  }), [filtered])

  const clearFilters = () => {
    setSearch('')
    setDeptFilter('all')
    setStatusFilter('all')
  }

  return (
    <div className="space-y-4">
      {/* Summary strip — where the session's payroll stands right now */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AccountTile label="Employees" value={String(totals.employees)} icon={<Users className="h-3 w-3" />} />
        <AccountTile label="Monthly Payout" value={moneyMy(totals.grossMonthly)} icon={<Wallet className="h-3 w-3" />} />
        <AccountTile label={`Paid · ${sessionLabel}`} value={moneyMy(totals.paidSession)} tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />} />
        <AccountTile
          label="Outstanding"
          value={moneyMy(totals.outstanding)}
          tone={totals.outstanding > 0 ? 'rose' : undefined}
          hint={totals.pending > 0 ? `${moneyMy(totals.pending)} awaiting confirmation` : undefined}
          icon={<Banknote className="h-3 w-3" />}
        />
      </div>

      {/* Search + filters — mirrors Student Accounts' toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, employee ID, designation…"
            className="pl-9 pr-8 h-9 text-xs"
            aria-label="Search employees"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span role="status" className="hidden sm:block text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
            {employees.length} employee{employees.length === 1 ? '' : 's'} · showing {filtered.length}
          </span>

          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-9 text-[11px] w-[150px] text-xs" aria-label="Department filter"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent className="z-[70]">
              <SelectItem value="all" className="text-xs">All Departments</SelectItem>
              {deptOptions.map((d) => (
                <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-[11px] w-[130px] text-xs" aria-label="Employment status filter"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent className="z-[70]">
              <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
              {statusOptions.map((st) => (
                <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Employee cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((r, i) => (
          <EmployeeCard key={r.employee.id} row={r} index={i} onOpen={() => openEmployee(r.employee.id)} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60 mb-3">
              <Users className="h-5 w-5" />
            </div>
            {/* PHASE 7 — honest copy: an empty school roster is different
                from over-strict filters (no fabricated staff pool exists). */}
            {employees.length === 0 ? (
              <>
                <p className="text-sm font-semibold text-muted-foreground">No staff on the payroll yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                  The payroll list follows the school&apos;s teacher roster — register teachers in the
                  Teachers module and they will appear here.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-muted-foreground">No employees match this view</p>
                <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">Try a different name or employee ID, or relax the department and status filters.</p>
                {(search || deptFilter !== 'all' || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-3 inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted/60 transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AccountTile({ label, value, hint, tone, icon }: {
  label: string
  value: string
  hint?: string
  tone?: 'emerald' | 'rose'
  icon?: React.ReactNode
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={cn(
        'text-lg font-bold tabular-nums leading-tight mt-0.5',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400',
      )}>{value}</p>
      {hint && <p className="text-[9px] text-amber-600 dark:text-amber-400 truncate">{hint}</p>}
    </motion.div>
  )
}

function EmployeeCard({ row, index, onOpen }: { row: AccountRow; index: number; onOpen: () => void }) {
  const { employee: e } = row
  const initials = e.name.split(' ').map((n) => n[0]).slice(0, 2).join('')
  const settled = row.outstanding === 0

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.28) }}
      onClick={onOpen}
      aria-label={`Open account for ${e.name}`}
      className="group rounded-xl border border-border bg-card p-4 text-left hover:border-emerald-500/40 hover:shadow-md transition-all"
    >
      {/* Identity */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold',
            avatarTone(row.outstanding, row.paidSession),
          )}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{e.name}</p>
            {/* PHASE 7 — honest empties: un-recorded designation / department /
                joining date never render broken "· ·" fragments. */}
            <p className="text-[10px] text-muted-foreground font-mono truncate">
              {[e.employeeId, e.designation].filter(Boolean).join(' · ') || '—'}
            </p>
            <p className="text-[10px] text-muted-foreground/80 truncate">
              {e.joiningDate ? `${e.department ? `${e.department} · ` : ''}joined ${fmtDayYear(e.joiningDate)}` : e.department || 'Joining date not recorded'}
            </p>
          </div>
        </div>
        <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold shrink-0 mt-0.5', STATUS_TONE[e.status])}>
          {e.status}
        </span>
      </div>

      {/* Payroll position — 2×2, mirrors the student card's stat tiles.
          PHASE 7: a "—" means NO salary is configured for this employee
          yet (never a measured ₹0). */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat label={row.isSimple ? "Monthly Salary" : "Gross / Month"} value={row.grossMonthly > 0 ? moneyMy(row.grossMonthly) : '—'} />
        <CardStat label="Payable" value={row.payableCurrent > 0 ? moneyMy(row.payableCurrent) : '—'} sub="this month" />
        <CardStat
          label="Paid"
          value={moneyMy(row.paidSession)}
          sub={row.pendingAmount > 0 ? `${moneyMy(row.pendingAmount)} in review` : `${sessionLabelOf(CURRENT_SESSION.id)}`}
          tone={row.paidSession > 0 ? 'emerald' : 'default'}
          icon={row.pendingAmount > 0 ? <Clock className="h-2.5 w-2.5" /> : undefined}
        />
        <CardStat
          label="Due"
          value={settled ? 'Clear' : moneyMy(row.outstanding)}
          tone={settled ? 'emerald' : 'rose'}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/40 text-[10px] text-muted-foreground">
        <span className="truncate">{row.paymentsCount} payment{row.paymentsCount === 1 ? '' : 's'} this session</span>
        <span className="inline-flex items-center gap-0.5 group-hover:text-emerald-600 transition-colors shrink-0">
          Open Account <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </motion.button>
  )
}

/** Student-accounts StatTile chrome: muted tile, micro uppercase label,
 *  bold tabular value. Kept local — identical rules, employee content. */
function CardStat({ label, value, sub, tone = 'default', icon }: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'emerald' | 'rose'
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-right">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-end gap-0.5">
        {icon}{label}
      </p>
      <p className={cn(
        'text-sm font-bold tabular-nums mt-0.5',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400',
      )}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}
