'use client'

/**
 * ClassReport — class-wise attendance table.
 *
 * Brief section 11: keep the existing structure (Class / Total / Present /
 * Absent / Late / Rate / Status). Refine:
 *   - row spacing (compact)
 *   - typography (tabular-nums for counts, small muted labels)
 *   - status badges (restrained semantic styling, no oversize)
 *   - thin progress bar (2px, not 6px)
 *   - hover state (subtle bg, not full color)
 *   - sticky header on tall viewports
 *
 * Brief section 17: reuses the existing Export button from parent
 * — no separate "Export CSV" button competing with the page-level Export.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { FileSpreadsheet } from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { classSections } from '@/lib/mock/attendance'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'

/** attendance-overview-real — school-wide per grade-group rows derived from
 *  GET /api/attendance/overview `byClass` (all-record rate + real counts).
 *  Passed by the parent (StudentWorkspace); the per-class branch below still
 *  reads classSections (per-class roster workstream). */
export interface ClassReportRow {
  class: string
  rate: number
  total: number
  present: number
  late: number
  absent: number
  leave: number
}

export function ClassReport({ onExport: _onExport, classFilter = 'all', schoolRows }: {
  onExport?: () => void
  classFilter?: string
  /** REAL grade-group rows for the All-Classes view (latest-record rates). */
  schoolRows?: ClassReportRow[]
}) {
  // FINAL-GATE (EG-9F/R7) — the per-class branch's classSections corpus is
  // demo-only fabrication; a real tenant's per-class lookup yields no row
  // (honest empty table). The All-Classes branch is REAL data (parent).
  const isDemo = useIsDemoTenant()

  // Build the rows based on classFilter
  let rows: ClassReportRow[]
  if (classFilter === 'all') {
    // attendance-overview-real — school-wide grade-group summary from the
    // canonical Attendance rows (first 10 groups, same footprint as before).
    rows = (schoolRows ?? []).slice(0, 10).map((r) => ({
      class: r.class,
      rate: r.rate,
      total: r.total,
      present: r.present,
      late: r.late,
      absent: r.absent,
      leave: r.leave,
    }))
  } else {
    // Filter: show only the selected class section
    const section = isDemo ? classSections.find((c) => c.id === classFilter) : undefined
    rows = section ? [{
      class: section.name,
      rate: section.rate,
      total: section.total,
      present: section.present,
      late: section.late,
      absent: section.absent,
      leave: section.leave,
    }] : []
  }

  return (
    <GlassCard className="p-3 sm:p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
            Class-wise Attendance Report
          </h3>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
            {/* FINAL-GATE label honesty: the All-Classes rows are per
                grade-group rates over ALL recorded attendance rows (sorted
                by grade) — not "today's" figures. The single-class branch
                shows that section's snapshot. */}
            {classFilter === 'all'
              ? 'Grade-group rate · all recorded sessions · sorted by grade'
              : 'Section snapshot · today’s roster'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Class</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Total</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Present</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Absent</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Late</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 w-32">Rate</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const pct = Math.round(row.rate)
              const status = pct >= 95 ? 'Excellent' : pct >= 90 ? 'Good' : pct >= 85 ? 'Average' : 'Needs Attention'
              const statusColor = pct >= 95
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                : pct >= 90
                ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20'
                : pct >= 85
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
              const barColor = pct >= 95
                ? ATTENDANCE_COLORS.excellent
                : pct >= 90
                ? ATTENDANCE_COLORS.good
                : pct >= 85
                ? ATTENDANCE_COLORS.average
                : ATTENDANCE_COLORS.atRisk
              return <ClassRowItem key={row.class} idx={i} row={row} pct={pct} status={status} statusColor={statusColor} barColor={barColor} />
            })}
          </TableBody>
        </Table>
      </div>
    </GlassCard>
  )
}

const ATTENDANCE_COLORS = {
  excellent: 'oklch(0.65 0.16 162)',
  good: 'oklch(0.55 0.13 220)',
  average: 'oklch(0.75 0.15 75)',
  atRisk: 'oklch(0.62 0.2 25)',
}

function ClassRowItem({
  row, idx, pct, status, statusColor, barColor,
}: {
  row: { class: string; rate: number; total: number; present: number; late: number; absent: number; leave: number }
  idx: number
  pct: number
  status: string
  statusColor: string
  barColor: string
}) {
  const reduce = useReducedMotion()
  return (
    <TableRow className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors text-xs">
      <TableCell className="font-medium text-foreground py-2.5">{row.class}</TableCell>
      <TableCell className="font-mono tabular-nums text-muted-foreground py-2.5 text-right">{row.total}</TableCell>
      <TableCell className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 py-2.5 text-right">{row.present}</TableCell>
      <TableCell className="font-mono tabular-nums text-rose-600 dark:text-rose-400 py-2.5 text-right">{row.absent}</TableCell>
      <TableCell className="font-mono tabular-nums text-amber-600 dark:text-amber-400 py-2.5 text-right">{row.late}</TableCell>
      <TableCell className="py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
            <motion.div
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, delay: Math.min(idx * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: barColor }}
            />
          </div>
          <span className="text-[10px] font-semibold tabular-nums w-8 text-right">{pct}%</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5">
        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${statusColor}`}>
          {status}
        </span>
      </TableCell>
    </TableRow>
  )
}
