'use client'

/**
 * Student Timetable — SCHOOL view: the read-only MASTER TIMETABLE.
 *
 * A true timetable "sheet" experience over the SAME published data the
 * Principal manages:
 *   - leftmost column = Period · Time (sticky while scrolling)
 *   - column headers = the school's real working days
 *   - rows = Period 1 / 2 / 3 / Break / 4 / 5 / Lunch / 6 / 7
 *   - every cell holds that day+period's classes (subject · teacher · room)
 *   - the student's OWN class carries a subtle highlight
 *   - tapping a cell opens a lightweight detail (NOT an admin modal)
 *
 * The full-week master sheet IS the experience — the class filter is a
 * quiet secondary control, never the primary interface. There is not a
 * single editing affordance in sight.
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Building2, Eye, User, MapPin, Clock, CalendarDays } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GlassCard } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { DAYS, PERIODS, type DayType, type TimetableSlot } from '@/lib/timetable/config'
import { endTimeLabel, realTodayDay, startTimeLabel } from './time-utils'
import { subjectColor } from './subject-colors'

/** Compact period label: "08:30 AM - 09:15 AM" → "8:30 – 9:15 AM". */
function periodRange(time: string): string {
  const start = startTimeLabel(time)
  const end = endTimeLabel(time)
  const startNoMer = start.replace(/ (AM|PM)/, '')
  return `${startNoMer} – ${end}`
}

