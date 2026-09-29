'use client'

/**
 * Marks section for the ExamWorkspace — REAL DATA EDITION (iq3000-2b).
 *
 * The paper-level workflow control center — entry → submit → verify →
 * lock → declare → publish — operating on the canonical ExamMark rows in
 * the database through the real /api/exams/[id]/* routes. No mock stores.
 *
 * Data sources:
 *  - Overview/summary:      useExamMarksAll → GET /api/exams/[id]/results/class/[classId]
 *                           (one request per exam class — the class-level marks
 *                           surface — aggregated client-side).
 *  - Paper drill-down:      GET  /api/exams/[id]/marks?classId=&subjectId= (roster + marks)
 *  - Marks entry:           POST /api/exams/[id]/marks/single
 *  - Workflow transitions:  POST /api/exams/[id]/marks/submit|verify|lock
 *  - Declare / publish:     POST /api/exams/[id]/results/declare and
 *                           /api/exams/[id]/publish (EXAM-level in the real
 *                           backend — declaration is not per-class).
 *  - Paper timeline:        GET  /api/exams/[id]/audit (real ExamAuditLog rows).
 *
 * Contains:
 *  - MarksSection (parent)
 *  - PaperMarksInline (marks entry drawer for one paper — Principal has
 *    school-wide authority over any class/subject of the examination)
 *  - SubjectAnalytics
 *  - ResultsInline (per-class results, server-computed)
 *  - StudentResultDetail (single-student breakdown)
 *  - PaperTimelineInline (audit timeline drawer for one paper)
 */

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Lock,
  Megaphone,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Unlock,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  getGradeForPercentage,
  MARK_STATUSES,
  type AuditLogDTO,
  type ExamDTO,
  type ExamMarkDTO,
  type MarkStatus,
  type StudentResult,
  type WorkflowStatus,
} from '@/lib/exams/types'
import {
  useAuditLogs,
  useClassResults,
  useDeclareResults,
  useLockMarks,
  useMarks,
  useSetMark,
  useSubmitMarks,
  useVerifyMarks,
} from '@/lib/exams/use-exams'
import {
  buildTeacherNameMap,
  resolveEnteredBy,
  useExamMarksAll,
  usePublishResults,
  useTeacherDirectory,
} from './marks-hooks'
import { generateClassResultPDF, generateStudentResultPDF } from '@/lib/exams/result-pdf'
import { CollapsibleSection } from './collapsible-section'
import { InlineLoading } from './inline-loading'
import { Stat } from './workspace-shared'

// ─── Helpers ───────────────────────────────────────────────────────────

/** Extract an honest message from an ApiError / Error / anything thrown. */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** A mark row counts as "entered" when it has a value OR a non-PRESENT status (absent/medical/exempted). */
function isEntered(m: ExamMarkDTO): boolean {
  return m.marksObtained !== null || m.status !== 'PRESENT'
}

/**
 * Adapt a REAL server-computed StudentResult to the PDF module's legacy
 * row shape (name/obtained/grade fields). Per-subject grades are derived
 * from the real percentage via the app's canonical grader; the overall
 * grade comes straight from the server (school grade scale).
 */
function toPdfResult(r: StudentResult) {
  return {
    studentId: r.studentId,
    name: r.studentName,
    rollNo: r.rollNo,
    className: r.className,
    subjects: r.subjects.map((s) => ({
      subjectName: s.subjectName,
      maxMarks: s.maxMarks,
      obtained: s.marksObtained,
      percentage: s.percentage,
      grade: s.isAbsent ? '—' : getGradeForPercentage(s.percentage).grade,
      passed: s.passed,
    })),
    totalObtained: r.totalObtained,
    totalMax: r.totalMax,
    percentage: r.percentage,
    grade: r.grade,
    passed: r.passed,
    rank: r.rank,
  }
}

/** Aggregate paper status from the workflow statuses of its mark rows. */
function paperStatusOf(marks: ExamMarkDTO[]): 'LOCKED' | 'VERIFIED' | 'SUBMITTED' | 'IN_PROGRESS' | 'DRAFT' {
  if (marks.length === 0) return 'DRAFT'
  const all = (pred: (s: WorkflowStatus) => boolean) => marks.every((m) => pred(m.workflowStatus))
  if (all((s) => s === 'LOCKED')) return 'LOCKED'
  if (all((s) => s === 'VERIFIED' || s === 'LOCKED')) return 'VERIFIED'
  if (all((s) => s === 'SUBMITTED' || s === 'VERIFIED' || s === 'LOCKED')) return 'SUBMITTED'
  if (marks.some(isEntered)) return 'IN_PROGRESS'
  return 'DRAFT'
}


/** Status chip shared by the paper table and the entry drawer (same visual as before). */
function PaperStatusChip({ status }: { status: string }) {
  if (status === 'LOCKED') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
        <Lock className="h-2.5 w-2.5" /> Locked
      </span>
    )
  }
  if (status === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">
        <CheckCircle2 className="h-2.5 w-2.5" /> Verified
      </span>
    )
  }
  if (status === 'SUBMITTED') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
        <Send className="h-2.5 w-2.5" /> Submitted
      </span>
    )
  }
  if (status === 'IN_PROGRESS') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/5 text-amber-600 border border-amber-500/15">
        <Clock className="h-2.5 w-2.5" /> In Progress
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-muted/40 text-muted-foreground border border-border/40">
      Not Started
    </span>
  )
}

// ─── Marks Section — paper-level workflow control center ──────────────

