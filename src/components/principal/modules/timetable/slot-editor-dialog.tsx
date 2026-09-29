'use client'

/**
 * SlotEditorDialog — MINIMAL contextual slot editor.
 *
 * Brief section 2 + 3 + 47: The Principal clicked a specific cell, so the
 * system already knows Day/Period/Class/Time. Do NOT show those fields.
 *
 * Only show:
 *   Subject
 *   Teacher
 *
 * Room is auto-derived from the class's HOMEROOM (server Class.room —
 * Brief section 4; the class stays put, teachers move).
 *
 * SINGLE SOURCE OF TRUTH (spec §C/§D): the subject picker offers ONLY the
 * subjects the Principal has configured for this class (ACTIVE
 * ClassSubjectAssignment via /api/principal/academic). No hardcoded level
 * lists, no mock catalogs — a subject cannot be scheduled for a class it
 * was never configured for. When the class has no configuration yet the
 * picker says so honestly and points at Students & Classes.
 *
 * Brief section 5: When editing an existing slot, same minimal editor —
 *   Subject + Teacher.
 *
 * Brief section 6: Uses polished searchable selectors (same as Teachers /
 *   Students & Classes). No native select boxes for Teacher/Subject.
 *
 * Brief section 14: Real-time conflict detection. Save disabled on conflict.
 */
import { useMemo, useState } from 'react'
import { Search, Check, ChevronDown, AlertTriangle, BookLock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { type DayType, type TimetableConflictInfo } from './data'

/** Minimal form — only what the Principal needs to choose. */
export interface MinimalSlotForm {
  subject: string
  teacherId: string
}

interface SlotEditorDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Context from the clicked cell — shown as read-only context, NOT editable. */
  context: {
    day: DayType
    period: number
    periodName: string
    time: string
    className: string
    room: string
  }
  /** Pre-populated values when editing an existing slot. */
  editingSlot: { id: string; subject: string; teacherId: string } | null
  form: MinimalSlotForm
  setForm: React.Dispatch<React.SetStateAction<MinimalSlotForm>>
  conflictInfo: TimetableConflictInfo
  /** Subjects the Principal has configured for THIS class (server CSA) —
   *  the only schedulable options. Empty = unconfigured class. */
  subjectOptions: { id: string; label: string; meta?: string }[]
  /** Whether the class has a server subject configuration at all (drives
   *  the honest empty-state hint). */
  subjectsConfigured: boolean
  onSave: () => void
}

export function SlotEditorDialog({
  open,
  onOpenChange,
  context,
  editingSlot,
  form,
  setForm,
  conflictInfo,
  subjectOptions,
  subjectsConfigured,
  onSave,
}: SlotEditorDialogProps) {
  // Real faculty roster (server-backed; mock fallback until it resolves —
  // the module hydrates slot ids only after the roster settles, so the
  // current value always resolves).
  const roster = useTeacherRosterStore((s) => s.teachers)
  const rosterSource = useTeacherRosterStore((s) => s.source)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm p-0 gap-0">
        {/* Header with context */}
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border">
          <DialogTitle className="text-sm font-semibold">
            {editingSlot ? 'Edit Period' : 'Assign Period'}
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            {context.className} · {context.day} · {context.periodName} ({context.time.split(' - ')[0]})
          </DialogDescription>
        </DialogHeader>

        {/* Conflict warning */}
        {conflictInfo.hasConflict && (
          <div className="mx-4 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <div className="text-[10px] space-y-0.5">
              {conflictInfo.teacherConflict && (
                <p>⚠ Teacher unavailable — {conflictInfo.teacherConflict.teacherName} is teaching {conflictInfo.teacherConflict.className} in this period.</p>
              )}
              {conflictInfo.roomConflict && (
                <p>⚠ Room occupied — {conflictInfo.roomConflict.room} is being used by {conflictInfo.roomConflict.className}.</p>
              )}
              {conflictInfo.classConflict && (
                <p>⚠ Period already assigned — {conflictInfo.classConflict.className} already has {conflictInfo.classConflict.subject} in this period.</p>
              )}
            </div>
          </div>
        )}

        <div className="p-4 space-y-3">
          {/* Subject — searchable select, driven by the Principal's subject
              configuration for this class (server CSA — never a mock list). */}
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Subject
                {subjectsConfigured && (
                  <span
                    className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
                    title="From the subjects configured for this class in Students & Classes"
                  >
                    configured
                  </span>
                )}
              </span>
            }
          >
            {subjectOptions.length > 0 ? (
              <SearchableField
                pickerId="slot-subject"
                value={form.subject}
                onChange={(v) => setForm((prev) => ({ ...prev, subject: v }))}
                placeholder="Select subject"
                options={subjectOptions}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 flex items-start gap-2 text-[10px] text-muted-foreground">
                <BookLock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span>
                  No subjects configured for {context.className} yet — add them in
                  {' '}<span className="font-semibold text-foreground">Students &amp; Classes → Subjects</span>.
                </span>
              </div>
            )}
          </Field>

          {/* Teacher — searchable select with avatar (real school roster) */}
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Teacher
                {rosterSource === 'server' && (
                  <span
                    className="rounded-full border border-teal-500/30 bg-teal-500/[0.08] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400"
                    title="From the school's teacher records"
                  >
                    live
                  </span>
                )}
              </span>
            }
          >
            <SearchableField
              pickerId="slot-teacher"
              value={form.teacherId}
              onChange={(v) => setForm((prev) => ({ ...prev, teacherId: v }))}
              placeholder="Select teacher"
              options={roster.map((t) => ({
                id: t.id,
                label: t.name,
                avatar: t.avatar,
                meta: `${t.employeeId} · ${t.department}`,
              }))}
            />
          </Field>

          {/* Room — shown as read-only context (the class's homeroom) */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
            <span>Room · homeroom</span>
            <span className="font-medium text-foreground">{context.room}</span>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={onSave}
            disabled={conflictInfo.hasConflict || !form.subject || !form.teacherId || subjectOptions.length === 0}
          >
            {editingSlot ? 'Apply' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Field — label wrapper                                              */
/* ------------------------------------------------------------------ */
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-foreground">{label}</label>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SearchableField — searchable select for Teacher / Subject           */
/* ------------------------------------------------------------------ */
function SearchableField({ pickerId, value, onChange, placeholder, options }: {
  pickerId: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { id: string; label: string; avatar?: string; meta?: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = options.find((o) => o.id === value)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      (o.meta || '').toLowerCase().includes(q)
    )
  }, [options, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full h-9 px-2.5 rounded-lg border border-border bg-card text-xs hover:border-primary/40 transition-colors"
        >
          {selected ? (
            <span className="flex items-center gap-1.5 min-w-0">
              {selected.avatar && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-foreground text-[9px] font-semibold">
                  {selected.avatar}
                </span>
              )}
              <span className="text-foreground truncate">{selected.label}</span>
              {selected.meta && <span className="text-[9px] text-muted-foreground truncate">{selected.meta}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" sideOffset={4}>
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              key={`search-${pickerId}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 h-8 text-xs bg-card"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">No results found.</p>
          ) : filtered.slice(0, 50).map((o) => {
            const isSelected = o.id === value
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); setSearch('') }}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors"
              >
                {o.avatar && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground text-[10px] font-semibold">
                    {o.avatar}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate leading-tight">{o.label}</p>
                  {o.meta && <p className="text-[10px] text-muted-foreground leading-tight truncate">{o.meta}</p>}
                </div>
                {isSelected && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
