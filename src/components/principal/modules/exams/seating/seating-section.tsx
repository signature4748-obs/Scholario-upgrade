'use client'

/**
 * SeatingSection — examination room + seat allocation system.
 *
 * Uses REAL student data from the Students & Classes Zustand store.
 * Class selection is mutually exclusive across rooms.
 * Invigilators are slot-specific (date + shift + room, max 3).
 */

import { useState, useMemo, useEffect } from 'react'
import { Plus, Trash2, RefreshCw, Download, Users, Layers, X, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ExamDTO, AdmitCardStudent } from '@/lib/exams/types'
import type { ExamRoom, SeatingPlan, SeatingStudent, SeatingType, InvigilationAssignment, ExamSlot } from '@/lib/exams/seating/types'
import { computeCapacity } from '@/lib/exams/seating/types'
import { generateSeatingPlan, roomOccupancy, buildExamSlots } from '@/lib/exams/seating/generator'
import { SeatingMap } from './seating-map'
import { generateSeatingPlanPDF, generateBatchAdmitCardPDF } from '@/lib/exams/pdf'
import { useStudentsStore } from '@/lib/store/students-store'
// PHASE 7 — invigilator picks come from the school's real teacher roster
// (server Teacher rows; honest empty picker until the roster syncs).
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { useSchoolContext } from '@/lib/exams/use-pdf-context'
import { useAdmitCardConfig } from '@/lib/exams/use-exam-settings'
import { formatDateLong } from '@/lib/exams/format-helpers'
import { getSchoolProfile } from '@/lib/school-profile'

interface Props {
  exam: ExamDTO
}

/** Fallback school context when the API is unavailable — the live School
 *  Settings snapshot, never a hardcoded placeholder. */
function fallbackSchoolContext() {
  const profile = getSchoolProfile()
  return {
    schoolId: '',
    schoolName: profile.name,
    schoolCode: '',
    address: profile.address,
    city: null,
    phone: profile.phone,
    email: profile.email,
    logoUrl: null,
    academicYear: profile.academicYear,
    board: 'CBSE' as const,
  }
}

