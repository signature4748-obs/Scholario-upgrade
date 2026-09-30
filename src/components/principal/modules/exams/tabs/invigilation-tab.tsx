'use client'

/**
 * InvigilationTab — the principal's examination DUTY ROSTER.
 *
 * 100% real data (GET /api/exams/duties): every examination of the school
 * with its papers and the invigilator assigned to each. Assigning a
 * teacher (or releasing one) writes to the real ExamScheduleItem and sends
 * the teacher a direct notification — it lands in their bell instantly
 * via the :3003 event stream — and the duty shows up in the teacher's
 * My Timetable → Examination Duties section.
 *
 * Structure:
 *   · exam picker pills (defaults to the examination in progress / next)
 *   · summary strip — papers, coverage, unassigned, teachers on duty
 *   · teacher load chips (click to filter the roster by teacher)
 *   · the duty TIMETABLE — date-grouped papers, one assign control per
 *     paper. Concluded days are collapsed by default; today + upcoming
 *     days are open and editable.
 *   · school-wide conflict safety: the server rejects a teacher who
 *     already has an overlapping duty; the row reverts with the reason.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  MapPin,
  RotateCw,
  UserMinus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useAssignInvigilator,
  useDutyRoster,
  type DutyExamDTO,
  type DutyPaperDTO,
} from '@/lib/exams/use-exams-extended'
import { useRoleGate } from '@/lib/exams/use-role-gate'
import { InlineLoading } from '../inline-loading'
import { ModuleEmptyState } from '../../shared/empty-state'

// ── helpers ────────────────────────────────────────────────────────────

const DAY_FMT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const SHORT_DAY_FMT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function prettyTime(t: string): string {
  const [hRaw, m] = t.split(':')
  const h = Number(hRaw)
  if (Number.isNaN(h)) return t
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Which examination the roster opens on: the one holding the nearest
 * paper dated today or later; otherwise the most recently dated one. */
function preferredExamId(exams: DutyExamDTO[], todayKey: string): string | null {
  if (exams.length === 0) return null
  let best: { id: string; dist: number } | null = null
  for (const e of exams) {
    for (const p of e.papers) {
      if (p.date >= todayKey) {
        const dist = p.date === todayKey ? 0 : 1
        if (!best || dist < best.dist) best = { id: e.id, dist }
      }
    }
  }
  if (best) return best.id
  return exams[exams.length - 1].id
}

// ── the tab ────────────────────────────────────────────────────────────

