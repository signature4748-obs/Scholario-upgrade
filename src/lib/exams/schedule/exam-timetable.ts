/**
 * Build ScheduleTimetable + ConsolidatedTimetable from a stored ExamDTO.
 *
 * Spec: single source of truth — the exam's stored schedule is the
 * canonical data. Both the view mode (OfficialTimetable) and edit mode
 * (ScheduleTable) consume this same data.
 */

import type { ExamDTO } from '@/lib/exams/types'
import type { ScheduleTimetable, ScheduleClass, ScheduleRow, ScheduleCell } from './schedule-types'
import type { ConsolidatedTimetable, GradeMapping } from './consolidate'
import { consolidateByGrade } from './consolidate'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function _toLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Build ScheduleClass[] from the exam's stored classes + subjects. */
export function buildScheduleClasses(exam: ExamDTO): ScheduleClass[] {
  return exam.classes.map((c) => ({
    id: c.classId,
    label: c.className,
    subjects: exam.subjects
      .filter((s) => s.classId === c.classId)
      .map((s) => ({ id: s.subjectId, name: s.subjectName, code: s.subjectCode ?? '' })),
  }))
}

/** Build a GradeMapping from the exam's classes (for consolidation). */
export function buildGradeMap(exam: ExamDTO): GradeMapping {
  const map: GradeMapping = {}
  for (const c of exam.classes) {
    map[c.classId] = { gradeLevel: c.gradeLevel ?? '0', label: c.className }
  }
  return map
}

/**
 * Build a ScheduleTimetable from the exam's stored schedule items.
 * Groups items by (date, slot) → rows; each cell holds the subject for
 * that class on that date+slot.
 */
export function buildTimetableFromExam(exam: ExamDTO): ScheduleTimetable {
  const classes = buildScheduleClasses(exam)

  // Group schedule items by date, then by startTime (slot).
  const byDateSlot = new Map<string, Map<string, typeof exam.schedule>>()
  for (const item of exam.schedule) {
    if (!byDateSlot.has(item.date)) byDateSlot.set(item.date, new Map())
    const slotMap = byDateSlot.get(item.date)!
    const slotKey = item.startTime
    if (!slotMap.has(slotKey)) slotMap.set(slotKey, [])
    slotMap.get(slotKey)!.push(item)
  }

  // Build rows in chronological order.
  const sortedDates = Array.from(byDateSlot.keys()).sort()
  const rows: ScheduleRow[] = []
  for (const date of sortedDates) {
    const d = parseLocalDate(date)
    const dayLabel = DAY_LABELS[d.getDay()] ?? ''
    const slotMap = byDateSlot.get(date)!
    const sortedSlots = Array.from(slotMap.keys()).sort()
    sortedSlots.forEach((startTime, slotIndex) => {
      const items = slotMap.get(startTime)!
      const firstItem = items[0]
      const endTime = firstItem.endTime
      const slotLabel = sortedSlots.length === 1 ? 'Single' : `Slot ${slotIndex + 1}`
      rows.push({
        date,
        dayLabel,
        slotIndex,
        slotLabel,
        startTime,
        endTime,
        cells: classes.map((cls) => {
          const item = items.find((s) => s.classId === cls.id)
          if (!item) return null
          return {
            subjectId: item.subjectId,
            subjectName: item.subjectName,
            subjectCode: item.subjectId,
          } as ScheduleCell
        }),
      })
    })
  }

  return {
    classes,
    rows,
    fits: true,
    additionalDaysNeeded: 0,
  }
}

/** Build a ConsolidatedTimetable from the exam (for view mode). */
export function buildConsolidatedTimetableFromExam(exam: ExamDTO): ConsolidatedTimetable {
  const timetable = buildTimetableFromExam(exam)
  const gradeMap = buildGradeMap(exam)
  return consolidateByGrade(timetable, gradeMap)
}
