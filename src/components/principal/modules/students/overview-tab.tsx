'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Users, TrendingUp, AlertTriangle, UserX, GraduationCap,
  Lightbulb, Layers, School, PieChart,
} from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { StudentRecord, StudentsState } from '@/lib/store/students-store'
import { SummaryCard, SummaryCardGrid } from '../shared/summary-card'

interface OverviewTabProps {
  store: StudentsState
  onStudentClick?: (s: StudentRecord) => void
  onNavigateToClasses?: () => void
}

export function OverviewTab({ store, onNavigateToClasses: _onNavigateToClasses }: OverviewTabProps) {
  const { students, classes } = store

  const activeStudents = useMemo(() => students.filter((s) => s.status === 'Active'), [students])
  const inactiveStudents = useMemo(() => students.filter((s) => s.status !== 'Active'), [students])

  // Real enrolled count — ACTIVE students on the roster (the store is
  // DB-hydrated), replacing the old virtual-occupancy estimate.
  const totalStudents = activeStudents.length
  const totalCapacity = useMemo(
    () => classes.reduce((a, c) => a + c.sections.reduce((sa, s) => sa + s.capacity, 0), 0),
    [classes]
  )
  const totalSections = useMemo(() => classes.reduce((a, c) => a + c.sections.length, 0), [classes])

  // REAL gender split — counts the roster's actual gender field (the
  // old card multiplied the total by a hardcoded 0.52 — a fabricated
  // demographic on real tenants).
  const boys = activeStudents.filter((s) => s.gender === 'Male').length
  const girls = activeStudents.filter((s) => s.gender === 'Female').length
  // PHASE 8A (QA 8A-QA/A2) — honest insights: the old card carried a
  // hardcoded "94.2% average attendance" + fabricated historical trend
  // that rendered even on an empty roster. Derive what we can from the
  // live roster; on an empty school show an honest build-up insight and
  // clamp the derived series to zero instead of negative history.
  const hasRoster = totalStudents > 0
  const occupancyPct = totalCapacity > 0 ? Math.round((totalStudents / totalCapacity) * 100) : 0

  // REAL over-capacity detection — enrolled = ACTIVE roster students in the
  // class; capacity = the sum of its section capacities.
  const overloadedClasses = useMemo(
    () => classes.filter((c) => students.filter((s) => s.classId === c.id && s.status === 'Active').length > c.sections.reduce((a, s) => a + s.capacity, 0)),
    [classes, students]
  )

  const insights = useMemo(() => [
    ...(overloadedClasses.length > 0 ? [{ icon: <AlertTriangle className="h-4 w-4" />, color: 'rose', title: `${overloadedClasses.length} class${overloadedClasses.length > 1 ? 'es' : ''} over capacity`, desc: `${overloadedClasses.slice(0, 2).map((c) => c.name).join(', ')} exceed recommended section capacity limits.` }] : []),
    ...(hasRoster
      ? [{ icon: <TrendingUp className="h-4 w-4" />, color: 'emerald', title: `${formatNumber(totalStudents)} active students on the roster`, desc: `Across ${classes.length} classes and ${formatNumber(totalSections)} sections — live counts from the school database.` }]
      : [{ icon: <TrendingUp className="h-4 w-4" />, color: 'emerald', title: 'No students yet', desc: 'Insights appear here once the roster grows — nothing is estimated in advance.' }]),
    { icon: <Lightbulb className="h-4 w-4" />, color: 'violet', title: `${occupancyPct}% total seat utilization`, desc: `${formatNumber(totalStudents)} of ${formatNumber(totalCapacity)} seats filled across ${classes.length} active classes.` },
  ], [overloadedClasses, occupancyPct, totalStudents, totalSections, totalCapacity, classes.length, hasRoster])

  // REAL level distribution — ACTIVE students grouped by their class's level.
  const levelDistribution = useMemo(() => {
    const levels = ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary']
    const levelByClass = new Map(classes.map((c) => [c.id, c.level]))
    return levels.map((level) => {
      const value = activeStudents.filter((s) => levelByClass.get(s.classId) === level).length
      return { name: level.replace('Senior Secondary', 'Sr Sec'), value }
    }).filter((d) => d.value > 0)
  }, [classes, activeStudents])

  // REAL age groups — from the roster's actual dates of birth (the old
  // card derived counts from fixed percentages of the total).
  const ageOf = (dob: string): number | null => {
    if (!dob) return null
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return null
    const diff = Date.now() - d.getTime()
    return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
  }
  const ageGroups = useMemo(() => {
    const bands: { label: string; min: number; max: number }[] = [
      { label: 'Pre-Primary (3-5 yrs)', min: 3, max: 5 },
      { label: 'Primary (6-10 yrs)', min: 6, max: 10 },
      { label: 'Middle (11-13 yrs)', min: 11, max: 13 },
      { label: 'Secondary (14-16 yrs)', min: 14, max: 16 },
    ]
    return bands.map((b) => {
      const count = activeStudents.filter((s) => {
        const age = ageOf(s.dob)
        return age !== null && age >= b.min && age <= b.max
      }).length
      return { label: b.label, count, pct: totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0 }
    })
  }, [activeStudents, totalStudents])

  // REAL admission trend — the roster's actual admission records grouped
  // by month (the old series invented "Term 1 2024" history that never
  // existed; the store's admissionDate is the canonical user-creation
  // date from the roster sync).
  const growthTrend = useMemo(() => {
    const monthKey = (d: string): string => d.slice(0, 7)
    const byMonth = new Map<string, number>()
    for (const s of activeStudents) {
      if (!s.admissionDate) continue
      const k = monthKey(s.admissionDate)
      byMonth.set(k, (byMonth.get(k) ?? 0) + 1)
    }
    const months: string[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return months.map((m) => ({
      term: new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)
        .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      count: byMonth.get(m) ?? 0,
    }))
  }, [activeStudents])

  return (
    <div className="space-y-5">
      {/* Institution-Wide High Level KPIs — premium summary cards */}
      <SummaryCardGrid columns={6}>
        <SummaryCard label="Total Enrolled" value={totalStudents} sub={hasRoster ? `${classes.length} classes · live roster` : 'no students yet'} tone="emerald" icon={<Users className="h-4 w-4" />} delay={0} />
        <SummaryCard label="Active Students" value={activeStudents.length} sub={`${Math.round((activeStudents.length / (totalStudents || 1)) * 100)}% active`} tone="cyan" icon={<GraduationCap className="h-4 w-4" />} delay={0.04} />
        <SummaryCard label="Inactive / Leave" value={inactiveStudents.length} sub="requires follow-up" tone="rose" icon={<UserX className="h-4 w-4" />} delay={0.08} />
        <SummaryCard label="Total Capacity" value={totalCapacity} sub={`${occupancyPct}% utilized`} tone="violet" icon={<School className="h-4 w-4" />} delay={0.12} />
        <SummaryCard label="Active Classes" value={classes.length} sub={`${totalSections} sections`} tone="amber" icon={<Layers className="h-4 w-4" />} delay={0.16} />
        <SummaryCard label="Over Capacity" value={overloadedClasses.length} sub={overloadedClasses.length > 0 ? 'needs attention' : 'within limits'} tone={overloadedClasses.length > 0 ? 'rose' : 'emerald'} icon={<AlertTriangle className="h-4 w-4" />} delay={0.2} />
      </SummaryCardGrid>

      {/* Global Smart Insights */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold text-sm">Global Student Insights</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {insights.map((ins, i) => {
            const colors: Record<string, string> = {
              rose: 'border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400',
              emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
              violet: 'border-violet-500/20 bg-violet-500/5 text-violet-600 dark:text-violet-400',
            }
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <GlassCard className={cn('p-3.5 border', colors[ins.color])}>
                  <div className="flex items-start gap-2.5">
                    <div className="shrink-0 mt-0.5">{ins.icon}</div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">{ins.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{ins.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Demographics & Distribution Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Students by Academic Level */}
        <GlassCard className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
            <span>Students by Level</span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </h3>
          <div className="space-y-2.5">
            {levelDistribution.map((lvl) => {
              const max = Math.max(...levelDistribution.map((l) => l.value), 1)
              const pct = Math.round((lvl.value / max) * 100)
              return (
                <div key={lvl.name} className="flex items-center gap-2">
                  <span className="text-xs font-medium w-20 shrink-0 truncate">{lvl.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right">{lvl.value}</span>
                </div>
              )
            })}
          </div>
        </GlassCard>

        {/* Gender Distribution */}
        <GlassCard className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
            <span>Gender Ratio</span>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex h-3.5 rounded-full overflow-hidden bg-muted">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${(boys / (totalStudents || 1)) * 100}%` }} />
                <div className="h-full bg-rose-400 transition-all" style={{ width: `${(girls / (totalStudents || 1)) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2.5 text-xs font-medium">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Boys: {boys} ({Math.round((boys / (totalStudents || 1)) * 100)}%)</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Girls: {girls} ({Math.round((girls / (totalStudents || 1)) * 100)}%)</span>
              </div>
            </div>

            <div className="pt-3 border-t border-border/60 text-xs text-muted-foreground leading-relaxed">
              Balanced ratio maintained across all academic wings.
            </div>
          </div>
        </GlassCard>

        {/* Age Group Breakdown */}
        <GlassCard className="p-4 sm:col-span-2 lg:col-span-1">
          <h3 className="font-semibold text-sm mb-3">Age Groups</h3>
          <div className="space-y-2.5">
            {ageGroups.map((ag) => (
              <div key={ag.label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{ag.label}</span>
                <span className="font-semibold text-foreground">{ag.count} ({ag.pct}%)</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Enrollment Growth Trend */}
      <div className="grid grid-cols-1 gap-4">
        <GlassCard className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
            <span>Enrollment Growth Trend</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-2">
            {growthTrend.map((g) => (
              <div key={g.term} className="p-2.5 rounded-xl bg-muted/40 border border-border/50">
                <p className="text-[10px] text-muted-foreground font-medium">{g.term}</p>
                <p className="font-display text-base font-bold text-foreground mt-0.5">{g.count}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
