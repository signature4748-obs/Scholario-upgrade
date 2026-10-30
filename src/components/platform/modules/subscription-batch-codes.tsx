'use client'

// ============================================================
// subscription-batch-codes — SHARED batch activation-code dialog
// ------------------------------------------------------------
// Extracted (verbatim behaviour) from school-subscription.tsx so the
// GLOBAL Access Codes section (/platform/codes) and the school's own
// Codes sub-tab drive the SAME issuance surface — one flow, one audit
// trail, one one-time-display contract. Issuance is always bound to a
// school (schoolId prop): the global page picks the school first.
//
// The result shows requested vs generated and the plaintext codes ONCE
// (OneTimeCodeBlock contract — never shown again by any view).
// ============================================================

import React, { useEffect, useState } from 'react'
import { BadgeCheck, KeyRound, Loader2 } from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { OneTimeCodeBlock, PlanPicker, type StudentRow, type StaffRow } from './subscription-shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export interface BatchItem {
  codeId: string
  publicRef: string
  code: string
  assignedId: string | null
  expiresAt: string
}

export type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

export const BATCH_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Request failed'
}

/**
 * Batch activation-code generation (STUDENT / STAFF scopes). Bindings:
 * plan (product), scope, quantity, validity dates, redemption deadline,
 * assignment policy (open claim vs pre-assigned members), backing
 * (verified payment vs permission-gated complimentary) and the audited
 * reason.
 */
