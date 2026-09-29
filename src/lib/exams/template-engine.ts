// ──────────────────────────────────────────────────────────────────────
// Smart template engine — generates exam config + schedule from
// template + dates + real school data.
//
// KEY PRINCIPLES:
//   • One schedule slot per SUBJECT (not per class). Multiple selected
//     classes share the same slot.
//   • Sunday is always skipped (day index 0).
//   • Unit Test: 2 papers/day, 1hr each, 15min gap (09:00-10:00, 10:15-11:15)
//   • Half-Yearly/Annual: 1 paper/day, 3h15m (09:00-12:15)
//   • Pass percentage is FIXED at 33% globally — not configurable per exam.
//   • Date range validation surfaces required vs available working days.
//   • Stream alternatives (Mathematics/Biology) share ONE date+time slot
//     when both PCM and PCB classes are in the same exam (Spec §13, §41).
// ──────────────────────────────────────────────────────────────────────

export const FIXED_PASS_PERCENTAGE = 33

export interface SubjectInfo {
  id: string
  name: string
  code: string | null
}

export interface ClassInfo {
  id: string
  name: string
  gradeLevel: string | null
  stream: string | null
  studentCount: number
  subjects: SubjectInfo[]
}

export interface GeneratedScheduleItem {
  subjectId: string
  subjectName: string
  date: string
  startTime: string
  endTime: string
  room: string
  invigilatorName: string
  classIds: string[] // multiple classes share one slot
}

export interface GeneratedSubjectConfig {
  subjectId: string
  maxMarks: number
  theoryMarks: number
  practicalMarks: number
}

export interface TemplateMeta {
  maxMarks: number
  theoryMarks: number
  practicalMarks: number
  papersPerDay: number
  paperDurationMin: number
  gapMin: number
  hasPractical: boolean
}

export interface GeneratedExamConfig {
  name: string
  type: string
  startDate: string
  endDate: string
  passPercentage: number
  selectedClassIds: string[]
  subjects: GeneratedSubjectConfig[]
  schedule: GeneratedScheduleItem[]
  hasPractical: boolean
}

export const TEMPLATE_METAS: Record<string, TemplateMeta> = {
  'unit-test-1': { maxMarks: 50, theoryMarks: 50, practicalMarks: 0, papersPerDay: 2, paperDurationMin: 60, gapMin: 15, hasPractical: false },
  'unit-test-2': { maxMarks: 50, theoryMarks: 50, practicalMarks: 0, papersPerDay: 2, paperDurationMin: 60, gapMin: 15, hasPractical: false },
  'unit-test-3': { maxMarks: 50, theoryMarks: 50, practicalMarks: 0, papersPerDay: 2, paperDurationMin: 60, gapMin: 15, hasPractical: false },
  'unit-test-4': { maxMarks: 50, theoryMarks: 50, practicalMarks: 0, papersPerDay: 2, paperDurationMin: 60, gapMin: 15, hasPractical: false },
  'half-yearly': { maxMarks: 100, theoryMarks: 70, practicalMarks: 30, papersPerDay: 1, paperDurationMin: 195, gapMin: 0, hasPractical: true },
  'annual': { maxMarks: 100, theoryMarks: 70, practicalMarks: 30, papersPerDay: 1, paperDurationMin: 195, gapMin: 0, hasPractical: true },
  'practical': { maxMarks: 100, theoryMarks: 0, practicalMarks: 100, papersPerDay: 1, paperDurationMin: 180, gapMin: 0, hasPractical: true },
  'pre-board': { maxMarks: 100, theoryMarks: 80, practicalMarks: 20, papersPerDay: 1, paperDurationMin: 195, gapMin: 0, hasPractical: true },
  'oral-viva': { maxMarks: 50, theoryMarks: 0, practicalMarks: 50, papersPerDay: 1, paperDurationMin: 30, gapMin: 0, hasPractical: true },
  'custom': { maxMarks: 100, theoryMarks: 100, practicalMarks: 0, papersPerDay: 1, paperDurationMin: 180, gapMin: 0, hasPractical: false },
}

export function getTemplateMeta(templateId: string): TemplateMeta {
  return TEMPLATE_METAS[templateId] ?? TEMPLATE_METAS['custom']
}

