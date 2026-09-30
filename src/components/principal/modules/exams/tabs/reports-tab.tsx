'use client'

/**
 * ReportsTab — SCHOLARIO Examination Intelligence, Analytics & Official Records Center.
 *
 * Organized into grouped sections:
 *   1. Results & Official Records — report cards, grade sheets, result summary, publication verification
 *   2. Performance Analytics — class performance, subject performance, grade distribution
 *   3. Attendance Reports — room-wise, class-wise, invigilator duty
 *   4. Examination Operations — marks submission & evaluation report
 *   5. Documents — admit cards (professional layout, 1-per-A4 / 2-per-A4, bulk)
 *
 * 7-b (Mock Data Elimination): the mock-marks store is RETIRED — every
 * table below computes from the REAL ExamMark rows loaded via
 * /api/exams/[id]/results/class/[classId] (useExamMarksAll). Exam-day
 * attendance + invigilator analytics have no real data source in this
 * surface yet, so those sections render honest "not tracked" states
 * instead of fabricated sessions/duties.
 */

import { useState, useMemo, useEffect } from 'react'
import {
  FileText, Download, User, GraduationCap, Ticket, TrendingUp, Calendar, ShieldCheck, Award,
  Eye, BookOpen, AlertTriangle, Clock, RotateCw, ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CollapsibleSection } from '../collapsible-section'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getSchoolProfile } from '@/lib/school-profile'
import {
  type ExamDTO, type SchoolContextDTO,
  type StudentResult, type SubjectResult, type ReportCardConfigDTO,
  DEFAULT_GRADE_BOUNDARIES, getGradeForPercentage,
} from '@/lib/exams/types'
import { computeExamAnalytics, type SubjectPerformanceRow, type ClassPerformanceRow } from '@/lib/exams/analytics'
import { api } from '@/lib/exams/api-client'
import {
  generateClassGradeSheetPDF, generateStudentReportCardPDF, } from '@/lib/exams/pdf'
import { useSchoolContext } from '@/lib/exams/use-pdf-context'
import { useAdmitCardConfig, useReportCardConfig } from '@/lib/exams/use-exam-settings'
import { generateClassResultPDF } from '@/lib/exams/result-pdf'
import {
  useExamMarksAll, useTeacherDirectory, buildTeacherNameMap, resolveEnteredBy,
} from '../marks-hooks'

interface Props {
  exams: ExamDTO[]
}

