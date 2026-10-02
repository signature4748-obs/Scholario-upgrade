'use client'

/**
 * RecordPaymentDialog — Principal records one monthly salary payment.
 *
 * PHASE 8B: fixed-MONTHLY-salary model — the dialog carries exactly the
 * canonical fields: teacher, month (YYYY-MM), amount (defaults to the
 * teacher's configured monthly salary), paid-on date, method, reference
 * and note. Submitting writes the canonical row via POST /api/salary/
 * payments; a 409 SALARY_PAYMENT_DUPLICATE response (the same teacher +
 * month already RECORDED) is surfaced with the existing row's details.
 *
 * The date picker is a Popover-portal calendar with collision flipping:
 * it opens below when there is room and above when there is not, never
 * overlaps the method field, never shifts the form, and never clips.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarIcon, IndianRupee } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  useSalaryStore, type SalaryMethod, type SalaryApiError,
  METHOD_KEYS, METHOD_LABELS, periodOptions, periodLabel,
} from '@/lib/store/salary-store'
import { moneyMy } from './salary-shared'

// ─── Date field (portal calendar, collision-safe) ────────────────────

function PaymentDateField({ value, onChange, id }: { value: string; onChange: (iso: string) => void; id: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Placement is measured when the popover opens: flip to whichever side
  // has more room and clamp the height so the calendar can never clip
  // outside the viewport (it scrolls internally instead).
  const [placement, setPlacement] = useState<{ side: 'top' | 'bottom'; maxHeight: number }>({ side: 'bottom', maxHeight: 320 })

  const selected = useMemo(() => {
    if (!value) return undefined
    const d = new Date(`${value}T00:00:00`)
    return isNaN(d.getTime()) ? undefined : d
  }, [value])

  const handleOpenChange = (next: boolean) => {
    if (next && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 16
      const above = r.top - 16
      // Prefer opening upward so the calendar never covers the fields
      // below the date (method / reference). Fall back downward only when
      // the top genuinely lacks room, clamped to the viewport.
      const side: 'top' | 'bottom' = above >= 240 ? 'top' : 'bottom'
      const space = side === 'bottom' ? below : above
      setPlacement({ side, maxHeight: Math.max(200, Math.min(320, space)) })
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full h-9 justify-start font-normal tabular-nums',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {value ? format(new Date(`${value}T00:00:00`), 'dd MMM yyyy') : <span>Paid on</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={placement.side}
        sideOffset={6}
        collisionPadding={8}
        className="z-[70] w-auto p-0 shadow-xl"
        style={{ maxHeight: placement.maxHeight + 4, overflow: 'hidden' }}
      >
        <div className="overflow-y-auto salary-scroll" style={{ maxHeight: placement.maxHeight }}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? new Date()}
            onSelect={(d) => {
              if (d) {
                onChange(format(d, 'yyyy-MM-dd'))
                setOpen(false)
              }
            }}
            className="w-[268px] p-2"
            autoFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Dialog ──────────────────────────────────────────────────────────

interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teacherId?: string
  /** Pre-selected salary month ('YYYY-MM') — e.g. from a month cell. */
  month?: string
}

