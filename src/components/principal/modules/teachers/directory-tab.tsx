'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Search, Shield, Users, CalendarDays, UserCheck, Wallet } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StatusBadge } from '@/components/shared/ui'
import { departments } from '@/lib/mock/school'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'
import { gradientFor } from './shared'
import { SecureTeacherImg } from './secure-teacher-media'

interface Props {
  teachers: TeacherRecord[]
  filteredTeachers: TeacherRecord[]
  search: string
  setSearch: (v: string) => void
  dept: string
  setDept: (v: string) => void
  statusFilter: string
  setStatusFilter: (v: string) => void
  totalTeachers: number
  activeTeachersCount: number
  onLeaveCount: number
  avgAttendance: number
  totalSalary: number
  relievedCount?: number
  onOpenProfile: (t: TeacherRecord) => void
}

/**
 * Faculty Directory tab — premium summary cards + inline filter bar + teacher
 * entity cards in the ONE shared three-band design language (benchmark:
 * shared/student-directory/student-card.tsx): identity band → metric band →
 * footer band, with teacher-specific content.
 */
export function DirectoryTab({
  filteredTeachers, search, setSearch, dept, setDept, statusFilter, setStatusFilter,
  totalTeachers, activeTeachersCount, onLeaveCount, avgAttendance, totalSalary,
  relievedCount, onOpenProfile,
}: Props) {
  const reduce = useReducedMotion()
  return (
    <div className="space-y-4">
      {/* Premium summary cards — Admission-style */}
      <SummaryCardGrid columns={4}>
        <SummaryCard label="Total Teachers" value={totalTeachers} sub={`${activeTeachersCount} active`} tone="emerald" icon={<Users className="h-4 w-4" />} delay={0} />
        <SummaryCard label="On Leave Today" value={onLeaveCount} sub="Substitutes ready" tone="amber" icon={<CalendarDays className="h-4 w-4" />} delay={0.05} />
        <SummaryCard label="Avg Attendance" value={avgAttendance} suffix="%" sub="Last 30 days" tone="cyan" icon={<UserCheck className="h-4 w-4" />} delay={0.1} />
        <SummaryCard label="Monthly Payroll" value={formatINR(totalSalary, true)} sub="Bank transfer" tone="violet" icon={<Wallet className="h-4 w-4" />} delay={0.15} />
      </SummaryCardGrid>

      {/* Inline filter row */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, ID, designation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Active</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="On Leave">On Leave</SelectItem>
              <SelectItem value="Probation">Probation</SelectItem>
              <SelectItem value="archived">Archived / Relieved</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs py-1.5 px-3 h-9 flex items-center">
            {filteredTeachers.length}
          </Badge>
        </div>
      </div>

      {/* Teacher grid — shared three-band entity cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {filteredTeachers.map((t, i) => {
          const pendingPosCount = t.positions.filter((p) => p.status === 'Pending Acceptance').length
          const activePosition = t.positions.find((p) => p.status === 'Active') ?? null
          return (
            <motion.button
              key={t.id}
              type="button"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.24), duration: 0.3 }}
              whileHover={reduce ? undefined : { y: -2 }}
              onClick={() => onOpenProfile(t)}
              aria-label={`View ${t.name}'s profile`}
              className="group flex flex-col rounded-xl border border-border bg-card/60 p-4 text-left transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:p-5"
            >
              {/* ── identity band — photo/initials avatar + status dot, name,
                  designation, department badge, pending-positions badge ── */}
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  {t.photo ? (
                    <SecureTeacherImg
                      record={t.photo}
                      alt={t.name}
                      loading="lazy"
                      className="h-12 w-12 rounded-xl border border-border object-cover"
                    />
                  ) : (
                    <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-base font-semibold text-white', gradientFor(t.id))}>
                      {t.avatar}
                    </div>
                  )}
                  <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card',
                    t.status === 'Active' ? 'bg-emerald-500' : 'bg-amber-500')} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug transition-colors group-hover:text-primary">{t.name}</p>
                    {pendingPosCount > 0 && (
                      <StatusBadge
                        status={`${pendingPosCount} pending`}
                        variant="warning"
                        dot
                        className="shrink-0 gap-1 px-2 py-0.5 text-[10px] leading-4"
                      />
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{t.designation}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge variant="secondary" className="bg-muted px-1.5 py-0 text-[10px] leading-4 text-muted-foreground">
                      {t.department}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* ── subject chips (max 3) ── */}
              {t.subjects.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {t.subjects.slice(0, 3).map((s) => (
                    <span key={s} className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* ── metric band — Exp / Att. / Salary ── */}
              <div className="mt-4 grid grid-cols-3 divide-x divide-border border-t border-border pt-3.5">
                <div className="min-w-0 [&:not(:first-child)]:pl-3">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exp</p>
                  <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
                    <span className="font-display text-lg font-bold leading-none tabular-nums text-foreground">{t.totalExperience}y</span>
                  </div>
                </div>
                <div className="min-w-0 [&:not(:first-child)]:pl-3">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Att.</p>
                  <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
                    <span className={cn('font-display text-lg font-bold leading-none tabular-nums',
                      t.attendance >= 95 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {t.attendance}%
                    </span>
                  </div>
                </div>
                <div className="min-w-0 [&:not(:first-child)]:pl-3">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Salary</p>
                  <div className="mt-1 flex min-h-[26px] min-w-0 items-center">
                    <span className="truncate font-display text-lg font-bold leading-none tabular-nums text-foreground">{formatINR(t.salary, true)}</span>
                  </div>
                </div>
              </div>

              {/* ── footer band — employee id + active position / view affordance ── */}
              <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{t.employeeId}</span>
                {activePosition ? (
                  <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    <Shield className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{activePosition.positionTitle}</span>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
                    View profile
                    <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                )}
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

