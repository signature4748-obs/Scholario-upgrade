'use client'

/**
 * Student Timetable — MY CLASS view (the default mode).
 *
 * A student's personal academic schedule, presented as a VERTICAL,
 * chronological timeline — Period 1 ↓ 2 ↓ 3 ↓ Break ↓ 4 ↓ 5 ↓ Lunch ↓ 6 ↓ 7.
 * The class is resolved from enrollment (never chosen), the days come from
 * the school's real published timetable, and every slot is the Principal's
 * PUBLISHED data (live sync; recent publications surface as one subtle
 * "Updated" chip).
 *
 * Two scopes:
 *   - Day  (default): day selector + one day's timeline with NOW/NEXT
 *   - Full Week: every school day as a clean vertical block — readability
 *     over density (never 7 squeezed columns)
 */
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarDays, Clock, Sun, PartyPopper, RefreshCw, CalendarRange, LayoutList } from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { type DayType, type TimetableSlot } from '@/lib/timetable/config'
import {
  getRecentChangesForClass,
  getRecentChange,
  formatTimeAgo,
  type PublishedVersion,
} from '@/lib/store/timetable-store'
import { TimelineRow } from './timeline-row'
import { subjectColor } from './subject-colors'
import { useSchoolHolidays } from '@/lib/hooks/use-school-holidays'
import {
  buildDayEntries,
  endTimeLabel,
  holidayName,
  liveState,
  nextScheduledDay,
  nowMinutes,
  realTodayDay,
  scheduledDaysForClass,
  startTimeLabel,
  upcomingDayLabel,
  type DayEntry,
} from './time-utils'

type Scope = 'day' | 'week'

