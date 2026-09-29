'use client'

/**
 * KpiRow — 4 primary actionable KPIs for the principal.
 *
 * Reduced from 8 → 4 per the DASH-A audit. The 4 actionable KPIs a principal
 * needs at a glance:
 *   1. Attendance (emerald) — today's school-wide attendance rate
 *   2. Pending fees (rose) — outstanding dues (Round-7: SERVER TRUTH)
 *   3. New admissions (sky) — students admitted this month (REAL: derived
 *      from the roster's admissionDate in the students store)
 *   4. Upcoming exams (amber) — scheduled examinations
 *
 * Each card is clickable — clicking navigates to the relevant module:
 *   Attendance → attendance, Pending fees → fees (deep-links to the
 *   Outreach tab via the focus store, because the card's numbers ARE the
 *   Outreach tab's numbers — same /api/fees/defaulters aggregation),
 *   New admissions → admission, Upcoming exams → exams
 *
 * Round-7 consistency fix: "Pending Fees" used to quote the static mock
 * finance series (₹1.84 Cr / 142 students) while Fee Management and the
 * Outreach tab told two OTHER stories. The card now reads the live dues
 * summary (dues-summary-store → GET /api/fees/defaulters?summary=1) —
 * mock values serve only as the pre-sync fallback, and the "live" chip
 * appears only once the server number is actually on screen (the mock
 * sparkline is dropped in that state — never a fake trend under a real
 * number).
 *
 * Removed (relocated): Students total, Teachers count, Revenue, Salary due —
 * these are passive status, not actionable, and now live on the WelcomeBanner
 * meta strip (Students / Teachers) or in their dedicated modules.
 *
 * Removed: `SecondaryKpiRow` (was dead code at lines 38-47).
 */

import { useEffect, useMemo } from 'react'
import {
  CalendarCheck, IndianRupee, UserPlus, FileText,
} from 'lucide-react'
import { feeAnalytics } from '@/lib/mock/finance'
import { formatINR } from '@/lib/format'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { useFocusStore } from '@/lib/store/focus-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { LiveChip } from '../shared/live-chip'
import { useAttendanceOverview } from '../attendance/use-attendance-overview'
import { useUpcomingExams } from './use-upcoming-exams'

export interface KpiRowProps {
  onNavigate?: (module: string) => void
}

export function KpiRow({ onNavigate }: KpiRowProps) {
  // attendance-overview-real — the Attendance card reads the canonical
  // Attendance table (GET /api/attendance/overview, session-cached): latest
  // recorded day's rate + present count + the real 6-day sparkline. While
  // the fetch is in flight the card shows an honest "—" placeholder (same
  // pattern as the dues card's pre-live fallback).
  const { data: attendance } = useAttendanceOverview()

  // REAL upcoming exams — canonical /api/exams rows (was the mock
  // "Pre-Board in 12 days" constant).
  const upcoming = useUpcomingExams()

  // Round-7 — server-truth dues for the Pending Fees card (mock fallback
  // until the sync lands; honest lineage via the live chip).
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensureDues = useDuesSummaryStore((s) => s.ensure)
  useEffect(() => { void ensureDues() }, [ensureDues])

  // REAL admissions intelligence — every figure on the New Admissions card
  // is derived from the roster's admissionDate ('YYYY-MM-DD') in the students
  // store (DB-hydrated): KPI = ACTIVE students admitted in the current
  // calendar month, sub = real month-over-month delta, sparkline = the real
  // monthly series ending on the current month (replaces the mock
  // studentStats.newThisMonth and the mock analytics trend).
  const students = useStudentsStore((s) => s.students)
  const admissionsSeries = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })
    const counts = months.map(() => 0)
    for (const st of students) {
      if (st.status !== 'Active') continue
      const parts = st.admissionDate.split('-').map(Number)
      const idx = months.findIndex((m) => m.year === parts[0] && m.month === parts[1])
      if (idx >= 0) counts[idx]++
    }
    return counts
  }, [students])
  const newThisMonth = admissionsSeries[admissionsSeries.length - 1] ?? 0
  const newLastMonth = admissionsSeries[admissionsSeries.length - 2] ?? 0
  const momDelta = newThisMonth - newLastMonth
  const admissionsSub =
    momDelta > 0 ? `+${momDelta} vs last month`
      : momDelta < 0 ? `${momDelta} vs last month`
        : 'Same as last month'

  /** Deep-link: fees module + Outreach tab (the card's numbers live there). */
  const openOutreach = () => {
    if (!onNavigate) return
    useFocusStore.getState().setFocus({
      type: 'fee-outreach',
      id: 'fee-outreach',
      title: 'Fee defaulter outreach',
      moduleKey: 'fees',
    })
    onNavigate('fees')
  }

  const feesValue = dues ? dues.totalOutstanding : feeAnalytics.pendingDues
  const feesSub = dues
    ? `${dues.defaulterCount} student${dues.defaulterCount === 1 ? '' : 's'} · ${dues.overdueCount > 0 ? `${dues.overdueCount} past due` : 'all current'}`
    : `${feeAnalytics.pendingCount} students`

  return (
    <SummaryCardGrid columns={4}>
      <SummaryCard
        label="Attendance"
        value={attendance ? attendance.today.rate : '—'}
        suffix={attendance ? '%' : undefined}
        sub={attendance
          ? `${attendance.today.present.toLocaleString('en-IN')} present`
          : 'Loading…'}
        tone="emerald"
        icon={<CalendarCheck className="h-4 w-4" />}
        delay={0}
        sparkline={attendance ? attendance.weekTrend.map((d) => d.rate) : undefined}
        trend="up"
        onClick={onNavigate ? () => onNavigate('attendance') : undefined}
      />
      <SummaryCard
        label="Pending Fees"
        value={formatINR(feesValue, true)}
        sub={feesSub}
        chip={dues ? <LiveChip /> : undefined}
        tone="rose"
        icon={<IndianRupee className="h-4 w-4" />}
        delay={0.04}
        sparkline={dues ? undefined : feeAnalytics.monthly.map((d) => d.pending)}
        trend="up"
        onClick={onNavigate ? (dues && dues.defaulterCount > 0 ? openOutreach : () => onNavigate('fees')) : undefined}
      />
      <SummaryCard
        label="New Admissions"
        value={newThisMonth}
        sub={admissionsSub}
        tone="sky"
        icon={<UserPlus className="h-4 w-4" />}
        delay={0.08}
        sparkline={admissionsSeries}
        trend={momDelta > 0 ? 'up' : momDelta < 0 ? 'down' : 'neutral'}
        onClick={onNavigate ? () => onNavigate('admission') : undefined}
      />
      <SummaryCard
        label="Upcoming Exams"
        value={upcoming ? upcoming.count : '—'}
        sub={upcoming ? upcoming.sub : 'No scheduled exams'}
        tone="amber"
        icon={<FileText className="h-4 w-4" />}
        delay={0.12}
        trend="neutral"
        onClick={onNavigate ? () => onNavigate('exams') : undefined}
      />
    </SummaryCardGrid>
  )
}
