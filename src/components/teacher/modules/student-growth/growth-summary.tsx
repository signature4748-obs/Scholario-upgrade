'use client'

/**
 * growth-summary — the visual score components shared by the Student
 * Growth module and the student profile sheet (§4/§13/§24).
 *
 * Design language: clean, light, premium — a compact animated ring for the
 * overall score, quiet hairline bars for the dimension breakdown, a light
 * 8-week trend. NO giant hero, no gradients, no dashboard overload: the
 * hierarchy is SCORE → TREND → BREAKDOWN (§32).
 *
 * All animations are subtle, fast and respect prefers-reduced-motion (§25).
 */

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AreaTrendChart } from '@/components/shared/premium-charts'
import { GlassCard } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import type {
  FeeStandingDto,
  GrowthDimension,
  GrowthScoreDto,
  GrowthTrendPoint,
} from '@/lib/teacher-hub-types'
import {
  DIMENSION_CONFIG,
  GROWTH_CATEGORY_CONFIG,
  scoreRingClass,
  scoreTextClass,
  signedDelta,
} from './shared'

// ── count-up (§25 — the score number gently counts up) ───────────────────

export function useCountUp(value: number, duration = 700): number {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    if (reduce) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    if (from === value) return
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduce])

  return display
}

// ── the score ring (§4 — clean circular visualization) ───────────────────

export function GrowthScoreRing({
  score,
  monthDelta: _monthDelta,
  size = 120,
  label = 'Growth Score',
}: {
  score: number | null
  monthDelta: number
  size?: number
  label?: string
}) {
  const reduce = useReducedMotion()
  const shown = useCountUp(score ?? 0)
  const stroke = 8
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r

  // building state (§21) — an honest, quiet placeholder, never an invented score
  if (score == null) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="font-display text-3xl font-bold text-muted-foreground/60">—</span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Building
        </span>
      </div>
    )
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={scoreRingClass(score)}
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-display text-[1.7rem] font-bold leading-none tabular-nums', scoreTextClass(score))}>
          {shown}
        </span>
        <span className="mt-0.5 text-[9px] font-medium text-muted-foreground">/ 100</span>
      </div>
      <span className="sr-only">{`${label} ${score} of 100`}</span>
    </div>
  )
}

/** "+6 this month" — the explainable link to the point ledger. */
export function MonthDeltaChip({ monthDelta, className }: { monthDelta: number; className?: string }) {
  if (monthDelta === 0) return null
  const positive = monthDelta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
        positive
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      {positive ? '↑' : '↓'} {signedDelta(monthDelta)} this month
    </span>
  )
}

// ── dimension breakdown (§4 — quiet bars, hints for missing data) ────────

export function GrowthDimensions({
  dimensions,
  columns = false,
}: {
  dimensions: GrowthDimension[]
  columns?: boolean
}) {
  return (
    <div className={cn('gap-x-5 gap-y-2.5', columns ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col')}>
      {dimensions.map((d, i) => {
        const cfg = GROWTH_CATEGORY_CONFIG[d.category]
        const dimCfg = DIMENSION_CONFIG[d.category]
        return (
          <div key={d.category}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', d.value != null ? cfg.dot : 'bg-muted-foreground/30')} aria-hidden="true" />
                <span className="truncate">{dimCfg.label}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs font-semibold tabular-nums',
                  d.value != null ? cfg.text : 'text-muted-foreground/60',
                )}
              >
                {d.value != null ? d.value : '—'}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn('h-full rounded-full', d.category === 'IMPROVEMENT' ? 'bg-emerald-500/70' : 'bg-primary/70')}
                initial={false}
                animate={{ width: `${d.value ?? 0}%` }}
                transition={{ duration: 0.6, delay: i * 0.04, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
              {d.value != null
                ? d.category === 'IMPROVEMENT' && d.deltaLabel
                  ? `${d.deltaLabel} across recent exams`
                  : dimCfg.formulaHint
                : dimCfg.formulaHint}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── the 8-week trend (§12 — a clean lightweight chart) ───────────────────

export function GrowthTrendCard({ trend, title = 'Growth Trend' }: { trend: GrowthTrendPoint[]; title?: string }) {
  // FINAL-GATE (EG-4B) — only weeks with a REAL score are plotted. The old
  // `p.value ?? 0` mapping turned an interior null week (a week with no
  // attendance and no exam records) into a fabricated plunge to 0 —
  // zeros-as-data. Null weeks are now simply absent from the curve and the
  // header chip says how many of the window's weeks actually carry a score.
  const points = trend.filter((p) => p.value != null) as { label: string; value: number }[]
  const last = points[points.length - 1]?.value ?? null
  const first = points[0]?.value ?? null
  const overallDelta = last != null && first != null ? last - first : null

  return (
    <GlassCard hover={false} className="p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] text-muted-foreground">
          {points.length === 0
            ? 'no score history yet'
            : points.length === trend.length
              ? 'last 8 weeks'
              : `${points.length} of ${trend.length} weeks scored`}
        </span>
      </div>
      {points.length >= 2 ? (
        <>
          <AreaTrendChart
            data={points.map((p) => ({ label: p.label, primary: p.value }))}
            height={120}
            formatValue={(n) => `${Math.round(n)}`}
            showArea
            strokeWidth={2}
            className="[&_text]:fill-muted-foreground"
          />
          {overallDelta != null && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {overallDelta === 0
                ? 'Holding steady across the window'
                : `${signedDelta(overallDelta)} points of score movement since ${points[0].label}`}
            </p>
          )}
        </>
      ) : (
        <div className="flex h-[120px] flex-col items-center justify-center text-center">
          <p className="text-xs font-medium text-muted-foreground">Not enough history yet</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">
            The trend builds from weekly attendance and exam records.
          </p>
        </div>
      )}
    </GlassCard>
  )
}

// ── fee standing chip (§23 — administrative, ALWAYS separate) ────────────

export function FeeStandingChip({ standing }: { standing: FeeStandingDto }) {
  const tone =
    standing.standing === 'FULLY_PAID'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : standing.standing === 'OVERDUE'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : standing.standing === 'AWAITING_VERIFICATION'
          ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
          : 'border-border bg-muted/50 text-muted-foreground'
  const glyph =
    standing.standing === 'FULLY_PAID' ? '✓' : standing.standing === 'OVERDUE' ? '⏰' : '⚠'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone)}>
      <span aria-hidden="true">{glyph}</span>
      <span className="truncate">{standing.label}</span>
    </span>
  )
}

// ── compact header block used by the module + profile ────────────────────

export function GrowthScoreBlock({ score }: { score: GrowthScoreDto }) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <GrowthScoreRing score={score.score} monthDelta={score.monthDelta} size={116} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Growth Score
          </span>
          <MonthDeltaChip monthDelta={score.monthDelta} />
        </div>
        <GrowthDimensions dimensions={score.dimensions} />
        <p className="text-center text-[10px] text-muted-foreground/70 sm:text-left">
          Ledger: {signedDelta(score.totalPoints)} lifetime points · {score.eventCount} events
        </p>
      </div>
    </div>
  )
}
