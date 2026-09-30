'use client'

/**
 * SalaryOverviewSection — the month at a glance: KPIs, what needs
 * attention, staff salaries, and the latest activity. All rows are
 * compact and icon-first; names open the employee drawer.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Archive, ArrowUpRight, Check, ChevronRight, Clock, Users, Wallet, X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useSalaryData } from '@/lib/store/salary-store'
import type { AuditAction } from '@/lib/store/salary-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { useSalaryUI } from './salary-ui-context'
import { SalaryPanel, PayslipStateBadge, fmtDay, moneyMy } from './salary-shared'

export function SalaryOverviewSection({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const data = useSalaryData()
  const { openEmployee, openRecordPayment } = useSalaryUI()

  const { currentMonth, pendingChangeRequests, payments, audit, periodKey } = data

  const notReceived = useMemo(
    () => payments.filter((p) => p.status === 'Not Received' && !p.followedUpAt),
    [payments],
  )

  const attentionCount = notReceived.length + pendingChangeRequests.length

  const topRows = useMemo(
    () => [...data.rows].sort((a, b) => a.employee.name.localeCompare(b.employee.name)),
    [data.rows],
  )

  return (
    <div className="space-y-4">
      {/* KPIs — same design language as Fee Management (SummaryCard) */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />} label={`${data.monthLabel} Payable`}
          value={moneyMy(currentMonth.payable)} sub={`${data.rows.length} staff`}
          tone="sky" onClick={() => onNavigate('payments')} delay={0}
        />
        <SummaryCard
          icon={<Check className="h-4 w-4" />} label="Confirmed Paid"
          value={moneyMy(currentMonth.confirmed)} sub={`${currentMonth.paid} receipts`}
          tone="emerald" onClick={() => onNavigate('payments')} delay={0.05}
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4" />} label="Pending Receipt"
          value={moneyMy(currentMonth.pending.amount)} sub={`${currentMonth.pending.count} awaiting confirmation`}
          tone="amber" onClick={() => onNavigate('payments')} delay={0.1}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />} label="Staff"
          value={data.rows.length} sub={`${data.departmentTotals.length} departments`}
          tone="violet" delay={0.15}
        />
      </SummaryCardGrid>

      {/* Needs attention */}
      {attentionCount > 0 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {notReceived.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('payments')}
              className="flex items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3 text-left hover:bg-rose-500/[0.1] transition-colors"
            >
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{notReceived.length} payment reported not received</p>
                <p className="text-[11px] text-rose-600/80 dark:text-rose-300/70 mt-0.5 truncate">
                  {notReceived.map((p) => p.employeeName).join(' · ')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-rose-500/60 shrink-0" />
            </button>
          )}
          {pendingChangeRequests.length > 0 && (
            <button
              type="button"
              onClick={() => openEmployee(pendingChangeRequests[0].employeeId)}
              className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-left hover:bg-amber-500/[0.1] transition-colors"
            >
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {pendingChangeRequests.length} salary change{pendingChangeRequests.length === 1 ? '' : 's'} awaiting approval
                </p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-300/70 mt-0.5 truncate">
                  {pendingChangeRequests.map((r) => `${r.employeeName} → ${moneyMy(r.proposedNet)}`).join(' · ')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-amber-500/60 shrink-0" />
            </button>
          )}
        </motion.div>
      )}

      {/* Staff salaries + recent activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <SalaryPanel
          title="Staff Salaries"
          subtitle={`${data.monthLabel} · net payable`}
          className="xl:col-span-3"
          action={
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => openRecordPayment({ periodKey })}>
              <Wallet className="h-3 w-3" /> Record Payment
            </Button>
          }
        >
          <div className="max-h-96 overflow-y-auto -mx-4 salary-scroll">
            <div className="divide-y divide-border">
              {topRows.length === 0 ? (
                // PHASE 7 — honest empty: the payroll staff list follows the
                // school's teacher roster (no fabricated employees).
                <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                  No staff on the payroll yet — the list follows the school&apos;s teacher roster.
                </p>
              ) : topRows.map((r) => (
                <button
                  key={r.employee.id}
                  type="button"
                  onClick={() => openEmployee(r.employee.id)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors text-left"
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[9px] font-semibold bg-muted">{r.employee.avatar}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{r.employee.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{r.employee.designation || '—'}</p>
                  </div>
                  <p className="text-xs font-bold tabular-nums shrink-0 hidden sm:block">{r.payable > 0 ? moneyMy(r.payable) : '—'}</p>
                  <PayslipStateBadge state={r.state} />
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </SalaryPanel>

        <SalaryPanel title="Recent Activity" subtitle="Latest updates" className="xl:col-span-2">
          <div className="max-h-96 overflow-y-auto -mx-4 salary-scroll">
            <div className="divide-y divide-border">
              {audit.length === 0 ? (
                // PHASE 7 — honest empty: payroll activity records only real
                // actions taken in this store (no seeded history).
                <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                  No payroll activity yet — recorded payments and salary changes will appear here.
                </p>
              ) : audit.slice(0, 8).map((a) => (
                <AuditRow key={a.id} action={a.action} title={a.title} detail={a.detail} actor={a.actor} timestamp={a.timestamp} />
              ))}
            </div>
          </div>
        </SalaryPanel>
      </div>
    </div>
  )
}

// ─── Compact audit row (shared with History tab) ─────────────────────

export function AuditIcon({ action }: { action: AuditAction }) {
  const map: Record<AuditAction, { icon: React.ReactNode; cls: string }> = {
    'payment.recorded': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
    'payment.confirmed': { icon: <Check className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    'payment.not_received': { icon: <X className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
    'payment.reversed': { icon: <ArrowUpRight className="h-3.5 w-3.5 rotate-90" />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
    'payment.followed_up': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    'salary.change_requested': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    'salary.change_accepted': { icon: <Check className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    'salary.change_declined': { icon: <X className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
    'adjustment.added': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    'structure.created': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    'structure.updated': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    'structure.archived': { icon: <X className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
    'structure.restored': { icon: <Check className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    'editing.enabled': { icon: <Check className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    'editing.expired': { icon: <Clock className="h-3.5 w-3.5" />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
    'settings.updated': { icon: <Check className="h-3.5 w-3.5" strokeWidth={3} />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
    'session.archived': { icon: <Archive className="h-3.5 w-3.5" />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  }
  const m = map[action]
  return <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', m.cls)}>{m.icon}</span>
}

export function AuditRow({
  action, title, detail, actor, timestamp,
}: { action: AuditAction; title: string; detail: string; actor: string; timestamp: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <AuditIcon action={action} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
      </div>
      <p className="text-[10px] text-muted-foreground shrink-0 text-right leading-tight">
        {fmtDay(timestamp)}<br /><span className="opacity-70">by {actor}</span>
      </p>
    </div>
  )
}
