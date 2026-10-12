'use client'

import { Mail, MapPin, Phone, Users } from 'lucide-react'
import type { StudentRecord } from '@/lib/store/students-store'
import type { StudentProfileRealData } from './profile-real-data'
import { Section } from './shared'

type Props = { student: StudentRecord; real?: StudentProfileRealData }

const UNKNOWN = ['', '—', null, undefined]

function known(v: string | null | undefined): boolean {
  return !UNKNOWN.includes(v)
}

export function ParentsTab({ student, real }: Props) {
  // ── Teacher / server-authorized view: the guardian the server sent for
  // this teacher's class. Father/mother details are not part of the
  // teacher payload — they render only when actually known. ─────────────
  if (real) {
    return (
      <div className="space-y-4">
        <Section title="Guardian">
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-semibold text-sm">
                {known(student.guardianName)
                  ? student.guardianName.split(' ').map((n) => n[0]).slice(0, 2).join('')
                  : <Users className="h-4 w-4" aria-hidden="true" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{known(student.guardianName) ? student.guardianName : 'Not recorded'}</p>
                <p className="text-[11px] text-muted-foreground">Guardian</p>
              </div>
            </div>
            {known(real.guardianPhone) && (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {real.guardianPhone}</div>
              </div>
            )}
          </div>
        </Section>
        {known(student.address) && (
          <Section title="Address">
            <div className="rounded-lg border border-border bg-card/40 p-3 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm">{student.address}</p>
            </div>
          </Section>
        )}
      </div>
    )
  }

  // ── Principal store view (unchanged) ──────────────────────────────────
  return (
    <div className="space-y-4">
      <Section title="Father / Guardian">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-purple-500 text-white font-semibold text-sm">
              {student.fatherName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{student.fatherName}</p>
              <p className="text-[11px] text-muted-foreground">Father · Guardian</p>
            </div>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {student.guardianPhone}</div>
            <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {student.guardianEmail}</div>
          </div>
        </div>
      </Section>
      <Section title="Mother">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-pink-500 text-white font-semibold text-sm">
              {student.motherName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{student.motherName}</p>
              <p className="text-[11px] text-muted-foreground">Mother</p>
            </div>
          </div>
        </div>
      </Section>
      <Section title="Address">
        <div className="rounded-lg border border-border bg-card/40 p-3 flex items-start gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm">{student.address || '—'}</p>
            {(student.city || student.state) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {[student.city, student.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}
