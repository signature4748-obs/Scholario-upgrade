'use client'

/**
 * StudentWorkspace (Overview tab) — Brief §3-§12 (Phase 2) + PART 3-4-26 (Phase 5).
 *
 * Brief §10: ALL metrics respect the classFilter — no school-wide numbers
 * shown when a specific class is selected.
 *
 * Brief PART 3: All Classes filter is compact (size="sm" to match h-8 rhythm).
 * Brief PART 4 + PART 26 (superseded by QA-FIX-A): the Overview Export
 *   button is live again — it now performs a REAL CSV download of the
 *   class-wise summary table (handler lives in attendance/index.tsx).
 *   Monthly PDF exports remain in Attendance → History.
 *
 * Brief §11: Live Class Snapshot behavior is context-aware — handled in
 * AttendanceInsights.
 */

import { useState, useMemo, useEffect } from 'react'
import { Filter, CalendarCheck, UserCheck, UserX, Clock, ArrowUpRight, ArrowDownRight, Download } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  classSections,
  getClassSection,
  getClassWeeklyTrend,
  getClassMonthlyTrend,
} from '@/lib/mock/attendance'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { formatNumber } from '@/lib/format'
import { ModuleHeader } from '../shared/module-header'
import { OverviewCharts } from './overview-charts'
import { AttendanceHeatmap } from './heatmap'
import { ClassReport, type ClassReportRow } from './class-report'
import { AttendanceInsights, type AttendanceInsightsData } from './insights'
import { useAttendanceOverview } from './use-attendance-overview'

interface StudentWorkspaceProps {
  classFilter: string
  setClassFilter: (v: string) => void
  onExport: () => void  // QA-FIX-A: REAL CSV export of the summary table
  onViewFullAttendance: (dateStr: string) => void
}

