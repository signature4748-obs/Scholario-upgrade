/**
 * Generate coherent seed data for mock examinations.
 *
 * Builds ExamClassDTO[], ExamSubjectConfigDTO[], ScheduleItemDTO[]
 * from the shared academic module — same source as Students & Classes.
 */

import type { ExamClassDTO, ExamSubjectConfigDTO, ScheduleItemDTO } from '@/lib/exams/types'
import { INITIAL_SUBJECTS, NURSERY_TO_10_SUBJECT_IDS, SCIENCE_PCM_SUBJECT_IDS, SCIENCE_PCB_SUBJECT_IDS } from '@/lib/mock/academic/subjects'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function toLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h ?? 0) * 60 + (m ?? 0) + mins
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

interface SeedClassDef {
  classId: string
  className: string
  gradeLevel: string
  stream: string | null
  studentCount: number
  subjectIds: string[]
}

/** Build coherent ExamClassDTO[] + ExamSubjectConfigDTO[] for a seed exam. */
export function buildSeedClassesAndSubjects(classDefs: SeedClassDef[]): {
  classes: ExamClassDTO[]
  subjects: ExamSubjectConfigDTO[]
} {
  const classes: ExamClassDTO[] = classDefs.map((c, i) => ({
    id: `ec-${i}`,
    examId: 'seed',
    classId: c.classId,
    className: c.className,
    gradeLevel: c.gradeLevel,
    section: null,
    stream: c.stream,
    studentCount: c.studentCount,
  }))

  const subjects: ExamSubjectConfigDTO[] = []
  let sortOrder = 0
  for (const c of classDefs) {
    for (const subjectId of c.subjectIds) {
      const subj = INITIAL_SUBJECTS.find((s) => s.id === subjectId)
      if (!subj) continue
      subjects.push({
        id: `sc-${c.classId}-${subjectId}`,
        examId: 'seed',
        classId: c.classId,
        subjectId: subj.id,
        subjectName: subj.name,
        subjectCode: subj.code,
        maxMarks: 50,
        passMarks: 17,
        theoryMarks: 50,
        practicalMarks: 0,
        sortOrder: sortOrder++,
      })
    }
  }

  return { classes, subjects }
}

/** Build a simple schedule for a seed exam. */
export function buildSeedSchedule(
  examId: string,
  startDate: string,
  endDate: string,
  classes: ExamClassDTO[],
  subjects: ExamSubjectConfigDTO[],
  papersPerDay: number = 2,
  startTime: string = '09:00',
  paperDurationMin: number = 60,
  gapMin: number = 15,
): ScheduleItemDTO[] {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  const workingDays: Date[] = []
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (cur <= end) {
    if (cur.getDay() !== 0) workingDays.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }

  // Collect all (classId, subjectId) pairs.
  const pairs: Array<{ classId: string; subjectId: string; subjectName: string; subjectCode: string | null }> = []
  for (const cls of classes) {
    for (const subj of subjects.filter((s) => s.classId === cls.classId)) {
      pairs.push({ classId: cls.classId, subjectId: subj.subjectId, subjectName: subj.subjectName, subjectCode: subj.subjectCode })
    }
  }

  const schedule: ScheduleItemDTO[] = []
  let dayIdx = 0
  let slotIdx = 0
  for (const pair of pairs) {
    if (dayIdx >= workingDays.length) break
    const date = workingDays[dayIdx]
    const dateStr = toLocalISO(date)
    const _dayLabel = DAY_LABELS[date.getDay()] ?? ''
    const st = slotIdx === 0 ? startTime : addMinutes(startTime, paperDurationMin + gapMin)
    const et = addMinutes(st, paperDurationMin)
    schedule.push({
      id: `sch-${examId}-${pair.classId}-${pair.subjectId}`,
      examId,
      classId: pair.classId,
      className: classes.find((c) => c.classId === pair.classId)?.className ?? pair.classId,
      subjectId: pair.subjectId,
      subjectName: pair.subjectName,
      date: dateStr,
      startTime: st,
      endTime: et,
      room: null,
      invigilatorId: null,
      invigilatorName: null,
    })
    slotIdx++
    if (slotIdx >= papersPerDay) { slotIdx = 0; dayIdx++ }
  }

  return schedule
}

/**
 * Class definitions for the seed exams — an ORDERED ARRAY: index 0 powers
 * the first seed exam (Unit Test 2 / Quarterly), index 1 the Final
 * Examination, index 2 the Mid-Term. Positional by design — exam ids are
 * tenant-scoped (`exam-<tenantcode>-N`) so keying by id would never match.
 */
export const SEED_CLASS_DEFS: SeedClassDef[][] = [
  [
    { classId: 'C09', className: 'Class 6', gradeLevel: '6', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C11', className: 'Class 8', gradeLevel: '8', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C12', className: 'Class 9', gradeLevel: '9', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C13', className: 'Class 10', gradeLevel: '10', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C14-PCM', className: 'Class 11', gradeLevel: '11', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
    { classId: 'C14-PCB', className: 'Class 11', gradeLevel: '11', stream: 'Science-PCB', studentCount: 4, subjectIds: SCIENCE_PCB_SUBJECT_IDS },
    { classId: 'C15-PCM', className: 'Class 12', gradeLevel: '12', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
    { classId: 'C15-PCB', className: 'Class 12', gradeLevel: '12', stream: 'Science-PCB', studentCount: 4, subjectIds: SCIENCE_PCB_SUBJECT_IDS },
  ],
  [
    { classId: 'C12', className: 'Class 9', gradeLevel: '9', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C13', className: 'Class 10', gradeLevel: '10', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C14-PCM', className: 'Class 11', gradeLevel: '11', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
    { classId: 'C15-PCM', className: 'Class 12', gradeLevel: '12', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
  ],
  [
    { classId: 'C12', className: 'Class 9', gradeLevel: '9', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C13', className: 'Class 10', gradeLevel: '10', stream: null, studentCount: 4, subjectIds: NURSERY_TO_10_SUBJECT_IDS },
    { classId: 'C14-PCM', className: 'Class 11', gradeLevel: '11', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
    { classId: 'C14-PCB', className: 'Class 11', gradeLevel: '11', stream: 'Science-PCB', studentCount: 4, subjectIds: SCIENCE_PCB_SUBJECT_IDS },
    { classId: 'C15-PCM', className: 'Class 12', gradeLevel: '12', stream: 'Science-PCM', studentCount: 4, subjectIds: SCIENCE_PCM_SUBJECT_IDS },
    { classId: 'C15-PCB', className: 'Class 12', gradeLevel: '12', stream: 'Science-PCB', studentCount: 4, subjectIds: SCIENCE_PCB_SUBJECT_IDS },
  ],
]
