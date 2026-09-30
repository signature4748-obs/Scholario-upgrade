'use client'

/**
 * ExamWorkspaceExtendedSections — P1 & P2 sections for the Exam Workspace dialog.
 * Splits: Seating, Exam Attendance, Grace/Moderation, Outcomes, CSV Import.
 * These are loaded inside ExamWorkspaceDialog alongside the existing tabs.
 */

import { useState, useMemo, useEffect } from 'react'
import { Plus, Trash2, MapPin, RefreshCw, Sparkles, Send, AlertTriangle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { InlineLoading } from './inline-loading'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type MarkStatus } from '@/lib/exams/types'
import {
  useSeatingPlan,
  useGenerateSeating,
  useImportMarksCsv,
  downloadCsvTemplate,
  type CsvImportRow,
} from '@/lib/exams/use-exams-extended'
import { useApplyGraceMock } from '@/lib/exams/use-marks-mock'
import { useMockMarksStore } from '@/lib/exams/mock-marks-data'
import { useMockOutcomesStore, type Outcome } from '@/lib/exams/mock-outcomes-data'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { useStudentsStore } from '@/lib/store/students-store'
import { useRoleGate } from '@/lib/exams/use-role-gate'
import { generateSeatingPlanPDF, generateBatchAdmitCardPDF } from '@/lib/exams/pdf'
import { fetchAdmitCardsBatch } from '@/lib/exams/use-exams-extended'
import { useSchoolContext } from '@/lib/exams/use-pdf-context'
import { useAdmitCardConfig } from '@/lib/exams/use-exam-settings'
import type { SchoolContextDTO, AdmitCardConfigDTO } from '@/lib/exams/types'

interface SectionProps {
  examId: string
  exam: any
  onReload: () => void
}

function defaultSchool(exam: any): SchoolContextDTO {
  return {
    schoolId: exam?.schoolId ?? '',
    schoolName: 'School',
    schoolCode: '',
    address: null,
    city: null,
    phone: null,
    email: null,
    logoUrl: null,
    academicYear: exam?.session ?? null,
    board: 'CBSE',
  }
}

// ─── Seating Section ─────────────────────────────────────────────────

