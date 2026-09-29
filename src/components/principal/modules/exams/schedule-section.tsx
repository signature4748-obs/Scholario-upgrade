'use client'

/**
 * Schedule section for the ExamWorkspace.
 *
 * Renders the canonical examination timetable (view + edit + download).
 * Edit mode uses the drag/drop ScheduleTable; view mode renders the
 * official printable OfficialTimetable.
 */

import { useState, useMemo } from 'react'
import { Download, Pencil, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { generateSchedulePDF } from '@/lib/exams/schedule-pdf'
import { useSchoolProfile } from '@/lib/school-profile'
import { buildTimetableFromExam, buildConsolidatedTimetableFromExam } from '@/lib/exams/schedule/exam-timetable'
import type { ScheduleTimetable } from '@/lib/exams/schedule/schedule-types'
import { useScheduleState } from '@/lib/exams/schedule/use-schedule-state'
import { ScheduleTable } from './schedule/schedule-table'
import { OfficialTimetable } from './schedule/official-timetable'
import { formatDateLong } from '@/lib/exams/format-helpers'
import { useRoleGate } from '@/lib/exams/use-role-gate'
import type { ExamDTO } from '@/lib/exams/types'

export function ScheduleSection({ exam }: { exam: ExamDTO; onReload?: () => void }) {
  const schoolProfile = useSchoolProfile()
  const gate = useRoleGate()
  const [editMode, setEditMode] = useState(false)

  // Build the canonical timetable from the exam's stored schedule.
  const timetable = useMemo(() => buildTimetableFromExam(exam), [exam])
  const consolidated = useMemo(() => buildConsolidatedTimetableFromExam(exam), [exam])

  // Edit-mode state (drag/drop override).
  const [_editTimetable, _setEditTimetable] = useState<ScheduleTimetable | null>(null)
  const _editState = useScheduleState({
    classes: timetable.classes,
    options: null,
  })

  const handleDownload = () => {
    try { generateSchedulePDF(exam, consolidated) } catch { toast.error('Failed to generate PDF') }
  }

  const dateRangeLabel = useMemo(() => {
    if (!exam.startDate) return ''
    const startLbl = formatDateLong(exam.startDate)
    if (!exam.endDate || exam.endDate === exam.startDate) return startLbl
    return `${startLbl} – ${formatDateLong(exam.endDate)}`
  }, [exam.startDate, exam.endDate])

  const examType = exam.type === 'UT1' ? 'Unit Test 1' : exam.type === 'UT2' ? 'Unit Test 2' : exam.type === 'HALF_YEARLY' ? 'Half-Yearly' : exam.type === 'ANNUAL' ? 'Annual' : exam.type
  const papersPerDay = timetable.rows.length > 0 && timetable.rows.length > 1 && timetable.rows[0].date === timetable.rows[1].date ? 2 : 1
  const startTime = exam.schedule[0]?.startTime ?? '09:00'

  return (
    <div className="space-y-3">
      {/* Compact action row — Edit + Download only (no Archive) */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground">
          {exam.schedule.length} papers · {exam.classes.length} classes
        </div>
        <div className="flex items-center gap-1">
          {gate.canManageSchedule && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditMode(!editMode)} title={editMode ? 'View Mode' : 'Edit Timetable'}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleDownload} title="Download Schedule">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editMode ? (
        <div className="space-y-2">
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditMode(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setEditMode(false); toast.success('Schedule saved') }}>
              <Save className="h-3 w-3" /> Save Changes
            </Button>
          </div>
          {timetable.rows.length > 0 ? (
            <ScheduleTable timetable={timetable} onMoveSubject={() => {}} />
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">No schedule items. Add them from Create Examination.</div>
          )}
        </div>
      ) : (
        consolidated.rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No schedule items yet.</div>
        ) : (
          <OfficialTimetable
            timetable={consolidated}
            schoolName={schoolProfile.name}
            examName={exam.name}
            examType={examType}
            academicSession={exam.session ?? '2025-2026'}
            dateRangeLabel={dateRangeLabel}
            startTime={startTime}
            papersPerDay={papersPerDay}
          />
        )
      )}
    </div>
  )
}
