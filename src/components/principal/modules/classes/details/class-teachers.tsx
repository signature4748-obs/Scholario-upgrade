'use client'

/**
 * ClassTeachers — class & section teacher assignment.
 *
 * Brief section 1: Three-state mental model:
 *   ASSIGNED → Replace / Archive
 *   VACANT   → Select teacher
 *   ARCHIVED → in Archived Teachers, can Restore or Delete permanently
 *
 * Brief section 3: Replace ≠ Archive.
 *   - Replace: opens picker, preserves old teacher until Save.
 *   - Archive: confirmation → slot vacant (pending), teacher archived on Save.
 *
 * Brief section 4: after Archive confirm, slot is immediately vacant +
 *   selectable. NO pencil/archive icon beside vacant slots.
 *
 * Brief section 5 + 6: "Archived" button opens ArchivedTeachersPanel (universal).
 *   Restore returns teacher to active pool. Delete is permanent (stronger confirm).
 *
 * Brief section 9 + 21 + 10: existing values hydrate into edit mode.
 *   buildInitialState() reads from canonical cls state.
 *
 * Brief section 12: uses universal TeacherAssignmentControl for all 4
 *   assignment types (Class Teacher, Assistant, Section Teacher, Section Assistant).
 *
 * Brief section 17: assignment state is separate from teacher lifecycle state.
 *   - pendingArchives: string[]  (teacher IDs that will be archived on Save)
 *   - pending: Record<slotKey, teacherId>  (assignment changes staged for Save)
 *
 * Brief section 22 + 35 + 37: Save writes through canonical store actions;
 *   mutations propagate live to Overview + header badges.
 */
