// ──────────────────────────────────────────────────────────────────────
// Examination domain types — shared between API routes, services, and UI.
// All DTOs live here. No duplicate type definitions anywhere else.
// ──────────────────────────────────────────────────────────────────────

// Board / Stream canonical types (formerly in curriculum.ts; the rest of
// that file — subject preset arrays — was dead code and has been removed).
// Schools configure subjects per class+stream directly in Students &
// Classes; no preset arrays are needed anywhere else in the app.
export type Board = 'CBSE' | 'UP_BOARD' | 'ICSE' | 'STATE' | 'CUSTOM'
export type Stream = 'General' | 'Science-PCM' | 'Science-PCB' | 'Science-PCMB' | 'Commerce' | 'Humanities'

export interface AuthUserLike {
  id: string
  email: string
  name: string | null
  role: string
  schoolId: string | null
}

// ─── Exam types & statuses ───────────────────────────────────────────

export const EXAM_TYPES = [
  'Unit Test',
  'Periodic Assessment',
  'Quarterly',
  'Term Examination',
  'Half-Yearly',
  'Annual Examination',
  'Pre-Board',
  'Practical',
  'Viva / Oral',
  'Internal Assessment',
  'Custom',
] as const
export type ExamType = string

export const EXAM_STATUSES = ['Draft', 'Scheduled', 'Ongoing', 'Completed', 'Cancelled'] as const
export type ExamStatus = (typeof EXAM_STATUSES)[number]

export const RESULT_STATUSES = [
  'Not Started',
  'Marks Entry',
  'Under Verification',
  'Result Ready',
  'Result Declared',
] as const
export type ResultStatus = (typeof RESULT_STATUSES)[number]

// ─── Canonical status comparison helpers (2026-10-15 result-status fix) ──
//
// WHY THESE EXIST: Exam.resultStatus / Exam.status are free `String` columns
// (prisma schema), not Prisma enums — the value set is enforced by the
// write paths only. Two write lineages produced drift:
//   · the exam lifecycle (src/lib/exams/service.ts) writes the canonical
//     RESULT_STATUSES / EXAM_STATUSES values ('Result Declared', …), and
//   · the legacy demo seeds planted 'Declared' / 'COMPLETED' (a shorter
//     alias + upper-case) — historical rows in long-lived databases.
// Raw `===` comparisons therefore silently disagreed across surfaces
// (the principal overview counted 0/4 declared with 2 declared exams).
// The canonical representation is the enum value; every read compares
// through these helpers, which are case/whitespace-tolerant and accept
// the documented legacy alias. Write paths stay canonical (never write
// the alias).

/** Case/whitespace-insensitive exam-status equality ('COMPLETED' ≡ 'Completed'). */
export function examStatusIs(status: string | null | undefined, expected: ExamStatus): boolean {
  return (status ?? '').trim().toLowerCase() === expected.trim().toLowerCase()
}

/** Case/whitespace-insensitive result-status equality against a canonical value. */
export function resultStatusIs(resultStatus: string | null | undefined, expected: ResultStatus): boolean {
  return (resultStatus ?? '').trim().toLowerCase() === expected.trim().toLowerCase()
}

/** Legacy alias set: 'Declared' is a historical spelling of 'Result Declared'. */
const RESULT_DECLARED_LEGACY_ALIASES = new Set(['result declared', 'declared'])

/**
 * True when the exam's results are declared — canonical 'Result Declared'
 * OR the legacy 'Declared' alias (case/whitespace-tolerant). This is THE
 * single declared-check every read site must use; never compare raw
 * strings against either spelling.
 */
export function isResultDeclared(resultStatus: string | null | undefined): boolean {
  return RESULT_DECLARED_LEGACY_ALIASES.has((resultStatus ?? '').trim().toLowerCase())
}

export const MARK_STATUSES = ['PRESENT', 'ABSENT', 'MEDICAL', 'EXEMPTED'] as const
export type MarkStatus = (typeof MARK_STATUSES)[number]

export const WORKFLOW_STATUSES = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const OUTCOMES = ['PROMOTED', 'COMPARTMENT', 'RETEST', 'NOT_PROMOTED'] as const
export type Outcome = (typeof OUTCOMES)[number]

// ─── Grade scale (default fallback if school has no GradeScale rows) ──

export const DEFAULT_GRADE_BOUNDARIES = [
  { grade: 'A1', minPct: 90, color: 'emerald' },
  { grade: 'A2', minPct: 80, color: 'sky' },
  { grade: 'B1', minPct: 70, color: 'amber' },
  { grade: 'B2', minPct: 60, color: 'orange' },
  { grade: 'C1', minPct: 50, color: 'violet' },
  { grade: 'C2', minPct: 33, color: 'rose' },
  { grade: 'E', minPct: 0, color: 'rose' },
] as const

