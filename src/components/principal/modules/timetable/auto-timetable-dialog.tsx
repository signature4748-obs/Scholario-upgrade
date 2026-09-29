'use client'

/**
 * AutoTimetableDialog — compact auto-schedule generator.
 *
 * Brief section 4-6: School Day Start/End time config using the same
 *   12-hour AM/PM CompactTimePicker.
 *
 * Brief section 5 + 27: Auto-generate period timings from school start/end
 *   + break structure.
 *
 * Brief section 13-19: Realistic generation — distributes subjects
 *   naturally, prevents same-teacher conflicts, avoids repetitive patterns.
 *
 * Brief section 33: Generates a DRAFT — never auto-publishes.
 */
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DAYS } from './data'
import { countAllConflicts } from './timetable-store'
import {
  recomputeRowTimes,
  defaultDurationForRow,
  parseTimeToMinutes,
} from './time-engine'
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { teachers as mockTeachersForNames } from '@/lib/mock/teachers'
import { useState } from 'react'
import { toast } from 'sonner'
import type { TimetableSlot } from './data'
import { CompactTimeControls } from './compact-time-picker'
import type { TimetableRow } from './schedule-grid'

interface AutoTimetableDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onGenerate: (generatedSlots: TimetableSlot[], generatedRows: TimetableRow[]) => void
  existingSlots: TimetableSlot[]
  /** Live class options (server-hydrated + academic configuration) — the
   *  generator NEVER falls back to a hardcoded class list (REAL RECORDS
   *  ONLY); empty means there is nothing to generate yet. */
  classes?: string[]
  /** SINGLE SOURCE OF TRUTH — className → subjects the Principal configured
   *  for the class (ACTIVE ClassSubjectAssignment). The generator only ever
   *  schedules configured subjects; classes with no configuration fall back
   *  to the subjects already on their published slots (real data). */
  subjectsByClass?: Map<string, string[]>
  /** className → class homeroom (rooms never collide across classes). */
  homeroomByClass?: Map<string, string>
}

/** Subject → teacher mapping (Brief section 14) */
const SUBJECT_TEACHERS: Record<string, string[]> = {
  'Mathematics': ['T-014'],
  'English': ['T-002'],
  'Science': ['T-011'],
  'EVS': ['T-011'],
  'Hindi': ['T-005'],
  'Computer Science': ['T-041'],
  'Social Studies': ['T-023'],
  'Physical Education': ['T-047'],
  'Physics': ['T-038'],
  'Chemistry': ['T-026'],
  'Biology': ['T-026'],
  'Art & Craft': ['T-053'],
  'Music': ['T-050'],
}

/** Server Teacher.subjects stores short codes — canonical subject names. */
const SUBJECT_CODE_TO_NAME: Record<string, string> = {
  MATH: 'Mathematics', MATHEMATICS: 'Mathematics',
  ENG: 'English', ENGLISH: 'English',
  SCI: 'Science', SCIENCE: 'Science',
  PHY: 'Physics', PHYSICS: 'Physics',
  CHEM: 'Chemistry', CHEMISTRY: 'Chemistry',
  BIO: 'Biology', BIOLOGY: 'Biology',
  CS: 'Computer Science', CSC: 'Computer Science', 'COMPUTER SCIENCE': 'Computer Science',
  HIN: 'Hindi', HINDI: 'Hindi',
  SOC: 'Social Studies', SST: 'Social Studies', 'SOCIAL STUDIES': 'Social Studies',
  PE: 'Physical Education', 'PHYSICAL EDUCATION': 'Physical Education',
  EVS: 'EVS',
}

