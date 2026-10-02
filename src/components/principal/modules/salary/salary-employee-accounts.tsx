'use client'

/**
 * SalaryEmployeeAccountsSection — the payroll-side twin of
 * Fee Management → Student Accounts.
 *
 * PHASE 8B: one card per roster teacher showing the canonical payroll
 * position — configured Monthly Salary, what is RECORDED this month, the
 * total RECORDED across the loaded ledger and the payment count. Every
 * figure comes from the SAME server cache the Payments/Payslips tabs
 * read; no second employee database exists.
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
  sessionLabelOf, CURRENT_SESSION,
} from '@/lib/store/salary-store'
import { useSalaryUI } from './salary-ui-context'
import { moneyMy } from './salary-shared'
import { cn } from '@/lib/utils'

/** Avatar gradient follows the payroll position — same language as the
 *  student fee cards: clear → emerald, something to pay → amber/rose. */
function avatarTone(dueThisMonth: number, recorded: number): string {
  if (dueThisMonth <= 0) return 'bg-gradient-to-br from-emerald-500 to-teal-600'
  if (recorded > 0) return 'bg-gradient-to-br from-amber-500 to-orange-600'
  return 'bg-gradient-to-br from-rose-500 to-pink-600'
}

interface AccountRow {
  teacherId: string
  name: string
  employeeId: string
  department: string
  /** Configured Monthly Salary (0 = not set). */
  monthly: number
  /** RECORDED total this month. */
  recordedCurrent: number
  /** RECORDED total across the loaded ledger (bounded take-500 view). */
  recordedTotal: number
  /** Un-recorded monthly salary for the current month (honest due). */
  dueThisMonth: number
  paymentsCount: number
}

