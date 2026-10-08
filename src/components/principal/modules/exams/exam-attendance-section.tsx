'use client'

/**
 * ExamAttendanceSection — REAL DATA EDITION (Phase 7-F).
 *
 * The examination attendance register, operating on the canonical
 * ExamAttendance rows in the database. No mock store, no localStorage,
 * no fabricated counts.
 *
 * Data flow (all server-authoritative):
 *   · Papers:        exam.schedule (GET /api/exams/[id] — the workspace
 *                    already holds it). A paper = class + subject + date,
 *                    which is exactly the marking unit.
 *   · Roster:        GET /api/students/roster (the principal roster source),
 *                    fetched once when a paper is selected, filtered by the
 *                    paper's classId + ACTIVE status. The raw API payload is
 *                    used — NOT the students store, whose StudentRecord
 *                    remaps classId to a synthetic grade-group key that
 *                    would never match a DB schedule item.
 *   · Attendance:    GET /api/exams/[id]/attendance (every row of the exam),
 *                    filtered client-side per paper scope (classId +
 *                    subjectId + date — the REAL row identity is
 *                    examId + studentId + subjectId + date, @@unique).
 *   · Marking:       POST /api/exams/[id]/attendance — one row per call
 *                    (the zod schema accepts a single object, not an
 *                    array); the section loops and aggregates errors.
 *                    Upsert semantics make re-saves idempotent.
 *   · Auto-mark:     POST /api/exams/[id]/attendance/auto { classId } —
 *                    writes rows for students whose exam MARKS carry a
 *                    non-PRESENT status (ABSENT/MEDICAL/EXEMPTED),
 *                    class-wide (all subjects of the class).
 *
 * Read-only gate (mirrors the marks tab's exam-status gating):
 *   a Completed/Cancelled exam, or one whose results are Declared, renders
 *   the historical rows WITHOUT edit controls — mutations are disabled.
 *
 * NOTE: the GET attendance DTO does not expose `markedBy`, so no author
 * column is rendered (never fabricated).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  MARK_STATUSES,
  type ExamAttendanceDTO,
  type ExamDTO,
  type MarkStatus,
  type ScheduleItemDTO,
} from '@/lib/exams/types'
import {
  useAutoMarkAttendance,
  useExamAttendance,
  useMarkAttendance,
} from '@/lib/exams/use-exams-extended'
import { api } from '@/lib/exams/api-client'
import { formatDateLong } from '@/lib/exams/format-helpers'
import { Stat } from './workspace-shared'
import { InlineLoading } from './inline-loading'

// ─── Local types ───────────────────────────────────────────────────────

interface Props {
  exam: ExamDTO
}

/** One roster student as returned by /api/students/roster (DB ids). */
interface RosterStudent {
  id: string
  name: string
  rollNo: string
}

/** Unsaved per-student edit. `NOT_MARKED` means "no row written". */
type DraftStatus = MarkStatus | 'NOT_MARKED'
interface AttendanceDraft {
  status: DraftStatus
  remarks: string
}

interface SaveFailure {
  id: string
  name: string
  message: string
}

// ─── Constants / helpers ───────────────────────────────────────────────

const NOT_MARKED = 'NOT_MARKED' as const

const STATUS_LABEL: Record<MarkStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  MEDICAL: 'Medical',
  EXEMPTED: 'Exempted',
}

const STATUS_TEXT: Record<DraftStatus, string> = {
  PRESENT: 'text-emerald-600 dark:text-emerald-400',
  ABSENT: 'text-rose-600 dark:text-rose-400',
  MEDICAL: 'text-amber-600 dark:text-amber-400',
  EXEMPTED: 'text-violet-600 dark:text-violet-400',
  NOT_MARKED: 'text-muted-foreground',
}

/** Scope key — the paper identity (class + subject + date). */
const scopeKey = (classId: string, subjectId: string, date: string) =>
  `${classId}|${subjectId}|${date}`