export function ReportsTab({ exams }: Props) {
  const [examIdRaw, setExamId] = useState<string>(exams[0]?.id ?? '')
  const [classId, setClassId] = useState<string>('all')
  const [studentId, setStudentId] = useState<string>('')

  // Late-arriving exams list (async /api/exams): default the selection to
  // the first examination instead of leaving a dead "select an exam" state.
  const examId = examIdRaw || exams[0]?.id || ''

  const exam = exams.find((e) => e.id === examId) ?? null

  // 7-b — REAL data: every ExamMark row of the selected examination
  // (one /api/exams/[id]/results/class/[classId] request per class —
  // see marks-hooks.useExamMarksAll). The mock-marks store is retired.
  const { allMarks, loading: marksLoading, error: marksError, reload: reloadMarks } = useExamMarksAll(exam)
  // 7-b — REAL published results: GET /api/results?examId=<id> (PRINCIPAL
  // scope = this school's Result rows, legacy + declared-flow alike).
  // The analytics tables below derive from THESE rows — never fabricated.
  const [resultsRows, setResultsRows] = useState<ResultRowDTO[]>([])
  const [resultsLoading, setResultsLoading] = useState(false)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const [resultsTick, setResultsTick] = useState(0)
  useEffect(() => {
    if (!examId) { setResultsRows([]); setResultsError(null); return }
    let cancelled = false
    setResultsLoading(true)
    setResultsError(null)
    api<ResultRowDTO[]>(`/api/results?examId=${encodeURIComponent(examId)}`)
      .then((rows) => { if (!cancelled) setResultsRows(Array.isArray(rows) ? rows : []) })
      .catch((e: unknown) => {
        if (!cancelled) setResultsError(e instanceof Error ? e.message : 'Results could not be loaded.')
      })
      .finally(() => { if (!cancelled) setResultsLoading(false) })
    return () => { cancelled = true }
  }, [examId, resultsTick])
  // Real staff directory — resolves ExamMark.enteredBy ids to teacher names.
  const teacherDirectory = useTeacherDirectory()
  const teacherNameMap = useMemo(() => buildTeacherNameMap(teacherDirectory), [teacherDirectory])
  const { data: schoolCtx } = useSchoolContext()
  const { config: _admitCfg } = useAdmitCardConfig()
  const { config: reportCfg } = useReportCardConfig()

  // Filter marks for selected exam.
  const examMarks = useMemo(
    () => allMarks.filter((m) => m.examId === examId),
    [allMarks, examId],
  )

  // 7-b — student results mapped from the REAL published Result rows.
  const studentResults = useMemo(
    () => exam
      ? mapResultRowsToStudentResults(resultsRows, exam, classId === 'all' ? undefined : classId)
      : [],
    [exam, resultsRows, classId],
  )

  // Compute analytics.
  const analytics = useMemo(
    () => computeExamAnalytics(studentResults),
    [studentResults],
  )

  // Subject performance — from the REAL Result rows.
  const subjectPerf = useMemo(
    () => exam ? mapResultRowsToSubjectPerformance(resultsRows, exam) : [],
    [exam, resultsRows],
  )

  // Class performance — from the mapped student results.
  const classPerf = useMemo(
    () => mapStudentResultsToClassPerformance(studentResults, exam ?? ({} as ExamDTO)),
    [studentResults, exam],
  )

  // Students for the selected class (for student selector) — derived from
  // the REAL marks rows (7-b: the students-store roster is no longer read
  // here; only students who actually have marks for this exam appear).
  const classStudents = useMemo(() => {
    if (!exam) return []
    const targetClassId = classId === 'all' ? (exam.classes[0]?.classId ?? '') : classId
    const seen = new Set<string>()
    const rows: { id: string; rollNo: string | null; name: string }[] = []
    for (const r of studentResults) {
      if (r.classId !== targetClassId) continue
      if (seen.has(r.studentId)) continue
      seen.add(r.studentId)
      rows.push({ id: r.studentId, rollNo: r.rollNo, name: r.studentName })
    }
    return rows.sort((a, b) => (a.rollNo ?? '').localeCompare(b.rollNo ?? ''))
  }, [exam, classId, studentResults])

  // Default configs.
  const DEFAULT_REPORT: ReportCardConfigDTO = { showAttendance: true, showRank: true, showPercentage: true, showGrade: true, showCoScholastic: false, showRemarks: true, showClassTeacherSign: true, showPrincipalSign: true }

  if (exams.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No examinations available to generate reports for.</p>
      </div>
    )
  }

  if (!exam) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Select an examination to view reports.</p>
      </div>
    )
  }

  // 7-b — honest loading state while the real marks + results load.
  if (marksLoading || resultsLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 space-y-3" aria-busy="true" aria-label="Loading examination marks">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    )
  }

  // 7-b — honest error state with a retry (no fabricated fallbacks).
  if (marksError || resultsError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <AlertTriangle className="h-7 w-7 text-rose-500/60 mx-auto mb-2" />
        <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Results could not be loaded</p>
        <p className="text-[11px] text-rose-600/70 mt-1 max-w-sm mx-auto">{marksError ?? resultsError}</p>
        <Button size="sm" variant="outline" className="mt-3 h-7 gap-1 text-xs" onClick={() => { reloadMarks(); setResultsTick((t) => t + 1) }}>
          <RotateCw className="h-3 w-3" /> Try again
        </Button>
      </div>
    )
  }

  // Handlers.
  const handleStudentReportCard = () => {
    if (!studentId) { toast.error('Select a student first'); return }
    const result = studentResults.find((r) => r.studentId === studentId)
    if (!result) { toast.error('Student not found in results'); return }
    try {
      const school = schoolCtx ?? fallbackSchool(exam)
      const { filename } = generateStudentReportCardPDF(exam, result, school, reportCfg ?? DEFAULT_REPORT)
      toast.success('Report card downloaded', { description: filename })
    } catch (e: any) { toast.error('Failed to generate report card', { description: e.message }) }
  }

  const handleClassGradeSheet = () => {
    if (studentResults.length === 0) { toast.error('No results to export'); return }
    try {
      const className = classId === 'all' ? 'All Classes' : (exam.classes.find((c: any) => c.classId === classId)?.className ?? 'Class')
      const school = schoolCtx ?? fallbackSchool(exam)
      const { filename } = generateClassGradeSheetPDF(exam, className, studentResults, { ...analytics, subjectPerformance: [] }, school)
      toast.success('Grade sheet exported', { description: filename })
    } catch (e: any) { toast.error('Failed to export grade sheet', { description: e.message }) }
  }

  const handleResultPDF = () => {
    try {
      const className = classId === 'all' ? 'All Classes' : (exam.classes.find((c: any) => c.classId === classId)?.className ?? 'All Classes')
      generateClassResultPDF(exam, className, studentResults as any)
      toast.success('Result PDF downloaded')
    } catch (e: any) { toast.error('Failed to generate result PDF', { description: e.message }) }
  }

  return (
    <div className="space-y-4">
      {/* ─── Filter Bar ─── */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Examination</Label>
          <Select value={examId} onValueChange={(v) => { setExamId(v); setClassId('all'); setStudentId('') }}>
            <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue placeholder="Select exam" /></SelectTrigger>
            <SelectContent>
              {exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Class</Label>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {exam.classes.map((c: any) => <SelectItem key={c.classId} value={c.classId}>{c.className}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] font-semibold text-muted-foreground uppercase">Student</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue placeholder="Select student" /></SelectTrigger>
            <SelectContent>
              {classStudents.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.rollNo ?? '—'})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground uppercase font-semibold">Status:</span>
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold',
            exam.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
            exam.status === 'Ongoing' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
            'bg-sky-500/10 text-sky-700 dark:text-sky-300')}>
            {exam.status}
          </span>
          {exam.resultStatus !== 'Not Started' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
              {exam.resultStatus}
            </span>
          )}
        </div>
      </div>

      {/* Status-aware section rendering */}
      {exam.status === 'Draft' || exam.status === 'Scheduled' ? (
        /* ─── UPCOMING EXAM: Pre-Examination Monitoring ─── */
        <CollapsibleSection title="Pre-Examination Monitoring" subtitle="readiness & configuration status" accent="sky" defaultOpen={true}>
          <PreExamMonitoring exam={exam} examMarks={examMarks} />
        </CollapsibleSection>
      ) : exam.status === 'Ongoing' ? (
        /* ─── LIVE EXAM: Live Examination Monitoring ─── */
        <CollapsibleSection title="Live Examination Monitoring" subtitle="evaluation progress" accent="amber" defaultOpen={true}>
          <LiveExamMonitoring examMarks={examMarks} />
        </CollapsibleSection>
      ) : null}

      {/* ─── Section 1: Results & Official Records (only for completed exams) ─── */}
      {(exam.status === 'Completed' || exam.resultStatus !== 'Not Started') && (
        <CollapsibleSection title="Results & Official Records" subtitle="report cards, grade sheets, result summary" accent="emerald" defaultOpen={true}>
          <div className="p-3 space-y-3">
            {/* Report action tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <ReportTile icon={<User className="h-4 w-4" />} title="Student Report Card" desc="A4 portrait, subject marks, grade, rank, signatures"
                onDownload={handleStudentReportCard} disabled={!studentId}
              />
              <ReportTile icon={<GraduationCap className="h-4 w-4" />} title="Class Grade Sheet" desc="A4 landscape, all students, marks, totals, ranks"
                onDownload={handleClassGradeSheet} disabled={studentResults.length === 0}
              />
              <ReportTile icon={<FileText className="h-4 w-4" />} title="Result PDF" desc="Class result summary with totals and grades"
                onDownload={handleResultPDF} disabled={studentResults.length === 0}
              />
              <ReportTile icon={<ShieldCheck className="h-4 w-4" />} title="Result Verification" desc="Preview what students see on public result page"
                onClick={() => toast.info('Result verification preview', { description: 'Public result page coming soon' })}
              />
            </div>

            {/* Result Summary table */}
            <ResultSummaryTable analytics={analytics} studentResults={studentResults} />
          </div>
        </CollapsibleSection>
      )}

      {/* ─── Section 2: Performance Analytics (only for completed exams) ─── */}
      {(exam.status === 'Completed' || exam.resultStatus !== 'Not Started') && (
        <CollapsibleSection title="Performance Analytics" subtitle="class, subject & grade analysis" accent="violet" defaultOpen={false}>
          <div className="p-3 space-y-3">
            {/* Class Performance */}
            <ClassPerformanceTable classPerf={classPerf} />

          {/* Subject Performance */}
          <SubjectPerformanceTable subjectPerf={subjectPerf} classId={classId} />

          {/* Grade Distribution */}
          <GradeDistributionTable analytics={analytics} />
        </div>
      </CollapsibleSection>
      )}

      {/* ─── Section 3: Attendance Reports — honest "not tracked" (7-b) ─── */}
      <CollapsibleSection title="Attendance Reports" subtitle="exam attendance, room-wise, invigilator duty" accent="amber" defaultOpen={false}>
        <div className="p-3 space-y-3">
          {/* Room-wise Attendance — no data source in this surface yet */}
          <NotTrackedState
            icon={<Calendar className="h-5 w-5" />}
            title="Exam-day attendance is not tracked here yet"
            body="Room-wise exam attendance reports will appear once attendance capture is wired into this surface. Marking registers live in the Examination workspace."
          />

          {/* Invigilator Duty Report — no data source in this surface yet */}
          <NotTrackedState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Invigilator duty analytics are not tracked here yet"
            body="Duty rosters are assigned and reviewed in the Invigilation tab — per-exam duty reports are not generated in this view."
          />
        </div>
      </CollapsibleSection>

      {/* ─── Section 4: Examination Operations ─── */}
      <CollapsibleSection title="Examination Operations" subtitle="marks submission & evaluation report" accent="sky" defaultOpen={false}>
        <div className="p-3">
          <MarksEvaluationReport exam={exam} marks={examMarks} teacherNameMap={teacherNameMap} />
        </div>
      </CollapsibleSection>

      {/* ─── Section 5: Documents — Navigation (Admit Cards managed in Examination workspace) ─── */}
      <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 flex items-center gap-2">
        <Ticket className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-[11px] text-muted-foreground">
          Admit Cards are managed from{' '}
          <span className="font-medium text-foreground">Examination → [Open Exam] → Admit Cards</span>.
        </p>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** 7-b — a published Result row (PRINCIPAL scope, /api/results?examId=). */
