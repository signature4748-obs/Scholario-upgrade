'use client'

/**
 * SalaryEmployeeDrawer — per-teacher payroll drawer.
 *
 * PHASE 8B: two tabs — Salary (the configured fixed monthly salary,
 * editable directly by the principal via PUT /api/salary/structure) and
 * Payment History (the canonical rows, voidable with confirmation).
 * The approval/adjustment flows of the localStorage era are retired:
 * the principal sets the salary, records payments, voids mistakes.
 *
 * Structure: opaque sticky header (avatar · name · role) → tab bar →
 * independently-scrolling content. The sheet locks body scroll.
 */

import { useMemo, useState } from 'react'
import {
  Eye, IndianRupee, Pencil, Plus, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import {
  useSalaryStore, currentPeriodKey, periodLabel, SalaryApiError, type SalaryPayment,
} from '@/lib/store/salary-store'
import { useSalaryUI } from './salary-ui-context'
import { PaymentDetailDialog, VoidPaymentDialog } from './payment-dialogs'
import {
  fmtDay, fmtDayYear, moneyMy, PaymentStatusBadge, MonthlySalaryBadge,
} from './salary-shared'

export function SalaryEmployeeDrawer() {
  const { drawerTeacherId, closeEmployee, openRecordPayment } = useSalaryUI()
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)

  const [editOpen, setEditOpen] = useState(false)
  const [detail, setDetail] = useState<SalaryPayment | null>(null)
  const [voiding, setVoiding] = useState<SalaryPayment | null>(null)

  const teacher = teachers.find((t) => t.id === drawerTeacherId) ?? null
  const structure = drawerTeacherId
    ? structures.find((s) => s.teacherId === drawerTeacherId) ?? null
    : null
  const periodKey = currentPeriodKey()

  const empPayments = useMemo(
    () => payments.filter((p) => p.teacherId === drawerTeacherId)
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn)),
    [payments, drawerTeacherId],
  )

  if (!teacher) return null

  const recordedThisMonth = empPayments
    .filter((p) => p.month === periodKey && p.status === 'RECORDED')
    .reduce((s, p) => s + p.amount, 0)
  const initials = teacher.name.split(' ').map((n) => n[0]).slice(0, 2).join('')

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && closeEmployee()}>
        <SheetContent side="right" className="sm:max-w-md w-full p-0 gap-0 overflow-hidden flex flex-col">
          {/* Opaque sticky header */}
          <div className="shrink-0 bg-background border-b border-border px-5 pt-5 pb-4 pr-12">
            <div className="flex items-center gap-3">
              <Avatar className="h-11 w-11 shrink-0">
                <AvatarFallback className="text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <SheetTitle className="text-sm font-bold truncate text-left">{teacher.name}</SheetTitle>
                <SheetDescription className="text-[11px] truncate text-left">
                  {[teacher.employeeId, teacher.department].filter(Boolean).join(' · ') || '—'}
                </SheetDescription>
              </div>
            </div>
          </div>

          {/* Tabs: fixed bar + independently scrolling content */}
          <Tabs defaultValue="salary" className="flex-1 min-h-0 flex flex-col gap-0">
            <div className="shrink-0 bg-background border-b border-border px-5 py-2.5">
              <TabsList className="h-8 bg-muted/60 p-0.5">
                <TabsTrigger value="salary" className="text-[11px] h-7 px-3">Salary</TabsTrigger>
                <TabsTrigger value="payments" className="text-[11px] h-7 px-3">Payment History</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              {/* ── Salary ── */}
              <TabsContent value="salary" className="mt-0 space-y-4">
                {/* Employment profile — the drawer references the canonical
                    teacher record (no duplicate master data). */}
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Employment</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                    <div className="flex items-start justify-between gap-2"><span className="text-muted-foreground shrink-0">Employee ID</span><span className="font-mono font-medium">{teacher.employeeId || '—'}</span></div>
                    <div className="flex items-start justify-between gap-2"><span className="text-muted-foreground shrink-0">Status</span><span className="font-medium">Active</span></div>
                    <div className="col-span-2 flex items-start justify-between gap-2"><span className="text-muted-foreground shrink-0">Department</span><span className="font-medium text-right">{teacher.department || '—'}</span></div>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <MonthlySalaryBadge />
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                        Monthly Salary
                      </p>
                      <p className="text-2xl font-bold tabular-nums mt-1 leading-none">
                        {structure ? moneyMy(structure.monthlyAmount) : '—'}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {structure?.effectiveFrom ? `from ${fmtDayYear(structure.effectiveFrom)}` : structure ? 'no effective date set' : 'not configured'}
                    </p>
                  </div>
                  {structure?.note && (
                    <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t">{structure.note}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t">
                    One fixed amount per month — no components or deductions.
                  </p>
                </div>

                {/* This month */}
                <div className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">{periodLabel(periodKey)}</p>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => openRecordPayment({ teacherId: teacher.id, month: periodKey })}>
                      <Plus className="h-3 w-3" /> Payment
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Salary</p>
                      <p className="text-xs font-bold tabular-nums mt-0.5">{structure ? moneyMy(structure.monthlyAmount) : '—'}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5">
                      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Recorded</p>
                      <p className="text-xs font-bold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">{moneyMy(recordedThisMonth)}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Status</p>
                      <p className="text-xs font-bold mt-0.5">
                        {structure
                          ? (recordedThisMonth > 0 ? 'Recorded' : 'Unpaid')
                          : 'No salary'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-3 w-3" /> {structure ? 'Edit Monthly Salary' : 'Set Monthly Salary'}
                  </Button>
                </div>
              </TabsContent>

              {/* ── Payment History ── */}
              <TabsContent value="payments" className="mt-0 space-y-1.5">
                {empPayments.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No payments recorded yet.</p>
                )}
                {empPayments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold tabular-nums">
                        {moneyMy(p.amount)} <span className="text-muted-foreground font-normal">· {periodLabel(p.month)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {p.method ?? '—'} · {fmtDay(p.paidOn)}
                        {p.reference ? ` · ${p.reference}` : ''}
                        {p.note ? ` — ${p.note}` : ''}
                      </p>
                    </div>
                    <PaymentStatusBadge status={p.status} />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {p.status === 'RECORDED' && (
                        <button
                          type="button" title="Void" aria-label="Void payment"
                          onClick={() => setVoiding(p)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button" title="View" aria-label="View payment"
                        onClick={() => setDetail(p)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </div>
          </Tabs>
        </SheetContent>
      </Sheet>

      <SetMonthlySalaryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        teacherId={teacher.id}
        teacherName={teacher.name}
        structure={structure}
      />
      <PaymentDetailDialog payment={detail} teacherName={teacher.name} open={!!detail} onOpenChange={(o) => !o && setDetail(null)} />
      <VoidPaymentDialog payment={voiding} teacherName={teacher.name} open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} />
    </>
  )
}

// ─── Set / edit the fixed monthly salary (direct write — no approval) ─

/** Exported so the Teacher Profile → Payroll tab uses the exact same
 *  canonical editing flow as Salary & Payroll. */
export function SetMonthlySalaryDialog({
  open, onOpenChange, teacherId, teacherName, structure,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  teacherId: string
  teacherName: string
  structure: { monthlyAmount: number; effectiveFrom: string | null; note: string | null } | null
}) {
  const setStructure = useSalaryStore((s) => s.setStructure)

  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [key, setKey] = useState('')

  // Re-seed the form whenever the target changes.
  const targetKey = teacherId
  if (key !== targetKey) {
    setKey(targetKey)
    setAmount(structure ? String(structure.monthlyAmount) : '')
    setEffectiveFrom(structure?.effectiveFrom ? structure.effectiveFrom.slice(0, 10) : '')
    setNote(structure?.note ?? '')
    setSubmitting(false)
  }

  const amountNum = Number(amount) || 0
  const invalidAmount = amountNum <= 0 || amountNum > 5_000_000
  const selected = effectiveFrom ? new Date(`${effectiveFrom}T00:00:00`) : undefined

  const handleSave = async () => {
    if (submitting || invalidAmount) return
    setSubmitting(true)
    try {
      const row = await setStructure({
        teacherId,
        monthlyAmount: amountNum,
        effectiveFrom: effectiveFrom || undefined,
        note: note.trim() || undefined,
      })
      toast.success(structure ? 'Monthly salary updated' : 'Monthly salary set', {
        description: `${teacherName} · ${moneyMy(row.monthlyAmount)} / month`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof SalaryApiError || err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Pencil className="h-4 w-4" />
            </span>
            {structure ? 'Edit Monthly Salary' : 'Set Monthly Salary'}
          </DialogTitle>
          <DialogDescription>
            {teacherName} · current {structure ? moneyMy(structure.monthlyAmount) : 'not set'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ds-amount">Monthly Salary (₹)</Label>
            <div className="relative">
              <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="ds-amount"
                inputMode="numeric"
                className="pl-7 h-9 tabular-nums"
                placeholder={structure ? String(structure.monthlyAmount) : '25000'}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            {amount && invalidAmount && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400">
                Enter an amount between ₹1 and ₹50,00,000.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Effective From</Label>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full h-9 justify-start font-normal tabular-nums text-xs',
                      !effectiveFrom && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {effectiveFrom ? format(new Date(`${effectiveFrom}T00:00:00`), 'dd MMM yyyy') : <span>Optional</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[70] w-auto p-0 shadow-xl">
                  <Calendar
                    mode="single"
                    selected={selected}
                    defaultMonth={selected ?? new Date()}
                    onSelect={(d) => {
                      if (d) {
                        setEffectiveFrom(format(d, 'yyyy-MM-dd'))
                        setCalOpen(false)
                      }
                    }}
                    className="w-[268px] p-2"
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ds-note">Note</Label>
              <Input
                id="ds-note"
                className="h-9 text-xs"
                placeholder="e.g. Annual increment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20 px-3 py-2">
            <IndianRupee className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Saved to the school&apos;s payroll ledger</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => void handleSave()}
            disabled={!amountNum || invalidAmount || submitting}
          >
            {submitting ? 'Saving…' : structure ? 'Save Changes' : 'Set Salary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