/** Extract an honest message from an ApiError / Error / anything thrown. */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** Roll-sort: numeric roll numbers first ("02" < "10"), name as tiebreak. */
function rosterSort(a: RosterStudent, b: RosterStudent): number {
  const rc = (a.rollNo || 'zz').localeCompare(b.rollNo || 'zz', undefined, { numeric: true })
  return rc !== 0 ? rc : a.name.localeCompare(b.name)
}

/** GET /api/students/roster (canonical principal roster source). */
async function fetchRosterApi(): Promise<{
  students: Array<{ id: string; name: string; rollNo: string | null; classId: string | null; status: string }>
}> {
  return api<{ students: Array<{ id: string; name: string; rollNo: string | null; classId: string | null; status: string }> }>(
    '/api/students/roster',
  )
}

// ─── Section ───────────────────────────────────────────────────────────

export function ExamAttendanceSection({ exam }: Props) {
  // Read-only gate — mirrors the marks tab's exam-status gating, extended
  // to the seeded legacy spellings ("COMPLETED"/"Declared"): a
  // Completed/Cancelled exam, or one whose results are declared, is
  // immutable history — rows render without edit controls.
  const examStatus = exam.status?.toLowerCase() ?? ''
  const resultStatus = exam.resultStatus?.toLowerCase() ?? ''
  const readOnly =
    examStatus === 'completed' ||
    examStatus === 'cancelled' ||
    resultStatus.includes('declared')

  const { attendance, loading: attLoading, error: attError, reload: reloadAttendance } =
    useExamAttendance(exam.id, null)
  const { autoMark, loading: autoLoading } = useAutoMarkAttendance()
  const { mark } = useMarkAttendance()

  // ── Paper list state (the marking unit selector) ────────────────────
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null)
  const [listDate, setListDate] = useState('')
  const [listClass, setListClass] = useState('')
  const [listSearch, setListSearch] = useState('')

  // ── Roster (canonical /api/students/roster, cached per class) ───────
  const [rosterByClass, setRosterByClass] = useState<Map<string, RosterStudent[]> | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const rosterInFlight = useRef(false)

  const fetchRoster = useCallback(
    async (force = false) => {
      if (rosterInFlight.current) return
      if (rosterByClass && !force) return
      rosterInFlight.current = true
      setRosterLoading(true)
      setRosterError(null)
      try {
        // One silent retry — transient connection blips (dev hot-reload /
        // gateway restart) must not force the user into the error state.
        let payload: Awaited<ReturnType<typeof fetchRosterApi>>
        try {
          payload = await fetchRosterApi()
        } catch {
          await new Promise((r) => setTimeout(r, 500))
          payload = await fetchRosterApi()
        }
        const map = new Map<string, RosterStudent[]>()
        for (const s of payload.students ?? []) {
          if (s.status !== 'ACTIVE' || !s.classId) continue
          const arr = map.get(s.classId) ?? []
          arr.push({ id: s.id, name: s.name, rollNo: s.rollNo ?? '' })
          map.set(s.classId, arr)
        }
        for (const arr of map.values()) arr.sort(rosterSort)
        setRosterByClass(map)
      } catch (e) {
        setRosterError(errText(e))
      } finally {
        rosterInFlight.current = false
        setRosterLoading(false)
      }
    },
    [rosterByClass],
  )

  // ── Papers (exam.schedule — real schedule items) ────────────────────
  const papers = useMemo(
    () =>
      [...exam.schedule]
        .filter((p) => !!p.date)
        .sort((a, b) =>
          a.date === b.date
            ? a.startTime.localeCompare(b.startTime) || a.subjectName.localeCompare(b.subjectName)
            : a.date.localeCompare(b.date),
        ),
    [exam.schedule],
  )

  const dateOptions = useMemo(() => [...new Set(papers.map((p) => p.date))], [papers])
  const classOptions = useMemo(
    () => [...exam.classes].sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })),
    [exam.classes],
  )

  const visiblePapers = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    return papers.filter((p) => {
      if (listDate && p.date !== listDate) return false
      if (listClass && p.classId !== listClass) return false
      if (q && !`${p.subjectName} ${p.className}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [papers, listDate, listClass, listSearch])

  const groupedPapers = useMemo(() => {
    const map = new Map<string, ScheduleItemDTO[]>()
    for (const p of visiblePapers) {
      const arr = map.get(p.date) ?? []
      arr.push(p)
      map.set(p.date, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visiblePapers])

  // Per-paper REAL marked counts from the attendance rows.
  const rowsByScope = useMemo(() => {
    const map = new Map<string, ExamAttendanceDTO[]>()
    for (const r of attendance) {
      const k = scopeKey(r.classId, r.subjectId, r.date)
      const arr = map.get(k) ?? []
      arr.push(r)
      map.set(k, arr)
    }
    return map
  }, [attendance])

  // ── Selected paper scope ────────────────────────────────────────────
  const paper = selectedPaperId ? papers.find((p) => p.id === selectedPaperId) ?? null : null

  const scopeRows = useMemo(
    () =>
      paper
        ? attendance.filter(
            (r) => r.classId === paper.classId && r.subjectId === paper.subjectId && r.date === paper.date,
          )
        : [],
    [attendance, paper],
  )
  const rowByStudent = useMemo(() => new Map(scopeRows.map((r) => [r.studentId, r])), [scopeRows])

  const roster = useMemo(
    () => (paper ? rosterByClass?.get(paper.classId) ?? [] : []),
    [paper, rosterByClass],
  )

  // Load the roster once when the first paper is selected.
  useEffect(() => {
    if (paper) void fetchRoster()
  }, [paper, fetchRoster])

  // ── Drafts (unsaved edits — never a fabricated server state) ────────
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({})
  const [saving, setSaving] = useState(false)
  const [saveFailures, setSaveFailures] = useState<SaveFailure[]>([])
  const [autoNote, setAutoNote] = useState<string | null>(null)

  // Reset drafts/errors whenever the scope changes.
  useEffect(() => {
    setDrafts({})
    setSaveFailures([])
    setAutoNote(null)
  }, [selectedPaperId])

  /** Current view value for a student: draft → saved row → NOT_MARKED. */
  const statusOf = useCallback(
    (studentId: string): DraftStatus =>
      drafts[studentId]?.status ?? rowByStudent.get(studentId)?.status ?? NOT_MARKED,
    [drafts, rowByStudent],
  )
  const remarksOf = useCallback(
    (studentId: string): string => drafts[studentId]?.remarks ?? rowByStudent.get(studentId)?.remarks ?? '',
    [drafts, rowByStudent],
  )

  const isDirty = useCallback(
    (studentId: string): boolean => {
      const d = drafts[studentId]
      if (!d) return false
      const existing = rowByStudent.get(studentId)
      return d.status !== (existing?.status ?? NOT_MARKED) || d.remarks.trim() !== (existing?.remarks ?? '')
    },
    [drafts, rowByStudent],
  )

  const dirtyCount = useMemo(() => roster.filter((s) => isDirty(s.id)).length, [roster, isDirty])

  const setDraftStatus = useCallback(
    (studentId: string, status: DraftStatus) => {
      setDrafts((d) => ({
        ...d,
        [studentId]: {
          status,
          remarks: d[studentId]?.remarks ?? rowByStudent.get(studentId)?.remarks ?? '',
        },
      }))
    },
    [rowByStudent],
  )

  const setDraftRemarks = useCallback(
    (studentId: string, remarks: string) => {
      setDrafts((d) => ({
        ...d,
        [studentId]: {
          status: d[studentId]?.status ?? rowByStudent.get(studentId)?.status ?? NOT_MARKED,
          remarks: remarks.slice(0, 500),
        },
      }))
    },
    [rowByStudent],
  )

  /** Draft-only convenience: unmarked students → Present (nothing saved). */
  const markUnmarkedPresent = useCallback(() => {
    const next: Record<string, AttendanceDraft> = {}
    for (const s of roster) {
      if (statusOf(s.id) === NOT_MARKED) next[s.id] = { status: 'PRESENT', remarks: '' }
    }
    const count = Object.keys(next).length
    if (count === 0) {
      toast.info('Everyone in this register is already marked')
      return
    }
    setDrafts((d) => ({ ...d, ...next }))
  }, [roster, statusOf])

  // ── Save (POST one row per student; loop + error aggregation) ───────
  const handleSave = useCallback(async () => {
    if (!paper || readOnly || saving) return
    const pending = roster.filter((s) => isDirty(s.id))
    if (pending.length === 0) {
      toast.info('No unsaved changes in this register')
      return
    }
    setSaving(true)
    setSaveFailures([])
    const failures: SaveFailure[] = []
    let saved = 0
    for (const s of pending) {
      const d = drafts[s.id]
      if (!d || d.status === NOT_MARKED) {
        // Guarded in the UI (no "not marked" option once a row exists),
        // but stay honest if it ever happens.
        if (rowByStudent.get(s.id)) {
          failures.push({
            id: s.id,
            name: s.name,
            message: 'Cannot un-mark a saved row — choose a status instead',
          })
        }
        continue
      }
      try {
        await mark(exam.id, {
          scheduleItemId: paper.id,
          classId: paper.classId,
          studentId: s.id,
          subjectId: paper.subjectId,
          date: paper.date,
          status: d.status,
          remarks: d.remarks,
        })
        saved++
      } catch (e) {
        failures.push({ id: s.id, name: s.name, message: errText(e) })
      }
    }
    setSaving(false)
    if (saved > 0) {
      // Upsert semantics — a re-save of the same rows is safe. Refetch so
      // the register reflects the server (drafts equal the new rows, so
      // the dirty badge drops on arrival; nothing is faked locally).
      void reloadAttendance()
      toast.success(`Saved ${saved} attendance row${saved === 1 ? '' : 's'}`, {
        description: `${paper.className} · ${paper.subjectName} · ${formatDateLong(paper.date)} — server upsert, safe to re-save.`,
      })
    }
    if (failures.length > 0) {
      setSaveFailures(failures)
      toast.error(`${failures.length} row${failures.length === 1 ? '' : 's'} failed to save`, {
        description: `${failures[0].name}: ${failures[0].message}`,
      })
    }
  }, [paper, readOnly, saving, roster, isDirty, drafts, rowByStudent, mark, exam.id, reloadAttendance])

  // ── Auto-mark from exam marks (class-wide) ──────────────────────────
  const handleAutoMark = useCallback(async () => {
    if (!paper || readOnly || autoLoading) return
    try {
      const r = await autoMark(exam.id, paper.classId)
      const marked = r?.marked ?? 0
      setAutoNote(
        marked > 0
          ? `Auto-marked ${marked} row${marked === 1 ? '' : 's'} from exam marks (${paper.className}, all subjects).`
          : 'Nothing to auto-mark — no ABSENT / MEDICAL / EXEMPTED exam marks found for this class yet.',
      )
      if (marked > 0) {
        void reloadAttendance()
        toast.success(`Auto-marked ${marked} row${marked === 1 ? '' : 's'} from exam marks`)
      } else {
        toast.info('No rows to auto-mark', {
          description: 'Auto-mark writes attendance only for students with a non-Present mark status.',
        })
      }
    } catch (e) {
      toast.error('Auto-mark failed', { description: errText(e) })
    }
  }, [paper, readOnly, autoLoading, autoMark, exam.id, reloadAttendance])

  // ── Exam-level summary — REAL counts from actual marked rows ────────
  const summary = useMemo(() => {
    const counts: Record<MarkStatus, number> = { PRESENT: 0, ABSENT: 0, MEDICAL: 0, EXEMPTED: 0 }
    for (const r of attendance) {
      if (r.status in counts) counts[r.status]++
    }
    return counts
  }, [attendance])

  const handleBack = () => setSelectedPaperId(null)

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* A. Summary bar — every number is a real server count */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Papers" value={String(papers.length)} />
        <Stat label="Classes" value={String(exam.classes.length)} />
        <Stat label="Marked Rows" value={String(attendance.length)} />
        <Stat label="Present" value={String(summary.PRESENT)} />
        <Stat label="Absent" value={String(summary.ABSENT)} />
        <Stat label="Med/Exempt" value={`${summary.MEDICAL}/${summary.EXEMPTED}`} />
      </div>
      {attLoading && (
        <p className="text-[9px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Refreshing attendance from the server…
        </p>
      )}

      {/* B. Honest error banner (server-level) */}
      {attError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2"
        >
          <AlertCircle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Attendance could not be loaded</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{attError}</p>
          </div>
        </div>
      )}

      {/* C. Read-only banner (Completed / Declared) */}
      {readOnly && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
          <Clock className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Read-only register — examination {examStatus || 'completed'}
              {resultStatus.includes('declared') ? ' · results declared' : ''}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Historical attendance rows are viewable; marking is disabled for completed examinations.
            </p>
          </div>
        </div>
      )}

      {/* D. Scope: paper list or the selected register */}
      {paper ? (
        <PaperRegister
          paper={paper}
          roster={roster}
          rosterLoading={rosterLoading}
          rosterError={rosterError}
          onRetryRoster={() => void fetchRoster(true)}
          rows={scopeRows}
          statusOf={statusOf}
          remarksOf={remarksOf}
          dirty={isDirty}
          onSetStatus={setDraftStatus}
          onSetRemarks={setDraftRemarks}
          readOnly={readOnly}
          saving={saving}
          dirtyCount={dirtyCount}
          saveFailures={saveFailures}
          autoNote={autoNote}
          autoLoading={autoLoading}
          onSave={() => void handleSave()}
          onAutoMark={() => void handleAutoMark()}
          onMarkUnmarkedPresent={markUnmarkedPresent}
          onBack={handleBack}
        />
      ) : papers.length === 0 ? (
        <div className="rounded-lg border border-border/60 p-6 text-center">
          <Calendar className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs font-medium">No papers scheduled</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Attendance is marked per scheduled paper (class · subject · date). Add schedule items first.
          </p>
        </div>
      ) : (
        <PaperList
          grouped={groupedPapers}
          dateOptions={dateOptions}
          classOptions={classOptions.map((c) => ({ value: c.classId, label: c.className }))}
          rowsByScope={rowsByScope}
          listDate={listDate}
          listClass={listClass}
          listSearch={listSearch}
          onListDate={setListDate}
          onListClass={setListClass}
          onListSearch={setListSearch}
          onSelect={setSelectedPaperId}
        />
      )}
    </div>
  )
}

// ─── Paper list (scope selector) ───────────────────────────────────────

interface PaperListProps {
  grouped: Array<[string, ScheduleItemDTO[]]>
  dateOptions: string[]
  classOptions: Array<{ value: string; label: string }>
  rowsByScope: Map<string, ExamAttendanceDTO[]>
  listDate: string
  listClass: string
  listSearch: string
  onListDate: (v: string) => void
  onListClass: (v: string) => void
  onListSearch: (v: string) => void
  onSelect: (paperId: string) => void
}

function PaperList({
  grouped,
  dateOptions,
  classOptions,
  rowsByScope,
  listDate,
  listClass,
  listSearch,
  onListDate,
  onListClass,
  onListSearch,
  onSelect,
}: PaperListProps) {
  const anyFilter = !!(listDate || listClass || listSearch.trim())
  const total = grouped.reduce((acc, [, items]) => acc + items.length, 0)

  return (
    <div className="space-y-3">
      {/* Filters — native selects, keyboard + mobile friendly */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
          <input
            type="text"
            value={listSearch}
            onChange={(e) => onListSearch(e.target.value)}
            placeholder="Search subject or class…"
            aria-label="Search papers"
            className="h-7 text-[10px] pl-5 pr-2 rounded bg-transparent border border-border/40 focus:border-primary/40 focus:outline-none w-44"
          />
        </div>
        <label className="flex items-center gap-1 text-[9px] uppercase font-semibold text-muted-foreground">
          Date
          <select
            value={listDate}
            onChange={(e) => onListDate(e.target.value)}
            className="h-7 text-[10px] rounded bg-transparent border border-border/40 px-1"
          >
            <option value="">All Dates</option>
            {dateOptions.map((d) => (
              <option key={d} value={d}>
                {formatDateLong(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[9px] uppercase font-semibold text-muted-foreground">
          Class
          <select
            value={listClass}
            onChange={(e) => onListClass(e.target.value)}
            className="h-7 text-[10px] rounded bg-transparent border border-border/40 px-1"
          >
            <option value="">All Classes</option>
            {classOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {anyFilter && (
          <button
            onClick={() => { onListSearch(''); onListDate(''); onListClass('') }}
            className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            title="Clear filters"
          >
            <RefreshCw className="h-2.5 w-2.5" /> Clear
          </button>
        )}
        <span className="text-[9px] text-muted-foreground ml-auto">
          {total} paper{total === 1 ? '' : 's'} · marked counts are live server rows
        </span>
      </div>

      {/* Grouped list */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-y-auto max-h-[26rem]">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <div className="px-3 py-1.5 bg-muted/40 border-b border-border/40 sticky top-0 z-10">
                <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {formatDateLong(date)}
                </p>
              </div>
              {items.map((p) => {
                const marked = rowsByScope.get(scopeKey(p.classId, p.subjectId, p.date))?.length ?? 0
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelect(p.id)}
                    aria-label={`Open attendance register for ${p.className} ${p.subjectName} on ${formatDateLong(p.date)}`}
                    className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30 border-b border-border/30 last:border-b-0 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {p.subjectName} · <span className="text-muted-foreground">{p.className}</span>
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate">
                        {p.startTime}–{p.endTime}
                        {p.room ? ` · ${p.room}` : ''}
                        {p.invigilatorName ? ` · Invigilator: ${p.invigilatorName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'text-[9px] font-medium tabular-nums',
                          marked > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60',
                        )}
                        title="Attendance rows already recorded for this paper (server count)"
                      >
                        {marked} marked
                      </span>
                      <span className="text-[9px] text-primary font-medium whitespace-nowrap">Open Register →</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No papers match the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Paper register (marking grid for one scope) ───────────────────────

interface PaperRegisterProps {
  paper: ScheduleItemDTO
  roster: RosterStudent[]
  rosterLoading: boolean
  rosterError: string | null
  onRetryRoster: () => void
  rows: ExamAttendanceDTO[]
  statusOf: (studentId: string) => DraftStatus
  remarksOf: (studentId: string) => string
  dirty: (studentId: string) => boolean
  onSetStatus: (studentId: string, status: DraftStatus) => void
  onSetRemarks: (studentId: string, remarks: string) => void
  readOnly: boolean
  saving: boolean
  dirtyCount: number
  saveFailures: SaveFailure[]
  autoNote: string | null
  autoLoading: boolean
  onSave: () => void
  onAutoMark: () => void
  onMarkUnmarkedPresent: () => void
  onBack: () => void
}

function PaperRegister({
  paper,
  roster,
  rosterLoading,
  rosterError,
  onRetryRoster,
  rows,
  statusOf,
  remarksOf,
  dirty,
  onSetStatus,
  onSetRemarks,
  readOnly,
  saving,
  dirtyCount,
  saveFailures,
  autoNote,
  autoLoading,
  onSave,
  onAutoMark,
  onMarkUnmarkedPresent,
  onBack,
}: PaperRegisterProps) {
  // Scope summary — counts from ACTUAL marked rows only.
  const markedCount = rows.length
  const savedCounts: Record<MarkStatus, number> = { PRESENT: 0, ABSENT: 0, MEDICAL: 0, EXEMPTED: 0 }
  for (const r of rows) if (r.status in savedCounts) savedCounts[r.status]++
  const unmarkedCount = Math.max(0, roster.length - markedCount)
  const studentsWithRows = useMemo(() => new Set(rows.map((r) => r.studentId)), [rows])
  // Saved rows whose student is no longer in the class roster (archived /
  // transferred) — counted in the scope summary, but not editable here.
  const orphanRows = useMemo(() => {
    const rosterIds = new Set(roster.map((s) => s.id))
    return rows.filter((r) => !rosterIds.has(r.studentId))
  }, [rows, roster])

  return (
    <div className="space-y-3">
      {/* Back + scope header */}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 px-2" onClick={onBack}>
          <ChevronLeft className="h-3 w-3" /> Back to papers
        </Button>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {roster.length} student{roster.length === 1 ? '' : 's'} in roster
        </span>
      </div>

      <div className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-1.5">
        <div>
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Exam Attendance</p>
          <h3 className="text-sm font-semibold">
            {paper.subjectName} · <span className="text-muted-foreground font-normal">{paper.className}</span>
          </h3>
          <p className="text-[10px] text-muted-foreground">
            {formatDateLong(paper.date)} · {paper.startTime}–{paper.endTime}
            {paper.room ? ` · ${paper.room}` : ''}
            {paper.invigilatorName ? ` · Invigilator: ${paper.invigilatorName}` : ''}
          </p>
        </div>
        {/* Saved-row summary (real server rows) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Users className="h-3 w-3" /> {roster.length > 0 ? `${roster.length} in register` : 'Roster…'}
          </span>
          <span className="font-medium">{markedCount} marked</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">{savedCounts.PRESENT} present</span>
          <span className="text-rose-600 dark:text-rose-400 font-medium">{savedCounts.ABSENT} absent</span>
          {savedCounts.MEDICAL > 0 && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">{savedCounts.MEDICAL} medical</span>
          )}
          {savedCounts.EXEMPTED > 0 && (
            <span className="text-violet-600 dark:text-violet-400 font-medium">{savedCounts.EXEMPTED} exempted</span>
          )}
          <span className="text-muted-foreground">{unmarkedCount} not marked</span>
        </div>
      </div>

      {/* Roster fetch states */}
      {rosterLoading && <InlineLoading label="Loading class roster from the server…" />}
      {rosterError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between gap-2"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Class roster could not be loaded</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{rosterError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0" onClick={onRetryRoster}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* Auto-mark result (honest server response) */}
      {autoNote && (
        <div
          role="status"
          className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[10px] text-sky-700 dark:text-sky-300 flex items-center gap-1.5"
        >
          <Sparkles className="h-3 w-3 shrink-0" /> {autoNote}
        </div>
      )}

      {/* Save failures (server error surfaced, no local fake success) */}
      {saveFailures.length > 0 && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> {saveFailures.length} row{saveFailures.length === 1 ? '' : 's'} failed to save
          </p>
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            {saveFailures.slice(0, 5).map((f) => (
              <li key={f.id} className="truncate">
                <span className="font-medium text-foreground">{f.name}</span> — {f.message}
              </li>
            ))}
            {saveFailures.length > 5 && <li>…and {saveFailures.length - 5} more</li>}
          </ul>
        </div>
      )}

      {/* Actions (hidden in read-only mode) */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1"
            onClick={onMarkUnmarkedPresent}
            disabled={saving}
            title="Set unsaved drafts to Present for students without a saved row (nothing is written until Save)"
          >
            <Check className="h-3 w-3" /> Mark Unmarked Present
          </Button>
          <Button
            size="sm"
            className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto"
            onClick={onSave}
            disabled={saving || dirtyCount === 0}
            title={dirtyCount === 0 ? 'No unsaved changes' : 'Save every changed row to the server (upsert)'}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} Row${dirtyCount === 1 ? '' : 's'}` : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1 border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10"
            onClick={onAutoMark}
            disabled={autoLoading || saving}
            title="Class-wide: writes attendance rows for every student whose exam MARKS carry an ABSENT / MEDICAL / EXEMPTED status (all subjects of this class)"
          >
            {autoLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Auto-mark from Marks
          </Button>
        </div>
      )}

      {/* Roster grid */}
      {!rosterLoading && !rosterError && roster.length === 0 && (
        <div className="rounded-lg border border-border/60 p-4 text-center text-xs text-muted-foreground">
          No active students in this class roster.
        </div>
      )}
      {roster.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="w-full text-xs min-w-[34rem]">
              <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground w-14">Roll</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                  <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground w-36">Status</th>
                  <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((st) => {
                  const status = statusOf(st.id)
                  const remarks = remarksOf(st.id)
                  const hasRow = studentsWithRows.has(st.id)
                  const isDirtyRow = dirty(st.id)
                  return (
                    <tr
                      key={st.id}
                      className={cn(
                        'border-t border-border/30 hover:bg-muted/20',
                        isDirtyRow && 'bg-amber-500/5',
                      )}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{st.rollNo || '—'}</td>
                      <td className="px-2 py-1.5 font-medium">
                        {st.name}
                        {isDirtyRow && (
                          <span className="ml-1.5 text-[8px] font-semibold text-amber-600 dark:text-amber-400" title="Unsaved edit">
                            •
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {readOnly ? (
                          <span className={cn('text-[10px] font-medium', STATUS_TEXT[status])}>
                            {status === NOT_MARKED ? 'Not Marked' : STATUS_LABEL[status]}
                          </span>
                        ) : (
                          <select
                            value={status}
                            disabled={saving}
                            onChange={(e) => onSetStatus(st.id, e.target.value as DraftStatus)}
                            aria-label={`Attendance status for ${st.name}`}
                            title={
                              hasRow
                                ? 'Saved rows can be corrected but not un-marked (server upsert)'
                                : 'Choose a status to write a row on Save'
                            }
                            className={cn(
                              'h-6 text-[10px] rounded bg-transparent border px-1',
                              status === 'ABSENT'
                                ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
                                : status === 'PRESENT'
                                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                  : 'border-border/50',
                            )}
                          >
                            {/* No "not marked" option once a row exists —
                                rows can be corrected, never deleted. */}
                            {!hasRow && <option value={NOT_MARKED}>— Not Marked —</option>}
                            {MARK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {readOnly ? (
                          <span className="text-[10px] text-muted-foreground">{remarks || '—'}</span>
                        ) : (
                          <input
                            type="text"
                            value={remarks}
                            maxLength={500}
                            disabled={saving || status === NOT_MARKED}
                            onChange={(e) => onSetRemarks(st.id, e.target.value)}
                            placeholder={status === NOT_MARKED ? 'Mark a status first' : 'Optional note (max 500 chars)'}
                            aria-label={`Remarks for ${st.name}`}
                            className="h-6 w-full max-w-[16rem] rounded border border-border/50 bg-transparent px-2 text-[10px] focus:outline-none focus:border-primary/40 disabled:opacity-50"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Orphan rows — honest disclosure so the marked count reconciles */}
      {orphanRows.length > 0 && (
        <p className="text-[9px] text-amber-600 dark:text-amber-400">
          {orphanRows.length} saved row{orphanRows.length === 1 ? '' : 's'} for students no longer in this
          class roster ({orphanRows.map((r) => r.studentName || r.studentId).slice(0, 5).join(', ')}
          {orphanRows.length > 5 ? '…' : ''}) — included in the marked count above.
        </p>
      )}

      {/* Identity note */}
      <p className="text-[9px] text-muted-foreground">
        Rows are identified by exam + student + subject + date (server upsert) — re-saving the same register is safe.
        {!readOnly && ' Unmarked students write no row until a status is chosen and saved.'}
      </p>
    </div>
  )
}
