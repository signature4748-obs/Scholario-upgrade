'use client'

/**
 * SessionTopPerformers — premium academic achievement showcase.
 *
 * 7-b (Mock Data Elimination): the mock topper rosters are RETIRED. The
 * section now derives REAL top performers from GET /api/results
 * (PRINCIPAL scope = the school's published Result rows), aggregated per
 * student across the session's exams:
 *
 *   student session-percentage = sum(marks across the session's exams)
 *                                / sum(totalMarks across the same rows) × 100
 *   examsConsidered            = distinct exams with rows in the session
 *
 * Structure:
 *   1. Section header — "SESSION TOP PERFORMERS" + session label + meta
 *   2. Top 3 podium cards (with #1 visually emphasized)
 *   3. Compact Top Performers list (rank 4+)
 *   4. Honest empty state when no published results exist for the session
 *
 * Animations (all respect prefers-reduced-motion):
 *   • Section fades in
 *   • Top 3 cards slide in sequentially with stagger
 *   • Percentage count-up effect
 *   • List rows fade in with subtle stagger
 */

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, RotateCw, Trophy, Crown, Medal, Award, GraduationCap, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/exams/api-client'
import { getGradeForPercentage } from '@/lib/exams/types'
import {
  rankForIndex,
  type SessionTopper,
  type SessionSummary,
} from '@/lib/exams/session-toppers-data'

interface Props {
  session: string
  /** Live class directory (id → name) so toppers show their real class label. */
  classes: Array<{ id: string; name: string }>
}

/** The slice of a Result row the aggregation needs (PRINCIPAL scope). */
interface ResultRowDTO {
  studentId: string
  examId: string
  marks: number
  totalMarks: number
  exam?: { session?: string | null } | null
  student?: { rollNo?: string | null; classId?: string | null; user?: { name?: string | null } | null } | null
}

const AVATAR_TOKENS = ['emerald', 'sky', 'amber', 'violet', 'rose', 'cyan'] as const

/** Deterministic avatar colour from the student id (visual token only). */
function avatarTokenFor(studentId: string): string {
  let h = 0
  for (let i = 0; i < studentId.length; i++) h = (h * 31 + studentId.charCodeAt(i)) >>> 0
  return AVATAR_TOKENS[h % AVATAR_TOKENS.length]
}

/** Aggregate the session's published Result rows into the toppers list. */
export function buildSessionSummary(rows: ResultRowDTO[], session: string, classes: Array<{ id: string; name: string }>): SessionSummary | null {
  const inSession = rows.filter((r) => (r.exam?.session ?? '2025-2026') === session)
  if (inSession.length === 0) return null

  const classNameById = new Map(classes.map((c) => [c.id, c.name]))
  const exams = new Set<string>()
  const byStudent = new Map<
    string,
    { obtained: number; total: number; name: string; rollNo: string; className: string }
  >()

  for (const r of inSession) {
    exams.add(r.examId)
    const info = byStudent.get(r.studentId) ?? {
      obtained: 0,
      total: 0,
      name: r.student?.user?.name ?? 'Student',
      rollNo: r.student?.rollNo ?? '',
      className: r.student?.classId ? classNameById.get(r.student.classId) ?? '' : '',
    }
    info.obtained += r.marks
    info.total += r.totalMarks > 0 ? r.totalMarks : 100
    byStudent.set(r.studentId, info)
  }

  const toppers: SessionTopper[] = [...byStudent.entries()]
    .map(([studentId, info]) => {
      const percentage = info.total > 0 ? Math.round((info.obtained / info.total) * 1000) / 10 : 0
      const { grade } = getGradeForPercentage(percentage, [])
      return {
        studentId,
        name: info.name,
        rollNo: info.rollNo,
        className: info.className,
        section: null,
        stream: null,
        totalObtained: info.obtained,
        totalMax: info.total,
        percentage,
        grade,
        examsConsidered: exams.size,
        avatarColor: avatarTokenFor(studentId),
      }
    })
    .sort((a, b) => b.percentage - a.percentage || (a.rollNo < b.rollNo ? -1 : 1))
    .slice(0, 8)

  if (toppers.length === 0) return null
  return { session, studentCount: byStudent.size, examsConsidered: exams.size, toppers }
}

