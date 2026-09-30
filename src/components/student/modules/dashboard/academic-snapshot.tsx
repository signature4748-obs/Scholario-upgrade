'use client'

/**
 * AcademicSnapshot (SD-3 · PHASE 8) — a polished, honest view of the
 * student's latest DECLARED assessment from the real Result rows:
 *
 *   · overall % + the exam name
 *   · subject-wise compact bars (only subjects that have marks)
 *   · class rank ONLY when it genuinely derives from classmates'
 *     results (position of N assessed) — never invented
 *   · the nearest upcoming exam as a quiet forward pointer
 */

import { motion } from 'framer-motion'
import { Award, CalendarRange, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { daysUntil } from './data'
import type { DashboardData } from './types'

export function AcademicSnapshot({ data, onNavigate }: {
  data: DashboardData
  onNavigate: (key: string) => void
}) {
  const ac = data.academics

  if (!ac?.latest) {
    return (
      <section aria-label="Academic performance" className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <Award className="mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">No results published yet</p>
          <p className="mt-0.5 max-w-[260px] text-xs text-muted-foreground">
            Your subject performance appears here after your first assessment result is declared.
          </p>
        </div>
      </section>
    )
  }

  const { latest, rank, upcomingExam } = ac
  const maxMarks = latest.subjects[0]?.totalMarks ?? 100
  const examDays = upcomingExam ? daysUntil(upcomingExam.startsAt) : null

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Academic performance"
      className="flex flex-col rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Award className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold tracking-tight">Academic Snapshot</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {latest.examName} · declared {new Date(latest.declaredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {rank && (
            <div className="text-right">
              <p className="font-display text-lg font-bold leading-none tabular-nums">
                #{rank.position}
              </p>
              <p className="text-[10px] text-muted-foreground">of {rank.assessedCount} assessed</p>
            </div>
          )}
          <div className="text-right">
            <p className="font-display text-lg font-bold leading-none tabular-nums text-primary">
              {latest.pct != null ? `${latest.pct}%` : '—'}
            </p>
            <p className="text-[10px] text-muted-foreground">overall</p>
          </div>
        </div>
      </div>

      {/* Subject bars — compact, readable, only real marks */}
      <ul className="mt-3.5 space-y-2">
        {latest.subjects.slice(0, 6).map((s, i) => {
          const pct = Math.round((s.marks / s.totalMarks) * 100)
          return (
            <li key={s.subject} className="flex items-center gap-2.5">
              <span className="w-[86px] shrink-0 truncate text-[11px] font-medium sm:w-[104px]">{s.subject}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: 0.2 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    'block h-full rounded-full',
                    pct >= 90 ? 'bg-emerald-500' : pct >= 80 ? 'bg-primary' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500',
                  )}
                />
              </span>
              <span className="w-[52px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {s.marks}/{s.totalMarks}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {upcomingExam && examDays != null && !Number.isNaN(examDays) ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarRange className="h-3 w-3 shrink-0 text-violet-500" aria-hidden />
            <span className="truncate">
              Next: {upcomingExam.examName}
              {examDays > 0 ? ` in ${examDays} day${examDays === 1 ? '' : 's'}` : ' — starts today'}
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Max {maxMarks} marks per subject</span>
        )}
        <button
          type="button"
          onClick={() => onNavigate('results')}
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          Results <ArrowUpRight className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </motion.section>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Award className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <h2 className="font-display text-sm font-bold tracking-tight">Academic Snapshot</h2>
        <p className="text-[11px] text-muted-foreground">Latest published assessment</p>
      </div>
    </div>
  )
}
