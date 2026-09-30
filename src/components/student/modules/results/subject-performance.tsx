'use client'

/**
 * results/subject-performance — the core of Results (§9/§10, gen 2).
 *
 * One of the strongest sections of the page: elegant expandable subject
 * rows that sit DIRECTLY ON THE PAGE (§34 — no card-inside-card border
 * fatigue). Hierarchy comes from spacing, hairline dividers and the
 * subject's own colour identity:
 *   · each subject carries its canonical Timetable colour (one visual
 *     identity system across modules — Mathematics violet here AND in
 *     the timetable, never a local copy)
 *   · a proportional performance bar with the grade's tone
 *   · expansion reveals ONLY the components the school actually
 *     configured — single-paper subjects say so, factually
 *
 * Responsive: the row reflows comfortably at iPad widths; the bar never
 * shrinks to invisibility; touch targets stay generous.
 */

import { useState } from 'react'
import { ChevronDown, FileCheck2, Layers } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fmtPct, pctOf, type SubjectMark } from '@/lib/store/student-results-store'
import { subjectColor } from '../timetable/subject-colors'
import { gradeTone } from './grade-tone'
import { SectionLabel } from '../../shell/page-header'

interface SubjectPerformanceProps {
  subjects: SubjectMark[]
  gradeFor: (pct: number) => string
}

export function SubjectPerformance({ subjects, gradeFor }: SubjectPerformanceProps) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section aria-label="Subject performance">
      <SectionLabel hint={`${subjects.length} subjects`}>Subject Performance</SectionLabel>

      {/* Rows live directly on the page — hairline dividers, zero borders */}
      <div className="mt-2 divide-y divide-border/70">
        {subjects.map((s) => {
          const color = subjectColor(s.subject)
          const pct = pctOf(s.obtained, s.maxMarks)
          const grade = gradeFor(pct)
          const tone = gradeTone(grade)
          const isOpen = open === s.subject
          const hasComponents = (s.components?.length ?? 0) > 0
          return (
            <div key={s.subject} className={cn('transition-colors', isOpen && 'bg-muted/25')}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : s.subject)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-3.5 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:px-4"
              >
                {/* Subject identity — the Timetable's colour system */}
                <span
                  className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold ring-1', color.bg, color.text, color.ring)}
                  aria-hidden
                >
                  {s.subject.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-semibold text-foreground">{s.subject}</span>
                    {hasComponents && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/80">
                        <Layers className="h-2.5 w-2.5" aria-hidden />
                        {s.components!.length} components
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 flex items-center gap-2.5">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      {/* FINAL-GATE (EG-4B) — honest zero: a genuine 0% mark
                          renders an empty track, not a 2% sliver that reads
                          as a non-zero score. */}
                      <span
                        className={cn('block h-full rounded-full bg-gradient-to-r', color.gradient)}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">{fmtPct(pct)}%</span>
                  </span>
                </span>

                <span className="hidden shrink-0 text-right sm:block">
                  <span className="block text-sm font-bold tabular-nums text-foreground">{s.obtained}</span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">of {s.maxMarks}</span>
                </span>

                <span
                  className={cn('shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums', tone.badge)}
                >
                  {grade}
                </span>

                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform', isOpen && 'rotate-180')}
                  aria-hidden
                />
              </button>

              {/* ── Subject detail — only what actually exists ── */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-4 pt-0.5 sm:px-4 sm:pl-[4.25rem]">
                      <p className="mb-3 text-[11px] tabular-nums text-muted-foreground">
                        <span className="text-sm font-bold text-foreground">{s.obtained}</span> / {s.maxMarks} ·{' '}
                        {fmtPct(pct)}% · Grade {grade}
                      </p>

                      {hasComponents ? (
                        <div className="space-y-2.5">
                          {s.components!.map((c) => {
                            const cpct = pctOf(c.obtained, c.max)
                            return (
                              <div key={c.name} className="flex items-center gap-3">
                                <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground/80">{c.name}</span>
                                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                                  <span
                                    className={cn('block h-full rounded-full bg-gradient-to-r', color.gradient)}
                                    style={{ width: `${Math.min(100, Math.max(0, cpct))}%` }}
                                  />
                                </span>
                                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/80">
                                  {c.obtained}/{c.max}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                          Single written paper · {s.maxMarks} marks
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </section>
  )
}
