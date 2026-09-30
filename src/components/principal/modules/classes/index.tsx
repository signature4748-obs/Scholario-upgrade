'use client'

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Layers, Users, AlertTriangle, Plus, MapPin, ChevronRight, UserCheck, DoorOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { useStudentsStore } from '@/lib/store/students-store'
import type { ClassRecord } from '@/lib/store/students-store'
// PHASE 7 (Task 7-a) — class-teacher names resolve from the HYDRATED
// teachers-store (canonical DB teacher ids). No fabricated universe.
import { useTeachersStore } from '@/lib/store/teachers-store'
import { classStreamBadge } from './class-display'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { SearchFilterBar, type FilterConfig } from '../shared/search-filter-bar'
import { RoomsDialog } from './rooms-dialog'

export function ClassesView({ onOpenClass, onAddClass }: { onOpenClass: (c: ClassRecord) => void; onAddClass: () => void }) {
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [roomsOpen, setRoomsOpen] = useState(false)
  const store = useStudentsStore()
  const classes = store.classes.filter((c) => c.status === 'Active')
  const students = store.students

  const stats = useMemo(() => {
    const totalSections = classes.reduce((a, c) => a + c.sections.length, 0)
    const totalCapacity = classes.reduce((a, c) => a + c.capacity * c.sections.length, 0)
    // REAL enrolled count — ACTIVE students on the roster, not virtual seats.
    const totalEnrolled = students.filter((s) => s.status === 'Active').length
    const vacant = Math.max(0, totalCapacity - totalEnrolled)
    const withTeacher = classes.filter((c) => c.classTeacherId).length
    return { totalClasses: classes.length, totalSections, totalCapacity, totalEnrolled, vacant, withTeacher, unassigned: classes.length - withTeacher }
  }, [classes, students])

  const levels = useMemo(() => { const set = new Set<string>(); classes.forEach((c) => set.add(c.level)); return Array.from(set) }, [classes])

  const filterConfig: FilterConfig = { id: 'level', value: levelFilter, onChange: setLevelFilter, placeholder: 'All Levels', width: 'w-[160px]', options: [{ value: 'all', label: 'All Levels' }, ...levels.map((l) => ({ value: l, label: l }))] }

  const filtered = useMemo(() => classes.filter((c) => {
    const q = search.toLowerCase()
    const matchesSearch = !search.trim() || c.name.toLowerCase().includes(q) || c.sections.map((s) => s.name).join(' ').toLowerCase().includes(q) || c.room.toLowerCase().includes(q)
    return matchesSearch && (levelFilter === 'all' || c.level === levelFilter)
  }), [classes, search, levelFilter])

  return (
    <div className="space-y-4">
      <SummaryCardGrid columns={4}>
        <SummaryCard label="Total Classes" value={stats.totalClasses} sub={`${stats.totalSections} sections`} tone="amber" icon={<Layers className="h-4 w-4" />} delay={0} />
        <SummaryCard label="Total Students" value={stats.totalEnrolled} tone="emerald" icon={<Users className="h-4 w-4" />} delay={0.04} />
        <SummaryCard label="Vacant Seats" value={stats.vacant} tone="cyan" icon={<Users className="h-4 w-4" />} delay={0.08} />
        <SummaryCard label="With Teacher" value={stats.withTeacher} sub={`${stats.unassigned} unassigned`} tone={stats.unassigned > 0 ? 'rose' : 'emerald'} icon={<AlertTriangle className="h-4 w-4" />} delay={0.12} />
      </SummaryCardGrid>

      <SearchFilterBar search={search} onSearchChange={setSearch} placeholder="Search class, section, or room…" filters={[filterConfig]}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setRoomsOpen(true)} className="h-9 text-xs gap-1.5">
              <DoorOpen className="h-3.5 w-3.5" /> Rooms
            </Button>
            <Button size="sm" onClick={onAddClass} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 h-9"><Plus className="h-3.5 w-3.5" /> Add Class</Button>
          </>
        }
      />

      <RoomsDialog open={roomsOpen} onOpenChange={setRoomsOpen} />

      {/* Class grid — the student grids' rhythm (auto-fill, min 300px card)
          so the 3-column metric band never drops below the benchmark's
          label-fit width, at any viewport or sidebar state. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
        {filtered.map((cls, i) => <ClassCard key={cls.id} cls={cls} index={i} onClick={() => onOpenClass(cls)} />)}
      </div>
      {filtered.length === 0 && <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No classes found matching your search.</p></div>}
    </div>
  )
}

/* ============================================================
   ClassCard — the class entity card in the ONE shared three-band
   design language (benchmark: shared/student-directory/
   student-card.tsx): identity band → metric band → footer band,
   with class-specific content — class-code gradient avatar, name
   + stream badge, level · sections + room lines, READ-ONLY class
   -teacher line, section occupancy chips, CAPACITY/ENROLLED/
   AVAILABLE hairline metrics and an occupancy-progress footer.
   ============================================================ */
function ClassCard({ cls, index, onClick }: { cls: ClassRecord; index: number; onClick: () => void }) {
  const reduce = useReducedMotion()
  const students = useStudentsStore((s) => s.students)
  // Real class teacher — canonical DB id resolved against the hydrated
  // faculty store (the same universe the Teachers module shows).
  const teachers = useTeachersStore((s) => s.teachers)
  const cap = cls.capacity * cls.sections.length
  // REAL enrolled count — ACTIVE roster students in this class's sections.
  const enr = students.filter((s) => s.classId === cls.id && s.status === 'Active').length
  const vacant = Math.max(0, cap - enr)
  const pct = cap > 0 ? Math.round((enr / cap) * 100) : 0
  const tight = pct >= 90
  // Real class teacher — canonical id resolved against the hydrated
  // faculty store (the same universe the Teachers module shows). Dual-id
  // match (Phase 7): synced class data carries the teacher's USER id
  // (Class.classTeacherId convention) while the store keys Teacher rows.
  const teacher = cls.classTeacherId
    ? teachers.find((t) => t.id === cls.classTeacherId || t.serverUserId === cls.classTeacherId)
    : null
  const avatarText = cls.name.replace('Class ', 'C').replace('Pre-', 'P').slice(0, 3)
  // Spec §4 / §6 — show stream badge so Class 11 PCM vs PCB cards are distinguishable.
  const streamBadge = classStreamBadge(cls)

  return (
    <motion.button
      type="button"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.3 }}
      whileHover={reduce ? undefined : { y: -2 }}
      onClick={onClick}
      aria-label={`View ${cls.name}${streamBadge ? ` (${streamBadge})` : ''}`}
      className="group flex flex-col rounded-xl border border-border bg-card/60 p-4 text-left transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:p-5"
    >
      {/* ── identity band — class-code avatar, name + stream, level/room ── */}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-base font-semibold text-white">
          {avatarText}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
              {cls.name}
            </p>
            {streamBadge && (
              <StatusBadge
                status={streamBadge}
                variant="primary"
                className="shrink-0 px-2 py-0.5 text-[10px] leading-4"
              />
            )}
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {cls.level} · {cls.sections.length} section{cls.sections.length === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            Room {cls.room}
          </p>
        </div>
      </div>

      {/* Class teacher — small READ-ONLY derived summary. The appointment
          itself lives in exactly one place: this class → Teachers tab.
          No teacher appointed (or the id no longer resolves) → the honest
          "not assigned" line — never a fabricated name. */}
      <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
        <UserCheck className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        {teacher ? (
          <p className="truncate text-[11px] text-muted-foreground">
            Class Teacher: <span className="font-medium text-foreground">{teacher.name}</span>
          </p>
        ) : (
          <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">Not assigned</p>
        )}
      </div>

      {/* Section occupancy chips (over → rose, ≥90% → amber) + subjects */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {cls.sections.map((s) => {
          // REAL per-section enrollment from the roster.
          const count = students.filter((st) => st.classId === cls.id && st.section === s.name && st.status === 'Active').length
          const over = count > s.capacity
          const sFull = !over && count / s.capacity >= 0.9
          return (
            <span key={s.id} className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-4',
              over ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : sFull ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground')}>
              {s.name} {count}/{s.capacity}
            </span>
          )
        })}
        <span className="ml-0.5 text-[10px] text-muted-foreground">· {cls.subjects.length} subjects</span>
      </div>

      {/* ── metric band — capacity / enrolled / available ── */}
      <div className="mt-4 grid grid-cols-3 divide-x divide-border border-t border-border pt-3.5">
        <div className="min-w-0 [&:not(:first-child)]:pl-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Capacity</p>
          <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
            <span className="font-display text-lg font-bold leading-none tabular-nums text-foreground">{cap}</span>
          </div>
        </div>
        <div className="min-w-0 [&:not(:first-child)]:pl-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Enrolled</p>
          <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
            <span className="font-display text-lg font-bold leading-none tabular-nums text-foreground">{enr}</span>
          </div>
        </div>
        <div className="min-w-0 [&:not(:first-child)]:pl-3">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Available</p>
          <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
            <span className={cn('font-display text-lg font-bold leading-none tabular-nums', tight ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>{vacant}</span>
          </div>
        </div>
      </div>

      {/* ── footer band — occupancy progress + view affordance ── */}
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-1 max-w-[96px] flex-1 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full', tight ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
          View
          <ChevronRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </motion.button>
  )
}