export function StudentWorkspace({
  classFilter, setClassFilter, onExport, onViewFullAttendance,
}: StudentWorkspaceProps) {
  // attendance-overview-real — school-wide figures come from the canonical
  // Attendance table (GET /api/attendance/overview, session-cached). The
  // per-class branch below still reads classSections (per-class roster
  // workstream); only the All-Classes path was fabricated school-wide.
  const { data } = useAttendanceOverview()
  const [selectedDay, setSelectedDay] = useState<number | null>(10)

  // FINAL-GATE (EG-9F/R7) — the per-class branch (section snapshot, weekly /
  // monthly trends, filter options) reads the demo-only classSections
  // corpus: for a real production tenant the corpus is withheld (real
  // canonical data only — the All-Classes path — and an honest filter that
  // offers no fabricated classes).
  const isDemo = useIsDemoTenant()

  // Brief §10: derive ALL metrics from classFilter
  const isAllClasses = classFilter === 'all'
  const section = isDemo ? getClassSection(classFilter) : null

  // Per-class weekly + monthly trends (All-Classes = real recorded series;
  // non-demo tenants always take the real series — no fabricated trends).
  // Hooks stay unconditional — the loading early-return below comes after.
  const weeklyTrend = useMemo(
    () => (isAllClasses || !isDemo
      ? (data?.weekTrend ?? []).map((d) => ({ day: d.day, date: d.date, present: d.present, rate: d.rate }))
      : getClassWeeklyTrend(classFilter)),
    [isAllClasses, classFilter, data, isDemo],
  )
  const monthlyTrend = useMemo(
    () => (isAllClasses || !isDemo
      ? (data?.monthly ?? []).map((m) => ({ month: m.month, rate: m.rate }))
      : getClassMonthlyTrend(classFilter)),
    [isAllClasses, classFilter, data, isDemo],
  )

  // attendance-overview-real — the real "today" of the dataset (latest
  // recorded date); anchors the header month, the heatmap's opening month
  // and the default selected day.
  const latestDate = data?.today.date ?? null

  // Default the selected day to the latest recorded day once data lands
  // (mirrors the old Dec-10 "demo today" default with the real date).
  useEffect(() => {
    if (!latestDate) return
    setSelectedDay(Number(latestDate.slice(8, 10)))
  }, [latestDate])

  // Loading state — one centered pulse tile (app-shell skeleton pattern)
  // until the canonical overview lands.
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 animate-pulse" />
      </div>
    )
  }

  const { todaysRate, present, absent, late, leave, total } = (() => {
    if (isAllClasses || !section) {
      // attendance-overview-real — latest RECORDED day, honest denominator
      // (distinct students marked that day, not school size).
      const t = data.today
      return {
        todaysRate: t.rate,
        present: t.present,
        absent: t.absent,
        late: t.late,
        leave: t.leave,
        total: t.total,
      }
    }
    return {
      todaysRate: section.rate,
      present: section.present,
      absent: section.absent,
      late: section.late,
      leave: section.leave,
      total: section.total,
    }
  })()

  // KPI contextual info — derived from REAL data
  const yesterdayRate = weeklyTrend[weeklyTrend.length - 2]?.rate ?? todaysRate
  const wowDelta = +(todaysRate - yesterdayRate).toFixed(1)
  const absentPct = total > 0 ? +((absent / total) * 100).toFixed(1) : 0
  const latePct = total > 0 ? +((late / total) * 100).toFixed(1) : 0

  // Header month label + heatmap opening month — from the latest recorded date.
  const monthMeta = latestDate
    ? new Date(Number(latestDate.slice(0, 4)), Number(latestDate.slice(5, 7)) - 1, 1)
        .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : ''
  const initialMonth = latestDate
    ? { year: Number(latestDate.slice(0, 4)), month: Number(latestDate.slice(5, 7)) }
    : undefined

  // attendance-overview-real — grade-group rows for the Class-wise Report
  // (All-Classes) + the three headline insight cards.
  const schoolRows: ClassReportRow[] = data.byClass.map((g) => ({
    class: g.class,
    rate: g.rate,
    total: g.students,
    present: g.present,
    late: g.late,
    absent: g.absent,
    leave: g.leave,
  }))
  const insightsData: AttendanceInsightsData = (() => {
    const sorted = [...data.byClass].sort((a, b) => b.rate - a.rate)
    const best = sorted[0] ?? null
    const needs = sorted.length > 1 ? sorted[sorted.length - 1] : null
    return {
      best: best ? { class: best.class, rate: best.rate, students: best.students } : null,
      needs: needs ? { class: needs.class, rate: needs.rate, students: needs.students } : null,
      average: data.today.total > 0
        ? { rate: data.today.rate, classes: data.byClass.length, students: data.today.total }
        : null,
    }
  })()

  return (
    <PageTransition className="space-y-4">
      {/* Brief PART 3: compact All Classes filter; QA-FIX-A: real CSV Export */}
      <ModuleHeader
        meta={[monthMeta, isAllClasses ? 'All Classes' : (section?.name ?? '')]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={onExport}
              title="Export the class-wise summary table as CSV"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger size="sm" className="w-[150px] text-xs hidden sm:flex rounded-lg">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {isDemo && classSections.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        }
      />

      {/* Brief §4: refined compact KPI cards (filter-aware) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <RefinedKpi
          label="Today's Rate"
          value={`${todaysRate}%`}
          icon={<CalendarCheck className="h-3.5 w-3.5" />}
          tone="emerald"
          indicator={wowDelta >= 0 ? 'up' : 'down'}
          indicatorValue={`${Math.abs(wowDelta)}% vs yesterday`}
        />
        <RefinedKpi
          label="Present Today"
          value={formatNumber(present)}
          icon={<UserCheck className="h-3.5 w-3.5" />}
          tone="cyan"
          indicatorValue={`of ${formatNumber(total)} ${isAllClasses ? 'students' : 'in class'}`}
        />
        <RefinedKpi
          label="Absent + Leave"
          value={formatNumber(absent + leave)}
          icon={<UserX className="h-3.5 w-3.5" />}
          tone="rose"
          indicatorValue={`${absentPct}% of ${isAllClasses ? 'students' : 'class'}`}
        />
        <RefinedKpi
          label="Late Arrivals"
          value={formatNumber(late)}
          icon={<Clock className="h-3.5 w-3.5" />}
          tone="amber"
          indicatorValue={`${latePct}% · within 15 min window`}
        />
      </div>

      {/* Charts row — now filter-aware */}
      <OverviewCharts
        todaysRate={todaysRate}
        present={present}
        absent={absent}
        late={late}
        leave={leave}
        total={total}
        weeklyTrend={weeklyTrend}
        monthlyTrend={monthlyTrend}
      />

      <AttendanceHeatmap
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        onViewFullAttendance={onViewFullAttendance}
        daily={data.daily}
        initialMonth={initialMonth}
      />

      <ClassReport classFilter={classFilter} schoolRows={schoolRows} />

      <AttendanceInsights
        classFilter={classFilter}
        insights={insightsData}
        schoolRows={schoolRows}
        onViewAllClasses={() => {
          // Brief §11: View all classes → currently no full screen modal,
          // could navigate to a dedicated page later. For now, switch filter
          // back to all classes so all classes are visible.
          setClassFilter('all')
        }}
      />
    </PageTransition>
  )
}

/* ──────────────────────────────────────────────────────────
   RefinedKpi — compact KPI card with contextual indicator
   ────────────────────────────────────────────────────────── */
type KpiTone = 'emerald' | 'cyan' | 'rose' | 'amber'

const TONE_CLASSES: Record<KpiTone, { text: string; bg: string; border: string }> = {
  emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-border hover:border-emerald-500/40' },
  cyan:    { text: 'text-cyan-600 dark:text-cyan-400',       bg: 'bg-cyan-500/5',    border: 'border-border hover:border-cyan-500/40' },
  rose:    { text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-500/5',     border: 'border-border hover:border-rose-500/40' },
  amber:   { text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/5',    border: 'border-border hover:border-amber-500/40' },
}

function RefinedKpi({
  label, value, icon, tone, indicator, indicatorValue,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: KpiTone
  indicator?: 'up' | 'down'
  indicatorValue: string
}) {
  const t = TONE_CLASSES[tone]
  return (
    <div className={`rounded-xl border p-3 sm:p-4 transition-colors ${t.bg} ${t.border}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/60">{icon}</span>
      </div>
      <p className={`font-display text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${t.text}`}>
        {value}
      </p>
      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
        {indicator === 'up' && <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
        {indicator === 'down' && <ArrowDownRight className="h-3 w-3 text-rose-600 dark:text-rose-400" />}
        <span className="truncate">{indicatorValue}</span>
      </div>
    </div>
  )
}
