'use client'

/**
 * SalaryPaymentsSection — the canonical payment ledger, Principal side.
 *
 * PHASE 8B: the principal records payments (POST /api/salary/payments)
 * and can void a RECORDED row (with confirmation) — voiding keeps the
 * audit trail and frees the month to be re-recorded. Statuses are
 * RECORDED | VOIDED; totals are sums of RECORDED amounts only.
 */

import { useMemo, useState } from 'react'
import {
  Ban, Check, Eye, IndianRupee, Undo2, Wallet,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useSalaryStore, useSalaryData, periodOptions, periodLabel, type SalaryPayment,
} from '@/lib/store/salary-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { useSalaryUI } from './salary-ui-context'
import { PaymentDetailDialog, VoidPaymentDialog } from './payment-dialogs'
import {
  SalaryPanel, PaymentStatusBadge, fmtDay, moneyMy, CompactEmpty,
} from './salary-shared'

export function SalaryPaymentsSection() {
  const payments = useSalaryStore((s) => s.payments)
  const teacherNames = useSalaryStore((s) => s.teacherNames)
  const data = useSalaryData()
  const { openRecordPayment, openEmployee } = useSalaryUI()

  const months = useMemo(() => periodOptions(6), [])
  const [month, setMonth] = useState(months[0])
  const [detail, setDetail] = useState<SalaryPayment | null>(null)
  const [voiding, setVoiding] = useState<SalaryPayment | null>(null)

  const monthPayments = useMemo(
    () => payments.filter((p) => p.month === month)
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt)),
    [payments, month],
  )

  const recorded = monthPayments.filter((p) => p.status === 'RECORDED')
  const voided = monthPayments.filter((p) => p.status === 'VOIDED')

  // Attention queue: teachers with a salary configured but no RECORDED
  // payment this month — the honest "still to pay" list.
  const unrecorded = data.currentMonth.unrecorded

  return (
    <div className="space-y-4">
      {/* Month selector + record action */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[70]">
              {months.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">{periodLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground hidden sm:block">
            {monthPayments.length} payment{monthPayments.length === 1 ? '' : 's'} · {periodLabel(month)}
          </p>
        </div>
        {/* Same contextual treatment as the Overview → Staff Salaries button */}
        <Button
          variant="outline" size="sm" className="h-7 text-[11px] gap-1"
          onClick={() => openRecordPayment({ month })}
        >
          <Wallet className="h-3 w-3" /> Record Payment
        </Button>
      </div>

      {/* KPI strip — same design language as Fee Management (SummaryCard) */}
      <SummaryCardGrid columns={4}>
        <SummaryCard
          icon={<Check className="h-4 w-4" />} label="Recorded"
          value={moneyMy(recorded.reduce((s, p) => s + p.amount, 0))}
          sub={`${recorded.length} payment${recorded.length === 1 ? '' : 's'}`}
          tone="emerald" delay={0}
        />
        <SummaryCard
          icon={<Undo2 className="h-4 w-4" />} label="Voided"
          value={moneyMy(voided.reduce((s, p) => s + p.amount, 0))}
          sub={`${voided.length} entr${voided.length === 1 ? 'y' : 'ies'} (audit trail)`}
          tone="slate" delay={0.05}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />} label="Month Payable"
          value={moneyMy(data.currentMonth.payable)}
          sub={`${data.analytics.configuredCount} salary set`}
          tone="sky" delay={0.1}
        />
        <SummaryCard
          icon={<IndianRupee className="h-4 w-4" />} label="Not Yet Recorded"
          value={String(unrecorded.length)}
          sub={unrecorded.length > 0 ? `${moneyMy(unrecorded.reduce((s, r) => s + r.monthly, 0))} to pay` : 'All recorded'}
          tone={unrecorded.length > 0 ? 'amber' : 'slate'} delay={0.15}
        />
      </SummaryCardGrid>

      {/* Not-yet-recorded attention strip (the honest to-pay queue) */}
      {unrecorded.length > 0 && month === data.periodKey && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <Wallet className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              {unrecorded.length} salary payment{unrecorded.length === 1 ? '' : 's'} not recorded for {periodLabel(month)}
            </p>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-300/70 mt-0.5">
              {unrecorded.map((r) => `${r.teacher.name} · ${moneyMy(r.monthly)}`).join('  ·  ')}
            </p>
          </div>
        </div>
      )}

      {/* Recorded — the canonical ledger */}
      <SalaryPanel title="Recorded" subtitle={`${recorded.length} payment${recorded.length === 1 ? '' : 's'} in the school ledger`}>
        {recorded.length === 0 ? (
          <CompactEmpty icon={<Ban className="h-3.5 w-3.5" />}>No recorded payments for {periodLabel(month)}</CompactEmpty>
        ) : (
          <div className="divide-y divide-border -mx-4">
            {recorded.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                teacherName={teacherNames[p.teacherId] ?? 'Teacher'}
                onNameClick={() => openEmployee(p.teacherId)}
              >
                <span className="font-mono text-[10px] text-muted-foreground hidden sm:block">{p.reference ?? ''}</span>
                <IconAction label="View" onClick={() => setDetail(p)}><Eye className="h-3.5 w-3.5" /></IconAction>
                <IconAction label="Void" onClick={() => setVoiding(p)}><Undo2 className="h-3.5 w-3.5" /></IconAction>
              </PaymentRow>
            ))}
          </div>
        )}
      </SalaryPanel>

      {/* Voided — collapsed history (the audit trail) */}
      {voided.length > 0 && (
        <SalaryPanel title="Voided" subtitle={`${voided.length} entr${voided.length === 1 ? 'y' : 'ies'} — kept for the audit trail`}>
          <div className="divide-y divide-border -mx-4 opacity-80">
            {voided.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                teacherName={teacherNames[p.teacherId] ?? 'Teacher'}
                onNameClick={() => openEmployee(p.teacherId)}
              >
                <IconAction label="View" onClick={() => setDetail(p)}><Eye className="h-3.5 w-3.5" /></IconAction>
              </PaymentRow>
            ))}
          </div>
        </SalaryPanel>
      )}

      <PaymentDetailDialog
        payment={detail}
        teacherName={detail ? teacherNames[detail.teacherId] : undefined}
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
      />
      <VoidPaymentDialog
        payment={voiding}
        teacherName={voiding ? teacherNames[voiding.teacherId] : undefined}
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
      />
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────

function PaymentRow({
  payment, teacherName, children, onNameClick, showMonth,
}: {
  payment: SalaryPayment
  teacherName: string
  children?: React.ReactNode
  onNameClick?: () => void
  showMonth?: boolean
}) {
  const initials = teacherName.split(' ').map((n) => n[0]).slice(0, 2).join('')
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-[10px] font-semibold bg-muted">{initials}</AvatarFallback>
      </Avatar>
      <button
        type="button"
        onClick={onNameClick}
        className={cn('min-w-0 flex-1 text-left', onNameClick && 'hover:underline underline-offset-2')}
      >
        <p className="text-xs font-semibold truncate">{teacherName}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {moneyMy(payment.amount)} · {payment.method ?? '—'} · {fmtDay(payment.paidOn)}
          {showMonth ? ` · ${periodLabel(payment.month)}` : ''}
          {payment.note ? ` — ${payment.note}` : ''}
        </p>
      </button>
      <PaymentStatusBadge status={payment.status} />
      {children && <div className="flex items-center gap-0.5 shrink-0">{children}</div>}
    </div>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {children}
    </button>
  )
}
