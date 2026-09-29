'use client'

/**
 * ExamAttendanceSection — Principal's examination attendance workspace.
 *
 * Implements the full invigilator workflow:
 *   Scheduled → Ready → In Progress → Submitted → Reviewed
 *
 * Sessions are derived from the exam schedule (one session per schedule
 * item). Invigilator identity comes from the invigilator store
 * (auto-assigned during initAttendance). The Principal can always
 * enter / edit / submit — there is no role gate.
 *
 * Recording: byRole='PRINCIPAL', byName='Principal'. When submitSession()
 * is called, the mock audit store automatically records an
 * ATTENDANCE_SUBMITTED event — no separate audit call is needed here.
 *
 * Sections:
 *   A. Summary bar         (always visible)
 *   B. Filters             (always visible)
 *   C. Exam sessions list  (CollapsibleSection, default open)
 *   D. Session detail      (replaces list when a session is selected)
 *   E. Room-wise analysis  (CollapsibleSection, default collapsed)
 *   F. Class-wise analysis (CollapsibleSection, default collapsed)
 *   G. Subject-wise analysis (CollapsibleSection, default collapsed)
 */

import { useState, useMemo, useEffect } from 'react'
import {
  Check, X, Clock, Send, Users, Calendar, MapPin, ChevronLeft,
  UserCheck, Building2, BookOpen, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ExamDTO } from '@/lib/exams/types'
import {
  useMockAttendanceStore,
  computeGateStatus,
  computeAttendanceOpenAt,
  type AttendanceStatus,
  type SessionGateStatus,
  type ExamSession,
  type ExamAttendanceRecord,
} from '@/lib/exams/mock-attendance-data'
import { useStudentsStore } from '@/lib/store/students-store'
import { formatDateLong, parseLocalDate } from '@/lib/exams/format-helpers'
import { CollapsibleSection } from './collapsible-section'

interface Props {
  exam: ExamDTO
}

