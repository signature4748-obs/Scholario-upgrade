/**
 * Shared examination analytics utilities.
 *
 * Computes result analytics (distribution, performance, toppers) from
 * canonical marks data. Used by both the Grade tab and Reports tab to
 * avoid duplicating calculation logic.
 */

import type { ExamDTO, ExamMarkDTO, StudentResult, SubjectResult } from './types'
import { getGradeForPercentage, DEFAULT_GRADE_BOUNDARIES } from './types'

export interface GradeScaleRow {
  grade: string
  minPct: number
  color: string
}

/** Compute per-student results from marks data. */
export function computeStudentResults(
  exam: ExamDTO,
  marks: ExamMarkDTO[],
  classId?: string,
  subjectId?: string,
): StudentResult[] {
  const studentIds = new Set(marks.map((m) => m.studentId))
  const results: StudentResult[] = []

  for (const studentId of studentIds) {
    const studentMarks = marks.filter((m) => m.studentId === studentId)
    if (classId && studentMarks[0]?.classId !== classId) continue

    const studentClassId = studentMarks[0]?.classId
    const className = exam.classes.find((c: any) => c.classId === studentClassId)?.className ?? ''
    const subjects = exam.subjects.filter((s: any) => s.classId === studentClassId)

    let totalObtained = 0
    let totalMax = 0
    let subjectsFailed = 0
    let subjectsCount = 0
    let isAbsentInAll = true

    const subjResults: SubjectResult[] = subjects.map((subj: any) => {
      if (subjectId && subj.subjectId !== subjectId) return null as any
      const mark = studentMarks.find((m) => m.subjectId === subj.subjectId)
      if (!mark) return null as any
      subjectsCount++
      const obtained = mark.marksObtained
      const isAbsent = mark.status === 'ABSENT'
      if (!isAbsent) isAbsentInAll = false
      if (obtained !== null && !isAbsent) {
        totalObtained += obtained
        totalMax += subj.maxMarks
      } else {
        totalMax += subj.maxMarks
      }
      const pct = obtained !== null && subj.maxMarks > 0 ? Math.round((obtained / subj.maxMarks) * 100 * 100) / 100 : 0
      const passed = obtained !== null && pct >= 33
      if (!passed) subjectsFailed++
      const { grade: _grade } = getGradeForPercentage(pct, [])
      return {
        subjectId: subj.subjectId,
        subjectName: subj.subjectName,
        maxMarks: subj.maxMarks,
        passMarks: subj.passMarks,
        marksObtained: obtained,
        status: mark.status,
        isAbsent,
        passed,
        percentage: pct,
      }
    }).filter(Boolean)

    if (subjectsCount === 0) continue

    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100 * 100) / 100 : 0
    const { grade, color: gradeColor } = getGradeForPercentage(percentage, [])

    results.push({
      studentId,
      studentName: studentMarks[0]?.studentName ?? 'Unknown',
      rollNo: studentMarks[0]?.studentRollNo ?? null,
      className,
      classId: studentClassId ?? '',
      subjects: subjResults,
      totalObtained,
      totalMax,
      percentage,
      grade,
      gradeColor,
      passed: subjectsFailed === 0,
      subjectsPassed: subjResults.length - subjectsFailed,
      subjectsCount: subjResults.length,
      isAbsentInAll,
      rank: 0,
    })
  }

  // Sort by percentage descending, assign rank.
  return results.sort((a, b) => b.percentage - a.percentage).map((r, i) => ({ ...r, rank: i + 1 }))
}

export interface ExamAnalytics {
  totalStudents: number
  appeared: number
  absent: number
  passed: number
  failed: number
  passRate: number
  averagePercentage: number
  highestPercentage: number
  lowestPercentage: number
  gradeDistribution: Record<string, number>
  toppers: Array<{ rank: number; studentId: string; name: string; rollNo: string | null; className: string; percentage: number; total: number; maxTotal: number; grade: string }>
}