/** Live NOW/NEXT derivation — only for the selected day when it IS today. */
function useLiveBadges(entries: DayEntry[], isToday: boolean) {
  const [nowMin, setNowMin] = useState<number | null>(null)

  useEffect(() => {
    setNowMin(nowMinutes())
    const id = setInterval(() => setNowMin(nowMinutes()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!isToday || nowMin === null) {
    return { nowMin: null, states: new Map<number, 'completed' | 'current' | 'upcoming'>(), nextPeriod: null as number | null }
  }

  const states = new Map<number, 'completed' | 'current' | 'upcoming'>()
  let nextPeriod: number | null = null
  for (const e of entries) {
    if (e.isBreak || !e.slot) continue
    const st = liveState(e, nowMin)
    if (!st) continue
    states.set(e.period, st)
    if (st === 'upcoming' && nextPeriod === null) nextPeriod = e.period
  }
  return { nowMin, states, nextPeriod }
}

function formatClock(nowMin: number): string {
  const h24 = Math.floor(nowMin / 60)
  const min = nowMin % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(min).padStart(2, '0')} ${mer}`
}

export function ClassView({
  classLabel,
  section,
  sessionLabel,
  slots,
  publications,
}: {
  classLabel: string
  section: string
  sessionLabel: string
  slots: TimetableSlot[]
  publications: PublishedVersion[]
}) {
  const todayDay = realTodayDay()
  const scheduledDays = useMemo(() => scheduledDaysForClass(slots, classLabel), [slots, classLabel])
  const holidays = useSchoolHolidays()

  // Today is a school day only when the class is scheduled AND it is not a
  // calendar holiday (weekends can never be scheduled days by data model).
  const todayHolidayName = useMemo(() => {
    if (todayDay === 'Sunday') return 'Weekend'
    return holidayName(new Date(), holidays)
  }, [todayDay, holidays])
  const todayIsSchoolDay = todayDay !== 'Sunday' && scheduledDays.includes(todayDay) && todayHolidayName === null

  const nextDay = useMemo(() => nextScheduledDay(new Date(), new Set(scheduledDays), holidays), [scheduledDays, holidays])

  const defaultDay: DayType = todayIsSchoolDay ? todayDay : (nextDay?.day ?? scheduledDays[0] ?? 'Monday')
  const [selectedDay, setSelectedDay] = useState<DayType>(defaultDay)
  const [scope, setScope] = useState<Scope>('day')

  const selectedEntries = useMemo(() => buildDayEntries(slots, selectedDay, classLabel), [slots, selectedDay, classLabel])
  const viewingToday = selectedDay === todayDay && todayIsSchoolDay
  const { nowMin, states, nextPeriod } = useLiveBadges(selectedEntries, viewingToday)

  // Recent published changes affecting MY class (72h TTL inside the helper)
  const recentChanges = useMemo(() => getRecentChangesForClass(classLabel, publications), [classLabel, publications])
  const changeBySlot = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof getRecentChange>>>()
    for (const c of recentChanges) m.set(c.slotId, c)
    return m
  }, [recentChanges])

  const mySubjectCount = useMemo(
    () => new Set(slots.filter((s) => s.className === classLabel).map((s) => s.subject)).size,
    [slots, classLabel]
  )

  const dayPeriods = selectedEntries.filter((e) => !e.isBreak && e.slot).length
  const dayRange =
    selectedEntries.length > 0
      ? `${startTimeLabel(selectedEntries[0].time)} – ${endTimeLabel(selectedEntries[selectedEntries.length - 1].time)}`
      : ''

  /* ── Unpublished / empty state ── */
  if (scheduledDays.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-semibold">No timetable for {classLabel} yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your school has not published a timetable for your class — check back soon.
        </p>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ── Class context — enrollment-derived, never chosen ── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">My Class</p>
        <h2 className="mt-0.5 text-lg font-bold tracking-tight text-foreground">
          {classLabel} <span className="font-medium text-muted-foreground">· Section {section}</span>
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span>{sessionLabel}</span>
          <span aria-hidden className="text-border">•</span>
          <span>
            {scheduledDays.length} school day{scheduledDays.length === 1 ? '' : 's'} · {mySubjectCount} subjects
          </span>
          {recentChanges.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              title={`Timetable updated by your school — latest ${formatTimeAgo(recentChanges[0].publishedAt)}`}
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Updated {formatTimeAgo(recentChanges[0].publishedAt)}
            </span>
          )}
        </div>
      </div>

      {/* ── Day selector + scope toggle (only the school's real days) ── */}
      <GlassCard className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {scope === 'day' ? (
            <div role="tablist" aria-label="Select day" className="flex flex-wrap gap-1.5">
              {scheduledDays.map((day) => {
                const isToday = day === todayDay && todayIsSchoolDay
                const active = day === selectedDay
                return (
                  <button
                    key={day}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      'relative min-w-[60px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                      active
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      isToday && !active && 'border-primary/40 ring-1 ring-primary/25'
                    )}
                  >
                    {day.slice(0, 3)}
                    {isToday && (
                      <span
                        className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', active ? 'bg-primary-foreground' : 'bg-primary')}
                        title="Today"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {scheduledDays.length} school day{scheduledDays.length === 1 ? '' : 's'} · one block per day
            </p>
          )}

          {/* Day / Full Week scope */}
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border bg-card p-0.5 shadow-2xs" role="tablist" aria-label="Timetable scope">
            <button
              role="tab"
              aria-selected={scope === 'day'}
              onClick={() => setScope('day')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                scope === 'day' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutList className="h-3.5 w-3.5" aria-hidden /> Day
            </button>
            <button
              role="tab"
              aria-selected={scope === 'week'}
              onClick={() => setScope('week')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                scope === 'week' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <CalendarRange className="h-3.5 w-3.5" aria-hidden /> Full Week
            </button>
          </div>
        </div>
      </GlassCard>

      {/* ── No-classes-today notice (holiday / weekend) — honest, compact ── */}
      {todayHolidayName && scope === 'day' && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {todayHolidayName === 'Weekend' ? <Sun className="h-4 w-4" aria-hidden /> : <PartyPopper className="h-4 w-4" aria-hidden />}
          </span>
          <p className="min-w-0 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">No classes today</span>
            {todayHolidayName === 'Weekend'
              ? ' — enjoy your weekend.'
              : ` — ${todayHolidayName}, a school holiday.`}
            {nextDay && <span> Next school day: {nextDay.day}, {nextDay.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.</span>}
          </p>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────
          DAY SCOPE — the vertical chronological timeline
         ──────────────────────────────────────────────────────────────── */}
      {scope === 'day' && (
        <GlassCard className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-bold tracking-tight text-foreground">
                {upcomingDayLabel(selectedDay, todayDay)}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {dayPeriods > 0 ? `${dayPeriods} periods · ${dayRange}` : `No classes for ${classLabel}`}
              </p>
            </div>
            {nowMin !== null && viewingToday && dayPeriods > 0 && (
              <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
                {formatClock(nowMin)}
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.ol
              key={selectedDay}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="m-0 list-none p-0"
              aria-label={`${classLabel} ${selectedDay} timeline`}
            >
              {selectedEntries.map((entry, i) => (
                <TimelineRow
                  key={entry.period}
                  entry={entry}
                  isFirst={i === 0}
                  isLast={i === selectedEntries.length - 1}
                  live={states.get(entry.period) ?? null}
                  badge={nextPeriod === entry.period ? 'next' : null}
                  change={entry.slot ? changeBySlot.get(entry.slot.id) ?? null : null}
                />
              ))}
              {selectedEntries.length === 0 && (
                <li className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
                  No classes scheduled for {classLabel} on {selectedDay}.
                </li>
              )}
            </motion.ol>
          </AnimatePresence>
        </GlassCard>
      )}

      {/* ────────────────────────────────────────────────────────────────
          FULL WEEK SCOPE — one clean vertical block per school day
         ──────────────────────────────────────────────────────────────── */}
      {scope === 'week' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {scheduledDays.map((day) => (
            <WeekBlock
              key={day}
              day={day}
              isToday={day === todayDay && todayIsSchoolDay}
              entries={buildDayEntries(slots, day, classLabel)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Full Week: one day = one vertical block ───────────────────────── */

function WeekBlock({ day, isToday, entries }: { day: DayType; isToday: boolean; entries: DayEntry[] }) {
  const periods = entries.filter((e) => !e.isBreak && e.slot).length
  const range =
    entries.length > 0
      ? `${startTimeLabel(entries[0].time)} – ${endTimeLabel(entries[entries.length - 1].time)}`
      : ''
  return (
    <GlassCard className="p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className={cn('text-sm font-bold tracking-tight', isToday && 'text-primary')}>{day}</h3>
          {isToday && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Today
            </span>
          )}
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {periods > 0 ? `${periods} periods · ${range}` : 'No classes'}
        </span>
      </div>

      <ol className="m-0 list-none space-y-0.5 p-0" aria-label={`${day} schedule`}>
        {entries.map((entry) =>
          entry.isBreak ? (
            <li key={entry.period} className="flex items-center gap-2 py-1" aria-label={`${entry.name}, ${entry.time}`}>
              <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden />
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {entry.breakType === 'lunch' ? 'Lunch' : 'Break'} · {startTimeLabel(entry.time)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden />
            </li>
          ) : entry.slot ? (
            <li
              key={entry.period}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40"
              aria-label={`${entry.name}, ${entry.time}, ${entry.slot.subject}, ${entry.slot.teacherName}, ${entry.slot.room}`}
            >
              <span className="w-11 shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {startTimeLabel(entry.time).replace(/ (AM|PM)/, '')}
              </span>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', subjectColor(entry.slot.subject).dot)} aria-hidden />
              <span className={cn('min-w-0 truncate text-xs font-semibold', subjectColor(entry.slot.subject).text)}>
                {entry.slot.subject}
              </span>
              <span className="ml-auto hidden min-w-0 items-center gap-1 text-[10px] text-muted-foreground sm:flex">
                <span className="max-w-[110px] truncate">{entry.slot.teacherName}</span>
                <span aria-hidden className="text-border">·</span>
                <span className="max-w-[80px] shrink-0 truncate">{entry.slot.room}</span>
              </span>
            </li>
          ) : null
        )}
        {entries.length === 0 && (
          <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            No classes scheduled.
          </li>
        )}
      </ol>
    </GlassCard>
  )
}
