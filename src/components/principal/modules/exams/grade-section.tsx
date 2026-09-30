'use client'

/**
 * Grade section for the ExamWorkspace.
 *
 * Combines the grading policy view, an interactive donut chart for
 * grade distribution, a per-subject comparison heat-map, and the
 * student performance table with topper highlights. Drill-down modals:
 *  - StudentDrillDownModal (subject-wise breakdown for one student)
 *  - SubjectDrillDownModal (student-wise marks for one subject)
 */

import { useState, useMemo } from 'react'
import { BookOpen, ChevronRight, Download, FileText, Filter, RotateCcw, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useExamMarksAll } from './marks-hooks'
import { DEFAULT_GRADE_BOUNDARIES, getGradeForPercentage, type ExamDTO } from '@/lib/exams/types'
import { generateClassResultPDF, generateGradeAnalysisPDF, generateStudentResultPDF } from '@/lib/exams/result-pdf'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { CollapsibleSection } from './collapsible-section'
import { Stat } from './workspace-shared'

// ─── Grade Donut Chart (pure SVG) ─────────────────────────────────────

function GradeDonut({ distribution, gradeScale, totalStudents, selectedGrade, onSelectGrade }: {
  distribution: Record<string, number>
  gradeScale: readonly { grade: string; minPct: number; color: string }[]
  totalStudents: number
  selectedGrade: string | null
  onSelectGrade: (grade: string | null) => void
}) {
  const colorHex: Record<string, string> = {
    A1: '#10b981', A2: '#34d399', B1: '#0ea5e9', B2: '#f59e0b',
    C1: '#f97316', C2: '#f43f5e', E: '#e11d48',
  }
  const size = 180
  const stroke = 28
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2

  // Build segments without mutation — use reduce to accumulate offsets.
  const { segments } = gradeScale.reduce<{ segments: Array<{ grade: string; count: number; fraction: number; dash: number; offset: number; color: string }>; cumulative: number }>(
    (acc, g) => {
      const count = distribution[g.grade] ?? 0
      const fraction = totalStudents > 0 ? count / totalStudents : 0
      const dash = fraction * circumference
      acc.segments.push({
        grade: g.grade,
        count,
        fraction,
        dash,
        offset: -acc.cumulative * circumference,
        color: colorHex[g.grade] ?? '#94a3b8',
      })
      acc.cumulative += fraction
      return acc
    },
    { segments: [], cumulative: 0 },
  )

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {/* Background ring */}
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} opacity={0.3} />
        {/* Segments — clickable */}
        {segments.map((s) => s.count > 0 && (
          <circle
            key={s.grade}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={selectedGrade === s.grade ? stroke + 6 : stroke}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
            className="transition-all duration-300 cursor-pointer hover:opacity-80"
            opacity={selectedGrade === null || selectedGrade === s.grade ? 1 : 0.3}
            onClick={() => onSelectGrade(selectedGrade === s.grade ? null : s.grade)}
          >
            <title>{s.grade}: {s.count} students ({Math.round(s.fraction * 100)}%) — click to filter</title>
          </circle>
        ))}
        {/* Center text */}
        <text x={cx} y={cy - 8} textAnchor="middle" className="fill-foreground font-bold pointer-events-none" style={{ fontSize: 28, fontWeight: 700 }}>
          {selectedGrade ? (distribution[selectedGrade] ?? 0) : totalStudents}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground pointer-events-none" style={{ fontSize: 10, fontWeight: 600 }}>
          {selectedGrade ? `Grade ${selectedGrade}` : 'Students'}
        </text>
      </svg>
      {/* Legend — clickable */}
      <div className="space-y-1">
        {segments.filter((s) => s.count > 0).map((s) => (
          <button
            key={s.grade}
            onClick={() => onSelectGrade(selectedGrade === s.grade ? null : s.grade)}
            className={cn(
              'flex items-center gap-2 text-[10px] rounded-md px-1.5 py-0.5 transition-colors w-full text-left',
              selectedGrade === s.grade ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40',
            )}
          >
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="font-semibold w-6">{s.grade}</span>
            <span className="text-muted-foreground tabular-nums">{s.count}</span>
            <span className="text-muted-foreground/60 tabular-nums">({Math.round(s.fraction * 100)}%)</span>
          </button>
        ))}
        {segments.every((s) => s.count === 0) && (
          <p className="text-[10px] text-muted-foreground">No data</p>
        )}
        {selectedGrade && (
          <button
            onClick={() => onSelectGrade(null)}
            className="flex items-center gap-1 text-[9px] text-primary hover:underline mt-1"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Clear filter
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Student Drill-Down Modal — subject-wise marks breakdown ─────────

function StudentDrillDownModal({ exam, studentId, allMarks, onClose }: {
  exam: ExamDTO
  studentId: string
  allMarks: any[]
  onClose: () => void
}) {
  useDismissOnEscape(onClose)
  const studentMarks = useMemo(
    () => allMarks.filter((m) => m.studentId === studentId),
    [allMarks, studentId],
  )
  const firstMark = studentMarks[0]
  const studentName = firstMark?.studentName ?? 'Unknown'
  const studentRollNo = firstMark?.studentRollNo ?? null
  const classId = firstMark?.classId ?? null
  const className = exam.classes.find((c: any) => c.classId === classId)?.className ?? ''

  const subjects = exam.subjects.filter((s: any) => s.classId === classId)
  const subjectResults = useMemo(() => {
    const initial = { results: [] as Array<any>, totalObtained: 0, totalMax: 0, subjectsFailed: 0 }
    const acc = subjects.reduce((acc, subj: any) => {
      const mark = studentMarks.find((m) => m.subjectId === subj.subjectId)
      const obtained = mark?.marksObtained ?? null
      const isAbsent = mark?.status === 'ABSENT'
      const pct = obtained !== null && subj.maxMarks > 0 ? Math.round((obtained / subj.maxMarks) * 100 * 100) / 100 : 0
      const passed = obtained !== null && pct >= 33
      const { grade } = getGradeForPercentage(pct, [])
      const newObtained = (obtained !== null && !isAbsent) ? acc.totalObtained + obtained : acc.totalObtained
      const newMax = acc.totalMax + subj.maxMarks
      const newFailed = !passed ? acc.subjectsFailed + 1 : acc.subjectsFailed
      acc.results.push({
        subjectId: subj.subjectId,
        subjectName: subj.subjectName,
        maxMarks: subj.maxMarks,
        obtained,
        isAbsent,
        percentage: pct,
        grade,
        passed,
        graceMarks: mark?.graceMarks ?? 0,
        originalMarks: mark?.originalMarks ?? null,
        workflowStatus: mark?.workflowStatus ?? 'DRAFT',
      })
      return { results: acc.results, totalObtained: newObtained, totalMax: newMax, subjectsFailed: newFailed }
    }, initial)
    const overallPct = acc.totalMax > 0 ? Math.round((acc.totalObtained / acc.totalMax) * 100 * 100) / 100 : 0
    const { grade: overallGrade } = getGradeForPercentage(overallPct, [])
    return { ...acc, overallPct, overallGrade }
  }, [subjects, studentMarks])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${studentName} — subject-wise marks`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
              {studentName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{studentName}</h3>
              <p className="text-[10px] text-muted-foreground">
                Roll {studentRollNo ?? '—'} · {className} · Rank #{studentPerformance_rank(exam, allMarks, studentId)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{subjectResults.overallPct}%</p>
              <p className="text-[9px] text-muted-foreground">Grade {subjectResults.overallGrade}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close student breakdown"
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/60 bg-muted/20 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/60 text-muted-foreground">
            <FileText className="h-2.5 w-2.5" /> {subjectResults.results.length} subjects
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary/10 text-primary">
            Total: {subjectResults.totalObtained}/{subjectResults.totalMax}
          </span>
          {subjectResults.subjectsFailed > 0 ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300">
              {subjectResults.subjectsFailed} failed
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              All passed
            </span>
          )}
        </div>

        {/* Subject-wise table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
                <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Max</th>
                <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Obtained</th>
                <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">%</th>
                <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Grade</th>
                <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {subjectResults.results.map((r, i) => (
                <tr key={i} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{r.subjectName}</span>
                      {r.graceMarks > 0 && (
                        <span className="inline-flex items-center px-1 py-0 rounded text-[7px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          +{r.graceMarks} grace
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.maxMarks}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {r.isAbsent ? (
                      <span className="text-rose-600 font-semibold">ABSENT</span>
                    ) : r.obtained !== null ? (
                      r.obtained
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.isAbsent || r.obtained === null ? '—' : `${r.percentage}%`}
                  </td>
                  <td className="px-3 py-2 text-center font-bold">{r.isAbsent || r.obtained === null ? '—' : r.grade}</td>
                  <td className="px-3 py-2 text-center">
                    {r.isAbsent || r.obtained === null ? (
                      <span className="text-[9px] text-muted-foreground">—</span>
                    ) : r.passed ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">PASS</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">FAIL</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-bold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{subjectResults.totalMax}</td>
                <td className="px-3 py-2 text-right tabular-nums">{subjectResults.totalObtained}</td>
                <td className="px-3 py-2 text-right tabular-nums">{subjectResults.overallPct}%</td>
                <td className="px-3 py-2 text-center">{subjectResults.overallGrade}</td>
                <td className="px-3 py-2 text-center">
                  {subjectResults.subjectsFailed === 0 ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">PASS</span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">FAIL</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer with download */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[9px] text-muted-foreground">Click a student row in the table to see subject-wise breakdown</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1"
            onClick={() => {
              const result = {
                studentId,
                name: studentName,
                rollNo: studentRollNo,
                className,
                subjects: subjectResults.results,
                totalObtained: subjectResults.totalObtained,
                totalMax: subjectResults.totalMax,
                percentage: subjectResults.overallPct,
                grade: subjectResults.overallGrade,
                passed: subjectResults.subjectsFailed === 0,
                rank: studentPerformance_rank(exam, allMarks, studentId),
              }
              try {
                generateStudentResultPDF(exam, result as any)
                toast.success('Student result PDF downloaded')
              } catch (e: any) {
                toast.error('Export failed', { description: e.message })
              }
            }}
          >
            <Download className="h-3 w-3" /> Download PDF
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Compute a student's rank from the marks data. */
function studentPerformance_rank(exam: ExamDTO, allMarks: any[], studentId: string): number {
  const studentIds = new Set(allMarks.map((m) => m.studentId))
  const pcts: Array<{ id: string; pct: number }> = []
  for (const sid of studentIds) {
    const marks = allMarks.filter((m) => m.studentId === sid)
    let totalObtained = 0
    let totalMax = 0
    for (const subj of exam.subjects.filter((s: any) => s.classId === marks[0]?.classId)) {
      const mark = marks.find((m) => m.subjectId === subj.subjectId)
      if (!mark) continue
      if (mark.status === 'ABSENT' || mark.marksObtained === null) {
        totalMax += subj.maxMarks
        continue
      }
      totalObtained += mark.marksObtained
      totalMax += subj.maxMarks
    }
    const pct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
    pcts.push({ id: sid, pct })
  }
  pcts.sort((a, b) => b.pct - a.pct)
  const idx = pcts.findIndex((p) => p.id === studentId)
  return idx + 1
}

// ─── Subject Drill-Down Modal — student-wise marks for one subject ─────

function SubjectDrillDownModal({ exam, classId, subjectId, subjectName, className, allMarks, onClose }: {
  exam: ExamDTO
  classId: string
  subjectId: string
  subjectName: string
  className: string
  allMarks: any[]
  onClose: () => void
}) {
  useDismissOnEscape(onClose)
  const subjectConfig = exam.subjects.find((s: any) => s.classId === classId && s.subjectId === subjectId)
  const maxMarks = subjectConfig?.maxMarks ?? 100
  const passMarks = subjectConfig?.passMarks ?? 33

  const studentMarks = useMemo(() => {
    return allMarks
      .filter((m) => m.classId === classId && m.subjectId === subjectId)
      .sort((a, b) => (b.marksObtained ?? -1) - (a.marksObtained ?? -1))
  }, [allMarks, classId, subjectId])

  const stats = useMemo(() => {
    const entered = studentMarks.filter((m) => m.marksObtained !== null && m.status !== 'ABSENT')
    const values = entered.map((m) => m.marksObtained!)
    const total = studentMarks.length
    const present = entered.length
    const absent = studentMarks.filter((m) => m.status === 'ABSENT').length
    const avg = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0
    const highest = values.length > 0 ? Math.max(...values) : 0
    const lowest = values.length > 0 ? Math.min(...values) : 0
    const passed = values.filter((v) => v >= passMarks).length
    const failed = values.filter((v) => v < passMarks).length
    const passRate = present > 0 ? Math.round((passed / present) * 100) : 0
    return { total, present, absent, avg, highest, lowest, passed, failed, passRate }
  }, [studentMarks, passMarks])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${subjectName} — student-wise marks`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-gradient-to-r from-sky-500/5 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{subjectName}</h3>
              <p className="text-[10px] text-muted-foreground">
                {className} · Max {maxMarks} · Pass {passMarks}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{stats.avg}</p>
              <p className="text-[9px] text-muted-foreground">Average</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close subject breakdown"
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/60 bg-muted/20 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/60 text-muted-foreground">
            <Users className="h-2.5 w-2.5" /> {stats.total} students
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            {stats.present} present
          </span>
          {stats.absent > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300">
              {stats.absent} absent
            </span>
          )}
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-sky-500/10 text-sky-700 dark:text-sky-300">
            Highest: {stats.highest}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300">
            Lowest: {stats.lowest}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary/10 text-primary ml-auto">
            Pass: {stats.passRate}%
          </span>
        </div>

        {/* Student-wise marks table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Rank</th>
                <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Roll</th>
                <th className="text-left px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Marks</th>
                <th className="text-right px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">%</th>
                <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Grade</th>
                <th className="text-center px-3 py-2 text-[9px] uppercase font-semibold text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {studentMarks.map((m, i) => {
                const obtained = m.marksObtained
                const isAbsent = m.status === 'ABSENT'
                const pct = obtained !== null && maxMarks > 0 ? Math.round((obtained / maxMarks) * 100 * 100) / 100 : 0
                const { grade } = getGradeForPercentage(pct, [])
                const passed = obtained !== null && pct >= 33
                return (
                  <tr key={m.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-center text-[9px] text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{m.studentRollNo ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{m.studentName}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {isAbsent ? (
                        <span className="text-rose-600 font-semibold">ABSENT</span>
                      ) : obtained !== null ? (
                        obtained
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {isAbsent || obtained === null ? '—' : `${pct}%`}
                    </td>
                    <td className="px-3 py-2 text-center font-bold">{isAbsent || obtained === null ? '—' : grade}</td>
                    <td className="px-3 py-2 text-center">
                      {isAbsent || obtained === null ? (
                        <span className="text-[9px] text-muted-foreground">—</span>
                      ) : passed ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">PASS</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">FAIL</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {studentMarks.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No marks entered for this subject.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Grade Section — grading policy + distribution + subject comparison ─

export function GradeSection({ exam }: { exam: ExamDTO }) {
  const [filterClass, setFilterClass] = useState('all')
  const [filterSubject, setFilterSubject] = useState('all')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
  const [selectedSubjectPaper, setSelectedSubjectPaper] = useState<{ classId: string; subjectId: string; subjectName: string; className: string } | null>(null)
  // IQ3000 — REAL marks (canonical ExamMark rows via the class-results
  // surface); the mock store is retired from this tab. Same shape, so
  // every derivation below (donut, drill-downs, rankings) is untouched.
  const { allMarks: realMarks, loading: marksLoading } = useExamMarksAll(exam)
  const allMarks = useMemo(() => realMarks.filter((m) => m.examId === exam.id), [realMarks, exam.id])

  // Use the central grading configuration (DEFAULT_GRADE_BOUNDARIES from types.ts).
  // In production this would come from the school's GradeScale table.
  const gradeScale = DEFAULT_GRADE_BOUNDARIES

  // Compute per-student subject percentages → grades.
  const gradeData = useMemo(() => {
    const distribution: Record<string, number> = {}
    for (const g of gradeScale) distribution[g.grade] = 0
    let totalStudents = 0
    let passedCount = 0
    let failedCount = 0
    let absentCount = 0
    let highestPct = 0
    let lowestPct = 100
    let pctSum = 0
    let pctCount = 0

    // Group marks by student (within filter scope).
    const studentIds = new Set(allMarks.map((m) => m.studentId))
    for (const studentId of studentIds) {
      const studentMarks = allMarks.filter((m) => m.studentId === studentId)
      // Apply class filter.
      if (filterClass !== 'all') {
        const studentClassId = studentMarks[0]?.classId
        if (studentClassId !== filterClass) continue
      }
      let totalObtained = 0
      let totalMax = 0
      let hasAbsentRow = false
      for (const subj of exam.subjects.filter((s: any) => s.classId === studentMarks[0]?.classId)) {
        // Apply subject filter for per-subject distribution.
        if (filterSubject !== 'all' && subj.subjectId !== filterSubject) continue
        const mark = studentMarks.find((m) => m.subjectId === subj.subjectId)
        if (mark?.status === 'ABSENT') {
          hasAbsentRow = true
          continue
        }
        if (mark?.marksObtained === null) {
          // Absent or missing — don't add to totals.
          continue
        }
        totalObtained += mark?.marksObtained ?? 0
        totalMax += subj.maxMarks
      }
      if (totalMax === 0) {
        // FINAL-GATE: a student with NO countable marks and at least one
        // ABSENT row was silently dropped here — the "Absent" stat could
        // never be non-zero. Count genuinely-absent students; students whose
        // marks are simply un-entered (no ABSENT rows) stay dropped, not
        // mislabelled. Either way they stay out of totalStudents so the
        // donut's grade fractions remain honest.
        if (hasAbsentRow) absentCount++
        continue
      }
      totalStudents++
      const pct = Math.round((totalObtained / totalMax) * 100 * 100) / 100
      highestPct = Math.max(highestPct, pct)
      lowestPct = Math.min(lowestPct, pct)
      pctSum += pct
      pctCount++
      const { grade } = getGradeForPercentage(pct, [])
      distribution[grade] = (distribution[grade] ?? 0) + 1
      if (pct >= 33) passedCount++
      else failedCount++
    }
    const avgPct = pctCount > 0 ? Math.round((pctSum / pctCount) * 10) / 10 : 0
    return { distribution, totalStudents, passedCount, failedCount, absentCount, highestPct, lowestPct, avgPct }
  }, [allMarks, exam, gradeScale, filterClass, filterSubject])

  // Subject comparison: per-subject grade distribution.
  const subjectComparison = useMemo(() => {
    const rows: Array<{ subjectName: string; className: string; classId: string; subjectId: string; distribution: Record<string, number>; total: number }> = []
    for (const c of exam.classes) {
      if (filterClass !== 'all' && c.classId !== filterClass) continue
      for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
        if (filterSubject !== 'all' && subj.subjectId !== filterSubject) continue
        const marks = allMarks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
        const dist: Record<string, number> = {}
        for (const g of gradeScale) dist[g.grade] = 0
        let total = 0
        for (const m of marks) {
          if (m.status === 'ABSENT' || m.marksObtained === null) continue
          const pct = subj.maxMarks > 0 ? (m.marksObtained / subj.maxMarks) * 100 : 0
          const { grade } = getGradeForPercentage(pct, [])
          dist[grade] = (dist[grade] ?? 0) + 1
          total++
        }
        rows.push({ subjectName: subj.subjectName, className: c.className, classId: c.classId, subjectId: subj.subjectId, distribution: dist, total })
      }
    }
    return rows
  }, [allMarks, exam, gradeScale, filterClass, filterSubject])

  const maxDist = Math.max(1, ...Object.values(gradeData.distribution))

  // Student-wise performance: compute each student's total %, grade, rank, pass/fail.
  const studentPerformance = useMemo(() => {
    const rows: Array<{ studentId: string; studentName: string; rollNo: string | null; className: string; totalObtained: number; totalMax: number; percentage: number; grade: string; passed: boolean; subjectsFailed: number; rank: number }> = []
    const studentIds = new Set(allMarks.map((m) => m.studentId))
    for (const studentId of studentIds) {
      const studentMarks = allMarks.filter((m) => m.studentId === studentId)
      if (filterClass !== 'all') {
        const studentClassId = studentMarks[0]?.classId
        if (studentClassId !== filterClass) continue
      }
      let totalObtained = 0
      let totalMax = 0
      let subjectsFailed = 0
      let subjectsCount = 0
      for (const subj of exam.subjects.filter((s: any) => s.classId === studentMarks[0]?.classId)) {
        if (filterSubject !== 'all' && subj.subjectId !== filterSubject) continue
        const mark = studentMarks.find((m) => m.subjectId === subj.subjectId)
        if (!mark) continue
        subjectsCount++
        if (mark.status === 'ABSENT' || mark.marksObtained === null) {
          subjectsFailed++
          totalMax += subj.maxMarks
          continue
        }
        totalObtained += mark.marksObtained
        totalMax += subj.maxMarks
        const pct = subj.maxMarks > 0 ? (mark.marksObtained / subj.maxMarks) * 100 : 0
        if (pct < 33) subjectsFailed++
      }
      if (subjectsCount === 0) continue
      const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100 * 100) / 100 : 0
      const { grade } = getGradeForPercentage(percentage, [])
      rows.push({
        studentId,
        studentName: studentMarks[0]?.studentName ?? 'Unknown',
        rollNo: studentMarks[0]?.studentRollNo ?? null,
        className: exam.classes.find((c: any) => c.classId === studentMarks[0]?.classId)?.className ?? '',
        totalObtained, totalMax, percentage, grade,
        passed: subjectsFailed === 0, subjectsFailed,
        rank: 0,
      })
    }
    // Sort by percentage desc → assign rank.
    return rows.sort((a, b) => b.percentage - a.percentage).map((r, i) => ({ ...r, rank: i + 1 }))
  }, [allMarks, exam, filterClass, filterSubject])

  // Filter student performance by selected grade (donut drill-down).
  const filteredStudentPerformance = useMemo(() => {
    if (!selectedGrade) return studentPerformance
    return studentPerformance.filter((s) => s.grade === selectedGrade)
  }, [studentPerformance, selectedGrade])

  return (
    <div className="space-y-4">
      {/* Real-marks loading gate — no fabricated distribution while fetching. */}
      {marksLoading && allMarks.length === 0 && (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          Loading grade analysis…
        </div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Students" value={String(gradeData.totalStudents)} />
        <Stat label="Passed" value={String(gradeData.passedCount)} />
        <Stat label="Failed" value={String(gradeData.failedCount)} />
        <Stat label="Absent" value={String(gradeData.absentCount)} />
        <Stat label="Average %" value={`${gradeData.avgPct}%`} />
        <Stat label="Pass %" value={`${gradeData.totalStudents > 0 ? Math.round((gradeData.passedCount / gradeData.totalStudents) * 100) : 0}%`} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] uppercase font-semibold text-muted-foreground flex items-center gap-1"><Filter className="h-2.5 w-2.5" /> Filters:</span>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1">
          <option value="all">All Classes</option>
          {exam.classes.map((c: any) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
        </select>
        <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1">
          <option value="all">All Subjects</option>
          {exam.subjects.map((s: any, i: number) => <option key={`${s.subjectId}-${i}`} value={s.subjectId}>{s.subjectName}</option>)}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1 ml-auto"
          onClick={() => {
            try {
              generateGradeAnalysisPDF(exam, {
                totalStudents: gradeData.totalStudents,
                passedCount: gradeData.passedCount,
                failedCount: gradeData.failedCount,
                absentCount: gradeData.absentCount,
                avgPct: gradeData.avgPct,
                highestPct: gradeData.highestPct,
                lowestPct: gradeData.lowestPct,
                distribution: gradeData.distribution,
                gradeScale: gradeScale.map((g) => ({ grade: g.grade, minPct: g.minPct })),
                subjectComparison,
              })
              toast.success('Grade analysis PDF downloaded')
            } catch (e: any) {
              toast.error('Export failed', { description: e.message })
            }
          }}
        >
          <Download className="h-3 w-3" /> Export PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1"
          onClick={() => {
            try {
              const className = filterClass === 'all' ? 'All Classes' : (exam.classes.find((c: any) => c.classId === filterClass)?.className ?? 'All Classes')
              generateClassResultPDF(exam, className, studentPerformance.map((s) => ({
                studentId: s.studentId,
                name: s.studentName,
                rollNo: s.rollNo,
                className: s.className,
                subjects: [],
                totalObtained: s.totalObtained,
                totalMax: s.totalMax,
                percentage: s.percentage,
                grade: s.grade,
                passed: s.passed,
                rank: s.rank,
              })) as any)
              toast.success(`Report cards PDF generated for ${studentPerformance.length} students`)
            } catch (e: any) {
              toast.error('Export failed', { description: e.message })
            }
          }}
        >
          <FileText className="h-3 w-3" /> Report Cards
        </Button>
      </div>

      {/* Grade policy view */}
      <CollapsibleSection title="Grade Scale (Active Policy)" subtitle={`${gradeScale.length} grades`} accent="violet" defaultOpen={true}>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 p-2">
          {gradeScale.map((g) => {
            const colorMap: Record<string, string> = {
              A1: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
              A2: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
              B1: 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300',
              B2: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
              C1: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300',
              C2: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300',
              E: 'border-rose-600/40 bg-rose-600/10 text-rose-800 dark:text-rose-400',
            }
            return (
              <div key={g.grade} className={cn('rounded-lg border p-2.5 text-center transition-colors', colorMap[g.grade] ?? 'border-border/60 bg-muted/20')}>
                <p className="text-lg font-bold tabular-nums">{g.grade}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  {g.minPct === 0 ? 'Below 33' : g.minPct === 33 ? '33 – 49' : `${g.minPct}+`}
                </p>
              </div>
            )
          })}
        </div>
      </CollapsibleSection>

      {/* Grade distribution — donut chart + bars side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CollapsibleSection title="Grade Distribution Chart" subtitle={`${gradeData.totalStudents} students`} accent="emerald">
          <div className="p-4 flex items-center justify-center">
            <GradeDonut distribution={gradeData.distribution} gradeScale={gradeScale} totalStudents={gradeData.totalStudents} selectedGrade={selectedGrade} onSelectGrade={setSelectedGrade} />
          </div>
        </CollapsibleSection>
        <CollapsibleSection title="Grade Distribution" subtitle="counts" accent="emerald">
          <div className="p-3 space-y-2">
            {gradeScale.map((g) => {
              const count = gradeData.distribution[g.grade] ?? 0
              const pct = gradeData.totalStudents > 0 ? Math.round((count / gradeData.totalStudents) * 1000) / 10 : 0
              const barWidth = Math.round((count / maxDist) * 100)
              const barColorMap: Record<string, string> = {
                A1: 'from-emerald-500 to-emerald-400',
                A2: 'from-emerald-500 to-emerald-400',
                B1: 'from-sky-500 to-sky-400',
                B2: 'from-amber-500 to-amber-400',
                C1: 'from-orange-500 to-orange-400',
                C2: 'from-rose-500 to-rose-400',
                E: 'from-rose-600 to-rose-500',
              }
              const isEmpty = count === 0
              return (
                <div key={g.grade} className="flex items-center gap-3">
                  <span className="w-7 text-[11px] font-bold tabular-nums text-center">{g.grade}</span>
                  <div className="flex-1 h-5 rounded-md bg-muted/30 overflow-hidden relative">
                    <div
                      className={cn('h-full rounded-md transition-all duration-500 bg-gradient-to-r', barColorMap[g.grade] ?? 'from-primary to-primary/80')}
                      style={{ width: `${barWidth}%`, minWidth: barWidth > 0 ? '4px' : '0' }}
                    />
                    {isEmpty && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/50">—</span>
                    )}
                  </div>
                  <span className={cn('w-7 text-[11px] tabular-nums text-right font-medium', isEmpty && 'text-muted-foreground/50')}>{isEmpty ? '—' : count}</span>
                  <span className={cn('w-12 text-[10px] tabular-nums text-right', isEmpty ? 'text-muted-foreground/50' : 'text-muted-foreground')}>{pct}%</span>
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      </div>

      {/* Subject comparison */}
      <CollapsibleSection title="Subject Comparison" subtitle={`${subjectComparison.length} papers`} accent="sky" defaultOpen={false}>
        <div className="overflow-x-auto max-h-[18rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
                <th className="text-left px-2 py-1 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
                <th className="text-center px-2 py-1 text-[9px] uppercase font-semibold text-muted-foreground">Total</th>
                {gradeScale.map((g) => (
                  <th key={g.grade} className="text-center px-1 py-1 text-[8px] font-semibold text-muted-foreground">{g.grade}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjectComparison.map((r, i) => {
                const maxCount = Math.max(1, ...gradeScale.map((g) => r.distribution[g.grade] ?? 0))
                return (
                <tr
                  key={i}
                  onClick={() => setSelectedSubjectPaper({ classId: r.classId ?? '', subjectId: r.subjectId ?? '', subjectName: r.subjectName, className: r.className })}
                  className="border-t border-border/30 hover:bg-primary/5 even:bg-muted/10 transition-colors cursor-pointer"
                >
                  <td className="px-2 py-1 text-muted-foreground">{r.className}</td>
                  <td className="px-2 py-1 font-medium flex items-center gap-1">
                    {r.subjectName}
                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums">{r.total}</td>
                  {gradeScale.map((g) => {
                    const count = r.distribution[g.grade] ?? 0
                    const intensity = count / maxCount
                    return (
                      <td key={g.grade} className="px-1 py-1 text-center tabular-nums text-[9px] relative">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center w-6 h-5 rounded text-[9px] font-medium',
                            count === 0 ? 'text-muted-foreground/40' : 'text-foreground',
                          )}
                          style={count > 0 ? {
                            backgroundColor: `hsl(var(--primary) / ${0.08 + intensity * 0.25})`,
                          } : undefined}
                        >
                          {count === 0 ? '—' : count}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
              {subjectComparison.length === 0 && (
                <tr><td colSpan={2 + gradeScale.length} className="py-4 text-center text-muted-foreground">No data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Student Performance / Toppers */}
      <CollapsibleSection
        title="Student Performance"
        subtitle={selectedGrade ? `${filteredStudentPerformance.length} of ${studentPerformance.length} · Grade ${selectedGrade}` : `${studentPerformance.length} students · ranked`}
        accent="amber"
        defaultOpen={false}
        actions={selectedGrade ? (
          <button
            onClick={() => setSelectedGrade(null)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Clear grade filter
          </button>
        ) : undefined}
      >
        <div className="overflow-x-auto max-h-[20rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Rank</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
                <th className="text-right px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Total</th>
                <th className="text-right px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">%</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Grade</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Failed</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudentPerformance.map((s) => (
                <tr
                  key={s.studentId}
                  onClick={() => setSelectedStudentId(s.studentId)}
                  className="border-t border-border/30 hover:bg-primary/5 even:bg-muted/10 transition-colors cursor-pointer"
                >
                  <td className="px-2 py-1.5 text-center">
                    {s.rank <= 3 ? (
                      <span className={cn(
                        'inline-flex items-center justify-center h-5 w-5 rounded-full text-[9px] font-bold',
                        s.rank === 1 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' :
                        s.rank === 2 ? 'bg-slate-400/20 text-slate-600 dark:text-slate-300' :
                        'bg-orange-600/20 text-orange-700 dark:text-orange-400',
                      )}>
                        {s.rank}
                      </span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground tabular-nums">{s.rank}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-medium flex items-center gap-1">
                    {s.studentName}
                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{s.className}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.totalObtained}/{s.totalMax}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{s.percentage}%</td>
                  <td className="px-2 py-1.5 text-center font-bold">{s.grade}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{s.subjectsFailed}</td>
                  <td className="px-2 py-1.5 text-center">
                    {s.passed ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">PASS</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">FAIL</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredStudentPerformance.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">{selectedGrade ? `No students with grade ${selectedGrade}.` : 'No student data available.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Student drill-down modal */}
      {selectedStudentId && (
        <StudentDrillDownModal
          exam={exam}
          studentId={selectedStudentId}
          allMarks={allMarks}
          onClose={() => setSelectedStudentId(null)}
        />
      )}

      {/* Subject drill-down modal */}
      {selectedSubjectPaper && (
        <SubjectDrillDownModal
          exam={exam}
          classId={selectedSubjectPaper.classId}
          subjectId={selectedSubjectPaper.subjectId}
          subjectName={selectedSubjectPaper.subjectName}
          className={selectedSubjectPaper.className}
          allMarks={allMarks}
          onClose={() => setSelectedSubjectPaper(null)}
        />
      )}

      {/* Grade analysis highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Highest %" value={`${gradeData.highestPct}%`} />
        <Stat label="Lowest %" value={`${gradeData.lowestPct}%`} />
        <Stat label="Average %" value={`${gradeData.avgPct}%`} />
        <Stat label="Pass %" value={`${gradeData.totalStudents > 0 ? Math.round((gradeData.passedCount / gradeData.totalStudents) * 100) : 0}%`} />
      </div>
    </div>
  )
}
