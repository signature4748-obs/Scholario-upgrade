'use client'

/**
 * AttendanceHistoryTab — Brief PART 26-33 + PART 43-45 (Phase 5).
 *
 * Brief PART 26: Export lives HERE only (not in Overview or Staff tab).
 * Brief PART 27: Exports are MONTHLY reports (not arbitrary date range).
 * Brief PART 28: Student/Class attendance export — class-wise monthly report.
 * Brief PART 29: Staff attendance export — SEPARATE monthly report.
 * Brief PART 30: Month selector + two export actions.
 * Brief PART 31: Replace arbitrary date-range with month selection.
 * Brief PART 33: History view (browse records) is separate from Monthly Export.
 * Brief PART 43: Export shows "Generating..." → "✓ Report ready" feedback.
 * Brief PART 44: Professional report names.
 * Brief PART 45: Reports respect school calendar (no holiday counted as absent).
 */

import { useMemo, useState, useEffect } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import { Search, ArrowLeft, Eye, FileText, Users, CheckCircle2, Loader2, ChevronDown } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  attendanceHistory,
  classSections,
  getHistoryForDateClass,
  type AttendanceHistoryRecord,
} from '@/lib/mock/attendance'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { formatNumber } from '@/lib/format'
import { toast } from 'sonner'
import { ATTENDANCE_PALETTE } from './attendance-charts'
import { generateStudentMonthlyPDF, generateStaffMonthlyPDF } from './monthly-report-pdf'

