'use client'

/**
 * WelcomeBanner — principal greeting + date + compact meta strip.
 *
 * Calm flat card (rounded-xl border border-border bg-card), no decorative
 * orbs, no giant colored box. Includes:
 *   - Date + greeting (uses real auth user name)
 *   - Sub-meta line with the school name, today's attendance rate, birthdays
 *   - A compact meta strip on the right with Students / Teachers counts
 *     (relocated from the KPI row — these are passive status, not actionable
 *     KPIs, so they live here as a quiet summary instead of as 2 of 8 cards)
 */

import { useSchoolStats } from './use-school-stats'
import { useAuth } from '@/lib/store/auth-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { useAttendanceOverview } from '../attendance/use-attendance-overview'
import { Users, GraduationCap } from 'lucide-react'

export interface WelcomeBannerProps {
  onNavigate?: (module: string) => void
}

export function WelcomeBanner({ onNavigate }: WelcomeBannerProps) {
  const { user } = useAuth()
  // PHASE 7 — REAL school identity: the name comes from the
  // authenticated session (/api/auth/me → current-user-store), not the
  // retired mock/school constant ("Greenwood").
  const schoolName = useCurrentUser((s) => s.me?.school?.name) ?? user?.name ?? 'Your school'
  const schoolShort = schoolName.split(' ').slice(0, 2).join(' ')
  // attendance-overview-real — the sub-meta attendance rate reads the
  // canonical Attendance table (session-cached hook, same fetch as the
  // KPI row); "—" while in flight.
  const { data: attendance } = useAttendanceOverview()
  // REAL teacher figure — /api/dashboard (canonical db.teacher.count);
  // falls back to an honest "—" while in flight instead of the retired
  // mock school.totalTeachers constant (production data reduction).
  // PHASE 7.5-D — a failed fetch offers an honest tap-to-retry on the
  // teachers stat (hook `refresh`), and a remount after the 60s TTL
  // refetches in the background while the figure stays visible.
  const { stats: schoolStats, error: statsError, refresh: refreshStats } = useSchoolStats()
  const firstName = user?.name?.split(' ').slice(0, 2).join(' ') ?? 'Principal'
  // REAL student figures — derived from the canonical roster in the students
  // store (DB-hydrated): total = ACTIVE students; birthdays = ACTIVE students
  // whose dob ('YYYY-MM-DD') falls on today's month/day.
  const activeStudents = useStudentsStore((s) => s.students).filter(
    (s) => s.status === 'Active',
  )
  const now = new Date()
  const birthdaysToday = activeStudents.filter((s) => {
    const parts = s.dob.split('-').map(Number)
    return parts[1] === now.getMonth() + 1 && parts[2] === now.getDate()
  }).length
  const today = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{today}</p>
        {/* h2 (not a second h1): the shell header already owns the page's h1
            ("Dashboard"); this greeting is page content, so it starts the
            content heading order at h2 → panels use h3 (clean hierarchy). */}
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground mt-0.5">
          Good morning, {firstName}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {schoolShort} · Attendance {attendance ? attendance.today.rate : '—'}% · {birthdaysToday} birthdays today
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-sm">
        <button
          onClick={() => onNavigate?.('students')}
          className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/60 transition-colors text-left"
          title="Open Students & Classes"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Users className="h-3.5 w-3.5" />
          </span>
          <span className="leading-tight">
            <span className="block font-semibold text-foreground tabular-nums">{activeStudents.length.toLocaleString('en-IN')}</span>
            <span className="block text-[10px] text-muted-foreground uppercase tracking-wider">Students</span>
          </span>
        </button>
        <div className="h-8 w-px bg-border" />
        <button
          onClick={() => (statsError ? void refreshStats() : onNavigate?.('teachers'))}
          className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/60 transition-colors text-left"
          title={statsError ? 'Could not load teacher count — tap to retry' : 'Open Teachers'}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <GraduationCap className="h-3.5 w-3.5" />
          </span>
          <span className="leading-tight">
            <span className="block font-semibold text-foreground tabular-nums">{schoolStats ? schoolStats.teachers.toLocaleString('en-IN') : '—'}</span>
            <span className="block text-[10px] text-muted-foreground uppercase tracking-wider">Teachers</span>
          </span>
        </button>
      </div>
    </div>
  )
}
