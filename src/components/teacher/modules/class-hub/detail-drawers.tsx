'use client'

/**
 * class-hub/detail-drawers — the class-scoped detail surfaces of the
 * Class Teacher Hub (spec §23/§24): the four CLASS REPORTS (attendance,
 * academics, fees, growth — one drawer with a report picker, all scoped
 * to the selected class) and the printable class Marksheet. One
 * responsive container pattern (right Sheet ≥ sm, bottom Drawer on
 * phones) with internal scrolling and safe-area padding; tables/lists
 * inside, never nested cards (§30). The marksheet prints via a
 * print-only stylesheet and downloads as CSV — always from the
 * canonical ExamMark matrix.
 */

import { useEffect, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, Award, BarChart3, CalendarCheck, Download,
  Loader2, Printer, TrendingUp, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer, DrawerContent, DrawerDescription, DrawerTitle,
} from '@/components/ui/drawer'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/format'
import { GradientAvatar } from '@/components/shared/ui'
import { useClassMarksheet } from './hooks'
import type { ClassHubClass, HubDetailPayload } from './types'

export type ReportKind = 'attendance' | 'academics' | 'fees' | 'growth'

// ─── one responsive container ──────────────────────────────────────────

function HubSheet({
  open, onOpenChange, title, description, children, wide,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: React.ReactNode
  wide?: boolean
}) {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[88dvh] rounded-t-2xl">
          <DrawerTitle className="px-4 pb-1.5 pt-2 text-sm font-semibold">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn('flex w-full flex-col gap-0 p-0 sm:max-w-xl', wide && 'sm:max-w-3xl')}
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="text-xs">{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

// ─── the four CLASS REPORTS (§23) — one drawer, one picker ────────────

export function ReportDrawer({
  open, onOpenChange, cls, detail, initialKind,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cls: ClassHubClass | null
  detail: HubDetailPayload | null
  initialKind?: ReportKind
}) {
  const [kind, setKind] = useState<ReportKind>(initialKind ?? 'attendance')
  useEffect(() => {
    if (open && initialKind) setKind(initialKind)
  }, [open, initialKind])

  const tabs: { key: ReportKind; label: string }[] = [
    { key: 'attendance', label: 'Attendance' },
    { key: 'academics', label: 'Academics' },
    { key: 'fees', label: 'Fees' },
    { key: 'growth', label: 'Growth' },
  ]

  return (
    <HubSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${cls?.label ?? 'Class'} · Reports`}
      description="Class-scoped reports from the canonical systems — attendance, marks, fees and growth."
    >
      {/* report picker — one quiet segmented control */}
      <div
        role="tablist"
        aria-label="Choose report"
        className="mb-4 flex items-center rounded-lg border border-input bg-muted/40 p-0.5"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={kind === t.key}
            onClick={() => setKind(t.key)}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 text-xs font-medium transition-all',
              kind === t.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {kind === 'attendance' && <AttendanceReport detail={detail} />}
      {kind === 'academics' && <AcademicsReport detail={detail} />}
      {kind === 'fees' && cls && <FeesReport cls={cls} />}
      {kind === 'growth' && cls && detail && <GrowthReport cls={cls} detail={detail} />}
    </HubSheet>
  )
}

// ─── Attendance report (§23) ───────────────────────────────────────────

function AttendanceReport({ detail }: { detail: HubDetailPayload | null }) {
  const r = detail?.attendanceReport ?? null
  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-')
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
  }
  const weekLabel = (w: string) => {
    const d = new Date(`${w}T00:00:00.000Z`)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  if (!r || (r.overall.ratePct == null && r.overall.markedDays === 0)) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No attendance data for this class yet.</p>
  }
  return (
    <div className="space-y-6">
      {/* headline */}
      <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CalendarCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {r.overall.ratePct != null ? `${r.overall.ratePct}% average` : 'No rate yet'}
            <span className="font-normal text-muted-foreground"> · last 30 days</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {r.overall.markedDays} marked day{r.overall.markedDays === 1 ? '' : 's'} · {r.overall.present} present ·{' '}
            {r.overall.absent} absent · {r.overall.late} late · {r.overall.leave} on leave
          </p>
        </div>
      </div>
      {/* monthly */}
      {r.monthly.length > 0 && (
        <section aria-label="Monthly attendance">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly rate</h4>
          <div className="flex items-end gap-3">
            {r.monthly.map((m) => (
              <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${m.month}: ${m.ratePct ?? '—'}%`}>
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{m.ratePct ?? '—'}</span>
                <div className="flex h-24 w-full items-end justify-center">
                  <div
                    className={cn(
                      'w-full max-w-8 rounded-t-md',
                      (m.ratePct ?? 0) >= 90 ? 'bg-emerald-500' : (m.ratePct ?? 0) >= 75 ? 'bg-amber-500' : 'bg-rose-500',
                    )}
                    style={{ height: `${Math.max(m.ratePct ?? 4, 4)}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* weekly */}
      {r.weekly.length > 0 && (
        <section aria-label="Weekly attendance trend">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly trend</h4>
          <ul className="space-y-2">
            {r.weekly.map((w) => (
              <li key={w.week} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[11px] text-muted-foreground">W/C {weekLabel(w.week)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      (w.ratePct ?? 0) >= 90 ? 'bg-emerald-500' : (w.ratePct ?? 0) >= 75 ? 'bg-amber-500' : 'bg-rose-500',
                    )}
                    style={{ width: `${Math.min(100, w.ratePct ?? 0)}%` }}
                  />
                </span>
                <span className="w-9 text-right text-xs font-bold tabular-nums">{w.ratePct ?? '—'}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* below threshold */}
      <section aria-label="Students below threshold">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Below 85% threshold
        </h4>
        {r.belowThreshold.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">Every student is at or above the threshold.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {r.belowThreshold.map((b) => (
              <li key={b.studentId} className="flex items-center gap-2.5 py-2">
                <GradientAvatar name={b.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {b.absentDays} absence{b.absentDays === 1 ? '' : 's'} in {b.markedDays} marked days
                  </p>
                </div>
                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                  {b.ratePct}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ─── Academics report (§23) ────────────────────────────────────────────

function AcademicsReport({ detail }: { detail: HubDetailPayload | null }) {
  const p = detail?.performance ?? null
  if (!p || p.subjectAverages.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No exam marks for this class yet.</p>
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {p.overallAvgPct != null ? `${p.overallAvgPct}% class average` : 'No average yet'}
            <span className="font-normal text-muted-foreground">
              {p.latestExam ? ` · ${p.latestExam.examName}` : ''}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {p.trend.length} exam{p.trend.length === 1 ? '' : 's'} with marks · {p.subjectAverages.length} subjects
          </p>
        </div>
      </div>
      {/* subject averages */}
      <section aria-label="Subject averages">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject averages</h4>
        <ul className="space-y-2.5">
          {p.subjectAverages.map((s) => (
            <li key={s.subjectId} className="flex items-center gap-3">
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
      </section>
      {/* exam trend */}
      {p.trend.length > 1 && (
        <section aria-label="Exam trend">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Class average per exam</h4>
          <ul className="space-y-2">
            {p.trend.map((t, i) => {
              const prev = i > 0 ? p.trend[i - 1].avgPct : null
              const delta = prev != null ? t.avgPct - prev : null
              return (
                <li key={t.examId} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{t.examName}</span>
                  {delta != null && delta !== 0 && (
                    <span
                      className={cn(
                        'flex w-14 items-center justify-end gap-0.5 text-[11px] font-semibold tabular-nums',
                        delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(delta)}%
                    </span>
                  )}
                  <span className="w-12 text-right text-sm font-bold tabular-nums">{t.avgPct}%</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {/* top + attention */}
      <div className="grid gap-5 sm:grid-cols-2">
        <section aria-label="Top performers">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Award className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" /> Top performers
          </h4>
          <ul className="divide-y divide-border/60">
            {p.topPerformers.map((t) => (
              <li key={t.studentId} className="flex items-center gap-2.5 py-2">
                <span className="w-4 text-xs font-bold tabular-nums text-muted-foreground">{t.rank}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</p>
                <span className="text-sm font-bold tabular-nums">{t.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Needs attention">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h4>
          {p.needsAttention.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">No one is significantly below the class average.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {p.needsAttention.map((t) => (
                <li key={t.studentId} className="flex items-center gap-2.5 py-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</p>
                  <span className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{t.pct}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Fee report (§23) ──────────────────────────────────────────────────

function FeesReport({ cls }: { cls: ClassHubClass }) {
  const f = cls.fees
  const collectionPct = f.totalBilled > 0 ? Math.round((f.totalCollected / f.totalBilled) * 100) : null
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Wallet className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {collectionPct != null ? `${collectionPct}% collected` : 'No fees billed'}
            <span className="font-normal text-muted-foreground"> · {formatINR(f.totalBilled)} billed</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatINR(f.totalCollected)} verified · {formatINR(f.awaitingVerificationAmount)} awaiting verification ·{' '}
            {f.overdueStudents} overdue
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border/50">
        {[
          { label: 'Billed', value: formatINR(f.totalBilled), tone: 'text-foreground' },
          { label: 'Collected', value: formatINR(f.totalCollected), tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Outstanding', value: formatINR(f.outstanding), tone: 'text-rose-600 dark:text-rose-400' },
          { label: 'Fully paid', value: `${f.fullyPaidStudents}/${f.studentsWithFees}`, tone: 'text-foreground' },
        ].map((tile) => (
          <div key={tile.label} className="bg-card px-4 py-3">
            <p className={cn('font-display text-lg font-bold tabular-nums', tile.tone)}>{tile.value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </div>
      <section aria-label="Students with outstanding fees">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outstanding fees · {f.defaulters.length} student{f.defaulters.length === 1 ? '' : 's'}
        </h4>
        {f.defaulters.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">Every billed student is fully paid.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {f.defaulters.map((d) => (
              <li key={d.studentId} className="flex items-center gap-2.5 py-2">
                <GradientAvatar name={d.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Roll {d.rollNo ?? '—'}
                    {d.hasOverdue && <span className="ml-1.5 font-semibold text-rose-600 dark:text-rose-400">Overdue</span>}
                  </p>
                </div>
                <span className={cn(
                  'text-sm font-bold tabular-nums',
                  d.hasOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400',
                )}>
                  {formatINR(d.outstanding)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Collections follow the two-stage workflow — you record, the Principal verifies, then the receipt is final.
      </p>
    </div>
  )
}

// ─── Growth report (§23) ───────────────────────────────────────────────

function GrowthReport({ cls, detail }: { cls: ClassHubClass; detail: HubDetailPayload }) {
  const g = cls.growth
  const trend = detail.growthTrend ?? []
  const topImproving = detail.directory
    .filter((r) => r.growthMonthDelta > 0)
    .sort((a, b) => b.growthMonthDelta - a.growthMonthDelta)
    .slice(0, 5)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {g.average != null ? `${g.average} / 100 average` : 'Building'}
            <span className="font-normal text-muted-foreground">
              {' '}· {g.scoredCount} of {cls.studentCount} scored
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {g.improving} improving · {g.steady} steady · {g.needsAttention} need attention
            {g.monthPoints !== 0 && ` · ${g.monthPoints > 0 ? '+' : ''}${g.monthPoints} ledger points this month`}
          </p>
        </div>
      </div>
      {trend.length > 1 && (
        <section aria-label="Growth trend">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">8-week class trend</h4>
          <div className="flex items-end gap-1.5">
            {trend.map((p) => (
              <div
                key={p.label}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                title={`${p.label} — ${p.value != null ? p.value : 'no data'}`}
              >
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {p.value != null ? p.value : '·'}
                </span>
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className={cn(
                      'w-full max-w-7 rounded-t-md',
                      p.value == null ? 'bg-muted' : p.value >= 75 ? 'bg-emerald-500' : p.value >= 55 ? 'bg-amber-500' : 'bg-rose-500',
                    )}
                    style={{ height: `${p.value != null ? Math.max(p.value, 4) : 4}%` }}
                  />
                </div>
                <span className="truncate text-[10px] font-medium text-muted-foreground">{p.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section aria-label="Top improvement">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top improvement this month</h4>
        {topImproving.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">No net gains this month yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {topImproving.map((r) => (
              <li key={r.studentId} className="flex items-center gap-2.5 py-2">
                <GradientAvatar name={r.name} size="sm" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</p>
                <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{r.growthMonthDelta}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Growth is the normalized 0–100 score from the canonical engine — a different concept from exam rankings, never mixed.
      </p>
    </div>
  )
}

// ─── Marksheet viewer (§16) — matrix + print + CSV ─────────────────────

export function MarksheetDrawer({
  open, onOpenChange, classId, examId, examName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  classId: string | null
  examId: string | null
  examName: string | null
}) {
  const { data, error, loading } = useClassMarksheet(open ? classId : null, open ? examId : null)

  const downloadCsv = () => {
    if (!data) return
    const header = ['Roll No', 'Admission No', 'Student', ...data.subjects.map((s) => `${s.subjectName} (/${s.maxMarks})`), 'Total', 'Percent', 'Rank']
    const lines = data.rows.map((r) => [
      r.rollNo ?? '',
      r.admissionNo ?? '',
      r.name,
      ...data.subjects.map((s) => {
        const m = r.marks[s.subjectId]
        return m ? String(m.obtained ?? (m.status === 'ABSENT' ? 'AB' : '')) : ''
      }),
      String(r.total),
      String(r.pct),
      r.rank != null ? String(r.rank) : '',
    ])
    const csv = [header, ...lines].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.classLabel.replace(/\s+/g, '-')} — ${data.exam.examName.replace(/\s+/g, '-')}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <HubSheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Marksheet · ${examName ?? ''}`}
      description="The canonical exam marks for this class — the same numbers every other module uses."
    >
      {/* Print stylesheet — mounted ONLY while this sheet is open, so
          printing any other page stays untouched. Same strategy as the
          student marksheet: everything outside this sheet is display:none'd
          and every ancestor is neutralised (fixed drawer, Tailwind v4
          "translate" offsets, scroll clipping), so the matrix prints
          in-flow on a clean A4 landscape page. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body > *:not(:has(#marksheet-print-area)) { display: none !important; }
          body *:has(#marksheet-print-area) {
            position: static !important; inset: auto !important;
            transform: none !important; translate: none !important;
            rotate: none !important; scale: none !important;
            width: auto !important; max-width: none !important;
            height: auto !important; max-height: none !important;
            overflow: visible !important; margin: 0 !important; padding: 0 !important;
            border: none !important; border-radius: 0 !important;
            background: transparent !important; box-shadow: none !important;
            display: block !important;
          }
          body *:has(#marksheet-print-area) > *:not(:has(#marksheet-print-area)):not(#marksheet-print-area):not(#marksheet-print-header) {
            display: none !important;
          }
          #marksheet-print-header {
            display: block !important; position: static !important;
            width: 100% !important; margin: 0 0 6px !important;
          }
          #marksheet-print-area {
            position: static !important; width: 100% !important;
            border: none !important; border-radius: 0 !important;
            font-size: 10px; overflow: visible !important; margin: 0 !important;
          }
        }
      `}</style>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading marksheet…
        </div>
      ) : error ? (
        <p className="py-10 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !data ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{data.classLabel} · {data.exam.examName}</p>
              <p className="text-xs text-muted-foreground">
                {data.exam.session ?? ''}{data.exam.examDate ? ` · ${data.exam.examDate}` : ''}
                {data.classAveragePct != null && ` · class average ${data.classAveragePct}%`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={downloadCsv}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download CSV
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
              </Button>
            </div>
          </div>

          {/* print-only header — the school's configured identity */}
          <div id="marksheet-print-header" className="hidden print:block">
            <h2 className="text-lg font-bold">{data.classLabel} — {data.exam.examName}</h2>
            <p className="text-xs">
              {data.schoolName}{data.room ? ` · Room ${data.room}` : ''} · Class Teacher Copy ·{' '}
              {new Date().toLocaleDateString('en-IN')}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border" id="marksheet-print-area">
            <table className="w-full min-w-[540px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2">Roll</th>
                  <th scope="col" className="px-3 py-2">Student</th>
                  {data.subjects.map((s) => (
                    <th key={s.subjectId} scope="col" className="px-2 py-2 text-center" title={`${s.subjectName} · max ${s.maxMarks}`}>
                      {s.subjectName.slice(0, 9)}
                      <span className="block font-normal normal-case text-[9px]">/{s.maxMarks}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-center">Total</th>
                  <th scope="col" className="px-2 py-2 text-center">%</th>
                  <th scope="col" className="px-3 py-2 text-center">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.rows.map((r) => (
                  <tr key={r.studentId} className="hover:bg-accent/30">
                    <td className="px-3 py-2 font-semibold tabular-nums text-muted-foreground">{r.rollNo ?? '—'}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 font-medium">{r.name}</td>
                    {data.subjects.map((s) => {
                      const m = r.marks[s.subjectId]
                      return (
                        <td key={s.subjectId} className="px-2 py-2 text-center tabular-nums">
                          {m ? (m.obtained != null ? m.obtained : <span className="text-[10px] text-rose-500">AB</span>) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center font-semibold tabular-nums">{r.total}</td>
                    <td className="px-2 py-2 text-center font-semibold tabular-nums">{r.pct}%</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums">{r.rank ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground print:hidden">
            AB = absent on exam day · — = not assessed. Rank is by total marks from the canonical entries.
          </p>
        </div>
      )}
    </HubSheet>
  )
}
