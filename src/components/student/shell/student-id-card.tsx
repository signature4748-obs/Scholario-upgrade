'use client'

/**
 * StudentIdCard — the school's institutional identity card (§27–28).
 *
 * ARCHITECTURE (school-configured template, personalised per student):
 *   Principal/Admin configures the card design (theme accent, which
 *   particulars print, the office line) in School Settings → the config
 *   persists in the tenant-scoped school-settings store → EVERY student
 *   sees their own personalised card rendered FROM that template. The
 *   student can view/print it — they can never redesign the school's card.
 *
 * CARD DISCIPLINE (a physical artefact, not a dashboard popup):
 *   · identity first — school band, photo, name, class
 *   · only configured fields print (sensitive particulars are opt-in:
 *     DOB / blood group stay OFF until the school enables them)
 *   · institution-only information — no QR codes, no verification
 *     checksums, no tokens: the card carries exactly what a printed
 *     school ID carries (identity + enrolment + office contact)
 *   · status + session validity in one calm footer line
 *
 * PRINTING: the card prints alone at physical proportions (the dialog
 * toggles `printing-id-card` on <body>; see globals.css @media print).
 */

import { useEffect } from 'react'
import { Printer, X, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import type { StudentRecord } from '@/lib/store/students-store'
import { useAcademicSession, SESSION_NOT_SET_LABEL } from '@/lib/academic-session'
import type { EnrollmentIdentity } from '@/components/student/modules/shared/enrollment'

/* ── School-configured themes (the card's institutional accent) ───────── */

interface CardTheme {
  /** Header/footer band gradient. */
  band: string
  /** Soft tint for the reverse/footer zone. */
  soft: string
  /** Accent text (labels keyed to the theme). */
  text: string
  /** Photo ring. */
  ring: string
}

const CARD_THEMES: Record<string, CardTheme> = {
  violet: { band: 'from-violet-600 via-purple-600 to-fuchsia-600', soft: 'bg-violet-500/[0.05]', text: 'text-violet-700', ring: 'ring-violet-500/25' },
  sky: { band: 'from-sky-600 via-blue-600 to-indigo-600', soft: 'bg-sky-500/[0.05]', text: 'text-sky-700', ring: 'ring-sky-500/25' },
  emerald: { band: 'from-emerald-600 via-teal-600 to-cyan-600', soft: 'bg-emerald-500/[0.05]', text: 'text-emerald-700', ring: 'ring-emerald-500/25' },
  rose: { band: 'from-rose-600 via-pink-600 to-fuchsia-600', soft: 'bg-rose-500/[0.05]', text: 'text-rose-700', ring: 'ring-rose-500/25' },
  amber: { band: 'from-amber-500 via-orange-500 to-rose-500', soft: 'bg-amber-500/[0.05]', text: 'text-amber-700', ring: 'ring-amber-500/25' },
}

/* ── The card ───────────────────────────────────────────────────────────── */

export interface StudentIdCardProps {
  student: StudentRecord
  /** Root adds the print hook class (see globals.css @media print). */
  className?: string
  /** SD-3b — server-first enrollment overrides (session truth). When
   *  present, class/roll/admission/dob/blood render from the DB session
   *  instead of the seed record, keeping the card consistent with the
   *  sidebar and profile. */
  enrollment?: Pick<EnrollmentIdentity, 'classLabel' | 'rollNo' | 'admissionNo' | 'dob' | 'bloodGroup'>
}

export function StudentIdCard({ student, className, enrollment }: StudentIdCardProps) {
  const school = useSchoolSettingsStore((s) => s.general)
  const idCard = useSchoolSettingsStore((s) => s.idCard)
  // PHASE 7.5-D — server-first session resolution (settings server slice →
  // auth session → local settings; NO hardcoded year — a second tenant
  // never prints the wrong session on its ID cards).
  const session = useAcademicSession()

  const theme = CARD_THEMES[idCard?.theme] ?? CARD_THEMES.violet
  const sessionLabel = session.label ?? SESSION_NOT_SET_LABEL
  // Session "2026-2027" → card valid through 31 Mar of the END year.
  // Unknown session → the validity line is HIDDEN (a wrong date is never
  // printed; the "Enrolled student" line says "Session not set").
  const validTill = session.id ? `31 Mar ${session.id.slice(5)}` : null
  const isActive = student.status === 'Active'

  // Configured particulars — each prints ONLY when the school enabled it
  // (and only when the data genuinely exists on the record).
  // Identity-bearing values prefer the SERVER enrollment (SD-3b).
  const fields: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Class · Section', value: enrollment?.classLabel ?? `${student.className} · ${student.section}` },
    { label: 'Roll No', value: enrollment?.rollNo ?? student.rollNo, mono: true },
  ]
  if (idCard?.showAdmissionNo) fields.push({ label: 'Admission No', value: enrollment?.admissionNo ?? student.admissionNo, mono: true })
  if (idCard?.showHouse && student.houseName) fields.push({ label: 'House', value: student.houseName })
  if (idCard?.showDob) fields.push({ label: 'Date of Birth', value: enrollment?.dob ?? student.dob, mono: true })
  if (idCard?.showBloodGroup) fields.push({ label: 'Blood Group', value: enrollment?.bloodGroup ?? student.bloodGroup })
  fields.push({ label: 'Student ID', value: student.id, mono: true })

  return (
    <div
      className={cn(
        'id-card-print-root relative w-full max-w-[340px] overflow-hidden rounded-2xl border border-border bg-card text-left shadow-premium-lg [print-color-adjust:exact]',
        className
      )}
    >
      {/* ── Institutional band — school identity + lanyard slot ──────── */}
      <div className={cn('relative bg-gradient-to-br px-4 pb-4 pt-3.5 text-white', theme.band)}>
        {/* physical lanyard punch slot */}
        <div className="mx-auto mb-3 flex h-3 w-16 items-center justify-center rounded-full bg-white/30 ring-1 ring-white/40" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-white/50" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-sm font-extrabold backdrop-blur">
            {school.logoText}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-bold leading-snug line-clamp-2 break-words">{school.schoolName}</p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/80">
              Student Identity Card
            </p>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide',
              isActive ? 'bg-emerald-400/25 text-white ring-1 ring-emerald-100/40' : 'bg-white/15 text-white/80'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-emerald-300' : 'bg-white/60')} aria-hidden />
            {isActive ? 'Active' : student.status}
          </span>
        </div>
        {school.affiliation && (
          <p className="mt-2 line-clamp-1 text-[9px] font-medium text-white/70">{school.affiliation}</p>
        )}
      </div>

      {/* ── Identity — photo (initials fallback), name, enrollment ───── */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3.5">
          {/* portrait photo frame — passport ratio, initials fallback */}
          <div
            className={cn(
              'flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 text-xl font-extrabold text-slate-600 ring-4',
              theme.ring
            )}
            aria-label="Student photograph placeholder"
          >
            {student.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight text-foreground">{student.name}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {enrollment ? `${enrollment.classLabel} · Roll ${enrollment.rollNo}` : `${student.className}-${student.section} · Roll ${student.rollNo}`}
            </p>
            <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/80">
              <ShieldCheck className={cn('h-3 w-3', theme.text)} aria-hidden />
              Enrolled student · {sessionLabel}
            </p>
          </div>
        </div>

        {/* ── Particulars grid fills the space the QR block left —
                          institution information only, print-balanced ───── */}
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0 border-b border-dashed border-border/70 pb-1.5">
              <p className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{f.label}</p>
              <p className={cn('mt-0.5 truncate text-xs font-semibold text-foreground', f.mono && 'font-mono tabular-nums')}>
                {f.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Authorisation — signature line + session validity ─────────── */}
      <div className="mt-4 flex items-end justify-between gap-4 px-4">
        <div className="min-w-0">
          <div className="h-px w-24 border-b border-dashed border-muted-foreground/50" aria-hidden />
          <p className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Principal
          </p>
        </div>
        {idCard?.showValidUntil && validTill && (
          <p className="shrink-0 text-[10px] text-muted-foreground">
            Valid till <span className="font-bold tabular-nums text-foreground">{validTill}</span>
          </p>
        )}
      </div>

      {/* ── Footer — office line (school-configured) ──────────────────── */}
      <div className={cn('mt-3.5 border-t border-border/70 px-4 py-3', theme.soft)}>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {idCard?.verificationNote}
          {school.phone && (
            <>
              {' · '}
              <span className="font-semibold text-foreground/80">Office {school.phone}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/* ── The student-facing dialog (view + print) ──────────────────────────── */

interface StudentIdCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: StudentRecord
  /** SD-3b — passed through to the card (session truth overrides). */
  enrollment?: StudentIdCardProps['enrollment']
}

export function StudentIdCardDialog({ open, onOpenChange, student, enrollment }: StudentIdCardDialogProps) {
  // Print ONLY the card (physical proportions) — toggles a body class the
  // print stylesheet in globals.css resolves; cleanup after the dialog.
  const printCard = () => {
    const cleanup = () => document.body.classList.remove('printing-id-card')
    document.body.classList.add('printing-id-card')
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
    setTimeout(cleanup, 1200) // safety net for browsers without afterprint
  }

  // Leaving the dialog must never leave the print class behind.
  useEffect(() => {
    if (!open) document.body.classList.remove('printing-id-card')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] p-0 overflow-hidden bg-transparent border-0 shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">School ID Card</DialogTitle>
        <DialogDescription className="sr-only">
          Your {`school's`} configured student identity card — print it exactly as designed by your school.
        </DialogDescription>

        <StudentIdCard student={student} enrollment={enrollment} className="mx-auto" />

        <div className="mt-3 flex gap-2 print:hidden">
          <Button size="sm" className="flex-1 gap-2" onClick={printCard}>
            <Printer className="h-3.5 w-3.5" /> Print ID Card
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
