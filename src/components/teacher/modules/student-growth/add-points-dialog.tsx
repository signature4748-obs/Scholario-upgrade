'use client'

/**
 * add-points-dialog — THE quick action of the growth system (§8/§34).
 *
 * Replaces the former 8-field "Record Observation" form. A teacher picks a
 * student, taps a reason chip, optionally adds a one-line note and submits —
 * a few seconds, not a form-filling session. The server captures teacher,
 * timestamp, student, class, category and points behind the scenes.
 *
 * STRUCTURE (compact by design, §27):
 *   student row (avatar + name + class, expandable picker)
 *   → quick reason chips (positive block / negative block)
 *   → custom entry (sign · stepper · short reason)
 *   → optional note
 *   → Cancel / Add +N
 *
 * VIEWPORT SAFETY: the sheet is width-capped, max-h-[86dvh] with internal
 * scrolling, safe-area bottom padding for iOS Safari, Radix focus trapping,
 * and a submit button that can never be clipped (sticky footer).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, Loader2, Minus, Plus, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GrowthPreset, GrowthSettingsDto } from '@/lib/teacher-hub-types'
import {
  pointsChipClass,
  pointsTextClass,
  signedPoints,
} from './shared'
import { addManualPoint } from './hooks'

export interface GrowthStudentOption {
  id: string
  name: string
  rollNo: string | null
  classLabel: string
  /** §21 quiet pre-empt: this teacher already recorded for the student
   *  today / already used these categories this week (server still enforces) */
  manualToday?: boolean
  manualWeekCategories?: string[]
}

interface AddPointsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** students the teacher may award points to (server-resolved scope) */
  students: GrowthStudentOption[]
  presets: { positive: GrowthPreset[]; negative: GrowthPreset[] }
  settings: GrowthSettingsDto
  /** student prefilled when opened from a profile/student context */
  prefillStudent?: GrowthStudentOption | null
  /** called after a successful award — the parent quietly reloads */
  onCreated: () => void
}

