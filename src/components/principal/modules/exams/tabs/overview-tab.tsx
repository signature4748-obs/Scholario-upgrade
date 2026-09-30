'use client'

/**
 * ExamsOverviewTab — Principal Examination Control Dashboard.
 *
 * Three sections:
 *   1. Four KPI cards (Examinations, Marks Entry, Results, Current Status)
 *   2. Context-aware Examination Status (LIVE / UPCOMING / PERFORMANCE)
 *   3. Session Top Performers (top 3 podium + top performers list)
 *
 * The session picker is owned by the parent (index.tsx) — it sits on the
 * tab row right next to Overview/Exams/Reports/Settings. The selected
 * session drives the Session Top Performers section.
 *
 * All data from useExamsList (real API). Session Top Performers (7-b)
 * computes REAL toppers from GET /api/results aggregated per student
 * (the mock session rosters are retired).
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, ClipboardList, CheckCircle2, Activity,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExamDTO } from '@/lib/exams/types'
import { ExaminationContext } from './examination-context'
import { SessionTopPerformers } from './session-top-performers'
import { ExamComparison } from './exam-comparison'

interface Props {
  exams: ExamDTO[]
  classes: Array<{ id: string; name: string }>
  loading: boolean
  error: string | null
  session: string
  onSelectExam: (id: string) => void
  onGoToExams: () => void
  onNavigate?: (section: string) => void
}

export function ExamsOverviewTab({ exams, classes, loading, error, session, onSelectExam, onNavigate }: Props) {
  const data = useMemo(() => computeOverview(exams), [exams])

  if (loading) return <OverviewSkeleton />
  if (error) return <ErrorState error={error} />

  return (
    <div className="space-y-4">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Examinations"
          value={data.total}
          sub={`${data.completed} Completed · ${data.ongoing} Ongoing · ${data.upcoming} Upcoming`}
          icon={<FileText className="h-4 w-4" />}
          tone="emerald"
          delay={0}
        />
        <KpiCard
          label="Marks Entry"
          value={data.marksTotal > 0 ? `${data.marksEntered}/${data.marksTotal}` : '—'}
          sub={data.marksSub}
          icon={<ClipboardList className="h-4 w-4" />}
          tone="amber"
          delay={0.05}
        />
        <KpiCard
          label="Results Declared"
          value={data.total > 0 ? `${data.declared}/${data.total}` : '—'}
          sub={data.resultsSub}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="cyan"
          delay={0.1}
        />
        {/* Label reflects its data source (exams whose STATUS is ongoing —
            a record count, not a session verdict), so this card can never
            visually contradict the date-driven “No examination is currently
            active.” line in ExaminationContext below. */}
        <KpiCard
          label="Ongoing Exams"
          value={data.ongoing}
          sub={data.currentExam ? data.currentExam.name : 'None in progress'}
          icon={<Activity className="h-4 w-4" />}
          tone={data.ongoing > 0 ? 'amber' : 'sky'}
          delay={0.15}
        />
      </div>

      {/* Context-aware Examination Status (LIVE / UPCOMING / PERFORMANCE) */}
      <ExaminationContext exams={exams} onSelectExam={onSelectExam} onNavigate={onNavigate} />

      {/* Cross-exam comparison analytics */}
      <ExamComparison exams={exams} onSelectExam={onSelectExam} />

      {/* Session Top Performers — REAL aggregation of published results (7-b) */}
      <SessionTopPerformers session={session} classes={classes} />
    </div>
  )
}

// ─── Data computation ─────────────────────────────────────────────────

interface OverviewData {
  total: number
  completed: number
  ongoing: number
  upcoming: number
  declared: number
  marksTotal: number
  marksEntered: number
  marksSub: string
  resultsSub: string
  statusLabel: string
  statusSub: string
  statusTone: 'emerald' | 'amber' | 'sky' | 'rose'
  currentExam: ExamDTO | null
  nextExam: ExamDTO | null
}