interface ResultRowDTO {
  studentId: string
  examId: string
  subjectId: string
  marks: number
  totalMarks: number
  grade: string | null
  remarks: string | null
  createdAt: string
  subject?: { name?: string | null } | null
  student?: { rollNo?: string | null; classId?: string | null; user?: { name?: string | null } | null } | null
}

/** Per-subject pass marks (Result rows carry no passMarks — derive from
 *  the exam's configured pass percentage, defaulting to the school norm). */
function passMarksFor(totalMarks: number, exam: ExamDTO): number {
  const pct = exam.passPercentage && exam.passPercentage > 0 ? exam.passPercentage : 33
  return Math.max(1, Math.round((totalMarks * pct) / 100))
}

/** Map the exam's REAL published Result rows → StudentResult[] (ranked). */
function mapResultRowsToStudentResults(rows: ResultRowDTO[], exam: ExamDTO, classId?: string): StudentResult[] {
  const classNameById = new Map<string, string>()
  for (const c of exam.classes) classNameById.set((c as { classId: string }).classId, (c as { className: string }).className)

  const byStudent = new Map<string, ResultRowDTO[]>()
  for (const r of rows) {
    const list = byStudent.get(r.studentId)
    if (list) list.push(r)
    else byStudent.set(r.studentId, [r])
  }

  const results: StudentResult[] = []
  for (const [studentId, sRows] of byStudent) {
    const first = sRows[0]
    const studentClassId = first.student?.classId ?? ''
    if (classId && studentClassId !== classId) continue
    const subjects: SubjectResult[] = [...sRows]
      .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? ''))
      .map((r) => {
        const maxMarks = r.totalMarks > 0 ? r.totalMarks : 100
        const passMarks = passMarksFor(maxMarks, exam)
        const pct = maxMarks > 0 ? Math.round((r.marks / maxMarks) * 10000) / 100 : 0
        return {
          subjectId: r.subjectId,
          subjectName: r.subject?.name ?? 'Subject',
          maxMarks,
          passMarks,
          marksObtained: r.marks,
          status: 'PRESENT',
          isAbsent: false,
          passed: r.marks >= passMarks,
          percentage: pct,
        }
      })
    const totalObtained = subjects.reduce((s, x) => s + (x.marksObtained ?? 0), 0)
    const totalMax = subjects.reduce((s, x) => s + x.maxMarks, 0)
    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 10000) / 100 : 0
    const { grade, color } = getGradeForPercentage(percentage, [])
    const subjectsFailed = subjects.filter((s) => !s.passed).length
    results.push({
      studentId,
      studentName: first.student?.user?.name ?? 'Student',
      rollNo: first.student?.rollNo ?? null,
      className: classNameById.get(studentClassId) ?? '',
      classId: studentClassId,
      subjects,
      totalObtained,
      totalMax,
      percentage,
      grade,
      gradeColor: color,
      passed: subjectsFailed === 0,
      subjectsPassed: subjects.length - subjectsFailed,
      subjectsCount: subjects.length,
      isAbsentInAll: false,
      rank: 0,
    })
  }

  return results
    .sort((a, b) => b.percentage - a.percentage)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** Map the exam's REAL Result rows → per-subject performance rows. */
