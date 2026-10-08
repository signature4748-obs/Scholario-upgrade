'use client'

/**
 * principal/students/directory-tab — the school-wide student directory.
 *
 * SHARED CARD (Task W3-a): the grid renders the ONE shared directory
 * card (`@components/shared/student-directory/student-card`) — the same
 * three-band design as the Teacher roster. The principal store's
 * `StudentRecord` maps onto the role-agnostic `StudentCardData`:
 *   · attendance   the store percentage (no record count on file ⇒ no
 *                  supporting line, `records: null`)
 *   · latestAvg    null — this store has no exam data, so the metric
 *                  band honestly shows Attendance + Fees
 *   · fees         always present (principal is fee-authorized);
 *                  'Pending' maps to OVERDUE per the fee display rules
 *   · status       attendance < 75% ⇒ "At Risk" (the shared threshold);
 *                  the old warning-badge row is replaced by the card's
 *                  single status badge — the fee signal is already the
 *                  fee chip
 *
 * The list view, SearchFilterBar (search + class filter + fee filter),
 * the "X of Y students" line and the slice caps stay as they were.
 */

import { useState, useMemo } from 'react'
import { Search, LayoutGrid, List, ChevronRight, UserPlus } from 'lucide-react'
import { GradientAvatar } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import {
  StudentCard as SharedStudentCard,
  AT_RISK_ATTENDANCE_PCT,
  type StudentCardData,
} from '@/components/shared/student-directory/student-card'
import { cn } from '@/lib/utils'
import type { StudentRecord, ClassRecord } from '@/lib/store/students-store'
import { formatINR } from '@/lib/format'
import { SearchFilterBar, type FilterConfig } from '../shared/search-filter-bar'

function getFeeDisplay(s: StudentRecord) {
  const due = s.feeTotal - s.feePaid
  if (due <= 0) return { text: '₹0 due', color: 'text-emerald-600 dark:text-emerald-400' }
  if (s.feeStatus === 'Pending') return { text: `${formatINR(due, true)} overdue`, color: 'text-rose-600 dark:text-rose-400' }
  return { text: `${formatINR(due, true)} due`, color: 'text-amber-600 dark:text-amber-400' }
}

/** Store fee status → the shared card's fee vocabulary. 'Pending' is a
 *  due beyond the cycle ⇒ OVERDUE (same rule as getFeeDisplay). */
const FEE_STATUS_MAP = { Paid: 'PAID', Partial: 'PARTIAL', Pending: 'OVERDUE' } as const

/**
 * StudentRecord → the shared directory card DTO. `classLabel` adapts per
 * surface (the directory shows "Class · Sec X"; a single class's tab
 * shows just the section). Exported — the class-details Students tab
 * reuses the exact same mapping.
 */
export function studentRecordToCardData(s: StudentRecord, classLabel = `${s.className} · Sec ${s.section}`): StudentCardData {
  return {
    id: s.id,
    name: s.name,
    initials: s.avatar,
    classLabel,
    rollNo: s.rollNo,
    admissionNo: s.admissionNo,
    attendance: { pct: s.attendance, records: null },
    latestAvg: null,
    fees: {
      status: FEE_STATUS_MAP[s.feeStatus],
      outstanding: Math.max(s.feeTotal - s.feePaid, 0),
      itemCount: 1,
    },
    guardianName: s.guardianName || s.fatherName || null,
    status: s.attendance < AT_RISK_ATTENDANCE_PCT ? { key: 'at-risk', label: 'At Risk' } : null,
  }
}