export function InvigilationTab() {
  const gate = useRoleGate()
  const { roster, loading, error, reload } = useDutyRoster()
  const { assign } = useAssignInvigilator()

  const [examId, setExamId] = useState<string | null>(null)
  const [filterTeacher, setFilterTeacher] = useState<string | null>(null)
  const [expandedPast, setExpandedPast] = useState<Set<string>>(new Set())
  // optimistic overrides: paperId → invigilator (id + name) — applied on
  // top of the server roster so the row updates the instant you pick.
  const [overrides, setOverrides] = useState<Map<string, { id: string | null; name: string | null }>>(new Map())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  // default exam selection once the roster arrives
  useEffect(() => {
    if (roster && examId == null) setExamId(preferredExamId(roster.exams, roster.todayKey))
  }, [roster, examId])

  useEffect(() => {
    if (!flashId) return
    const t = window.setTimeout(() => setFlashId(null), 1200)
    return () => window.clearTimeout(t)
  }, [flashId])

  const exams = roster?.exams ?? []
  const teachers = roster?.teachers ?? []
  const todayKey = roster?.todayKey ?? ''

  const exam = useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId],
  )

  // merge optimistic overrides into the exam's papers + recompute counts
  const papers = useMemo<DutyPaperDTO[]>(() => {
    if (!exam) return []
    return exam.papers.map((p) => {
      const o = overrides.get(p.id)
      return o ? { ...p, invigilatorId: o.id, invigilatorName: o.name } : p
    })
  }, [exam, overrides])

  const stats = useMemo(() => {
    const total = papers.length
    const assigned = papers.filter((p) => p.invigilatorName != null).length
    return {
      total,
      assigned,
      unassigned: total - assigned,
      coverage: total === 0 ? 0 : Math.round((assigned / total) * 100),
      onDuty: new Set(papers.filter((p) => p.invigilatorId != null || p.invigilatorName != null).map((p) => p.invigilatorName ?? '')).size,
    }
  }, [papers])

  // date groups (ascending), each with its papers
  const groups = useMemo(() => {
    const map = new Map<string, DutyPaperDTO[]>()
    for (const p of papers) {
      const arr = map.get(p.date) ?? []
      arr.push(p)
      map.set(p.date, arr)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => ({ date, items }))
  }, [papers])

  // ── assignment ──────────────────────────────────────────────────────
  const handleAssign = async (paper: DutyPaperDTO, teacherId: string | null) => {
    const teacher = teachers.find((t) => t.id === teacherId) ?? null
    const prevTeacher = teachers.find(
      (t) => t.id === paper.invigilatorId || t.name === paper.invigilatorName,
    )
    if ((teacher?.id ?? null) === (prevTeacher?.id ?? null)) return

    // pre-action displayed state — the revert target if the server rejects
    const prevDisplay = { id: paper.invigilatorId, name: paper.invigilatorName }
    setPendingId(paper.id)
    setOverrides((m) => {
      const next = new Map(m)
      next.set(paper.id, { id: teacher?.id ?? null, name: teacher?.name ?? null })
      return next
    })

    try {
      await assign(paper.examId, paper.id, teacherId)
      setFlashId(paper.id)
      const when = SHORT_DAY_FMT.format(new Date(`${paper.date}T00:00:00Z`))
      if (teacher) {
        toast.success(`Assigned ${teacher.name}`, {
          description: `${paper.subjectName} · ${paper.className} · ${when} — teacher notified`,
        })
      } else {
        toast.info('Duty released', {
          description: `${paper.subjectName} · ${paper.className} · ${when} is now unassigned.`,
        })
      }
      reload() // quietly re-sync duty counts + any concurrent change
    } catch (e) {
      // revert the optimistic row and surface the server's reason
      setOverrides((m) => {
        const next = new Map(m)
        next.set(paper.id, prevDisplay)
        return next
      })
      toast.error('Could not assign duty', {
        description:
          (e as { message?: string })?.message ?? 'Something went wrong.',
      })
    } finally {
      setPendingId(null)
    }
  }

  // ── states ──────────────────────────────────────────────────────────
  if (loading && !roster) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <InlineLoading label="Loading duty roster…" />
      </div>
    )
  }

  if (error && !roster) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Couldn&apos;t load the duty roster</p>
            <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">{error}</p>
            <Button size="sm" variant="outline" className="mt-3 h-8" onClick={reload}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (exams.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No examinations yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Create an examination with its paper schedule first — the invigilation roster
            appears here.
          </p>
        </div>
      </div>
    )
  }

  const canAssign = gate.canAssignInvigilator

  return (
    <div className="space-y-4">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground">
            <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Invigilation Duty Roster
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Assign a teacher to every paper — they are notified instantly and see the duty
            in My Timetable.
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reload} title="Refresh roster">
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── exam picker pills ── */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Choose examination">
        {exams.map((e) => {
          const active = e.id === examId
          const upcoming = e.papers.some((p) => p.date >= todayKey)
          return (
            <button
              key={e.id}
              role="tab"
              aria-selected={active}
              onClick={() => { setExamId(e.id); setFilterTeacher(null); setOverrides(new Map()) }}
              className={cn(
                'flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all',
                active
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 shadow-sm dark:text-emerald-400'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {upcoming && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    active ? 'bg-emerald-500' : 'bg-emerald-500/60',
                  )}
                />
              )}
              <span className="max-w-[180px] truncate">{e.name}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums',
                  active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                )}
              >
                {e.papers.length}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── summary strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          label="Papers"
          value={String(stats.total)}
          hint={exam ? exam.name : ''}
        />
        <SummaryTile
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Coverage"
          value={`${stats.coverage}%`}
          hint={`${stats.assigned} of ${stats.total} assigned`}
          progress={stats.coverage}
          progressTone={stats.coverage === 100 ? 'emerald' : 'amber'}
        />
        <SummaryTile
          icon={<UserMinus className="h-3.5 w-3.5" />}
          label="Unassigned"
          value={String(stats.unassigned)}
          hint={stats.unassigned > 0 ? 'needs an invigilator' : 'all papers covered'}
          tone={stats.unassigned > 0 ? 'amber' : 'default'}
        />
        <SummaryTile
          icon={<Users className="h-3.5 w-3.5" />}
          label="Teachers on duty"
          value={String(stats.onDuty)}
          hint={`${teachers.length} available`}
        />
      </div>

      {/* ── teacher load chips (click to filter) ── */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Teacher load — this examination
          </p>
          {filterTeacher && (
            <button
              onClick={() => setFilterTeacher(null)}
              className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {teachers.map((t) => {
            const count = papers.filter(
              (p) => p.invigilatorName === t.name || (p.invigilatorId != null && p.invigilatorId === t.id),
            ).length
            const active = filterTeacher === t.id
            return (
              <button
                key={t.id}
                onClick={() => setFilterTeacher(active ? null : t.id)}
                title={t.department ? `${t.name} · ${t.department}` : t.name}
                className={cn(
                  'flex min-h-[36px] items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-all',
                  active
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-emerald-500/30 hover:text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"
                >
                  {initialsOf(t.name)}
                </span>
                <span className="max-w-[140px] truncate font-medium">{t.name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/, '')}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums',
                    count === 0 ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── the duty timetable ── */}
      {exam == null || groups.length === 0 ? (
        <ModuleEmptyState
          className="m-0 py-6"
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden />}
          title="No papers scheduled"
          description={exam ? `${exam.name} has no paper schedule yet — add papers from the examination setup.` : undefined}
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const isToday = g.date === todayKey
            const isPast = g.date < todayKey
            const filtered = filterTeacher
              ? g.items.filter(
                  (p) =>
                    p.invigilatorName === (teachers.find((t) => t.id === filterTeacher)?.name ?? '__') ||
                    p.invigilatorId === filterTeacher,
                )
              : g.items
            if (filterTeacher && filtered.length === 0) return null

            if (isPast) {
              const expanded = expandedPast.has(g.date)
              return (
                <motion.section
                  key={g.date}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(gi * 0.04, 0.25), duration: 0.25 }}
                  aria-label={`Concluded papers ${g.date}`}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <button
                    onClick={() =>
                      setExpandedPast((s) => {
                        const next = new Set(s)
                        if (next.has(g.date)) next.delete(g.date)
                        else next.add(g.date)
                        return next
                      })
                    }
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/30"
                    aria-expanded={expanded}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                      {DAY_FMT.format(new Date(`${g.date}T00:00:00Z`))}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                        Concluded
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {g.items.length} papers
                      <ChevronDown
                        className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <ol className="divide-y divide-border/40 border-t border-border">
                          {filtered.map((p) => (
                            <PastPaperRow key={p.id} paper={p} />
                          ))}
                        </ol>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
              )
            }

            return (
              <motion.section
                key={g.date}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(gi * 0.04, 0.25), duration: 0.25 }}
                aria-label={`Papers ${g.date}`}
                className={cn(
                  'overflow-hidden rounded-xl border bg-card',
                  isToday ? 'border-emerald-500/40' : 'border-border',
                )}
              >
                <header
                  className={cn(
                    'flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5',
                    isToday ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-border bg-muted/20',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <CalendarClock
                      className={cn(
                        'h-3.5 w-3.5',
                        isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <h3 className="text-xs font-semibold text-foreground">
                      {DAY_FMT.format(new Date(`${g.date}T00:00:00Z`))}
                    </h3>
                    {isToday && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                        Today
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {filtered.length} paper{filtered.length === 1 ? '' : 's'}
                  </p>
                </header>
                <ol className="divide-y divide-border/40">
                  {filtered.map((p, idx) => (
                    <PaperRow
                      key={p.id}
                      paper={p}
                      index={idx}
                      teachers={teachers.map((t) => ({ id: t.id, name: t.name, count: t.assignedCount }))}
                      canAssign={canAssign}
                      pending={pendingId === p.id}
                      flash={flashId === p.id}
                      onAssign={handleAssign}
                    />
                  ))}
                </ol>
              </motion.section>
            )
          })}
        </div>
      )}

      <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
        Assignments are school-wide safe — a teacher can never be double-booked for
        overlapping papers. Every change notifies the teacher in their bell feed.
      </p>
    </div>
  )
}

// ── pieces ─────────────────────────────────────────────────────────────

function SummaryTile({
  icon,
  label,
  value,
  hint,
  progress,
  progressTone = 'emerald',
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  progress?: number
  progressTone?: 'emerald' | 'amber'
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-lg',
            tone === 'amber' || progressTone === 'amber'
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-1 font-display text-xl font-bold tabular-nums leading-none text-foreground">{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{hint}</p>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/60">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            className={cn(
              'h-full rounded-full',
              progressTone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500',
            )}
          />
        </div>
      )}
    </div>
  )
}

