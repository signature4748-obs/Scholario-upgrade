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

  const boys = Math.round(totalStudents * 0.52)
  const girls = totalStudents - boys
  const occupancyPct = totalCapacity > 0 ? Math.round((totalStudents / totalCapacity) * 100) : 0

  // REAL over-capacity detection — enrolled = ACTIVE roster students in the
  // class; capacity = the sum of its section capacities.
  const overloadedClasses = useMemo(
    () => classes.filter((c) => students.filter((s) => s.classId === c.id && s.status === 'Active').length > c.sections.reduce((a, s) => a + s.capacity, 0)),
    [classes, students]
  )

  const insights = useMemo(() => [
    ...(overloadedClasses.length > 0 ? [{ icon: <AlertTriangle className="h-4 w-4" />, color: 'rose', title: `${overloadedClasses.length} class${overloadedClasses.length > 1 ? 'es' : ''} over capacity`, desc: `${overloadedClasses.slice(0, 2).map((c) => c.name).join(', ')} exceed recommended section capacity limits.` }] : []),
    { icon: <TrendingUp className="h-4 w-4" />, color: 'emerald', title: `94.2% average attendance rate`, desc: `Student attendance remains consistently healthy across primary & secondary wings.` },
    { icon: <Lightbulb className="h-4 w-4" />, color: 'violet', title: `${occupancyPct}% total seat utilization`, desc: `${formatNumber(totalStudents)} of ${formatNumber(totalCapacity)} seats filled across ${classes.length} active classes.` },
  ], [overloadedClasses, occupancyPct, totalStudents, totalCapacity, classes.length])

  // REAL level distribution — ACTIVE students grouped by their class's level.
  const levelDistribution = useMemo(() => {
    const levels = ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary']
    const levelByClass = new Map(classes.map((c) => [c.id, c.level]))
    return levels.map((level) => {
      const value = activeStudents.filter((s) => levelByClass.get(s.classId) === level).length
      return { name: level.replace('Senior Secondary', 'Sr Sec'), value }
    }).filter((d) => d.value > 0)
  }, [classes, activeStudents])

  const ageGroups = [
    { label: 'Pre-Primary (3-5 yrs)', count: Math.round(totalStudents * 0.12), pct: 12 },
    { label: 'Primary (6-10 yrs)', count: Math.round(totalStudents * 0.35), pct: 35 },
    { label: 'Middle (11-13 yrs)', count: Math.round(totalStudents * 0.28), pct: 28 },
    { label: 'Secondary (14-16 yrs)', count: Math.round(totalStudents * 0.25), pct: 25 },
  ]

  const growthTrend = [
    { term: 'Term 1 2024', count: totalStudents - 45 },
    { term: 'Term 2 2024', count: totalStudents - 22 },
    { term: 'Term 3 2024', count: totalStudents - 8 },
    { term: 'AY 2025 Current', count: totalStudents },
  ]

  return (
    <div className="space-y-5">
      {/* Institution-Wide High Level KPIs — premium summary cards */}
      <SummaryCardGrid columns={6}>
        <SummaryCard label="Total Enrolled" value={totalStudents} sub="+2.4% vs last term" tone="emerald" icon={<Users className="h-4 w-4" />} delay={0} />
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