export function AutoTimetableDialog({ open, onOpenChange, onGenerate, existingSlots, classes = [], subjectsByClass, homeroomByClass }: AutoTimetableDialogProps) {
  const [scope, setScope] = useState<string>('all')
  const [schoolStart, setSchoolStart] = useState('08:30 AM')
  const [schoolEnd, setSchoolEnd] = useState('02:45 PM')
  const [numPeriods, setNumPeriods] = useState(7)
  const [numPeriodsInput, setNumPeriodsInput] = useState('7')
  const [breakMode, setBreakMode] = useState<'none' | 'short' | 'lunch' | 'both'>('both')
  const [generating, setGenerating] = useState(false)

  // Real faculty roster (server-backed; mock fallback until it resolves).
  const roster = useTeacherRosterStore((s) => s.teachers)
  const activeTeachers = roster // every roster entry is assignable by construction
  const classList = classes // REAL RECORDS ONLY — no hardcoded fallback
  const targetClasses = scope === 'all' ? classList : [scope]

  const handleGenerate = () => {
    setGenerating(true)

    // ── Subject → assignable teachers (ROSTER-driven, not mock-id-driven) ──
    // 1. The classic mapping's mock ids resolve to NAMES; anyone on the
    //    roster with that name teaches the subject.
    // 2. Server teachers carry subject codes ("MATH", "PHY", "ENG") —
    //    canonicalised and merged in.
    const mockNameById = new Map(mockTeachersForNames.map((t) => [t.id, t.name]))
    const subjectToTeachers = new Map<string, typeof roster>()
    for (const [subject, ids] of Object.entries(SUBJECT_TEACHERS)) {
      const names = ids.map((id) => mockNameById.get(id)).filter((n): n is string => !!n)
      const matched = roster.filter((t) => names.includes(t.name))
      if (matched.length > 0) subjectToTeachers.set(subject, matched)
    }
    for (const t of roster) {
      for (const raw of t.subjects) {
        const canonical = SUBJECT_CODE_TO_NAME[raw.toUpperCase()] ?? raw
        const arr = subjectToTeachers.get(canonical) ?? []
        if (!arr.some((x) => x.id === t.id)) arr.push(t)
        subjectToTeachers.set(canonical, arr)
      }
    }

    // Brief section 5 + 27: Calculate period duration from school start/end.
    // Brief 1.5 + 1.6: respect break durations from the canonical time engine.
    const startMin = parseTimeToMinutes(schoolStart)
    const endMin = parseTimeToMinutes(schoolEnd)
    const totalMin = endMin - startMin

    const includeShort = breakMode === 'short' || breakMode === 'both'
    const includeLunch = breakMode === 'lunch' || breakMode === 'both'
    const breakDuration = defaultDurationForRow(true, 'short')
    const lunchDuration = defaultDurationForRow(true, 'lunch')
    const breakTimeTotal = (includeShort ? breakDuration : 0) + (includeLunch ? lunchDuration : 0)
    const instructionalTime = totalMin - breakTimeTotal
    const periodDuration = Math.max(30, Math.floor(instructionalTime / numPeriods))

    // Build row structure (TimetableRow[]) with durationMin — times will be
    // DERIVED via recomputeRowTimes so the timeline is canonical (Brief 15).
    const generatedRows: TimetableRow[] = []
    const shortBreakAfter = Math.max(1, Math.floor(numPeriods / 3))
    const lunchBreakAfter = Math.max(1, Math.floor(numPeriods * 2 / 3))
    let periodCounter = 0
    for (let i = 0; i < numPeriods; i++) {
      periodCounter++
      generatedRows.push({
        number: periodCounter,
        name: `Period ${periodCounter}`,
        time: '', // derived below
        isBreak: false,
        durationMin: periodDuration,
      })
      if (i === shortBreakAfter - 1 && includeShort) {
        generatedRows.push({
          number: 100,
          name: 'Short Break',
          time: '',
          isBreak: true,
          breakType: 'short',
          durationMin: breakDuration,
        })
      }
      if (i === lunchBreakAfter - 1 && includeLunch) {
        generatedRows.push({
          number: 101,
          name: 'Lunch Break',
          time: '',
          isBreak: true,
          breakType: 'lunch',
          durationMin: lunchDuration,
        })
      }
    }
    // Brief 15: derive .time strings via the canonical engine — single source of truth.
    const computedRows = recomputeRowTimes(generatedRows, schoolStart)

    // Build a quick lookup: period number → time string (for slots)
    const timeByPeriod = new Map<number, string>()
    for (const row of computedRows) {
      if (!row.isBreak) timeByPeriod.set(row.number, row.time)
    }

    // Brief section 13-19: Realistic generation
    const generated: TimetableSlot[] = []
    let assignedCount = 0
    const skippedClasses: string[] = []

    // Track teacher load: teacherId → Set of "day-period" keys
    const teacherOccupancy = new Map<string, Set<string>>()
    const getTeacherKey = (teacherId: string, day: string, period: number) => `${teacherId}-${day}-${period}`

    // Track class-subject distribution to avoid repetition (Brief section 17)
    const _classSubjectCount = new Map<string, Map<string, number>>()

    for (const className of targetClasses) {
      // SINGLE SOURCE OF TRUTH — only subjects the Principal configured for
      // this class are schedulable. Fallback (offline / unconfigured): the
      // subjects already on this class's published slots — never a mock list.
      const configured = subjectsByClass?.get(className)
      const fromSlots = [...new Set(existingSlots.filter((s) => s.className === className).map((s) => s.subject))]
      const allClassSubjects = configured && configured.length > 0 ? configured : fromSlots
      if (allClassSubjects.length === 0) {
        skippedClasses.push(className)
        continue
      }
      const homeroom = homeroomByClass?.get(className) || existingSlots.find((s) => s.className === className)?.room || ''

      for (const day of DAYS) {
        for (const row of computedRows) {
          if (row.isBreak) continue

          const period = row.number

          // Subjects for this class come from the pre-computed allClassSubjects
          // (Principal configuration — see above). No mock slice, no extras.

          // Brief section 17: Avoid same subject in consecutive periods
          const lastSubject = generated.length > 0 ? generated[generated.length - 1]?.subject : null

          // Try subjects in a rotated order based on class + day + period (Brief section 18)
          const rotationOffset = (day.length + className.length + period) % allClassSubjects.length
          const shuffledSubjects = [...allClassSubjects.slice(rotationOffset), ...allClassSubjects.slice(0, rotationOffset)]

          let assigned = false
          for (const subject of shuffledSubjects) {
            // Skip if same as last subject (Brief section 17)
            if (subject === lastSubject) continue

            // Get available teachers for this subject — the real roster's
            // subject map (server teachers carry subject codes like "MATH"),
            // name-matched against the classic subject→teacher mapping when
            // those people are on the roster. Subjects with no dedicated
            // teacher fall back to the general pool (a small school shares
            // faculty) rather than leaving the period empty.
            const subjectTeachers = subjectToTeachers.get(subject) ?? []
            const pool = subjectTeachers.length > 0 ? subjectTeachers : activeTeachers
            const availableTeachers = pool.filter((t) => {
              // Brief section 15: NEVER assign same teacher to two classes at same day+period
              const _key = getTeacherKey(t.id, day, period)
              if (!teacherOccupancy.has(t.id)) teacherOccupancy.set(t.id, new Set())
              return !teacherOccupancy.get(t.id)!.has(`${day}-${period}`)
            })

            if (availableTeachers.length === 0) continue

            // Pick teacher (round-robin among available)
            const teacher = availableTeachers[0]

            // Mark teacher as occupied
            const occKey = `${day}-${period}`
            if (!teacherOccupancy.has(teacher.id)) teacherOccupancy.set(teacher.id, new Set())
            teacherOccupancy.get(teacher.id)!.add(occKey)

            // Room: the class's HOMEROOM (server configuration) — rooms can
            // never collide across classes; falls back to the class's first
            // existing slot room.
            const existingClassSlot = generated.find((s) => s.className === className) || existingSlots.find((s) => s.className === className)
            const room = homeroom || existingClassSlot?.room || '—'

            // Brief 15: time comes from the canonical row time, NOT a separate calc.
            const timeStr = timeByPeriod.get(period) || row.time

            generated.push({
              id: `auto-${Date.now()}-${className}-${day}-${period}`,
              day,
              period,
              time: timeStr,
              className,
              subject,
              teacherId: teacher.id,
              teacherName: teacher.name,
              room,
              type: 'Lecture',
            })
            assignedCount++
            assigned = true
            break
          }

          if (!assigned) {
            // No subject/teacher available — leave empty (NOT a conflict)
          }
        }
      }
    }

    // Validate with the same conflict engine (Brief section 22 + 37)
    const actualConflicts = countAllConflicts(generated)

    setTimeout(() => {
      setGenerating(false)
      onGenerate(generated, computedRows)
      if (skippedClasses.length > 0) {
        toast.warning('Timetable generated', {
          description:
            `${assignedCount} periods assigned · ${skippedClasses.length} class${skippedClasses.length === 1 ? '' : 'es'} skipped (no subjects configured)`,
        })
      } else {
        toast.success('Timetable generated', {
          description: `${assignedCount} periods assigned · ${actualConflicts} conflict${actualConflicts === 1 ? '' : 's'}`,
        })
      }
      onOpenChange(false)
    }, 800)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-emerald-600" />
            Auto timetable
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            Build a schedule from your school's availability.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Classes selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Classes</label>
            {classList.length === 0 ? (
              <p className="h-8 px-2.5 flex items-center rounded-lg border border-dashed border-border bg-muted/20 text-[10px] text-muted-foreground">
                No classes configured — set up classes first
              </p>
            ) : (
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {classList.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            )}
          </div>

          {/* School Day Start/End (Brief section 4 + 26) */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">School day</label>
            <div className="flex items-center gap-2">
              <CompactTimeControls value={schoolStart} onChange={setSchoolStart} />
              <span className="text-[10px] text-muted-foreground">→</span>
              <CompactTimeControls value={schoolEnd} onChange={setSchoolEnd} />
            </div>
          </div>

          {/* Days (read-only) */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Days</label>
            <div className="h-8 px-2.5 flex items-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
              Mon–Sat
            </div>
          </div>

          {/* Number of Periods (strict 1-9, single digit) */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Number of periods</label>
            <input
              type="number"
              min={1}
              max={9}
              maxLength={1}
              value={numPeriodsInput}
              onChange={(e) => {
                const raw = e.target.value
                // Only accept single digit 1-9
                if (raw === '') { setNumPeriodsInput(''); return }
                const v = parseInt(raw, 10)
                if (!isNaN(v) && v >= 1 && v <= 9) {
                  setNumPeriodsInput(String(v))
                  setNumPeriods(v)
                }
              }}
              onBlur={() => {
                const v = parseInt(numPeriodsInput, 10)
                if (isNaN(v) || v < 1) { setNumPeriods(1); setNumPeriodsInput('1') }
                else if (v > 9) { setNumPeriods(9); setNumPeriodsInput('9') }
                else setNumPeriods(v)
              }}
              onPaste={(e) => {
                e.preventDefault()
                const pasted = e.clipboardData.getData('text')
                const v = parseInt(pasted, 10)
                if (!isNaN(v) && v >= 1 && v <= 9) {
                  setNumPeriodsInput(String(v))
                  setNumPeriods(v)
                }
              }}
              className="h-8 w-full px-2.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Breaks (configurable) */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Breaks</label>
            <Select value={breakMode} onValueChange={(v) => setBreakMode(v as 'none' | 'short' | 'lunch' | 'both')}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Short + Lunch</SelectItem>
                <SelectItem value="short">Short Break only</SelectItem>
                <SelectItem value="lunch">Lunch Break only</SelectItem>
                <SelectItem value="none">No breaks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="Classes" value={targetClasses.length} />
            <Stat label="Periods" value={numPeriods} />
            <Stat label="Subjects" value={new Set([...(subjectsByClass?.values() ?? [])].flat()).size} />
            <Stat label="Teachers" value={activeTeachers.length} />
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleGenerate}
            disabled={generating || classList.length === 0}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            {generating ? 'Generating…' : 'Generate timetable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
      <p className="text-[8px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-foreground tabular-nums">{value}</p>
    </div>
  )
}
