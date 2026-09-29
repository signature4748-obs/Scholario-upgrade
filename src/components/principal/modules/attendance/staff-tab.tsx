'use client'

/**
 * StaffAttendanceTab — Phase 4 redesign.
 *
 * Brief §2-§15 (Phase 4): Date-based attendance state machine.
 *   - Submitted dates are READ-ONLY (Brief §4, §7, §8, §14, §16).
 *   - Draft dates are editable + persisted (Brief §9, §10, §27, §29).
 *   - Empty dates are editable blank slates (Brief §12).
 *
 * Brief §1: this screen IS the staff attendance history. The Date Picker
 *   controls which date's record is shown. No separate "Staff History"
 *   module is created.
 *
 * Brief §16: read-only is enforced at the store layer (not just UI).
 *   The store's `mark()` / `markAllPresent()` / `submit()` actions refuse
 *   to mutate a submitted date — this is the frontend bypass guard.
 *
 * Brief §5 + §24: read-only UI is intentional — status banner above
 *   the table + Mark All Present hidden + Submit replaced by
 *   "Submitted ✓" indicator.
 *
 * Brief §13: date picker shows subtle dots for known-day states.
 *
 * Brief §20 + §21: All controls in the filter row use the same
 *   height / radius / border rhythm — no orphaned tall/wide dropdown.
 */

import { useMemo, useState, useEffect } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import { Search, CheckCheck, Upload, AlertCircle, CheckCircle2, Lock, CalendarClock, CalendarOff, ChevronLeft, FileEdit } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { type StaffAttendanceRecord, type AttendanceStatus, STAFF_DEFS, getStaffAttendanceForDate } from '@/lib/mock/attendance'
import {
  isHoliday as isSchoolHoliday,
  getHoliday as getSchoolHoliday,
  getPreviousWorkingDay,
  findPendingWorkingDays,
  type Holiday,
} from '@/lib/mock/school-calendar'
import { AnimatedCounter } from '@/components/shared/animated-counter'
import { toast } from 'sonner'
import { STATUS_META, STATUS_ORDER, StatusBadge } from './attendance-status'
import {
  useStaffAttendanceStore,
  STAFF_TODAY_DATE,
  type StaffDateState,
} from '@/lib/store/staff-attendance-store'

const ROLES: StaffAttendanceRecord['role'][] = [
  'Teacher', 'Coordinator', 'Admin Staff', 'Librarian', 'Lab Assistant',
]

