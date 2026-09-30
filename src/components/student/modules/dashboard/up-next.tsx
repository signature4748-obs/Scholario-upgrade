'use client'

/**
 * UpNext (SD-3 · PHASE 5) — the dashboard's PRIORITY CENTER.
 *
 * Aggregates the student's REAL action items from the server aggregate
 * and ranks them by urgency (time-aware):
 *
 *   · NEXT CLASS   the next period on today's timetable ("Starts in 18 min")
 *   · EXAM         the nearest upcoming exam for the class
 *   · TASK         the nearest planner task (due today/tomorrow first)
 *   · NOTICE       an unread important notice
 *   · FEES         an outstanding balance with a near due date
 *   · REVIEW       flashcards that are actually due
 *
 * Only items that exist render (PHASE 27 — no fabricated rows). The
 * Settings → Study Preferences gates still apply (SS-1).
 */

import { motion } from 'framer-motion'
import {
  Clock, Award, ListTodo, Megaphone, IndianRupee, Layers,
  ArrowUpRight, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStudentNotifPrefsStore } from '@/lib/store/student-notif-prefs-store'
import { classesWithState, daysUntil, dueLabel, formatTime } from './data'
import type { DashboardData } from './types'

interface UpNextItem {
  key: string
  kind: string
  icon: React.ReactNode
  tint: string
  title: string
  line1: string
  line2: string
  action: string
  navKey: string
  /** Lower = more urgent. */
  rank: number
}