/** A concluded paper — read-only record of who invigilated. */
function PastPaperRow({ paper }: { paper: DutyPaperDTO }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 opacity-70">
      <p className="w-[110px] shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {prettyTime(paper.startTime)} – {prettyTime(paper.endTime)}
      </p>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          {paper.subjectName}
          <span className="ml-1.5 font-normal text-muted-foreground">· {paper.className}</span>
        </p>
      </div>
      {paper.room && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <MapPin className="h-3 w-3" aria-hidden="true" /> {paper.room}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground"
        >
          {initialsOf(paper.invigilatorName ?? '—')}
        </span>
        {paper.invigilatorName ?? 'Unassigned'}
      </span>
    </li>
  )
}

/** A today / upcoming paper with its assignment control. */
function PaperRow({
  paper,
  index,
  teachers,
  canAssign,
  pending,
  flash,
  onAssign,
}: {
  paper: DutyPaperDTO
  index: number
  teachers: Array<{ id: string; name: string; count: number }>
  canAssign: boolean
  pending: boolean
  flash: boolean
  onAssign: (paper: DutyPaperDTO, teacherId: string | null) => void
}) {
  const assigned = paper.invigilatorName != null
  // The Select's option values are Teacher ids; seeded rows store the
  // invigilator's USER id — resolve by id OR display name so both resolve.
  const selectedTeacherId = teachers.find(
    (t) => t.id === paper.invigilatorId || t.name === paper.invigilatorName,
  )?.id
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{
        opacity: 1,
        x: 0,
        backgroundColor: flash ? 'rgba(16, 185, 129, 0.07)' : 'rgba(0, 0, 0, 0)',
      }}
      transition={{
        delay: Math.min(index * 0.04, 0.25),
        duration: flash ? 0.9 : 0.25,
      }}
      className={cn(
        'relative px-4 py-3 transition-opacity',
        pending && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* time */}
        <p className="w-[110px] shrink-0 text-[11px] font-medium tabular-nums text-foreground">
          {prettyTime(paper.startTime)}
          <span className="font-normal text-muted-foreground"> – {prettyTime(paper.endTime)}</span>
        </p>

        {/* subject + class */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {paper.subjectName}
            <span className="ml-1.5 font-normal text-muted-foreground">· {paper.className}</span>
          </p>
          {paper.room && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden="true" /> {paper.room}
            </p>
          )}
        </div>

        {/* invigilator control */}
        {canAssign ? (
          <div className="flex shrink-0 items-center gap-2">
            {assigned && (
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"
              >
                {initialsOf(paper.invigilatorName ?? '')}
              </span>
            )}
            <Select
              value={selectedTeacherId}
              onValueChange={(v) => onAssign(paper, v === '__none__' ? null : v)}
              disabled={pending}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  'h-9 w-[190px] text-xs font-medium',
                  !assigned && 'border-amber-500/40 bg-amber-500/[0.05] text-amber-700 dark:text-amber-400',
                )}
                aria-label={`Invigilator for ${paper.subjectName} ${paper.className}`}
              >
                <SelectValue placeholder="Assign invigilator…" />
              </SelectTrigger>
              <SelectContent>
                {assigned && (
                  <SelectItem value="__none__" className="text-rose-600 focus:text-rose-600">
                    <span className="flex items-center gap-1.5">
                      <UserMinus className="h-3 w-3" aria-hidden="true" /> Release from duty
                    </span>
                  </SelectItem>
                )}
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate">{t.name}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {t.count} {t.count === 1 ? 'duty' : 'duties'}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {paper.invigilatorName ?? 'Unassigned'}
          </span>
        )}
      </div>
    </motion.li>
  )
}
