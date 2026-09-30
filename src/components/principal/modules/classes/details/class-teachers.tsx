'use client'

/**
 * ClassTeachers — class & section teacher assignment.
 *
 * Brief section 1: Three-state mental model:
 *   ASSIGNED → Replace (clear, then pick) / Clear appointment
 *   VACANT   → Select teacher
 *
 * Brief section 3: Replace ≠ Clear.
 *   - Replace: clear the appointment, pick a new teacher, Save.
 *   - Clear: confirmation → slot vacant (pending), saved as vacant.
 *
 * Brief section 9 + 21 + 10: existing values hydrate into edit mode.
 *   buildInitialState() reads from canonical cls state.
 *
 * Brief section 12: uses universal TeacherAssignmentControl for all 4
 *   assignment types (Class Teacher, Assistant, Section Teacher, Section
 *   Assistant).
 *
 * Brief section 22 + 35 + 37: Save writes through canonical store actions;
 *   mutations propagate live to Overview + header badges.
 *
 * PHASE 7 (Task 7-a): the teacher pool is the school's REAL roster
 * (teacher-roster-store — server Teacher rows; empty until the roster
 * syncs, honest empty pickers). The old fabricated mock-lifecycle
 * "archive teacher" affordance is retired: clearing an appointment
 * vacates THIS slot only and never claims anything about the teacher's
 * employment at the school.
 */
import { useState, useMemo, useEffect } from 'react'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useStudentsStore } from '@/lib/store/students-store'
import type { ClassRecord } from '@/lib/store/students-store'
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { useAcademicConfigStore, resolveDbClassFor } from '@/lib/academic-config/client'
import { SegmentedTabs } from '../../shared/segmented-tabs'
import { TeacherAssignmentControl } from './teacher-assignment-control'
import { toast } from 'sonner'

type Mode = 'separate' | 'merged'

/**
 * Pending state shape.
 *   'class_teacher'                  → class-level Class Teacher
 *   'class_assistant'                → class-level Assistant Class Teacher
 *   'section_teacher|<secId>'        → section-level Class Teacher
 *   'section_assistant|<secId>'      → section-level Assistant Class Teacher
 */
type PendingMap = Record<string, string>