export function SeatingSection({ exam }: Props) {
  const [rooms, setRooms] = useState<ExamRoom[]>([
    { id: 'room-1', name: 'Room A', roomNo: 'A-101', rows: 5, cols: 6, seatingType: 'single', capacity: 30, eligibleClassIds: [] },
  ])
  const [plan, setPlan] = useState<SeatingPlan | null>(null)
  const [invigilators, setInvigilators] = useState<InvigilationAssignment[]>([])

  const allStudents = useStudentsStore((s) => s.students)
  const allTeachers = useTeacherRosterStore((s) => s.teachers)
  const ensureRoster = useTeacherRosterStore((s) => s.ensure)
  // Hydrate the roster once (idempotent, in-flight-guarded).
  useEffect(() => { void ensureRoster() }, [ensureRoster])

  // Build exam slots from schedule.
  const examSlots = useMemo(() => buildExamSlots(exam), [exam])

  // Build student records per exam class.
  const studentsByClass = useMemo(() => {
    const map = new Map<string, SeatingStudent[]>()
    for (const examClass of exam.classes) {
      const classStudents = allStudents
        .filter((s) => s.classId === examClass.classId && s.status === 'Active')
        .map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, classId: examClass.classId, className: examClass.className }))
      map.set(examClass.classId, classStudents)
    }
    return map
  }, [exam.classes, allStudents])

  const totalEligibleStudents = useMemo(() => {
    const ids = new Set<string>()
    for (const students of studentsByClass.values()) for (const s of students) ids.add(s.id)
    return ids.size
  }, [studentsByClass])

  const totalCapacity = useMemo(() => rooms.reduce((sum, r) => sum + r.capacity, 0), [rooms])

  // Collect ALL class IDs already assigned to ANY room (for mutual exclusivity).
  const allAssignedClassIds = useMemo(() => {
    const set = new Set<string>()
    for (const room of rooms) for (const cid of room.eligibleClassIds) set.add(cid)
    return set
  }, [rooms])

  // Auto-seed: for Completed/Ongoing exams, distribute classes across rooms and generate the plan.
  // This fixes the data-integrity issue where a Completed exam showed "Not Generated".
  const isCompletedOrOngoing = exam.status === 'Completed' || exam.status === 'Ongoing'
  const [autoSeeded, setAutoSeeded] = useState(false)
  useEffect(() => {
    if (!isCompletedOrOngoing || autoSeeded || totalEligibleStudents === 0 || rooms.length === 0) return
    // Distribute exam classes across available rooms (round-robin by student count).
    const classIds = Array.from(studentsByClass.keys())
    if (classIds.length === 0) { setAutoSeeded(true); return }
    setRooms((prevRooms) => {
      const updated = prevRooms.map((r) => ({ ...r, eligibleClassIds: [] as string[] }))
      classIds.forEach((cid, i) => {
        updated[i % updated.length].eligibleClassIds.push(cid)
      })
      return updated
    })
    setAutoSeeded(true)
  }, [isCompletedOrOngoing, autoSeeded, totalEligibleStudents, studentsByClass, rooms.length])

  // After auto-seeding rooms, generate the plan once.
  const [planGenerated, setPlanGenerated] = useState(false)
  useEffect(() => {
    if (!autoSeeded || planGenerated || plan) return
    if (rooms.some((r) => r.eligibleClassIds.length === 0)) return
    const result = generateSeatingPlan(exam.id, rooms, studentsByClass)
    setPlan(result)
    setPlanGenerated(true)
  }, [autoSeeded, planGenerated, plan, rooms, studentsByClass, exam.id])

  // Status: reflect the exam lifecycle.
  const seatingStatus = plan ? (plan.fits ? 'Generated' : 'Partial') : (isCompletedOrOngoing ? 'Auto-generating…' : 'Not Generated')

  const handleAddRoom = () => {
    const idx = rooms.length + 1
    setRooms((r) => [...r, {
      id: `room-${Date.now()}`, name: `Room ${String.fromCharCode(64 + idx)}`,
      roomNo: `A-${100 + idx}`, rows: 5, cols: 6, seatingType: 'single' as SeatingType,
      capacity: 30, eligibleClassIds: [],
    }])
  }

  const handleUpdateRoom = (id: string, field: keyof ExamRoom, value: any) => {
    setRooms((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: value }
      if (field === 'rows' || field === 'cols' || field === 'seatingType') {
        updated.capacity = computeCapacity(updated.rows, updated.cols, updated.seatingType)
      }
      return updated
    }))
  }

  const handleRemoveRoom = (id: string) => setRooms((rs) => rs.filter((r) => r.id !== id))

  const toggleEligibleClass = (roomId: string, classId: string) => {
    setRooms((rs) => rs.map((r) => {
      if (r.id !== roomId) return r
      // Check if class is already assigned to another room.
      if (!r.eligibleClassIds.includes(classId) && allAssignedClassIds.has(classId)) {
        const owner = rooms.find((rm) => rm.eligibleClassIds.includes(classId))
        toast.error(`Already assigned to ${owner?.name ?? 'another room'}`)
        return r
      }
      const eligible = r.eligibleClassIds.includes(classId)
        ? r.eligibleClassIds.filter((c) => c !== classId)
        : [...r.eligibleClassIds, classId]
      return { ...r, eligibleClassIds: eligible }
    }))
  }

  const handleGenerate = () => {
    if (rooms.length === 0) { toast.error('Add at least one room'); return }
    if (rooms.some((r) => r.eligibleClassIds.length === 0)) { toast.error('Each room needs at least one eligible class'); return }
    const result = generateSeatingPlan(exam.id, rooms, studentsByClass)
    setPlan(result)
    if (result.fits) toast.success(`${result.totalAssigned} students seated`)
    else toast.warning(`${result.totalAssigned} seated, ${result.totalUnassigned} need more seats`)
  }

  const handleDownload = () => {
    if (!plan) { toast.error('No seating plan to export'); return }
    try {
      generateSeatingPlanPDF(exam, plan as unknown as any[], schoolCtxData ?? fallbackSchoolContext())
      toast.success('Seating plan PDF downloaded')
    } catch (e: any) { toast.error('Export failed', { description: e.message }) }
  }

  // Print admit cards for all seated students.
  const { data: schoolCtxData } = useSchoolContext()
  const { config: admitConfigData } = useAdmitCardConfig()
  const [admitLoading, setAdmitLoading] = useState(false)

  const handlePrintAdmitCards = async () => {
    if (!plan || plan.totalAssigned === 0) {
      toast.error('No seated students to generate admit cards for')
      return
    }
    setAdmitLoading(true)
    try {
      // Fallback school context if API is unavailable — the live School
      // Settings snapshot, never a hardcoded placeholder.
      const school = schoolCtxData ?? fallbackSchoolContext()
      const config = admitConfigData ?? {
        showPhoto: false,
        showRollNumber: true,
        showRoom: true,
        showSeatNumber: true,
        showTimetable: true,
        showInstructions: true,
        showQrCode: false,
      }
      // Collect all seated students across all rooms.
      const allSeatedStudents: AdmitCardStudent[] = []
      for (const room of rooms) {
        const roomStudents = room.eligibleClassIds.flatMap((cId) => studentsByClass.get(cId) ?? [])
        for (const student of roomStudents) {
          const seat = plan.seats.find((s) => s.studentId === student.id && s.roomId === room.id)
          // Build schedule for this student's class.
          const studentSchedule = exam.schedule
            .filter((item: any) => item.classId === student.classId)
            .map((item: any) => ({
              subjectId: item.subjectId,
              subjectName: item.subjectName,
              date: item.date,
              startTime: item.startTime,
              endTime: item.endTime,
              room: room.name,
              seatNumber: seat ? Number(seat.seatNumber) : null,
              invigilatorName: item.invigilatorName,
            }))
          allSeatedStudents.push({
            id: student.id,
            name: student.name,
            rollNo: student.rollNo,
            admissionNo: null,
            className: exam.classes.find((c: any) => c.classId === student.classId)?.className ?? '',
            section: null,
            stream: null,
            photo: null,
            room: room.name,
            seatNumber: seat ? Number(seat.seatNumber) : null,
            schedule: studentSchedule,
          })
        }
      }
      if (allSeatedStudents.length === 0) {
        toast.error('No students found in seating plan')
        return
      }
      const classNameLabel = rooms.length === 1
        ? rooms[0].name
        : `${allSeatedStudents.length} students`
      generateBatchAdmitCardPDF(exam, classNameLabel, allSeatedStudents, school, config, '1')
      toast.success(`Admit cards generated for ${allSeatedStudents.length} students`)
    } catch (e: any) {
      toast.error('Failed to generate admit cards', { description: e.message })
    } finally {
      setAdmitLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={<Layers className="h-3 w-3" />} label="Rooms" value={String(rooms.length)} />
        <Stat icon={<Users className="h-3 w-3" />} label="Capacity" value={String(totalCapacity)} />
        <Stat icon={<Users className="h-3 w-3" />} label="Students" value={String(totalEligibleStudents)} />
        <Stat
          icon={<RefreshCw className="h-3 w-3" />}
          label="Status"
          value={seatingStatus}
          valueClassName={plan ? (plan.fits ? 'text-emerald-600' : 'text-amber-600') : 'text-muted-foreground'}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Examination Rooms</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleGenerate}>
            <RefreshCw className="h-3 w-3" /> {plan ? 'Regenerate' : 'Generate'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleDownload} disabled={!plan}>
            <Download className="h-3 w-3" /> Seating PDF
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/5" onClick={handlePrintAdmitCards} disabled={!plan || admitLoading}>
            <Ticket className="h-3 w-3" /> {admitLoading ? 'Generating…' : 'Admit Cards'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleAddRoom}>
            <Plus className="h-3 w-3" /> Add Room
          </Button>
        </div>
      </div>

      {/* Room cards */}
      {rooms.map((room) => {
        const _roomStudents = room.eligibleClassIds.flatMap((cId) => studentsByClass.get(cId) ?? [])
        return (
          <div key={room.id} className="rounded-lg border border-border/60 overflow-hidden">
            {/* Room header */}
            <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-border/40 bg-muted/20">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{room.name}</p>
                  {plan && (() => {
                    const { occupied, capacity: cap } = roomOccupancy(plan, room.id)
                    const pct = cap > 0 ? Math.round((occupied / cap) * 100) : 0
                    return (
                      <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold',
                        pct === 100 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' :
                        pct > 0 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                        'bg-muted text-muted-foreground',
                      )}>
                        {occupied}/{cap}
                      </span>
                    )
                  })()}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{room.roomNo} · {room.rows}×{room.cols} {room.seatingType} · {room.capacity} seats</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleRemoveRoom(room.id)} className="text-muted-foreground hover:text-rose-500 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* Config — grouped */}
              <div className="rounded-md border border-border/40 bg-card/40 p-2">
                <p className="text-[8px] uppercase font-semibold text-muted-foreground mb-1.5">Room Configuration</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input value={room.name} onChange={(e) => handleUpdateRoom(room.id, 'name', e.target.value)} placeholder="Name" className="h-7 text-xs flex-1 min-w-[80px]" />
                  <Input value={room.roomNo} onChange={(e) => handleUpdateRoom(room.id, 'roomNo', e.target.value)} placeholder="Room #" className="h-7 text-xs w-20" />
                  <Input type="number" value={room.rows} onChange={(e) => handleUpdateRoom(room.id, 'rows', Number(e.target.value))} className="h-7 text-xs w-12" min={1} max={20} />
                  <span className="text-[10px] text-muted-foreground">×</span>
                  <Input type="number" value={room.cols} onChange={(e) => handleUpdateRoom(room.id, 'cols', Number(e.target.value))} className="h-7 text-xs w-12" min={1} max={20} />
                  <Select value={room.seatingType} onValueChange={(v) => handleUpdateRoom(room.id, 'seatingType', v as SeatingType)}>
                    <SelectTrigger size="sm" className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="double">Double</SelectItem>
                      <SelectItem value="triple">Triple</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Eligible classes — mutually exclusive across rooms */}
              <div className="rounded-md border border-border/40 bg-card/40 p-2">
                <p className="text-[8px] uppercase font-semibold text-muted-foreground mb-1.5">Eligible Classes</p>
                <div className="flex flex-wrap gap-1.5">
                  {exam.classes.map((c: any) => {
                    const isSelected = room.eligibleClassIds.includes(c.classId)
                    const isAssignedElsewhere = !isSelected && allAssignedClassIds.has(c.classId)
                    const ownerRoom = isAssignedElsewhere ? rooms.find((rm) => rm.eligibleClassIds.includes(c.classId)) : null
                    const count = (studentsByClass.get(c.classId) ?? []).length
                    return (
                      <button
                        key={c.classId}
                        onClick={() => toggleEligibleClass(room.id, c.classId)}
                        disabled={isAssignedElsewhere}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors',
                          isSelected ? 'border-primary/40 bg-primary/10 text-primary' : '',
                          isAssignedElsewhere ? 'border-border/40 bg-muted/20 text-muted-foreground/40 cursor-not-allowed' : '',
                          !isSelected && !isAssignedElsewhere ? 'border-border text-muted-foreground hover:bg-muted/30' : '',
                        )}
                        title={isAssignedElsewhere ? `Already assigned to ${ownerRoom?.name}` : undefined}
                      >
                        {c.className} ({count})
                        {isAssignedElsewhere && <span className="text-[7px] opacity-60">→ {ownerRoom?.name}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Seating map */}
              {plan && (() => {
                const { occupied, capacity: cap } = roomOccupancy(plan, room.id)
                return (
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[10px] font-semibold', occupied === cap ? 'text-emerald-600' : 'text-muted-foreground')}>
                        {occupied} / {cap} occupied · {cap - occupied} empty
                      </span>
                    </div>
                    <SeatingMap room={room} plan={plan} />
                    {/* Slot-specific invigilators */}
                    <InvigilatorPanel
                      roomId={room.id}
                      roomName={room.name}
                      examSlots={examSlots}
                      invigilators={invigilators}
                      setInvigilators={setInvigilators}
                      teachers={allTeachers}
                    />
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })}

      {/* Warnings */}
      {plan && !plan.fits && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-300">
          {plan.totalUnassigned} students need additional seating. Add more rooms or increase capacity.
        </div>
      )}
      {allStudents.length === 0 && (
        <div className="py-8 text-center text-xs text-muted-foreground">
          No student records available. Ensure students are added in Students &amp; Classes.
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, valueClassName }: { icon: React.ReactNode; label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2.5 py-1.5 border border-border/40">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('text-[11px] font-semibold truncate', valueClassName ?? 'text-foreground')}>{value}</p>
      </div>
    </div>
  )
}

/** Slot-specific invigilator panel — date/shift/room, max 3 teachers, conflict detection. */
function InvigilatorPanel({ roomId, roomName: _roomName, examSlots, invigilators, setInvigilators, teachers }: {
  roomId: string
  roomName: string
  examSlots: ExamSlot[]
  invigilators: InvigilationAssignment[]
  setInvigilators: React.Dispatch<React.SetStateAction<InvigilationAssignment[]>>
  teachers: any[]
}) {
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null)

  const handleAdd = (slotId: string, teacherId: string) => {
    const teacher = teachers.find((t) => t.id === teacherId)
    if (!teacher) return
    // Conflict check: same teacher in another room for same slot.
    const conflict = invigilators.find((a) => a.examSlotId === slotId && a.teacherId === teacherId && a.roomId !== roomId)
    if (conflict) {
      toast.error(`${teacher.name} is already assigned to another room for this slot`)
      return
    }
    // Max 3 per slot+room.
    const currentCount = invigilators.filter((a) => a.examSlotId === slotId && a.roomId === roomId).length
    if (currentCount >= 3) { toast.error('Maximum 3 invigilators per slot'); return }
    setInvigilators((prev) => [...prev, {
      id: `inv-${Date.now()}-${Math.random()}`, examSlotId: slotId, roomId,
      teacherId, teacherName: teacher.name,
    }])
  }

  const handleRemove = (invId: string) => {
    setInvigilators((prev) => prev.filter((a) => a.id !== invId))
  }

  if (examSlots.length === 0) {
    return <p className="text-[9px] text-muted-foreground">No exam slots available for invigilator assignment.</p>
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] uppercase font-semibold text-muted-foreground">Invigilators (per slot)</p>
      {examSlots.map((slot) => {
        const slotInvs = invigilators.filter((a) => a.examSlotId === slot.id && a.roomId === roomId)
        const isExpanded = expandedSlot === slot.id
        return (
          <div key={slot.id} className="rounded-md border border-border/40 p-2">
            <button
              onClick={() => setExpandedSlot(isExpanded ? null : slot.id)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-[9px] font-medium text-foreground">
                {formatDateLong(slot.date)} · {slot.shiftLabel} · {slot.startTime}–{slot.endTime}
              </span>
              <span className="text-[8px] text-muted-foreground">{slotInvs.length} assigned</span>
            </button>
            {isExpanded && (
              <div className="mt-1.5 space-y-1">
                {slotInvs.map((inv) => (
                  <div key={inv.id} className="inline-flex items-center gap-1 rounded-md bg-primary/5 border border-primary/20 px-1.5 py-0.5 text-[9px] text-primary mr-1">
                    {inv.teacherName}
                    <button onClick={() => handleRemove(inv.id)} className="hover:text-rose-500"><X className="h-2.5 w-2.5" /></button>
                  </div>
                ))}
                {slotInvs.length < 3 && (
                  <Select onValueChange={(v) => handleAdd(slot.id, v)}>
                    <SelectTrigger size="sm" className="h-6 text-[9px] w-32"><SelectValue placeholder="+ Add teacher" /></SelectTrigger>
                    <SelectContent>
                      {teachers
                        .filter((t) => !slotInvs.some((inv) => inv.teacherId === t.id))
                        .map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