export function AddPointsDialog({
  open,
  onOpenChange,
  students,
  presets,
  settings,
  prefillStudent,
  onCreated,
}: AddPointsDialogProps) {
  const [studentId, setStudentId] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [presetKey, setPresetKey] = useState<string | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customSign, setCustomSign] = useState<1 | -1>(1)
  const [customPoints, setCustomPoints] = useState(2)
  const [customReason, setCustomReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // fresh form on every open
  useEffect(() => {
    if (!open) return
    setStudentId(prefillStudent?.id ?? '')
    setPickerOpen(!prefillStudent && students.length > 1)
    setQuery('')
    setPresetKey(null)
    setCustomMode(false)
    setCustomSign(1)
    setCustomPoints(2)
    setCustomReason('')
    setNote('')
    setError(null)
    if (!prefillStudent && students.length > 1) {
      // let the dialog settle, then focus the picker search
      const t = window.setTimeout(() => searchRef.current?.focus(), 120)
      return () => window.clearTimeout(t)
    }
  }, [open, prefillStudent, students.length])

  const student = useMemo(
    () =>
      students.find((s) => s.id === studentId) ??
      (prefillStudent?.id === studentId && studentId ? prefillStudent : null),
    [students, studentId, prefillStudent],
  )

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.classLabel.toLowerCase().includes(q) ||
        (s.rollNo ?? '').toLowerCase().includes(q),
    )
  }, [students, query])

  const selectedPreset = useMemo(
    () =>
      !customMode && presetKey
        ? [...presets.positive, ...presets.negative].find((p) => p.key === presetKey) ?? null
        : null,
    [customMode, presetKey, presets],
  )

  // §21 — quiet pre-empt of the server-side limits. Never a rule text:
  // just a soft "already updated today" state and spent chips.
  const alreadyToday = !!student?.manualToday
  const weekCategories = new Set(student?.manualWeekCategories ?? [])
  const presetSpent = (p: GrowthPreset) => alreadyToday || weekCategories.has(p.category)

  const effectivePoints = selectedPreset
    ? selectedPreset.points
    : customMode
      ? customSign * customPoints
      : 0

  const canSubmit =
    !!student &&
    !alreadyToday &&
    !saving &&
    effectivePoints !== 0 &&
    (!customMode || customReason.trim().length > 0)

  const handleChip = (preset: GrowthPreset) => {
    setCustomMode(false)
    setPresetKey((k) => (k === preset.key ? null : preset.key))
  }

  const openCustom = (sign: 1 | -1) => {
    setCustomMode(true)
    setPresetKey(null)
    setCustomSign(sign)
    if (customPoints === 0) setCustomPoints(2)
  }

  const submit = async () => {
    if (!student || effectivePoints === 0) return
    setSaving(true)
    setError(null)
    try {
      await addManualPoint({
        studentId: student.id,
        ...(customMode
          ? { points: effectivePoints, reason: customReason.trim() }
          : { presetKey: presetKey! }),
        note: note.trim() || undefined,
      })
      toast.success(
        `${signedPoints(effectivePoints)} · ${customMode ? customReason.trim() : selectedPreset?.label}`,
        { description: `${student.name} — growth points recorded.` },
      )
      onCreated()
      onOpenChange(false)
    } catch (e) {
      // §22 — limit errors arrive as concise human sentences; surface them
      // verbatim, never with technical detail
      setError(e instanceof Error ? e.message : 'The point could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[86dvh] w-[min(94vw,30rem)] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-[30rem]"
        onKeyDown={(e) => {
          // Enter submits when a reason is ready — unless focus is in the
          // picker search (Enter picks the first matched student instead).
          if (e.key !== 'Enter') return
          if (pickerOpen && document.activeElement === searchRef.current) return
          if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
          if (canSubmit) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        <div className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Add Points
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
            Recognise growth or note a concern — the point is the event.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ── student ─────────────────────────────────────────────── */}
          {student && !pickerOpen ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {student.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{student.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {student.classLabel}
                  {student.rollNo ? ` · Roll ${student.rollNo}` : ''}
                </p>
              </div>
              {students.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen(true)
                    setQuery('')
                    window.setTimeout(() => searchRef.current?.focus(), 60)
                  }}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/60 p-2">
              <div className="flex items-center gap-2 rounded-lg bg-background px-2.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredStudents.length > 0) {
                      e.preventDefault()
                      setStudentId(filteredStudents[0].id)
                      setPickerOpen(false)
                    }
                  }}
                  placeholder="Find a student…"
                  className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  aria-label="Find a student"
                />
                {student && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Cancel changing student"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div
                className={cn(
                  'mt-2 max-h-44 overflow-y-auto',
                  filteredStudents.length === 0 && 'px-1 py-3 text-center text-xs text-muted-foreground',
                )}
                role="listbox"
                aria-label="Students"
              >
                {filteredStudents.length === 0
                  ? 'No students match — check the spelling.'
                  : filteredStudents.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={s.id === studentId}
                        onClick={() => {
                          setStudentId(s.id)
                          setPickerOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60',
                          s.id === studentId && 'bg-accent',
                        )}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                          {s.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium leading-tight">
                            {s.name}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {s.classLabel}
                            {s.rollNo ? ` · Roll ${s.rollNo}` : ''}
                          </span>
                        </span>
                        {s.id === studentId && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        )}
                      </button>
                    ))}
              </div>
            </div>
          )}

          {/* ── quick reasons ────────────────────────────────────────── */}
          <div className={cn('mt-4 space-y-4', !student && 'pointer-events-none opacity-40')}>
            {alreadyToday && (
              <p
                role="status"
                className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {student?.name.split(' ')[0] ?? 'This student'}'s growth has already been updated today.
              </p>
            )}
            <div className={cn(alreadyToday && 'pointer-events-none opacity-50')}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Positive
              </p>
              <div className="flex flex-wrap gap-1.5">
                {presets.positive.map((p) => (
                  <ChipButton
                    key={p.key}
                    active={presetKey === p.key && !customMode}
                    points={p.points}
                    label={p.label}
                    disabled={!student || presetSpent(p)}
                    onClick={() => handleChip(p)}
                  />
                ))}
              </div>
            </div>

            {settings.negativeEnabled && presets.negative.length > 0 && (
              <div className={cn(alreadyToday && 'pointer-events-none opacity-50')}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Needs attention
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.negative.map((p) => (
                    <ChipButton
                      key={p.key}
                      active={presetKey === p.key && !customMode}
                      points={p.points}
                      label={p.label}
                      disabled={!student || presetSpent(p)}
                      onClick={() => handleChip(p)}
                    />
                  ))}
                  <button
                    type="button"
                    disabled={!student || alreadyToday}
                    onClick={() => openCustom(-1)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all',
                      customMode && customSign < 0
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : 'border-dashed border-border text-muted-foreground hover:border-rose-500/40 hover:text-rose-600',
                    )}
                  >
                    Custom −
                  </button>
                </div>
              </div>
            )}

            {/* ── custom entry ──────────────────────────────────────── */}
            {settings.customReasons && (
              <div className={cn(alreadyToday && 'pointer-events-none opacity-50')}>
                <button
                  type="button"
                  disabled={!student || alreadyToday}
                  onClick={() => (customMode && customSign > 0 ? setCustomMode(false) : openCustom(1))}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all',
                    customMode && customSign > 0
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-dashed border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-600',
                  )}
                >
                  {customMode && customSign > 0 ? 'Custom + (editing)' : 'Custom +'}
                </button>

                {customMode && (
                  <div className="mt-2.5 space-y-2.5 rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCustomSign((s) => (s === 1 ? -1 : 1))}
                        className={cn(
                          'flex h-8 w-10 items-center justify-center rounded-lg border text-sm font-bold transition-colors',
                          customSign > 0
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                        )}
                        aria-label={customSign > 0 ? 'Positive points' : 'Negative points'}
                      >
                        {customSign > 0 ? '+' : '−'}
                      </button>
                      <div className="flex h-8 items-center overflow-hidden rounded-lg border border-border">
                        <button
                          type="button"
                          onClick={() =>
                            setCustomPoints((v) =>
                              Math.max(1, Math.min(Math.abs(settings.maxManualPoints), Math.abs(settings.minManualPoints), v - 1)),
                            )
                          }
                          className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
                          aria-label="Fewer points"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="w-10 text-center text-sm font-bold tabular-nums">
                          {customPoints}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCustomPoints((v) =>
                              Math.min(
                                Math.abs(settings.maxManualPoints),
                                Math.abs(settings.minManualPoints),
                                v + 1,
                              ),
                            )
                          }
                          className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
                          aria-label="More points"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <span className={cn('text-xs font-semibold', pointsTextClass(customSign * customPoints))}>
                        {signedPoints(customSign * customPoints)} point{customPoints === 1 ? '' : 's'}
                      </span>
                    </div>
                    <Input
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      placeholder="Short reason (required)"
                      maxLength={80}
                      className="h-9 text-sm"
                      aria-label="Custom reason"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── optional note ─────────────────────────────────────── */}
            <div className={cn(alreadyToday && 'pointer-events-none opacity-50')}>
              <label
                htmlFor="growth-note"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Note <span className="font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <textarea
                id="growth-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="One line of context, if helpful…"
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/40"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* sticky footer — the submit can never be clipped (§27) */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="min-h-[38px] px-4 text-xs font-semibold"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className={cn(
              'min-h-[38px] gap-1.5 px-4 text-xs font-semibold',
              effectivePoints > 0
                ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                : 'bg-rose-600 text-white hover:bg-rose-600/90',
            )}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {effectivePoints !== 0
              ? `Add ${signedPoints(effectivePoints)}`
              : 'Add Points'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One quick-reason chip — points badge + label, wrap-friendly. */
function ChipButton({
  active,
  points,
  label,
  disabled,
  onClick,
}: {
  active: boolean
  points: number
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all active:scale-[0.97]',
        active
          ? pointsChipClass(points) + ' ring-2 ring-primary/20'
          : 'border-border bg-card/60 text-foreground hover:border-primary/30 hover:bg-accent/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'rounded-md px-1 py-0.5 text-[10px] font-bold tabular-nums',
          active ? 'bg-background/60' : 'bg-muted',
          pointsTextClass(points),
        )}
      >
        {signedPoints(points)}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