export function UpNext({ data, onNavigate }: {
  data: DashboardData
  onNavigate: (key: string) => void
}) {
  const flashcardReminders = useStudentNotifPrefsStore((s) => s.learning.flashcardReminders)
  const plannerReminders = useStudentNotifPrefsStore((s) => s.learning.plannerReminders)

  const items: UpNextItem[] = []

  // ── Next class on today's timetable ────────────────────────────────
  const classes = classesWithState(data.timetable.week)
  const current = classes.find((c) => c.state === 'current')
  const next = current ?? classes.find((c) => c.state === 'next')
  if (current) {
    items.push({
      key: 'now-class',
      kind: current.state === 'current' ? 'NOW' : 'NEXT',
      icon: <Clock className="h-4 w-4" aria-hidden />,
      tint: 'emerald',
      title: current.subject,
      line1: `${formatTime(current.startTime)} – ${formatTime(current.endTime)}${current.room ? ` · ${current.room}` : ''}`,
      line2: current.teacherName
        ? `In class now · ends in ${Math.max(1, current.minutesUntil ?? 1)} min`
        : 'In class now',
      action: 'Timetable',
      navKey: 'timetable',
      rank: 0,
    })
  } else if (next) {
    items.push({
      key: 'next-class',
      kind: 'NEXT',
      icon: <Clock className="h-4 w-4" aria-hidden />,
      tint: 'emerald',
      title: next.subject,
      line1: `${formatTime(next.startTime)}${next.room ? ` · ${next.room}` : ''}`,
      line2: next.minutesUntil != null && next.minutesUntil > 0
        ? `Starts in ${next.minutesUntil < 60 ? `${next.minutesUntil} min` : `${Math.floor(next.minutesUntil / 60)} h ${next.minutesUntil % 60} min`}`
        : 'Starting soon',
      action: 'Timetable',
      navKey: 'timetable',
      rank: 0.5,
    })
  }

  // ── Upcoming exam ──────────────────────────────────────────────────
  const exam = data.academics?.upcomingExam
  if (exam) {
    const d = daysUntil(exam.startsAt)
    items.push({
      key: 'exam',
      kind: 'EXAM',
      icon: <Award className="h-4 w-4" aria-hidden />,
      tint: 'violet',
      title: exam.examName,
      line1: `Starts ${new Date(exam.startsAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
      line2: !Number.isNaN(d) && d <= 7 ? `${d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`}` : 'Scheduled',
      action: 'Results',
      navKey: 'results',
      rank: 1,
    })
  }

  // ── Nearest planner task ───────────────────────────────────────────
  const task = data.learning.nearestTask
  if (task && plannerReminders) {
    const d = task.dueDate ? daysUntil(task.dueDate) : null
    items.push({
      key: 'task',
      kind: 'TASK',
      icon: <ListTodo className="h-4 w-4" aria-hidden />,
      tint: 'amber',
      title: task.title,
      line1: task.dueDate ? dueLabel(task.dueDate) : 'From your study planner',
      line2: task.subjectName ?? 'Study planner',
      action: 'Planner',
      navKey: 'planner',
      rank: d != null && d <= 0 ? 1.2 : d != null && d === 1 ? 1.5 : 2.5,
    })
  }

  // ── Unread important notice ────────────────────────────────────────
  const important = data.notices.latest.find((n) => !n.read && (n.priority === 'HIGH' || n.priority === 'URGENT'))
  if (important) {
    items.push({
      key: 'notice',
      kind: 'NOTICE',
      icon: <Megaphone className="h-4 w-4" aria-hidden />,
      tint: 'rose',
      title: important.title,
      line1: `From ${important.sender}`,
      line2: `${new Date(important.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · unread`,
      action: 'Review',
      navKey: 'announcements',
      rank: 2,
    })
  }

  // ── Fees due soon ──────────────────────────────────────────────────
  const feeDue = data.fees.outstanding > 0 && data.fees.nearestDue
    ? daysUntil(data.fees.nearestDue)
    : null
  if (data.fees.outstanding > 0 && feeDue != null && !Number.isNaN(feeDue) && feeDue <= 14) {
    items.push({
      key: 'fees',
      kind: 'FEES',
      icon: <IndianRupee className="h-4 w-4" aria-hidden />,
      tint: 'sky',
      title: data.fees.items[0]?.title ?? 'Fee payment due',
      line1: dueLabel(data.fees.nearestDue),
      line2: 'Tap to view your dues',
      action: 'View fees',
      navKey: 'fees',
      rank: feeDue <= 3 ? 1.8 : 3,
    })
  }

  // ── Flashcards due ─────────────────────────────────────────────────
  if (flashcardReminders && data.learning.dueFlashcards > 0) {
    items.push({
      key: 'review',
      kind: 'REVIEW',
      icon: <Layers className="h-4 w-4" aria-hidden />,
      tint: 'violet',
      title: `${data.learning.dueFlashcards} flashcard${data.learning.dueFlashcards === 1 ? '' : 's'} due`,
      line1: 'Spaced repetition',
      line2: 'Ready for review',
      action: 'Review',
      navKey: 'flashcards',
      rank: 4,
    })
  }

  if (items.length === 0) {
    return (
      <section aria-label="Up next" className="rounded-2xl border border-dashed border-border bg-card/40 p-4 text-center">
        <p className="text-sm font-medium">Nothing needs your attention right now</p>
        <p className="mt-0.5 text-xs text-muted-foreground">New items appear here as your day develops.</p>
      </section>
    )
  }

  const ordered = items.sort((a, b) => a.rank - b.rank).slice(0, 4)
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Up next"
      className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Zap className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-sm font-bold tracking-tight">Up Next</h2>
          <p className="text-[11px] text-muted-foreground">Ranked by what needs you first</p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/70">
        {ordered.map((item, i) => (
          <motion.li
            key={item.key}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={() => onNavigate(item.navKey)}
              className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tints[item.tint] ?? tints.emerald)}>
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn(
                    'rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider',
                    item.kind === 'NOW' ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
                  )}>
                    {item.kind}
                  </span>
                  <span className="truncate text-sm font-semibold">{item.title}</span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{item.line1}</span>
                  {item.line2 && <span className="truncate text-muted-foreground">· {item.line2}</span>}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                {item.action}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.section>
  )
}
