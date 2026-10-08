'use client'

import { useEffect, useState } from 'react'
import { Lock, Coins, ShieldCheck, ShieldAlert, Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { DatePicker } from '@/components/ui/date-picker'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { formatINR } from '@/lib/format'
import { useSalaryStore } from '@/lib/store/salary-store'
// Slip letterhead — the identity cascade (server → settings → neutral).
import { useSchoolProfile } from '@/lib/school-profile'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import type { TeacherCredentials } from './use-teachers-state'

interface CommonProps {
  open: boolean
  onClose: () => void
}

/* ---------- LOCK / UNLOCK ACCOUNT MODAL ---------- */
interface LockModalProps extends CommonProps {
  teacher: TeacherRecord | null
  lockConfirmText: string
  setLockConfirmText: (v: string) => void
  /** 7-B — honest in-flight + failure states (server-backed lock). */
  submitting: boolean
  error: string | null
  onConfirm: () => void
}

export function LockAccountModal({
  teacher, lockConfirmText, setLockConfirmText, submitting, error, open, onClose, onConfirm,
}: LockModalProps) {
  const requiredWord = teacher?.isLocked ? 'UNLOCK' : 'LOCK'
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !submitting) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <Lock className="h-5 w-5" /> {teacher?.isLocked ? 'Unlock Teacher Account' : 'Lock Teacher Account'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {teacher?.isLocked
              ? `Restore portal login access for ${teacher?.name}.`
              : `Temporarily lock portal login access for ${teacher?.name}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <p className="text-muted-foreground">
            Type <strong className="text-foreground font-mono">{requiredWord}</strong> to confirm:
          </p>
          <Input
            value={lockConfirmText}
            onChange={(e) => setLockConfirmText(e.target.value)}
            placeholder={`Type ${requiredWord}`}
            className="font-mono text-xs uppercase"
            disabled={submitting}
          />
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            variant={teacher?.isLocked ? 'default' : 'destructive'}
            onClick={onConfirm}
            disabled={submitting || lockConfirmText.trim().toUpperCase() !== requiredWord}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {teacher?.isLocked ? 'Unlock Account' : 'Lock Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- CREDENTIALS SLIP MODAL ---------- */
interface CredentialsModalProps extends CommonProps {
  credentials: TeacherCredentials | null
}

export function CredentialsSlipModal({ credentials, open, onClose }: CredentialsModalProps) {
  /**
   * SECURITY: the temporary passcode is masked by default. The reveal flag is
   * local component state only (never persisted anywhere) and resets whenever
   * the slip is re-opened or a different teacher's credentials are displayed.
   */
  const [passcodeRevealed, setPasscodeRevealed] = useState(false)
  const schoolProfile = useSchoolProfile()

  useEffect(() => {
    setPasscodeRevealed(false)
  }, [open, credentials])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="gap-0 p-0 max-w-[calc(100vw-2rem)] sm:max-w-sm">
        {/* Official credential document (slip) */}
        <div className="px-5 py-5 sm:px-6">
          {/* Institutional letterhead */}
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Scholario
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {schoolProfile.name}
            </p>
          </div>
          <Separator className="mt-4" />

          {/* Document title */}
          <DialogTitle className="mt-5 text-center text-lg font-semibold tracking-tight text-foreground">
            Teacher Portal Credentials
          </DialogTitle>
          <DialogDescription className="sr-only">
            Portal sign-in credentials issued to {credentials?.name ?? 'the teacher'}.
          </DialogDescription>

          {credentials && (
            <>
              {/* Document rows */}
              <dl className="mt-4 divide-y divide-border border-y border-border">
                <div className="py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Teacher</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">{credentials.name}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Employee ID</dt>
                  <dd className="mt-1 font-mono text-sm text-foreground">{credentials.empId}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Portal Username</dt>
                  <dd className="mt-1 break-all text-sm text-foreground">{credentials.username}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Temporary Passcode</dt>
                  <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {passcodeRevealed ? (
                      <code className="break-all font-mono text-sm font-semibold tracking-wide text-foreground">
                        {credentials.tempPassword}
                      </code>
                    ) : (
                      <span className="font-mono text-sm tracking-[0.3em] text-muted-foreground">
                        ••••••••••
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setPasscodeRevealed((v) => !v)}
                      aria-label={passcodeRevealed ? 'Hide temporary passcode' : 'Show temporary passcode'}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    >
                      {passcodeRevealed ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </dd>
                </div>
              </dl>

              {/* Security note */}
              <div className="mt-4 border-l-2 border-amber-500/60 bg-amber-500/[0.04] py-2 pl-3.5 pr-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">This passcode is temporary.</span>{' '}
                  Please change it after first sign-in.
                </p>
              </div>

              {/* Issue footer — signature block */}
              <Separator className="mt-5" />
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-[11px] text-muted-foreground">Issued by School Administration</p>
                <p className="text-[11px] text-muted-foreground">{format(new Date(), 'd MMMM yyyy')}</p>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={onClose} className="h-9 px-4 text-xs">
            Close
          </Button>
          <Button
            variant="default"
            onClick={() => {
              navigator.clipboard.writeText(`Employee ID: ${credentials?.empId}\nUsername: ${credentials?.username}\nTemp Passcode: ${credentials?.tempPassword}`)
              toast.success('Login details copied to clipboard!')
            }}
            className="h-9 px-4 text-xs"
          >
            <Copy className="h-3.5 w-3.5" /> Copy Credentials
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- MONTHLY SALARY STRUCTURE MODAL (7-C, server-backed) ---------- */
interface SalaryStructureModalProps extends CommonProps {
  teacher: TeacherRecord | null
  amountInput: string
  setAmountInput: (v: string) => void
  effectiveFromInput: string
  setEffectiveFromInput: (v: string) => void
  /** Honest in-flight + failure states for the PUT /api/salary/structure call. */
  submitting: boolean
  error: string | null
  onConfirm: () => void
}

/**
 * 7-C — the REAL salary-structure dialog (replaces the fabricated
 * PAY-XXXXXX payroll-revision flow). One fixed monthly amount + an
 * optional effective date, written through PUT /api/salary/structure
 * (zod strict, per-teacher upsert, SALARY_STRUCTURE_SET audit). No
 * HRA/PF/tax/gross/basic/net arithmetic exists — fixed amount only.
 * Payments, receipts and history remain in the Salary & Payroll module.
 */
export function SalaryStructureModal({
  teacher, amountInput, setAmountInput, effectiveFromInput, setEffectiveFromInput,
  submitting, error, open, onClose, onConfirm,
}: SalaryStructureModalProps) {
  const currentMonthly = useSalaryStore(
    (st) => st.structures.find((x) => x.teacherId === teacher?.id)?.monthlyAmount ?? null,
  )

  const amountNum = Math.floor(Number(amountInput) || 0)
  const invalidAmount = amountInput !== '' && (amountNum <= 0 || amountNum > 5_000_000)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !submitting) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Coins className="h-5 w-5" /> {currentMonthly != null ? 'Edit Monthly Salary' : 'Set Monthly Salary'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {teacher?.name} · current {currentMonthly != null ? formatINR(currentMonthly) : 'not set'} · saved on the school payroll record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="p-3 bg-muted/40 rounded-xl space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Teacher Name &amp; ID:</span>
              <span className="font-semibold">{teacher?.name} ({teacher?.employeeId})</span>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1 block">Monthly Salary (₹ INR)</Label>
            <Input
              inputMode="numeric"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
              className="font-mono text-base font-bold"
              placeholder="e.g. 42000"
              disabled={submitting}
            />
            {invalidAmount && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1">
                Enter a whole monthly amount between ₹1 and ₹50,00,000.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1 block">Effective From</Label>
            <DatePicker
              value={effectiveFromInput}
              onChange={(v) => { if (v) setEffectiveFromInput(v) }}
              placeholder="Select date"
              compact
                formatStr="d MMM yyyy"
              className="h-9"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {effectiveFromInput
                ? `Applies from ${format(new Date(`${effectiveFromInput}T00:00:00`), 'd MMMM yyyy')}`
                : 'Recorded on the structure as its effective date.'}
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 space-y-1 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300">
            <p className="font-bold flex items-center gap-1 text-[11px]">
              <ShieldCheck className="h-4 w-4 text-emerald-700" /> One fixed amount — no components
            </p>
            <p className="text-[10px] leading-relaxed text-emerald-800 dark:text-emerald-300/90">
              The salary is a single fixed monthly amount. Payments, receipts and payment history are recorded from the Salary &amp; Payroll module.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            onClick={onConfirm}
            disabled={submitting || amountInput === '' || invalidAmount}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save Monthly Salary
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- STAFF RELIEVE / TERMINATION MODAL ---------- */
interface TerminationModalProps extends CommonProps {
  teacher: TeacherRecord | null
  terminationReason: string
  setTerminationReason: (v: string) => void
  confirmTerminateText: string
  setConfirmTerminateText: (v: string) => void
  lockLoginOnTerminate: boolean
  setLockLoginOnTerminate: (v: boolean) => void
  onConfirm: () => void
}

export function TerminationModal({
  teacher, terminationReason, setTerminationReason,
  confirmTerminateText, setConfirmTerminateText,
  lockLoginOnTerminate, setLockLoginOnTerminate,
  open, onClose, onConfirm,
}: TerminationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <ShieldAlert className="h-5 w-5" /> Relieve / Terminate Faculty Staff
          </DialogTitle>
          <DialogDescription className="text-xs">
            Initiate official faculty relieving process for {teacher?.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div>
            <Label className="text-xs font-semibold mb-1 block">Relieving Reason</Label>
            <Select value={terminationReason} onValueChange={setTerminationReason}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Resignation / End of Tenure">Resignation / End of Tenure</SelectItem>
                <SelectItem value="Contract Expiry">Contract Expiry</SelectItem>
                <SelectItem value="Disciplinary Relieving">Disciplinary Relieving</SelectItem>
                <SelectItem value="Performance & Policy Non-compliance">Performance & Policy Non-compliance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-muted/30">
            <input
              type="checkbox"
              id="lockLoginCheck"
              checked={lockLoginOnTerminate}
              onChange={(e) => setLockLoginOnTerminate(e.target.checked)}
              className="h-4 w-4 text-rose-600 rounded border-border"
            />
            <label htmlFor="lockLoginCheck" className="text-xs cursor-pointer font-medium text-foreground">
              Immediately lock teacher portal login access
            </label>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1 block">Confirmation Security Check</Label>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              Type <strong className="text-rose-600 font-mono">TERMINATE</strong> below to confirm staff relieving:
            </p>
            <Input
              value={confirmTerminateText}
              onChange={(e) => setConfirmTerminateText(e.target.value)}
              placeholder="Type TERMINATE"
              className="font-mono text-xs uppercase"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={confirmTerminateText.trim().toUpperCase() !== 'TERMINATE'}
          >
            Relieve & Terminate Staff Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