export interface GradeScaleRow {
  grade: string
  minPct: number
  maxPct: number
  color: string | null
  sortOrder: number
}

export function getGradeForPercentage(pct: number, scale: GradeScaleRow[] = []): { grade: string; color: string } {
  const rows = scale.length > 0 ? scale : DEFAULT_GRADE_BOUNDARIES
  // Normalize: sort by minPct desc, find first match
  const sorted = [...rows].sort((a, b) => Number(b.minPct) - Number(a.minPct))
  for (const r of sorted) {
    if (pct >= Number(r.minPct)) {
      return { grade: r.grade, color: r.color ?? 'rose' }
    }
  }
  return { grade: 'E', color: 'rose' }
}

// ─── API shape types (returned to client) ────────────────────────────

export interface ExamSubjectConfigDTO {
  id: string
  examId: string
  classId: string
  subjectId: string
  subjectName: string
  subjectCode: string | null
  maxMarks: number
  passMarks: number
  theoryMarks: number
  practicalMarks: number
  sortOrder: number
}

export interface ExamClassDTO {
  id: string
  examId: string
  classId: string
  className: string
  gradeLevel: string | null
  section: string | null
  stream: string | null
  studentCount: number
}

export interface ScheduleItemDTO {
  id: string
  examId: string
  classId: string
  className: string
  subjectId: string
  subjectName: string
  date: string
  startTime: string
  endTime: string
  room: string | null
  invigilatorId: string | null
  invigilatorName: string | null
}

export interface StudentDTO {
  id: string
  rollNo: string | null
  admissionNo: string | null
  name: string
  classId: string | null
}

export interface ExamMarkDTO {
  id: string
  examId: string
  classId: string
  subjectId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  marksObtained: number | null
  status: MarkStatus
  workflowStatus: WorkflowStatus
  originalMarks: number | null
  graceMarks: number
  graceReason: string | null
  remarks: string | null
  enteredBy: string | null
  enteredAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  lockedBy: string | null
}

export interface ExamDTO {
  id: string
  schoolId: string
  name: string
  type: string
  session: string | null
  term: string | null
  status: string
  resultStatus: string
  passPercentage: number
  startDate: string | null
  endDate: string | null
  declaredAt: string | null
  declaredBy: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  classes: ExamClassDTO[]
  subjects: ExamSubjectConfigDTO[]
  schedule: ScheduleItemDTO[]
  markSummary: {
    total: number
    entered: number
    locked: number
    submitted: number
    verified: number
    pct: number
  }
  /**
   * FEE-EXAM: per-examination fee (in INR) auto-resolved from the Fee
   * Structure's `examFeeSchedule` at creation time. Optional — pre-existing
   * exams without this field simply have no recorded exam fee. Historical
   * exams retain whatever `examFee` they were created with — they are NOT
   * retroactively updated when the Fee Structure is republished.
   */
  examFee?: number
  /**
   * FEE-EXAM: reference to the Fee Structure version that was CURRENT when
   * the exam was created (e.g. "FSV-FS04-1"). Lets the audit trail pin
   * the fee schedule that produced `examFee`. Optional for backward
   * compatibility — pre-existing exams have no version reference.
   */
  feeStructureVersionRef?: string
}

export interface CreateExamInput {
  name: string
  type: string
  session?: string
  startDate?: string
  endDate?: string
  passPercentage?: number
  classIds: string[]
  subjectsByClass: Record<
    string,
    Array<{
      subjectId: string
      maxMarks?: number
      passMarks?: number
      theoryMarks?: number
      practicalMarks?: number
    }>
  >
  schedule?: Array<{
    classId: string
    subjectId: string
    date: string
    startTime: string
    endTime: string
    room?: string
    invigilatorName?: string
  }>
  classMeta?: Record<string, {
    className: string
    gradeLevel: string | null
    stream: string | null
    studentCount: number
  }>
  subjectMeta?: Record<string, { subjectName: string; subjectCode: string | null }>
  /**
   * FEE-EXAM: per-examination fee (in INR) auto-resolved from the Fee
   * Structure's `examFeeSchedule`. The Create Exam form looks up the
   * matching Fee Structure for the selected class level + exam type and
   * passes the resolved amount here. Optional — pre-existing callers
   * that omit it create an exam with no recorded fee.
   */
  examFee?: number
  /**
   * FEE-EXAM: reference to the Fee Structure version that was CURRENT when
   * the exam was created. Pairs with `examFee` so the audit trail can
   * pin which version of the fee schedule produced the recorded amount.
   */
  feeStructureVersionRef?: string
  /**
   * APPS-FORMS (PART 5): when true, creating the exam AUTO-GENERATES a
   * connected Application/Form (source 'Examination') in Operations →
   * Applications & Forms, permanently linked back to this exam.
   */
  requiresApplicationForm?: boolean
  /** In-charge teacher for the generated application form. */
  inChargeTeacherId?: string
  inChargeTeacherName?: string
}