function mapResultRowsToSubjectPerformance(rows: ResultRowDTO[], exam: ExamDTO): SubjectPerformanceRow[] {
  const classNameById = new Map<string, string>()
  for (const c of exam.classes) classNameById.set((c as { classId: string }).classId, (c as { className: string }).className)

  const byPaper = new Map<string, ResultRowDTO[]>()
  for (const r of rows) {
    const key = `${r.student?.classId ?? ''}|${r.subjectId}`
    const list = byPaper.get(key)
    if (list) list.push(r)
    else byPaper.set(key, [r])
  }

  const out: SubjectPerformanceRow[] = []
  for (const [key, paperRows] of byPaper) {
    const [classId, subjectId] = key.split('|')
    const values = paperRows.map((r) => r.marks)
    const maxMarks = paperRows[0].totalMarks > 0 ? paperRows[0].totalMarks : 100
    const passMarks = passMarksFor(maxMarks, exam)
    const passCount = values.filter((v) => v >= passMarks).length
    const dist: Record<string, number> = {}
    for (const g of DEFAULT_GRADE_BOUNDARIES) dist[g.grade] = 0
    for (const v of values) {
      const pct = maxMarks > 0 ? (v / maxMarks) * 100 : 0
      const { grade } = getGradeForPercentage(pct, [])
      dist[grade] = (dist[grade] ?? 0) + 1
    }
    out.push({
      classId,
      className: classNameById.get(classId) ?? '',
      subjectId,
      subjectName: paperRows[0].subject?.name ?? 'Subject',
      entered: values.length,
      total: paperRows.length,
      avg: values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0,
      highest: values.length > 0 ? Math.max(...values) : 0,
      lowest: values.length > 0 ? Math.min(...values) : 0,
      passCount,
      failCount: values.length - passCount,
      absentCount: 0,
      passRate: values.length > 0 ? Math.round((passCount / values.length) * 100) : 0,
      gradeDistribution: dist,
    })
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName))
}

