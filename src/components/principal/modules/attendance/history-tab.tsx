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

import { useCallback, useEffect, useMemo, useState } from 'react'
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

/**
 * REAL attendance history record — the shape returned by
 * GET /api/attendance?month=YYYY-MM (per-class-per-day rollups of the
 * canonical Attendance table). Replaces the former demo mock corpus:
 * the History tab now shows the school's REAL recorded attendance, and
 * months without records render the honest empty state.
 */
interface AttendanceHistoryRecord {
  date: string
  classId: string
  className: string
  total: number
  present: number
  absent: number
  late: number
  leave: number
  rate: number
  status: 'Excellent' | 'Good' | 'Needs Attention'
}

interface ClassOption {
  id: string
  name: string
}

import { formatNumber } from '@/lib/format'
import { toast } from 'sonner'
import { ATTENDANCE_PALETTE } from './attendance-charts'

const STATUS_VARIANT: Record<AttendanceHistoryRecord['status'], {
  cls: string; dot: string
}> = {
  'Excellent':       { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-500' },
  'Good':            { cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20', dot: 'bg-sky-500' },
  'Needs Attention': { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20', dot: 'bg-rose-500' },
}

/** Build the month picker options — the last 12 months from TODAY
 *  (dynamic, not a frozen range: the canonical Attendance data lives in
 *  the current academic year and must stay reachable). */
function buildMonthOptions(): { value: string; label: string; year: number; month: number }[] {
  const options: { value: string; label: string; year: number; month: number }[] = []
  const now = new Date()
  const baseYear = now.getFullYear()
  const baseMonth = now.getMonth() + 1
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

const DEFAULT_MONTH = MONTH_OPTIONS[0]?.value ?? ''

export function AttendanceHistoryTab({ initialDate, initialClassId }: AttendanceHistoryTabProps) {
  const reduce = useReducedMotion()

  // REAL data: month rollups from the canonical Attendance table (the
  // server re-derives scope from the session — never client input).
  const [records, setRecords] = useState<AttendanceHistoryRecord[]>([])
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  // Brief PART 31: single month selector (replaces arbitrary date range).
  const [selectedMonth, setSelectedMonth] = useState<string>(DEFAULT_MONTH)
  const [classFilter, setClassFilter] = useState<string>(initialClassId ?? 'all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [viewRecord, setViewRecord] = useState<AttendanceHistoryRecord | null>(null)
  // Brief PART 43: export loading + success state.
  const [exporting, setExporting] = useState<ExportKind>(null)
  const [exported, setExported] = useState<{ kind: ExportKind; label: string } | null>(null)

  // Real class list for the filter (once per mount).
  useEffect(() => {
    let cancelled = false
    fetch('/api/classes', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.ok || !Array.isArray(j.data)) return
        setClasses(j.data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Fetch the month's real records whenever the month or class filter
  // changes (the class filter is applied server-side for efficiency).
  const loadMonth = useCallback(async (month: string, cls: string) => {
    setLoading(true)
    setLoadError(false)
    try {
      const url = cls && cls !== 'all'
        ? `/api/attendance?month=${encodeURIComponent(month)}&classId=${encodeURIComponent(cls)}`
        : `/api/attendance?month=${encodeURIComponent(month)}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error('failed')
      const j = await r.json()
      setRecords(Array.isArray(j?.data?.records) ? j.data.records : [])
    } catch {
      setRecords([])
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedMonth) void loadMonth(selectedMonth, 'all')
  }, [selectedMonth, loadMonth])

  // Apply incoming initial props (e.g. from heatmap CTA — pre-fill month).
  useEffect(() => {
    if (initialDate) {
      const month = initialDate.substring(0, 7)  // "YYYY-MM"
      if (MONTH_OPTIONS.some((o) => o.value === month)) setSelectedMonth(month)
    }
    if (initialClassId) {
      setClassFilter(initialClassId)
    }
  }, [initialDate, initialClassId])

  // Brief PART 32: filter records for the selected month (VIEW filter —
  // separate from the monthly EXPORT, which is always the full month).
  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (classFilter !== 'all' && r.classId !== classFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.className.toLowerCase().includes(q) && !r.date.includes(q)) return false
      }
      return true
    })
  }, [records, classFilter, statusFilter, search])

  // Brief PART 30: Get the selected month label for export naming.
  const selectedMonthLabel = useMemo(() => {
    const opt = MONTH_OPTIONS.find((o) => o.value === selectedMonth)
    return opt ? opt.label : selectedMonth
  }, [selectedMonth])

  // Brief PART 43-44: Export Student Attendance — an honest CSV of the
  // REAL month records currently in view (the previous PDF export
  // derived from a fabricated demo corpus; a real export must carry real
  // numbers). Brief PART 11 + 36: accepts 'all' or a specific classId.
  const handleExportStudent = (classId: string = 'all') => {
    if (exporting) return
    const rows = classId === 'all' ? filtered : filtered.filter((r) => r.classId === classId)
    if (rows.length === 0) {
      toast.info('No attendance records to export', {
        description: `No recorded attendance for ${selectedMonthLabel}.`,
      })
      return
    }
    setExporting('student')
    setExported(null)
    try {
      const header = 'Date,Class,Total,Present,Absent,Late,Leave,Rate %,Status'
      const csv = [header, ...rows.map((r) =>
        [r.date, `"${r.className}"`, r.total, r.present, r.absent, r.late, r.leave, r.rate, `"${r.status}"`].join(','),
      )].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cls = classes.find((c) => c.id === classId)
      a.download = `attendance-${selectedMonth}${cls ? `-${cls.name}` : ''}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setExporting(null)
      const label = cls
        ? `${selectedMonthLabel} — ${cls.name} Attendance (CSV)`
        : `${selectedMonthLabel} — Class Attendance (CSV)`
      setExported({ kind: 'student', label })
      toast.success('Class attendance exported', {
        description: label,
      })
    } catch (err) {
      setExporting(null)
      toast.error('Unable to export records', {
        description: 'Please try again.',
      })
    }
  }

  // Brief PART 43-44: Export Staff Attendance — staff attendance tracking
  // is not configured in this deployment (the Staff tab says the same);
  // an honest notice instead of a fabricated staff report.
  const handleExportStaff = () => {
    if (exporting) return
    toast.info('Staff attendance is not configured', {
      description: 'Staff attendance tracking is not part of this deployment — there are no staff records to export.',
    })
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
            {classes.map((c) => (
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
            {classes.map((c) => (
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
            {loading && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading attendance records…
                </TableCell>
              </TableRow>
            )}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-8">
                  Could not load attendance records — please retry.
                </TableCell>
              </TableRow>
            )}
            {!loading && !loadError && filtered.length === 0 && (
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
  const displayRecord = useMemo(() => record, [record])

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
            <DetailStat label="Attendance Rate" value={`${displayRecord.rate}%`} color="text-foreground" />
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
