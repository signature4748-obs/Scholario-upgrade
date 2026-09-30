'use client'

/**
 * StaffAttendanceTab — Staff attendance surface (7-b honest rewrite).
 *
 * The fabricated STAFF_DEFS universe (20 invented staff records with
 * deterministic per-date attendance generators) is RETIRED: there is NO
 * database model for staff attendance in Scholario-OS yet, so this tab
 * now renders an honest "not configured" state instead of a fabricated
 * marking workflow. The UI shell (the tab itself) stays so the section
 * remains discoverable; the moment a real StaffAttendance model + API
 * exists, the marking workflow can be rebuilt on it.
 *
 * Student/class attendance — which IS real (canonical Attendance rows
 * written by the Teacher/Principal marking flow) — lives in the Classes
 * tab of this module.
 */

import { CalendarCheck, CalendarOff, Users } from 'lucide-react'
import { PageTransition, GlassCard } from '@/components/shared/ui'

export function StaffAttendanceTab() {
  return (
    <PageTransition className="space-y-4">
      {/* Compact header — the shell of the original tab (no fabricated
          counts, no marking controls). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <Users className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Staff Attendance</h2>
            <p className="text-[11px] text-muted-foreground">Daily staff attendance record</p>
          </div>
        </div>
      </div>

      {/* ── HONEST empty state — no staff attendance tracking configured ── */}
      <GlassCard hover={false} className="on-card px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
          <CalendarOff className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-sm font-semibold">Staff attendance tracking is not configured</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Your school has not set up staff attendance tracking yet. Once it is configured, daily
          staff marking and history will appear here.
        </p>
        <div className="mx-auto mt-5 flex max-w-sm items-start gap-2.5 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-2.5 text-left">
          <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Student and class attendance <span className="font-medium text-foreground">is</span> tracked —
            open the Classes tab to review and mark daily class attendance.
          </p>
        </div>
      </GlassCard>
    </PageTransition>
  )
}
