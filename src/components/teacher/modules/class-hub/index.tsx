'use client'

/**
 * class-hub/index — the CLASS TEACHER'S COMMAND CENTER (FINAL UX
 * refinement: ONE information architecture, no duplicate navigation).
 *
 * MY CLASS is a CLASS-SCOPED MANAGEMENT VIEW over the canonical systems —
 * never a second copy of them:
 *
 *   · ONE compact class header — identity (MY CLASS · Grade 9-A ·
 *     students · Class Teacher · room), the student search and, for
 *     multi-class teachers, the small class selector. NO quick-action
 *     row — the tabs below ARE the navigation.
 *   · ONE tab system — Overview / Students / Attendance / Academics /
 *     Fees. Selected tab is obvious but subtle; horizontally scrollable
 *     only within its own container on mobile.
 *   · Overview — the command center: the 7-KPI row + one section per
 *     concern (Attendance summary+ trend, Academic performance, Student
 *     growth, Fee status, the consolidated Student attention list and
 *     the compact class Reports). No number is repeated across sections.
 *   · Attendance — a READ-ONLY class attendance REPORT/INSIGHTS view.
 *     Attendance is CREATED/EDITED/SUBMITTED only in the global Class
 *     Attendance module; this tab reads and summarizes the same
 *     canonical CLASS + DATE + STUDENT records (no editing control of
 *     any kind — no Save, no Mark-all-present, no roster editing).
 *   · Students — the class directory (canonical profile on click).
 *   · Academics — the overall class results workspace (averages,
 *     subject performance, rankings, completion, marksheets). Marks
 *     ENTRY stays in the global, subject-scoped Marks Entry.
 *   · Fees — the class fee workspace over the canonical fee/payment
 *     system (collect → Principal verifies → receipt).
 *
 * A teacher without an appointment never reaches this module (the
 * sidebar group does not exist for them); a direct deep-link lands on
 * the honest empty state below. Every section re-checks its own
 * authorization server-side anyway.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, BookOpenCheck, CalendarCheck, DoorOpen,
  GraduationCap, IndianRupee, RefreshCw, School, Search, TrendingUp,
  Users, Wallet, BadgeCheck,
} from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GlassCard } from '@/components/shared/ui'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { HubEmptyState, HubModuleSkeleton, HubStatCards, type HubStat } from '../shared/hub-stat-cards'
import { ClassSelect } from '../shared/class-select'
import { HubStudentProfileSheet } from '../shared/hub-student-profile-sheet'
import { useClassHub, useClassHubDetail } from './hooks'
import type { ClassHubClass } from './types'
import {
  AttendanceSection,
  FeesSection,
  GrowthSection,
  PerformanceSection,
  ReportsSection,
  StudentAttentionSection,
  classAttentionOf,
} from './sections'
import { StudentsTab } from './students-tab'
import { AcademicsTab } from './academics-tab'
import { FeesTab } from './fees-tab'
import { AttendanceReportTab } from './attendance-report-tab'
import { GrowthDrawer } from './growth-drawer'
import { MarksheetDrawer, ReportDrawer, type ReportKind } from './detail-drawers'

type HubTab = 'overview' | 'students' | 'attendance' | 'academics' | 'fees'

const TABS: { key: HubTab; label: string; icon: typeof Users }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'students', label: 'Students', icon: Users },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'academics', label: 'Academics', icon: BookOpenCheck },
  { key: 'fees', label: 'Fees', icon: Wallet },
]

export function ClassHubModule({ onNavigate }: { onNavigate: (key: string) => void }) {
  const { data, error, reload } = useClassHub()
  const [classId, setClassId] = useState<string | null>(null)
  const [tab, setTab] = useState<HubTab>('overview')
  const [search, setSearch] = useState('')
  const [profileStudentId, setProfileStudentId] = useState<string | null>(null)
  const [growthOpen, setGrowthOpen] = useState(false)
  const [reportKind, setReportKind] = useState<ReportKind | null>(null)
  const [marksheetExam, setMarksheetExam] = useState<{ examId: string; examName: string } | null>(null)

  // A reload must refresh BOTH surfaces: the class LIST (KPIs, fee
  // snapshot) and the loaded class DETAIL (directory, attendance report,
  // performance). The detail hook used to receive a pinned tick of 0 —
  // retries and post-edit refreshes never refetched it.
  const [detailTick, setDetailTick] = useState(0)
  const reloadAll = useCallback(() => {
    reload()
    setDetailTick((t) => t + 1)
  }, [reload])

  // ── module-level states (the hooks above always run) ─────────────────

  if (error) {
    return (
      <PageTransition>
        <GlassCard hover={false}>
          <HubEmptyState
            icon={AlertTriangle}
            title="Couldn't load your class hub"
            hint={error}
            action={
              <Button size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
              </Button>
            }
          />
        </GlassCard>
      </PageTransition>
    )
  }

  if (!data) {
    return (
      <PageTransition aria-busy="true">
        <HubModuleSkeleton />
      </PageTransition>
    )
  }

  if (data.classes.length === 0) {
    return (
      <PageTransition>
        <GlassCard hover={false}>
          <HubEmptyState
            icon={School}
            title="You are not a class teacher right now"
            hint="The Class Teacher Hub appears automatically when the principal appoints you class teacher of a class."
          />
        </GlassCard>
      </PageTransition>
    )
  }

  return (
    <ClassHubLoaded
      classes={data.classes}
      reload={reloadAll}
      detailTick={detailTick}
      classId={classId}
      setClassId={setClassId}
      tab={tab}
      setTab={setTab}
      search={search}
      setSearch={setSearch}
      profileStudentId={profileStudentId}
      setProfileStudentId={setProfileStudentId}
      growthOpen={growthOpen}
      setGrowthOpen={setGrowthOpen}
      reportKind={reportKind}
      setReportKind={setReportKind}
      marksheetExam={marksheetExam}
      setMarksheetExam={setMarksheetExam}
      onNavigate={onNavigate}
    />
  )
}

function ClassHubLoaded({
  classes, reload: _reload, detailTick, classId, setClassId, tab, setTab, search, setSearch,
  profileStudentId, setProfileStudentId, growthOpen, setGrowthOpen,
  reportKind, setReportKind, marksheetExam, setMarksheetExam, onNavigate,
}: {
  classes: ClassHubClass[]
  reload: () => void
  detailTick: number
  classId: string | null
  setClassId: (id: string | null) => void
  tab: HubTab
  setTab: (t: HubTab) => void
  search: string
  setSearch: (s: string) => void
  profileStudentId: string | null
  setProfileStudentId: (id: string | null) => void
  growthOpen: boolean
  setGrowthOpen: (v: boolean) => void
  reportKind: ReportKind | null
  setReportKind: (k: ReportKind | null) => void
  marksheetExam: { examId: string; examName: string } | null
  setMarksheetExam: (m: { examId: string; examName: string } | null) => void
  onNavigate: (key: string) => void
}) {
  const active = classes.find((c) => c.classId === classId) ?? classes[0]
  const detail = useClassHubDetail(active.classId, detailTick)

  // §31 — a background class-list refresh (window-focus role sync) must
  // never yank the teacher off the class they are viewing: keep the last
  // active class when it still exists, fall back honestly when it is gone.
  // Explicit selections record themselves in handleClassChange, so this
  // corrector only runs for background-driven active changes.
  const lastActiveRef = useRef(active.classId)
  useEffect(() => {
    if (active.classId !== lastActiveRef.current) {
      if (classes.some((c) => c.classId === lastActiveRef.current)) {
        setClassId(lastActiveRef.current)
        return
      }
      lastActiveRef.current = active.classId
    }
  }, [classes, active.classId, setClassId])

  // Switching class resets to the overview tab — the workspace re-anchors
  // on the new class's snapshot (§26 context preservation).
  const handleClassChange = (id: string | null) => {
    const next = id ?? classes[0].classId ?? null
    lastActiveRef.current = next
    setClassId(next)
    setTab('overview')
    setSearch('')
  }

  /** Header search filters the class directory; typing jumps to the
   *  Students tab so results are visible (one search, one target). */
  const handleSearch = (value: string) => {
    setSearch(value)
    if (value.trim() && tab !== 'students') setTab('students')
  }

  // ── the 7-KPI command row — one compact information-dense strip ────
  const fees = active.fees
  const collectionPct = fees.totalBilled > 0 ? Math.round((fees.totalCollected / fees.totalBilled) * 100) : null
  const openConcerns = useMemo(
    () => classAttentionOf(active, detail.data).length,
    [active, detail.data],
  )
  const kpis: HubStat[] = [
    {
      key: 'students',
      label: 'Students',
      value: active.studentCount,
      icon: Users,
      tone: 'slate',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      value: detail.data?.attendanceReport.overall.ratePct != null ? `${detail.data.attendanceReport.overall.ratePct}%` : null,
      icon: CalendarCheck,
      tone: 'emerald',
      context: detail.data ? `last 30 days · ${detail.data.attendanceReport.overall.markedDays} days` : undefined,
    },
    {
      key: 'average',
      label: 'Class Average',
      value: detail.data?.performance.overallAvgPct != null ? `${detail.data.performance.overallAvgPct}%` : null,
      icon: BarChart3,
      tone: 'sky',
      context: detail.data?.performance.latestExam?.examName,
    },
    {
      key: 'growth',
      label: 'Growth',
      value: active.growth.average,
      icon: TrendingUp,
      tone: 'emerald',
      context:
        active.growth.scoredCount < active.studentCount
          ? `${active.growth.scoredCount} of ${active.studentCount} scored`
          : `all ${active.studentCount} scored`,
    },
    {
      key: 'fees',
      label: 'Fee Collection',
      value: collectionPct != null ? `${collectionPct}%` : null,
      icon: Wallet,
      tone: 'amber',
      progress: collectionPct != null ? collectionPct / 100 : undefined,
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: formatINR(fees.outstanding),
      valueClassName: 'text-xl sm:text-2xl',
      icon: IndianRupee,
      tone: fees.outstanding > 0 ? 'rose' : 'emerald',
      context: fees.overdueStudents > 0 ? `${fees.overdueStudents} overdue` : 'none overdue',
    },
    {
      key: 'concerns',
      label: 'Open Concerns',
      value: openConcerns,
      icon: AlertTriangle,
      tone: openConcerns > 0 ? 'rose' : 'slate',
      context: 'across all areas',
    },
  ]

  return (
    <PageTransition className="space-y-4">
      {/* ── the ONE compact class header — identity + search + selector.
          NO quick-action row: the tabs below are the navigation. */}
      <section
        aria-label={`${active.label} class header`}
        className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-xs"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">My Class</p>
              <h2 className="truncate font-display text-lg font-bold leading-tight tracking-tight">{active.label}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {active.studentCount} student{active.studentCount === 1 ? '' : 's'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Class Teacher
                </span>
                {active.room && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      {active.room}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {/* student search — filters the class directory (Students tab) */}
            <div className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search student…"
                aria-label="Search students in this class"
                className="h-9 w-full pl-8 text-xs"
              />
            </div>
            {classes.length > 1 && (
              <ClassSelect
                classes={classes.map((c) => ({
                  id: c.classId,
                  label: c.label,
                  meta: String(c.studentCount),
                  isClassTeacher: true,
                }))}
                value={active.classId}
                onChange={handleClassChange}
                ariaLabel="Select class"
              />
            )}
          </div>
        </div>
      </section>

      {/* ── the ONE tab system — Overview / Students / Attendance /
          Academics / Fees. Underline bar, horizontally scrollable only
          within its own container on mobile, never wrapping buttons. */}
      <div className="rounded-xl border border-border bg-card px-2 shadow-xs">
        <div role="tablist" aria-label="My Class sections" className="flex items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const isActive = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="h-4 w-4" aria-hidden="true" />
                {t.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── tab content — everything below stays in THIS class's context */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* CLASS SNAPSHOT — the 7 compact KPI tiles */}
          <HubStatCards
            stats={kpis}
            loading={false}
            className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-7"
          />

          {/* the command-center sections — ONE purpose each, no repeated
              numbers, every action in-hub (tab switch or class drawer) */}
          <AttendanceSection
            cls={active}
            report={detail.data?.attendanceReport ?? null}
            onOpenReport={() => setTab('attendance')}
            onNavigate={onNavigate}
          />
          <PerformanceSection
            detail={detail.data}
            onOpenAcademics={() => setTab('academics')}
          />
          <GrowthSection
            cls={active}
            detail={detail.data}
            onOpenGrowth={() => setGrowthOpen(true)}
          />
          <FeesSection
            cls={active}
            onOpenFees={() => setTab('fees')}
            onOpenProfile={setProfileStudentId}
          />
          <StudentAttentionSection
            cls={active}
            detail={detail.data}
            onOpenProfile={setProfileStudentId}
            onOpenStudents={() => setTab('students')}
          />
          <ReportsSection
            cls={active}
            detail={detail.data}
            onOpenReport={(kind) => setReportKind(kind)}
          />
        </div>
      )}

      {tab === 'students' && (
        <StudentsTab
          label={active.label}
          directory={detail.data?.directory ?? []}
          search={search}
          onOpenProfile={setProfileStudentId}
        />
      )}

      {tab === 'attendance' && (
        <AttendanceReportTab
          cls={active}
          report={detail.data?.attendanceReport ?? null}
          onOpenProfile={setProfileStudentId}
        />
      )}

      {tab === 'academics' && (
        <AcademicsTab
          cls={active}
          detail={detail.data}
          onOpenMarksheet={(examId) => {
            const m = detail.data?.marksheets.find((x) => x.examId === examId)
            setMarksheetExam({ examId, examName: m?.examName ?? 'Marksheet' })
          }}
          onOpenProfile={setProfileStudentId}
        />
      )}

      {tab === 'fees' && <FeesTab classId={active.classId} />}

      {/* ── the ONE canonical student profile (no second profile system,
          master task §2/§25 — the SAME StudentProfilePage the Principal
          renders, fed with server-authorized teacher data) */}
      <HubStudentProfileSheet
        studentId={profileStudentId}
        onOpenChange={(o) => {
          if (!o) setProfileStudentId(null)
        }}
      />

      {/* ── class-scoped detail drawers */}
      <GrowthDrawer
        open={growthOpen}
        onOpenChange={(o) => !o && setGrowthOpen(false)}
        cls={active}
        detail={detail.data}
      />
      <ReportDrawer
        open={reportKind != null}
        onOpenChange={(o) => !o && setReportKind(null)}
        cls={active}
        detail={detail.data}
        initialKind={reportKind ?? 'attendance'}
      />
      <MarksheetDrawer
        open={marksheetExam != null}
        onOpenChange={(o) => !o && setMarksheetExam(null)}
        classId={active.classId}
        examId={marksheetExam?.examId ?? null}
        examName={marksheetExam?.examName ?? null}
      />
    </PageTransition>
  )
}