const TONE_CLASSES = {
  present: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-border hover:border-emerald-500/40' },
  late:    { text: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-500/5',    border: 'border-border hover:border-amber-500/40' },
  absent:  { text: 'text-rose-600 dark:text-rose-400',      bg: 'bg-rose-500/5',     border: 'border-border hover:border-rose-500/40' },
  leave:   { text: 'text-sky-600 dark:text-sky-400',         bg: 'bg-sky-500/5',      border: 'border-border hover:border-sky-500/40' },
} as const

/** Format date string (YYYY-MM-DD) for display. */
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function StaffAttendanceTab() {
  const reduce = useReducedMotion()
  const [selectedDate, setSelectedDate] = useState(STAFF_TODAY_DATE)
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [markAllConfirmOpen, setMarkAllConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Brief §2: Subscribe to the date-keyed store.
  // Note: we subscribe to the byDate map directly (NOT to a function that
  // returns a new object each call) — Zustand requires the selector result
  // to be referentially stable to avoid infinite re-render loops.
  const byDate = useStaffAttendanceStore((s) => s.byDate)
  const mark = useStaffAttendanceStore((s) => s.mark)
  const markAllPresentStore = useStaffAttendanceStore((s) => s.markAllPresent)
  const submit = useStaffAttendanceStore((s) => s.submit)

  // Compute the date state outside the selector — this is referentially
  // stable when byDate hasn't changed.
  const dateState = useMemo<StaffDateState>(() => {
    return byDate[selectedDate] ?? {
      date: selectedDate,
      submitted: false,
      submittedAt: null,
      submittedRecords: [],
      draft: null,
    }
  }, [byDate, selectedDate])

  // Brief PART 1-4: No date picker — page defaults to TODAY.
  // Brief PART 2-3: Previous working day navigation (skips weekends + holidays).
  // Brief PART 4: No future dates — no forward arrow.
  const isToday = selectedDate === STAFF_TODAY_DATE
  const prevWorkingDay = useMemo(() => {
    if (isToday) return getPreviousWorkingDay(selectedDate)
    return getPreviousWorkingDay(selectedDate)
  }, [selectedDate])

  // Brief PART 10: Find pending (unsubmitted) past working days.
  const pendingDays = useMemo(() => {
    return findPendingWorkingDays(STAFF_TODAY_DATE, byDate)
  }, [byDate])

  const handleGoToPrev = () => {
    setSelectedDate(prevWorkingDay)
  }

  const handleReturnToToday = () => {
    setSelectedDate(STAFF_TODAY_DATE)
  }

  // Brief PART 14-22 + PART 46: Authoritative state matrix.
  // Since we only navigate to past working days + today, isFuture should
  // never be true. But we keep the guard as a safety net.
  const isHoliday = useMemo(() => isSchoolHoliday(selectedDate), [selectedDate])
  const holidayInfo: Holiday | null = useMemo(() => getSchoolHoliday(selectedDate), [selectedDate])

  // Brief §11 + PART 46: explicit submission flag + future/holiday states determine editability.
  const isReadOnly = dateState.submitted
  const isEditable = !isHoliday && !dateState.submitted


  // Brief §27 + §5: detect unsaved changes for the selected date.
  // Computed reactively from the store subscription (re-renders when draft changes).
  const hasUnsaved = useMemo(() => {
    if (isReadOnly) return false
    if (!dateState.draft) return false
    // Compare against the default draft (what would have been generated if
    // the user hadn't touched anything) — detects "no changes from default".
    const defaultDraft = getStaffAttendanceForDate(selectedDate)
    if (defaultDraft.length !== dateState.draft.length) return true
    return dateState.draft.some((r, i) => {
      const base = defaultDraft[i]
      return base.status !== r.status || base.checkIn !== r.checkIn
    })
  }, [selectedDate, dateState.draft, isReadOnly])

  // Brief PART 1-4: records is null for holiday dates (future is impossible
  // via the previous-working-day navigation model).
  // Only submitted or draft records produce non-null records.
  // For empty past/today dates — show a clean "start attendance" empty state.
  const records: StaffAttendanceRecord[] | null = useMemo(() => {
    // Holiday dates: NO records at all — empty state handles the display
    if (isHoliday) return null
    // Submitted: show the frozen submitted snapshot
    if (dateState.submitted) return dateState.submittedRecords
    // Draft exists: show the draft (user may have modified it)
    if (dateState.draft) return dateState.draft
    // Empty past/today date: NO records — show "start attendance" state
    return null
  }, [dateState, isHoliday])

  const summary = useMemo(() => {
    if (!records) return { total: 0, present: 0, late: 0, absent: 0, leave: 0 }
    return records.reduce(
      (acc, r) => {
        acc.total++
        acc[r.status]++
        return acc
      },
      { total: 0, present: 0, late: 0, absent: 0, leave: 0 }
    )
  }, [records])

  const filtered = useMemo(() => {
    if (!records) return []
    return records.filter((r) => {
      if (roleFilter !== 'all' && r.role !== roleFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.name.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q) && !r.department.toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })
  }, [records, roleFilter, search])

  // Brief §25: subtle transition when date changes — clears search/role
  // filters so the new date's full roster is visible.
  useEffect(() => {
    setRoleFilter('all')
    setSearch('')
  }, [selectedDate])

  // Brief §6: mark a staff member — store enforces read-only guard.
  const handleMark = (id: string, status: AttendanceStatus) => {
    if (!isEditable) return
    mark(selectedDate, id, status)
  }

  // Brief §3 + §19 + §28: Mark All Present (with confirmation).
  const handleMarkAllPresent = () => {
    setMarkAllConfirmOpen(false)
    if (!isEditable) return
    markAllPresentStore(selectedDate)
    toast.success('All staff marked present', {
      description: 'Review and submit attendance to confirm.',
    })
  }

  // Brief §7 + §15 + §17: Submit Attendance.
  const handleSubmit = () => {
    if (!isEditable || submitting) return
    setSubmitting(true)
    setTimeout(() => {
      const ok = submit(selectedDate)
      setSubmitting(false)
      if (ok) {
        toast.success('Attendance submitted', {
          description: `${summary.present} present · ${summary.late} late · ${summary.absent} absent · ${summary.leave} leave`,
        })
      } else {
        // Brief §15: rejected (already submitted)
        toast.error('Attendance already submitted', {
          description: 'This date is locked and read-only.',
        })
      }
    }, 800)
  }

  return (
    <PageTransition className="space-y-4">
      {/* Brief PART 1-5: Clean header — TODAY as primary, previous-working-day
          navigation as small control. No date picker.
          Brief PART 10: Pending submissions indicator. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Brief PART 2-3: Previous working day navigation */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={handleGoToPrev}
            title={`Previous working day · ${formatDisplayDate(prevWorkingDay)}`}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous working day</span>
            <span className="sm:hidden">‹</span>
          </Button>

          {/* Brief PART 5 + 29: Current date label — prominent */}
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              {isToday ? 'Today' : formatDisplayDate(selectedDate)}
            </span>
            {!isToday && (
              <button
                onClick={handleReturnToToday}
                className="text-[10px] text-primary hover:underline underline-offset-2 text-left"
              >
                ← Back to today
              </button>
            )}
          </div>
        </div>

        {/* Brief PART 10-11: Pending submissions indicator */}
        <div className="flex items-center gap-2">
          {pendingDays.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline underline-offset-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {pendingDays.length} pending
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2" sideOffset={4}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                  Pending attendance submissions
                </p>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {pendingDays.map((d) => (
                    <button
                      key={d}
                      onClick={() => { setSelectedDate(d) }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-muted-foreground">{formatDisplayDate(d)}</span>
                      <span className="text-amber-600 dark:text-amber-400 font-medium text-[10px]">Pending</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Up to date
            </span>
          )}

          {/* Brief PART 9: State indicator */}
          <span className="text-[10px] text-muted-foreground font-medium">
            {dateState.submitted ? 'Submitted · Read only'
              : dateState.draft ? (hasUnsaved ? 'Unsaved changes' : 'Draft')
              : 'Not started'}
          </span>
        </div>
      </div>

      {/* Brief §2: Staff KPI cards — only shown when records exist */}
      {records && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUS_ORDER.map((status, i) => {
          const meta = STATUS_META[status]
          const Icon = meta.icon
          const value = summary[status]
          const tone = TONE_CLASSES[status]
          return (
            <motion.div
              key={status}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={`rounded-xl border p-3 sm:p-4 transition-colors ${tone.bg} ${tone.border}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                  {meta.label}
                </span>
                <Icon className={`h-3.5 w-3.5 ${tone.text}`} />
              </div>
              <p className={`font-display text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${tone.text}`}>
                <AnimatedCounter value={value} duration={0.7} />
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {summary.total > 0 ? ((value / summary.total) * 100).toFixed(1) : '0.0'}% of {summary.total} staff
              </p>
            </motion.div>
          )
        })}
      </div>
      )}

      {/* Brief §24: Submitted / Read-only banner (only for submitted dates) */}
      <AnimatePresence mode="wait">
        {/* Brief PART 10 + PART 13: Holiday banner */}
        {isHoliday && (
          <motion.div
            key="holiday-banner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2"
          >
            <CalendarOff className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">School Holiday{holidayInfo ? ` · ${holidayInfo.name}` : ''}</span>
            <span className="text-violet-600/70 dark:text-violet-400/70">·</span>
            <span className="text-violet-700/80 dark:text-violet-300/80">
              {formatDisplayDate(selectedDate)} · No attendance marked
            </span>
          </motion.div>
        )}
        {/* Brief PART 4 + 5: Submitted / Read-only banner */}
        {!isHoliday && dateState.submitted && (
          <motion.div
            key="readonly-banner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">Attendance submitted</span>
            <span className="text-emerald-600/70 dark:text-emerald-400/70">·</span>
            <span className="text-emerald-700/80 dark:text-emerald-300/80">
              {formatDisplayDate(selectedDate)} · Read only
            </span>
          </motion.div>
        )}
        {/* Brief PART 8-9: Pending submission banner */}
        {!isHoliday && !dateState.submitted && dateState.draft && hasUnsaved && !isToday && (
          <motion.div
            key="pending-banner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">Submission pending</span>
            <span className="text-amber-600/70 dark:text-amber-400/70">·</span>
            <span className="text-amber-700/80 dark:text-amber-300/80">
              {formatDisplayDate(selectedDate)} · Attendance not submitted
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brief PART 10 + PART 31: Premium empty states for non-editable dates.
          When records is null, NO attendance table is rendered.
          Each state has its own icon + message + visual treatment. */}
      <AnimatePresence mode="wait">
        {isHoliday ? (
          <motion.div
            key="holiday-empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-16 px-4 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 mb-4">
              <CalendarOff className="h-6 w-6 text-violet-600 dark:text-violet-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">School Holiday</h3>
            {holidayInfo && (
              <p className="text-xs font-medium text-violet-600 dark:text-violet-400">{holidayInfo.name}</p>
            )}
            <p className="text-[11px] text-muted-foreground/70 mt-2 max-w-xs">
              {formatDisplayDate(selectedDate)} · Attendance is not required on school holidays.
            </p>
          </motion.div>
        ) : !records ? (
          <motion.div
            key="empty-start"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-16 px-4 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 mb-4">
              <FileEdit className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No attendance recorded</h3>
            <p className="text-xs text-muted-foreground">{formatDisplayDate(selectedDate)}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-2 max-w-xs mb-4">
              Start marking attendance for {STAFF_DEFS.length} staff members on this date.
            </p>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => markAllPresentStore(selectedDate)}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Start attendance
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="table"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Filter row — only shown when records exist */}
            <div className="flex flex-wrap items-center gap-2 justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger size="sm" className="w-[150px] text-xs rounded-lg">
                    <SelectValue placeholder="All Roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search staff…"
                    className="h-8 pl-8 pr-3 text-xs w-[200px] rounded-lg"
                  />
                </div>

                {isEditable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 rounded-lg"
                    onClick={() => setMarkAllConfirmOpen(true)}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all present
                  </Button>
                )}
              </div>

              <span className="text-[10px] text-muted-foreground">
                {filtered.length} staff
              </span>
            </div>

            {/* Staff table */}
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Name</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden sm:table-cell">Role</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden md:table-cell">Department</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden sm:table-cell">Check-in</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">
                      {isReadOnly ? '' : 'Mark'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence mode="popLayout">
                    {filtered.map((r, i) => (
                      <StaffRow
                        key={`${r.id}-${selectedDate}`}
                        record={r}
                        index={i}
                        reduce={reduce}
                        isReadOnly={isReadOnly}
                        onMark={handleMark}
                      />
                    ))}
                  </AnimatePresence>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                        No staff found matching filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Submit / status bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1 mt-3">
              <div className="flex items-center gap-2 text-xs">
                <AnimatePresence mode="wait">
                  {dateState.submitted ? (
                    <motion.span
                      key="readonly"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Read only — submitted {dateState.submittedAt ? new Date(dateState.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                    </motion.span>
                  ) : hasUnsaved ? (
                    <motion.span
                      key="unsaved"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      Unsaved changes · not submitted
                    </motion.span>
                  ) : (
                    <motion.span
                      key="draft"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="flex items-center gap-1.5 text-muted-foreground"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Attendance draft · not submitted
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {isEditable && (
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSubmit}
                  disabled={!hasUnsaved || submitting}
                >
                  {submitting ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </motion.span>
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      Submit Attendance
                    </>
                  )}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brief §28: Mark All Present confirmation */}
      <AlertDialog open={markAllConfirmOpen} onOpenChange={setMarkAllConfirmOpen}>
        <AlertDialogContent className="max-w-sm p-0 gap-0">
          <AlertDialogHeader className="px-4 pt-4 pb-2">
            <AlertDialogTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCheck className="h-4 w-4 text-emerald-600" />
              Mark all staff as Present?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[10px]">
              This will overwrite the current attendance selections for all {STAFF_DEFS.length} staff members on {formatDisplayDate(selectedDate)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-4 py-3">
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleMarkAllPresent}
            >
              Mark all present
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  )
}

function StaffRow({
  record, index, reduce, isReadOnly, onMark,
}: {
  record: StaffAttendanceRecord
  index: number
  reduce: boolean | null
  isReadOnly: boolean
  onMark: (id: string, status: AttendanceStatus) => void
}) {
  return (
    <motion.tr
      layout
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.2), duration: 0.25 }}
      className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors text-xs"
    >
      <TableCell className="py-2.5">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{record.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono tabular-nums sm:hidden">{record.role} · {record.department}</p>
        </div>
      </TableCell>
      <TableCell className="py-2.5 hidden sm:table-cell text-muted-foreground">{record.role}</TableCell>
      <TableCell className="py-2.5 hidden md:table-cell text-muted-foreground">{record.department}</TableCell>
      <TableCell className="py-2.5">
        <StatusBadge status={record.status} />
      </TableCell>
      <TableCell className="py-2.5 hidden sm:table-cell font-mono tabular-nums text-muted-foreground">
        {record.checkIn ?? '—'}
      </TableCell>
      <TableCell className="py-2.5">
        {isReadOnly ? (
          // Brief §23: read-only column is empty — table stays crisp,
          // only the interaction layer is removed.
          <div className="flex justify-end">
            <Lock className="h-3 w-3 text-muted-foreground/40" />
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {STATUS_ORDER.map((status) => (
              <MarkButton
                key={status}
                id={record.id}
                status={status}
                current={record.status}
                onMark={onMark}
              />
            ))}
          </div>
        )}
      </TableCell>
    </motion.tr>
  )
}

/**
 * Brief §6: MarkButton with proper hover/press/selected states.
 */
function MarkButton({
  id, status, current, onMark,
}: {
  id: string
  status: AttendanceStatus
  current: AttendanceStatus
  onMark: (id: string, status: AttendanceStatus) => void
}) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  const isActive = current === status
  return (
    <button
      onClick={() => onMark(id, status)}
      title={`Mark ${meta.label}`}
      aria-label={`Mark ${meta.label}`}
      aria-pressed={isActive}
      className={`h-7 w-7 rounded-md border flex items-center justify-center transition-all duration-150 ${
        isActive
          ? `${meta.bgFilled} border-transparent text-white shadow-sm`
          : `border-border bg-card text-muted-foreground hover:bg-muted/60 hover:${meta.text}`
      }`}
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}