export function DirectoryTab({ students, classes, onStudentClick, onAddStudent }: {
  students: StudentRecord[]
  classes: ClassRecord[]
  onStudentClick: (s: StudentRecord) => void
  /** Opens the Principal's Add Student dialog (module-level state — the
   *  dialog itself POSTs /api/students and triggers the roster sync). */
  onAddStudent?: () => void
}) {
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [feeFilter, setFeeFilter] = useState('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const filtered = useMemo(() => students.filter((s) => {
    const q = search.toLowerCase()
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q) || s.rollNo.toLowerCase().includes(q) || s.guardianPhone.toLowerCase().includes(q) || s.fatherName.toLowerCase().includes(q) || s.houseName?.toLowerCase().includes(q) || s.className.toLowerCase().includes(q)
    return matchesSearch && (classFilter === 'all' || s.classId === classFilter) && (feeFilter === 'all' || s.feeStatus === feeFilter)
  }), [students, search, classFilter, feeFilter])

  const classFilterConfig: FilterConfig = { id: 'class', value: classFilter, onChange: setClassFilter, placeholder: 'All Classes', width: 'w-[160px]', options: [{ value: 'all', label: 'All Classes' }, ...classes.map((c) => ({ value: c.id, label: c.name }))] }
  const feeFilterConfig: FilterConfig = { id: 'fee', value: feeFilter, onChange: setFeeFilter, placeholder: 'All Fees', width: 'w-[120px]', options: [{ value: 'all', label: 'All Fees' }, { value: 'Paid', label: 'Paid' }, { value: 'Partial', label: 'Partial' }, { value: 'Pending', label: 'Pending' }] }

  const viewToggle = (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 h-9">
      <button onClick={() => setView('grid')} className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-all', view === 'grid' ? 'bg-white dark:bg-white/10 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}><LayoutGrid className="h-3.5 w-3.5" /></button>
      <button onClick={() => setView('list')} className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-all', view === 'list' ? 'bg-white dark:bg-white/10 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}><List className="h-3.5 w-3.5" /></button>
    </div>
  )

  return (
    <div className="space-y-3">
      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search name, admission no, roll, phone, parent…"
        filters={[classFilterConfig, feeFilterConfig]}
        actions={
          <>
            {/* Phase 7-A — the REAL server-side student enrollment entry
                point (POST /api/students). */}
            {onAddStudent && (
              <Button
                size="sm"
                onClick={onAddStudent}
                className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add Student
              </Button>
            )}
            {viewToggle}
          </>
        }
      />
      <p className="text-xs text-muted-foreground">{filtered.length} of {students.length} students</p>

      {filtered.length === 0 ? (
        <div className="py-12 text-center"><Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" /><p className="text-sm text-muted-foreground">No students found. Try adjusting your search.</p></div>
      ) : view === 'grid' ? (
        /* content-aware columns — as many whole 300px cards as fit (the
           same grid as the teacher roster), single full-width column on
           phones; the shared card carries its own motion + stagger */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
          {filtered.slice(0, 60).map((s, i) => (
            <SharedStudentCard
              key={s.id}
              student={studentRecordToCardData(s)}
              index={i}
              onSelect={() => onStudentClick(s)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
          {filtered.slice(0, 100).map((s) => {
            const fee = getFeeDisplay(s)
            return (
              <button key={s.id} onClick={() => onStudentClick(s)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left bg-card">
                <GradientAvatar name={s.name} initials={s.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{s.name}</p><span className="text-[10px] font-mono text-muted-foreground">{s.admissionNo}</span></div>
                  <p className="text-xs text-muted-foreground">{s.className} · Sec {s.section} · Roll {s.rollNo}</p>
                </div>
                <div className="hidden sm:flex items-center gap-3 shrink-0">
                  <span className={cn('text-xs font-semibold', s.attendance >= 90 ? 'text-emerald-600' : s.attendance >= 75 ? 'text-amber-600' : 'text-rose-600')}>{s.attendance}%</span>
                  <span className={cn('text-xs font-semibold', fee.color)}>{fee.text}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )
          })}
        </div>
      )}
      {filtered.length > 60 && view === 'grid' && <p className="text-xs text-muted-foreground text-center">Showing first 60 of {filtered.length} results.</p>}
    </div>
  )
}
