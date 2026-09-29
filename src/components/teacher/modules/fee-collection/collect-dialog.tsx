'use client'

/**
 * CollectFeeDialog — STAGE 1 of the two-stage collection workflow
 * (MASTER TASK §34).
 *
 * The class teacher records a payment they collected from a student of
 * their class. The form shows the full money context (amount due /
 * previous paid / balance) BEFORE the amount field, offers the method +
 * reference + notes trail, and requires an explicit confirmation line
 * ("I am recording a payment of ₹2,000 from Aarav Sharma.").
 *
 * On success it NEVER says "payment successful" — the honest result is
 * the COLLECTION ACKNOWLEDGEMENT: recorded, awaiting Principal
 * verification, not a final receipt (§47: no fake workflow).
 */

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GradientAvatar } from '@/components/shared/ui'
import { formatINR } from '@/lib/format'
import { methodLabel } from '@/components/shared/fee-collection/txn-meta'
import type { CollectionStudent, CollectResult, FeeClassPayload } from './types'
import { BadgeCheck, Banknote, CheckCircle2, Clock3, FileText, Hash, Loader2, Wallet } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  klass: FeeClassPayload
  /** pre-selected student (e.g. "Collect" from a ledger row) */
  studentId?: string
  onCollect: (body: { studentId: string; feeId: string; amount: number; method: string; referenceNumber?: string; notes?: string }) => Promise<CollectResult>
}

