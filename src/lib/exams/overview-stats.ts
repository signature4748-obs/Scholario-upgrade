/**
 * exam overview-stats — the pure Examinations-overview KPI computation.
 *
 * Extracted from src/components/principal/modules/exams/tabs/
 * overview-tab.tsx (2026-10-15) so the result-status canonicalisation
 * fix (see lib/exams/types.ts header comment) carries regression
 * coverage: the principal overview once counted `0/4` declared results
 * over a database holding two declared exams, because the counter
 * compared raw strings against one spelling while the data carried
 * another ('Result Declared' vs the legacy 'Declared' seed alias).
 *
 * All status/result-status comparisons go through the canonical helpers
 * (examStatusIs / isResultDeclared) — case- and alias-tolerant.
 */
import type { ExamDTO } from './types'
import { examStatusIs, isResultDeclared } from './types'

export interface OverviewData {
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

export function daysUntil(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export function computeOverview(exams: ExamDTO[]): OverviewData {
  const total = exams.length
  const completed = exams.filter((e) => examStatusIs(e.status, 'Completed')).length
  const ongoing = exams.filter((e) => examStatusIs(e.status, 'Ongoing')).length
  const upcoming = exams.filter((e) => examStatusIs(e.status, 'Scheduled') || examStatusIs(e.status, 'Draft')).length
  // Declared: canonical 'Result Declared' OR the legacy 'Declared' alias
  // (isResultDeclared) — never a raw string comparison.
  const declared = exams.filter((e) => isResultDeclared(e.resultStatus)).length

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
  const currentExam = exams.find((e) => examStatusIs(e.status, 'Ongoing')) ?? null

  // Next exam: upcoming, sorted by start date — only include exams whose
  // start date is today or later (past-dated 'Scheduled' exams are stale data)
  const nextExam = exams
    .filter((e) => examStatusIs(e.status, 'Scheduled'))
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