export function SalaryEmployeeAccountsSection() {
  const { openEmployee } = useSalaryUI()
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)
  const data = useSalaryData()

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')

  const periodKey = currentPeriodKey()
  // Bounded lookback — the last 6 monthly periods up to the current one
  // (the ledger view the workspace caches; totals are sums of RECORDED
  // amounts only — no payable arithmetic is invented).
  const lookbackPeriods = useMemo(() => periodOptions(6), [])

  const accountRows = useMemo<AccountRow[]>(() => {
    return teachers.map((t) => {
      const monthly = structures.find((s) => s.teacherId === t.id)?.monthlyAmount ?? 0
      const empPayments = payments.filter((p) => p.teacherId === t.id)
      const recordedCurrent = empPayments
        .filter((p) => p.month === periodKey && p.status === 'RECORDED')
        .reduce((s, p) => s + p.amount, 0)
      const recordedTotal = empPayments
        .filter((p) => lookbackPeriods.includes(p.month) && p.status === 'RECORDED')
        .reduce((s, p) => s + p.amount, 0)
      const dueThisMonth = monthly > 0 ? Math.max(0, monthly - recordedCurrent) : 0

      return {
        teacherId: t.id,
        name: t.name,
        employeeId: t.employeeId,
        department: t.department,
        monthly,
        recordedCurrent,
        recordedTotal,
        dueThisMonth,
        paymentsCount: empPayments.filter((p) => p.status === 'RECORDED').length,
      }
    })
  }, [teachers, structures, payments, periodKey, lookbackPeriods])

  const deptOptions = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.department).filter(Boolean))).sort(),
    [teachers],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accountRows
      .filter((r) => {
        if (deptFilter !== 'all' && r.department !== deptFilter) return false
        if (q) {
          const hay = `${r.name} ${r.employeeId} ${r.department}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        // Un-set salaries first (they need attention), then by name.
        const aSet = a.monthly > 0 ? 1 : 0
        const bSet = b.monthly > 0 ? 1 : 0
        return aSet - bSet || a.name.localeCompare(b.name)
      })
  }, [accountRows, search, deptFilter])

  const totals = useMemo(() => ({
    teachers: filtered.length,
    monthly: filtered.reduce((s, r) => s + r.monthly, 0),
    recordedCurrent: filtered.reduce((s, r) => s + r.recordedCurrent, 0),
    dueThisMonth: filtered.reduce((s, r) => s + r.dueThisMonth, 0),
  }), [filtered])

  const clearFilters = () => {
    setSearch('')
    setDeptFilter('all')
  }

  return (
    <div className="space-y-4">
      {/* Summary strip — where the session's payroll stands right now */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AccountTile label="Teachers" value={String(totals.teachers)} icon={<Users className="h-3 w-3" />} />
        <AccountTile label="Monthly Payout" value={moneyMy(totals.monthly)} icon={<Wallet className="h-3 w-3" />} />
        <AccountTile label={`Recorded · ${periodKey === data.periodKey ? data.monthLabel : periodKey.slice(0, 7)}`} value={moneyMy(totals.recordedCurrent)} tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />} />
        <AccountTile
          label="To Record · this month"
          value={moneyMy(totals.dueThisMonth)}
          tone={totals.dueThisMonth > 0 ? 'amber' : undefined}
          hint={totals.dueThisMonth > 0 ? 'salaries set but not yet recorded' : undefined}
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
            placeholder="Search name, employee ID, department…"
            className="pl-9 pr-8 h-9 text-xs"
            aria-label="Search teachers"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span role="status" className="hidden sm:block text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
            {teachers.length} teacher{teachers.length === 1 ? '' : 's'} · showing {filtered.length}
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
        </div>
      </div>

      {/* Teacher cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((r, i) => (
          <EmployeeCard key={r.teacherId} row={r} index={i} onOpen={() => openEmployee(r.teacherId)} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60 mb-3">
              <Users className="h-5 w-5" />
            </div>
            {/* Honest copy: an empty server roster is different from
                over-strict filters (no fabricated staff pool exists). */}
            {teachers.length === 0 ? (
              <>
                <p className="text-sm font-semibold text-muted-foreground">No staff on the payroll yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                  The payroll list follows the school&apos;s teacher roster — register teachers in the
                  Teachers module and they will appear here.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-muted-foreground">No teachers match this view</p>
                <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">Try a different name or employee ID, or relax the department filter.</p>
                {(search || deptFilter !== 'all') && (
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
  tone?: 'emerald' | 'amber'
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
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
      )}>{value}</p>
      {hint && <p className="text-[9px] text-amber-600 dark:text-amber-400 truncate">{hint}</p>}
    </motion.div>
  )
}

function EmployeeCard({ row, index, onOpen }: { row: AccountRow; index: number; onOpen: () => void }) {
  const initials = row.name.split(' ').map((n) => n[0]).slice(0, 2).join('')
  const settled = row.monthly === 0 || row.dueThisMonth === 0

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.28) }}
      onClick={onOpen}
      aria-label={`Open account for ${row.name}`}
      className="group rounded-xl border border-border bg-card p-4 text-left hover:border-emerald-500/40 hover:shadow-md transition-all"
    >
      {/* Identity */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold',
            avatarTone(row.dueThisMonth, row.recordedTotal),
          )}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{row.name}</p>
            {/* Honest empties: un-recorded fields never render broken fragments. */}
            <p className="text-[10px] text-muted-foreground font-mono truncate">
              {row.employeeId || '—'}
            </p>
            <p className="text-[10px] text-muted-foreground/80 truncate">
              {row.department || 'Department not recorded'}
            </p>
          </div>
        </div>
        <span className={cn(
          'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold shrink-0 mt-0.5',
          row.monthly > 0
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground',
        )}>
          {row.monthly > 0 ? 'Salary set' : 'No salary'}
        </span>
      </div>

      {/* Payroll position — 2×2, mirrors the student card's stat tiles.
          PHASE 8B: a "—" means NO monthly salary is configured (never a
          measured ₹0). */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat label="Monthly Salary" value={row.monthly > 0 ? moneyMy(row.monthly) : '—'} />
        <CardStat
          label="Recorded"
          value={row.recordedCurrent > 0 ? moneyMy(row.recordedCurrent) : '—'}
          sub="this month"
          tone={row.recordedCurrent > 0 ? 'emerald' : 'default'}
        />
        <CardStat
          label="Paid"
          value={moneyMy(row.recordedTotal)}
          sub={sessionLabelOf(CURRENT_SESSION.id)}
          tone={row.recordedTotal > 0 ? 'emerald' : 'default'}
          icon={<Clock className="h-2.5 w-2.5" />}
        />
        <CardStat
          label="To Record"
          value={row.monthly === 0 ? '—' : settled ? 'Clear' : moneyMy(row.dueThisMonth)}
          tone={settled ? 'emerald' : 'amber'}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/40 text-[10px] text-muted-foreground">
        <span className="truncate">{row.paymentsCount} payment{row.paymentsCount === 1 ? '' : 's'} recorded</span>
        <span className="inline-flex items-center gap-0.5 group-hover:text-emerald-600 transition-colors shrink-0">
          Open Account <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </motion.button>
  )
}

/** Student-accounts StatTile chrome: muted tile, micro uppercase label,
 *  bold tabular value. Kept local — identical rules, teacher content. */
function CardStat({ label, value, sub, tone = 'default', icon }: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'emerald' | 'rose' | 'amber'
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
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
      )}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}