function computeOverview(exams: ExamDTO[]): OverviewData {
  const total = exams.length
  const completed = exams.filter((e) => e.status.toLowerCase() === 'completed').length
  const ongoing = exams.filter((e) => e.status.toLowerCase() === 'ongoing').length
  const upcoming = exams.filter((e) => ['scheduled', 'draft'].includes(e.status.toLowerCase())).length
  const declared = exams.filter((e) => e.resultStatus.toLowerCase() === 'result declared').length

  // Marks: aggregate across all exams
  const marksTotal = exams.reduce((s, e) => s + e.markSummary.total, 0)
  const marksEntered = exams.reduce((s, e) => s + e.markSummary.entered, 0)

  let marksSub: string
  if (marksTotal === 0) {
    marksSub = 'No marks workflow active'
  } else if (marksEntered === marksTotal) {
    marksSub = 'All marks submitted'
  } else {
    const pct = marksTotal > 0 ? Math.round((marksEntered / marksTotal) * 100) : 0
    marksSub = `${pct}% completed`
  }

  let resultsSub: string
  if (total === 0) {
    resultsSub = 'No examinations'
  } else if (declared === total) {
    resultsSub = 'All results declared'
  } else {
    resultsSub = `${total - declared} remaining`
  }

  // Current exam: prefer Ongoing, then most recent Scheduled
  const currentExam = exams.find((e) => e.status.toLowerCase() === 'ongoing') ?? null

  // Next exam: upcoming, sorted by start date — only include exams whose
  // start date is today or later (past-dated 'Scheduled' exams are stale data)
  const nextExam = exams
    .filter((e) => e.status.toLowerCase() === 'scheduled')
    .filter((e) => !e.startDate || daysUntil(e.startDate) >= 0)
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0] ?? null

  // Status logic
  let statusLabel: string
  let statusSub: string
  let statusTone: 'emerald' | 'amber' | 'sky' | 'rose'

  if (currentExam) {
    statusLabel = 'Ongoing'
    statusSub = currentExam.name
    statusTone = 'amber'
  } else if (nextExam) {
    const days = nextExam.startDate ? daysUntil(nextExam.startDate) : null
    statusLabel = 'Upcoming'
    // Only show a positive countdown; if days is null show just the name
    statusSub = days !== null && days > 0 ? `${nextExam.name} · in ${days}d` : nextExam.name
    statusTone = 'sky'
  } else if (total > 0 && declared < total) {
    statusLabel = 'Action Needed'
    statusSub = `${total - declared} results pending`
    statusTone = 'rose'
  } else if (total > 0 && declared === total) {
    statusLabel = 'On Track'
    statusSub = 'All results declared'
    statusTone = 'emerald'
  } else {
    statusLabel = '—'
    statusSub = 'No examinations'
    statusTone = 'emerald'
  }

  return {
    total, completed, ongoing, upcoming, declared,
    marksTotal, marksEntered, marksSub, resultsSub,
    statusLabel, statusSub, statusTone,
    currentExam, nextExam,
  }
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── KPI Card ────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, tone, delay }: {
  label: string
  value: string | number
  sub: string
  icon: React.ReactNode
  tone: 'emerald' | 'amber' | 'sky' | 'rose' | 'cyan'
  delay: number
}) {
  const tones: Record<string, { text: string; bg: string }> = {
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/5' },
    amber: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/5' },
    sky: { text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/5' },
    rose: { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/5' },
    cyan: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/5' },
  }
  const t = tones[tone] ?? tones.emerald

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className={cn('rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm', t.bg)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{label}</span>
        <span className={t.text}>{icon}</span>
      </div>
      <p className={cn('font-display text-2xl font-bold tabular-nums tracking-tight', t.text)}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{sub}</p>
    </motion.div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex justify-between">
              <div className="h-2.5 w-16 rounded skeleton" />
              <div className="h-4 w-4 rounded skeleton" />
            </div>
            <div className="h-7 w-20 rounded skeleton" />
            <div className="h-2.5 w-24 rounded skeleton" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="h-3 w-32 rounded skeleton" />
        <div className="h-5 w-48 rounded skeleton" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg skeleton" />)}
        </div>
      </div>
      {/* Skeleton for Session Top Performers */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="h-4 w-44 rounded skeleton" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-lg skeleton" />)}
        </div>
      </div>
    </div>
  )
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-rose-500/50 mx-auto mb-3" />
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Unable to load examination overview</p>
      <p className="text-xs text-rose-600/70 mt-1">{error}</p>
    </div>
  )
}