// Status pill colours: Scheduled=slate, Ready=amber, In Progress=blue,
// Submitted=emerald, Reviewed=violet.
const STATUS_PILL: Record<SessionGateStatus, string> = {
  Scheduled: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  Ready: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  'In Progress': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  Submitted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  Reviewed: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_LONG = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

/** Render a date header like "21 AUGUST 2025 — Thursday". */
function dateHeaderLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()} — ${WEEKDAYS[d.getDay()]}`
}

/** Format an ISO timestamp as "09:47 AM" (en-IN locale). */
function formatTime12(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function ExamAttendanceSection({ exam }: Props) {
  // Stable Zustand selectors — never filter inside the selector.
  const records = useMockAttendanceStore((s) => s.records)
  const sessions = useMockAttendanceStore((s) => s.sessions)
  const initAttendance = useMockAttendanceStore((s) => s.initAttendance)
  const submitSession = useMockAttendanceStore((s) => s.submitSession)
  const reviewSession = useMockAttendanceStore((s) => s.reviewSession)
  const markStatus = useMockAttendanceStore((s) => s.markStatus)
  const markAllPresent = useMockAttendanceStore((s) => s.markAllPresent)

  const allStudents = useStudentsStore((s) => s.students)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [filters, setFilters] = useState<{
    date: string; cls: string; subject: string; room: string; invig: string; status: string
  }>({ date: '', cls: '', subject: '', room: '', invig: '', status: '' })

  // Initialize attendance (one-time) when the exam loads.
  useEffect(() => {
    if (!exam || exam.classes.length === 0 || exam.schedule.length === 0) return
    const students = allStudents
      .filter((s) => exam.classes.some((c) => c.classId === s.classId) && s.status === 'Active')
      .map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, classId: s.classId, className: s.className }))
    if (students.length > 0) initAttendance(exam, students)
  }, [exam, allStudents, initAttendance])

  // Exam-scoped sessions + records.
  const examSessions = useMemo(
    () => sessions.filter((s) => s.examId === exam.id),
    [sessions, exam.id],
  )
  const examRecords = useMemo(
    () => records.filter((r) => r.examId === exam.id),
    [records, exam.id],
  )

  // Filter option sets derived from sessions.
  const filterOptions = useMemo(() => {
    const dates = new Map<string, string>()
    const classes = new Map<string, string>()
    const subjects = new Map<string, string>()
    const rooms = new Map<string, string>()
    const invigs = new Map<string, string>()
    for (const s of examSessions) {
      dates.set(s.date, formatDateLong(s.date))
      classes.set(s.classId, s.className)
      subjects.set(s.subjectId, s.subjectName)
      rooms.set(s.roomId, s.roomName)
      if (s.invigilatorId && s.invigilatorName) invigs.set(s.invigilatorId, s.invigilatorName)
    }
    const sortByLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1])
    return {
      dates: [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      classes: [...classes.entries()].sort(sortByLabel),
      subjects: [...subjects.entries()].sort(sortByLabel),
      rooms: [...rooms.entries()].sort(sortByLabel),
      invigs: [...invigs.entries()].sort(sortByLabel),
    }
  }, [examSessions])

  // AND-filter across all six dimensions.
  const filteredSessions = useMemo(() => {
    return examSessions
      .filter((s) => {
        if (filters.date && s.date !== filters.date) return false
        if (filters.cls && s.classId !== filters.cls) return false
        if (filters.subject && s.subjectId !== filters.subject) return false
        if (filters.room && s.roomId !== filters.room) return false
        if (filters.invig && s.invigilatorId !== filters.invig) return false
        if (filters.status && computeGateStatus(s) !== filters.status) return false
        return true
      })
      .sort((a, b) => {
        const dc = a.date.localeCompare(b.date)
        if (dc !== 0) return dc
        return a.startTime.localeCompare(b.startTime)
      })
  }, [examSessions, filters])

  const anyFilterActive = !!(filters.date || filters.cls || filters.subject || filters.room || filters.invig || filters.status)

  // Summary card numbers.
  const summary = useMemo(() => {
    const total = examRecords.length
    const present = examRecords.filter((r) => r.status === 'PRESENT').length
    const absent = examRecords.filter((r) => r.status === 'ABSENT').length
    const pending = examRecords.filter((r) => r.status === 'NOT_MARKED').length
    const submitted = examSessions.filter((s) => computeGateStatus(s) === 'Submitted').length
    return { total, present, absent, pending, sessions: examSessions.length, submitted }
  }, [examRecords, examSessions])

  // Group sessions by date.
  const grouped = useMemo(() => {
    const map = new Map<string, ExamSession[]>()
    for (const s of filteredSessions) {
      const arr = map.get(s.date) ?? []
      arr.push(s)
      map.set(s.date, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredSessions])

  const selectedSession = examSessions.find((s) => s.id === selectedSessionId) ?? null

  const sessionRecords = useMemo(
    () => selectedSession
      ? examRecords.filter((r) => r.scheduleItemId === selectedSession.scheduleItemId)
      : [],
    [examRecords, selectedSession],
  )

  const handleSubmit = (sessionId: string) => {
    const result = submitSession(sessionId, 'PRINCIPAL', 'Principal')
    if (!result.ok) {
      toast.error(`${result.pendingCount} student${result.pendingCount === 1 ? '' : 's'} still unmarked`)
      return
    }
    toast.success('Attendance submitted')
  }

  const handleReview = (sessionId: string) => {
    reviewSession(sessionId)
    toast.success('Session marked as reviewed')
  }

  return (
    <div className="space-y-4">
      {/* A. Summary bar */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <AttStat icon={<Calendar className="h-3 w-3" />} label="Sessions" value={String(summary.sessions)} />
        <AttStat icon={<Users className="h-3 w-3" />} label="Students" value={String(summary.total)} />
        <AttStat icon={<Check className="h-3 w-3" />} label="Present" value={String(summary.present)} accent="emerald" />
        <AttStat icon={<X className="h-3 w-3" />} label="Absent" value={String(summary.absent)} accent="rose" />
        <AttStat icon={<Clock className="h-3 w-3" />} label="Pending" value={String(summary.pending)} accent="amber" />
        <AttStat icon={<Send className="h-3 w-3" />} label="Submitted" value={String(summary.submitted)} accent="sky" />
      </div>

      {/* B. Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Date" value={filters.date} options={filterOptions.dates} allLabel="All Dates" onChange={(v) => setFilters((f) => ({ ...f, date: v }))} />
        <FilterSelect label="Class" value={filters.cls} options={filterOptions.classes} allLabel="All Classes" onChange={(v) => setFilters((f) => ({ ...f, cls: v }))} />
        <FilterSelect label="Subject" value={filters.subject} options={filterOptions.subjects} allLabel="All Subjects" onChange={(v) => setFilters((f) => ({ ...f, subject: v }))} />
        <FilterSelect label="Room" value={filters.room} options={filterOptions.rooms} allLabel="All Rooms" onChange={(v) => setFilters((f) => ({ ...f, room: v }))} />
        <FilterSelect label="Invigilator" value={filters.invig} options={filterOptions.invigs} allLabel="All Invigilators" onChange={(v) => setFilters((f) => ({ ...f, invig: v }))} />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={[
            ['Scheduled', 'Scheduled'],
            ['Ready', 'Ready'],
            ['In Progress', 'In Progress'],
            ['Submitted', 'Submitted'],
            ['Reviewed', 'Reviewed'],
          ]}
          allLabel="All Statuses"
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
        />
        {anyFilterActive && (
          <button
            onClick={() => setFilters({ date: '', cls: '', subject: '', room: '', invig: '', status: '' })}
            className="inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            <RotateCcw className="h-2.5 w-2.5" /> clear filters
          </button>
        )}
      </div>

      {/* D. Session detail OR C. Exam sessions list */}
      {selectedSession ? (
        <SessionDetail
          session={selectedSession}
          records={sessionRecords}
          onMark={markStatus}
          onMarkAllPresent={() => markAllPresent(selectedSession.id)}
          onSubmit={() => handleSubmit(selectedSession.id)}
          onReview={() => handleReview(selectedSession.id)}
          onBack={() => setSelectedSessionId(null)}
        />
      ) : (
        <CollapsibleSection
          title="Exam Sessions"
          subtitle={`${filteredSessions.length} of ${examSessions.length}`}
          accent="emerald"
          defaultOpen
        >
          <div className="divide-y divide-border/40">
            {grouped.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No sessions match the current filters.
              </div>
            )}
            {grouped.map(([date, items]) => (
              <div key={date}>
                <div className="px-3 py-1.5 bg-muted/30 border-b border-border/40">
                  <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                    {dateHeaderLabel(date)}
                  </p>
                </div>
                {items.map((s) => {
                  const recs = examRecords.filter((r) => r.scheduleItemId === s.scheduleItemId)
                  return (
                    <SessionRow
                      key={s.id}
                      session={s}
                      recordCount={recs.length}
                      onOpen={() => setSelectedSessionId(s.id)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* E. Room-wise analysis */}
      <CollapsibleSection title="Room-wise Analysis" accent="sky" defaultOpen={false}>
        <RoomAnalysis examSessions={examSessions} examRecords={examRecords} />
      </CollapsibleSection>

      {/* F. Class-wise analysis */}
      <CollapsibleSection title="Class-wise Analysis" accent="amber" defaultOpen={false}>
        <BreakdownAnalysis examSessions={examSessions} examRecords={examRecords} groupBy="class" />
      </CollapsibleSection>

      {/* G. Subject-wise analysis */}
      <CollapsibleSection title="Subject-wise Analysis" accent="violet" defaultOpen={false}>
        <BreakdownAnalysis examSessions={examSessions} examRecords={examRecords} groupBy="subject" />
      </CollapsibleSection>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────

function AttStat({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  accent?: 'emerald' | 'rose' | 'amber' | 'sky'
}) {
  const accentCls = accent
    ? {
        emerald: 'text-emerald-600 dark:text-emerald-400',
        rose: 'text-rose-600 dark:text-rose-400',
        amber: 'text-amber-600 dark:text-amber-400',
        sky: 'text-sky-600 dark:text-sky-400',
      }[accent]
    : 'text-foreground'
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">{icon}</span>
        <p className="text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={cn('text-[11px] font-semibold truncate', accentCls)}>{value}</p>
    </div>
  )
}

function StatusButton({ letter, title, active, activeCls, hoverCls, onClick }: {
  letter: string
  title: string
  active: boolean
  activeCls: string
  hoverCls: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-5 h-5 rounded flex items-center justify-center text-[8px] transition-colors',
        active ? activeCls : `bg-muted text-muted-foreground ${hoverCls}`,
      )}
    >
      {letter}
    </button>
  )
}

function FilterSelect({ label, value, options, allLabel, onChange }: {
  label: string
  value: string
  options: Array<[string, string]>
  allLabel: string
  onChange: (v: string) => void
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="text-[9px] uppercase font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1 max-w-[10rem]"
      >
        <option value="">{allLabel}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  )
}

function SessionRow({ session, recordCount, onOpen }: {
  session: ExamSession
  recordCount: number
  onOpen: () => void
}) {
  const gate = computeGateStatus(session)
  const openLabel = computeAttendanceOpenAt(session).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      onClick={onOpen}
      className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer border-b border-border/30"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">
          {session.subjectName} · {session.className}
        </p>
        <p className="text-[9px] text-muted-foreground truncate">
          {session.startTime}–{session.endTime} · {session.roomName} ·{' '}
          Invigilator: <span className="text-foreground/80">{session.invigilatorName ?? '—'}</span>
          {' · '}{recordCount} students
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', STATUS_PILL[gate])}>
          {gate}
        </span>
        {gate === 'Scheduled' ? (
          <Button size="sm" variant="outline" disabled className="h-6 text-[9px] gap-1" onClick={(e) => e.stopPropagation()}>
            <Clock className="h-3 w-3" /> Opens at {openLabel}
          </Button>
        ) : gate === 'Submitted' || gate === 'Reviewed' ? (
          <Button size="sm" variant="outline" className="h-6 text-[9px]" onClick={(e) => { e.stopPropagation(); onOpen() }}>
            View
          </Button>
        ) : (
          <Button size="sm" className="h-6 text-[9px]" onClick={(e) => { e.stopPropagation(); onOpen() }}>
            Open Attendance
          </Button>
        )}
      </div>
    </div>
  )
}

function SessionDetail({ session, records, onMark, onMarkAllPresent, onSubmit, onReview, onBack }: {
  session: ExamSession
  records: ExamAttendanceRecord[]
  onMark: (id: string, status: AttendanceStatus) => void
  onMarkAllPresent: () => void
  onSubmit: () => void
  onReview: () => void
  onBack: () => void
}) {
  const submitted = session.submitted
  const reviewed = session.reviewed
  const present = records.filter((r) => r.status === 'PRESENT').length
  const absent = records.filter((r) => r.status === 'ABSENT').length
  const pending = records.filter((r) => r.status === 'NOT_MARKED').length
  const submittedAtLabel = session.submittedAt ? formatTime12(session.submittedAt) : ''
  const gate = computeGateStatus(session)

  return (
    <div className="space-y-3">
      {/* Back */}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 px-2" onClick={onBack}>
          <ChevronLeft className="h-3 w-3" /> Back to sessions
        </Button>
        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold', STATUS_PILL[gate])}>
          {gate}
        </span>
      </div>

      {/* Header */}
      <div className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-2">
        <div>
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Exam Attendance</p>
          <h3 className="text-sm font-semibold">{session.subjectName}</h3>
          <p className="text-[10px] text-muted-foreground">
            {session.className} · {formatDateLong(session.date)} · {session.startTime}–{session.endTime} · {session.roomName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <UserCheck className="h-3 w-3" />
            <span>Invigilator: <strong className="text-foreground">{session.invigilatorName ?? '—'}</strong></span>
          </span>
          {submitted && session.submittedBy && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" /> Submitted by: <strong>{session.submittedBy}</strong> at {submittedAtLabel}
            </span>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-3 text-[10px]">
        <span className="text-muted-foreground">{records.length} students</span>
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{present} Present</span>
        <span className="text-rose-600 dark:text-rose-400 font-medium">{absent} Absent</span>
        <span className="text-amber-600 dark:text-amber-400 font-medium">{pending} Pending</span>
      </div>

      {/* Mark All Present */}
      {!submitted && (
        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={onMarkAllPresent}>
          <Check className="h-3 w-3" /> Mark All Present
        </Button>
      )}

      {/* Roster table */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-y-auto max-h-[28rem]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground w-12">Roll</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Student</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground w-16">Seat</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground w-40">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-border/30 hover:bg-muted/20">
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{r.studentRollNo ?? '—'}</td>
                  <td className="px-2 py-1.5 font-medium">{r.studentName}</td>
                  <td className="px-2 py-1.5 text-center text-[9px] text-muted-foreground font-mono">{r.seatNumber}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-center gap-1">
                      {!submitted ? (
                        <>
                          <StatusButton letter="P" title="Present" active={r.status === 'PRESENT'} activeCls="bg-emerald-500 text-white" hoverCls="hover:bg-emerald-500/20" onClick={() => onMark(r.id, 'PRESENT')} />
                          <StatusButton letter="A" title="Absent" active={r.status === 'ABSENT'} activeCls="bg-rose-500 text-white" hoverCls="hover:bg-rose-500/20" onClick={() => onMark(r.id, 'ABSENT')} />
                          <StatusButton letter="L" title="Leave" active={r.status === 'LEAVE'} activeCls="bg-amber-500 text-white" hoverCls="hover:bg-amber-500/20" onClick={() => onMark(r.id, 'LEAVE')} />
                          {r.status === 'NOT_MARKED' && (
                            <span className="text-[9px] text-muted-foreground/70 ml-1">Not Marked</span>
                          )}
                        </>
                      ) : (
                        <span className={cn(
                          'text-[9px] font-medium',
                          r.status === 'PRESENT' ? 'text-emerald-600 dark:text-emerald-400' :
                          r.status === 'ABSENT' ? 'text-rose-600 dark:text-rose-400' :
                          r.status === 'LEAVE' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                        )}>
                          {r.status === 'NOT_MARKED' ? 'Not Marked' : r.status}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No students in this session.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submit / Submitted / Reviewed */}
      {!submitted && (
        <div className="flex items-center justify-between gap-2">
          {pending > 0 ? (
            <span className="text-[9px] text-amber-600 dark:text-amber-400">
              {pending} student{pending === 1 ? '' : 's'} {pending === 1 ? 'is' : 'are'} still unmarked
            </span>
          ) : <span />}
          <Button
            size="sm"
            className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto"
            onClick={onSubmit}
            disabled={pending > 0}
          >
            <Send className="h-3 w-3" /> Submit Attendance
          </Button>
        </div>
      )}
      {submitted && !reviewed && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium inline-flex items-center gap-1">
            <Check className="h-3 w-3" /> Attendance Submitted · Submitted by {session.submittedBy ?? 'Principal'} at {submittedAtLabel}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10" onClick={onReview}>
            <Check className="h-3 w-3" /> Mark Reviewed
          </Button>
        </div>
      )}
      {reviewed && (
        <div className="text-center text-[10px] text-violet-700 dark:text-violet-300 font-medium inline-flex items-center gap-1 justify-center w-full py-2">
          <Check className="h-3 w-3" /> Reviewed by Principal
        </div>
      )}
    </div>
  )
}

function RoomAnalysis({ examSessions, examRecords }: {
  examSessions: ExamSession[]
  examRecords: ExamAttendanceRecord[]
}) {
  const [room, setRoom] = useState('')
  const rooms = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of examSessions) m.set(s.roomId, s.roomName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [examSessions])

  const selectedRoom = room || rooms[0]?.[0] || ''
  const selectedLabel = rooms.find(([v]) => v === selectedRoom)?.[1] ?? '—'

  const roomSessions = useMemo(
    () => examSessions.filter((s) => s.roomId === selectedRoom),
    [examSessions, selectedRoom],
  )
  const roomRecords = useMemo(
    () => examRecords.filter((r) => r.roomId === selectedRoom),
    [examRecords, selectedRoom],
  )
  const total = roomRecords.length
  const present = roomRecords.filter((r) => r.status === 'PRESENT').length
  const absent = roomRecords.filter((r) => r.status === 'ABSENT').length
  const pct = total === 0 ? 0 : Math.round((present / total) * 100)

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 className="h-3 w-3 text-muted-foreground" />
        <span className="text-[9px] uppercase font-semibold text-muted-foreground">Room</span>
        <select
          value={selectedRoom}
          onChange={(e) => setRoom(e.target.value)}
          className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1"
        >
          {rooms.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <AttStat icon={<Calendar className="h-3 w-3" />} label="Sessions" value={String(roomSessions.length)} />
        <AttStat icon={<Users className="h-3 w-3" />} label="Students" value={String(total)} />
        <AttStat icon={<Check className="h-3 w-3" />} label="Present" value={String(present)} accent="emerald" />
        <AttStat icon={<X className="h-3 w-3" />} label="Absent" value={String(absent)} accent="rose" />
        <AttStat icon={<MapPin className="h-3 w-3" />} label="Att %" value={`${pct}%`} accent="sky" />
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-y-auto max-h-72">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Date</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Subject</th>
                <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Class</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Present</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Absent</th>
                <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {roomSessions.map((s) => {
                const recs = examRecords.filter((r) => r.scheduleItemId === s.scheduleItemId)
                const p = recs.filter((r) => r.status === 'PRESENT').length
                const a = recs.filter((r) => r.status === 'ABSENT').length
                const gate = computeGateStatus(s)
                return (
                  <tr key={s.id} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-2 py-1.5 text-muted-foreground">{formatDateLong(s.date)}</td>
                    <td className="px-2 py-1.5 font-medium">{s.subjectName}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{s.className}</td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground">{recs.length}</td>
                    <td className="px-2 py-1.5 text-center text-emerald-600 dark:text-emerald-400">{p}</td>
                    <td className="px-2 py-1.5 text-center text-rose-600 dark:text-rose-400">{a}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', STATUS_PILL[gate])}>
                        {gate}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {roomSessions.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No sessions in {selectedLabel}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BreakdownAnalysis({ examSessions, examRecords, groupBy }: {
  examSessions: ExamSession[]
  examRecords: ExamAttendanceRecord[]
  groupBy: 'class' | 'subject'
}) {
  const groups = useMemo(() => {
    const map = new Map<string, {
      name: string
      rows: Map<string, { name: string; total: number; present: number; absent: number }>
    }>()
    for (const s of examSessions) {
      const oId = groupBy === 'class' ? s.classId : s.subjectId
      const oName = groupBy === 'class' ? s.className : s.subjectName
      const iId = groupBy === 'class' ? s.subjectId : s.classId
      const iName = groupBy === 'class' ? s.subjectName : s.className
      const entry = map.get(oId) ?? { name: oName, rows: new Map() }
      const r = entry.rows.get(iId) ?? { name: iName, total: 0, present: 0, absent: 0 }
      const recs = examRecords.filter((rec) => rec.scheduleItemId === s.scheduleItemId)
      r.total += recs.length
      r.present += recs.filter((rec) => rec.status === 'PRESENT').length
      r.absent += recs.filter((rec) => rec.status === 'ABSENT').length
      entry.rows.set(iId, r)
      map.set(oId, entry)
    }
    return [...map.entries()].map(([id, e]) => ({ id, name: e.name, rows: [...e.rows.values()] }))
  }, [examSessions, examRecords, groupBy])

  const headerLabel = groupBy === 'class' ? 'Per-class subject breakdown' : 'Per-subject class breakdown'
  const innerColLabel = groupBy === 'class' ? 'Subject' : 'Class'

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-[9px] uppercase font-semibold text-muted-foreground">
        <BookOpen className="h-3 w-3" /> {headerLabel}
      </div>
      {groups.map((g) => {
        const total = g.rows.reduce((acc, r) => acc + r.total, 0)
        const present = g.rows.reduce((acc, r) => acc + r.present, 0)
        const absent = g.rows.reduce((acc, r) => acc + r.absent, 0)
        const pct = total === 0 ? 0 : Math.round((present / total) * 100)
        return (
          <div key={g.id} className="rounded-lg border border-border/40 overflow-hidden">
            <div className="px-3 py-1.5 bg-muted/30 border-b border-border/40 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{g.name}</p>
              <p className="text-[9px] text-muted-foreground">
                {present} present · {absent} absent · <span className="font-semibold text-foreground">{pct}%</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">{innerColLabel}</th>
                    <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Students</th>
                    <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Present</th>
                    <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Absent</th>
                    <th className="text-center px-2 py-1.5 text-[9px] uppercase font-semibold text-muted-foreground">Att %</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const p = r.total === 0 ? 0 : Math.round((r.present / r.total) * 100)
                    return (
                      <tr key={r.name} className="border-t border-border/30">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5 text-center text-muted-foreground">{r.total}</td>
                        <td className="px-2 py-1.5 text-center text-emerald-600 dark:text-emerald-400">{r.present}</td>
                        <td className="px-2 py-1.5 text-center text-rose-600 dark:text-rose-400">{r.absent}</td>
                        <td className="px-2 py-1.5 text-center font-medium">{p}%</td>
                      </tr>
                    )
                  })}
                  {g.rows.length === 0 && (
                    <tr><td colSpan={5} className="py-2 text-center text-muted-foreground">No data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {groups.length === 0 && (
        <div className="py-4 text-center text-xs text-muted-foreground">No data available.</div>
      )}
    </div>
  )
}
