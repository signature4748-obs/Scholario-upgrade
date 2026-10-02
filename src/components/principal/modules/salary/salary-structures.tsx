'use client'

/**
 * SalaryStructuresSection — per-teacher MONTHLY salary cards.
 *
 * PHASE 8B: the salary structure is ONE fixed monthly amount per teacher
 * (server truth: SalaryStructure row, unique per teacher). The editor
 * dialog carries exactly: Monthly Salary (₹) + optional effective-from +
 * optional note. No components, allowances or deductions exist.
 *
 * The list follows the server roster: every teacher appears (configured
 * or honestly "Not set"); the editor writes via PUT /api/salary/structure
 * and the canonical row folds back into the cache.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, IndianRupee, Pencil, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useSalaryStore, SalaryApiError, type SalaryTeacher, type SalaryStructure,
} from '@/lib/store/salary-store'
import { useSalaryUI } from './salary-ui-context'
import { moneyMy, fmtDayYear, SalaryEmptyState, SyncErrorStrip } from './salary-shared'

// ─── Section ─────────────────────────────────────────────────────────

export function SalaryStructuresSection() {
  const teachers = useSalaryStore((s) => s.teachers)
  const structures = useSalaryStore((s) => s.structures)
  const hydrate = useSalaryStore((s) => s.hydrate)
  const syncStatus = useSalaryStore((s) => s.syncStatus)
  const { openEmployee } = useSalaryUI()

  const [editing, setEditing] = useState<{ teacher: SalaryTeacher; structure: SalaryStructure | null } | null>(null)
  const [search, setSearch] = useState('')

  const structureByTeacher = useMemo(() => {
    const map = new Map<string, SalaryStructure>()
    for (const s of structures) map.set(s.teacherId, s)
    return map
  }, [structures])

  const configuredCount = structures.length

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return teachers
      .map((t) => ({ teacher: t, structure: structureByTeacher.get(t.id) ?? null }))
      .filter((r) => !q || `${r.teacher.name} ${r.teacher.employeeId} ${r.teacher.department}`.toLowerCase().includes(q))
      .sort((a, b) => {
        // Un-configured salaries first — they need the principal's attention.
        const aSet = a.structure ? 1 : 0
        const bSet = b.structure ? 1 : 0
        return aSet - bSet || a.teacher.name.localeCompare(b.teacher.name)
      })
  }, [teachers, structureByTeacher, search])

  const monthlyCommitment = structures.reduce((s, st) => s + st.monthlyAmount, 0)

  return (
    <div className="space-y-4">
      {syncStatus === 'error' && <SyncErrorStrip onRetry={() => void hydrate({ force: true })} />}

      {/* Summary badges + search — the tab already establishes context */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
            <Users className="h-2.5 w-2.5" /> {teachers.length} teacher{teachers.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
            <Wallet className="h-2.5 w-2.5" /> {configuredCount} salary set
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
            <IndianRupee className="h-2.5 w-2.5" /> {moneyMy(monthlyCommitment)} / month
          </Badge>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teacher…"
          className="h-8 w-[180px] text-xs"
          aria-label="Search teachers"
        />
      </div>

      {teachers.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <SalaryEmptyState
            icon={<Users className="h-5 w-5" />}
            title="No teachers on the roster"
            description="The payroll list follows the school's teacher roster — register teachers in the Teachers module and they will appear here."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(({ teacher, structure }, i) => (
            <motion.button
              key={teacher.id}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.24) }}
              onClick={() => setEditing({ teacher, structure })}
              aria-label={`Set monthly salary for ${teacher.name}`}
              className={cn(
                'rounded-xl border bg-card p-4 text-left hover:border-emerald-500/40 hover:shadow-md transition-all',
                !structure && 'border-dashed',
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{teacher.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {[teacher.employeeId, teacher.department].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <span className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold shrink-0 mt-0.5',
                  structure
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {structure ? 'Set' : 'Not set'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5">
                  <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Monthly Salary</p>
                  <p className="text-sm font-bold tabular-nums mt-0.5 text-emerald-700 dark:text-emerald-400">
                    {structure ? moneyMy(structure.monthlyAmount) : '—'}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                  <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Effective From</p>
                  <p className="text-sm font-bold mt-0.5">
                    {structure?.effectiveFrom ? fmtDayYear(structure.effectiveFrom) : '—'}
                  </p>
                </div>
              </div>

              {structure?.note && (
                <p className="text-[10px] text-muted-foreground mt-2.5 truncate">{structure.note}</p>
              )}

              <div className="flex items-center gap-1.5 pt-2.5 mt-3 border-t">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Pencil className="h-3 w-3" /> {structure ? 'View / Edit' : 'Set Salary'}
                </span>
                <div className="flex-1" />
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Open payroll for ${teacher.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openEmployee(teacher.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      openEmployee(teacher.id)
                    }
                  }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Payroll →
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Editor — one Monthly Salary amount (+ optional effective-from + note) */}
      <MonthlySalaryEditorDialog
        target={editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  )
}

// ─── Editor dialog ───────────────────────────────────────────────────

function MonthlySalaryEditorDialog({
  target, open, onOpenChange,
}: {
  target: { teacher: SalaryTeacher; structure: SalaryStructure | null } | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const setStructure = useSalaryStore((s) => s.setStructure)

  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [key, setKey] = useState('')

  // Re-seed the form whenever the target changes.
  const targetKey = target?.teacher.id ?? 'none'
  if (key !== targetKey) {
    setKey(targetKey)
    setAmount(target?.structure ? String(target.structure.monthlyAmount) : '')
    setEffectiveFrom(target?.structure?.effectiveFrom ? target.structure.effectiveFrom.slice(0, 10) : '')
    setNote(target?.structure?.note ?? '')
    setSubmitting(false)
  }

  const amountNum = Number(amount) || 0
  const invalidAmount = amountNum <= 0 || amountNum > 5_000_000

  const handleSave = async () => {
    if (!target || submitting || invalidAmount) return
    setSubmitting(true)
    try {
      const row = await setStructure({
        teacherId: target.teacher.id,
        monthlyAmount: amountNum,
        effectiveFrom: effectiveFrom || undefined,
        note: note.trim() || undefined,
      })
      toast.success(target.structure ? 'Monthly salary updated' : 'Monthly salary set', {
        description: `${target.teacher.name} · ${moneyMy(row.monthlyAmount)} / month`,
      })
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof SalaryApiError || err instanceof Error
        ? err.message
        : 'Could not save the monthly salary.'
      toast.error('Could not save', { description: message })
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
              <IndianRupee className="h-4 w-4" />
            </span>
            {target?.structure ? 'Edit Monthly Salary' : 'Set Monthly Salary'}
          </DialogTitle>
          <DialogDescription>
            {target ? `${target.teacher.name}${target.teacher.employeeId ? ` · ${target.teacher.employeeId}` : ''}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ms-amount">Monthly Salary (₹)</Label>
            <div className="relative">
              <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="ms-amount"
                inputMode="numeric"
                className="pl-7 h-9 tabular-nums"
                placeholder="25000"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            {amount && invalidAmount && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400">
                Enter an amount between ₹1 and ₹50,00,000.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              One fixed amount per month — the school&apos;s payroll model has no components or deductions.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ms-effective">Effective From</Label>
              <div className="relative">
                <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="ms-effective"
                  type="date"
                  className="pl-7 h-9 text-xs tabular-nums"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="ms-note">Note</Label>
              <Input
                id="ms-note"
                className="h-9 text-xs"
                placeholder="e.g. Annual increment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => void handleSave()}
            disabled={!target || !amountNum || invalidAmount || submitting}
          >
            {submitting ? 'Saving…' : target?.structure ? 'Save Changes' : 'Set Salary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
