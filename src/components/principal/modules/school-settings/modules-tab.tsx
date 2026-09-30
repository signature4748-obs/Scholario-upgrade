'use client'

/**
 * Modules tab (PHASE 7.5) — read-only display of the school's EFFECTIVE
 * module availability (GET /api/school-settings → moduleFlags: server
 * flags ?? platform defaults). Feature availability is managed by the
 * platform control plane — this view exists so the school can see exactly
 * what its workspace has, with zero client-side gating fiction.
 */

import { Blocks, Info, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { SettingsTab, SyncGate } from './shared'

const MODULE_LABELS: Record<string, string> = {
  exams: 'Examinations',
  fees: 'Fee Management',
  homework: 'Homework',
  library: 'Library',
  transport: 'Transport',
  admissions: 'Admissions',
  communication: 'Communication',
  timetable: 'Timetable',
  attendance: 'Attendance',
  payroll: 'Payroll',
}

function moduleLabel(key: string): string {
  return MODULE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

export function ModulesTab() {
  const moduleFlags = useSchoolSettingsStore((s) => s.server.moduleFlags)
  const entries = Object.entries(moduleFlags).sort(([a], [b]) => a.localeCompare(b))

  return (
    <SyncGate>
      <SettingsTab
        icon={Blocks}
        title="Feature Modules"
        description="The feature modules available to this school's workspace."
      >
        <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span>
            Managed by the platform control plane — module availability follows the school&apos;s
            plan and platform settings. This view is read-only.
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Blocks className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
            <p className="text-xs font-semibold text-muted-foreground">No module flags received</p>
            <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
              The effective module list loads with the school configuration — retry from the sync
              banner if it stays empty.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Feature module availability for this school</caption>
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th scope="col" className="px-4 py-2.5 text-left text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                    Module
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                    Availability
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {entries.map(([key, enabled]) => (
                  <tr key={key} className="bg-card hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-foreground">{moduleLabel(key)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {enabled ? (
                        <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/10">
                          <Check className="h-2.5 w-2.5" aria-hidden /> Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <X className="h-2.5 w-2.5" aria-hidden /> Disabled
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsTab>
    </SyncGate>
  )
}
