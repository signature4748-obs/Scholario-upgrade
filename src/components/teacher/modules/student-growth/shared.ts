'use client'

/**
 * Student Growth — shared client config + helpers.
 *
 * Pure config + pure functions (no data fetching): the visual language of
 * the growth system lives here so the module, the Add Points sheet, the
 * activity ledger and the shared student profile stay perfectly consistent.
 *
 * TONE RULES (§20 — supportive language, never labels):
 *   · positive points → emerald (recognition)
 *   · negative points → amber/rose by magnitude (needs attention — always
 *     reversible through future progress)
 *   · automatic source → a quiet "Automatic" chip, never a faceless
 *     "system" verdict.
 */

import type { GrowthEventItem } from '@/lib/teacher-hub-types'

export type {
  GrowthCategory,
  GrowthCategoryConfig,
  GrowthEventItem,
  GrowthEventSource,
  GrowthEventStatus,
  GrowthDimension,
  GrowthTrendPoint,
  GrowthScoreDto,
  FeeStanding,
  FeeStandingDto,
  GrowthPreset,
  GrowthSettingsDto,
  GrowthBand,
  GrowthClassSummary,
  GrowthScopeSummary,
  GrowthWorkspacePayload,
} from '@/lib/teacher-hub-types'
export {
  GROWTH_CATEGORY_CONFIG,
  GROWTH_BAND_LABELS,
  SOURCE_LABELS,
  isAutomaticSource,
  bandOf,
} from '@/lib/teacher-hub-types'

import type { GrowthCategory } from '@/lib/teacher-hub-types'

// ---------- point tone config ----------

/** The point chip classes — +N emerald, small -N amber, larger -N rose. */
export function pointsChipClass(points: number): string {
  if (points > 0) return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (points >= -2) return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300'
}

export function pointsTextClass(points: number): string {
  if (points > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (points >= -2) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

/** Signed label: +2 / −3 (minus sign U+2212 for typography). */
export function signedPoints(points: number): string {
  return `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points)}`
}

/** Signed label for score deltas: +6 / −4 (plain hyphen reads better in prose). */
export function signedDelta(v: number): string {
  return `${v > 0 ? '+' : ''}${v}`
}

/** Overall score tone — used by the ring + big number. */
export function scoreTextClass(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 55) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

export function scoreRingClass(score: number): string {
  if (score >= 75) return 'stroke-emerald-500'
  if (score >= 55) return 'stroke-amber-500'
  return 'stroke-rose-500'
}

// ---------- dimension config ----------

export interface DimensionConfig {
  label: string
  /** short one-line explanation of what feeds this dimension */
  formulaHint: string
}

export const DIMENSION_CONFIG: Record<GrowthCategory, DimensionConfig> = {
  ACADEMIC: {
    label: 'Academic',
    formulaHint: 'Latest exam average + academic recognition',
  },
  ATTENDANCE: {
    label: 'Attendance',
    formulaHint: 'Eligible attendance over the last 8 weeks (approved leave excluded)',
  },
  CONDUCT: {
    label: 'Conduct',
    formulaHint: 'Conduct points recorded in the last 90 days',
  },
  PARTICIPATION: {
    label: 'Participation',
    formulaHint: 'Participation points recorded in the last 90 days',
  },
  CONSISTENCY: {
    label: 'Consistency',
    formulaHint: 'Weekly attendance regularity over 8 weeks',
  },
  IMPROVEMENT: {
    label: 'Improvement',
    formulaHint: 'Exam-over-exam progress + improvement recognition',
  },
}

// ---------- dates ----------

/** "Today" / "Yesterday" / "18 Sep" — compact, en-IN. */
export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((day - today) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Format the automatic source reference for humans: 2026-W38 → "Week 38". */
export function periodLabelOf(event: GrowthEventItem): string | null {
  if (!event.period) return null
  if (event.period.startsWith('exam:')) return null
  const m = event.period.match(/^(\d{4})-W(\d{2})$/)
  return m ? `Week ${Number(m[2])}` : null
}

// ---------- tiny animation helpers ----------

/** The module's primary action recipe — the exact house toolbar button,
 *  shared by the toolbar, empty state and profile sheet. */
export const PRIMARY_ACTION_CLASS =
  'flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90'