export function SeatingSection({ examId, exam, onReload }: SectionProps) {
  const [classId, setClassId] = useState(exam?.classes[0]?.classId ?? '')
  const { seats, loading, reload } = useSeatingPlan(examId, classId)
  const { generate, loading: generating } = useGenerateSeating()
  const gate = useRoleGate()
  const [rooms, setRooms] = useState<Array<{ name: string; capacity: number }>>([{ name: 'Room A', capacity: 30 }])
  const { data: schoolCtx } = useSchoolContext()
  const { config: admitCfg } = useAdmitCardConfig()
  const DEFAULT_ADMIT: AdmitCardConfigDTO = { showPhoto: true, showRollNumber: true, showRoom: true, showSeatNumber: true, showTimetable: true, showInstructions: true, showQrCode: false }

  const handleGenerate = async () => {
    if (!classId) { toast.error('Select a class'); return }
    if (rooms.length === 0 || rooms.some((r) => !r.name || r.capacity <= 0)) {
      toast.error('Add at least one valid room')
      return
    }
    try {
      const r = await generate(examId, classId, rooms)
      toast.success(`Seating plan generated: ${r.generated} students assigned`)
      reload()
      onReload()
    } catch (e: any) {
      toast.error('Failed to generate seating', { description: e.message })
    }
  }

  const handleExport = () => {
    if (seats.length === 0) { toast.error('No seating plan to export'); return }
    const _className = exam?.classes.find((c: any) => c.classId === classId)?.className ?? 'Class'
    const school = schoolCtx ?? defaultSchool(exam)
    try {
      const { filename } = generateSeatingPlanPDF(exam, seats, school)
      toast.success('Seating plan exported', { description: filename })
    } catch (e: any) {
      toast.error('Export failed', { description: e.message })
    }
  }

  const handleBatchAdmitCards = async () => {
    if (!classId) { toast.error('Select a class'); return }
    if (!exam) { toast.error('Exam not loaded'); return }
    try {
      const data = await fetchAdmitCardsBatch(examId, classId)
      if (data.students.length === 0) { toast.error('No students in this class'); return }
      const className = exam.classes.find((c: any) => c.classId === classId)?.className ?? 'Class'
      const school = schoolCtx ?? defaultSchool(exam)
      const cfg = admitCfg ?? DEFAULT_ADMIT
      // Use the live exam object (full ExamDTO) instead of the partial returned by fetchAdmitCardsBatch
      const { filename } = generateBatchAdmitCardPDF(exam, className, data.students, school, cfg)
      toast.success(`${data.students.length} admit cards exported`, { description: filename })
    } catch (e: any) {
      toast.error('Export failed', { description: e.message })
    }
  }

  const addRoom = () => setRooms((r) => [...r, { name: `Room ${String.fromCharCode(65 + r.length)}`, capacity: 30 }])
  const removeRoom = (i: number) => setRooms((r) => r.filter((_, idx) => idx !== i))
  const updateRoom = (i: number, field: 'name' | 'capacity', value: string | number) => {
    setRooms((r) => r.map((room, idx) => idx === i ? { ...room, [field]: value } : room))
  }

  return (
    <div className="space-y-3">
      {gate.canGenerateSeating && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <p className="text-[10px] uppercase font-semibold text-muted-foreground">Generate Seating Plan</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger size="sm" className="text-xs"><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {exam?.classes.map((c: any) => <SelectItem key={c.classId} value={c.classId}>{c.className}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 mb-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Rooms</Label>
              <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={addRoom}><Plus className="h-3 w-3" /> Add Room</Button>
            </div>
            {rooms.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={r.name} onChange={(e) => updateRoom(i, 'name', e.target.value)} placeholder="Room name" className="h-7 text-xs flex-1" />
                <Input type="number" value={r.capacity} onChange={(e) => updateRoom(i, 'capacity', Number(e.target.value))} className="h-7 text-xs w-20" />
                <button onClick={() => removeRoom(i)} className="text-muted-foreground hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={handleGenerate} disabled={generating}>
              <Sparkles className="h-3 w-3" /> {generating ? 'Generating…' : 'Generate Seating'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport} disabled={seats.length === 0}>
              Export Seating PDF
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBatchAdmitCards}>
              Generate All Admit Cards (PDF)
            </Button>
          </div>
        </div>
      )}

      {loading ? <InlineLoading label="Loading seating plan…" /> : seats.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No seating assignments yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <p className="text-xs font-semibold">Seating Assignments ({seats.length})</p>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={reload}><RefreshCw className="h-3 w-3" /></Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Room</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Seat #</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Row</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Roll No</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Student</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seats.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs font-medium">{s.room}</TableCell>
                  <TableCell className="text-xs tabular-nums">{s.seatNumber}</TableCell>
                  <TableCell className="text-xs tabular-nums">{s.row ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{s.studentRollNo ?? '—'}</TableCell>
                  <TableCell className="text-xs">{s.studentName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ─── Grace / Moderation Section ──────────────────────────────────────

export function GraceSection({ examId, exam }: SectionProps) {
  const [classId, setClassId] = useState(exam?.classes[0]?.classId ?? '')
  const [subjectId, setSubjectId] = useState('')
  // Read marks from the mock store (canonical source) + students from students store.
  const storeMarks = useMockMarksStore((s) => s.marks)
  const allStudents = useStudentsStore((s) => s.students)
  const marks = useMemo(
    () => storeMarks.filter((m) => m.examId === examId && m.classId === classId && m.subjectId === subjectId),
    [storeMarks, examId, classId, subjectId],
  )
  const students = useMemo(
    () => allStudents.filter((s) => s.classId === classId && s.status === 'Active'),
    [allStudents, classId],
  )
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null)
  const [graceMarks, setGraceMarks] = useState(0)
  const [reason, setReason] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const { apply, loading } = useApplyGraceMock()
  const gate = useRoleGate()

  const subjectsForClass = exam?.subjects.filter((s: any) => !classId || s.classId === classId) ?? []
  const markRows = students.map((s) => {
    const m = marks.find((mk) => mk.studentId === s.id)
    return { student: s, mark: m }
  }).filter((r) => r.mark)

  // Filter mark rows by student search.
  const filteredMarkRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase()
    if (!q) return markRows
    return markRows.filter((r) =>
      r.student.name.toLowerCase().includes(q) ||
      (r.student.rollNo ?? '').toLowerCase().includes(q),
    )
  }, [markRows, studentSearch])

  const handleApply = async () => {
    if (!selectedMarkId) { toast.error('Select a student'); return }
    if (graceMarks === 0) { toast.error('Grace marks cannot be 0'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }
    try {
      await apply(examId, selectedMarkId, graceMarks, reason.trim())
      toast.success(`+${graceMarks} grace marks applied`, { description: 'Original marks preserved in audit log.' })
      setSelectedMarkId(null)
      setGraceMarks(0)
      setReason('')
    } catch (e: any) {
      toast.error('Failed to apply grace', { description: e.message })
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Grace / Moderation</p>
          <p className="text-[10px] text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
            Original marks are preserved in the audit log. All grace applications require a reason and are
            recorded with the authorizing user. After results are declared, only the Principal can apply grace.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <Select value={classId} onValueChange={(v) => { setClassId(v); setSubjectId('') }}>
            <SelectTrigger size="sm" className="text-xs"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              {exam?.classes.map((c: any) => <SelectItem key={c.classId} value={c.classId}>{c.className}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger size="sm" className="text-xs"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              {subjectsForClass.map((s: any) => <SelectItem key={s.subjectId} value={s.subjectId}>{s.subjectName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!subjectId ? (
          <div className="py-10 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 mb-2">
              <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">Select a class and subject to view marks</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Grace marks can be applied to individual student records</p>
          </div>
        ) : markRows.length === 0 ? (
          <div className="py-10 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 mb-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">No marks entered for this subject yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Marks must be entered before grace can be applied</p>
          </div>
        ) : (
          <>
            {/* Student search */}
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search student by name or roll no…"
                  className="h-7 text-[11px] pl-6 pr-2 rounded-md bg-transparent border border-border/40 focus:border-primary/40 focus:outline-none w-full"
                />
              </div>
              <span className="text-[9px] text-muted-foreground ml-auto">{filteredMarkRows.length} of {markRows.length} students</span>
            </div>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Select</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Roll No</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Student</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Marks</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Grace</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMarkRows.map(({ student, mark }) => (
                <TableRow key={student.id} className={cn('hover:bg-muted/30', selectedMarkId === mark?.id && 'bg-amber-500/5')}>
                  <TableCell>
                    {gate.canApplyGrace && (
                      <input type="radio" checked={selectedMarkId === mark?.id} onChange={() => { setSelectedMarkId(mark?.id ?? null); setGraceMarks(0); setReason('') }} className="cursor-pointer" />
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{student.rollNo ?? '—'}</TableCell>
                  <TableCell className="text-xs font-medium">{student.name}</TableCell>
                  <TableCell className="text-xs tabular-nums">{mark?.status === 'PRESENT' ? (mark?.marksObtained ?? '—') : mark?.status}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {(mark?.graceMarks ?? 0) !== 0 ? (
                      <span className="text-amber-600 font-medium">+{mark?.graceMarks}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredMarkRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                    No students match "{studentSearch}"
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </>
        )}

        {selectedMarkId && gate.canApplyGrace && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-300">Apply Grace Marks</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Grace Marks (±)</Label>
                <Input type="number" value={graceMarks} onChange={(e) => setGraceMarks(Number(e.target.value))} className="h-7 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Reason (required)</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Question paper error Q3" className="h-7 text-xs" />
              </div>
            </div>
            <Button size="sm" className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" onClick={handleApply} disabled={loading}>
              <Send className="h-3 w-3" /> {loading ? 'Applying…' : 'Apply Grace'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Outcomes Section (Promotion/Compartment/Retest) ─────────────────

export function OutcomesSection({ examId, exam }: SectionProps) {
  const [classId, setClassId] = useState(exam?.classes[0]?.classId ?? '')
  const outcomesStore = useMockOutcomesStore()
  const outcomes = useMemo(
    () => outcomesStore.outcomes.filter((o) => o.examId === examId && (classId === '' || o.classId === classId)),
    [outcomesStore.outcomes, examId, classId],
  )
  const gate = useRoleGate()

  // Auto-init outcomes for completed/ongoing exams.
  // FINAL-GATE (EG-9F/R6) — outcome seeding derives from the demo-tier
  // marks corpus; only the demo tenant auto-inits. A real tenant computes
  // outcomes explicitly from its own (real) entered marks.
  const isDemo = useIsDemoTenant()
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (!isDemo || !exam || initialized) return
    outcomesStore.initOutcomes(exam)
    setInitialized(true)
  }, [isDemo, exam, initialized, outcomesStore])

  const handleCompute = () => {
    if (!classId) return
    const count = outcomesStore.computeForClass(examId, classId)
    toast.success(`Outcomes computed for ${count} students`, {
      description: 'PROMOTED if passed, COMPARTMENT if 1 fail, RETEST if 2 fails, NOT_PROMOTED otherwise.',
    })
  }

  const handleOverride = (studentId: string, outcome: Outcome) => {
    const ok = outcomesStore.overrideOutcome(examId, studentId, outcome, 'Manual override by Principal')
    if (ok) toast.success(`Outcome overridden to ${outcome}`)
    else toast.error('Failed to override outcome')
  }

  const summary = {
    total: outcomes.length,
    promoted: outcomes.filter((o) => o.outcome === 'PROMOTED').length,
    compartment: outcomes.filter((o) => o.outcome === 'COMPARTMENT').length,
    retest: outcomes.filter((o) => o.outcome === 'RETEST').length,
    notPromoted: outcomes.filter((o) => o.outcome === 'NOT_PROMOTED').length,
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger size="sm" className="text-xs w-[180px]"><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Classes</SelectItem>
            {exam?.classes.map((c: any) => <SelectItem key={c.classId} value={c.classId}>{c.className}</SelectItem>)}
          </SelectContent>
        </Select>
        {gate.canOverrideOutcome && (
          <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={handleCompute} disabled={!classId}>
            <Sparkles className="h-3 w-3" /> Re-compute Outcomes
          </Button>
        )}
        {outcomes.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[10px]">
            <OutcomeBadge outcome="PROMOTED" count={summary.promoted} />
            <OutcomeBadge outcome="COMPARTMENT" count={summary.compartment} />
            <OutcomeBadge outcome="RETEST" count={summary.retest} />
            <OutcomeBadge outcome="NOT_PROMOTED" count={summary.notPromoted} />
          </div>
        )}
      </div>

      {outcomes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No outcomes computed yet. Select a class and click "Re-compute Outcomes" to derive from marks.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Roll No</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Student</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Class</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground text-center">%</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground text-center">Grade</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground text-center">Failed</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Outcome</TableHead>
                <TableHead className="text-[9px] uppercase font-semibold text-muted-foreground">Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outcomes.map((o) => (
                <TableRow key={o.id} className="even:bg-muted/10">
                  <TableCell className="text-xs font-mono">{o.studentRollNo ?? '—'}</TableCell>
                  <TableCell className="text-xs font-medium">{o.studentName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{o.className}</TableCell>
                  <TableCell className="text-xs tabular-nums text-center">{o.percentage}%</TableCell>
                  <TableCell className="text-xs font-bold text-center">{o.grade}</TableCell>
                  <TableCell className="text-xs text-center tabular-nums">{o.subjectsFailed}/{o.subjectsCount}</TableCell>
                  <TableCell><OutcomePill outcome={o.outcome} /></TableCell>
                  <TableCell>
                    {gate.canOverrideOutcome ? (
                      <Select value={o.outcome} onValueChange={(v) => handleOverride(o.studentId, v as Outcome)}>
                        <SelectTrigger size="sm" className="h-6 text-[10px] w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PROMOTED">Promoted</SelectItem>
                          <SelectItem value="COMPARTMENT">Compartment</SelectItem>
                          <SelectItem value="RETEST">Retest</SelectItem>
                          <SelectItem value="NOT_PROMOTED">Not Promoted</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function OutcomeBadge({ outcome, count }: { outcome: string; count: number }) {
  const cls = outcomeStyle(outcome)
  return <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', cls)}>{outcome} · {count}</span>
}

function OutcomePill({ outcome }: { outcome: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', outcomeStyle(outcome))}>{outcome.replace('_', ' ')}</span>
}

function outcomeStyle(outcome: string): string {
  switch (outcome) {
    case 'PROMOTED': return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
    case 'COMPARTMENT': return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
    case 'RETEST': return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20'
    case 'NOT_PROMOTED': return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

// ─── CSV Import Section ───────────────────────────────────────────────

export function CsvImportSection({ examId, exam }: SectionProps) {
  const [classId, setClassId] = useState(exam?.classes[0]?.classId ?? '')
  const [subjectId, setSubjectId] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [preview, setPreview] = useState<CsvImportRow[] | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const { importCsv, loading } = useImportMarksCsv()
  const gate = useRoleGate()

  const subjectsForClass = exam?.subjects.filter((s: any) => !classId || s.classId === classId) ?? []

  const handleParse = () => {
    const lines = pasteText.trim().split('\n')
    const rows: CsvImportRow[] = []
    const errs: string[] = []
    // Skip header if present
    const startIdx = lines[0]?.toLowerCase().includes('roll') ? 1 : 0
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      if (cols.length < 2) { errs.push(`Row ${i + 1}: not enough columns`); continue }
      const [rollNo, name, marks, status, remarks] = cols
      const statusU = (status || 'PRESENT').toUpperCase() as MarkStatus
      if (!['PRESENT', 'ABSENT', 'MEDICAL', 'EXEMPTED'].includes(statusU)) {
        errs.push(`Row ${i + 1}: invalid status "${status}"`)
        continue
      }
      const marksNum = marks === '' ? null : Number(marks)
      if (statusU === 'PRESENT' && marksNum !== null && (isNaN(marksNum) || marksNum < 0)) {
        errs.push(`Row ${i + 1}: invalid marks "${marks}"`)
        continue
      }
      rows.push({ rollNo, studentName: name, marksObtained: marksNum, status: statusU, remarks })
    }
    setPreview(rows)
    setErrors(errs)
  }

  const handleDownloadTemplate = async () => {
    if (!classId || !subjectId) { toast.error('Select class and subject first'); return }
    try {
      await downloadCsvTemplate(examId, classId, subjectId)
      toast.success('Template downloaded')
    } catch (e: any) {
      toast.error('Failed to download template', { description: e.message })
    }
  }

  const handleImport = async () => {
    if (!preview || preview.length === 0) { toast.error('Nothing to import'); return }
    try {
      const result = await importCsv(examId, classId, subjectId, preview)
      toast.success(`Imported ${result.accepted} marks`, {
        description: result.rejected > 0 ? `${result.rejected} rejected: ${result.errors[0]?.message ?? 'see audit log'}` : 'All rows imported successfully',
      })
      setPasteText('')
      setPreview(null)
      setErrors([])
    } catch (e: any) {
      toast.error('Import failed', { description: e.message })
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <Select value={classId} onValueChange={(v) => { setClassId(v); setSubjectId('') }}>
            <SelectTrigger size="sm" className="text-xs"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              {exam?.classes.map((c: any) => <SelectItem key={c.classId} value={c.classId}>{c.className}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger size="sm" className="text-xs"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              {subjectsForClass.map((s: any) => <SelectItem key={s.subjectId} value={s.subjectId}>{s.subjectName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs mb-2" onClick={handleDownloadTemplate} disabled={!classId || !subjectId}>
          Download CSV Template
        </Button>
        <Textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={'Roll Number,Student Name,Marks Obtained,Status,Remarks\n01,Aarav Sharma,35,PRESENT,\n02,Diya Patel,40,PRESENT,\n03,Vivaan Reddy,,ABSENT,'}
          className="text-xs font-mono h-32"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleParse} disabled={!pasteText.trim() || !gate.canImportCsv}>
            Parse & Preview
          </Button>
          {preview && gate.canImportCsv && (
            <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleImport} disabled={loading || preview.length === 0}>
              {loading ? 'Importing…' : `Import ${preview.length} rows`}
            </Button>
          )}
          {!gate.canImportCsv && (
            <p className="text-[10px] text-muted-foreground self-center">Read-only — you don't have permission to import marks.</p>
          )}
        </div>
        {errors.length > 0 && (
          <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2">
            <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 mb-1">{errors.length} parse errors:</p>
            <ul className="text-[10px] text-rose-700/80 dark:text-rose-300/80 list-disc list-inside space-y-0.5">
              {errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {preview && preview.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">Preview ({preview.length} rows)</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px] uppercase">Roll</TableHead>
                    <TableHead className="text-[9px] uppercase">Student</TableHead>
                    <TableHead className="text-[9px] uppercase text-center">Marks</TableHead>
                    <TableHead className="text-[9px] uppercase">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 10).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[10px] font-mono">{r.rollNo}</TableCell>
                      <TableCell className="text-[10px]">{r.studentName}</TableCell>
                      <TableCell className="text-[10px] text-center tabular-nums">{r.marksObtained ?? '—'}</TableCell>
                      <TableCell className="text-[10px]">{r.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > 10 && <p className="text-[10px] text-muted-foreground p-2 text-center">+ {preview.length - 10} more rows</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
