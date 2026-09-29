'use client'

/**
 * Class Attendance — the module composition root.
 *
 * OWNERSHIP MODEL (spec §7–§11, FINAL):
 *   · CLASS TEACHER → manages the official daily record for her class
 *     (the canonical rows students and parents see). One Save writes the
 *     day; edits autosave as a server draft and finalize explicitly or
 *     at the school's end-of-day boundary.
 *   · SUBJECT TEACHER → VIEW ONLY. The same roster, the same saved
 *     record, read-only status chips — no edit controls, no Save, no
 *     Submit. The context line says who manages the record.
 *
 * This is the ONE place attendance is created, edited and submitted.
 * My Class → Attendance is a separate READ-ONLY class attendance REPORT
 * (attendance-report-tab) that summarizes the same canonical records —
 * it never embeds this board and holds no editing control.
 *
 * Composition (My-Timetable design language):
 *   ModuleToolbar (class + date nav) →
 *   week strip → 4 compact HubStatCards (value / total + hairline
 *   progress) → roster/insights SectionCard (segmented):
 *   · Roster   — hairline `divide-y` rows with a colored left border
 *     accent per status; labeled action buttons on tablet+, a compact
 *     4-up control on mobile (class teacher); read-only chips for the
 *     subject teacher. Search, bulk "mark all present" (class teacher).
 *   · Insights — 10-day present-rate trend, attention-needed absentees,
 *     perfect-record students (hairline lists, no nested boxes).
 *
 * Mobile: the toolbar Save is hidden (a non-wrapping action row used to
 * push it off-screen) and Save instead HEADS the page — one plain in-flow
 * row directly under the class/date controls and BEFORE the week strip /
 * roster, so it is visible before marking begins, scrolls naturally with
 * the content and can never float over or cover a student row. The
 * unsaved state stays explicit next to the button.
 */

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Award,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Clock,
  Eye,
  History,
  Loader2,
  Plane,
  Save,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import { GradientAvatar, PageTransition } from '@/components/shared/ui'
import { ModuleToolbar } from '../../teacher-panel/module-toolbar'
import {
  HubEmptyState,
  HubModuleSkeleton,
  HubSectionError,
  HubStatCards,
  type HubStat,
} from '../shared/hub-stat-cards'
import { SectionCard } from '../shared/section-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAttendanceModule } from './hooks'
import {
  ATTENDANCE_STATUSES,
  HISTORY_DOT,
  STATUS_CONFIG,
  boundaryLabel,
  historyStatsFor,
  longDate,
  rateTone,
  recentStatusesFor,
  rosterContextLine,
  savedAtLabel,
  shiftDayKey,
  shortDate,
  todayKey,
  weekOf,
  weekdayLetter,
  type AttendanceHistory,
  type AttendanceStatus,
  type AttendanceStudent,
  type AuditRow,
} from './shared'

/** House <input type="date"> — matches the h-9 controls around it. */
const DATE_INPUT_CLASS =
  'h-9 w-[128px] rounded-none border-0 bg-transparent px-2 text-xs font-medium text-foreground shadow-none outline-none [color-scheme:light] focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-input/30 dark:[color-scheme:dark]'

// ─── module ───────────────────────────────────────────────────────────

