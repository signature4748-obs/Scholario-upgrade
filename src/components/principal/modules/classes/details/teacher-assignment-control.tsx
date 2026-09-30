'use client'

/**
 * TeacherAssignmentControl — universal teacher assignment UI.
 *
 * Brief section 1 + 2 + 20: State-driven action logic.
 *
 *   ASSIGNED   → ONLY Clear-appointment icon (NO pencil, NO replace button)
 *   VACANT     → Select/Edit dropdown with pencil affordance
 *
 * Brief section 1: "DO NOT show: Assigned teacher + Pencil + Clear.
 *   That is visually redundant."
 *
 * Brief section 2: "Remove that visible action from assigned teacher cards.
 *   For an assigned teacher: ONLY the clear affordance should be visible."
 *
 * Brief section 3: "A vacant slot is not just a teacher with an empty name.
 *   It must be represented as a real assignment state."
 *   The vacant dropdown shows: `[ Select Class Teacher    ✎ ]`
 *
 * Brief section 4: "When assigned: [ Avatar ] Teacher Name + EMP-ID · Department
 *   + Clear. No pencil. No redundant edit button."
 *
 * Brief section 5 + 6: Clear uses compact Popover confirmation (NOT a large
 *   Dialog) and changes THIS appointment only — the teacher's staff record
 *   itself is server data and is never altered from here.
 *
 * Brief section 8: the teacher picker shows the school's real roster
 *   (teacher-roster-store — server Teacher rows; empty until synced).
 *
 * Brief section 17: universal — used for all 4 assignment types
 *   (Class Teacher, Assistant, Section Teacher, Section Assistant).
 *
 * PHASE 7 (Task 7-a): the lookup moved from the fabricated mock lifecycle
 * store to the server-hydrated roster — real teachers only, honest
 * "vacant" rendering when nobody is appointed.
 */
import { useState, useMemo } from 'react'
import { UserX, Search, Check, Pencil, Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { EntityCard } from '../../shared/entity-card'
import type { SearchableSelectOption } from '../../shared/searchable-select'

export interface TeacherAssignmentControlProps {
  /** Label shown above the field (e.g. "Class Teacher", "Section Teacher"). */
  label: string
  /** Currently-assigned teacher ID (already resolved to pending/canonical by caller). */
  teacherId: string
  /** Whether the parent is in edit mode. */
  editMode: boolean
  /** Stable id for the search Input (prevents cursor bugs). */
  pickerId: string
  /** Teacher options for the picker (the school's real roster). */
  options: SearchableSelectOption[]
  /** Called when user picks a new teacher from the vacant dropdown. */
  onSelect: (id: string) => void
  /** Called when user confirms the clear popover. Parent stages the slot as vacant. */
  onClear: () => void
}

export function TeacherAssignmentControl({
  label,
  teacherId,
  editMode,
  pickerId,
  options,
  onSelect,
  onClear,
}: TeacherAssignmentControlProps) {
  // Subscribe reactively so roster updates reflect everywhere immediately.
  // Dual-id match (Phase 7): synced class data carries the teacher's USER
  // id (Class.classTeacherId convention); the picker stages Teacher row ids.
  const teacher = useTeacherRosterStore((s) =>
    teacherId ? s.teachers.find((t) => t.id === teacherId || t.userId === teacherId) : undefined
  )

  const meta = teacher
    ? [teacher.employeeId, teacher.department].filter(Boolean).join(' · ')
    : label

  // ─── READ MODE ───────────────────────────────────────────────────────
  if (!editMode) {
    if (teacher) {
      return (
        <EntityCard
          leading={teacher.avatar}
          title={teacher.name}
          metadata={meta || label}
          secondary={<span className="text-[10px] text-muted-foreground">{label}</span>}
        />
      )
    }
    return (
      <EntityCard
        tone="vacant"
        leading={<UserX className="h-3.5 w-3.5" />}
        title={label}
        secondary={<span className="text-[10px] text-muted-foreground">Vacant</span>}
      />
    )
  }

  // ─── EDIT MODE ───────────────────────────────────────────────────────

  // State-driven action logic (Brief section 1 + 20):
  //   ASSIGNED   → ONLY Clear icon
  //   VACANT     → Select/Edit dropdown with pencil affordance
  const isAssigned = !!(teacherId && teacher)

  if (!isAssigned) {
    // VACANT — show Select/Edit dropdown with pencil affordance.
    // Brief section 3: "Select Class Teacher    ✎"
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-foreground">{label}</p>
        <VacantSelectDropdown
          pickerId={pickerId}
          selectedId={teacherId}
          onSelect={onSelect}
          placeholder={`Select ${label}`}
          options={options}
        />
      </div>
    )
  }

  // ASSIGNED — show teacher card with ONLY the Clear icon.
  // Brief section 1 + 2 + 4: NO pencil, NO replace button.
  if (!teacher) return null

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-foreground">{label}</p>
      <EntityCard
        leading={teacher.avatar}
        title={teacher.name}
        metadata={meta || label}
        action={
          <ClearButton
            teacherName={teacher.name}
            onConfirm={onClear}
          />
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ClearButton — restrained outline icon that opens a compact          */
/*   confirmation Popover (NOT a large Dialog). Clearing an            */
/*   appointment vacates THIS slot only — the teacher's staff record   */
/*   (server data) is never modified from here.                        */
/* ------------------------------------------------------------------ */
function ClearButton({ teacherName, onConfirm }: {
  teacherName: string
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Clear appointment"
          className="h-7 w-7 rounded-md text-amber-600 hover:bg-amber-500/10 transition-colors inline-flex items-center justify-center shrink-0"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" sideOffset={4}>
        <p className="text-sm font-semibold text-foreground">Clear appointment?</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          This slot will be saved as vacant. Only the class appointment changes — {teacherName}&apos;s staff record is not affected.
        </p>
        <div className="flex justify-end gap-2 mt-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
            onClick={() => { onConfirm(); setOpen(false) }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* VacantSelectDropdown — the vacant-slot Select/Edit affordance.       */
/*   Brief section 3: "Select Class Teacher    ✎"                       */
/*   The trigger shows placeholder text + a pencil icon on the right    */
/*   (NOT a chevron) to communicate "select/edit".                      */
/*   Clicking opens a polished searchable picker.                        */
/* ------------------------------------------------------------------ */
function VacantSelectDropdown({ pickerId, selectedId, onSelect, placeholder, options }: {
  pickerId: string
  selectedId: string
  onSelect: (id: string) => void
  placeholder: string
  options: SearchableSelectOption[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

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
          className="group flex items-center justify-between w-full h-9 px-3 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        >
          <span>{placeholder}</span>
          <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              key={`vacant-input-${pickerId}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teachers…"
              className="pl-8 h-8 text-xs bg-card"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              {options.length === 0 ? 'No teachers registered at the school yet.' : 'No teachers found.'}
            </p>
          ) : filtered.slice(0, 50).map((o) => {
            const isSelected = o.id === selectedId
            return (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                onClick={() => { onSelect(o.id); setOpen(false); setSearch('') }}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {o.avatar && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground text-[10px] font-semibold">
                    {o.avatar}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-tight">{o.label}</p>
                  {o.meta && (
                    <p className="text-[10px] text-muted-foreground leading-tight truncate">{o.meta}</p>
                  )}
                </div>
                {isSelected && (
                  <span className="text-[10px] text-emerald-600 font-medium shrink-0 inline-flex items-center gap-0.5">
                    <Check className="h-3 w-3" /> Selected
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
