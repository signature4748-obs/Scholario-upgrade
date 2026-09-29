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
 * All data consumed from canonical mock stores — no duplicate datasets.
 */

import { useState, useMemo, useEffect } from 'react'
import {
  FileText, Download, User, GraduationCap, Ticket, TrendingUp, Calendar, ShieldCheck, Award,
  Eye, BookOpen, AlertTriangle, Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { CollapsibleSection } from '../collapsible-section'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getSchoolProfile } from '@/lib/school-profile'
import {
  type ExamDTO, type SchoolContextDTO,
  type StudentResult, type ReportCardConfigDTO,
  DEFAULT_GRADE_BOUNDARIES,
} from '@/lib/exams/types'
import { useMockMarksStore } from '@/lib/exams/mock-marks-data'
import { useMockAttendanceStore } from '@/lib/exams/mock-attendance-data'
import { useMockInvigilatorStore } from '@/lib/exams/mock-invigilator-data'
import { useStudentsStore } from '@/lib/store/students-store'
import {
  computeStudentResults, computeExamAnalytics, computeSubjectPerformance,
  computeClassPerformance,
} from '@/lib/exams/analytics'
import {
  generateClassGradeSheetPDF, generateStudentReportCardPDF, } from '@/lib/exams/pdf'
import { useSchoolContext } from '@/lib/exams/use-pdf-context'
import { useAdmitCardConfig, useReportCardConfig } from '@/lib/exams/use-exam-settings'
import { generateClassResultPDF } from '@/lib/exams/result-pdf'

interface Props {
  exams: ExamDTO[]
}

