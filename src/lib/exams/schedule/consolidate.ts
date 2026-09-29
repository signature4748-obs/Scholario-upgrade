/**
 * Consolidate per-stream schedule columns into one column per grade.
 *
 * Spec §1 / §3 / §4 / §5 / §14:
 *   Class 11 PCM + Class 11 PCB → ONE "Class 11" column.
 *   Class 12 PCM + Class 12 PCB → ONE "Class 12" column.
 *
 * Common subjects (Hindi, English, Physics, Chemistry) appear ONCE.
 * Group-specific subjects (Maths for PCM, Biology for PCB) are combined
 * into a single cell label "Maths / Biology".
 *
 * The underlying academic data (Students & Classes) is NOT changed —
 * PCM/PCB remain separate ClassRecords there. Only the examination
 * timetable presentation is consolidated.
 *
 * The algorithm is GENERIC (Spec §5 / §7): it groups by `gradeLevel`
 * and merges any number of streams. No hardcoded "PCM"/"PCB"/"Maths"/
 * "Biology" — it compares subject NAMES across groups in the same slot.
 */

import type {
  ScheduleTimetable,
  ScheduleRow,
  ScheduleCell,
} from './schedule-types'

/** A consolidated cell — may hold one subject or a combined "A / B". */
export interface ConsolidatedCell {
  /** Subject(s) in this cell. One entry = single subject; 2+ = combined. */
  subjects: Array<{ id: string; name: string; code: string }>
  /** Display label — "Hindi" or "Maths / Biology". */
  label: string
}

export interface ConsolidatedColumn {
  /** Column key — the gradeLevel (e.g. "11", "12", "6"). */
  gradeLevel: string
  /** Column header label — "Class 11", "Class 6", etc. */
  label: string
  /** Underlying stream class ids that were merged into this column. */
  streamClassIds: string[]
}

export interface ConsolidatedTimetable {
  /** One column per grade (streams merged). */
  columns: ConsolidatedColumn[]
  /** Rows — same date/slot structure as ScheduleTimetable. */
  rows: Array<Omit<ScheduleRow, 'cells'> & { cells: (ConsolidatedCell | null)[] }>
  /** Whether all subjects fit. */
  fits: boolean
  /** How many more days needed. */
  additionalDaysNeeded: number
}

/**
 * Build a mapping from stream-class-id → gradeLevel, using the source
 * timetable's `classes` array. The `ScheduleClass.id` in the per-stream
 * timetable is the exam-class key (e.g. "11-Science-PCM"). We need the
 * gradeLevel to group — we pass `examClasses` so the caller can supply
 * the grade mapping (the ScheduleClass itself doesn't carry gradeLevel).
 */
export interface GradeMapping {
  /** Map from ScheduleClass.id (exam-class key) → gradeLevel string. */
  [examClassKey: string]: { gradeLevel: string; label: string }
}

/**
 * Consolidate a per-stream ScheduleTimetable into one column per grade.
 *
 * @param timetable   The per-stream timetable (one column per stream class).
 * @param gradeMap    Maps each stream class id → { gradeLevel, label }.
 *                    The label should be the base class name without stream
 *                    suffix (e.g. "Class 11", NOT "Class 11 — Science PCM").
 */
