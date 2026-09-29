// ──────────────────────────────────────────────────────────────────────
// Result engine — pure functions to compute student results, analytics,
// grade sheets, and toppers from stored marks.
// Now GradeScale-aware (uses school-configured scale when provided).
// ──────────────────────────────────────────────────────────────────────

import {
  type ExamMarkDTO,
  type ExamSubjectConfigDTO,
  type StudentDTO,
  type StudentResult,
  type SubjectResult,
  type ExamAnalyticsDTO,
  type GradeScaleRow,
  getGradeForPercentage,
  type MarkStatus,
} from './types'

interface ComputeInput {
  students: StudentDTO[]
  subjects: ExamSubjectConfigDTO[]
  marks: ExamMarkDTO[]
  passPercentage: number
  gradeScale?: GradeScaleRow[]
}

/**
 * Subject pass logic:
 * - Use the stricter of: explicit subject passMarks OR configured school-wide passPercentage.
 * - This honors both per-subject configuration AND the global floor.
 */
function passedSubject(marks: number, maxMarks: number, passMarks: number, passPercentage: number): boolean {
  if (maxMarks <= 0) return true
  const pctThreshold = (passPercentage / 100) * maxMarks
  const threshold = Math.max(passMarks, pctThreshold)
  return marks >= threshold
}

export function computeStudentResult(input: ComputeInput, studentId: string): StudentResult | null {
  const student = input.students.find((s) => s.id === studentId)
  if (!student) return null

  const subjects: SubjectResult[] = []
  let totalObtained = 0
  let totalMax = 0
  let subjectsPassed = 0
  let subjectsCount = 0
  let isAbsentInAll = true

  for (const subject of input.subjects) {
    const mark = input.marks.find((m) => m.studentId === studentId && m.subjectId === subject.subjectId)
    const status: MarkStatus = mark?.status ?? 'PRESENT'
    const isAbsent = status !== 'PRESENT'
    if (!isAbsent) isAbsentInAll = false

    const maxMarks = subject.maxMarks
    const passMarks = subject.passMarks
    const effectiveMarks = isAbsent ? 0 : (mark?.marksObtained ?? 0)
    totalObtained += effectiveMarks
    totalMax += maxMarks
    subjectsCount++

    const passed = isAbsent ? false : passedSubject(effectiveMarks, maxMarks, passMarks, input.passPercentage)
    if (passed) subjectsPassed++
    const pct = maxMarks > 0 ? (effectiveMarks / maxMarks) * 100 : 0

    subjects.push({
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      maxMarks,
      passMarks,
      marksObtained: isAbsent ? null : (mark?.marksObtained ?? null),
      status,
      isAbsent,
      passed,
      percentage: Math.round(pct * 100) / 100,
    })
  }

  const percentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
  const { grade, color } = getGradeForPercentage(percentage, input.gradeScale ?? [])
  const passed = subjectsPassed === subjectsCount && !isAbsentInAll

  return {
    studentId: student.id,
    studentName: student.name,
    rollNo: student.rollNo,
    className: '', // filled by caller
    classId: student.classId ?? '',
    subjects,
    totalObtained,
    totalMax,
    percentage: Math.round(percentage * 100) / 100,
    grade,
    gradeColor: color,
    passed,
    subjectsPassed,
    subjectsCount,
    isAbsentInAll,
    rank: null,
  }
}

export function computeAllResults(input: ComputeInput): StudentResult[] {
  const results = input.students.map((s) => computeStudentResult(input, s.id)).filter(Boolean) as StudentResult[]
  // Sort by percentage desc for ranking; absentees go last
  const sorted = [...results].sort((a, b) => {
    if (a.isAbsentInAll !== b.isAbsentInAll) return a.isAbsentInAll ? 1 : -1
    return b.percentage - a.percentage
  })
  // Assign ranks with tie handling (same percentage → same rank, next rank skipped)
  let lastPct = -1
  let lastRank = 0
  sorted.forEach((r, i) => {
    if (r.isAbsentInAll) {
      r.rank = null
      return
    }
    if (r.percentage === lastPct) {
      r.rank = lastRank
    } else {
      r.rank = i + 1
      lastPct = r.percentage
      lastRank = r.rank
    }
  })
  return sorted
}

export function computeAnalytics(
  input: ComputeInput,
  className: string = '',
): ExamAnalyticsDTO {
  const results = computeAllResults(input)
  for (const r of results) {
    r.className = className
  }

  const eligible = results.filter((r) => !r.isAbsentInAll)
  const totalStudents = results.length
  const passed = eligible.filter((r) => r.passed).length
  const failed = totalStudents - passed
  const passRate = totalStudents > 0 ? Math.round((passed / totalStudents) * 1000) / 10 : 0
  const averagePercentage =
    eligible.length > 0
      ? Math.round((eligible.reduce((s, r) => s + r.percentage, 0) / eligible.length) * 10) / 10
      : 0
  const highestPercentage = eligible.length > 0 ? Math.max(...eligible.map((r) => r.percentage)) : 0
  const lowestPercentage = eligible.length > 0 ? Math.min(...eligible.map((r) => r.percentage)) : 0

  const gradeDistribution: Record<string, number> = {}
  for (const r of eligible) {
    gradeDistribution[r.grade] = (gradeDistribution[r.grade] || 0) + 1
  }

  const subjectPerformance = input.subjects.map((subj) => {
    // Count entered marks (PRESENT students with marksObtained set)
    const entered = input.marks.filter(
      (m) => m.subjectId === subj.subjectId && m.status === 'PRESENT' && m.marksObtained !== null,
    ).length
    const total = input.students.length
    const valid = input.marks.filter(
      (m) => m.subjectId === subj.subjectId && m.status === 'PRESENT' && m.marksObtained !== null,
    )
    const avg = valid.length > 0 ? valid.reduce((s, m) => s + (m.marksObtained ?? 0), 0) / valid.length : 0
    const pct = subj.maxMarks > 0 ? (avg / subj.maxMarks) * 100 : 0
    return {
      subjectId: subj.subjectId,
      subjectName: subj.subjectName,
      averageMarks: Math.round(avg * 100) / 100,
      averagePercentage: Math.round(pct * 10) / 10,
      entered,
      total,
    }
  })

  const toppers = eligible
    .slice(0, 5)
    .map((r, i) => ({
      rank: r.rank ?? i + 1,
      studentId: r.studentId,
      name: r.studentName,
      rollNo: r.rollNo,
      className: r.className,
      percentage: r.percentage,
      total: r.totalObtained,
      maxTotal: r.totalMax,
      grade: r.grade,
    }))

  return {
    totalStudents,
    passed,
    failed,
    passRate,
    averagePercentage,
    highestPercentage: Math.round(highestPercentage * 100) / 100,
    lowestPercentage: Math.round(lowestPercentage * 100) / 100,
    gradeDistribution,
    subjectPerformance,
    toppers,
  }
}