// ─── Stream alternative pairs (Spec §13, §41) ──────────────────────────
// When PCM and PCB classes are both selected in the same exam, these
// subject pairs share ONE date+time slot in the timetable.
//   • Maths  (PCM)  ←→  Biology  (PCB)
// The deduplication layer in the UI already produces one entry per
// canonical subject name; this map identifies which two distinct names
// should be scheduled together when both appear.
export const STREAM_ALTERNATIVE_PAIRS: Array<[string, string]> = [
  ['Maths', 'Biology'],
]

/**
 * Find the alternative partner for a given subject name, if any.
 * Returns the partner's name, or null if the subject is not part of an
 * alternative pair.
 */
export function getStreamAlternative(subjectName: string): string | null {
  for (const [a, b] of STREAM_ALTERNATIVE_PAIRS) {
    if (subjectName === a) return b
    if (subjectName === b) return a
  }
  return null
}

/**
 * Whether both sides of an alternative pair are present in `subjects`.
 * If true, the scheduler must place the pair on the same date+time slot.
 */
function _isAlternativeActive(subjects: SubjectInfo[], primary: string, alt: string): boolean {
  return subjects.some((s) => s.name === primary) && subjects.some((s) => s.name === alt)
}

// ─── Generate exam config ────────────────────────────────────────────

export function generateExamConfig(
  templateId: string,
  templateLabel: string,
  startDate: string,
  endDate: string,
  classes: ClassInfo[],
  subjects: SubjectInfo[],
  examTime: string = '09:00',
): GeneratedExamConfig {
  const meta = getTemplateMeta(templateId)
  const hasPractical = meta.practicalMarks > 0
  const selectedClassIds = classes.map((c) => c.id)

  const subjectConfigs: GeneratedSubjectConfig[] = subjects.map((s) => ({
    subjectId: s.id,
    maxMarks: meta.maxMarks,
    theoryMarks: meta.theoryMarks,
    practicalMarks: meta.practicalMarks,
  }))

  const schedule = generateSchedule(templateId, startDate, endDate, subjects, classes, meta, examTime)

  return {
    name: templateLabel,
    type: templateLabel,
    startDate,
    endDate: endDate || startDate,
    passPercentage: FIXED_PASS_PERCENTAGE,
    selectedClassIds,
    subjects: subjectConfigs,
    schedule,
    hasPractical,
  }
}

// ─── Smart scheduling engine ────────────────────────────────────────
// One slot per subject. All selected classes share that slot.
// Sunday is always skipped.
// Stream alternatives (Mathematics/Biology) collapse into ONE slot.