const STATUS_VARIANT: Record<AttendanceHistoryRecord['status'], {
  cls: string; dot: string
}> = {
  'Excellent':       { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-500' },
  'Good':            { cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20', dot: 'bg-sky-500' },
  'Needs Attention': { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20', dot: 'bg-rose-500' },
}

/** Build the month picker options (last 12 months from Dec 2025). */
function buildMonthOptions(): { value: string; label: string; year: number; month: number }[] {
  const options: { value: string; label: string; year: number; month: number }[] = []
  const baseYear = 2025
  const baseMonth = 12  // December 2025
  for (let i = 0; i < 12; i++) {
    let y = baseYear
    let m = baseMonth - i
    while (m < 1) {
      m += 12
      y -= 1
    }
    const date = new Date(y, m - 1, 1)
    const value = `${y}-${String(m).padStart(2, '0')}`
    const label = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    options.push({ value, label, year: y, month: m })
  }
  return options
}

const MONTH_OPTIONS = buildMonthOptions()

interface AttendanceHistoryTabProps {
  /** When navigated from heatmap, pre-set date + class. */
  initialDate?: string
  initialClassId?: string
}

type ExportKind = 'student' | 'staff' | null

// FINAL-GATE (EG-9F/R7) — stable empty fallbacks so the demo-conditional
// corpora keep referential identity across renders.
const NO_SECTIONS: typeof classSections = []
const NO_HISTORY: typeof attendanceHistory = []

export function AttendanceHistoryTab({ initialDate, initialClassId }: AttendanceHistoryTabProps) {
  const reduce = useReducedMotion()

  // FINAL-GATE (EG-9F/R7) — the classSections + attendanceHistory corpora
  // are deterministic DEMO fabrications (rosters, rates, teacher names).
  // They render ONLY for the demo tenant; a real production tenant sees
  // the tab's honest empty state ("No attendance records found…") and its
  // class filter stays on All Classes until real class data exists.
  const isDemo = useIsDemoTenant()
  const sections = isDemo ? classSections : NO_SECTIONS
  const historyRecords = isDemo ? attendanceHistory : NO_HISTORY
  // Brief PART 31: single month selector (replaces arbitrary date range).
  const [selectedMonth, setSelectedMonth] = useState<string>('2025-12')
  const [classFilter, setClassFilter] = useState<string>(initialClassId ?? 'all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [viewRecord, setViewRecord] = useState<AttendanceHistoryRecord | null>(null)
  // Brief PART 43: export loading + success state.
  const [exporting, setExporting] = useState<ExportKind>(null)
  const [exported, setExported] = useState<{ kind: ExportKind; label: string } | null>(null)

  // Apply incoming initial props (e.g. from heatmap CTA — pre-fill month).
  useEffect(() => {
    if (initialDate) {
      // Brief PART 8: pre-fill the month from the date string
      const month = initialDate.substring(0, 7)  // "2025-12"
      setSelectedMonth(month)
    }
    if (initialClassId) {
      setClassFilter(initialClassId)
    }
  }, [initialDate, initialClassId])

  // Brief PART 32: filter records for the selected month (VIEW filter —
  // separate from the monthly EXPORT, which is always the full month).
  const filtered = useMemo(() => {
    const [_year, _month] = selectedMonth.split('-').map(Number)
    return historyRecords.filter((r) => {
      const rMonth = r.date.substring(0, 7)  // "2025-12"
      if (rMonth !== selectedMonth) return false
      if (classFilter !== 'all' && r.classId !== classFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.className.toLowerCase().includes(q) && !r.date.includes(q)) return false
      }
      return true
    })
  }, [selectedMonth, classFilter, statusFilter, search, historyRecords])

  // Brief PART 30: Get the selected month label for export naming.
  const selectedMonthLabel = useMemo(() => {
    const opt = MONTH_OPTIONS.find((o) => o.value === selectedMonth)
    return opt ? opt.label : selectedMonth
  }, [selectedMonth])

  // Brief PART 43-44: Export Student Attendance → REAL PDF (Brief PART 14-20).
  // Brief PART 11 + 36: accepts a classId ('all' or specific) for class-wise export.
  // FINAL-GATE (EG-9F/R7) — the monthly PDFs derive from the same demo
  // corpus; a real tenant gets an honest "nothing to export yet" notice
  // instead of a fabricated report.
  const handleExportStudent = (classId: string = 'all') => {
    if (exporting) return
    if (!isDemo) {
      toast.info('No attendance records to export yet', {
        description: 'Monthly reports appear once class attendance records are synced.',
      })
      return
    }
    setExporting('student')
    setExported(null)
    try {
      const { filename } = generateStudentMonthlyPDF(selectedMonth, classId)
      setExporting(null)
      const cls = sections.find((c) => c.id === classId)
      const label = cls
        ? `${selectedMonthLabel} — ${cls.name} Attendance Report`
        : `${selectedMonthLabel} — Class Attendance Report`
      setExported({ kind: 'student', label })
      toast.success('Class Attendance Report generated', {
        description: `${filename} · ${label}`,
      })
    } catch (err) {
      setExporting(null)
      toast.error('Unable to generate report', {
        description: 'Please try again.',
      })
    }
  }

  // Brief PART 43-44: Export Staff Attendance → REAL PDF (Brief PART 14-20).
  // Brief PART 29: completely separate from student report.
  // FINAL-GATE (EG-9F/R7) — same demo-only gate as the student export.
  const handleExportStaff = () => {
    if (exporting) return
    if (!isDemo) {
      toast.info('No attendance records to export yet', {
        description: 'Monthly reports appear once staff attendance records are synced.',
      })
      return
    }
    setExporting('staff')
    setExported(null)
    try {
      const { filename } = generateStaffMonthlyPDF(selectedMonth)
      setExporting(null)
      const label = `${selectedMonthLabel} — Teachers & Employees Attendance Report`
      setExported({ kind: 'staff', label })
      toast.success('Staff Attendance Report generated', {
        description: `${filename} · ${label}`,
      })
    } catch (err) {
      setExporting(null)
      toast.error('Unable to generate report', {
        description: 'Please try again.',
      })
    }
  }

  // Brief PART 30: Find selected month option object
  const _selectedMonthOption = MONTH_OPTIONS.find((o) => o.value === selectedMonth)

  return (
    <PageTransition className="space-y-4">
      {/* Brief PART 14: Filters row — separated from actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger size="sm" className="w-[170px] text-xs rounded-lg">
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger size="sm" className="w-[150px] text-xs rounded-lg">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {sections.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-[140px] text-xs rounded-lg">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Excellent">Excellent</SelectItem>
            <SelectItem value="Good">Good</SelectItem>
            <SelectItem value="Needs Attention">Needs Attention</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-8 pr-3 text-xs w-[160px] rounded-lg"
          />
        </div>
      </div>

      {/* Brief PART 14 + 15: Actions row — right-aligned, premium export dropdown */}
      <div className="flex items-center justify-end gap-2">
        {/* Brief PART 11 + 15: Export Student dropdown — All Classes + individual classes */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 rounded-lg"
              disabled={exporting !== null}
            >
              {exporting === 'student' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {exporting === 'student' ? 'Generating...' : 'Export Student'}
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Monthly PDF · {selectedMonthLabel}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleExportStudent('all')} className="text-xs gap-2">
              <FileText className="h-3.5 w-3.5" /> All Classes
            </DropdownMenuItem>
            {sections.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => handleExportStudent(c.id)} className="text-xs gap-2">
                <FileText className="h-3.5 w-3.5" /> {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Brief PART 16: Export Staff — separate, no class selection */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5 rounded-lg"
          onClick={handleExportStaff}
          disabled={exporting !== null}
        >
          {exporting === 'staff' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
          {exporting === 'staff' ? 'Generating...' : 'Export Staff'}
        </Button>
      </div>

      {/* Brief PART 43: Export success feedback */}
      <AnimatePresence mode="wait">
        {exported && (
          <motion.div
            key={exported.label}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">Report ready</span>
            <span className="text-emerald-600/70 dark:text-emerald-400/70">·</span>
            <span className="text-emerald-700/80 dark:text-emerald-300/80">{exported.label}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brief PART 32: History table — VIEW records (separate from export) */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Date</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Class</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Total</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Present</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Absent</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Late</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">Leave</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 w-24">Rate</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence mode="popLayout">
              {filtered.slice(0, 100).map((r, i) => (
                <motion.tr
                  key={`${r.date}-${r.classId}`}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: Math.min(i * 0.01, 0.2), duration: 0.25 }}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors text-xs cursor-pointer"
                  onClick={() => setViewRecord(r)}
                >
                  <TableCell className="py-2.5 font-mono tabular-nums">{formatDate(r.date)}</TableCell>
                  <TableCell className="py-2.5 font-medium text-foreground">{r.className}</TableCell>
                  <TableCell className="py-2.5 font-mono tabular-nums text-muted-foreground text-right">{r.total}</TableCell>
                  <TableCell className="py-2.5 font-mono tabular-nums text-emerald-600 dark:text-emerald-400 text-right">{r.present}</TableCell>
                  <TableCell className="py-2.5 font-mono tabular-nums text-rose-600 dark:text-rose-400 text-right">{r.absent}</TableCell>
                  <TableCell className="py-2.5 font-mono tabular-nums text-amber-600 dark:text-amber-400 text-right">{r.late}</TableCell>
                  <TableCell className="py-2.5 font-mono tabular-nums text-sky-600 dark:text-sky-400 text-right">{r.leave}</TableCell>
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
                        <motion.div
                          initial={reduce ? false : { width: 0 }}
                          animate={{ width: `${r.rate}%` }}
                          transition={{ duration: 0.5, delay: Math.min(i * 0.01, 0.2) + 0.1 }}
                          className="h-full rounded-full"
                          style={{
                            background: r.rate >= 95 ? ATTENDANCE_PALETTE.present
                              : r.rate >= 90 ? ATTENDANCE_PALETTE.late
                              : ATTENDANCE_PALETTE.absent,
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold tabular-nums w-9 text-right">{r.rate}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewRecord(r) }}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                      title="View details"
                      aria-label="View details"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </motion.tr>
              ))}
            </AnimatePresence>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                  No attendance records found for {selectedMonthLabel}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 100 && (
        <p className="text-[10px] text-muted-foreground text-center">
          Showing first 100 of {filtered.length} records · refine filters to narrow
        </p>
      )}

      {/* Brief PART 32: Detail dialog */}
      <HistoryDetailDialog
        record={viewRecord}
        onClose={() => setViewRecord(null)}
      />
    </PageTransition>
  )
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function StatusBadge({ status }: { status: AttendanceHistoryRecord['status'] }) {
  const v = STATUS_VARIANT[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${v.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
      {status}
    </span>
  )
}

function HistoryDetailDialog({
  record, onClose,
}: {
  record: AttendanceHistoryRecord | null
  onClose: () => void
}) {
  const displayRecord = useMemo(() => {
    if (!record) return null
    if (record.classId !== 'all') return record
    return getHistoryForDateClass(record.date, 'all')
  }, [record])

  if (!displayRecord) return null

  const [y, m, d] = displayRecord.date.split('-').map(Number)
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            Attendance Detail
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            {dateLabel} · {displayRecord.className}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Summary block */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] uppercase tracking-wider font-semibold text-primary">Attendance Rate</p>
                <p className="font-display text-2xl font-bold tabular-nums text-primary">{displayRecord.rate}%</p>
              </div>
              <StatusBadge status={displayRecord.status} />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <DetailStat label="Total Students" value={displayRecord.total} color="text-foreground" />
            <DetailStat label="Present" value={displayRecord.present} color="text-emerald-600 dark:text-emerald-400" />
            <DetailStat label="Late" value={displayRecord.late} color="text-amber-600 dark:text-amber-400" />
            <DetailStat label="Absent" value={displayRecord.absent} color="text-rose-600 dark:text-rose-400" />
            <DetailStat label="Leave" value={displayRecord.leave} color="text-sky-600 dark:text-sky-400" />
            <DetailStat label="Class Teacher" value={classSections.find((c) => c.id === displayRecord.classId)?.teacher ?? '—'} color="text-foreground" />
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
            <ArrowLeft className="h-3.5 w-3.5" /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      <p className={`font-display text-base font-bold tabular-nums truncate ${color}`}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  )
}
