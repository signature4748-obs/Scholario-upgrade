'use client'

/**
 * SubjectCard — universal subject entity presentation.
 *
 * Built on the shared `EntityCard` primitive — same surface / border /
 * typography / spacing as TeacherCard, StudentCard, etc.
 *
 * Spec §28: Subject metadata (code, category) is resolved from the
 * canonical `academicSubjects` registry in the Zustand store — NOT from
 * a local `SUBJECTS_BY_LEVEL` constant. This means renames and code
 * changes propagate automatically (Spec §9).
 *
 * The card receives a subject NAME (for backward-compat with callers
 * that haven't migrated to ids yet) and looks up the matching subject
 * in the registry by name. If not found, it falls back to a derived code.
 */

import { BookOpen, Archive, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EntityCard } from '../../shared/entity-card'
import { useStudentsStore } from '@/lib/store/students-store'
// PHASE 7 — the assigned subject teacher resolves from the server roster.
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import type { ClassRecord } from '@/lib/store/students-store'
import { RenameSubjectDialog } from './rename-subject-dialog'

export interface SubjectCardProps {
  /** Subject display name (e.g. "English"). */
  subject: string
  /** Class context — used to look up the assigned teacher. */
  cls: ClassRecord
  /** When true, exposes the inline Archive + Rename actions. Default false. */
  manageable?: boolean
  /** Optional handler invoked when user clicks Archive. */
  onArchive?: (subject: string) => void
  /** Optional className to tweak surface from caller. */
  className?: string
}

export function SubjectCard({ subject, cls, manageable = false, onArchive, className }: SubjectCardProps) {
  // Spec §28 — resolve metadata from the canonical registry.
  const subj = useStudentsStore((s) =>
    s.academicSubjects.find((x) => x.name === subject || x.id === subject),
  )
  const category = subj?.category ?? 'Core'
  const code = subj?.code ?? subject.substring(0, 3).toUpperCase()

  // Look up the assigned teacher. Subject teachers are keyed by subject id
  // (Spec §28 — survives renames). For backward-compat, also try by name.
  // Dual-id match (Phase 7): ClassSubjectAssignment.teacherUserId is the
  // teacher's USER id; roster picks carry the Teacher row id.
  const teacherId = cls.subjectTeachers?.[subject] ?? (subj ? cls.subjectTeachers?.[subj.id] : undefined)
  const teacher = useTeacherRosterStore((s) =>
    teacherId ? s.teachers.find((t) => t.id === teacherId || t.userId === teacherId) : undefined
  )

  return (
    <EntityCard
      className={className}
      leading={<BookOpen className="h-3.5 w-3.5 text-primary" />}
      title={subject}
      secondary={
        <>
          <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">{code}</Badge>
          <span className="text-[10px] text-muted-foreground">{category}</span>
        </>
      }
      metadata={teacher ? `${teacher.name}${teacher.employeeId ? ` · ${teacher.employeeId}` : ''}` : 'No teacher assigned'}
      action={
        manageable ? (
          <div className="flex items-center gap-0.5">
            {subj && (
              <RenameSubjectDialog
                subjectId={subj.id}
                subjectName={subj.name}
                trigger={(open) => (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); open() }}
                    className="text-[10px] text-muted-foreground hover:text-foreground font-medium px-1.5 py-0.5 rounded hover:bg-muted/60 transition-colors inline-flex items-center gap-1"
                    title="Rename subject"
                  >
                    <Pencil className="h-3 w-3" />
                    Rename
                  </button>
                )}
              />
            )}
            {onArchive && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onArchive(subject) }}
                className="text-[10px] text-amber-600 hover:text-amber-700 font-medium px-1.5 py-0.5 rounded hover:bg-amber-500/10 transition-colors inline-flex items-center gap-1"
              >
                <Archive className="h-3 w-3" />
                Archive
              </button>
            )}
          </div>
        ) : undefined
      }
    />
  )
}