export function SchoolView({
  slots,
  schoolName,
  sessionLabel,
  myClass,
}: {
  slots: TimetableSlot[]
  schoolName: string
  sessionLabel: string
  myClass: string
}) {
  const todayDay = realTodayDay()
  const [classFilter, setClassFilter] = useState<string>('all')

  const visibleSlots = useMemo(
    () => (classFilter === 'all' ? slots : slots.filter((s) => s.className === classFilter)),
    [slots, classFilter]
  )

  // School days + classes in natural order — derived from published data.
  const schoolDays = useMemo(() => {
    const present = new Set(slots.map((s) => s.day))
    return DAYS.filter((d) => present.has(d))
  }, [slots])
  const classes = useMemo(() => {
    const seen: string[] = []
    for (const s of slots) {
      if (!seen.includes(s.className)) seen.push(s.className)
    }
    return seen.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [slots])

  // Master grid: day → period → slots (sorted by class), built ONCE per
  // filter change — switching filters never refetches anything.
  const grid = useMemo(() => {
    const map = new Map<string, TimetableSlot[]>()
    for (const s of visibleSlots) {
      const key = `${s.day}|${s.period}`
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }))
    }
    return map
  }, [visibleSlots])

  // Row range: every period any visible class actually uses.
  const rows = useMemo(() => {
    if (visibleSlots.length === 0) return PERIODS
    let min = Infinity
    let max = -Infinity
    for (const s of visibleSlots) {
      if (s.period < min) min = s.period
      if (s.period > max) max = s.period
    }
    return PERIODS.filter((p) => p.number >= min && p.number <= max)
  }, [visibleSlots])

  const todayCol = schoolDays.includes(todayDay as DayType) ? (todayDay as DayType) : null

  /* ── Unpublished state ── */
  if (slots.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-semibold">School timetable not published yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your school has not published a master timetable — check back soon.
        </p>
      </GlassCard>
    )
  }

  const _cellEmpty = (day: DayType, period: number) => grid.get(`${day}|${period}`)?.length ?? 0

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ── School context — read-only master sheet identity ── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">School</p>
        <h2 className="mt-0.5 text-lg font-bold tracking-tight text-foreground">Master Timetable</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="truncate">{schoolName}</span>
          <span aria-hidden className="text-border">•</span>
          <span>{sessionLabel}</span>
          <span aria-hidden className="text-border">•</span>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3 text-primary" aria-hidden />
            View only · managed by your school
          </span>
        </div>
      </div>

      {/* ── Secondary class filter — quiet, never the main interface ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Filter</span>
        <FilterChip label="All Classes" active={classFilter === 'all'} onClick={() => setClassFilter('all')} />
        {classes.map((c) => (
          <FilterChip
            key={c}
            label={c.replace(/^Class /, '')}
            mine={c === myClass}
            active={classFilter === c}
            onClick={() => setClassFilter(c)}
          />
        ))}
      </div>

      {/* ── THE MASTER SHEET — full week, every class, every period ── */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto" role="region" aria-label="School master timetable — scroll horizontally to see all days">
          <table className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              {schoolName} master timetable for {sessionLabel} — periods by school day, one column per day
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-20 w-[112px] border-b border-r border-border bg-card px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Period · Time
                </th>
                {schoolDays.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className={cn(
                      'border-b border-border px-2 py-2.5 text-center',
                      day === todayCol && 'bg-primary/[0.05]'
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground">
                      {day}
                      {day === todayCol && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                          Today
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.isBreak ? (
                  /* ── Structural break row — one neutral spanning cell ── */
                  <tr key={row.number}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left align-middle"
                    >
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        {row.breakType === 'lunch' ? 'Lunch' : 'Break'}
                      </p>
                      <p className="text-[9px] tabular-nums text-muted-foreground/70">{periodRange(row.time)}</p>
                    </th>
                    <td colSpan={schoolDays.length} className="border-b border-border/70 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden />
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                          {row.breakType === 'lunch' ? 'Lunch Break' : 'Short Break'} · {periodRange(row.time)}
                        </span>
                        <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden />
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* ── Teaching period row ── */
                  <tr key={row.number}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-b border-border bg-card px-3 py-2 text-left align-middle"
                    >
                      <p className="text-xs font-bold text-foreground">{row.name.replace('Period ', 'P')}</p>
                      <p className="mt-0.5 text-[9px] tabular-nums text-muted-foreground">{periodRange(row.time)}</p>
                    </th>
                    {schoolDays.map((day) => {
                      const entries = grid.get(`${day}|${row.number}`)
                      return (
                        <td
                          key={day}
                          className={cn(
                            'border-b border-border/70 p-1.5 align-top',
                            day === todayCol && 'bg-primary/[0.03]'
                          )}
                        >
                          {entries && entries.length > 0 ? (
                            <div className="space-y-1">
                              {entries.map((s) => (
                                <MasterCellTile key={s.id} slot={s} day={day} mine={s.className === myClass} />
                              ))}
                            </div>
                          ) : (
                            <p className="px-2 py-1.5 text-center text-[10px] text-muted-foreground/40" aria-label="Free">
                              —
                            </p>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        {/* Sheet footer — reading aid, not a control */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" aria-hidden />
            {rows.filter((r) => !r.isBreak).length} periods · {schoolDays.length} days · {classes.length} classes
          </p>
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center rounded-md border border-primary/25 bg-primary/[0.06] px-1.5 py-px text-[9px] font-bold text-primary">
              {myClass.replace(/^Class /, '')}
            </span>
            your class
          </p>
        </div>
      </GlassCard>
    </div>
  )
}

/* ─── Quiet secondary filter chip ──────────────────────────────────── */

function FilterChip({
  label,
  active,
  onClick,
  mine,
}: {
  label: string
  active: boolean
  onClick: () => void
  mine?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all',
        active
          ? 'border-border bg-muted font-bold text-foreground'
          : 'border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground'
      )}
    >
      {mine && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="your class" />}
      {label}
    </button>
  )
}

/* ─── One class entry inside a master-sheet cell ────────────────────── */

function MasterCellTile({ slot, day, mine }: { slot: TimetableSlot; day: DayType; mine: boolean }) {
  const sc = subjectColor(slot.subject)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            'w-full cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            mine
              ? 'border-primary/40 bg-primary/[0.07] ring-1 ring-primary/25'
              : 'border-border/70 bg-card hover:border-primary/30 hover:bg-muted/40'
          )}
          aria-label={`${slot.className}, ${slot.subject}, ${slot.teacherName}, ${slot.room}, ${day}, ${slot.time}`}
        >
          <span className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', sc.dot)} aria-hidden />
            <span className={cn('min-w-0 truncate text-[11px] font-semibold', sc.text)}>{slot.subject}</span>
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center rounded-full px-1 py-px text-[9px] font-bold',
                mine ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              {slot.className.replace(/^Class /, '')}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
            {slot.teacherName} · {slot.room}
          </span>
        </motion.button>
      </PopoverTrigger>

      {/* Lightweight detail — subject / class / teacher / room / time / day */}
      <PopoverContent align="start" className="w-60 p-3.5" aria-label="Timetable entry details">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', sc.dot)} aria-hidden />
          <p className={cn('text-sm font-bold', sc.text)}>{slot.subject}</p>
          {mine && (
            <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
              Your class
            </span>
          )}
        </div>
        <dl className="mt-2.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <User className="h-3 w-3" aria-hidden /> Teacher
            </dt>
            <dd className="font-medium text-foreground">{slot.teacherName}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden /> Room
            </dt>
            <dd className="font-medium text-foreground">{slot.room}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <Building2 className="h-3 w-3" aria-hidden /> Class
            </dt>
            <dd className="font-medium text-foreground">{slot.className}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <CalendarDays className="h-3 w-3" aria-hidden /> Day
            </dt>
            <dd className="font-medium text-foreground">{day}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden /> Time
            </dt>
            <dd className="font-medium tabular-nums text-foreground">{periodRange(slot.time)}</dd>
          </div>
        </dl>
        <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
          {slot.type} · read-only — managed by your school
        </p>
      </PopoverContent>
    </Popover>
  )
}