/** Map the ranked student results → per-class performance rows. */
function mapStudentResultsToClassPerformance(results: StudentResult[], exam: ExamDTO): ClassPerformanceRow[] {
  const dist: Record<string, number> = {}
  for (const g of DEFAULT_GRADE_BOUNDARIES) dist[g.grade] = 0
  return (exam.classes as Array<{ classId: string; className: string }>).map((c) => {
    const classResults = results.filter((r) => r.classId === c.classId)
    const passed = classResults.filter((r) => r.passed)
    const pcts = classResults.map((r) => r.percentage)
    const classDist: Record<string, number> = { ...dist }
    for (const r of classResults) {
      const { grade } = getGradeForPercentage(r.percentage, [])
      classDist[grade] = (classDist[grade] ?? 0) + 1
    }
    return {
      classId: c.classId,
      className: c.className,
      totalStudents: classResults.length,
      appeared: classResults.length,
      absent: 0,
      passed: passed.length,
      failed: classResults.length - passed.length,
      passRate: classResults.length > 0 ? Math.round((passed.length / classResults.length) * 100) : 0,
      avgPct: pcts.length > 0 ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0,
      highestPct: pcts.length > 0 ? Math.max(...pcts) : 0,
      lowestPct: pcts.length > 0 ? Math.min(...pcts) : 0,
      gradeDistribution: classDist,
    }
  })
}

