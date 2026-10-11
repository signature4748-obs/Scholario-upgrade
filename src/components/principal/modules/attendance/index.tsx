'use client'

/**
 * AttendanceModule — Phase 2 entry point.
 *
 * Brief §1: Three-section sub-navigation:
 *   - Overview (student attendance + analytics)
 *   - Teachers & Employees (staff attendance managed by Principal)
 *   - History (past attendance records + downloads)
 *
 * Brief §10: Class filter is owned here and passed down to Overview +
 * History so they stay in sync.
 *
 * Brief §19: Heatmap → "View full attendance" CTA navigates to History
 * with the picked day pre-set.
 */

import { useState, useCallback } from 'react'
import { PageTransition } from '@/components/shared/ui'
import { toast } from 'sonner'
import { downloadCSVFile, safeFileName } from '@/lib/download-file'
import { toCsv } from '@/lib/csv'
import { AttendanceTabs, type AttendanceTab } from './attendance-tabs'
import { StudentWorkspace } from './student-workspace'
import { StaffAttendanceTab } from './staff-tab'
import { AttendanceHistoryTab } from './history-tab'
import { useAttendanceOverview } from './use-attendance-overview'

export function AttendanceModule() {
  const [activeTab, setActiveTab] = useState<AttendanceTab>('overview')
  // Shared class filter — used by Overview + History (Brief §10)
  const [classFilter, setClassFilter] = useState<string>('all')
  // History pre-fill — set when user clicks "View full attendance" (Brief §19)
  const [historyInitialDate, setHistoryInitialDate] = useState<string | undefined>(undefined)
  const [historyInitialClassId, setHistoryInitialClassId] = useState<string | undefined>(undefined)

  // Brief §18: Export respects current tab + filter context.
  // QA-FIX-A: REAL CSV download of the Overview's class-wise summary table
  // (the exact rows ClassReport renders), respecting the class filter.
  // Phase B: the export scope follows the classFilter — All-Classes rows
  // are the canonical grade-group summaries; a specific class exports
  // THAT class's real aggregate row (GET /api/attendance/overview?classId=
  // — per-scope session cache, same fetch as the Overview tab). The demo
  // classSections corpus is retired from the export path.
  const { data: overview } = useAttendanceOverview(classFilter === 'all' ? undefined : classFilter)
  const handleExport = useCallback(() => {
    // Mirror ClassReport's row derivation (class-report.tsx).
    const statusFor = (pct: number) =>
      pct >= 95 ? 'Excellent' : pct >= 90 ? 'Good' : pct >= 85 ? 'Average' : 'Needs Attention'
    const rows: (string | number)[][] = []
    const summary = (overview?.byClass ?? []).slice(0, classFilter === 'all' ? 10 : 1)
    summary.forEach((r) => {
      rows.push([r.class, r.students, r.present, r.absent, r.late, r.leave, r.rate, statusFor(Math.round(r.rate))])
    })
    const filename = safeFileName(
      `attendance-overview${classFilter === 'all' ? '' : `-${classFilter}`}`,
      'csv',
    )
    downloadCSVFile(
      toCsv(['Class', 'Total', 'Present', 'Absent', 'Late', 'Leave', 'Rate (%)', 'Status'], rows),
      filename,
    )
    const scope = classFilter === 'all'
      ? 'All Classes'
      : overview?.class?.name ?? classFilter
    toast.success('Attendance report exported', {
      description: `${filename} · ${rows.length} class summar${rows.length === 1 ? 'y' : 'ies'} · ${scope}`,
    })
  }, [classFilter, overview])

  // Brief PART 8 + §19: View full attendance from heatmap → switch to
  // History tab with the date pre-filled. Accepts ISO date string (YYYY-MM-DD).
  const handleViewFullAttendance = useCallback((dateStr: string) => {
    setHistoryInitialDate(dateStr)
    setHistoryInitialClassId(classFilter === 'all' ? undefined : classFilter)
    setActiveTab('history')
  }, [classFilter])

  return (
    <PageTransition className="space-y-4">
      {/* Sub-navigation tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <AttendanceTabs value={activeTab} onValueChange={setActiveTab} />
      </div>

      {/* Active tab content */}
      {activeTab === 'overview' && (
        <StudentWorkspace
          classFilter={classFilter}
          setClassFilter={setClassFilter}
          onExport={handleExport}
          onViewFullAttendance={handleViewFullAttendance}
        />
      )}

      {activeTab === 'staff' && (
        <StaffAttendanceTab />
      )}

      {activeTab === 'history' && (
        <AttendanceHistoryTab
          initialDate={historyInitialDate}
          initialClassId={historyInitialClassId}
        />
      )}
    </PageTransition>
  )
}