function generateSchedule(
  templateId: string,
  startDateStr: string,
  endDateStr: string,
  subjects: SubjectInfo[],
  classes: ClassInfo[],
  meta: TemplateMeta,
  examTime: string = '09:00',
): GeneratedScheduleItem[] {
  const start = new Date(startDateStr)
  const end = new Date(endDateStr || startDateStr)

  // Collect working days (skip Sunday = 0)
  const workingDays: Date[] = []
  const current = new Date(start)
  current.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (current <= end) {
    if (current.getDay() !== 0) workingDays.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  // If no working days (e.g. range is entirely Sundays), fall back to start date
  if (workingDays.length === 0) workingDays.push(new Date(start))

  const allClassIds = classes.map((c) => c.id)

  // ─── Build the iteration list, collapsing stream alternatives ────────
  // When Mathematics AND Biology are both in `subjects`, they should
  // share ONE date+time slot. The primary entry carries both subjectIds
  // so the UI can render "Mathematics / Biology" as a single row, and
  // the per-class storage layer can route each subject to its own class.
  type Slot = {
    primary: SubjectInfo
    alt: SubjectInfo | null   // non-null only when alternative is active
  }
  const skippedAltNames = new Set<string>()
  const slots: Slot[] = []
  for (const subject of subjects) {
    if (skippedAltNames.has(subject.name)) continue
    const altName = getStreamAlternative(subject.name)
    const alt = altName ? subjects.find((s) => s.name === altName) ?? null : null
    if (altName && alt) {
      // Both halves of the pair are present → collapse.
      skippedAltNames.add(alt.name)
      slots.push({ primary: subject, alt })
    } else {
      slots.push({ primary: subject, alt: null })
    }
  }

  const items: GeneratedScheduleItem[] = []
  let dayIdx = 0
  let papersToday = 0
  const startTimeBase = examTime || '09:00'

  for (const slot of slots) {
    const date = workingDays[dayIdx % workingDays.length]
    const dateStr = date.toISOString().split('T')[0]

    if (meta.papersPerDay === 2) {
      // Unit Test: 2 papers/day, 1hr each, 15min gap
      const shift = papersToday // 0 = first, 1 = second
      const startTime = shift === 0 ? startTimeBase : addTime(startTimeBase, meta.paperDurationMin + meta.gapMin)
      const endTime = addTime(startTime, meta.paperDurationMin)

      // Primary (or solo) item — if alt is present, both items share the
      // SAME date+time slot. The display layer merges them visually as
      // "Mathematics / Biology"; the storage layer routes per-class.
      items.push({
        subjectId: slot.primary.id,
        subjectName: slot.primary.name,
        date: dateStr,
        startTime,
        endTime,
        room: '',
        invigilatorName: '',
        classIds: [...allClassIds], // ALL classes share this slot
      })
      if (slot.alt) {
        items.push({
          subjectId: slot.alt.id,
          subjectName: slot.alt.name,
          date: dateStr,
          startTime,
          endTime,
          room: '',
          invigilatorName: '',
          classIds: [...allClassIds],
        })
      }

      papersToday++
      if (papersToday >= meta.papersPerDay) {
        papersToday = 0
        dayIdx++
      }
    } else {
      // Half-Yearly/Annual: 1 paper/day, 3h15m
      const endTime = addTime(startTimeBase, meta.paperDurationMin)
      items.push({
        subjectId: slot.primary.id,
        subjectName: slot.primary.name,
        date: dateStr,
        startTime: startTimeBase,
        endTime,
        room: '',
        invigilatorName: '',
        classIds: [...allClassIds],
      })
      if (slot.alt) {
        items.push({
          subjectId: slot.alt.id,
          subjectName: slot.alt.name,
          date: dateStr,
          startTime: startTimeBase,
          endTime,
          room: '',
          invigilatorName: '',
          classIds: [...allClassIds],
        })
      }
      dayIdx++
    }
  }

  return items
}

// ─── Validate date range ────────────────────────────────────────────

export interface ScheduleValidation {
  isValid: boolean
  requiredDays: number
  availableDays: number
  message: string
}

/**
 * Count the number of schedule slots needed for the given subject names,
 * collapsing stream alternatives (Mathematics + Biology → 1 slot) per
 * Spec §13/§41. Caller passes the subject NAMES (not SubjectInfo[]) so
 * this works for any list of deduped subjects.
 */
export function countScheduleSlots(subjectNames: string[]): number {
  const consumed = new Set<string>()
  let count = 0
  for (const name of subjectNames) {
    if (consumed.has(name)) continue
    const alt = getStreamAlternative(name)
    if (alt && subjectNames.includes(alt)) {
      // Both halves of the pair are present → one combined slot.
      consumed.add(name)
      consumed.add(alt)
      count++
    } else {
      consumed.add(name)
      count++
    }
  }
  return count
}

export function validateDateRange(
  templateId: string,
  startDateStr: string,
  endDateStr: string,
  subjectCount: number,
): ScheduleValidation {
  const meta = getTemplateMeta(templateId)
  const start = new Date(startDateStr)
  const end = new Date(endDateStr || startDateStr)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  // Count working days (skip Sunday)
  let availableDays = 0
  const current = new Date(start)
  while (current <= end) {
    if (current.getDay() !== 0) availableDays++
    current.setDate(current.getDate() + 1)
  }

  // Required days = ceil(slots / papersPerDay) — `subjectCount` is
  // expected to already account for stream alternatives (one slot per
  // Mathematics/Biology pair). The caller can compute this via
  // `countScheduleSlots(subjectNames)`. For backwards-compat, if the
  // caller passes a raw subject count without collapsing alternatives,
  // the result is slightly over-estimated (still safe — just gives a
  // "more days required" warning that may not actually be needed).
  const requiredDays = Math.ceil(subjectCount / meta.papersPerDay)

  if (availableDays === 0) {
    return {
      isValid: false,
      requiredDays,
      availableDays,
      message: `Selected date range contains no working days (all Sundays?). Choose a different date range.`,
    }
  }

  if (availableDays < requiredDays) {
    return {
      isValid: false,
      requiredDays,
      availableDays,
      message: `Selected date range is not sufficient for all papers. ${subjectCount} subjects require ${requiredDays} working days (max ${meta.papersPerDay} papers/day, Sundays skipped), but only ${availableDays} working days are available.`,
    }
  }

  return { isValid: true, requiredDays, availableDays, message: '' }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function addTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hrs = Math.floor(total / 60)
  const mins = total % 60
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}