import { useState, useMemo, useEffect } from 'react'
import { Pencil, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useStudentsStore } from '@/lib/store/students-store'
import type { ClassRecord } from '@/lib/store/students-store'
import { useTeachersMockStore } from '@/lib/store/teachers-mock-store'
import { useAcademicConfigStore, resolveDbClassFor } from '@/lib/academic-config/client'
import { SegmentedTabs } from '../../shared/segmented-tabs'
import { TeacherAssignmentControl } from './teacher-assignment-control'
import { ArchivedTeachersPanel } from './archived-teachers-panel'
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

  // Subscribe to teacher store — needed to filter archived teachers from picker options.
  const teachers = useTeachersMockStore((s) => s.teachers)
  const archiveTeacherAction = useTeachersMockStore((s) => s.archiveTeacher)

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
  /** Teacher IDs that will be archived on Save (pending archive lifecycle). */
  const [pendingArchives, setPendingArchives] = useState<string[]>([])
  const [archivedDialogOpen, setArchivedDialogOpen] = useState(false)

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

  // Teacher options for the picker — excludes archived + pending-archive teachers.
  // Recomputed when pendingArchives or the teachers array changes.
  const teacherOptions = useMemo(() => {
    const pendingArchiveSet = new Set(pendingArchives)
    return teachers
      .filter((t) => !t.archived && !pendingArchiveSet.has(t.id) && t.status === 'Active')
      .map((t) => ({
        id: t.id,
        label: t.name,
        avatar: t.avatar,
        meta: `${t.employeeId} · ${t.department}`,
      }))
  }, [teachers, pendingArchives])

  const hasChanges = (() => {
    const initial = buildInitialState()
    // Changed / added / cleared assignments
    for (const [k, v] of Object.entries(pending)) {
      if (initial[k] !== v) return true
    }
    // Pending archives (teacher lifecycle changes)
    if (pendingArchives.length > 0) return true
    return false
  })()

  const setP = (k: string, v: string) => setPending((p) => ({ ...p, [k]: v }))

  /** Archive: clear ALL assignment slots that reference this teacher (pending)
   *  + mark teacher for archive (pending).
   *
   *  Brief section 17: when a teacher is archived, they must no longer be
   *  available for ANY active assignment. So if the same teacher is assigned
   *  to multiple slots (e.g. Class Teacher + Section A Teacher), all those
   *  slots must become vacant.
   *
   *  Implementation: set the pending key to '' (empty string) instead of
   *  deleting it, so that resolveNext() correctly returns null on Save
   *  (hasOwnProperty is true, value is falsy → null).
   */
  const markArchive = (key: string, teacherId: string) => {
    setPendingArchives((prev) => prev.includes(teacherId) ? prev : [...prev, teacherId])
    // Clear ALL pending keys that reference this teacher ID (not just the clicked slot).
    setPending((p) => {
      const n = { ...p }
      for (const [k, v] of Object.entries(n)) {
        if (v === teacherId) n[k] = ''  // Set to '' (vacant), NOT delete
      }
      return n
    })
  }

  const enterEdit = () => {
    setEditMode(true)
    setPending(buildInitialState()) // Pre-populate with existing values
    setPendingArchives([])
  }
  const exitEdit = () => {
    setEditMode(false)
    setPending({})
    setPendingArchives([])
  }

  const save = () => {
    const initial = buildInitialState()
    let changeCount = 0

    // Helper: resolve the pending value for a key.
    // - If the key EXISTS in pending → use pending[key] (may be '' or a teacherId).
    // - If the key was DELETED from pending (by markArchive) → return null (cleared).
    // - If the key was NEVER in pending (no change from canonical) → use initial[key].
    const resolveNext = (key: string): string | null => {
      if (Object.prototype.hasOwnProperty.call(pending, key)) {
        return pending[key] || null
      }
      return initial[key] ?? null
    }

    // Class Teacher — write through to the SERVER record when this class
    // is server-linked (the authoritative Class.classTeacherId that gates
    // the Teacher's My Class capabilities), plus the legacy mock store.
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

    // Commit teacher archive lifecycle (brief section 5: archive moves teacher
    // out of active pool — this is a teacher-record mutation, not just an
    // assignment change).
    pendingArchives.forEach((id) => {
      archiveTeacherAction(id)
      changeCount++
    })

    if (changeCount > 0) {
      const archiveNote = pendingArchives.length > 0 ? ` · ${pendingArchives.length} teacher(s) archived` : ''
      toast.success(`${changeCount} change(s) saved${archiveNote}`)
    }
    exitEdit()
  }

  // Resolve what to display: pending value if editing, otherwise canonical value.
  // markArchive sets pending keys to '' (vacant), so the display correctly
  // shows the vacant dropdown for archived-teacher slots.
  const resolveTeacherId = (key: string, fallback: string | null | undefined): string => {
    if (editMode) {
      if (Object.prototype.hasOwnProperty.call(pending, key)) {
        return pending[key] || ''
      }
      return fallback ?? ''
    }
    return fallback ?? ''
  }

  // Count of already-archived teachers (committed in store) — for the "Archived" button badge.
  const archivedCount = teachers.filter((t) => t.archived).length

  return (
    <div className="space-y-5">
      {/* Mode toggle + Edit + Archived */}
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
          {/* Archived Teachers — compact, subtle, with count badge */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setArchivedDialogOpen(true)}
            title="View archived teachers"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archived</span>
            {archivedCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">{archivedCount}</Badge>
            )}
          </Button>
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
            onArchive={() => {
              const id = pending['class_teacher'] ?? liveClass.classTeacherId
              if (id) markArchive('class_teacher', id)
            }}
          />
          <TeacherAssignmentControl
            label="Assistant Class Teacher"
            teacherId={resolveTeacherId('class_assistant', liveClass.assistantTeacherId)}
            editMode={editMode}
            pickerId="class_assistant"
            options={teacherOptions}
            onSelect={(v) => setP('class_assistant', v)}
            onArchive={() => {
              const id = pending['class_assistant'] ?? liveClass.assistantTeacherId
              if (id) markArchive('class_assistant', id)
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
                      onArchive={() => {
                        const id = pending[`section_teacher|${sec.id}`] ?? sec.classTeacherId
                        if (id) markArchive(`section_teacher|${sec.id}`, id)
                      }}
                    />
                    <TeacherAssignmentControl
                      label="Assistant"
                      teacherId={secAssistantId}
                      editMode={editMode}
                      pickerId={`section_assistant|${sec.id}`}
                      options={teacherOptions}
                      onSelect={(v) => setP(`section_assistant|${sec.id}`, v)}
                      onArchive={() => {
                        const id = pending[`section_assistant|${sec.id}`] ?? sec.assistantTeacherId
                        if (id) markArchive(`section_assistant|${sec.id}`, id)
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
                    {secTeacher && !secTeacher.archived ? (
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

      <ArchivedTeachersPanel open={archivedDialogOpen} onOpenChange={setArchivedDialogOpen} />
    </div>
  )
}