export interface SetMarkInput {
  classId: string
  subjectId: string
  studentId: string
  marksObtained: number | null
  status: MarkStatus
  remarks?: string
}

export interface AuditLogDTO {
  id: string
  examId: string
  userId: string | null
  userName: string | null
  action: string
  entity: string | null
  entityId: string | null
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

// ─── Result engine types ────────────────────────────────────────────

export interface SubjectResult {
  subjectId: string
  subjectName: string
  maxMarks: number
  passMarks: number
  marksObtained: number | null
  status: MarkStatus
  isAbsent: boolean
  passed: boolean
  percentage: number
}

export interface StudentResult {
  studentId: string
  studentName: string
  rollNo: string | null
  className: string
  classId: string
  subjects: SubjectResult[]
  totalObtained: number
  totalMax: number
  percentage: number
  grade: string
  gradeColor: string
  passed: boolean
  subjectsPassed: number
  subjectsCount: number
  isAbsentInAll: boolean
  rank: number | null
}

export interface ExamAnalyticsDTO {
  totalStudents: number
  passed: number
  failed: number
  passRate: number
  averagePercentage: number
  highestPercentage: number
  lowestPercentage: number
  gradeDistribution: Record<string, number>
  subjectPerformance: Array<{
    subjectId: string
    subjectName: string
    averagePercentage: number
    averageMarks: number
    entered: number
    total: number
  }>
  toppers: Array<{
    rank: number
    studentId: string
    name: string
    rollNo: string | null
    className: string
    percentage: number
    total: number
    maxTotal: number
    grade: string
  }>
}

// ─── Extended feature DTOs ───────────────────────────────────────────

export interface SeatAssignmentDTO {
  id: string
  examId: string
  classId: string
  className: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  room: string
  seatNumber: number
  row: number | null
  column: number | null
}

export interface ExamAttendanceDTO {
  id: string
  examId: string
  scheduleItemId: string | null
  classId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  subjectId: string
  subjectName: string | null
  date: string
  status: MarkStatus
  remarks: string | null
  markedBy: string | null
}

export interface ResultOutcomeDTO {
  id: string
  examId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  classId: string
  className: string
  outcome: Outcome
  reason: string | null
  overrideBy: string | null
  notes: string | null
  percentage: number
  grade: string
  passed: boolean
  subjectsFailed: number
  createdAt: string
  updatedAt: string
}

export interface CsvImportRow {
  rollNo: string
  studentName: string
  marksObtained: number | null
  status: MarkStatus
  remarks?: string
}

export interface CsvImportResult {
  accepted: number
  rejected: number
  errors: Array<{ row: number; message: string }>
  applied: Array<{ studentId: string; studentName: string; marks: number | null; status: MarkStatus }>
}

export interface AdmitCardStudent {
  id: string
  name: string
  rollNo: string | null
  admissionNo: string | null
  className: string
  section: string | null
  stream: string | null
  photo: string | null
  room: string | null
  seatNumber: number | null
  schedule: Array<{
    id?: string
    subjectId: string
    subjectName: string
    date: string
    startTime: string
    endTime: string
    room: string | null
    seatNumber?: number | null
    invigilatorName?: string | null
  }>
}

// ─── Settings DTOs ──────────────────────────────────────────────────

export interface ExamTypeConfigDTO {
  id: string
  schoolId: string
  name: string
  code: string | null
  enabled: boolean
  sortOrder: number
}

export interface GradeScaleDTO {
  id: string
  schoolId: string
  grade: string
  minPct: number
  maxPct: number
  color: string | null
  sortOrder: number
}

export interface ExamRuleDTO {
  key: string
  value: string
}

export interface AdmitCardConfigDTO {
  showPhoto: boolean
  showRollNumber: boolean
  showRoom: boolean
  showSeatNumber: boolean
  showTimetable: boolean
  showInstructions: boolean
  showQrCode: boolean
}

export interface ReportCardConfigDTO {
  showAttendance: boolean
  showRank: boolean
  showPercentage: boolean
  showGrade: boolean
  showCoScholastic: boolean
  showRemarks: boolean
  showClassTeacherSign: boolean
  showPrincipalSign: boolean
}

export interface SchoolContextDTO {
  schoolId: string
  schoolName: string
  schoolCode: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
  academicYear: string | null
  board: Board
}
