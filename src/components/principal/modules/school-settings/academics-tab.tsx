'use client'

/**
 * Academics tab (PHASE 7.5 rework).
 *
 * The current academic session is SERVER truth — `identity.academicYear`
 * from GET /api/school-settings (set by the platform/provisioning), shown
 * read-only with a note. Class/subject masters stay read-only displays
 * pointing at the Classes module (the real management lives there via
 * /api/principal/academic).
 */

import { BookOpen, Info, Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { SettingsTab, FieldGroup, SyncGate } from './shared'

export function AcademicsTab() {
  const academicYear = useSchoolSettingsStore((s) => s.server.identity?.academicYear ?? null)
  const board = useSchoolSettingsStore((s) => s.server.identity?.board ?? null)
  const academics = useSchoolSettingsStore((s) => s.academics)

  return (
    <SyncGate>
      <SettingsTab
        icon={BookOpen}
        title="Academic Master Setup"
        description="Session, board and the configured class/subject masters."
      >
        <FieldGroup label="Academic Session">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <Label htmlFor="acad-session" className="text-xs font-semibold mb-1 block">
                Current Academic Session
              </Label>
              <div className="relative">
                <Input
                  id="acad-session"
                  value={academicYear ?? academics.currentSession}
                  readOnly
                  aria-readonly="true"
                  className="font-mono bg-muted/50 pr-9"
                />
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
                Set by the platform / school provisioning — read-only here.
              </p>
            </div>
            <div>
              <Label htmlFor="acad-board" className="text-xs font-semibold mb-1 block">
                Educational Board
              </Label>
              <div className="relative">
                <Input
                  id="acad-board"
                  value={board ?? academics.board}
                  readOnly
                  aria-readonly="true"
                  className="bg-muted/50 pr-9"
                />
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Part of the school record — edit it in the Identity tab if it needs correcting.
              </p>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label={`Configured Classes (${academics.classes.length})`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            {academics.classes.map((cls) => (
              <div key={cls.id} className="p-3 rounded-xl border border-border bg-card shadow-2xs">
                <p className="font-bold text-foreground">{cls.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Sections: {cls.sections.join(' · ')}{cls.stream ? ` · ${cls.stream}` : ''}
                </p>
              </div>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup label={`Configured Subjects Master (${academics.subjects.length})`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            {academics.subjects.map((sub) => (
              <div key={sub.id} className="p-3 rounded-xl border border-border bg-card flex items-center justify-between gap-2 shadow-2xs">
                <div>
                  <p className="font-bold text-foreground">{sub.name}</p>
                  <p className="text-[10px] text-muted-foreground">{sub.code} · {sub.category}</p>
                </div>
                <Badge variant="outline" className="text-[9px]" style={{ borderColor: sub.color, color: sub.color }}>
                  {sub.category}
                </Badge>
              </div>
            ))}
          </div>
        </FieldGroup>

        <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span className="min-w-0 flex-1">
            The live class &amp; subject rosters (class teachers, subject assignments) are managed in
            the <strong>Classes</strong> module — this view reflects the configured masters.
          </span>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
