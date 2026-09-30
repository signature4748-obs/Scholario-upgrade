'use client'

/**
 * TodayClasses (SD-3 · PHASE 6) — derived from the REAL class timetable
 * (server Timetable rows for the student's class). The static mock
 * `lib/mock/academics` schedule is gone.
 *
 * Each period carries a live client-clock state:
 *   NOW (in class) · NEXT · UPCOMING · COMPLETED
 * The current period is visually distinguished with restraint — a live
 * rail + pulse dot, never a loud animation. Refreshes every 30s so the
 * states stay honest while the dashboard is open.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { classesWithState, formatTimeRange, type ClassWithState } from './data'
import type { DashboardData } from './types'

export function TodayClasses({ data }: { data: DashboardData }) {
  // Re-derive states on a quiet 30s cadence (no API refetch — the week
  // came in the single dashboard aggregate; only "now" moves).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
  const classes = classesWithState(data.timetable.week, now)
  const current = classes.find((c) => c.state === 'current')

  return (
    <section
      aria-label="Today's classes"
      className="flex flex-col rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold tracking-tight">Today&rsquo;s Classes</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {weekday} · {classes.length > 0 ? `${classes.length} periods` : 'no classes scheduled'}
              {data.student?.classLabel ? ` · ${data.student.classLabel}` : ''}
            </p>
          </div>
        </div>
        {current && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        )}
      </div>

      {classes.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
          <Clock className="mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">No classes today</p>
          <p className="mt-0.5 max-w-[240px] text-xs text-muted-foreground">
            Enjoy the break — your regular timetable resumes on the next school day.
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid flex-1 grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2 lg:max-h-none" style={{ maxHeight: undefined }}>
          {classes.map((c, i) => (
            <ClassRow key={c.id} c={c} i={i} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ClassRow({ c, i }: { c: ClassWithState; i: number }) {
  const isNow = c.state === 'current'
  const isNext = c.state === 'next'
  const isPast = c.state === 'completed'
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-xl border p-2.5 transition-colors',
        isNow && 'border-emerald-500/40 bg-emerald-500/[0.06]',
        isNext && 'border-primary/30 bg-primary/[0.03]',
        !isNow && !isNext && 'border-border/70 bg-background/40',
        isPast && 'opacity-60',
      )}
    >
      {isNow && <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-500" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className={cn('truncate text-sm font-semibold', isPast && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
            {c.subject}
          </p>
          {isNow && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Now
            </span>
          )}
          {isNext && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Next
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
          {formatTimeRange(c.startTime, c.endTime)}
          {c.teacherName ? ` · ${c.teacherName}` : ''}
          {c.room ? ` · ${c.room}` : ''}
        </p>
      </div>
      <span className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        isPast && 'bg-muted/60 text-muted-foreground',
        !isPast && 'bg-muted/60 text-foreground/70',
      )}>
        P{c.period}
      </span>
    </motion.li>
  )
}
