'use client'

import { FileCheck, FilePlus2, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import { formatDate } from '@/lib/format'
import { gradientFor } from './shared'
import { SecureTeacherImg } from './secure-teacher-media'

interface Props {
  teachers: TeacherRecord[]
  onViewLetter: (t: TeacherRecord) => void
  onIssueNew: (id: string) => void
}

/**
 * Appointment Letters tab — the issued-letter register.
 *
 * "Issue New" creates a NEW immutable letter from the teacher's current
 * employment facts and archives the previously issued one unchanged
 * (issued documents are historical records — they are never rewritten).
 * "View" opens the current letter's snapshot.
 */
export function AppointmentLettersTab({ teachers, onViewLetter, onIssueNew }: Props) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
      {teachers.map((t) => {
        const archiveCount = t.letterArchive?.length ?? 0
        return (
          <div
            key={t.id}
            className="px-4 py-3 bg-card hover:bg-muted/30 transition-colors flex items-center justify-between gap-3 flex-wrap"
          >
            {/* Teacher identity — avatar + name + meta */}
            <div className="flex items-center gap-3 min-w-0">
              {t.photo ? (
                <SecureTeacherImg record={t.photo} alt={t.name} loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${gradientFor(t.id)} font-semibold text-white text-sm`}>
                  {t.avatar}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {t.designation} · {t.department}
                </p>
              </div>
            </div>

            {/* Letter ref + issue date — muted mono */}
            <div className="hidden sm:flex flex-col items-end">
              {t.appointmentLetter ? (
                <>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    Ref: {t.appointmentLetter.officialLetterNo}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Issued {formatDate(t.appointmentLetter.generatedDate)}
                    {archiveCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-700 dark:text-amber-400">
                        <Archive className="h-2.5 w-2.5" /> {archiveCount} archived
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <Badge variant="outline" className="text-[9px] text-muted-foreground">Not issued</Badge>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onIssueNew(t.id)}
                className="text-xs h-8 gap-1.5"
                title="Issue a new letter from current employment facts — the previous letter is archived unchanged"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Issue New
              </Button>
              <Button
                size="sm"
                onClick={() => onViewLetter(t)}
                disabled={!t.appointmentLetter}
                className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 disabled:opacity-50"
              >
                <FileCheck className="h-3.5 w-3.5" /> View
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
