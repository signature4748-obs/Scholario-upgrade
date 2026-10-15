'use client'

/**
 * class-hub/academics-tab — the GRADE-X RESULTS WORKSPACE inside My Class
 * (spec §14–§16). This is NOT the global Marks Entry: it is the class
 * teacher's OVERALL class results view — class average, examination
 * selector, subject-wise performance, student performance with rankings,
 * result completion status, academic trends and the marksheet surface.
 *
 * CRITICAL MARKS PERMISSION RULE (§15): being the class teacher does NOT
 * make the teacher the subject teacher for every subject. The completion
 * matrix shows every subject's status read-only; marks ENTRY happens only
 * in the ONE global, subject-scoped Marks Entry module — MY CLASS = overall
 * class results; GLOBAL MARKS ENTRY = subject-scoped entry — different
 * purposes, never merged.
 *
 * ONE MARKSHEET ACTION (simplification round §4): the duplicate "Open
 * marksheet" button in the exam-summary strip was REMOVED. The ONE
 * entry point into the ONE canonical marksheet viewer is the View /
 * Print action inside the Marksheets section at the bottom — no second
 * route, no second component, no duplicate action.
 */

import { useMemo, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, Award, BadgeCheck, BarChart3, CheckCircle2,
  ChevronRight, Clock, FileText, GraduationCap, TrendingUp, X,
} from 'lucide-react'
import { GradientAvatar } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { isResultDeclared } from '@/lib/exams/types'
import { SectionCard } from '../shared/section-card'
import { HubEmptyState } from '../shared/hub-stat-cards'
import type { ClassHubClass, HubDetailPayload } from './types'