export function ClassTeachers({ cls }: { cls: ClassRecord }) {
  // Subscribe to canonical class so external mutations reflect here.
  const liveClass = useStudentsStore((s) => s.getClassById(cls.id)) ?? cls
  const updateClassTeacher = useStudentsStore((s) => s.updateClassTeacher)
  const updateClassAssistantTeacher = useStudentsStore((s) => s.updateClassAssistantTeacher)
  const updateSectionTeacher = useStudentsStore((s) => s.updateSectionTeacher)
  const updateSectionAssistantTeacher = useStudentsStore((s) => s.updateSectionAssistantTeacher)

  // Subscribe to the school's REAL teacher roster (server Teacher rows).
  // ensure() is idempotent (module-level in-flight guard) — it hydrates the
  // roster once; until it resolves the pickers show an honest empty state.
  const teachers = useTeacherRosterStore((s) => s.teachers)
  const ensureRoster = useTeacherRosterStore((s) => s.ensure)
  useEffect(() => { void ensureRoster() }, [ensureRoster])

  // ── Server link — the Class Teacher appointment is the authoritative
  // capability gate for the Teacher's "My Class" module. When this class
  // maps to a server class, saving a Class Teacher change ALSO writes the
  // server record (Class.classTeacherId) — the single source of truth.
  const academicConfig = useAcademicConfigStore((s) => s.config)
  const fetchAcademic = useAcademicConfigStore((s) => s.fetch)
  const academicAct = useAcademicConfigStore((s) => s.act)
  useEffect(() => { void fetchAcademic() }, [fetchAcademic])
  const dbClass = resolveDbClassFor(liveClass, academicConfig?.classes ?? [])

  const [mode, setMode] = useState<Mode>('separate')
  const [editMode, setEditMode] = useState(false)
  const [pending, setPending] = useState<PendingMap>({})

  // Build initial pending state from canonical class assignments.
  const buildInitialState = (): PendingMap => {
    const state: PendingMap = {}
    if (liveClass.classTeacherId) state['class_teacher'] = liveClass.classTeacherId
    if (liveClass.assistantTeacherId) state['class_assistant'] = liveClass.assistantTeacherId
    liveClass.sections.forEach((sec) => {
      if (sec.classTeacherId) state[`section_teacher|${sec.id}`] = sec.classTeacherId
      if (sec.assistantTeacherId) state[`section_assistant|${sec.id}`] = sec.assistantTeacherId
    })
    return state
  }

  // Teacher options for the picker — the school's real roster.
  const teacherOptions = useMemo(
    () => teachers.map((t) => ({
      id: t.id,
      label: t.name,
      avatar: t.avatar,
      meta: [t.employeeId, t.department].filter(Boolean).join(' · '),
    })),
    [teachers],
  )

  const hasChanges = (() => {
    const initial = buildInitialState()
    // Changed / added / cleared assignments
    for (const [k, v] of Object.entries(pending)) {
      if (initial[k] !== v) return true
    }
    return false
  })()

  const setP = (k: string, v: string) => setPending((p) => ({ ...p, [k]: v }))

  /** Clear: stage ALL assignment slots that reference this teacher as
   *  vacant (pending) — an appointment-level change only; the teacher's
   *  staff record (server data) is never touched from here.
   *
   * Implementation: set the pending key to '' (empty string) instead of
   * deleting it, so that resolveNext() correctly returns null on Save
   * (hasOwnProperty is true, value is falsy → null).
   */
  const markClear = (teacherId: string) => {
    setPending((p) => {
      const n = { ...p }
      for (const [k, v] of Object.entries(n)) {
        if (v === teacherId) n[k] = '' // Set to '' (vacant), NOT delete
      }
      return n
    })
  }

  const enterEdit = () => {
    setEditMode(true)
    setPending(buildInitialState()) // Pre-populate with existing values
  }
  const exitEdit = () => {
    setEditMode(false)
    setPending({})
  }

  const save = () => {
    const initial = buildInitialState()
    let changeCount = 0

    // Helper: resolve the pending value for a key.
    // - If the key EXISTS in pending → use pending[key] (may be '' or a teacherId).
    // - If the key was set to '' (by markClear) → return null (cleared).
    // - If the key was NEVER in pending (no change from canonical) → use initial[key].
    const resolveNext = (key: string): string | null => {
      if (Object.prototype.hasOwnProperty.call(pending, key)) {
        return pending[key] || null
      }
      return initial[key] ?? null
    }

    // Class Teacher — write through to the SERVER record when this class
    // is server-linked (the authoritative Class.classTeacherId that gates
    // the Teacher's My Class capabilities), plus the local class record.
    const classTeacherNext = resolveNext('class_teacher')
    if ((initial['class_teacher'] ?? null) !== (classTeacherNext ?? null)) {
      updateClassTeacher(liveClass.id, classTeacherNext)
      if (dbClass) {
        const teacherName = classTeacherNext
          ? teachers.find((t) => t.id === classTeacherNext)?.name ?? null
          : null
        void academicAct({
          action: 'classTeacher.set',
          classId: dbClass.id,
          teacherName,
        }).then(() => {
          toast.success('Class teacher updated on the server', {
            description: `${dbClass.label} — the Teacher's My Class access follows this assignment.`,
          })
        }).catch((e: unknown) => {
          toast.error('Server sync failed', {
            description: e instanceof Error ? e.message : 'The class teacher was not updated on the server.',
          })
        })
      }
      changeCount++
    }

    // Class Assistant
    const classAssistantNext = resolveNext('class_assistant')
    if ((initial['class_assistant'] ?? null) !== (classAssistantNext ?? null)) {
      updateClassAssistantTeacher(liveClass.id, classAssistantNext)
      changeCount++
    }

    // Section Teachers + Assistants
    liveClass.sections.forEach((sec) => {
      const teacherKey = `section_teacher|${sec.id}`
      const teacherNext = resolveNext(teacherKey)
      const teacherPrev = initial[teacherKey] ?? null
      if ((teacherPrev ?? null) !== (teacherNext ?? null)) {
        updateSectionTeacher(liveClass.id, sec.id, teacherNext)
        changeCount++
      }

      const assistantKey = `section_assistant|${sec.id}`
      const assistantNext = resolveNext(assistantKey)
      const assistantPrev = initial[assistantKey] ?? null
      if ((assistantPrev ?? null) !== (assistantNext ?? null)) {
        updateSectionAssistantTeacher(liveClass.id, sec.id, assistantNext)
        changeCount++
      }
    })

    if (changeCount > 0) {
      toast.success(`${changeCount} change(s) saved`)
    }
    exitEdit()
  }

  // Resolve what to display: pending value if editing, otherwise canonical value.
  // markClear sets pending keys to '' (vacant), so the display correctly
  // shows the vacant dropdown for cleared slots.
  const resolveTeacherId = (key: string, fallback: string | null | undefined): string => {
    if (editMode) {
      if (Object.prototype.hasOwnProperty.call(pending, key)) {
        return pending[key] || ''
      }
      return fallback ?? ''
    }
    return fallback ?? ''
  }

  return (
    <div className="space-y-5">
      {/* Mode toggle + Edit */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <SegmentedTabs
          tabs={[
            { value: 'separate', label: 'Separate by section' },
            { value: 'merged', label: 'Merged (class-wide)' },
          ]}
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
        />
        <div className="flex items-center gap-1.5">
          {!editMode ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={enterEdit}>
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={exitEdit}>Cancel</Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 disabled:saturate-50"
                onClick={save}
                disabled={!hasChanges}
              >
                Save Changes
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Roster empty — honest state (no fabricated pool to pick from). */}
      {teachers.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
          No teachers registered at the school yet — the teacher roster loads from the school&apos;s records and will appear here once teachers are registered.
        </p>
      )}

      {/* Class-level: Class Teacher + Assistant Class Teacher */}
      <section>
        <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Class Teacher</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TeacherAssignmentControl
            label="Class Teacher"
            teacherId={resolveTeacherId('class_teacher', liveClass.classTeacherId)}
            editMode={editMode}
            pickerId="class_teacher"
            options={teacherOptions}
            onSelect={(v) => setP('class_teacher', v)}
            onClear={() => {
              const id = pending['class_teacher'] ?? liveClass.classTeacherId
              if (id) markClear(id)
            }}
          />
          <TeacherAssignmentControl
            label="Assistant Class Teacher"
            teacherId={resolveTeacherId('class_assistant', liveClass.assistantTeacherId)}
            editMode={editMode}
            pickerId="class_assistant"
            options={teacherOptions}
            onSelect={(v) => setP('class_assistant', v)}
            onClear={() => {
              const id = pending['class_assistant'] ?? liveClass.assistantTeacherId
              if (id) markClear(id)
            }}
          />
        </div>
      </section>

      {/* Section rows (separate mode) */}
      {mode === 'separate' && (
        <section>
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Sections</p>
          <div className="space-y-4">
            {liveClass.sections.map((sec) => {
              const secTeacherId = resolveTeacherId(`section_teacher|${sec.id}`, sec.classTeacherId)
              const secAssistantId = resolveTeacherId(`section_assistant|${sec.id}`, sec.assistantTeacherId)
              return (
                <div key={sec.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-foreground text-[10px] font-semibold">{sec.name}</div>
                    <span className="text-xs font-medium text-foreground">Section {sec.name}</span>
                    <span className="text-[10px] text-muted-foreground">Room {sec.room || liveClass.room}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-8">
                    <TeacherAssignmentControl
                      label="Section Teacher"
                      teacherId={secTeacherId}
                      editMode={editMode}
                      pickerId={`section_teacher|${sec.id}`}
                      options={teacherOptions}
                      onSelect={(v) => setP(`section_teacher|${sec.id}`, v)}
                      onClear={() => {
                        const id = pending[`section_teacher|${sec.id}`] ?? sec.classTeacherId
                        if (id) markClear(id)
                      }}
                    />
                    <TeacherAssignmentControl
                      label="Assistant"
                      teacherId={secAssistantId}
                      editMode={editMode}
                      pickerId={`section_assistant|${sec.id}`}
                      options={teacherOptions}
                      onSelect={(v) => setP(`section_assistant|${sec.id}`, v)}
                      onClear={() => {
                        const id = pending[`section_assistant|${sec.id}`] ?? sec.assistantTeacherId
                        if (id) markClear(id)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Merged (class-wide) mode */}
      {mode === 'merged' && (
        <section>
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">Sections</p>
          <div className="space-y-1.5">
            {liveClass.sections.map((sec) => {
              const secTeacherId = pending[`section_teacher|${sec.id}`] ?? sec.classTeacherId
              const secTeacher = secTeacherId ? teachers.find((t) => t.id === secTeacherId) : null
              return (
                <div key={sec.id} className="flex items-center justify-between py-1.5 border-t border-border/30 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-muted text-foreground text-[9px] font-semibold">{sec.name}</div>
                    <span className="text-xs text-muted-foreground">Section {sec.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {secTeacher ? (
                      <>
                        <Badge variant="outline" className="text-[8px] text-amber-600 border-amber-500/30">OVERRIDE</Badge>
                        <span className="text-xs text-foreground">{secTeacher.name}</span>
                      </>
                    ) : (
                      <>
                        <Badge variant="outline" className="text-[8px] text-muted-foreground">INHERITED</Badge>
                        <span className="text-xs text-muted-foreground">Uses class teacher</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