export function RecordPaymentDialog({ open, onOpenChange, teacherId, month: presetMonth }: RecordPaymentDialogProps) {
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const payments = useSalaryStore((s) => s.payments)
  const recordPayment = useSalaryStore((s) => s.recordPayment)

  const months = useMemo(() => periodOptions(6), [])

  const [empId, setEmpId] = useState('')
  const [month, setMonth] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [method, setMethod] = useState<SalaryMethod>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [duplicate, setDuplicate] = useState<string | null>(null)

  // Reset / prefill each time the dialog opens.
  useEffect(() => {
    if (!open) return
    const emp = teacherId ?? teachers[0]?.id ?? ''
    setEmpId(emp)
    setMonth(presetMonth ?? months[0])
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setMethod('BANK_TRANSFER')
    setReference('')
    setNote('')
    setSubmitting(false)
    setDuplicate(null)
  }, [open, teacherId, presetMonth, teachers, months])

  const teacher = teachers.find((t) => t.id === empId)

  // The teacher's configured monthly salary — the default amount.
  const monthly = useMemo(
    () => structures.find((s) => s.teacherId === empId)?.monthlyAmount ?? 0,
    [structures, empId],
  )
  // Already RECORDED this teacher-month? (Duplicate protection is
  // server-authoritative; this is the honest pre-flight signal.)
  const alreadyRecorded = useMemo(
    () => payments.some((p) => p.teacherId === empId && p.month === month && p.status === 'RECORDED'),
    [payments, empId, month],
  )

  // Default the amount to the configured monthly salary.
  useEffect(() => {
    if (monthly > 0) setAmount(String(monthly))
  }, [empId, monthly])

  const amountNum = Number(amount) || 0

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    setDuplicate(null)
    try {
      const row = await recordPayment({
        teacherId: empId,
        month,
        amount: amountNum,
        paidOn: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      })
      toast.success('Payment recorded', {
        description: `${teacher?.name ?? 'Teacher'} · ${moneyMy(row.amount)} · ${periodLabel(month)}`,
        classNames: {
          description: '!text-xs !font-medium !text-zinc-700 dark:!text-zinc-300',
        },
      })
      onOpenChange(false)
    } catch (err) {
      const apiErr = err as SalaryApiError
      if (apiErr && typeof apiErr === 'object' && apiErr.code === 'SALARY_PAYMENT_DUPLICATE') {
        // Server-authoritative duplicate: show the existing row clearly.
        const ex = apiErr.existing
        const detail = ex
          ? `${ex.teacher?.user?.name ?? teacher?.name ?? 'Teacher'} · ${periodLabel(ex.month)} · ${moneyMy(ex.amount)} — recorded ${ex.paidOn.slice(0, 10)}${ex.method ? ` · ${ex.method}` : ''}. Void it first to re-record.`
          : apiErr.message
        setDuplicate(detail)
        toast.error('Payment already recorded', { description: detail })
      } else {
        toast.error('Could not record payment', {
          description: err instanceof Error ? err.message : 'Check the payment details.',
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <IndianRupee className="h-4 w-4" />
            </span>
            Record Payment
          </DialogTitle>
          <DialogDescription>
            {teacher ? `${teacher.name}${teacher.employeeId ? ` · ${teacher.employeeId}` : ''}` : 'Monthly salary payment'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Teacher & month */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Teacher</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent className="z-[70] max-h-72">
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  {months.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {periodLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Monthly salary context */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
              <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Monthly Salary</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{monthly > 0 ? moneyMy(monthly) : 'Not set'}</p>
            </div>
            <div className={cn(
              'rounded-lg px-2.5 py-2',
              alreadyRecorded ? 'bg-amber-500/[0.07]' : 'bg-emerald-500/[0.07]',
            )}>
              <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">This Month</p>
              <p className={cn(
                'text-sm font-bold mt-0.5',
                alreadyRecorded ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
              )}>
                {alreadyRecorded ? 'Already recorded' : 'Not recorded yet'}
              </p>
            </div>
          </div>

          {/* Amount & date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="rp-amount">Amount</Label>
              <div className="relative">
                <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="rp-amount"
                  inputMode="numeric"
                  className="pl-7 h-9 tabular-nums"
                  placeholder={monthly > 0 ? String(monthly) : '0'}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="rp-date">Paid On</Label>
              <PaymentDateField id="rp-date" value={date} onChange={setDate} />
            </div>
          </div>

          {/* Method & reference */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as SalaryMethod)}>
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  {METHOD_KEYS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="rp-ref">Reference No.</Label>
              <Input
                id="rp-ref"
                className="h-9 text-xs"
                placeholder={method === 'CHEQUE' ? 'CHQ-5521' : method === 'UPI' ? 'UPI-77213' : 'NEFT-88341'}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="rp-note">Note</Label>
            <Input
              id="rp-note"
              className="h-9 text-xs"
              placeholder="Optional — e.g. includes arrears"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Duplicate / state note — one icon line, no sentences */}
          {duplicate ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-amber-500/[0.07] border border-amber-500/20 px-3 py-2">
              <IndianRupee className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{duplicate}</p>
            </div>
          ) : alreadyRecorded ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/[0.07] border border-amber-500/20 px-3 py-2">
              <CalendarIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">A payment is already recorded for this month</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20 px-3 py-2">
              <IndianRupee className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Saved to the school&apos;s payroll ledger</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => void handleSubmit()}
            disabled={!empId || !month || !amountNum || !date || !!duplicate}
          >
            {submitting ? 'Recording…' : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
