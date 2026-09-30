'use client'

/**
 * AttendanceModule — Student "My Attendance" (SECOND-GENERATION redesign).
 *
 * READ-ONLY personal attendance record. 7-b: every number derives from
 * the REAL server rows — GET /api/student/attendance returns the caller's
 * own canonical Attendance rows (the same rows the Teacher/Principal
 * marking flow writes). When staff correct a record, the student sees the
 * updated status after the next refresh.
 *
 * Resolution chain: canonical session identity (useMyStudentRecord —
 * session user → roster record) → hydrate(studentId) replaces the store
 * with the server rows → this student's records only (§41 privacy — the
 * store filter is by student id).
 *
 * Percentage policy (the school's existing convention, unchanged):
 *   attended = Present + Late (late counts as attended)
 *   applicable days = RECORDED school days only
 *   → holidays, weekends and unrecorded days never reduce attendance,
 *     and "No Record" never silently becomes Absent.
 *
 * Honest states: loading → skeleton, error → retry, no records → the
 * honest empty state (never a fabricated percentage).
 *
 * Reading rhythm (§35): hero summary → calendar + records → trend.
 * LR-1 — no module title: the sidebar + top bar already say
 * "Attendance"; the Snapshot's "Overall · <window>" line is the page's
 * one scope line, so class/section/session never repeat below (§5/§32).
 */

import { useEffect, useMemo, useState } from 'react'
import { CalendarOff, RotateCw } from 'lucide-react'
import { GlassCard, PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useStudentAttendanceStore,
  computeStats,
  studentRecords,
  weeklyTrend,
  type StudentAttendanceRecord,
} from '@/lib/store/student-attendance-store'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { useMyStudentRecord } from '@/lib/store/students-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { Snapshot, type TodayStatus } from './snapshot'
import { CalendarView } from './calendar-view'
import { MonthRecords } from './month-records'
import { Trend } from './trend'
import {
  buildMonthGrid,
  defaultSelection,
  formatWindow,
  isoOf,
  monthIndex,
  pad,
  resolveDay,
  shiftMonth,
  workingDaysInMonth,
  type MonthCursor,
} from './date-utils'

