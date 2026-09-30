'use client'

/**
 * results/insights — ACADEMIC INSIGHTS (§12, gen 2).
 *
 * "What actually changed?" — a strip of derived facts sitting directly on
 * the page (no card shell): overall movement, strongest subject, biggest
 * improvement, the subject to focus on next, and (when the school's
 * policy permits ranks) a small class-position fact. Every tile derives
 * from the canonical marks; a missing derivation collapses its tile —
 * never a fabricated motivational line (§38). Wording stays respectful
 * (§12: never shame the student).
 *
 * Subject movement — the per-subject prev→current story — lives behind a
 * quiet expandable toggle so the analytical depth exists without
 * cluttering the strip (§15: personal progress over comparison).
 */

import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, Focus, Minus, TrendingUp, Trophy } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fmtPct } from '@/lib/store/student-results-store'
import { subjectColor } from '../timetable/subject-colors'
import { SectionLabel } from '../../shell/page-header'

/** Per-subject movement row (previous → current, only shared subjects). */
export interface SubjectMovement {
  subject: string
  from: number
  to: number
}

/** The derived facts about the SELECTED result (index computes them). */
export interface InsightsSnapshot {
  strongest: { subject: string; pct: number } | null
  needsAttention: { subject: string; pct: number } | null
  mostImproved: { subject: string; delta: number } | null
}

interface InsightsProps {
  snapshot: InsightsSnapshot
  /** Overall delta vs the previous published assessment (null when none). */
  overallDelta: number | null
  previousName: string | null
  /** Class position facts — only passed when the school permits ranks. */
  classPosition: { rank: number; classSize: number } | null
  movement: SubjectMovement[]
}

export function Insights({ snapshot, overallDelta, previousName, classPosition, movement }: InsightsProps) {
  const [showMovement, setShowMovement] = useState(false)

  const tiles: {
    key: string
    icon: typeof TrendingUp
    label: string
    value: string
    sub?: string
    tone: { surface: string; text: string }
  }[] = []

  if (overallDelta != null && previousName) {
    const up = overallDelta > 0.05
    const down = overallDelta < -0.05
    tiles.push({
      key: 'movement',
      icon: up ? TrendingUp : down ? ArrowDownRight : Minus,
      label: 'Overall',
      value: `${up ? '+' : down ? '−' : ''}${fmtPct(Math.abs(overallDelta))}%`,
      sub: `${up ? 'Improved from' : down ? 'Down from' : 'Unchanged vs'} ${previousName}`,
      tone: up
        ? { surface: 'border-emerald-500/25 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.12]', text: 'text-emerald-600 dark:text-emerald-400' }
        : down
          ? { surface: 'border-rose-500/25 bg-rose-500/[0.06] dark:bg-rose-500/[0.10]', text: 'text-rose-600 dark:text-rose-400' }
          : { surface: 'border-border/80 bg-muted/40', text: 'text-foreground' },
    })
  }
  if (snapshot.strongest) {
    tiles.push({
      key: 'strongest',
      icon: TrendingUp,
      label: 'Your strongest',
      value: `${fmtPct(snapshot.strongest.pct)}%`,
      sub: snapshot.strongest.subject,
      tone: { surface: 'border-violet-500/25 bg-violet-500/[0.07] dark:bg-violet-500/[0.12]', text: 'text-violet-600 dark:text-violet-400' },
    })
  }
  if (snapshot.mostImproved) {
    tiles.push({
      key: 'improved',
      icon: ArrowUpRight,
      label: 'Biggest improvement',
      value: `+${fmtPct(snapshot.mostImproved.delta)}%`,
      sub: snapshot.mostImproved.subject,
      tone: { surface: 'border-emerald-500/25 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.12]', text: 'text-emerald-600 dark:text-emerald-400' },
    })
  }
  if (snapshot.needsAttention) {
    tiles.push({
      key: 'focus',
      icon: Focus,
      label: 'Focus next',
      value: `${fmtPct(snapshot.needsAttention.pct)}%`,
      sub: snapshot.needsAttention.subject,
      tone: { surface: 'border-amber-500/30 bg-amber-500/[0.08] dark:bg-amber-500/[0.12]', text: 'text-amber-600 dark:text-amber-400' },
    })
  }
  if (classPosition && classPosition.classSize > 1) {
    // FINAL-GATE (EG-4B) — "Top X%" is only an honest claim in the top half
    // (the hero and class-standings already gate it at ≤ 50%); a bottom-half
    // rank must not read as a gold-medal achievement ("Top 93%" with a
    // trophy). Value = the plain rank; the medal tone only for top-half.
    const topPct = Math.max(1, Math.round((classPosition.rank / classPosition.classSize) * 100))
    const topHalf = topPct <= 50
    tiles.push({
      key: 'position',
      icon: Trophy,
      label: 'Class position',
      value: `#${classPosition.rank}`,
      sub: topHalf
        ? `of ${classPosition.classSize} · top ${topPct}%`
        : `of ${classPosition.classSize} students`,
      tone: topHalf
        ? // Rank is achievement → gold/amber (the same medal language as the hero).
          { surface: 'border-amber-400/40 bg-amber-400/[0.09] dark:bg-amber-400/[0.13]', text: 'text-amber-700 dark:text-amber-400' }
        : { surface: 'border-border/80 bg-muted/40', text: 'text-foreground' },
    })
  }

  if (tiles.length === 0 && movement.length === 0) return null

  return (
    <section aria-label="Academic insights">
      <SectionLabel>Academic Insights</SectionLabel>

      {/* The strip — tinted fact tiles directly on the page */}
      <div className="mt-2 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon
          return (
            <div key={t.key} className={cn('rounded-xl border px-3.5 py-3', t.tone.surface)}>
              <div className="flex items-center gap-1.5">
                <Icon className={cn('h-3.5 w-3.5 shrink-0', t.tone.text)} aria-hidden />
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.label}</p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                <p className={cn('text-lg font-bold tabular-nums tracking-tight', t.tone.text)}>{t.value}</p>
                {t.sub && <p className="min-w-0 truncate text-xs font-medium text-foreground/80">{t.sub}</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Subject movement — analytical depth behind a quiet toggle */}
      {movement.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowMovement((v) => !v)}
            aria-expanded={showMovement}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showMovement && 'rotate-180')} aria-hidden />
            {showMovement ? 'Hide subject movement' : 'View subject movement'}
          </button>
          <AnimatePresence initial={false}>
            {showMovement && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0 divide-y divide-border/60 sm:grid-cols-2 lg:grid-cols-3">
                  {movement.map((m) => {
                    const delta = m.to - m.from
                    const color = subjectColor(m.subject)
                    const up = delta > 0.05
                    const down = delta < -0.05
                    return (
                      <div key={m.subject} className="flex items-center gap-2.5 py-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', color.dot)} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">{m.subject}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {fmtPct(m.from)}% <span className="text-muted-foreground/40" aria-hidden>→</span>{' '}
                          <span className="font-semibold text-foreground/85">{fmtPct(m.to)}%</span>
                        </span>
                        <span
                          className={cn(
                            'w-14 shrink-0 text-right text-[11px] font-bold tabular-nums',
                            up ? 'text-emerald-600 dark:text-emerald-400' : down ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                          )}
                        >
                          {up ? '+' : down ? '−' : '±'}
                          {fmtPct(Math.abs(delta))}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  )
}