export function AttendanceModule() {
  const {
    classes,
    classesError,
    reloadClasses,
    classId,
    selectClass,
    date,
    selectDate,
    board,
    boardLoading,
    boardError,
    reloadBoard,
    draft,
    source,
    dirty,
    resumedFromDraft,
    draftSavedAt,
    setStatus,
    markAllPresent,
    counts,
    saving,
    justSaved,
    save,
    readOnly,
    embedded,
  } = useAttendanceModule()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'roster' | 'insights'>('roster')

  const classOptions = classes ?? []
  const total = board?.students.length ?? 0
  const canSave =
    !readOnly && board != null && total > 0 && !saving && !boardLoading
  /** The official record exists for the viewed date. */
  const marked = source === 'baseline' || source === 'draft'
  /** View-only + nothing saved yet → honest pending state (§10). */
  const pendingView = readOnly && board != null && !board.baseline.exists

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = board?.students ?? []
    if (!q) return list
    return list.filter(
      (s) => s.name.toLowerCase().includes(q) || s.rollNo.includes(q),
    )
  }, [board, search])

  const markedDays = useMemo(
    () => new Set((board?.history?.days ?? []).map((d) => d.date)),
    [board],
  )

  /** The 4 compact summary metrics — the SAVED day (or the open sheet).
   *  Hidden in the view-only pending state (all-PRESENT would lie). */
  const stats: HubStat[] = useMemo(
    () => [
      {
        key: 'present',
        label: 'Present',
        value: counts.present,
        total,
        progress: total > 0 ? counts.present / total : 0,
        icon: Check,
        tone: 'emerald',
      },
      {
        key: 'absent',
        label: 'Absent',
        value: counts.absent,
        total,
        progress: total > 0 ? counts.absent / total : 0,
        icon: X,
        tone: 'rose',
      },
      {
        key: 'late',
        label: 'Late',
        value: counts.late,
        total,
        progress: total > 0 ? counts.late / total : 0,
        icon: Clock,
        tone: 'amber',
      },
      {
        key: 'leave',
        label: 'On Leave',
        value: counts.leave,
        total,
        progress: total > 0 ? counts.leave / total : 0,
        icon: Plane,
        tone: 'sky',
      },
    ],
    [counts, total],
  )

  const goPrevDay = () => selectDate(shiftDayKey(date, -1))
  const goNextDay = () => {
    const next = shiftDayKey(date, 1)
    if (next <= todayKey()) selectDate(next)
  }
  const goToday = () => selectDate(todayKey())

  /** The Save control — shared by the toolbar and the embedded date bar. */
  const saveButton = (
    <Button
      onClick={save}
      disabled={!canSave}
      className="hidden h-9 sm:inline-flex"
    >
      <AnimatePresence mode="wait" initial={false}>
        {saving ? (
          <motion.span
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
          </motion.span>
        ) : justSaved ? (
          <motion.span
            key="saved"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" /> Saved
          </motion.span>
        ) : (
          <motion.span
            key="save"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            Save attendance
            {dirty && (
              <span
                className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
                aria-label="Unsaved changes"
              />
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  )

  // ── module-level states (all hooks above run unconditionally) ──────

  if (!embedded && classes == null) {
    return (
      <PageTransition className="space-y-4">
        {classesError != null ? (
          <HubSectionError message={classesError} onRetry={reloadClasses} />
        ) : (
          <HubModuleSkeleton />
        )}
      </PageTransition>
    )
  }

  if (!embedded && classes != null && classes.length === 0) {
    return (
      <PageTransition className="space-y-4">
        <HubEmptyState
          icon={Users}
          title="No classes assigned yet"
          hint="Classes appear here once you are a class teacher or teach a subject in them."
        />
      </PageTransition>
    )
  }

  return (
    <PageTransition className="space-y-4">
      {/* quiet toolbar: scope line + class / date nav + Save — OR the
          embedded date bar when pinned inside My Class (§5) */}
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <DateNav
            date={date}
            goPrevDay={goPrevDay}
            goNextDay={goNextDay}
            goToday={goToday}
            onPick={selectDate}
          />
          {board != null && !readOnly && saveButton}
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              View only — managed by the class teacher
            </span>
          )}
        </div>
      ) : (
        <ModuleToolbar
          context={`Mark attendance · ${longDate(date)}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={classId ?? undefined} onValueChange={selectClass}>
                <SelectTrigger className="h-9 w-[120px] sm:w-[132px]" aria-label="Class">
                  <SelectValue placeholder="Class" />
                </SelectTrigger>
                <SelectContent>
                  {classOptions.map((c) => (
                    <SelectItem key={c.classId} value={c.classId}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* date stepper + Today — ONE semantic group so a wrapped
                  toolbar keeps the day controls together */}
              <DateNav
                date={date}
                goPrevDay={goPrevDay}
                goNextDay={goNextDay}
                goToday={goToday}
                onPick={selectDate}
              />

              {/* Save — tablet/desktop toolbar slot (mobile heads the page
                  in its own row instead; see MobileSaveRow). Hidden while
                  the board loads and for view-only subject teachers (§9/§10). */}
              {board != null && !readOnly && saveButton}
            </div>
          }
        />
      )}

      {boardError != null ? (
        <HubSectionError message={boardError} onRetry={reloadBoard} />
      ) : board == null ? (
        <BoardSkeleton />
      ) : board.students.length === 0 ? (
        <SectionCard
          icon={Users}
          title={`${board.label} · Student roster`}
          contentClassName=""
        >
          <HubEmptyState
            icon={Users}
            title="No students in this class"
            hint="Active students enrolled in this class will appear here."
          />
        </SectionCard>
      ) : (
        <>
          {/* mobile: Save heads the page — one in-flow row directly under
              the class/date controls, before any roster content; it never
              floats over, covers or obscures student rows while scrolling.
              View-only boards never render it (§9/§10). */}
          {!readOnly && (
            <MobileSaveRow
              save={save}
              canSave={canSave}
              saving={saving}
              justSaved={justSaved}
              dirty={dirty}
              marked={marked}
              draftSavedAt={draftSavedAt}
              autosaveBoundary={
                board.autosave?.autosaveFinalize && date === todayKey() && !board.baseline.exists
                  ? boundaryLabel(board.autosave.endOfDayMinutes)
                  : null
              }
            />
          )}

          {/* view-only pending state (§10) — honest, subtle, no fake counts */}
          {pendingView && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground"
            >
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p className="min-w-0">
                Attendance pending
                <span className="text-muted-foreground/80">
                  {' '}— the class teacher
                  {board.classTeacherName ? ` (${board.classTeacherName})` : ''} marks the daily
                  attendance for {board.label}.
                </span>
              </p>
            </div>
          )}

          {/* §11 draft resume — one quiet amber line so an open sheet is
              never mistaken for the official record (class teacher only) */}
          {resumedFromDraft && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300"
            >
              <CloudUpload className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p className="min-w-0">
                Unsaved draft restored — your entries were kept.
                <span className="text-amber-700/80 dark:text-amber-300/80">
                  {' '}
                  Save attendance to make them official.
                </span>
              </p>
            </div>
          )}

          {/* week strip: Mon–Sun, marked days dotted, today ringed —
              a lightweight navigation control, not a card */}
          <WeekStrip
            week={weekOf(date)}
            selected={date}
            markedDays={markedDays}
            onSelect={selectDate}
          />

          {/* live summary metrics — one shared system with My Timetable */}
          {!pendingView && <HubStatCards stats={stats} />}

          {/* roster + insights */}
          <SectionCard
            icon={Users}
            title={`${board.label} · Student roster`}
            subtitle={rosterContextLine(board, null, source)}
            className={cn('transition-opacity', boardLoading && 'opacity-60')}
            actions={
              <>
                {view === 'roster' && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search student…"
                        aria-label="Search students"
                        className="h-9 w-36 pl-8 sm:w-44"
                      />
                    </div>
                    {!readOnly && (
                      <Button
                        variant="outline"
                        onClick={markAllPresent}
                        disabled={saving}
                        className="h-9"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Mark all present
                      </Button>
                    )}
                  </>
                )}
                <div
                  role="tablist"
                  aria-label="Attendance views"
                  className="flex h-9 items-center rounded-md border border-input bg-muted/40 p-0.5"
                >
                  {(
                    [
                      { key: 'roster', label: 'Roster', icon: Users },
                      { key: 'insights', label: 'Insights', icon: BarChart3 },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      role="tab"
                      type="button"
                      aria-selected={view === t.key}
                      onClick={() => setView(t.key)}
                      className={cn(
                        'flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium transition-all',
                        view === t.key
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <t.icon className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            }
          >
            {view === 'insights' ? (
              <InsightsView
                students={board.students}
                history={board.history}
                audit={board.audit ?? []}
              />
            ) : (
              <>
                {filtered.length === 0 ? (
                  <HubEmptyState
                    icon={Search}
                    title={`No students match “${search.trim()}”`}
                    hint="Try a different name or roll number."
                    className="py-8"
                  />
                ) : (
                  <ul className="divide-y divide-border/50">
                    {filtered.map((student, i) => (
                      <RosterRow
                        key={student.id}
                        student={student}
                        index={i}
                        current={draft[student.id] ?? 'PRESENT'}
                        disabled={saving}
                        onSetStatus={setStatus}
                        history={board.history}
                        readOnly={readOnly}
                        pending={!readOnly ? false : !board.baseline.exists}
                      />
                    ))}
                  </ul>
                )}

                {/* footer: summary + history legend — one quiet strip */}
                <div className="flex flex-col items-start justify-between gap-2.5 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 text-xs">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Total:{' '}
                      <span className="font-semibold text-foreground">
                        {total} student{total === 1 ? '' : 's'}
                      </span>
                      {!pendingView && (
                        <>
                          <span className="mx-1.5">·</span>
                          Attendance rate:{' '}
                          <span className="font-semibold text-foreground">
                            {total > 0 ? ((counts.present / total) * 100).toFixed(1) : '0.0'}%
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <HistoryLegend />
                    {!readOnly && (
                      <p className="text-[11px] text-muted-foreground">
                        {dirty ? (
                          <span className="font-medium text-amber-600 dark:text-amber-400">
                            Unsaved — kept as a draft
                            {draftSavedAt && (
                              <span className='font-normal text-muted-foreground'>
                                {' '}(saved {savedAtLabel(draftSavedAt, date)})
                              </span>
                            )}
                            {board.autosave?.autosaveFinalize && date === todayKey() && !board.baseline.exists && (
                              <span className="font-normal text-muted-foreground">
                                {' '}· auto-submits {boundaryLabel(board.autosave.endOfDayMinutes)}
                              </span>
                            )}
                          </span>
                        ) : source === 'present' ? (
                          'Nothing saved for this date yet'
                        ) : (
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            In sync with the saved record
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </SectionCard>

        </>
      )}
    </PageTransition>
  )
}

// ─── local pieces ─────────────────────────────────────────────────────

/** Date stepper + Today — one semantic group shared by the toolbar and
 *  the embedded (My Class) date bar. */
function DateNav({
  date,
  goPrevDay,
  goNextDay,
  goToday,
  onPick,
}: {
  date: string
  goPrevDay: () => void
  goNextDay: () => void
  goToday: () => void
  onPick: (date: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <button
          type="button"
          onClick={goPrevDay}
          aria-label="Previous day"
          title="Previous day"
          className="flex h-full w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <input
          type="date"
          value={date}
          max={todayKey()}
          onChange={(e) => onPick(e.target.value)}
          aria-label="Attendance date"
          className={DATE_INPUT_CLASS}
        />
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={goNextDay}
          disabled={date >= todayKey()}
          aria-label="Next day"
          title="Next day"
          className="flex h-full w-7 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={goToday}
        disabled={date === todayKey()}
        className="h-9 px-2.5 text-xs"
      >
        Today
      </Button>
    </div>
  )
}

/** Mon–Sun of the viewed week: quick jumps, marked dots, today ring. */
function WeekStrip({
  week,
  selected,
  markedDays,
  onSelect,
}: {
  week: string[]
  selected: string
  markedDays: Set<string>
  onSelect: (key: string) => void
}) {
  const today = todayKey()
  return (
    <div
      className="flex items-center justify-between gap-1 overflow-x-auto rounded-xl border border-border bg-card px-2 py-2"
      role="group"
      aria-label="This week"
    >
      {week.map((key) => {
        const dayNumber = Number(key.slice(8, 10))
        const isFuture = key > today
        const isSelected = key === selected
        const isToday = key === today
        const isMarked = markedDays.has(key)
        return (
          <button
            key={key}
            type="button"
            disabled={isFuture}
            onClick={() => onSelect(key)}
            aria-label={`${longDate(key)}${isMarked ? ' — attendance marked' : ''}${isFuture ? ' (future)' : ''}`}
            aria-pressed={isSelected}
            title={isMarked ? `${shortDate(key)} — attendance marked` : longDate(key)}
            className={cn(
              'flex min-w-[38px] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors',
              isFuture
                ? 'cursor-not-allowed opacity-35'
                : 'hover:bg-muted',
              isSelected && !isFuture && 'bg-primary/10 ring-1 ring-primary/30',
            )}
          >
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wide',
                isSelected ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {weekdayLetter(key)}
            </span>
            <span
              className={cn(
                'text-xs font-semibold tabular-nums',
                isToday && !isSelected && 'text-primary',
                isSelected ? 'text-primary' : 'text-foreground',
              )}
            >
              {dayNumber}
            </span>
            <span className="flex h-1.5 items-center justify-center">
              {isMarked ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Attendance marked" />
              ) : isToday ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-transparent" />
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** P A L L mini-legend for the roster history dots. */
function HistoryLegend() {
  const items: { status: AttendanceStatus; label: string }[] = [
    { status: 'PRESENT', label: 'Present' },
    { status: 'ABSENT', label: 'Absent' },
    { status: 'LATE', label: 'Late' },
    { status: 'LEAVE', label: 'Leave' },
  ]
  return (
    <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground" aria-hidden="true">
      <span className="hidden sm:inline">Last days:</span>
      {items.map((it) => (
        <span key={it.status} className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', HISTORY_DOT[it.status])} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/**
 * One roster row — a hairline (divide-y) list entry with a colored LEFT
 * border accent for the current status. Tablet+: roll tile + labeled
 * action buttons on the right. Mobile: roll folded into the name line
 * and a compact 4-up action control under the identity block.
 *
 * VIEW-ONLY rows (subject teacher, §9/§10): the buttons are replaced by
 * one quiet read-only chip — same visual language, zero edit affordance.
 */
function RosterRow({
  student,
  index,
  current,
  disabled,
  onSetStatus,
  history,
  readOnly,
  pending,
}: {
  student: AttendanceStudent
  index: number
  current: AttendanceStatus
  disabled: boolean
  onSetStatus: (studentId: string, status: AttendanceStatus) => void
  history: AttendanceHistory | undefined
  readOnly: boolean
  /** view-only + nothing saved for the date → honest pending chip */
  pending: boolean
}) {
  const recent = recentStatusesFor(student.id, history, 5)
  const stat = historyStatsFor(student.id, history)
  const rate = Math.round(stat.rate * 100)
  const tone = rateTone(stat.rate)
  const cfg = STATUS_CONFIG[current]
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.025, duration: 0.25 }}
      className={cn(
        'border-l-2 py-2.5 pl-3 pr-4 transition-colors sm:py-2',
        pending ? 'border-l-muted-foreground/20' : cfg.accent,
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        {/* roll tile — tablet+ (mobile folds the roll into the name) */}
        <div
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-bold tabular-nums text-muted-foreground sm:flex"
          aria-hidden="true"
        >
          {student.rollNo}
        </div>
        <GradientAvatar name={student.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <span className="mr-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground sm:hidden">
              {student.rollNo} ·
            </span>
            {student.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {recent.length > 0 && (
              <span className="flex items-center gap-1" title="Last 5 marked days (oldest → newest)">
                {recent.map((r) => (
                  <span
                    key={r.date}
                    className={cn('h-1.5 w-1.5 rounded-full', HISTORY_DOT[r.status])}
                    title={`${shortDate(r.date)} — ${STATUS_CONFIG[r.status].label}`}
                  />
                ))}
              </span>
            )}
            {stat.marked > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-semibold',
                  tone.chip,
                )}
                title={`${stat.present}/${stat.marked} present across the last ${history?.days.length ?? 0} marked days`}
              >
                {rate}%
              </span>
            )}
          </div>
        </div>
        {/* read-only chip (subject teacher, §9/§10) — same status language,
            zero edit affordance */}
        {readOnly && (
          <span className="shrink-0">
            {pending ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" /> Pending
              </span>
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold',
                  cfg.inactive,
                )}
                title={`Attendance is managed by the class teacher — ${cfg.label}`}
              >
                <cfg.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {cfg.label}
              </span>
            )}
          </span>
        )}
        {/* actions — tablet+ labeled buttons (class teacher only) */}
        {!readOnly && (
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {ATTENDANCE_STATUSES.map((status) => (
              <StatusButton
                key={status}
                status={status}
                studentName={student.name}
                isActive={current === status}
                disabled={disabled}
                onSetStatus={onSetStatus}
                studentId={student.id}
                labeled
              />
            ))}
          </div>
        )}
      </div>
      {/* actions — mobile compact control (one row, four equal parts),
          class teacher only */}
      {!readOnly && (
        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:hidden">
          {ATTENDANCE_STATUSES.map((status) => (
            <StatusButton
              key={status}
              status={status}
              studentName={student.name}
              isActive={current === status}
              disabled={disabled}
              onSetStatus={onSetStatus}
              studentId={student.id}
            />
          ))}
        </div>
      )}
    </motion.li>
  )
}

/** One attendance action. Only the SELECTED state is visually dominant. */
function StatusButton({
  status,
  studentName,
  studentId,
  isActive,
  disabled,
  onSetStatus,
  labeled,
}: {
  status: AttendanceStatus
  studentName: string
  studentId: string
  isActive: boolean
  disabled: boolean
  onSetStatus: (studentId: string, status: AttendanceStatus) => void
  labeled?: boolean
}) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={() => onSetStatus(studentId, status)}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1 rounded-md border font-medium transition-all',
        labeled
          ? 'px-2 py-1 text-[11px]'
          : 'h-8 px-1 text-[10px]',
        isActive ? cfg.active : cn('bg-transparent', cfg.inactive),
      )}
      title={cfg.label}
      aria-label={`Mark ${studentName} as ${cfg.label}`}
      aria-pressed={isActive}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{cfg.label}</span>
    </motion.button>
  )
}

/**
 * MobileSaveRow — the phone-screen replacement for the toolbar Save slot.
 *
 * The settled pattern: Save HEADS the page — one plain in-flow row
 * directly under the class/date controls and BEFORE the week strip /
 * roster, so the action is visible before marking begins, scrolls
 * naturally with the content and can never cover a student row. A live
 * status line (unsaved / in sync / saved / not marked) sits beside the
 * full-width 44px-touch button — no extra chrome, no extra empty space.
 *
 * `sm:hidden` — tablet/desktop keeps the toolbar Save slot instead.
 */
function MobileSaveRow({
  save,
  canSave,
  saving,
  justSaved,
  dirty,
  marked,
  draftSavedAt: _draftSavedAt,
  autosaveBoundary,
}: {
  save: () => void
  canSave: boolean
  saving: boolean
  justSaved: boolean
  dirty: boolean
  marked: boolean
  draftSavedAt: string | null
  autosaveBoundary: string | null
}) {
  const status = saving ? (
    <span className="flex items-center gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" /> Saving…
    </span>
  ) : justSaved ? (
    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
    </span>
  ) : dirty ? (
    <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
      <CloudUpload className="h-3 w-3 shrink-0" aria-hidden="true" />
      Draft kept
    </span>
  ) : marked ? (
    'In sync with saved record'
  ) : (
    'Not marked yet'
  )

  return (
    <div
      role="group"
      aria-label="Save attendance"
      className="flex items-center gap-3 sm:hidden"
    >
      <p className="w-[96px] min-w-0 shrink-0 text-[11px] font-medium leading-snug text-muted-foreground">
        {status}
        {autosaveBoundary && dirty && (
          <span className="block text-[10px] font-normal leading-tight text-muted-foreground/80">
            auto-submits {autosaveBoundary}
          </span>
        )}
      </p>
      <Button
        onClick={save}
        disabled={!canSave}
        className="h-11 min-w-0 flex-1 text-sm"
      >
        <AnimatePresence mode="wait" initial={false}>
          {saving ? (
            <motion.span
              key="saving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </motion.span>
          ) : justSaved ? (
            <motion.span
              key="saved"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" /> Saved
            </motion.span>
          ) : (
            <motion.span
              key="save"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Save className="h-4 w-4 shrink-0" />
              <span className="truncate">Save attendance</span>
              {dirty && (
                <span
                  className="ml-0.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400"
                  aria-label="Unsaved changes"
                />
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
    </div>
  )
}

/** Insights: trend / attention / perfect record / recent changes — all
 *  from the history slice + the canonical audit journal. */
function InsightsView({
  students,
  history,
  audit,
}: {
  students: AttendanceStudent[]
  history: AttendanceHistory | undefined
  audit: AuditRow[]
}) {
  const days = history?.days ?? []
  const perStudent = useMemo(
    () => students.map((s) => ({ student: s, stat: historyStatsFor(s.id, history) })),
    [students, history],
  )
  const attention = useMemo(
    () =>
      perStudent
        .filter((p) => p.stat.absent > 0)
        .sort((a, b) => b.stat.absent - a.stat.absent || a.stat.rate - b.stat.rate)
        .slice(0, 5),
    [perStudent],
  )
  const perfect = useMemo(
    () => perStudent.filter((p) => p.stat.marked > 0 && p.stat.present === p.stat.marked),
    [perStudent],
  )
  const avgRate =
    days.length > 0 ? days.reduce((acc, d) => acc + d.rate, 0) / days.length : 0
  const avgTone = rateTone(avgRate)

  if (days.length === 0) {
    return (
      <HubEmptyState
        icon={BarChart3}
        title="No marked days yet"
        hint="Insights appear once attendance has been saved for a few days."
        className="py-10"
      />
    )
  }

  return (
    <div className="space-y-5 px-4 py-4">
      {/* headline stat — one quiet strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/30 px-3.5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <TrendingUp className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Average present rate{' '}
            <span className={avgTone.text}>{(avgRate * 100).toFixed(0)}%</span>{' '}
            <span className="font-normal text-muted-foreground">
              across the last {days.length} marked day{days.length === 1 ? '' : 's'}
            </span>
          </p>
          <div className="mt-1.5 h-1.5 max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', avgTone.bar)}
              style={{ width: `${Math.round(avgRate * 100)}%` }}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {days.length < 10
            ? `Recent window: ${shortDate(days[0].date)} – ${shortDate(days[days.length - 1].date)}`
            : `Last 10 marked days · latest ${shortDate(days[days.length - 1].date)}`}
        </p>
      </div>

      {/* trend bars — bare, no nested box */}
      <div>
        <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Daily present rate
        </h4>
        <div className="flex items-end gap-1.5 sm:gap-2.5">
          {days.map((d) => {
            const pct = Math.round(d.rate * 100)
            const tone = rateTone(d.rate)
            return (
              <div
                key={d.date}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                title={`${longDate(d.date)} — ${pct}% present · ${d.counts.present} present, ${d.counts.absent} absent, ${d.counts.late} late, ${d.counts.leave} on leave`}
              >
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {pct}%
                </span>
                <div className="flex h-24 w-full items-end justify-center">
                  <motion.div
                    initial={{ height: 4 }}
                    animate={{ height: `${Math.max(pct, 4)}%` }}
                    transition={{ type: 'spring', stiffness: 180, damping: 22 }}
                    className={cn('w-full max-w-7 rounded-t-md', tone.bar)}
                    style={{ transformOrigin: 'bottom' }}
                  />
                </div>
                <span className="truncate text-[10px] font-medium text-muted-foreground">
                  {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* attention needed — hairline list */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Attention needed
            </h4>
          </div>
          {attention.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No absences in the recent window — full class!
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {attention.map(({ student, stat }) => {
                const tone = rateTone(stat.rate)
                return (
                  <li key={student.id} className="flex items-center gap-2.5 py-2">
                    <GradientAvatar name={student.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{student.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {stat.absent} absence{stat.absent === 1 ? '' : 's'}
                        {stat.late > 0 ? ` · ${stat.late} late` : ''}
                        {stat.leave > 0 ? ` · ${stat.leave} on leave` : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                        tone.chip,
                      )}
                      title={`${stat.present}/${stat.marked} present`}
                    >
                      {Math.round(stat.rate * 100)}%
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* recent changes — the audit journal, hairline list */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent changes
            </h4>
          </div>
          {audit.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No edited statuses in the last 30 days — edits are always journaled.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {audit.map((row, i) => {
                const prev = STATUS_CONFIG[row.previousStatus as AttendanceStatus]
                const next = STATUS_CONFIG[row.newStatus as AttendanceStatus]
                return (
                  <li key={`${row.createdAt}-${i}`} className="flex items-center gap-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{row.studentName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {row.changedBy} · {shortDate(row.date)}
                        {row.source === 'AUTOSAVE' && ' · autosaved'}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold">
                      {prev && <span className={cn('rounded px-1.5 py-0.5 line-through opacity-60', prev.inactive)}>{prev.label}</span>}
                      <span aria-hidden className="text-muted-foreground">→</span>
                      {next && <span className={cn('rounded px-1.5 py-0.5', next.inactive)}>{next.label}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* perfect record — hairline list */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Award className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Perfect record
            </h4>
          </div>
          {perfect.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No student has a spotless record in the recent window yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {perfect.slice(0, 8).map(({ student, stat }) => (
                <li key={student.id} className="flex items-center gap-2.5 py-2">
                  <GradientAvatar name={student.name} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold">{student.name}</p>
                  <span
                    className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-600"
                    title={`${stat.present}/${stat.marked} present`}
                  >
                    {stat.present}/{stat.marked} ✓
                  </span>
                </li>
              ))}
              {perfect.length > 8 && (
                <li className="py-1.5 text-center text-[11px] text-muted-foreground">
                  + {perfect.length - 8} more with perfect attendance
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** Skeleton for a board load: week strip + 4 stat cards + roster rows. */
function BoardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-1 rounded-xl border border-border bg-card px-2 py-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex min-w-[38px] flex-1 flex-col items-center gap-1.5 py-1">
            <div className="h-2.5 w-3 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-5 animate-pulse rounded bg-muted" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="h-2.5 w-16 rounded bg-muted" />
              <div className="h-3.5 w-3.5 rounded bg-muted" />
            </div>
            <div className="h-8 w-14 rounded bg-muted" />
            <div className="mt-2 h-1 w-full rounded-full bg-muted" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <div className="space-y-1.5">
            <div className="h-3.5 w-44 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="hidden h-9 w-64 animate-pulse rounded-md bg-muted sm:block" />
        </div>
        <ul className="divide-y divide-border/50">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-l-2 border-muted px-4 py-3">
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-28 animate-pulse rounded bg-muted" />
              </div>
              <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-6 w-14 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
              <div className="grid w-full grid-cols-4 gap-1.5 sm:hidden">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-8 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
