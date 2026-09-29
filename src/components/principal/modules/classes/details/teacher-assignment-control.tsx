'use client'

/**
 * TeacherAssignmentControl — universal teacher assignment UI.
 *
 * Brief section 1 + 2 + 20: State-driven action logic.
 *
 *   ASSIGNED   → ONLY Archive icon visible (NO pencil, NO replace button)
 *   VACANT     → Select/Edit dropdown with pencil affordance
 *
 * Brief section 1: "DO NOT show: Assigned teacher + Pencil + Archive.
 *   That is visually redundant."
 *
 * Brief section 2: "Remove that visible action from assigned teacher cards.
 *   For an assigned teacher: ONLY ARCHIVE should be visible."
 *
 * Brief section 3: "A vacant slot is not just a teacher with an empty name.
 *   It must be represented as a real assignment state."
 *   The vacant dropdown shows: `[ Select Class Teacher    ✎ ]`
 *
 * Brief section 4: "When assigned: [ Avatar ] Teacher Name + EMP-ID · Department
 *   + Archive. No pencil. No redundant edit button."
 *
 * Brief section 5 + 6: Archive uses compact Popover confirmation (NOT a large Dialog).
 *   Archive is reversible (NOT delete). Brief section 6: "Archive is reversible."
 *
 * Brief section 8: Active teacher picker shows ONLY active (non-archived) teachers.
 *
 * Brief section 17: universal — used for all 4 assignment types
 *   (Class Teacher, Assistant, Section Teacher, Section Assistant).
 */
import { useState, useMemo } from 'react'
import { Archive, UserX, Search, Check, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTeachersMockStore } from '@/lib/store/teachers-mock-store'
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
  /** Teacher options for the picker (caller pre-filters to exclude archived). */
  options: SearchableSelectOption[]
  /** Called when user picks a new teacher from the vacant dropdown. */
  onSelect: (id: string) => void
  /** Called when user confirms the archive popover. Parent marks slot as pending-archive. */
  onArchive: () => void
}

export function TeacherAssignmentControl({
  label,
  teacherId,
  editMode,
  pickerId,
  options,
  onSelect,
  onArchive,
}: TeacherAssignmentControlProps) {
  // Subscribe reactively so archived teachers update display everywhere.
  const teacher = useTeachersMockStore((s) =>
    teacherId ? s.teachers.find((t) => t.id === teacherId) : undefined
  )

  // ─── READ MODE ───────────────────────────────────────────────────────
  if (!editMode) {
    if (teacher && !teacher.archived) {
      return (
        <EntityCard
          leading={teacher.avatar}
          title={teacher.name}
          metadata={`${teacher.employeeId} · ${teacher.department}`}
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
  //   ASSIGNED   → ONLY Archive icon
  //   VACANT     → Select/Edit dropdown with pencil affordance
  const isAssigned = teacherId && teacher && !teacher.archived

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

  // ASSIGNED — show teacher card with ONLY Archive icon.
  // Brief section 1 + 2 + 4: NO pencil, NO replace button.
  if (!teacher) return null

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-foreground">{label}</p>
      <EntityCard
        leading={teacher.avatar}
        title={teacher.name}
        metadata={`${teacher.employeeId} · ${teacher.department}`}
        action={
          <ArchiveButton
            teacherName={teacher.name}
            onConfirm={onArchive}
          />
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ArchiveButton — restrained orange archive icon that opens a         */
/*   compact confirmation Popover (NOT a large Dialog).                 */
/*   Brief section 5 + 6: "small, polished confirmation surface".      */
/* ------------------------------------------------------------------ */
function ArchiveButton({ teacherName, onConfirm }: {
  teacherName: string
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Archive teacher"
          className="h-7 w-7 rounded-md text-amber-600 hover:bg-amber-500/10 transition-colors inline-flex items-center justify-center shrink-0"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" sideOffset={4}>
        <p className="text-sm font-semibold text-foreground">Archive teacher?</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {teacherName} will no longer be available for active assignment. The slot becomes vacant and the teacher moves to Archived Teachers.
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
            Archive
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
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">No teachers found.</p>
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
