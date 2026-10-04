'use client'

/**
 * People & Access → Invitations.
 *
 * HONEST EMPTY STATE: SCHOLARIO has no email invitations. Accounts are
 * created directly by the principal (or management) from the Teachers and
 * Students modules — the creation flow issues credentials at that moment.
 * This page says exactly that instead of faking an invite queue.
 */

import { MailPlus, GraduationCap, School, KeyRound } from 'lucide-react'
import { SettingsTab, SettingsInfoRow } from '../shared'
import { ModuleLinkCard } from './module-link-card'

export function InvitationsPage() {
  return (
    <SettingsTab
      icon={MailPlus}
      title="Invitations"
      description="How new people get their SCHOLARIO accounts."
    >
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 sm:py-10 text-center space-y-2">
        <MailPlus className="h-8 w-8 text-muted-foreground/60 mx-auto" aria-hidden />
        <p className="text-sm font-semibold text-foreground">There is no invitation queue</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
          Account creation is performed by the principal from the Teachers and Students modules —
          no email invitations are sent. When you add a teacher or a student, their sign-in
          account is created in the same step and the credentials are handed over by you.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ModuleLinkCard
          icon={GraduationCap}
          title="Add a teacher"
          description="Teachers → Directory → Add Teacher: the wizard creates the faculty record and its sign-in account together, and issues the initial password."
          moduleKey="teachers"
          ctaLabel="Open Teachers module"
        />
        <ModuleLinkCard
          icon={School}
          title="Add a student"
          description="Students & Classes → Admissions intake: the student record and the student sign-in account are created together."
          moduleKey="students"
          ctaLabel="Open Students & Classes module"
        />
      </div>

      <div className="divide-y divide-border/60 rounded-xl border border-border bg-background/50 px-4">
        <SettingsInfoRow label="Password resets" value="Administrator-mediated — via the module profile" />
        <SettingsInfoRow label="Email-based self sign-up" value="Not offered (by design)" />
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <KeyRound className="h-3 w-3 mt-px shrink-0" aria-hidden />
        <span>
          Keeping account creation inside the authenticated principal workspace (instead of
          open email invites) is a deliberate isolation decision: every account is attributable
          to the principal who created it.
        </span>
      </p>
    </SettingsTab>
  )
}