export function consolidateByGrade(
  timetable: ScheduleTimetable,
  gradeMap: GradeMapping,
): ConsolidatedTimetable {
  // 1. Group stream class indices by gradeLevel.
  const gradeOrder: string[] = []
  const gradeToStreamIndices = new Map<string, number[]>()
  timetable.classes.forEach((cls, idx) => {
    const info = gradeMap[cls.id]
    const grade = info?.gradeLevel ?? cls.id
    if (!gradeToStreamIndices.has(grade)) {
      gradeToStreamIndices.set(grade, [])
      gradeOrder.push(grade)
    }
    gradeToStreamIndices.get(grade)!.push(idx)
  })

  // 2. Build consolidated columns.
  const columns: ConsolidatedColumn[] = gradeOrder.map((grade) => {
    const indices = gradeToStreamIndices.get(grade)!
    const firstStream = timetable.classes[indices[0]]
    const label = gradeMap[firstStream.id]?.label ?? `Class ${grade}`
    const streamClassIds = indices.map((i) => timetable.classes[i].id)
    return { gradeLevel: grade, label, streamClassIds }
  })

  // 3. Build consolidated rows. For each row, for each grade column, merge
  //    the stream cells into one consolidated cell.
  const rows = timetable.rows.map((row) => {
    const consolidatedCells: (ConsolidatedCell | null)[] = gradeOrder.map((grade) => {
      const indices = gradeToStreamIndices.get(grade)!
      const streamCells = indices.map((i) => row.cells[i]).filter(Boolean) as ScheduleCell[]
      if (streamCells.length === 0) return null
      return mergeCells(streamCells)
    })
    return {
      date: row.date,
      dayLabel: row.dayLabel,
      slotIndex: row.slotIndex,
      slotLabel: row.slotLabel,
      startTime: row.startTime,
      endTime: row.endTime,
      cells: consolidatedCells,
    }
  })

  return {
    columns,
    rows,
    fits: timetable.fits,
    additionalDaysNeeded: timetable.additionalDaysNeeded,
  }
}

/**
 * Merge multiple stream cells into one consolidated cell.
 *
 * - If all cells have the SAME subject (by id) → single-subject cell.
 * - If cells have DIFFERENT subjects → combine with " / ".
 *   (e.g. Maths + Biology → "Maths / Biology")
 * - Duplicate subjects across streams are collapsed to one entry.
 */
function mergeCells(cells: ScheduleCell[]): ConsolidatedCell {
  // Dedupe by subjectId, preserve order of first appearance.
  const seen = new Map<string, { id: string; name: string; code: string }>()
  for (const c of cells) {
    if (!seen.has(c.subjectId)) {
      seen.set(c.subjectId, { id: c.subjectId, name: c.subjectName, code: c.subjectCode })
    }
  }
  const subjects = Array.from(seen.values())
  const label = subjects.map((s) => s.name).join(' / ')
  return { subjects, label }
}

/**
 * Flatten the consolidated timetable for submission — one entry per
 * non-empty consolidated cell, expanding combined cells into one entry
 * per underlying subject (so the storage layer routes each subject to
 * its own stream class).
 *
 * @param timetable      Consolidated timetable.
 * @param streamTimetable The original per-stream timetable (to resolve
 *                       which stream class each subject belongs to).
 */
export function flattenConsolidatedTimetable(
  timetable: ConsolidatedTimetable,
  streamTimetable: ScheduleTimetable,
): Array<{
  classId: string
  subjectId: string
  date: string
  startTime: string
  endTime: string
  room?: string
  invigilatorName?: string
}> {
  const out: Array<{ classId: string; subjectId: string; date: string; startTime: string; endTime: string; room?: string; invigilatorName?: string }> = []
  timetable.rows.forEach((row, _rowIdx) => {
    timetable.columns.forEach((col, colIdx) => {
      const cell = row.cells[colIdx]
      if (!cell || cell.subjects.length === 0) return
      // For each subject in the consolidated cell, find the underlying
      // stream class that owns it, and emit one submission entry.
      for (const subj of cell.subjects) {
        // Find the stream class index in this grade column that has this subject.
        const streamIndices = col.streamClassIds.map((id) =>
          streamTimetable.classes.findIndex((sc) => sc.id === id),
        )
        // Find which stream class has this subject id in its subject list.
        const owningStreamIdx = streamIndices.find((sIdx) =>
          sIdx >= 0 && streamTimetable.classes[sIdx].subjects.some((s) => s.id === subj.id),
        )
        const classId = owningStreamIdx != null && owningStreamIdx >= 0
          ? streamTimetable.classes[owningStreamIdx].id
          : col.streamClassIds[0]
        out.push({
          classId,
          subjectId: subj.id,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          room: '',
          invigilatorName: '',
        })
      }
    })
  })
  return out
}