export function BatchCodesDialog({ schoolId, gate, onClose, onDone }: { schoolId: string; gate: GateFn; onClose: () => void; onDone: () => void }) {
  const [scope, setScope] = useState<'STUDENT_ENTITLEMENT' | 'STAFF_ENTITLEMENT'>('STUDENT_ENTITLEMENT')
  const [form, setForm] = useState({
    planCode: '', quantity: '10', claimWindowDays: '30', validityMonths: '12',
    validityStart: '', validityEnd: '', assignment: 'OPEN', backing: 'PAYMENT',
    amountPerCode: '', currency: 'INR', notes: '',
  })
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [memberQ, setMemberQ] = useState('')
  const [memberOptions, setMemberOptions] = useState<Array<{ id: string; label: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ requested: number; generated: number; message: string; items: BatchItem[]; batchPayment: { receiptNo: string } | null } | null>(null)

  // Member search for the ASSIGNED policy (students or teachers by scope).
  useEffect(() => {
    if (form.assignment !== 'ASSIGNED') return
    const t = setTimeout(() => {
      const path = scope === 'STUDENT_ENTITLEMENT'
        ? `/api/platform/schools/${schoolId}/students?q=${encodeURIComponent(memberQ)}&pageSize=50`
        : `/api/platform/schools/${schoolId}/staff?q=${encodeURIComponent(memberQ)}&pageSize=50`
      platformApi<{ students?: StudentRow[]; staff?: StaffRow[] }>(path)
        .then((d) => {
          setMemberOptions(
            d.students?.map((s) => ({ id: s.studentId, label: `${s.name} (${s.class ?? s.email})` }))
              ?? d.staff?.map((s) => ({ id: s.id, label: `${s.name ?? ''} (${s.email})` }))
              ?? [],
          )
        })
        .catch(() => setMemberOptions([]))
    }, 250)
    return () => clearTimeout(t)
  }, [form.assignment, scope, schoolId, memberQ])

  const quantity = Number(form.quantity.replace(/[^0-9]/g, '') || '0')
  const canSubmit =
    form.planCode !== '' &&
    quantity >= 1 && quantity <= 200 &&
    form.notes.trim().length >= 10 &&
    (form.assignment === 'OPEN' || assignedIds.length === quantity)

  const submit = async () => {
    if (!canSubmit) {
      setError(
        form.planCode === ''
          ? 'Select a plan first.'
          : form.notes.trim().length < 10
            ? 'Add an audited reason (at least 10 characters).'
            : form.assignment === 'ASSIGNED'
              ? `Select exactly ${quantity} member${quantity === 1 ? '' : 's'} — one per code.`
              : 'Set a quantity between 1 and 200.',
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const d = await gate(() =>
        platformApi<{ requested: number; generated: number; message: string; items: BatchItem[]; batchPayment: { receiptNo: string } | null }>(
          '/api/platform/subscriptions/codes/batch',
          {
            method: 'POST',
            body: JSON.stringify({
              schoolId,
              scope,
              planCode: form.planCode,
              quantity,
              claimWindowDays: Number(form.claimWindowDays || 30),
              validityMonths: Number(form.validityMonths || 12),
              validityStart: form.validityStart ? new Date(form.validityStart).toISOString() : undefined,
              validityEnd: form.validityEnd ? new Date(form.validityEnd).toISOString() : undefined,
              assignment: form.assignment,
              assignedIds: form.assignment === 'ASSIGNED' ? assignedIds : undefined,
              backing: form.backing,
              amountPerCode: form.amountPerCode !== '' ? Number(form.amountPerCode) : undefined,
              currency: form.currency,
              notes: form.notes.trim(),
            }),
          },
        ),
      )
      if (!d) return // cancelled at the step-up prompt
      setResult(d)
      onDone()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const copyAll = () => {
    if (!result) return
    const text = result.items.map((i) => `${i.publicRef}: ${i.code}`).join('\n')
    void navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !result) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <KeyRound className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Generate activation codes (batch)
          </DialogTitle>
          <DialogDescription>
            Every code binds to this school, the chosen plan and the validity policy. Plaintext codes are shown ONCE
            below — at rest only a keyed verifier is stored.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-semibold">{result.generated} of {result.requested}</span> codes generated
              {result.batchPayment?.receiptNo && <> — batch payment receipt <span className="font-mono text-xs">{result.batchPayment.receiptNo}</span></>}.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto custom-scrollbar pr-1">
              {result.items.map((i) => (
                <OneTimeCodeBlock
                  key={i.codeId}
                  code={{ publicRef: i.publicRef, code: i.code, expiresAt: i.expiresAt }}
                  hint="Shown once — copy and deliver out-of-band."
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={copyAll}>Copy all</Button>
              <DialogFooter className="gap-2">
                <Button onClick={() => { onClose() }}>Done</Button>
              </DialogFooter>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Who redeems</Label>
                <Select value={scope} onValueChange={(v) => { setScope(v as 'STUDENT_ENTITLEMENT' | 'STAFF_ENTITLEMENT'); setAssignedIds([]) }}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="STUDENT_ENTITLEMENT">Students (one code per student seat)</SelectItem>
                    <SelectItem value="STAFF_ENTITLEMENT">Teachers / staff (one code per seat)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Plan (product)</Label>
                <PlanPicker
                  scope={scope === 'STUDENT_ENTITLEMENT' ? 'STUDENT' : 'STAFF'}
                  value={form.planCode}
                  onChange={(v) => setForm((f) => ({ ...f, planCode: v }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Quantity (1–200)</Label>
                <Input
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="bg-white"
                />
              </div>
              <div>
                <Label className="text-xs">Redeem within (days)</Label>
                <Input
                  inputMode="numeric"
                  value={form.claimWindowDays}
                  onChange={(e) => setForm((f) => ({ ...f, claimWindowDays: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="bg-white"
                />
              </div>
              <div>
                <Label className="text-xs">Validity (months)</Label>
                <Input
                  inputMode="numeric"
                  value={form.validityMonths}
                  onChange={(e) => setForm((f) => ({ ...f, validityMonths: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Access starts (optional)</Label>
                <Input type="date" value={form.validityStart} onChange={(e) => setForm((f) => ({ ...f, validityStart: e.target.value }))} className="bg-white" />
              </div>
              <div>
                <Label className="text-xs">Access expires (optional — overrides months)</Label>
                <Input type="date" value={form.validityEnd} onChange={(e) => setForm((f) => ({ ...f, validityEnd: e.target.value }))} className="bg-white" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Assignment</Label>
                <Select value={form.assignment} onValueChange={(v) => setForm((f) => ({ ...f, assignment: v }))}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="OPEN">Open — any eligible member can claim</SelectItem>
                    <SelectItem value="ASSIGNED">Pre-assigned — one specific member per code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Backed by</Label>
                <Select value={form.backing} onValueChange={(v) => setForm((f) => ({ ...f, backing: v }))}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="PAYMENT">Verified payment (recorded now)</SelectItem>
                    <SelectItem value="COMPLIMENTARY">Complimentary grant (permission-gated)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.backing === 'PAYMENT' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Amount per code</Label>
                  <Input inputMode="decimal" value={form.amountPerCode} onChange={(e) => setForm((f) => ({ ...f, amountPerCode: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="plan price" className="bg-white" />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-white">{BATCH_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {form.assignment === 'ASSIGNED' && (
              <div>
                <Label className="text-xs">
                  Members ({assignedIds.length}/{quantity || '?'} selected) — one per code, in order
                </Label>
                <Input
                  type="search"
                  value={memberQ}
                  onChange={(e) => setMemberQ(e.target.value)}
                  placeholder={scope === 'STUDENT_ENTITLEMENT' ? 'Search students…' : 'Search teachers…'}
                  className="mt-1 bg-white"
                />
                <div className="mt-1 max-h-32 overflow-y-auto custom-scrollbar rounded-lg border border-slate-200">
                  {memberOptions.map((m) => {
                    const selected = assignedIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${selected ? 'bg-teal-50 text-teal-800' : ''}`}
                        onClick={() =>
                          setAssignedIds((ids) =>
                            selected ? ids.filter((x) => x !== m.id) : ids.length < (quantity || 0) ? [...ids, m.id] : ids,
                          )
                        }
                      >
                        <span className="truncate">{m.label}</span>
                        {selected && <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      </button>
                    )
                  })}
                  {memberOptions.length === 0 && (
                    <p className="px-3 py-2 text-xs text-slate-400">No matches — search by name or email.</p>
                  )}
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Audited reason (required)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Why this batch is being issued (recorded in the audit trail)" className="bg-white" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void submit()} disabled={busy || !canSubmit} className="bg-teal-600 hover:bg-teal-700 text-white">
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Generate {quantity || ''} code{quantity === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