function fallbackSchool(exam: ExamDTO): SchoolContextDTO {
  // School identity falls back to the live School Settings snapshot —
  // never a hardcoded placeholder.
  const profile = getSchoolProfile()
  return {
    schoolId: '', schoolName: profile.name, schoolCode: '',
    address: profile.address, city: null, phone: profile.phone, email: profile.email, logoUrl: null,
    academicYear: exam.session, board: 'CBSE',
  }
}

// ─── Pre-Examination Monitoring (for upcoming exams) ─────────────────

function PreExamMonitoring({ exam, examMarks }: {
  exam: ExamDTO; examMarks: Array<{ marksObtained: number | null }>
}) {
  const hasSchedule = exam.schedule.length > 0
  const hasMarks = examMarks.length > 0

  const items = [
    { label: 'Schedule published', done: hasSchedule, detail: `${exam.schedule.length} papers scheduled` },
    { label: 'Classes configured', done: exam.classes.length > 0, detail: `${exam.classes.length} classes` },
    { label: 'Subjects configured', done: exam.subjects.length > 0, detail: `${exam.subjects.length} subjects` },
    { label: 'Marks entry started', done: hasMarks, detail: hasMarks ? `${examMarks.length} mark rows` : 'Not started' },
  ]

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border/60 bg-card p-2.5">
            <div className="flex items-center gap-2">
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                item.done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                {item.done ? '✓' : '—'}
              </span>
              <span className="text-[11px] font-medium">{item.label}</span>
            </div>
            <p className="text-[9px] text-muted-foreground mt-1 ml-7">{item.detail}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-sky-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground">
          This examination is upcoming. Result analytics will appear here after marks are entered and the exam is completed.
        </p>
      </div>
    </div>
  )
}

// ─── Live Examination Monitoring (for ongoing exams) ─────────────────

function LiveExamMonitoring({ examMarks }: {
  examMarks: Array<{ marksObtained: number | null }>
}) {
  const enteredMarks = examMarks.filter((m) => m.marksObtained !== null).length
  const totalMarks = examMarks.length

  const items = [
    { label: 'Mark Rows', value: totalMarks },
    { label: 'Marks Entered', value: `${enteredMarks}/${totalMarks}`, color: 'text-amber-600' },
    { label: 'Awaiting Entry', value: totalMarks - enteredMarks, color: totalMarks - enteredMarks > 0 ? 'text-amber-600' : 'text-muted-foreground' },
  ]

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-muted/30 border border-border/40 px-2.5 py-1.5 text-center">
            <p className="text-[8px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
            <p className={cn('text-[13px] font-bold tabular-nums mt-0.5', item.color ?? '')}>{item.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 flex items-start gap-2">
        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground">
          This examination is in progress. Full result analytics will appear here after all marks are entered and the exam is completed.
        </p>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

function ReportTile({ icon, title, desc, onDownload, onClick, disabled }: {
  icon: React.ReactNode; title: string; desc: string
  onDownload?: () => void; onClick?: () => void; disabled?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 flex flex-col gap-1.5 hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">{icon}</span>
        <p className="text-[11px] font-semibold leading-tight">{title}</p>
      </div>
      <p className="text-[9px] text-muted-foreground leading-snug flex-1">{desc}</p>
      <div className="flex items-center gap-1 mt-1">
        {onDownload && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onDownload} disabled={disabled}>
            <Download className="h-2.5 w-2.5" /> Download
          </Button>
        )}
        {onClick && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={onClick} disabled={disabled}>
            <Eye className="h-2.5 w-2.5" /> Preview
          </Button>
        )}
      </div>
    </div>
  )
}

