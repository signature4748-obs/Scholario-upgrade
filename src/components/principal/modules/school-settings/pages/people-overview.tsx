'use client'

/**
 * People & Access → People (overview).
 *
 * HONEST IA: teachers, students and parents are NOT managed from Settings.
 * Each audience has its own dedicated module (Teachers, Students & Classes)
 * that owns directory, account creation and lifecycle. This page links
 * there and explains where each audience lives — no pretend management.
 */

import { Users, GraduationCap, School, Baby } from 'lucide-react'
import { SettingsTab } from '../shared'
import { ModuleLinkCard } from './module-link-card'

export function PeopleOverviewPage() {
  return (
    <SettingsTab
      icon={Users}
      title="People"
      description="Where every audience of the school is managed — Settings never edits people directly."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ModuleLinkCard
          icon={GraduationCap}
          title="Teachers"
          description="Faculty directory, positions & workload, account credentials, payroll and lifecycle — every teacher account is created here."
          moduleKey="teachers"
          ctaLabel="Open Teachers module"
        />
        <ModuleLinkCard
          icon={School}
          title="Students & Classes"
          description="Student directory, class rosters, admissions and guardian details — student (and parent) accounts are created here."
          moduleKey="students"
          ctaLabel="Open Students & Classes module"
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Baby className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">Parents & Guardians</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              There is no separate parents module: a parent or guardian is recorded on the
              student&apos;s profile in <strong>Students &amp; Classes</strong> (guardian name,
              phone and contact details). Update the student record there — the change is
              reflected everywhere immediately.
            </p>
          </div>
        </div>
      </div>
    </SettingsTab>
  )
}