export function SessionTopPerformers({ session, classes }: Props) {
  const reduceMotion = useReducedMotion()
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // REAL data — the school's published Result rows (PRINCIPAL scope).
  // One fetch; the per-session aggregation happens client-side.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api<ResultRowDTO[]>('/api/results')
      .then((rows) => {
        if (cancelled) return
        setSummary(buildSessionSummary(Array.isArray(rows) ? rows : [], session, classes))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Results could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, classes, tick])

  // ─── Loading skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-5 space-y-4"
        aria-label="Session Top Performers"
        aria-busy="true"
      >
        <div className="h-4 w-44 rounded skeleton" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-lg skeleton" />
          ))}
        </div>
      </section>
    )
  }

  // ─── Error state — honest message + retry ──────────────────────────
  if (error) {
    return (
      <motion.section
        initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center"
        aria-label="Session Top Performers"
      >
        <AlertTriangle className="h-6 w-6 text-rose-500/60 mx-auto mb-2" />
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Top performers could not load</p>
        <p className="text-xs text-rose-600/70 mt-1 max-w-sm mx-auto">{error}</p>
        <Button size="sm" variant="outline" className="mt-3 h-7 gap-1 text-xs" onClick={() => setTick((t) => t + 1)}>
          <RotateCw className="h-3 w-3" /> Try again
        </Button>
      </motion.section>
    )
  }

  // ─── Empty state: session has no published results ─────────────────
  if (!summary) {
    return (
      <motion.section
        initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-border bg-card p-6 sm:p-8 text-center"
        aria-label="Session Top Performers"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 mb-3">
          <Trophy className="h-6 w-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-semibold text-foreground">No published results yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Session performance will appear here after examination results are published.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-3 font-medium">
          Session · {formatSessionLabel(session)}
        </p>
      </motion.section>
    )
  }

  const toppers = summary.toppers
  const top3 = toppers.slice(0, 3)
  const rest = toppers.slice(3)

  return (
    <motion.section
      initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
      aria-label="Session Top Performers"
    >
      {/* ─── Section header ──────────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-border/60 bg-gradient-to-r from-emerald-500/5 via-transparent to-amber-500/5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold tracking-tight">Session Top Performers</h2>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatSessionLabel(session)}
            </span>
            <span className="text-muted-foreground/40">•</span>
            <span>{summary.examsConsidered} examination{summary.examsConsidered === 1 ? '' : 's'} considered</span>
          </div>
        </div>
      </div>

      {/* ─── Top 3 podium ────────────────────────────────────────────── */}
      <div className="p-5 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {top3.map((t, i) => (
            <TopperPodiumCard
              key={t.studentId}
              topper={t}
              rank={rankForIndex(toppers, i)}
              index={i}
              isFeatured={i === 0}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
      </div>

      {/* ─── Top Performers list (rank 4+) ──────────────────────────── */}
      {rest.length > 0 && (
        <div className="px-5 pb-5">
          <div className="border-t border-border/60 pt-3">
            <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">
              Top Performers
            </p>
            <div className="space-y-0.5">
              {rest.map((t, i) => (
                <TopperListRow
                  key={t.studentId}
                  topper={t}
                  rank={rankForIndex(toppers, i + 3)}
                  index={i}
                  reduceMotion={reduceMotion}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.section>
  )
}

// ─── Top 3 Podium Card ──────────────────────────────────────────────

function TopperPodiumCard({
  topper,
  rank,
  index,
  isFeatured,
  reduceMotion,
}: {
  topper: SessionTopper
  rank: number
  index: number
  isFeatured: boolean
  reduceMotion: boolean | null
}) {
  const { Icon, iconColor, ringClass, badgeBg } = rankVisual(rank)
  const initials = getInitials(topper.name)
  const avatarBg = avatarColorClass(topper.avatarColor)
  const animatedPct = useCountUp(topper.percentage, 900, 300 + index * 150, reduceMotion)

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: reduceMotion ? 0 : 0.15 + index * 0.12,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={reduceMotion ? undefined : { y: -3 }}
      className={cn(
        'relative rounded-xl border bg-card p-4 text-center transition-shadow',
        isFeatured
          ? 'border-amber-500/30 shadow-sm sm:scale-[1.03] sm:shadow-md'
          : 'border-border/60',
      )}
    >
      {/* Rank badge — top right */}
      <div
        className={cn(
          'absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full',
          badgeBg,
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
      </div>

      {/* Avatar */}
      <div className="flex justify-center mb-2">
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full text-sm font-bold ring-2',
            avatarBg,
            ringClass,
          )}
        >
          <span className="text-white">{initials}</span>
        </div>
      </div>

      {/* Rank indicator */}
      <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-0.5', iconColor)}>
        {rankOrdinal(rank)} Place
      </p>

      {/* Name */}
      <p className="text-sm font-semibold truncate" title={topper.name}>
        {topper.name}
      </p>

      {/* Class */}
      <p className="text-[10px] text-muted-foreground mt-0.5">{topper.className || '—'}</p>

      {/* Percentage — count-up */}
      <p
        className={cn(
          'font-display font-bold tabular-nums mt-2',
          isFeatured ? 'text-2xl' : 'text-xl',
          iconColor,
        )}
      >
        {animatedPct.toFixed(1)}%
      </p>

      {/* Marks summary */}
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {topper.totalObtained} / {topper.totalMax} marks
      </p>
      <p className="text-[9px] text-muted-foreground/70 mt-0.5">Grade {topper.grade}</p>
    </motion.div>
  )
}

// ─── Top Performers List Row ─────────────────────────────────────────

function TopperListRow({
  topper,
  rank,
  index,
  reduceMotion,
}: {
  topper: SessionTopper
  rank: number
  index: number
  reduceMotion: boolean | null
}) {
  const avatarBg = avatarColorClass(topper.avatarColor)
  const initials = getInitials(topper.name)
  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: reduceMotion ? 0 : 0.4 + index * 0.05 }}
      className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
    >
      <span className="text-[10px] font-bold text-muted-foreground w-5 text-right shrink-0 tabular-nums">
        {rank}
      </span>
      <div
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold shrink-0',
          avatarBg,
        )}
      >
        <span className="text-white">{initials}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" title={topper.name}>
          {topper.name}
        </p>
        <p className="text-[9px] text-muted-foreground">{topper.className || '—'}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold tabular-nums">{topper.percentage.toFixed(1)}%</p>
        <p className="text-[9px] text-muted-foreground tabular-nums">
          {topper.totalObtained}/{topper.totalMax}
        </p>
      </div>
    </motion.div>
  )
}