function ResultSummaryTable({ analytics, studentResults }: { analytics: any; studentResults: StudentResult[] }) {
  if (studentResults.length === 0) {
    return <EmptyState icon={<FileText className="h-5 w-5" />} message="No results available for this examination." />
  }
  const stats = [
    { label: 'Total Students', value: analytics.totalStudents },
    { label: 'Appeared', value: analytics.appeared },
    { label: 'Absent', value: analytics.absent },
    { label: 'Passed', value: analytics.passed },
    { label: 'Failed', value: analytics.failed },
    { label: 'Pass %', value: `${analytics.passRate}%` },
    { label: 'Average %', value: `${analytics.averagePercentage}%` },
    { label: 'Highest %', value: `${analytics.highestPercentage}%` },
    { label: 'Lowest %', value: `${analytics.lowestPercentage}%` },
  ]
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Result Summary</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-px bg-border/40">
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-2 py-2 text-center">
            <p className="text-[8px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="text-[13px] font-bold tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
      {/* Grade Distribution mini */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/40 flex-wrap">
        <span className="text-[9px] uppercase font-semibold text-muted-foreground">Grade Distribution:</span>
        {Object.entries(analytics.gradeDistribution).filter(([, v]) => (v as number) > 0).map(([grade, count]) => (
          <span key={grade} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-primary/10 text-primary">
            {grade}: {count as number}
          </span>
        ))}
      </div>
    </div>
  )
}