export function AcademicsTab({
  cls,
  detail,
  onOpenMarksheet,
  onOpenProfile,
}: {
  cls: ClassHubClass
  detail: HubDetailPayload | null
  onOpenMarksheet: (examId: string) => void
  onOpenProfile: (studentId: string) => void
}) {
  const exams = detail?.ranking.exams ?? []
  const [examId, setExamId] = useState<string | null>(null)
  const selectedId = examId != null && exams.some((e) => e.examId === examId)
    ? examId
    : (exams[0]?.examId ?? null)
  const selected = exams.find((e) => e.examId === selectedId) ?? null

  const subjectAverages = useMemo(
    () => (selectedId ? detail?.subjectAveragesByExam?.[selectedId] ?? [] : []),
    [detail, selectedId],
  )
  const rows = useMemo(
    () => (selectedId ? detail?.ranking.rowsByExam[selectedId] ?? [] : []),
    [detail, selectedId],
  )
  /** Completion matrix for the selected exam (from the overview payload). */
  const resultExam = useMemo(
    () => cls.results.find((r) => r.examId === selectedId) ?? null,
    [cls, selectedId],
  )
  const taughtIds = useMemo(
    () => new Set((detail?.taughtSubjects ?? []).map((t) => t.subjectId)),
    [detail],
  )

  if (exams.length === 0) {
    return (
      <SectionCard
        icon={GraduationCap}
        title="Academics"
        subtitle={`${cls.label} · overall class results`}
        contentClassName=""
      >
        <HubEmptyState
          icon={BarChart3}
          title="No exam marks yet"
          hint="The class results workspace fills in as subject teachers enter marks for this class's exams — averages, rankings, completion and marksheets all derive from the canonical marks."
          className="py-12"
        />
      </SectionCard>
    )
  }

  // headline numbers for the selected exam
  const classAvg =
    rows.length > 0
      ? Math.round((rows.reduce((a, r) => a + r.pct, 0) / rows.length) * 10) / 10
      : null
  const trend = detail?.performance.trend ?? []
  const selectedTrendIdx = trend.findIndex((t) => t.examId === selectedId)
  const prevAvg = selectedTrendIdx > 0 ? trend[selectedTrendIdx - 1].avgPct : null
  const delta = prevAvg != null && classAvg != null ? Math.round((classAvg - prevAvg) * 10) / 10 : null

  return (
    <div className="space-y-4">
      {/* examination selector + headline numbers — one compact strip.
          NO "Open marksheet" action here (§4): the ONE marksheet action
          lives in the Marksheets section below. */}
      <div className="rounded-xl border border-border bg-card px-4 py-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <Select value={selectedId ?? undefined} onValueChange={setExamId}>
              <SelectTrigger
                className="h-9 w-full max-w-[15rem] text-xs font-semibold sm:w-[15rem]"
                aria-label="Examination"
              >
                <SelectValue placeholder="Examination" />
              </SelectTrigger>
              <SelectContent>
                {exams.map((e) => (
                  <SelectItem key={e.examId} value={e.examId}>
                    {e.examName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Class Average</p>
                <p className="flex items-baseline gap-1.5 font-display text-xl font-bold tabular-nums">
                  {classAvg != null ? `${classAvg}%` : '—'}
                  {delta != null && delta !== 0 && (
                    <span
                      className={cn(
                        'flex items-center gap-0.5 text-[11px] font-semibold',
                        delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                      )}
                      title="vs the previous exam with marks"
                    >
                      {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(delta)}%
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Students Scored</p>
                <p className="font-display text-xl font-bold tabular-nums">
                  {rows.length}
                  <span className="text-sm font-medium text-muted-foreground">/{cls.studentCount}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Subjects</p>
                <p className="font-display text-xl font-bold tabular-nums">{subjectAverages.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SUBJECT-WISE PERFORMANCE (§14) */}
      <SectionCard
        icon={BarChart3}
        title="Subject Performance"
        subtitle={selected ? `${selected.examName} · averages from the canonical marks` : undefined}
        meta={`${subjectAverages.length} subjects`}
        contentClassName=""
      >
        <ul className="px-4 py-3">
          {subjectAverages.map((s) => (
            <li key={s.subjectId} className="flex items-center gap-3 py-1.5">
              <span className="w-24 min-w-0 truncate text-xs font-medium sm:w-32">{s.subjectName}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    s.avgPct >= 75 ? 'bg-emerald-500' : s.avgPct >= 50 ? 'bg-amber-500' : 'bg-rose-500',
                  )}
                  style={{ width: `${Math.min(100, s.avgPct)}%` }}
                />
              </span>
              <span className="w-10 text-right text-xs font-bold tabular-nums">{s.avgPct}%</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* STUDENT PERFORMANCE (§14) — ranked, academic only */}
      <SectionCard
        icon={Award}
        title="Student Performance"
        subtitle={`${selected?.examName ?? ''} · ranked by exam percentage — never the growth score`}
        meta={`${rows.length} scored`}
        contentClassName=""
      >
        {rows.length === 0 ? (
          <HubEmptyState icon={Award} title="No scores for this exam" hint="Students appear here once marks are entered." className="py-8" />
        ) : (
          <div className="divide-y divide-border/50">
            {/* ranked table ≥ sm */}
            <table className="hidden w-full text-left sm:table">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5">Rank</th>
                  <th scope="col" className="px-3 py-2.5">Student</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Total</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Percentage</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr
                    key={r.studentId}
                    className="cursor-pointer transition-colors hover:bg-accent/40"
                    onClick={() => onOpenProfile(r.studentId)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onOpenProfile(r.studentId)
                    }}
                    aria-label={`Open ${r.name}'s profile`}
                  >
                    <td className="px-4 py-2.5">
                      <RankBadge rank={r.rank} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <GradientAvatar name={r.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{r.name}</p>
                          <p className="text-[10px] text-muted-foreground">Roll {r.rollNo ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                      {r.total != null && r.maxTotal != null ? `${r.total} / ${r.maxTotal}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PctChip pct={r.pct} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* stacked rows < sm */}
            <ul className="divide-y divide-border/50 sm:hidden">
              {rows.map((r) => (
                <li key={r.studentId}>
                  <button
                    type="button"
                    onClick={() => onOpenProfile(r.studentId)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <RankBadge rank={r.rank} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Roll {r.rollNo ?? '—'}
                        {r.total != null && r.maxTotal != null && ` · ${r.total}/${r.maxTotal}`}
                      </p>
                    </div>
                    <PctChip pct={r.pct} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      {/* RESULT COMPLETION (§14/§15) — every subject, entry stays with
          each subject's teacher; only HER subjects deep-link */}
      {resultExam && (
        <SectionCard
          icon={FileText}
          title="Result Completion"
          subtitle={`${resultExam.examName} · ${resultExam.submittedSubjects}/${resultExam.totalSubjects} subjects submitted`}
          contentClassName=""
        >
          <ul className="divide-y divide-border/50">
            {resultExam.subjects.map((s) => {
              const mine = taughtIds.has(s.subjectId)
              const done = s.entered >= cls.studentCount && s.entered > 0
              const submitted = s.submitted >= s.entered && s.submitted > 0
              return (
                <li key={s.subjectId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {s.subjectName}
                      {mine && (
                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="You teach this subject" />
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1 w-24 overflow-hidden rounded-full bg-muted sm:w-32">
                        <span
                          className={cn('block h-full rounded-full', submitted ? 'bg-emerald-500' : done ? 'bg-amber-500' : 'bg-muted-foreground/30')}
                          style={{ width: `${cls.studentCount > 0 ? Math.min(100, (s.entered / cls.studentCount) * 100) : 0}%` }}
                        />
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {s.entered}/{cls.studentCount} entered{s.submitted > 0 && ` · ${s.submitted} submitted`}
                      </span>
                    </div>
                  </div>
                  {mine ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Your subject
                    </span>
                  ) : submitted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Submitted
                    </span>
                  ) : done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      <Clock className="h-3 w-3" aria-hidden="true" /> Draft
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <X className="h-3 w-3" aria-hidden="true" /> Pending
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="border-t border-border bg-muted/20 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {detail?.taughtSubjects?.length
              ? `You teach ${detail.taughtSubjects.map((t) => t.subjectName).join(', ')} — enter those marks from Marks Entry. Other subjects stay with their subject teachers.`
              : 'As class teacher you see the full submission picture. Marks entry stays with each subject\u2019s teacher.'}
          </p>
        </SectionCard>
      )}

      {/* ACADEMIC TRENDS (§14) */}
      {trend.length > 1 && (
        <SectionCard
          icon={TrendingUp}
          title="Academic Trend"
          subtitle="Class average per exam with marks"
          contentClassName=""
        >
          <ul className="divide-y divide-border/50">
            {trend
              .slice()
              .reverse()
              .map((t, i, arr) => {
                const prev = i < arr.length - 1 ? arr[i + 1].avgPct : null
                const d = prev != null ? Math.round((t.avgPct - prev) * 10) / 10 : null
                return (
                  <li
                    key={t.examId}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5',
                      t.examId === selectedId && 'bg-primary/[0.04]',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.examName}</span>
                    {d != null && d !== 0 && (
                      <span
                        className={cn(
                          'flex w-14 items-center justify-end gap-0.5 text-[11px] font-semibold tabular-nums',
                          d > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                        )}
                      >
                        {d > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {Math.abs(d)}%
                      </span>
                    )}
                    <span className="w-12 text-right text-sm font-bold tabular-nums">{t.avgPct}%</span>
                  </li>
                )
              })}
          </ul>
        </SectionCard>
      )}

      {/* MARKSHEETS (§16) — the ONE marksheet action surface (§4): every
          exam with entered marks, opening the ONE canonical viewer (which
          carries Print + Download CSV inside). No duplicate action above. */}
      <SectionCard
        icon={GraduationCap}
        title="Marksheets"
        subtitle="Authorized viewing & printing — built from the canonical marks, never a second record"
        contentClassName=""
      >
        <ul className="divide-y divide-border/50">
          {(detail?.marksheets ?? []).map((m) => (
            <li key={m.examId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.examName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {m.studentsScored} scored · {m.subjectsWithMarks} subject{m.subjectsWithMarks === 1 ? '' : 's'}
                  {m.avgPct != null && ` · avg ${m.avgPct}%`}
                  {isResultDeclared(m.resultStatus) && ' · results declared'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() => onOpenMarksheet(m.examId)}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                View / Print
              </Button>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
        rank === 1 && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        rank === 2 && 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
        rank === 3 && 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        rank > 3 && 'bg-muted text-muted-foreground',
      )}
    >
      {String(rank).padStart(2, '0')}
    </span>
  )
}

function PctChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-muted-foreground/70">—</span>
  const t = pct >= 85 ? 'emerald' : pct >= 75 ? 'amber' : 'rose'
  const cls =
    t === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : t === 'amber'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', cls)}>
      {Math.round(pct * 10) / 10}%
    </span>
  )
}