export function CollectFeeDialog({ open, onOpenChange, klass, studentId, onCollect }: Props) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('')
  const [feeId, setFeeId] = useState<string>('')
  const [amountRaw, setAmountRaw] = useState<string>('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CollectResult | null>(null)

  // Students with at least one open fee item.
  const eligible = useMemo(
    () => (klass.students ?? []).filter((s) => (s.ledger?.items ?? []).some((i) => i.outstanding > 0)),
    [klass],
  )

  useEffect(() => {
    if (!open) return
    setError(null)
    setResult(null)
    setFeeId('')
    setAmountRaw('')
    setReference('')
    setNotes('')
    setMethod('CASH')
    setSelectedStudentId(studentId && eligible.some((s) => s.id === studentId) ? studentId : '')
  }, [open, studentId, eligible])

  const student: CollectionStudent | undefined = eligible.find((s) => s.id === selectedStudentId)
  const openItems = useMemo(
    () => (student?.ledger?.items ?? []).filter((i) => i.outstanding > 0),
    [student],
  )
  const feeItem = openItems.find((i) => i.id === feeId)

  useEffect(() => {
    // When the student changes, auto-select their oldest open fee and
    // prefill the amount with its balance.
    if (!student) return
    const first = (student.ledger?.items ?? []).find((i) => i.outstanding > 0)
    setFeeId(first?.id ?? '')
    setAmountRaw(first ? String(first.outstanding) : '')
  }, [selectedStudentId])

  useEffect(() => {
    // When the fee selection changes, sync the amount to its balance
    // (the teacher can still lower it for a partial payment).
    if (feeItem) setAmountRaw(String(feeItem.outstanding))
  }, [feeId])

  const amount = Number(amountRaw)
  const amountValid = Number.isFinite(amount) && amount > 0 && feeItem ? amount <= feeItem.outstanding : false

  const submit = async () => {
    if (!selectedStudentId || !feeId || !amountValid) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await onCollect({
        studentId: selectedStudentId,
        feeId,
        amount,
        method,
        referenceNumber: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the collection.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        {result ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                {result.acknowledgement.headline}
              </DialogTitle>
              <DialogDescription className="text-left text-xs leading-relaxed">
                {result.acknowledgement.body}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border divide-y text-xs">
              <Row label="Student" value={`${result.txn.studentName} · ${result.txn.className ?? ''}`} />
              <Row label="Fee" value={result.txn.feeHeadName ?? '—'} />
              <Row label="Amount" value={formatINR(result.txn.amount)} strong />
              <Row label="Method" value={methodLabel(result.txn.method)} />
              <Row
                label="Status"
                value={
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                    <Clock3 className="h-3 w-3" /> Awaiting Principal verification
                  </span>
                }
              />
            </div>
            <p className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              The student&rsquo;s fee balance has <strong>not</strong> changed yet — pending collections are
              not paid money. The balance updates when the Principal verifies this payment and the final
              receipt (SCH-…) is issued. You will be notified.
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4.5 w-4.5 text-emerald-600" />
                Collect Fee — {klass.label}
              </DialogTitle>
              <DialogDescription className="text-left">
                Record a payment you collected from a student of your class. The Principal verifies it
                before it becomes a final receipt.
              </DialogDescription>
            </DialogHeader>

            {/* Student */}
            <div className="space-y-1.5">
              <Label className="text-xs">Student</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a student" /></SelectTrigger>
                <SelectContent>
                  {eligible.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.rollNo ? `${s.rollNo} · ` : ''}{s.name}
                    </SelectItem>
                  ))}
                  {eligible.length === 0 && <div className="p-2 text-xs text-muted-foreground">No open fees in this class.</div>}
                </SelectContent>
              </Select>
            </div>

            {student && (
              <>
                {/* Fee context + selection */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Fee</Label>
                  <Select value={feeId} onValueChange={setFeeId}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select the fee being paid" /></SelectTrigger>
                    <SelectContent>
                      {openItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.title} · balance {formatINR(i.outstanding, true)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {feeItem && (
                  <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-3 text-center">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amount due</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatINR(feeItem.amount, true)}</p>
                    </div>
                    <div className="border-x">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Previous paid</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(feeItem.paid, true)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Balance</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">{formatINR(feeItem.outstanding, true)}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="collect-amount">Amount to collect</Label>
                  <div className="relative">
                    <Banknote className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="collect-amount"
                      inputMode="decimal"
                      className="h-9 pl-8 tabular-nums"
                      placeholder="0"
                      value={amountRaw}
                      onChange={(e) => setAmountRaw(e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                  </div>
                  {feeItem && Number(amountRaw) > feeItem.outstanding && (
                    <p className="text-[11px] text-destructive">
                      Exceeds the balance ({formatINR(feeItem.outstanding)}). Partial payments are allowed — overpayments are not.
                    </p>
                  )}
                  {feeItem && amountValid && amount < feeItem.outstanding && (
                    <p className="text-[11px] text-muted-foreground">Partial payment — the remaining {formatINR(feeItem.outstanding - amount)} stays due.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Payment method</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['CASH', 'UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER'].map((m) => (
                          <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor="collect-ref">Reference no. <span className="text-muted-foreground">(optional)</span></Label>
                    <div className="relative">
                      <Hash className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input id="collect-ref" className="h-9 pl-8 text-sm" placeholder="UPI / cheque ref" value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="collect-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
                  <div className="relative">
                    <FileText className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input id="collect-notes" className="h-9 pl-8 text-sm" placeholder="e.g. father paid at PTM" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>

                {/* Confirmation line (§34) */}
                {student && amountValid && feeItem && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <GradientAvatar name={student.name} size="sm" />
                    <p className="text-xs leading-relaxed text-emerald-900 dark:text-emerald-200">
                      I am recording a payment of <strong>{formatINR(amount)}</strong> from{' '}
                      <strong>{student.name}</strong> towards <strong>{feeItem.title}</strong>. The Principal
                      will verify it before the final receipt is issued.
                    </p>
                  </div>
                )}

                {error && <p className="text-xs text-destructive">{error}</p>}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
                  <Button
                    className="flex-1 gap-1.5"
                    disabled={!amountValid || submitting}
                    onClick={submit}
                  >
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                    {submitting ? 'Recording…' : 'Record collection'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? 'font-bold tabular-nums' : 'font-medium'}`}>{value}</span>
    </div>
  )
}