export function ReportsTab({ exams }: Props) {
  const [examId, setExamId] = useState<string>(exams[0]?.id ?? '')
  const [classId, setClassId] = useState<string>('all')
  const [studentId, setStudentId] = useState<string>('')

  const exam = exams.find((e) => e.id === examId) ?? null

  // Canonical data sources.
  const storeMarks = useMockMarksStore((s) => s.marks)
  const initMarks = useMockMarksStore((s) => s.initMarks)
  const allStudents = useStudentsStore((s) => s.students)
  const attendanceStore = useMockAttendanceStore()
  const initAttendance = useMockAttendanceStore((s) => s.initAttendance)
  const invigilatorStore = useMockInvigilatorStore()
  const { data: schoolCtx } = useSchoolContext()
  const { config: _admitCfg } = useAdmitCardConfig()
  const { config: reportCfg } = useReportCardConfig()

  // Initialize mock marks + attendance for the selected exam (if not already done).
  useEffect(() => {
    if (!exam || exam.classes.length === 0) return
    const students = allStudents
      .filter((s) => exam.classes.some((c) => c.classId === s.classId) && s.status === 'Active')
      .map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, classId: s.classId, className: s.className }))
    if (students.length > 0) {
      initMarks(exam, students)
      initAttendance(exam, students)
    }
  }, [exam, allStudents, initMarks, initAttendance])

  // Filter marks for selected exam.
  const examMarks = useMemo(
    () => storeMarks.filter((m) => m.examId === examId),
    [storeMarks, examId],
  )

  // Compute student results from canonical marks.
  const studentResults = useMemo(
    () => exam ? computeStudentResults(exam, examMarks, classId === 'all' ? undefined : classId) : [],
    [exam, examMarks, classId],
  )

  // Compute analytics.
  const analytics = useMemo(
    () => computeExamAnalytics(studentResults),
    [studentResults],
  )

  // Subject performance.
  const subjectPerf = useMemo(
    () => exam ? computeSubjectPerformance(exam, examMarks) : [],
    [exam, examMarks],
  )

  // Class performance.
  const classPerf = useMemo(
    () => computeClassPerformance(studentResults, exam ?? {} as ExamDTO),
    [studentResults, exam],
  )

  // Attendance sessions for this exam.
  const examSessions = useMemo(
    () => attendanceStore.sessions.filter((s) => s.examId === examId),
    [attendanceStore.sessions, examId],
  )

  // Invigilator duties for this exam.
  const examDuties = useMemo(
    () => invigilatorStore.getExamDuties(examId),
    [invigilatorStore, examId],
  )

  // Students for the selected class (for student selector).
  const classStudents = useMemo(() => {
    if (!exam) return []
    const targetClassId = classId === 'all' ? (exam.classes[0]?.classId ?? '') : classId
    return allStudents
      .filter((s) => s.classId === targetClassId && s.status === 'Active')
      .map((s) => ({ id: s.id, rollNo: s.rollNo, name: s.name }))
  }, [allStudents, exam, classId])

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
          <PreExamMonitoring exam={exam} examSessions={examSessions} examDuties={examDuties} examMarks={examMarks} />
        </CollapsibleSection>
      ) : exam.status === 'Ongoing' ? (
        /* ─── LIVE EXAM: Live Examination Monitoring ─── */
        <CollapsibleSection title="Live Examination Monitoring" subtitle="sessions, attendance & evaluation progress" accent="amber" defaultOpen={true}>
          <LiveExamMonitoring exam={exam} examSessions={examSessions} attendanceRecords={attendanceStore.records} examMarks={examMarks} />
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

      {/* ─── Section 3: Attendance Reports ─── */}
      <CollapsibleSection title="Attendance Reports" subtitle="exam attendance, room-wise, invigilator duty" accent="amber" defaultOpen={false}>
        <div className="p-3 space-y-3">
          {/* Room-wise Attendance */}
          <RoomAttendanceTable sessions={examSessions} attendanceRecords={attendanceStore.records} />

          {/* Invigilator Duty Report */}
          <InvigilatorDutyTable duties={examDuties} sessions={examSessions} attendanceRecords={attendanceStore.records} />
        </div>
      </CollapsibleSection>

      {/* ─── Section 4: Examination Operations ─── */}
      <CollapsibleSection title="Examination Operations" subtitle="marks submission & evaluation report" accent="sky" defaultOpen={false}>
        <div className="p-3">
          <MarksEvaluationReport exam={exam} marks={examMarks} />
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

function PreExamMonitoring({ exam, examSessions, examDuties, examMarks }: {
  exam: ExamDTO; examSessions: any[]; examDuties: any[]; examMarks: any[]
}) {
  const hasSchedule = exam.schedule.length > 0
  const hasSeating = examSessions.length > 0
  const hasInvigilators = examDuties.length > 0
  const hasMarks = examMarks.length > 0

  const items = [
    { label: 'Schedule published', done: hasSchedule, detail: `${exam.schedule.length} papers scheduled` },
    { label: 'Classes configured', done: exam.classes.length > 0, detail: `${exam.classes.length} classes` },
    { label: 'Subjects configured', done: exam.subjects.length > 0, detail: `${exam.subjects.length} subjects` },
    { label: 'Seating ready', done: hasSeating, detail: hasSeating ? `${examSessions.length} sessions` : 'Not generated' },
    { label: 'Invigilators assigned', done: hasInvigilators, detail: hasInvigilators ? `${examDuties.length} duties` : 'Not assigned' },
    { label: 'Marks entry started', done: hasMarks, detail: hasMarks ? `${examMarks.length} marks` : 'Not started' },
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

function LiveExamMonitoring({ exam, examSessions, attendanceRecords, examMarks }: {
  exam: ExamDTO; examSessions: any[]; attendanceRecords: any[]; examMarks: any[]
}) {
  const submittedSessions = examSessions.filter((s) => s.submitted).length
  const pendingSessions = examSessions.length - submittedSessions
  const totalAttendanceRecords = attendanceRecords.filter((r) => r.examId === exam.id).length
  const presentCount = attendanceRecords.filter((r) => r.examId === exam.id && r.status === 'PRESENT').length
  const enteredMarks = examMarks.filter((m) => m.marksObtained !== null).length
  const totalMarks = examMarks.length

  const items = [
    { label: 'Sessions Total', value: examSessions.length },
    { label: 'Sessions Submitted', value: submittedSessions, color: 'text-emerald-600' },
    { label: 'Sessions Pending', value: pendingSessions, color: pendingSessions > 0 ? 'text-amber-600' : 'text-muted-foreground' },
    { label: 'Attendance Records', value: totalAttendanceRecords },
    { label: 'Students Present', value: presentCount, color: 'text-emerald-600' },
    { label: 'Marks Entered', value: `${enteredMarks}/${totalMarks}`, color: 'text-amber-600' },
  ]

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
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

function RoomAttendanceTable({ sessions, attendanceRecords }: { sessions: any[]; attendanceRecords: any[] }) {
  if (sessions.length === 0) {
    return <EmptyState icon={<Calendar className="h-5 w-5" />} message="No exam attendance sessions available." />
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Room-wise Attendance</p>
      </div>
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Room</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Invigilator</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Present</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Absent</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const records = attendanceRecords.filter((r) => r.examId === s.examId && r.scheduleItemId === s.scheduleItemId)
              const present = records.filter((r) => r.status === 'PRESENT').length
              const absent = records.filter((r) => r.status === 'ABSENT').length
              return (
                <tr key={s.id} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{s.date}</td>
                  <td className="px-2 py-1.5 font-medium">{s.subjectName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{s.className}</td>
                  <td className="px-2 py-1.5">{s.roomName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{s.invigilatorName ?? '—'}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{records.length}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-emerald-600">{present}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-rose-600">{absent}</td>
                  <td className="px-2 py-1.5 text-center">
                    {s.submitted ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Submitted</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300">Pending</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InvigilatorDutyTable({ duties, sessions, attendanceRecords }: { duties: any[]; sessions: any[]; attendanceRecords: any[] }) {
  if (duties.length === 0) {
    return <EmptyState icon={<ShieldCheck className="h-5 w-5" />} message="No invigilator duties assigned for this examination." />
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Invigilator Duty Report</p>
      </div>
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Invigilator</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Room</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
              <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {duties.map((d) => {
              const session = sessions.find((s) => s.scheduleItemId === d.scheduleItemId)
              const records = session ? attendanceRecords.filter((r) => r.scheduleItemId === d.scheduleItemId) : []
              return (
                <tr key={d.id} className="border-t border-border/30 hover:bg-muted/20 even:bg-muted/10">
                  <td className="px-2 py-1.5 font-medium">{d.teacherName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{d.date}</td>
                  <td className="px-2 py-1.5">{d.subjectName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{d.className}</td>
                  <td className="px-2 py-1.5">{d.roomName}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{records.length}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-semibold',
                      d.status === 'SUBMITTED' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                      d.status === 'ACCEPTED' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' :
                      'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MarksEvaluationReport({ exam, marks }: { exam: ExamDTO; marks: any[] }) {
  const rows = useMemo(() => {
    const result: Array<{ classId: string; className: string; subjectId: string; subjectName: string; teacher: string; total: number; entered: number; status: string; enteredAt: string | null; verifiedAt: string | null; lockedAt: string | null }> = []
    for (const c of exam.classes) {
      for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
        const subjectMarks = marks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
        const entered = subjectMarks.filter((m) => m.marksObtained !== null).length
        const statuses = new Set(subjectMarks.map((m) => m.workflowStatus))
        const allLocked = subjectMarks.length > 0 && [...statuses].every((s) => s === 'LOCKED')
        const allVerified = subjectMarks.length > 0 && [...statuses].every((s) => ['VERIFIED', 'LOCKED'].includes(s))
        const allSubmitted = subjectMarks.length > 0 && [...statuses].every((s) => ['SUBMITTED', 'VERIFIED', 'LOCKED'].includes(s))
        const status = allLocked ? 'LOCKED' : allVerified ? 'VERIFIED' : allSubmitted ? 'SUBMITTED' : entered > 0 ? 'IN_PROGRESS' : 'DRAFT'
        result.push({
          classId: c.classId, className: c.className,
          subjectId: subj.subjectId, subjectName: subj.subjectName,
          teacher: teacherForSubject(subj.subjectName),
          total: subjectMarks.length, entered, status,
          enteredAt: subjectMarks[0]?.enteredAt ?? null,
          verifiedAt: subjectMarks[0]?.verifiedAt ?? null,
          lockedAt: subjectMarks[0]?.lockedBy ? subjectMarks[0]?.enteredAt : null,
        })
      }
    }
    return result
  }, [exam, marks])

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
                <td className="px-2 py-1.5 text-muted-foreground">{r.teacher}</td>
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

function teacherForSubject(subjectName: string): string {
  const s = subjectName.toLowerCase()
  if (s.includes('math')) return 'Mr. Anil Sharma'
  if (s.includes('english')) return 'Ms. Priya Nair'
  if (s.includes('physics')) return 'Dr. Lakshmi Iyer'
  if (s.includes('chemistry')) return 'Mr. Venkat Naidu'
  if (s.includes('biology')) return 'Mrs. Anjali Desai'
  if (s.includes('social')) return 'Mr. Karthik Reddy'
  if (s.includes('hindi')) return 'Mrs. Meera Joshi'
  if (s.includes('commerce') || s.includes('account')) return 'Mr. Sandeep Gupta'
  return 'Mr. Rajesh Kumar'
}
