'use client'

import { useState, useMemo, useEffect } from 'react'
import { ArrowLeft, LayoutGrid, List } from 'lucide-react'
import { PageTransition, GradientAvatar } from '@/components/shared/ui'
import { StudentCard as SharedStudentCard } from '@/components/shared/student-directory/student-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useStudentsStore } from '@/lib/store/students-store'
import type { ClassRecord, StudentRecord } from '@/lib/store/students-store'
import { useAcademicConfigStore, resolveDbClassFor } from '@/lib/academic-config/client'
import { formatINR } from '@/lib/format'
import { classStreamBadge } from './class-display'
import { studentRecordToCardData } from '../students/directory-tab'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { ClassOverview } from './details/class-overview'
import { ClassSubjects } from './details/class-subjects'
import { ClassTeachers } from './details/class-teachers'
import { ClassLeadership } from './details/class-leadership'

export function ClassDetailsPage({ cls, onBack, store, onStudentClick }: {
  cls: ClassRecord; onBack: () => void; store: any; onStudentClick?: (s: StudentRecord) => void
}) {
  const [detailTab, setDetailTab] = useState('overview')
  // Subscribe to the canonical class so the header badges (subject count,
  // occupancy, etc.) reflect mutations performed by the children tabs.
  // Brief section 22 (Real data persistence) + section 33 (Subject archive
  // must actually work) — the header is part of the same surface.
  const liveClass = useStudentsStore((s) => s.getClassById(cls.id)) ?? cls

  // ── Server link — when this class maps to the authoritative school
  // record, the header counts the SERVER's configured subjects (the
  // single source of truth), not the legacy mock list.
  const academicConfig = useAcademicConfigStore((s) => s.config)
  const fetchAcademic = useAcademicConfigStore((s) => s.fetch)
  useEffect(() => { void fetchAcademic() }, [fetchAcademic])
  const dbClass = resolveDbClassFor(liveClass, academicConfig?.classes ?? [])
  const subjectCount = dbClass ? dbClass.subjects.length : liveClass.subjects.length
  const students = useMemo(() => store.students.filter((s: any) => s.classId === liveClass.id), [store.students, liveClass.id])
  const cap = liveClass.capacity * liveClass.sections.length
  // REAL occupancy — ACTIVE roster students in this class over real capacity
  // (the old figure was a virtual seat-occupancy estimate).
  const enr = students.filter((s: any) => s.status === 'Active').length
  const pct = cap > 0 ? Math.round((enr / cap) * 100) : 0
  // Spec §4 / §6 — show stream badge so Class 11 PCM vs PCB details are distinguishable.
  const streamBadge = classStreamBadge(liveClass)

  return (
    <PageTransition>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold text-sm">{liveClass.name.replace('Class ', 'C').replace('Pre-', 'P').slice(0, 3)}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{liveClass.name}</h1>
              {streamBadge && (
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-primary/40 bg-primary/5 text-primary shrink-0">{streamBadge}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{liveClass.level} · {liveClass.sections.length} sections · Room {liveClass.room}</p>
          </div>
        </div>
        <SegmentedTabs tabs={[{ value: 'overview', label: 'Overview' }, { value: 'students', label: 'Students', badge: students.length }, { value: 'subjects', label: 'Subjects' }, { value: 'teachers', label: 'Teachers' }, { value: 'leadership', label: 'Leadership' }]} value={detailTab} onValueChange={setDetailTab} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px]">{liveClass.level}</Badge>
        {streamBadge && (
          <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] font-mono">{streamBadge}</Badge>
        )}
        <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px]">{liveClass.sections.length} sections</Badge>
        <Badge variant="secondary" className={cn('text-[10px]', pct >= 90 ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-700')}>{pct}% full</Badge>
        <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px]">{subjectCount} subjects</Badge>
      </div>

      <div className="space-y-4">
        {detailTab === 'overview' && <ClassOverview cls={liveClass} />}
        {detailTab === 'students' && <ClassStudentsTab students={students} cls={liveClass} onStudentClick={onStudentClick} />}
        {detailTab === 'subjects' && <ClassSubjects cls={liveClass} />}
        {detailTab === 'teachers' && <ClassTeachers cls={liveClass} />}
        {detailTab === 'leadership' && <ClassLeadership cls={liveClass} />}
      </div>
    </PageTransition>
  )
}

/* ClassStudentsTab — grid/list with section filter, fee amounts.
   GRID (Task W3-a): the ONE shared directory card (same three-band
   design as the teacher roster / principal directory). Inside a single
   class the class name is redundant, so the identity line reads
   "Roll 12 · Sec A". List view + section filter stay as they were. */
function ClassStudentsTab({ students, cls: _cls, onStudentClick }: { students: StudentRecord[]; cls: ClassRecord; onStudentClick?: (s: StudentRecord) => void }) {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sectionFilter, setSectionFilter] = useState('all')
  const sections = useMemo(() => Array.from(new Set(students.map((s) => s.section))).sort(), [students])
  const filtered = useMemo(() => sectionFilter === 'all' ? students : students.filter((s) => s.section === sectionFilter), [students, sectionFilter])
  const getFee = (s: StudentRecord) => { const due = s.feeTotal - s.feePaid; if (due <= 0) return { text: '₹0 due', color: 'text-emerald-600 dark:text-emerald-400' }; if (s.feeStatus === 'Pending') return { text: `${formatINR(due, true)} overdue`, color: 'text-rose-600 dark:text-rose-400' }; return { text: `${formatINR(due, true)} due`, color: 'text-amber-600 dark:text-amber-400' } }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {sections.length > 1 && (<select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"><option value="all">All Sections</option>{sections.map((sec) => <option key={sec} value={sec}>Section {sec}</option>)}</select>)}
          <span className="text-xs text-muted-foreground">{filtered.length} students</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 h-9">
          <button onClick={() => setView('grid')} className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-all', view === 'grid' ? 'bg-white dark:bg-white/10 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}><LayoutGrid className="h-3.5 w-3.5" /></button>
          <button onClick={() => setView('list')} className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-all', view === 'list' ? 'bg-white dark:bg-white/10 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}><List className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {filtered.length === 0 ? (<div className="py-8 text-center"><p className="text-sm text-muted-foreground">No students enrolled in this class.</p></div>) : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
          {filtered.map((s, i) => (
            <SharedStudentCard
              key={s.id}
              student={studentRecordToCardData(s, `Sec ${s.section}`)}
              index={i}
              onSelect={() => onStudentClick?.(s)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
          {filtered.map((s) => { const fee = getFee(s); return (
            <button key={s.id} onClick={() => onStudentClick?.(s)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left bg-card">
              <GradientAvatar name={s.name} initials={s.avatar} size="sm" />
              <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{s.name}</p><span className="text-[10px] font-mono text-muted-foreground">{s.admissionNo}</span></div><p className="text-xs text-muted-foreground">Roll {s.rollNo} · Sec {s.section}</p></div>
              <div className="hidden sm:flex items-center gap-3 shrink-0"><span className={cn('text-xs font-semibold', s.attendance >= 90 ? 'text-emerald-600' : s.attendance >= 75 ? 'text-amber-600' : 'text-rose-600')}>{s.attendance}%</span><span className={cn('text-xs font-semibold', fee.color)}>{fee.text}</span></div>
            </button>
          )})}
        </div>
      )}
    </div>
  )
}