// ─── Count-up animation hook ─────────────────────────────────────────

function useCountUp(
  target: number,
  duration: number,
  delay: number,
  reduceMotion: boolean | null,
): number {
  const [value, setValue] = useState(reduceMotion ? target : 0)
  useEffect(() => {
    if (reduceMotion) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      if (now < start) {
        raf = requestAnimationFrame(tick)
        return
      }
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // easeOutCubic — smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(target * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay, reduceMotion])
  return value
}

// ─── Visual helpers ──────────────────────────────────────────────────

function rankVisual(rank: number): {
  Icon: typeof Crown
  iconColor: string
  ringClass: string
  badgeBg: string
} {
  switch (rank) {
    case 1:
      return {
        Icon: Crown,
        iconColor: 'text-amber-500',
        ringClass: 'ring-amber-500/30',
        badgeBg: 'bg-amber-500/15',
      }
    case 2:
      return {
        Icon: Medal,
        iconColor: 'text-slate-400',
        ringClass: 'ring-slate-400/30',
        badgeBg: 'bg-slate-400/15',
      }
    case 3:
      return {
        Icon: Award,
        iconColor: 'text-orange-600',
        ringClass: 'ring-orange-500/30',
        badgeBg: 'bg-orange-500/15',
      }
    default:
      return {
        Icon: GraduationCap,
        iconColor: 'text-muted-foreground',
        ringClass: 'ring-border',
        badgeBg: 'bg-muted/40',
      }
  }
}

function avatarColorClass(color: string): string {
  const map: Record<string, string> = {
    emerald: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    sky: 'bg-gradient-to-br from-sky-500 to-blue-600',
    amber: 'bg-gradient-to-br from-amber-500 to-orange-600',
    violet: 'bg-gradient-to-br from-violet-500 to-purple-600',
    rose: 'bg-gradient-to-br from-rose-500 to-pink-600',
    cyan: 'bg-gradient-to-br from-cyan-500 to-teal-600',
  }
  return map[color] ?? 'bg-gradient-to-br from-slate-500 to-slate-700'
}

function rankOrdinal(rank: number): string {
  switch (rank) {
    case 1:
      return '1st'
    case 2:
      return '2nd'
    case 3:
      return '3rd'
    default:
      return `${rank}th`
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatSessionLabel(session: string): string {
  // "2025-2026" → "2025–2026"
  return session.replace('-', '–')
}
