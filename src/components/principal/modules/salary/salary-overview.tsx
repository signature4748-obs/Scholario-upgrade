'use client'

/**
 * SalaryOverviewSection — the month at a glance: KPIs, what needs
 * attention, staff salaries, and the latest activity. All rows are
 * compact and icon-first; names open the employee drawer.
 *
 * PHASE 8B: every figure comes from the canonical server payroll —
 * the sum of configured monthly salaries (payroll commitment) and the
 * sum of RECORDED payment amounts. No net/gross arithmetic exists.
 */

import { useMemo } from 'react'
import {
  AlertTriangle, ArrowUpRight, CalendarDays, Check, ChevronRight, Undo2, Users, Wallet,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  useSalaryData, useSalaryStore, salaryEventsOf, type SalaryEvent,
} from '@/lib/store/salary-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { useSalaryUI } from './salary-ui-context'
import { SalaryPanel, PayslipStateBadge, fmtDay, moneyMy } from './salary-shared'

export function SalaryOverviewSection({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const data = useSalaryData()
  const teacherNames = useSalaryStore((s) => s.teacherNames)
  const { openEmployee, openRecordPayment } = useSalaryUI()

  const { currentMonth, periodKey } = data

  // Teachers with a configured salary but nothing RECORDED yet this month —
  // the honest "needs attention" queue (never a fabricated status).
  const unrecorded = currentMonth.unrecorded

  // Canonical payment events, newest first (the honest activity feed).
  const events = useMemo(
    () => salaryEventsOf(data.payments, teacherNames),
    [data.payments, teacherNames],
  )

  const topRows = useMemo(
    () => [...data.rows].sort((a, b) => a.teacher.name.localeCompare(b.teacher.name)),
    [data.rows],
  )

  return (
    <div className="space-y-4">
      {/* KPIs — same design language as Fee Management (SummaryCard) */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />} label={`${data.monthLabel} Payable`}
          value={moneyMy(currentMonth.payable)} sub={`${data.analytics.configuredCount} with salary set`}
          tone="sky" onClick={() => onNavigate('structures')} delay={0}
        />
        <SummaryCard
          icon={<Check className="h-4 w-4" />} label="Recorded Paid"
          value={moneyMy(currentMonth.recorded)} sub={`${currentMonth.recordedCount} payment${currentMonth.recordedCount === 1 ? '' : 's'}`}
          tone="emerald" onClick={() => onNavigate('payments')} delay={0.05}
        />
        <SummaryCard
          icon={<CalendarDays className="h-4 w-4" />} label="Not Yet Recorded"
          value={String(unrecorded.length)} sub={unrecorded.length > 0 ? 'teachers with a salary set' : 'All salaries recorded'}
          tone={unrecorded.length > 0 ? 'amber' : 'slate'} onClick={() => onNavigate('payments')} delay={0.1}
        />
        <SummaryCard
          icon={<Users className="h-4 w-4" />} label="Staff"
          value={data.rows.length} sub={`${data.departmentTotals.length} departments`}
          tone="violet" delay={0.15}
        />
      </SummaryCardGrid>

      {/* Needs attention */}
      {unrecorded.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('payments')}
          className="w-full flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-left hover:bg-amber-500/[0.1] transition-colors"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              {unrecorded.length} salary payment{unrecorded.length === 1 ? '' : 's'} not recorded for {data.monthLabel}
            </p>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-300/70 mt-0.5 truncate">
              {unrecorded.map((r) => r.teacher.name).join(' · ')}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-500/60 shrink-0" />
        </button>
      )}

      {/* Staff salaries + recent activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <SalaryPanel
          title="Staff Salaries"
          subtitle={`${data.monthLabel} · fixed monthly salary`}
          className="xl:col-span-3"
          action={
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => openRecordPayment({ month: periodKey })}>
              <Wallet className="h-3 w-3" /> Record Payment
            </Button>
          }
        >
          <div className="max-h-96 overflow-y-auto -mx-4 salary-scroll">
            <div className="divide-y divide-border">
              {topRows.length === 0 ? (
                // Honest empty: the payroll staff list follows the school's
                // teacher roster (server truth — no fabricated employees).
                <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                  No staff on the payroll yet — the list follows the school&apos;s teacher roster.
                </p>
              ) : topRows.map((r) => (
                <button
                  key={r.teacher.id}
                  type="button"
                  onClick={() => openEmployee(r.teacher.id)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors text-left"
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[9px] font-semibold bg-muted">
                      {initialsOf(r.teacher.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{r.teacher.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {r.teacher.department || r.teacher.employeeId || '—'}
                    </p>
                  </div>
                  <p className="text-xs font-bold tabular-nums shrink-0 hidden sm:block">{r.monthly > 0 ? moneyMy(r.monthly) : '—'}</p>
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
              {events.length === 0 ? (
                // Honest empty: only real canonical payment events appear
                // here (recorded / voided) — no seeded history.
                <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                  No payroll activity yet — recorded and voided payments will appear here.
                </p>
              ) : events.slice(0, 8).map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          </div>
        </SalaryPanel>
      </div>
    </div>
  )
}

// ─── Compact event row (shared with the History tab) ─────────────────

export function EventIcon({ kind }: { kind: SalaryEvent['kind'] }) {
  const map: Record<SalaryEvent['kind'], { icon: React.ReactNode; cls: string }> = {
    'payment.recorded': { icon: <ArrowUpRight className="h-3.5 w-3.5" />, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    'payment.voided': { icon: <Undo2 className="h-3.5 w-3.5" />, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  }
  const m = map[kind] ?? map['payment.recorded']
  return <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', m.cls)}>{m.icon}</span>
}

export function EventRow({ event }: { event: SalaryEvent }) {
  const title = event.kind === 'payment.voided' ? 'Payment voided' : 'Payment recorded'
  const detail = `${event.teacherName} · ${moneyMy(event.amount)} · ${event.month}`
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <EventIcon kind={event.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
      </div>
      <p className="text-[10px] text-muted-foreground shrink-0 text-right leading-tight">
        {fmtDay(event.at)}
      </p>
    </div>
  )
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}