export function MarksSection({ exam, onReload }: { exam: ExamDTO; onReload: () => void }) {
  const { submit } = useSubmitMarks()
  const { verify } = useVerifyMarks()
  const { lock } = useLockMarks()
  const { declare } = useDeclareResults()
  const { publish } = usePublishResults()
  const { allMarks, loading: marksLoading, error: marksError, reload: reloadMarks } = useExamMarksAll(exam)
  const teachers = useTeacherDirectory()
  const [classId, setClassId] = useState(exam.classes[0]?.classId ?? '')
  const [showResults, setShowResults] = useState(false)
  const [entryPaper, setEntryPaper] = useState<{ classId: string; subjectId: string } | null>(null)
  const [timelinePaper, setTimelinePaper] = useState<{ classId: string; subjectId: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [busy, setBusy] = useState(false)
  const [publishedThisSession, setPublishedThisSession] = useState(false)

  const teacherNameMap = useMemo(() => buildTeacherNameMap(teachers), [teachers])
  const allExamMarks = useMemo(() => allMarks.filter((m) => m.examId === exam.id), [allMarks, exam.id])

  /** Expected rows = Σ (class roster × subjects configured for the class) — the honest denominator. */
  const expectedRows = useMemo(() => {
    const fromConfig = exam.classes.reduce((sum, c) => {
      const subjCount = exam.subjects.filter((s: any) => s.classId === c.classId).length
      return sum + (c.studentCount ?? 0) * subjCount
    }, 0)
    return Math.max(fromConfig, allExamMarks.length)
  }, [exam, allExamMarks])

  // Summary — real ExamMark rows.
  const summary = useMemo(() => {
    const total = expectedRows
    const entered = allExamMarks.filter(isEntered).length
    const submitted = allExamMarks.filter((m) => ['SUBMITTED', 'VERIFIED', 'LOCKED'].includes(m.workflowStatus)).length
    const verified = allExamMarks.filter((m) => ['VERIFIED', 'LOCKED'].includes(m.workflowStatus)).length
    const locked = allExamMarks.filter((m) => m.workflowStatus === 'LOCKED').length
    const pct = total > 0 ? Math.round((entered / total) * 100) : 0
    return { total, entered, submitted, verified, locked, pct }
  }, [allExamMarks, expectedRows])

  // Per-class result readiness (real marks; declaration is exam-level).
  const classReadiness = useMemo(() => {
    return exam.classes.map((c: any) => {
      const classMarks = allExamMarks.filter((m) => m.classId === c.classId)
      const classSubjects = exam.subjects.filter((s: any) => s.classId === c.classId)
      const lockedPapers = new Set(
        classMarks.filter((m) => m.workflowStatus === 'LOCKED').map((m) => m.subjectId),
      )
      const isReady = classSubjects.length > 0 && classSubjects.every((s: any) => lockedPapers.has(s.subjectId))
      return {
        classId: c.classId,
        className: c.className,
        totalPapers: classSubjects.length,
        lockedPapers: lockedPapers.size,
        missingPapers: classSubjects.filter((s: any) => !lockedPapers.has(s.subjectId)),
        isReady,
      }
    })
  }, [exam, allExamMarks])

  // Subject-wise progress rows — with the real "entered by" teacher.
  const subjectRows = useMemo(() => {
    const rows: Array<{ classId: string; className: string; subjectId: string; subjectName: string; teacher: string; total: number; entered: number; status: string }> = []
    for (const c of exam.classes) {
      const roster = c.studentCount ?? 0
      for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
        const marks = allExamMarks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
        const entered = marks.filter(isEntered).length
        rows.push({
          classId: c.classId,
          className: c.className,
          subjectId: subj.subjectId,
          subjectName: subj.subjectName,
          teacher: resolveEnteredBy(mostFrequentEnteredBy(marks), teacherNameMap) ?? '—',
          total: Math.max(roster, marks.length),
          entered,
          status: paperStatusOf(marks),
        })
      }
    }
    return rows
  }, [exam, allExamMarks, teacherNameMap])

  // Filtered subject rows (search + status filter).
  const filteredSubjectRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return subjectRows.filter((r) => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (q) {
        return r.subjectName.toLowerCase().includes(q) ||
               r.className.toLowerCase().includes(q) ||
               r.teacher.toLowerCase().includes(q)
      }
      return true
    })
  }, [subjectRows, searchQuery, filterStatus])

  const hasFilters = searchQuery.trim() !== '' || filterStatus !== 'all'

  const refresh = () => {
    reloadMarks()
    onReload()
  }

  // Workflow transition on one paper (or exam-wide when cid omitted).
  const handleAction = async (action: 'submit' | 'verify' | 'lock', cid?: string, sid?: string) => {
    setBusy(true)
    try {
      const filter = cid ? { classId: cid, ...(sid ? { subjectId: sid } : {}) } : {}
      if (action === 'submit') {
        const r = await submit(exam.id, filter)
        toast.success(`Submitted ${r.submitted ?? 0} marks`)
      } else if (action === 'verify') {
        const r = await verify(exam.id, filter)
        toast.success(`Verified ${r.verified ?? 0} marks`)
      } else if (action === 'lock') {
        const r = await lock(exam.id, filter)
        toast.success(`Locked ${r.locked ?? 0} marks`)
      }
      refresh()
    } catch (e) {
      toast.error('Action failed', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  // Bulk action: verify all submitted papers in the filtered view.
  const handleBulkVerify = async () => {
    const toVerify = filteredSubjectRows.filter((r) => r.status === 'SUBMITTED')
    if (toVerify.length === 0) { toast.info('No submitted papers to verify in the current view'); return }
    setBusy(true)
    try {
      let total = 0
      for (const r of toVerify) {
        const res = await verify(exam.id, { classId: r.classId, subjectId: r.subjectId })
        total += res.verified ?? 0
      }
      toast.success(`Verified ${total} marks across ${toVerify.length} papers`)
      refresh()
    } catch (e) {
      toast.error('Bulk verify failed', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  // Bulk action: lock all verified papers in the filtered view.
  const handleBulkLock = async () => {
    const toLock = filteredSubjectRows.filter((r) => r.status === 'VERIFIED')
    if (toLock.length === 0) { toast.info('No verified papers to lock in the current view'); return }
    setBusy(true)
    try {
      let total = 0
      for (const r of toLock) {
        const res = await lock(exam.id, { classId: r.classId, subjectId: r.subjectId })
        total += res.locked ?? 0
      }
      toast.success(`Locked ${total} marks across ${toLock.length} papers`)
      refresh()
    } catch (e) {
      toast.error('Bulk lock failed', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  // Exam-level declare (the real backend declares per EXAMINATION from Result Ready).
  const handleDeclare = async () => {
    setBusy(true)
    try {
      await declare(exam.id)
      toast.success('Results declared')
      refresh()
    } catch (e) {
      toast.error('Could not declare results', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  // Exam-level publish + notifications (real backend: notify students/parents).
  const handlePublish = async () => {
    setBusy(true)
    try {
      const r = await publish(exam.id, { notifyStudents: true, notifyParents: true })
      setPublishedThisSession(true)
      toast.success(`Results published · ${r.notificationsSent} students notified`)
      refresh()
    } catch (e) {
      toast.error('Could not publish results', { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const bulkVerifyCount = filteredSubjectRows.filter((r) => r.status === 'SUBMITTED').length
  const bulkLockCount = filteredSubjectRows.filter((r) => r.status === 'VERIFIED').length
  const examDeclared = exam.resultStatus === 'Result Declared'
  const readyClasses = classReadiness.filter((c) => c.isReady).length

  // First load — show an honest loader instead of zeroed stats.
  if (marksLoading && allExamMarks.length === 0) {
    return <InlineLoading label="Loading marks from the server…" />
  }

  return (
    <div className="space-y-4">
      {/* Honest error banner — e.g. the exam id doesn't exist in the database. */}
      {marksError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Marks could not be loaded</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {marksError} — the paper list below reflects the examination configuration only; counts and workflow actions need the server.
            </p>
          </div>
        </div>
      )}

      {/* Progress summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Students" value={String(summary.total)} />
        <Stat label="Entered" value={`${summary.entered}/${summary.total}`} pct={summary.pct} />
        <Stat label="Submitted" value={String(summary.submitted)} />
        <Stat label="Verified" value={String(summary.verified)} />
        <Stat label="Locked" value={String(summary.locked)} />
        <Stat label="Papers" value={String(subjectRows.length)} />
      </div>

      {/* Subject-wise progress — paper-level actions with real entered-by teacher */}
      <CollapsibleSection
        title="Subject Progress (per paper)"
        subtitle={`${filteredSubjectRows.length} of ${subjectRows.length} papers`}
        accent="violet"
        actions={
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subject, class, teacher…"
                className="h-6 text-[10px] pl-5 pr-2 rounded bg-transparent border border-border/40 focus:border-primary/40 focus:outline-none w-44"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1"
            >
              <option value="all">All Status</option>
              <option value="LOCKED">Locked</option>
              <option value="VERIFIED">Verified</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DRAFT">Not Started</option>
            </select>
            {hasFilters && (
              <button
                onClick={() => { setSearchQuery(''); setFilterStatus('all') }}
                className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                title="Clear filters"
              >
                <RotateCcw className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        }
      >
        {/* Bulk actions bar */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/40 bg-muted/20">
          <span className="text-[9px] uppercase font-semibold text-muted-foreground">Bulk Actions:</span>
          <button
            onClick={handleBulkVerify}
            disabled={bulkVerifyCount === 0 || busy}
            className={cn(
              'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[9px] font-medium transition-colors',
              bulkVerifyCount > 0 ? 'text-sky-700 dark:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20' : 'text-muted-foreground/40 bg-muted/20 cursor-not-allowed',
            )}
            title={bulkVerifyCount > 0 ? `Verify ${bulkVerifyCount} submitted paper(s)` : 'No submitted papers to verify'}
          >
            <CheckCircle2 className="h-2.5 w-2.5" /> Verify All
            {bulkVerifyCount > 0 && <span className="ml-0.5 px-1 rounded bg-sky-500/20 text-[8px] font-bold">{bulkVerifyCount}</span>}
          </button>
          <button
            onClick={handleBulkLock}
            disabled={bulkLockCount === 0 || busy}
            className={cn(
              'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[9px] font-medium transition-colors',
              bulkLockCount > 0 ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20' : 'text-muted-foreground/40 bg-muted/20 cursor-not-allowed',
            )}
            title={bulkLockCount > 0 ? `Lock ${bulkLockCount} verified paper(s)` : 'No verified papers to lock'}
          >
            <Lock className="h-2.5 w-2.5" /> Lock All
            {bulkLockCount > 0 && <span className="ml-0.5 px-1 rounded bg-emerald-500/20 text-[8px] font-bold">{bulkLockCount}</span>}
          </button>
          <span className="ml-auto text-[9px] text-muted-foreground">
            Applies to {filteredSubjectRows.length} filtered paper(s)
          </span>
        </div>
        <div className="overflow-x-auto max-h-[20rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Entered By</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Entered</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubjectRows.map((r, i) => {
                const enteredPct = r.total > 0 ? Math.round((r.entered / r.total) * 100) : 0
                return (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/40 even:bg-muted/15 transition-colors">
                  <td className="px-2 py-2 text-muted-foreground text-[11px]">{r.className}</td>
                  <td className="px-2 py-2 font-medium text-[11px]">{r.subjectName}</td>
                  <td className="px-2 py-2 text-muted-foreground text-[11px]" title={r.teacher === '—' ? 'No marks entered for this paper yet' : 'Teacher who entered the marks (real data)'}>{r.teacher}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 justify-center">
                      <span className="text-[11px] tabular-nums font-medium">{r.entered}/{r.total}</span>
                      <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', enteredPct === 100 ? 'bg-emerald-500' : enteredPct > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30')}
                          style={{ width: `${enteredPct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <PaperStatusChip status={r.status} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEntryPaper({ classId: r.classId, subjectId: r.subjectId })}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-primary hover:bg-primary/10 transition-colors"
                        title="Enter / review marks for this paper (school-wide authority)"
                      >
                        <Pencil className="h-2.5 w-2.5" /> Enter
                      </button>
                      {r.status === 'IN_PROGRESS' && (
                        <button onClick={() => handleAction('submit', r.classId, r.subjectId)} disabled={busy} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-primary hover:bg-primary/10 transition-colors">
                          <Send className="h-2.5 w-2.5" /> Submit
                        </button>
                      )}
                      {r.status === 'SUBMITTED' && (
                        <button onClick={() => handleAction('verify', r.classId, r.subjectId)} disabled={busy} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-sky-600 hover:bg-sky-500/10 transition-colors">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Verify
                        </button>
                      )}
                      {r.status === 'VERIFIED' && (
                        <button onClick={() => handleAction('lock', r.classId, r.subjectId)} disabled={busy} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-emerald-600 hover:bg-emerald-500/10 transition-colors">
                          <Lock className="h-2.5 w-2.5" /> Lock
                        </button>
                      )}
                      {r.status === 'LOCKED' && (
                        <button
                          disabled
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-muted-foreground/40 cursor-not-allowed"
                          title="Locked papers cannot be reopened — the backend has no unlock endpoint yet"
                        >
                          <Unlock className="h-2.5 w-2.5" /> Unlock
                        </button>
                      )}
                      <button
                        onClick={() => setTimelinePaper({ classId: r.classId, subjectId: r.subjectId })}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="View timeline (real audit log)"
                      >
                        <Clock className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {filteredSubjectRows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">{hasFilters ? `No papers match your filters.` : 'No subjects configured.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Class result readiness — declaration + publish are EXAM-level in the real backend */}
      <CollapsibleSection title="Class Results" subtitle={`${classReadiness.length} classes`} accent="emerald">
        <div className="divide-y divide-border/40">
          {classReadiness.map((c) => (
            <div key={c.classId} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{c.className}</p>
                <p className="text-[9px] text-muted-foreground">
                  {c.lockedPapers}/{c.totalPapers} papers locked
                  {!c.isReady && c.missingPapers.length > 0 && ` · Missing: ${c.missingPapers.map((m: any) => m.subjectName).join(', ')}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.isReady ? (
                  <span className="text-[9px] font-medium text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> Ready</span>
                ) : (
                  <span className="text-[9px] text-amber-600">Pending</span>
                )}
                <button onClick={() => { setClassId(c.classId); setShowResults(true) }} className="text-[9px] text-muted-foreground hover:text-foreground hover:underline">View</button>
              </div>
            </div>
          ))}
          {classReadiness.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">No classes configured.</div>}
          {/* Exam-level declaration + publish — the real workflow operates on the whole examination. */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-muted/20">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Examination results</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                {examDeclared
                  ? 'Results declared — publish to notify students and parents.'
                  : exam.resultStatus === 'Result Ready'
                    ? 'All marks locked — ready to declare.'
                    : `Result status: ${exam.resultStatus} · ${readyClasses}/${classReadiness.length} classes fully locked`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {publishedThisSession ? (
                <span className="text-[9px] font-medium text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> Published</span>
              ) : examDeclared ? (
                <button onClick={handlePublish} disabled={busy} className="text-[9px] text-primary hover:underline flex items-center gap-0.5"><Megaphone className="h-2.5 w-2.5" /> Publish &amp; Notify</button>
              ) : exam.resultStatus === 'Result Ready' ? (
                <button onClick={handleDeclare} disabled={busy} className="text-[9px] text-primary hover:underline flex items-center gap-0.5"><Award className="h-2.5 w-2.5" /> Declare Results</button>
              ) : (
                <span className="text-[9px] text-amber-600" title="Declaration requires every paper to be locked (Result Ready)">Pending</span>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Marks entry drawer (paper drill-down) */}
      {entryPaper && (
        <PaperMarksInline
          exam={exam}
          classId={entryPaper.classId}
          subjectId={entryPaper.subjectId}
          onPaperChanged={refresh}
          onClose={() => setEntryPaper(null)}
        />
      )}

      {/* Paper timeline drawer */}
      {timelinePaper && (
        <PaperTimelineInline
          exam={exam}
          classId={timelinePaper.classId}
          subjectId={timelinePaper.subjectId}
          allMarks={allExamMarks}
          onClose={() => setTimelinePaper(null)}
        />
      )}

      {/* Results view */}
      {showResults && (
        <ResultsInline exam={exam} classId={classId} onClose={() => setShowResults(false)} />
      )}

      {/* Subject analytics */}
      <SubjectAnalytics exam={exam} allMarks={allExamMarks} />
    </div>
  )
}

/** The most frequent non-null enteredBy value across a paper's marks rows. */
function mostFrequentEnteredBy(marks: ExamMarkDTO[]): string | null {
  const counts = new Map<string, number>()
  for (const m of marks) {
    if (!m.enteredBy) continue
    counts.set(m.enteredBy, (counts.get(m.enteredBy) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n }
  }
  return best
}

// ─── Marks entry drawer (one paper: roster + entry + submit) ──────────

function PaperMarksInline({ exam, classId, subjectId, onPaperChanged, onClose }: {
  exam: ExamDTO
  classId: string
  subjectId: string
  onPaperChanged: () => void
  onClose: () => void
}) {
  // Real roster + marks for this paper (GET /api/exams/[id]/marks?classId=&subjectId=).
  const { students, marks, loading, error, reload } = useMarks(exam.id, classId, subjectId)
  const { set } = useSetMark()
  const { submit } = useSubmitMarks()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [rowState, setRowState] = useState<Record<string, { saving: boolean; error: string | null }>>({})
  const [submitting, setSubmitting] = useState(false)

  const subject = exam.subjects.find((s: any) => s.classId === classId && s.subjectId === subjectId)
  const maxMarks = subject?.maxMarks ?? 100
  const className = exam.classes.find((c: any) => c.classId === classId)?.className ?? classId
  const subjectName = subject?.subjectName ?? subjectId

  const markByStudent = useMemo(() => new Map(marks.map((m) => [m.studentId, m])), [marks])
  const paperStatus = paperStatusOf(marks)
  const paperLocked = marks.length > 0 && marks.every((m) => m.workflowStatus === 'LOCKED')
  const enteredCount = marks.filter(isEntered).length
  const hasSubmittable = marks.some((m) => m.workflowStatus === 'DRAFT' && isEntered(m))
  const unsavedCount = students.filter((st) => {
    const raw = drafts[st.id]
    if (raw === undefined) return false
    const m = markByStudent.get(st.id)
    const val = raw.trim() === '' ? null : Number(raw)
    return val !== (m?.marksObtained ?? null)
  }).length

  // Save one student's marks (POST /api/exams/[id]/marks/single).
  const saveMark = async (studentId: string, raw: string) => {
    const existing = markByStudent.get(studentId)
    if (existing?.workflowStatus === 'LOCKED') return
    const trimmed = raw.trim()
    const value: number | null = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > maxMarks)) {
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: `0–${maxMarks}` } }))
      return
    }
    if (existing && existing.marksObtained === value && existing.status === 'PRESENT') {
      setDrafts((d) => { const n = { ...d }; delete n[studentId]; return n })
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: null } }))
      return
    }
    setRowState((s) => ({ ...s, [studentId]: { saving: true, error: null } }))
    try {
      await set(exam.id, { classId, subjectId, studentId, marksObtained: value, status: 'PRESENT' })
      setDrafts((d) => { const n = { ...d }; delete n[studentId]; return n })
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: null } }))
      reload()
      onPaperChanged()
    } catch (e) {
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: errText(e) } }))
    }
  }

  // Save one student's attendance status (absent/medical/exempted → null marks).
  const saveStatus = async (studentId: string, newStatus: MarkStatus) => {
    const existing = markByStudent.get(studentId)
    if (existing?.workflowStatus === 'LOCKED') return
    if (existing?.status === newStatus) return
    setRowState((s) => ({ ...s, [studentId]: { saving: true, error: null } }))
    try {
      await set(exam.id, {
        classId,
        subjectId,
        studentId,
        marksObtained: newStatus === 'PRESENT' ? (existing?.marksObtained ?? null) : null,
        status: newStatus,
      })
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: null } }))
      reload()
      onPaperChanged()
    } catch (e) {
      setRowState((s) => ({ ...s, [studentId]: { saving: false, error: errText(e) } }))
    }
  }

  // Submit the whole paper (DRAFT → SUBMITTED, POST /api/exams/[id]/marks/submit).
  const handleSubmitPaper = async () => {
    if (unsavedCount > 0) {
      toast.info(`${unsavedCount} unsaved entr${unsavedCount === 1 ? 'y' : 'ies'} — save or clear them first`)
      return
    }
    setSubmitting(true)
    try {
      const r = await submit(exam.id, { classId, subjectId })
      toast.success(`Submitted ${r.submitted ?? 0} marks`)
      reload()
      onPaperChanged()
    } catch (e) {
      toast.error('Submit failed', { description: errText(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-card/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            {className} · {subjectName}
            <PaperStatusChip status={paperStatus} />
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">
            Out of {maxMarks} · {enteredCount}/{students.length} entered{paperLocked ? ' · paper locked — read only' : ' · Principal has school-wide entry authority'}
            {unsavedCount > 0 && <span className="text-amber-600"> · {unsavedCount} unsaved</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {submitting && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button
            onClick={handleSubmitPaper}
            disabled={submitting || paperLocked || !hasSubmittable || unsavedCount > 0}
            className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors',
              hasSubmittable && unsavedCount === 0 && !paperLocked
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/40 cursor-not-allowed',
            )}
            title={paperLocked ? 'Paper is locked' : hasSubmittable ? 'Submit this paper (DRAFT → SUBMITTED)' : 'No entered (draft) marks to submit'}
          >
            <Send className="h-2.5 w-2.5" /> Submit Paper
          </button>
          <button onClick={onClose} className="text-[9px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>

      {loading && students.length === 0 ? (
        <InlineLoading label="Loading roster & marks…" />
      ) : error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[10px] text-rose-700 dark:text-rose-300">{error}</div>
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Users className="h-5 w-5 text-muted-foreground mb-2" />
          <p className="text-xs font-medium">No students in this class.</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">The roster appears once students are enrolled.</p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[22rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Roll</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                <th className="text-right px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Marks / {maxMarks}</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {students.map((st) => {
                const m = markByStudent.get(st.id)
                const rowLocked = paperLocked || m?.workflowStatus === 'LOCKED'
                const status = m?.status ?? 'PRESENT'
                const value = drafts[st.id] ?? (m?.marksObtained?.toString() ?? '')
                const rs = rowState[st.id] ?? { saving: false, error: null }
                const invalid = !rowLocked && value.trim() !== '' && status === 'PRESENT' &&
                  (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maxMarks)
                return (
                  <tr key={st.id} className="border-t border-border/40 hover:bg-muted/20 even:bg-muted/10">
                    <td className="px-2 py-1 text-muted-foreground tabular-nums">{st.rollNo ?? '—'}</td>
                    <td className="px-2 py-1 font-medium">{st.name}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          disabled={rowLocked || status !== 'PRESENT'}
                          value={status === 'PRESENT' ? value : ''}
                          placeholder="—"
                          onChange={(e) => setDrafts((d) => ({ ...d, [st.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                          onBlur={(e) => saveMark(st.id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          title={rowLocked ? 'Locked — read only' : status !== 'PRESENT' ? `Marked ${status} — set status to Present to enter marks` : `Marks out of ${maxMarks} — saves on blur/Enter`}
                          className={cn(
                            'h-6 w-16 rounded border bg-transparent text-right px-2 text-[11px] font-semibold tabular-nums focus:outline-none transition-colors',
                            invalid || rs.error ? 'border-destructive bg-destructive/5' : 'border-border/60 focus:border-primary/50',
                            (rowLocked || status !== 'PRESENT') && 'opacity-60 cursor-not-allowed',
                          )}
                        />
                        {rs.saving ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                        ) : rs.error ? (
                          <span className="text-[8px] font-medium text-destructive" title={rs.error}>{rs.error}</span>
                        ) : m?.graceMarks ? (
                          <span className="text-[8px] font-medium text-violet-600" title={`Grace +${m.graceMarks} applied`}>+{m.graceMarks}g</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select
                        value={status}
                        disabled={rowLocked}
                        onChange={(e) => saveStatus(st.id, e.target.value as MarkStatus)}
                        title={rowLocked ? 'Locked — read only' : 'Attendance status for this paper'}
                        className={cn('h-6 text-[10px] rounded bg-transparent border border-border/50 px-1', rowLocked && 'opacity-60 cursor-not-allowed')}
                      >
                        {MARK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <span className="text-[9px] font-medium text-muted-foreground tabular-nums">
                        {m ? m.workflowStatus : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Subject analytics (real marks rows) ──────────────────────────────

function SubjectAnalytics({ exam, allMarks }: { exam: ExamDTO; allMarks: ExamMarkDTO[] }) {
  const [filterClass, setFilterClass] = useState('all')
  const analytics = useMemo(() => {
    const rows: Array<{ className: string; subjectName: string; entered: number; total: number; avg: number; highest: number; lowest: number; passCount: number; failCount: number; absentCount: number; pendingCount: number; pct: number }> = []
    for (const c of exam.classes) {
      if (filterClass !== 'all' && c.classId !== filterClass) continue
      for (const subj of exam.subjects.filter((s: any) => s.classId === c.classId)) {
        const marks = allMarks.filter((m) => m.classId === c.classId && m.subjectId === subj.subjectId)
        const entered = marks.filter((m) => m.marksObtained !== null)
        const total = Math.max(c.studentCount ?? 0, marks.length)
        const values = entered.map((m) => m.marksObtained!)
        const avg = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0
        const highest = values.length > 0 ? Math.max(...values) : 0
        const lowest = values.length > 0 ? Math.min(...values) : 0
        const passLine = subj.passMarks > 0 ? subj.passMarks : subj.maxMarks * 0.33
        const passCount = values.filter((v) => v >= passLine).length
        const failCount = values.filter((v) => v < passLine).length
        const absentCount = marks.filter((m) => m.status === 'ABSENT').length
        const pendingCount = Math.max(0, total - entered.length)
        const pct = total > 0 ? Math.round((entered.length / total) * 100) : 0
        rows.push({ className: c.className, subjectName: subj.subjectName, entered: entered.length, total, avg, highest, lowest, passCount, failCount, absentCount, pendingCount, pct })
      }
    }
    return rows
  }, [exam, allMarks, filterClass])

  return (
    <CollapsibleSection
      title="Subject Analytics"
      subtitle={`${analytics.length} rows`}
      accent="sky"
      actions={
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="h-5 text-[9px] rounded bg-transparent border border-border/40 px-1">
          <option value="all">All Classes</option>
          {exam.classes.map((c: any) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
        </select>
      }
    >
      <div className="overflow-x-auto max-h-[16rem]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="text-left px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Class</th>
              <th className="text-left px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Subject</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Entered</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Avg</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">High</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Low</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Pass</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Fail</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">Absent</th>
              <th className="text-center px-2 py-1 text-[8px] uppercase font-semibold text-muted-foreground">%</th>
            </tr>
          </thead>
          <tbody>
            {analytics.map((r, i) => (
              <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                <td className="px-2 py-1 text-muted-foreground">{r.className}</td>
                <td className="px-2 py-1 font-medium">{r.subjectName}</td>
                <td className="px-2 py-1 text-center tabular-nums">{r.entered}/{r.total}</td>
                <td className="px-2 py-1 text-center tabular-nums">{r.avg}</td>
                <td className="px-2 py-1 text-center tabular-nums text-emerald-600">{r.highest}</td>
                <td className="px-2 py-1 text-center tabular-nums text-rose-600">{r.lowest}</td>
                <td className="px-2 py-1 text-center tabular-nums text-emerald-600">{r.passCount}</td>
                <td className="px-2 py-1 text-center tabular-nums text-rose-600">{r.failCount}</td>
                <td className="px-2 py-1 text-center tabular-nums text-amber-600">{r.absentCount}</td>
                <td className="px-2 py-1 text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${r.pct}%` }} />
                    </div>
                    <span className="text-[8px] tabular-nums">{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {analytics.length === 0 && <tr><td colSpan={10} className="py-4 text-center text-muted-foreground">No data available.</td></tr>}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}

// ─── Results view (server-computed via /api/exams/[id]/results/class/) ─

function ResultsInline({ exam, classId, onClose }: { exam: ExamDTO; classId: string; onClose: () => void }) {
  const { data, loading, error } = useClassResults(exam.id, classId)
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)

  const className = exam.classes.find((c: any) => c.classId === classId)?.className ?? ''
  const subjects = data?.subjects ?? []
  const results = useMemo(() => [...(data?.results ?? [])], [data])
  const selectedResult = results.find((r) => r.studentId === selectedStudent)

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Class Result — {className}</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[9px] gap-1"
            disabled={results.length === 0}
            onClick={() => generateClassResultPDF(exam, className, results.map(toPdfResult))}
          >
            <Download className="h-3 w-3" /> PDF
          </Button>
          <button onClick={onClose} className="text-[9px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
      {loading && !data ? (
        <InlineLoading label="Computing results…" />
      ) : error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[10px] text-rose-700 dark:text-rose-300">{error}</div>
      ) : (
        <div className="overflow-x-auto max-h-[24rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Roll</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                {subjects.map((s) => <th key={s.subjectId} className="text-center px-1 py-1.5 text-[8px] font-semibold text-muted-foreground">{s.subjectName.substring(0, 6)}</th>)}
                <th className="text-right px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Total</th>
                <th className="text-right px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">%</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Grade</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.studentId} className="border-t border-border/40 hover:bg-muted/20 cursor-pointer" onClick={() => setSelectedStudent(r.studentId)}>
                  <td className="px-2 py-1 text-muted-foreground tabular-nums">{r.rollNo ?? '—'}</td>
                  <td className="px-2 py-1 font-medium">{r.studentName} {r.rank != null && r.rank <= 3 && <span className="text-[8px] text-amber-600">#{r.rank}</span>}</td>
                  {subjects.map((s) => {
                    const sr = r.subjects.find((x) => x.subjectId === s.subjectId)
                    return (
                      <td key={s.subjectId} className="px-1 py-1 text-center tabular-nums" title={sr?.isAbsent ? 'Absent' : undefined}>
                        {sr ? (sr.isAbsent ? <span className="text-amber-600">AB</span> : (sr.marksObtained ?? '—')) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-right tabular-nums">{r.totalObtained}/{r.totalMax}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{r.percentage}%</td>
                  <td className="px-2 py-1 text-center font-semibold">{r.grade}</td>
                  <td className="px-2 py-1 text-center"><span className={cn('text-[9px] font-medium', r.passed ? 'text-emerald-600' : 'text-rose-600')}>{r.isAbsentInAll ? 'ABSENT' : r.passed ? 'PASS' : 'FAIL'}</span></td>
                </tr>
              ))}
              {results.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No results available.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {selectedResult && (
        <StudentResultDetail exam={exam} result={selectedResult} onClose={() => setSelectedStudent(null)} />
      )}
    </div>
  )
}

function StudentResultDetail({ exam, result, onClose }: { exam: ExamDTO; result: StudentResult; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{result.studentName}</p>
          <p className="text-[9px] text-muted-foreground">Roll {result.rollNo ?? '—'} · {result.className}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1" onClick={() => generateStudentResultPDF(exam, toPdfResult(result))}>
            <Download className="h-3 w-3" /> PDF
          </Button>
          <button onClick={onClose} className="text-[9px] text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead><tr>
          <th className="text-left text-[9px] uppercase font-semibold text-muted-foreground py-1">Subject</th>
          <th className="text-right text-[9px] uppercase font-semibold text-muted-foreground py-1">Max</th>
          <th className="text-right text-[9px] uppercase font-semibold text-muted-foreground py-1">Obtained</th>
          <th className="text-right text-[9px] uppercase font-semibold text-muted-foreground py-1">%</th>
          <th className="text-center text-[9px] uppercase font-semibold text-muted-foreground py-1">Result</th>
        </tr></thead>
        <tbody>
          {result.subjects.map((s, i: number) => (
            <tr key={i} className="border-t border-border/30">
              <td className="py-1 font-medium">{s.subjectName}</td>
              <td className="py-1 text-right tabular-nums">{s.maxMarks}</td>
              <td className="py-1 text-right tabular-nums">{s.isAbsent ? 'AB' : (s.marksObtained ?? '—')}</td>
              <td className="py-1 text-right tabular-nums">{s.isAbsent ? '—' : `${s.percentage}%`}</td>
              <td className="py-1 text-center">
                <span className={cn('text-[9px] font-medium', s.isAbsent ? 'text-amber-600' : s.passed ? 'text-emerald-600' : 'text-rose-600')}>
                  {s.isAbsent ? 'ABSENT' : s.passed ? 'PASS' : 'FAIL'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 pt-1 border-t border-border/40 flex-wrap">
        <span className="text-[10px] font-semibold">Total: {result.totalObtained}/{result.totalMax}</span>
        <span className="text-[10px] font-semibold">Percentage: {result.percentage}%</span>
        <span className="text-[10px] font-semibold">Grade: {result.grade}</span>
        {result.rank != null && <span className="text-[10px] font-semibold">Rank: {result.rank}</span>}
        <span className={cn('text-[10px] font-semibold', result.passed ? 'text-emerald-600' : 'text-rose-600')}>{result.isAbsentInAll ? 'ABSENT' : result.passed ? 'PASS' : 'FAIL'}</span>
      </div>
    </div>
  )
}

// ─── Paper Timeline (inline drawer — real ExamAuditLog rows) ──────────

/** Real audit actions that carry paper-level information. */
const TIMELINE_ACTIONS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  MARK_ENTERED: { label: 'Marks Entered', icon: <Pencil className="h-3 w-3" />, color: 'text-amber-600' },
  MARK_SUBMITTED: { label: 'Marks Submitted', icon: <Send className="h-3 w-3" />, color: 'text-amber-600' },
  MARK_VERIFIED: { label: 'Marks Verified', icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-blue-600' },
  MARK_LOCKED: { label: 'Marks Locked', icon: <Lock className="h-3 w-3" />, color: 'text-emerald-600' },
  GRACE_APPLIED: { label: 'Grace Applied', icon: <Award className="h-3 w-3" />, color: 'text-violet-600' },
  MARKS_IMPORTED_CSV: { label: 'Marks Imported (CSV)', icon: <FileText className="h-3 w-3" />, color: 'text-violet-600' },
}

/** Does this audit event belong to the given paper (class × subject)? */
function eventMatchesPaper(e: AuditLogDTO, classId: string, subjectId: string, markById: Map<string, ExamMarkDTO>): boolean {
  // Workflow events (submit/verify/lock/CSV import) carry the {classId, subjectId} filter in newValue.
  if (e.newValue) {
    try {
      const nv = JSON.parse(e.newValue)
      if (nv && typeof nv === 'object' && 'classId' in nv) {
        if (nv.classId !== classId) return false
        if (nv.subjectId !== undefined && nv.subjectId !== null && nv.subjectId !== subjectId) return false
        return true
      }
    } catch {
      /* not a JSON filter — fall through to the entityId path */
    }
  }
  // Row-level events (MARK_ENTERED / GRACE_APPLIED) reference the mark row by id.
  if (e.entity === 'MARK' && e.entityId) {
    const m = markById.get(e.entityId)
    return !!m && m.classId === classId && m.subjectId === subjectId
  }
  return false
}

function PaperTimelineInline({ exam, classId, subjectId, allMarks, onClose }: {
  exam: ExamDTO
  classId: string
  subjectId: string
  allMarks: ExamMarkDTO[]
  onClose: () => void
}) {
  // Real audit log (GET /api/exams/[id]/audit) — newest first.
  const { logs, loading } = useAuditLogs(exam.id)
  const markById = useMemo(() => new Map(allMarks.map((m) => [m.id, m])), [allMarks])
  const paperTimeline = useMemo(
    () =>
      logs
        .filter((e) => eventMatchesPaper(e, classId, subjectId, markById))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [logs, classId, subjectId, markById],
  )
  const className = exam.classes.find((c: any) => c.classId === classId)?.className ?? classId
  const subjectName = exam.subjects.find((s: any) => s.classId === classId && s.subjectId === subjectId)?.subjectName ?? subjectId

  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-card/40">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{className} · {subjectName}</p>
          <p className="text-[9px] text-muted-foreground">From the examination audit log · {paperTimeline.length} events</p>
        </div>
        <button onClick={onClose} className="text-[9px] text-muted-foreground hover:text-foreground">Close</button>
      </div>
      {loading && logs.length === 0 ? (
        <InlineLoading label="Loading audit log…" />
      ) : (
        <div className="relative pl-5 space-y-2 max-h-64 overflow-y-auto">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border/60" />
          {paperTimeline.length === 0 && (
            <p className="text-[10px] text-muted-foreground py-2">No timeline events yet. Entry, submit, verify and lock actions on this paper will appear here.</p>
          )}
          {paperTimeline.map((e) => {
            const cfg = TIMELINE_ACTIONS[e.action] ?? { label: e.action, icon: <Clock className="h-3 w-3" />, color: 'text-muted-foreground' }
            return (
              <div key={e.id} className="relative">
                <span className={cn('absolute -left-[14px] top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-card border border-border', cfg.color)}>
                  {cfg.icon}
                </span>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium">{cfg.label}</p>
                    <p className="text-[9px] text-muted-foreground">by {e.userName ?? 'System'}</p>
                    {e.newValue && <p className="text-[9px] text-muted-foreground/80 mt-0.5 font-mono truncate" title={e.newValue}>{summarizeAuditValue(e)}</p>}
                  </div>
                  <span className="text-[9px] text-muted-foreground/70 shrink-0 tabular-nums">
                    {new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A short human summary of the audit payload (no raw JSON dump). */
function summarizeAuditValue(e: AuditLogDTO): string | null {
  if (!e.newValue) return null
  try {
    const nv = JSON.parse(e.newValue)
    if (!nv || typeof nv !== 'object') return null
    if (e.action === 'MARK_ENTERED' && 'marksObtained' in nv) {
      return nv.marksObtained === null ? `status ${nv.status}` : `${nv.marksObtained} marks (${nv.status})`
    }
    if (e.action === 'MARK_SUBMITTED' || e.action === 'MARK_VERIFIED' || e.action === 'MARK_LOCKED') {
      return nv.subjectId ? 'this paper' : 'class-wide'
    }
    if (e.action === 'GRACE_APPLIED' && 'graceMarks' in nv) {
      return `+${nv.graceMarks} grace`
    }
    if (e.action === 'MARKS_IMPORTED_CSV' && 'accepted' in nv) {
      return `${nv.accepted ?? 0} accepted · ${nv.rejected ?? 0} rejected`
    }
    return null
  } catch {
    return null
  }
}
