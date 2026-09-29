'use client'

/**
 * ExaminationContext — context-aware academic status area.
 *
 * Replaces the old static "Current Examination" card.
 * Shows LIVE / UPCOMING / PERFORMANCE based on real schedule data.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, User, Calendar, Radio, ArrowRight, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExamDTO } from '@/lib/exams/types'
import { resolveExamContext, type ExamContext, type ScheduleItemContext } from './resolver'

interface Props {
  exams: ExamDTO[]
  onSelectExam: (id: string) => void
  onNavigate?: (s: string) => void
  className?: string
  classPerformance?: Array<{ className: string; averagePercentage: number }> | null
}

export function ExaminationContext({ exams, onSelectExam, onNavigate, classPerformance }: Props) {
  const ctx = resolveExamContext(exams)

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={ctx.state}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {ctx.state === 'LIVE' && (
          <LiveExamination ctx={ctx} onSelectExam={onSelectExam} />
        )}
        {ctx.state === 'UPCOMING' && (
          <UpcomingExamination ctx={ctx} onSelectExam={onSelectExam} onNavigate={onNavigate} />
        )}
        {ctx.state === 'PERFORMANCE' && (
          <SessionPerformance ctx={ctx} onSelectExam={onSelectExam} onNavigate={onNavigate} classPerformance={classPerformance} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

// ─── LIVE ────────────────────────────────────────────────────────────

function LiveExamination({ ctx, onSelectExam }: { ctx: ExamContext; onSelectExam: (id: string) => void }) {
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const _running = ctx.todaysSchedule.filter((s) => s.status === 'running')
  const _upcomingToday = ctx.todaysSchedule.filter((s) => s.status === 'upcoming_today')
  const _completedToday = ctx.todaysSchedule.filter((s) => s.status === 'completed_today')

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">Live Examination</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{todayLabel}</span>
      </div>

      {ctx.exam && (
        <div className="mb-3">
          <h2 className="font-display text-base font-bold tracking-tight">{ctx.exam.name}</h2>
          <p className="text-[11px] text-muted-foreground">{ctx.exam.type} · {[...new Set(ctx.exam.classes.map((c) => c.className))].join(', ') || '—'}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-1">
        {ctx.todaysSchedule.map((item, i) => (
          <TimelineItem key={item.id} item={item} index={i} />
        ))}
      </div>

      {/* Action */}
      {ctx.exam && (
        <div className="flex justify-end mt-3 pt-3 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onSelectExam(ctx.exam!.id)}>
            Open Examination <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

function TimelineItem({ item, index }: { item: ScheduleItemContext; index: number }) {
  const isRunning = item.status === 'running'
  const isCompleted = item.status === 'completed_today'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25 }}
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-lg border transition-colors',
        isRunning && 'border-emerald-500/30 bg-emerald-500/5',
        !isRunning && !isCompleted && 'border-border/60',
        isCompleted && 'border-border/40 opacity-60',
      )}
    >
      {/* Time */}
      <div className="shrink-0 text-right w-16">
        <p className="text-[10px] font-semibold tabular-nums">{item.startTime}</p>
        <p className="text-[9px] text-muted-foreground tabular-nums">{item.endTime}</p>
      </div>

      {/* Vertical line */}
      <div className={cn('w-px self-stretch', isRunning ? 'bg-emerald-500/40' : 'bg-border')} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-semibold truncate">{item.subjectName ?? '—'}</p>
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
              <Radio className="h-2.5 w-2.5 animate-pulse" /> LIVE
            </span>
          )}
          {!isRunning && !isCompleted && (
            <span className="text-[9px] text-amber-600 dark:text-amber-400 shrink-0">Upcoming</span>
          )}
          {isCompleted && (
            <span className="text-[9px] text-muted-foreground shrink-0">Done</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="truncate">{item.className}</span>
          {item.room && (
            <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {item.room}</span>
          )}
          {item.invigilatorName && (
            <span className="flex items-center gap-0.5"><User className="h-2.5 w-2.5" /> {item.invigilatorName}</span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── UPCOMING ────────────────────────────────────────────────────────

function UpcomingExamination({ ctx, onSelectExam, onNavigate }: {
  ctx: ExamContext
  onSelectExam: (id: string) => void
  onNavigate?: (s: string) => void
}) {
  const exam = ctx.nextExam
  if (!exam) return null

  const readiness = ctx.readiness
  const dateRange = exam.startDate && exam.endDate
    ? `${formatDate(exam.startDate)} — ${formatDate(exam.endDate)}`
    : exam.startDate ? formatDate(exam.startDate) : 'Date TBD'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl border border-sky-500/20 bg-card overflow-hidden"
    >
      {/* ─── Top band: exam identity ──────────────────────────────── */}
      <div className="px-5 py-4 bg-gradient-to-r from-sky-500/5 via-transparent to-transparent border-b border-border/40">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-sky-600 dark:text-sky-400">
                Upcoming Examination
              </span>
            </div>
            <h2 className="font-display text-lg font-bold tracking-tight truncate">{exam.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">{exam.type}</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {dateRange}
              </span>
              {exam.classes.length > 0 && (
                <>
                  <span className="text-muted-foreground/40">•</span>
                  <span className="truncate">{[...new Set(exam.classes.map((c) => c.className))].join(', ')}</span>
                </>
              )}
            </div>
          </div>
          {/* Days-until countdown — only show for positive future days */}
          {ctx.daysUntilNext !== null && ctx.daysUntilNext > 0 && (
            <div className="text-right shrink-0 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <p className="font-display text-2xl font-bold tabular-nums text-sky-600 dark:text-sky-400 leading-none">
                {ctx.daysUntilNext === 1 ? '1' : `${ctx.daysUntilNext}`}
              </p>
              <p className="text-[9px] text-sky-600/80 dark:text-sky-400/80 mt-0.5 font-medium uppercase tracking-wider">
                {ctx.daysUntilNext === 1 ? 'day left' : 'days left'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Middle: Exam Readiness + scheduled papers ─────────────── */}
      <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5">
        {/* Readiness column */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              Exam Readiness
            </span>
            <span className={cn(
              'font-display text-sm font-bold tabular-nums',
              readiness.overallPct >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
              readiness.overallPct >= 50 ? 'text-amber-600 dark:text-amber-400' :
              'text-rose-600 dark:text-rose-400',
            )}>
              {readiness.overallPct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden mb-3">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${readiness.overallPct}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'h-full rounded-full',
                readiness.overallPct >= 80 ? 'bg-emerald-500' :
                readiness.overallPct >= 50 ? 'bg-amber-500' : 'bg-rose-500',
              )}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
            <ReadinessItem label="Timetable" done={readiness.schedule} />
            <ReadinessItem label="Rooms" done={readiness.rooms} />
            <ReadinessItem label="Invigilators" done={readiness.invigilators} />
            <ReadinessItem label="Seating" done={readiness.seating} />
            <ReadinessItem label="Marks Setup" done={readiness.marksSetup} />
          </div>
        </div>

        {/* Scheduled papers column */}
        {ctx.upcomingPapers.length > 0 ? (
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-2">
              Scheduled Papers
            </span>
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
              {ctx.upcomingPapers.slice(0, 4).map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-2 p-1.5 rounded-md bg-muted/30 border border-border/40 text-[10px]"
                >
                  <div className="flex flex-col items-center w-9 shrink-0 py-0.5 rounded bg-card border border-border/60">
                    <span className="text-[8px] uppercase text-muted-foreground leading-none">{formatMonth(p.date)}</span>
                    <span className="font-display text-sm font-bold leading-tight">{formatDay(p.date)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{p.subjectName ?? '—'}</p>
                    <p className="text-muted-foreground tabular-nums">{p.startTime} · {p.className}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex items-center justify-center">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground italic">No papers scheduled yet</p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Action band ──────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40 bg-muted/20">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onSelectExam(exam.id)}>
          Open Examination <ArrowRight className="h-3 w-3" />
        </Button>
        {onNavigate && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onNavigate('schedule')}>
            View Schedule <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </motion.div>
  )
}

function ReadinessItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(
        'flex h-3.5 w-3.5 items-center justify-center rounded-full shrink-0 text-[8px] font-bold',
        done
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground/60',
      )}>
        {done ? '✓' : '○'}
      </span>
      <span className={cn(
        'text-[10px] truncate',
        done ? 'text-foreground font-medium' : 'text-muted-foreground',
      )}>
        {label}
      </span>
    </div>
  )
}

// ─── PERFORMANCE (no live/upcoming) ──────────────────────────────────

function SessionPerformance({ ctx, onSelectExam, onNavigate, classPerformance }: {
  ctx: ExamContext
  onSelectExam: (id: string) => void
  onNavigate?: (s: string) => void
  classPerformance?: Array<{ className: string; averagePercentage: number }> | null
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Session Performance</span>
        {ctx.nextExam && ctx.daysUntilNext !== null && ctx.daysUntilNext > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            Next exam in {ctx.daysUntilNext}d
          </span>
        )}
      </div>

      {ctx.nextExam && ctx.daysUntilNext !== null && ctx.daysUntilNext > 0 ? (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">No examination is currently active.</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-medium text-foreground">{ctx.nextExam.name}</span> starts in {ctx.daysUntilNext} days.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mt-2" onClick={() => onSelectExam(ctx.nextExam!.id)}>
            Open Examination <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">No examinations scheduled in the near term.</p>
      )}

      {/* Class-wise performance */}
      {classPerformance && classPerformance.length > 0 && (
        <div>
          <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5">Class-wise Average</p>
          <div className="space-y-1">
            {classPerformance.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-foreground w-24 shrink-0 truncate">{c.className}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${c.averagePercentage}%` }}
                    transition={{ duration: 0.5, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full bg-primary"
                  />
                </div>
                <span className="text-[10px] font-semibold tabular-nums w-10 text-right">{c.averagePercentage}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onNavigate && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onNavigate('results')}>
            View Performance <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatMonth(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { month: 'short' })
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? '—' : String(d.getDate())
}