/** Compute exam-level analytics from student results. */
export function computeExamAnalytics(results: StudentResult[], gradeScale: GradeScaleRow[] = [...DEFAULT_GRADE_BOUNDARIES]): ExamAnalytics {
  const appeared = results.filter((r) => !r.isAbsentInAll)
  const passed = appeared.filter((r) => r.passed)
  const failed = appeared.filter((r) => !r.passed)
  const absent = results.filter((r) => r.isAbsentInAll)
  const pcts = appeared.map((r) => r.percentage)

  const distribution: Record<string, number> = {}
  for (const g of gradeScale) distribution[g.grade] = 0
  for (const r of appeared) {
    const { grade } = getGradeForPercentage(r.percentage, gradeScale as any)
    distribution[grade] = (distribution[grade] ?? 0) + 1
  }

  return {
    totalStudents: results.length,
    appeared: appeared.length,
    absent: absent.length,
    passed: passed.length,
    failed: failed.length,
    passRate: appeared.length > 0 ? Math.round((passed.length / appeared.length) * 100) : 0,
    averagePercentage: pcts.length > 0 ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0,
    highestPercentage: pcts.length > 0 ? Math.max(...pcts) : 0,
    lowestPercentage: pcts.length > 0 ? Math.min(...pcts) : 0,
    gradeDistribution: distribution,
    toppers: appeared.slice(0, 5).map((r, i) => ({
      rank: i + 1,
      studentId: r.studentId,
      name: r.studentName,
      rollNo: r.rollNo,
      className: r.className,
      percentage: r.percentage,
      total: r.totalObtained,
      maxTotal: r.totalMax,
      grade: r.grade,
    })),
  }
}

export interface SubjectPerformanceRow {
  classId: string
  className: string
  subjectId: string
  subjectName: string
  entered: number
  total: number
  avg: number
  highest: number
  lowest: number
  passCount: number
  failCount: number
  absentCount: number
  passRate: number
  gradeDistribution: Record<string, number>
}

/** Compute per-subject performance from marks. */
export function computeSubjectPerformance(
  exam: ExamDTO,
  marks: ExamMarkDTO[],
  gradeScale: GradeScaleRow[] = [...DEFAULT_GRADE_BOUNDARIES],
): SubjectPerformanceRow[] {
  const rows: SubjectPerformanceRow[] = []
  for (const c of exam.classes) {
    for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
      const subjectMarks = marks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
      const entered = subjectMarks.filter((m) => m.marksObtained !== null && m.status !== 'ABSENT')
      const values = entered.map((m) => m.marksObtained!)
      const absentCount = subjectMarks.filter((m) => m.status === 'ABSENT').length
      const passCount = values.filter((v) => v >= subj.passMarks).length
      const failCount = values.filter((v) => v < subj.passMarks).length
      const dist: Record<string, number> = {}
      for (const g of gradeScale) dist[g.grade] = 0
      for (const v of values) {
        const pct = subj.maxMarks > 0 ? (v / subj.maxMarks) * 100 : 0
        const { grade } = getGradeForPercentage(pct, gradeScale as any)
        dist[grade] = (dist[grade] ?? 0) + 1
      }
      rows.push({
        classId: c.classId,
        className: c.className,
        subjectId: subj.subjectId,
        subjectName: subj.subjectName,
        entered: entered.length,
        total: subjectMarks.length,
        avg: values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0,
        highest: values.length > 0 ? Math.max(...values) : 0,
        lowest: values.length > 0 ? Math.min(...values) : 0,
        passCount,
        failCount,
        absentCount,
        passRate: entered.length > 0 ? Math.round((passCount / entered.length) * 100) : 0,
        gradeDistribution: dist,
      })
    }
  }
  return rows
}

export interface ClassPerformanceRow {
  classId: string
  className: string
  totalStudents: number
  appeared: number
  absent: number
  passed: number
  failed: number
  passRate: number
  avgPct: number
  highestPct: number
  lowestPct: number
  gradeDistribution: Record<string, number>
}

/** Compute per-class performance from student results. */
export function computeClassPerformance(
  results: StudentResult[],
  exam: ExamDTO,
  gradeScale: GradeScaleRow[] = [...DEFAULT_GRADE_BOUNDARIES],
): ClassPerformanceRow[] {
  return exam.classes.map((c: any) => {
    const classResults = results.filter((r) => r.classId === c.classId)
    const appeared = classResults.filter((r) => !r.isAbsentInAll)
    const passed = appeared.filter((r) => r.passed)
    const failed = appeared.filter((r) => !r.passed)
    const pcts = appeared.map((r) => r.percentage)
    const dist: Record<string, number> = {}
    for (const g of gradeScale) dist[g.grade] = 0
    for (const r of appeared) {
      const { grade } = getGradeForPercentage(r.percentage, gradeScale as any)
      dist[grade] = (dist[grade] ?? 0) + 1
    }
    return {
      classId: c.classId,
      className: c.className,
      totalStudents: classResults.length,
      appeared: appeared.length,
      absent: classResults.filter((r) => r.isAbsentInAll).length,
      passed: passed.length,
      failed: failed.length,
      passRate: appeared.length > 0 ? Math.round((passed.length / appeared.length) * 100) : 0,
      avgPct: pcts.length > 0 ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0,
      highestPct: pcts.length > 0 ? Math.max(...pcts) : 0,
      lowestPct: pcts.length > 0 ? Math.min(...pcts) : 0,
      gradeDistribution: dist,
    }
  })
}