export function AttendanceModule() {
  // ── Identity — the canonical session student (never hardcoded, §38) ──
  const student = useMyStudentRecord()
  const studentId = student?.id ?? ''

  // ── REAL data — own server rows via /api/student/attendance (7-b) ──
  const allRecords = useStudentAttendanceStore((s) => s.records)
  const status = useStudentAttendanceStore((s) => s.status)
  const error = useStudentAttendanceStore((s) => s.error)
  const hydrate = useStudentAttendanceStore((s) => s.hydrate)

  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (studentId) void hydrate(studentId)
  }, [studentId, hydrate, reloadTick])

  const my = useMemo(() => studentRecords(allRecords, studentId), [allRecords, studentId])
  const stats = computeStats(my)

  // ── School policy — thresholds drive labels and chips only (§27) ──
  const thresholds = useSchoolSettingsStore((s) => s.academics?.attendanceThresholds)

  // SD-3b — the SERVER session label wins (never disagrees with the sidebar).
  const srvClassLabel = useCurrentUser((s) => s.me?.student?.classLabel)
  const classLabel = srvClassLabel ?? (student ? `${student.className}-${student.section}` : 'My Class')

  // ── Time + month navigation (local-timezone safe) ──
  const todayIso = isoOf(new Date())
  const currentMonth = useMemo<MonthCursor>(
    () => ({ y: Number(todayIso.slice(0, 4)), m: Number(todayIso.slice(5, 7)) }),
    [todayIso],
  )
  const minMonth = useMemo(
    () =>
      my.length > 0
        ? { y: Number(my[0].date.slice(0, 4)), m: Number(my[0].date.slice(5, 7)) }
        : currentMonth,
    [my, currentMonth],
  )
  const [cursor, setCursor] = useState<MonthCursor>(currentMonth)
  const [selected, setSelected] = useState<string | null>(() => defaultSelection(currentMonth, byDateOf(my), todayIso))
  const byDate = useMemo(() => byDateOf(my), [my])
  const canPrev = monthIndex(cursor) > monthIndex(minMonth)
  const canNext = monthIndex(cursor) < monthIndex(currentMonth)

  const handleShift = (delta: number) => {
    const next = shiftMonth(cursor, delta)
    setCursor(next)
    setSelected(defaultSelection(next, byDate, todayIso))
  }

  // ── Month-scoped data (memoized — month nav never refetches, §23) ──
  const grid = useMemo(() => buildMonthGrid(cursor, byDate, todayIso), [cursor, byDate, todayIso])
  const monthPrefix = `${cursor.y}-${pad(cursor.m)}`
  const monthRecords = useMemo(
    () => my.filter((r) => r.date.startsWith(monthPrefix)).reverse(), // newest first
    [my, monthPrefix],
  )
  const monthStats = useMemo(() => computeStats(monthRecords), [monthRecords])
  const workingDays = useMemo(() => workingDaysInMonth(cursor), [cursor])

  // ── Today's status + trend (real records only) ──
  const todayStatus: TodayStatus = useMemo(() => {
    const d = resolveDay(todayIso, byDate, todayIso)
    return { kind: d.kind, holidayName: d.holidayName, record: d.record }
  }, [todayIso, byDate])
  const weekPoints = useMemo(() => weeklyTrend(my), [my])
  const windowLabel = useMemo(
    () => (my.length > 0 ? formatWindow(my[0].date, my[my.length - 1].date) : ''),
    [my],
  )

  /* ── LOADING — skeleton, never fabricated numbers (§44) ── */
  if (status === 'idle' || status === 'loading') {
    return (
      <PageTransition>
        <div className="space-y-6 sm:space-y-7" aria-busy="true" aria-label="Loading attendance">
          <Skeleton className="h-[168px] rounded-2xl" />
          <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-[340px] rounded-2xl" />
            </div>
            <Skeleton className="h-[340px] rounded-2xl" />
          </div>
          <Skeleton className="h-[180px] rounded-2xl" />
        </div>
      </PageTransition>
    )
  }

  /* ── ERROR — honest message + retry, never a fabricated fallback ── */
  if (status === 'error') {
    return (
      <PageTransition>
        <div className="space-y-6 sm:space-y-7">
          <GlassCard hover={false} className="on-card px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CalendarOff className="h-6 w-6" aria-hidden />
            </div>
            <p className="text-sm font-semibold">Attendance could not load</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {error ?? 'Your attendance records are temporarily unavailable.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4 h-8 gap-1.5"
              onClick={() => setReloadTick((t) => t + 1)}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </Button>
          </GlassCard>
        </div>
      </PageTransition>
    )
  }

  /* ── EMPTY STATE — no records, no fabricated numbers (§44) ── */
  if (my.length === 0) {
    return (
      <PageTransition>
        <div className="space-y-6 sm:space-y-7">
          <GlassCard hover={false} className="on-card px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CalendarOff className="h-6 w-6" aria-hidden />
            </div>
            <p className="text-sm font-semibold">No attendance records yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Records appear here once your class teacher marks attendance — your percentage,
              calendar and trend build up automatically from the real entries.
            </p>
          </GlassCard>
        </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <div className="space-y-6 sm:space-y-7">
        {/* LR-1 — no module title: the sidebar + top bar already say
            "Attendance"; the Snapshot below carries the record window
            ("Overall · <window>") as the page's one scope line. */}

        {/* 1 — "How am I doing?" (§20) */}
        <Snapshot stats={stats} windowLabel={windowLabel} thresholds={thresholds} today={todayStatus} />

        {/* 2 — the primary experience: calendar + records (§21–§28) */}
        <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CalendarView
              cursor={cursor}
              isCurrentMonth={monthIndex(cursor) === monthIndex(currentMonth)}
              canPrev={canPrev}
              canNext={canNext}
              onShift={handleShift}
              grid={grid}
              todayIso={todayIso}
              selected={selected}
              onSelect={setSelected}
              classLabel={classLabel}
              monthStats={monthStats}
              workingDays={workingDays}
            />
          </div>
          <MonthRecords
            key={`${cursor.y}-${cursor.m}`}
            cursor={cursor}
            records={monthRecords}
            workingDays={workingDays}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        {/* 3 — "Is it improving?" (§25) — emerald line, school-policy reference lines */}
        <Trend points={weekPoints} thresholds={thresholds} />
      </div>
    </PageTransition>
  )
}

/** Small helper so the initial selection can read the map before the memo. */
function byDateOf(records: StudentAttendanceRecord[]): Map<string, StudentAttendanceRecord> {
  return new Map(records.map((r) => [r.date, r]))
}