function ClassPerformanceTable({ classPerf }: { classPerf: any[] }) {
  if (classPerf.length === 0) {
    return <EmptyState icon={<TrendingUp className="h-5 w-5" />} message="No class performance data available." />
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Class Performance</p>
      </div>
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Appeared</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Passed</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Failed</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Pass %</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Avg %</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">High %</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Low %</th>
            </tr>
          </thead>
          <tbody>
            {classPerf.map((c, i) => (
              <tr key={i} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
                <td className="px-2 py-1.5 font-medium">{c.className}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{c.totalStudents}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{c.appeared}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-emerald-600">{c.passed}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-rose-600">{c.failed}</td>
                <td className="px-2 py-1.5 text-center tabular-nums font-semibold">{c.passRate}%</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{c.avgPct}%</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-emerald-600">{c.highestPct}%</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-amber-600">{c.lowestPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SubjectPerformanceTable({ subjectPerf, classId }: { subjectPerf: any[]; classId: string }) {
  const filtered = classId === 'all' ? subjectPerf : subjectPerf.filter((s) => s.classId === classId)
  if (filtered.length === 0) {
    return <EmptyState icon={<BookOpen className="h-5 w-5" />} message="No subject performance data available." />
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Subject Performance</p>
      </div>
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Entered</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Avg</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">High</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Low</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Pass</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Fail</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Absent</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Pass %</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={i} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
                <td className="px-2 py-1.5 text-muted-foreground">{s.className}</td>
                <td className="px-2 py-1.5 font-medium">{s.subjectName}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{s.entered}/{s.total}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{s.avg}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-emerald-600">{s.highest}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-rose-600">{s.lowest}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-emerald-600">{s.passCount}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-rose-600">{s.failCount}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-amber-600">{s.absentCount}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                    s.passRate >= 75 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                    s.passRate >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                    'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
                    {s.passRate}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GradeDistributionTable({ analytics }: { analytics: any }) {
  const grades = DEFAULT_GRADE_BOUNDARIES
  if (!analytics || analytics.totalStudents === 0) {
    return <EmptyState icon={<Award className="h-5 w-5" />} message="No grade distribution data available." />
  }
  const maxCount = Math.max(1, ...Object.values(analytics.gradeDistribution) as number[])
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Grade Distribution</p>
      </div>
      <div className="p-3 space-y-1.5">
        {grades.map((g) => {
          const count = analytics.gradeDistribution[g.grade] ?? 0
          const pct = analytics.totalStudents > 0 ? Math.round((count / analytics.totalStudents) * 1000) / 10 : 0
          const barWidth = Math.round((count / maxCount) * 100)
          const colorMap: Record<string, string> = {
            A1: 'from-emerald-500 to-emerald-400', A2: 'from-emerald-500 to-emerald-400',
            B1: 'from-sky-500 to-sky-400', B2: 'from-amber-500 to-amber-400',
            C1: 'from-orange-500 to-orange-400', C2: 'from-rose-500 to-rose-400', E: 'from-rose-600 to-rose-500',
          }
          return (
            <div key={g.grade} className="flex items-center gap-3">
              <span className="w-7 text-[11px] font-bold tabular-nums text-center">{g.grade}</span>
              <div className="flex-1 h-4 rounded-md bg-muted/30 overflow-hidden relative">
                <div className={cn('h-full rounded-md bg-gradient-to-r', colorMap[g.grade] ?? 'from-primary to-primary/80')} style={{ width: `${barWidth}%` }} />
              </div>
              <span className="w-7 text-[11px] tabular-nums text-right font-medium">{count === 0 ? '—' : count}</span>
              <span className="w-10 text-[10px] tabular-nums text-right text-muted-foreground">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MarksEvaluationReport({ exam, marks, teacherNameMap }: {
  exam: ExamDTO
  marks: Array<{ classId: string; subjectId: string; marksObtained: number | null; workflowStatus: string; enteredBy: string | null; enteredAt: string | null; verifiedAt: string | null; lockedBy: string | null }>
  teacherNameMap: Map<string, string>
}) {
  const rows = useMemo(() => {
    const result: Array<{ classId: string; className: string; subjectId: string; subjectName: string; teacher: string | null; total: number; entered: number; status: string; enteredAt: string | null; verifiedAt: string | null; lockedAt: string | null }> = []
    for (const c of exam.classes) {
      for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
        const subjectMarks = marks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
        const entered = subjectMarks.filter((m) => m.marksObtained !== null).length
        const statuses = new Set(subjectMarks.map((m) => m.workflowStatus))
        const allLocked = subjectMarks.length > 0 && [...statuses].every((s) => s === 'LOCKED')
        const allVerified = subjectMarks.length > 0 && [...statuses].every((s) => ['VERIFIED', 'LOCKED'].includes(s))
        const allSubmitted = subjectMarks.length > 0 && [...statuses].every((s) => ['SUBMITTED', 'VERIFIED', 'LOCKED'].includes(s))
        const status = allLocked ? 'LOCKED' : allVerified ? 'VERIFIED' : allSubmitted ? 'SUBMITTED' : entered > 0 ? 'IN_PROGRESS' : 'DRAFT'
        // 7-b — the teacher is resolved from the marks' REAL enteredBy id
        // (staff directory); unresolvable/absent → an honest "—".
        const enteredBy = subjectMarks.find((m) => m.enteredBy)?.enteredBy ?? null
        result.push({
          classId: c.classId, className: c.className,
          subjectId: subj.subjectId, subjectName: subj.subjectName,
          teacher: resolveEnteredBy(enteredBy, teacherNameMap),
          total: subjectMarks.length, entered, status,
          enteredAt: subjectMarks[0]?.enteredAt ?? null,
          verifiedAt: subjectMarks[0]?.verifiedAt ?? null,
          lockedAt: subjectMarks[0]?.lockedBy ? subjectMarks[0]?.enteredAt : null,
        })
      }
    }
    return result
  }, [exam, marks, teacherNameMap])

  // 7-b — no marks-entry rows AND no subject configs → honest "not
  // tracked" (legacy exams published through the results flow have no
  // ExamMark workflow rows).
  if (rows.length === 0) {
    return (
      <NotTrackedState
        icon={<ClipboardList className="h-5 w-5" />}
        title="No marks-entry records for this examination"
        body="Marks-entry workflow rows appear here when teachers enter marks through the Examination workspace. Examinations published without the workflow have no entry records."
      />
    )
  }

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Marks Submission & Evaluation Report</p>
      </div>
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Teacher</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Entered</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
                <td className="px-2 py-1.5 text-muted-foreground">{r.className}</td>
                <td className="px-2 py-1.5 font-medium">{r.subjectName}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.teacher ?? '—'}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.entered}/{r.total}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold',
                    r.status === 'LOCKED' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                    r.status === 'VERIFIED' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' :
                    r.status === 'SUBMITTED' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                    r.status === 'IN_PROGRESS' ? 'bg-amber-500/5 text-amber-600' :
                    'bg-muted/40 text-muted-foreground')}>
                    {r.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="py-8 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted/40 mb-2 text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-[11px] text-muted-foreground">{message}</p>
    </div>
  )
}

/** 7-b — honest "not tracked" state for sections with no real data source. */
function NotTrackedState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-6 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted/40 mb-2 text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-[11px] font-medium text-foreground/80">{title}</p>
      <p className="mt-1 max-w-md mx-auto text-[10px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
