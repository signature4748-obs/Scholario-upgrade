// ──────────────────────────────────────────────────────────────────────
// Examinations service — P1 & P2 features.
// Splits: seating, exam attendance, invigilator roster, batch admit card,
// grace/moderation, promotion outcomes, CSV import, result publication.
// ──────────────────────────────────────────────────────────────────────

import 'server-only'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import {
  type AuthUserLike,
  type ScheduleItemDTO,
  type StudentDTO,
  type ExamMarkDTO,
  type MarkStatus,
  type WorkflowStatus,
  type AuditLogDTO,
} from './types'
import { toScheduleDTO, toMarkDTO, audit, deleteScheduleItem } from './service'
import { getGradeForPercentage } from './types'
import { computeAllResults } from './result-engine'
import { getTeacherPreferences } from '@/lib/user-preferences'
import { classLabelOf } from '@/lib/teacher-hub'

// Re-export deleteScheduleItem so callers of service-extended have a single import surface
export { deleteScheduleItem }

// ─── Schedule — Update existing item ─────────────────────────────────

export async function updateScheduleItem(
  examId: string,
  itemId: string,
  schoolId: string,
  user: AuthUserLike | null,
  data: {
    date?: string
    startTime?: string
    endTime?: string
    room?: string
    invigilatorId?: string | null
    invigilatorName?: string | null
  }
): Promise<ScheduleItemDTO> {
  const item = await db.examScheduleItem.findFirst({
    where: { id: itemId, examId },
    include: { exam: true },
  })
  if (!item || item.exam.schoolId !== schoolId) throw new Error('Schedule item not found')

  // Conflict detection on update (skip self)
  if (data.date && (data.startTime || data.room)) {
    const conflicts = await db.examScheduleItem.findMany({
      where: {
        examId,
        id: { not: itemId },
        date: new Date(data.date),
        startTime: data.startTime ?? item.startTime,
        OR: data.room ? [
          { classId: item.classId },
          { room: data.room },
        ] : [{ classId: item.classId }],
      },
    })
    if (conflicts.length > 0) {
      throw new Error('Schedule conflict: same class or room already booked at this time')
    }
  }

  const updated = await db.examScheduleItem.update({
    where: { id: itemId },
    data: {
      ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
      ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
      ...(data.room !== undefined ? { room: data.room } : {}),
      ...(data.invigilatorId !== undefined ? { invigilatorId: data.invigilatorId } : {}),
      ...(data.invigilatorName !== undefined ? { invigilatorName: data.invigilatorName } : {}),
    },
    include: { class: true, subject: true },
  })
  await audit(examId, user, 'SCHEDULE_UPDATED', 'SCHEDULE', itemId, item, data)
  return toScheduleDTO(updated)
}

// ─── Invigilator Duty Roster ──────────────────────────────────────────
//
// The canonical invigilation layer. ExamScheduleItem.invigilatorId stores
// the invigilator's USER id (matching every seeded row) with the display
// name kept in sync on invigilatorName; matching helpers below accept the
// user id, the teacher id AND the name so legacy rows written by any path
// keep resolving.

export interface InvigilatorDTO {
  id: string
  name: string
  email: string | null
  department: string | null
  employeeId: string | null
  assignedCount: number
}

/** Does this schedule item belong to the given teacher (id or name)? */
function itemBelongsTo(
  item: { invigilatorId: string | null; invigilatorName: string | null },
  teacher: { userId: string | null; id: string; name: string },
): boolean {
  if (item.invigilatorId != null) {
    if (item.invigilatorId === teacher.userId || item.invigilatorId === teacher.id) {
      return true
    }
  }
  const n = (item.invigilatorName || '').trim().toLowerCase()
  return n.length > 0 && n === teacher.name.trim().toLowerCase()
}

export async function listTeachers(schoolId: string): Promise<InvigilatorDTO[]> {
  const [teachers, items] = await Promise.all([
    db.teacher.findMany({
      where: { schoolId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    db.examScheduleItem.findMany({
      where: { exam: { schoolId } },
      select: { invigilatorId: true, invigilatorName: true },
    }),
  ])
  return teachers.map((t) => {
    const name = t.user?.name ?? ''
    return {
      id: t.id,
      name,
      email: t.user?.email ?? null,
      department: t.department,
      employeeId: t.employeeId,
      assignedCount: items.filter((i) =>
        itemBelongsTo(i, { userId: t.userId, id: t.id, name }),
      ).length,
    }
  })
}

// ─── Duty-change notifications ─────────────────────────────────────────
//
// Assignment / reassignment / removal push a direct Message to the
// affected teacher — it lands in their notification bell immediately (the
// :3003 event stream broadcasts new Message rows live, filtered by
// recipientId) and persists as an unread message until acknowledged.
// The teacher's "Examination duty" preference (Settings → Notifications)
// is honored server-side: opting out skips the message, never the duty.

function prettyDate(iso: Date | string): string {
  const d = typeof iso === 'string' ? new Date(`${iso}T00:00:00Z`) : iso
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

async function notifyDutyChange(
  schoolId: string,
  recipientUserId: string | null,
  sender: { id: string; name: string | null } | null,
  message: { subject: string; body: string },
): Promise<boolean> {
  if (!recipientUserId) return false
  try {
    const prefs = await getTeacherPreferences(recipientUserId)
    if (!prefs.notifications.examDuty) return false
    await db.message.create({
      data: {
        schoolId,
        senderId: sender?.id ?? null,
        recipientId: recipientUserId,
        subject: message.subject,
        body: message.body,
      },
    })
    return true
  } catch {
    // A notification failure must never break the assignment itself.
    return false
  }
}

export async function assignInvigilator(
  examId: string,
  scheduleItemId: string,
  schoolId: string,
  user: AuthUserLike | null,
  teacherId: string | null,
): Promise<ScheduleItemDTO> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  const item = await db.examScheduleItem.findFirst({
    where: { id: scheduleItemId, examId },
    include: { exam: true, class: true, subject: true },
  })
  if (!item || item.exam.schoolId !== schoolId) throw new Error('Schedule item not found')

  const paperLabel = `${item.subject.name} · ${classLabelOf(item.class)}`
  const whenLabel = `${prettyDate(item.date)}, ${item.startTime}–${item.endTime}${item.room ? ` · ${item.room}` : ''}`
  const previousName = item.invigilatorName
  const previousId = item.invigilatorId

  // ── CLEAR (teacherId null) ──────────────────────────────────────────
  if (teacherId == null) {
    const updated = await db.examScheduleItem.update({
      where: { id: scheduleItemId },
      data: { invigilatorId: null, invigilatorName: null },
      include: { class: true, subject: true },
    })
    if (previousId != null || previousName != null) {
      // Tell the released teacher — resolve their user id by id first, then
      // by display name (invigilatorId holds a USER id on seeded rows).
      const releasedUser = await db.user
        .findFirst({
          where: {
            schoolId,
            ...(previousId != null
              ? { id: previousId }
              : { name: previousName ?? '__none__' }),
          },
        })
        .catch(() => null)
      await notifyDutyChange(schoolId, releasedUser?.id ?? previousId, user, {
        subject: `Exam duty released · ${paperLabel}`,
        body: `You are no longer assigned as invigilator for ${paperLabel} (${whenLabel}) in ${exam.name}.${user?.name ? ` Released by ${user.name}.` : ''}`,
      })
    }
    await audit(examId, user, 'INVIGILATOR_CLEARED', 'SCHEDULE', scheduleItemId, { invigilatorName: previousName }, null)
    return toScheduleDTO(updated)
  }

  // ── ASSIGN / REASSIGN ───────────────────────────────────────────────
  const teacher = await db.teacher.findFirst({
    where: { id: teacherId, schoolId },
    include: { user: { select: { id: true, name: true } } },
  })
  if (!teacher) throw new Error('Teacher not found')
  const teacherName = teacher.user?.name ?? ''
  if (itemBelongsTo(item, { userId: teacher.userId, id: teacher.id, name: teacherName })) {
    // Already assigned to this teacher — nothing to do (idempotent).
    return toScheduleDTO(item)
  }

  // Availability — school-wide: the teacher cannot invigilate two papers
  // that overlap on the same day, across ANY examination of the school.
  const sameDay = await db.examScheduleItem.findMany({
    where: {
      id: { not: scheduleItemId },
      date: item.date,
      exam: { schoolId },
      OR: [
        { invigilatorId: teacher.userId ?? '__none__' },
        { invigilatorId: teacher.id },
        { invigilatorName: { not: null } },
      ],
    },
    select: { invigilatorId: true, invigilatorName: true, startTime: true, endTime: true },
  })
  const conflict = sameDay.find((s) => {
    if (!itemBelongsTo(s, { userId: teacher.userId, id: teacher.id, name: teacherName })) return false
    return !(item.endTime <= s.startTime || s.endTime <= item.startTime)
  })
  if (conflict) {
    throw new Error(`${teacherName} already has an overlapping invigilation duty at ${conflict.startTime}–${conflict.endTime} on ${prettyDate(item.date)}`)
  }

  // invigilatorId stores the teacher's USER id — the same convention every
  // seeded row follows, so duty lookups resolve by session user id.
  const updated = await db.examScheduleItem.update({
    where: { id: scheduleItemId },
    data: {
      invigilatorId: teacher.userId ?? teacher.id,
      invigilatorName: teacher.user?.name ?? null,
    },
    include: { class: true, subject: true },
  })

  // Notify the newly assigned teacher (and quietly release-notify the
  // previous one when this was a reassignment).
  if (previousId != null && previousId !== (teacher.userId ?? teacher.id)) {
    const prevUser = await db.user
      .findFirst({ where: { id: previousId, schoolId } })
      .catch(() => null)
    await notifyDutyChange(schoolId, prevUser?.id ?? previousId, user, {
      subject: `Exam duty reassigned · ${paperLabel}`,
      body: `Your invigilation duty for ${paperLabel} (${whenLabel}) in ${exam.name} has been assigned to ${teacherName}.`,
    })
  }
  await notifyDutyChange(schoolId, teacher.userId, user, {
    subject: `Exam duty assigned · ${paperLabel}`,
    body: `You are assigned as invigilator for ${paperLabel} (${whenLabel}) in ${exam.name}.${user?.name ? ` Assigned by ${user.name}.` : ''} You can view this duty under My Timetable → Examination Duties.`,
  })

  await audit(examId, user, 'INVIGILATOR_ASSIGNED', 'SCHEDULE', scheduleItemId, { invigilatorName: previousName }, {
    teacherId,
    teacherName: teacher.user?.name,
  })
  return toScheduleDTO(updated)
}

// ─── Duty roster (principal's invigilation timetable) ─────────────────

export interface DutyPaperDTO {
  id: string
  examId: string
  date: string
  startTime: string
  endTime: string
  room: string | null
  className: string
  subjectName: string
  invigilatorId: string | null
  invigilatorName: string | null
}

export interface DutyExamDTO {
  id: string
  name: string
  type: string
  status: string
  startDate: string | null
  endDate: string | null
  papers: DutyPaperDTO[]
}

export interface DutyRosterDTO {
  todayKey: string
  exams: DutyExamDTO[]
  teachers: InvigilatorDTO[]
}

const PRETTY_EXAM_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

/**
 * The complete, real invigilation picture for a school: every examination
 * with its papers + assigned invigilators, and every teacher with their
 * duty count. Powers the principal's Invigilation tab.
 */
export async function listDutyRoster(schoolId: string): Promise<DutyRosterDTO> {
  const [exams, teachers] = await Promise.all([
    db.exam.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        scheduleItems: {
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
          include: {
            class: { select: { name: true, section: true } },
            subject: { select: { name: true } },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    }),
    listTeachers(schoolId),
  ])

  return {
    todayKey: new Date().toISOString().slice(0, 10),
    exams: exams.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type ?? 'Unit Test',
      status: PRETTY_EXAM_STATUS[e.status ?? ''] ?? e.status ?? 'Draft',
      startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
      endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
      papers: e.scheduleItems.map((i) => ({
        id: i.id,
        examId: e.id,
        date: i.date.toISOString().slice(0, 10),
        startTime: i.startTime,
        endTime: i.endTime,
        room: i.room,
        className: classLabelOf(i.class),
        subjectName: i.subject.name,
        invigilatorId: i.invigilatorId,
        invigilatorName: i.invigilatorName,
      })),
    })),
    teachers,
  }
}

// ─── Seating Plan ─────────────────────────────────────────────────────

export interface SeatAssignmentDTO {
  id: string
  examId: string
  classId: string
  className: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  room: string
  seatNumber: number
  row: number | null
  column: number | null
}

export async function generateSeatingPlan(
  examId: string,
  classId: string,
  schoolId: string,
  user: AuthUserLike | null,
  rooms: Array<{ name: string; capacity: number }>
): Promise<{ generated: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (rooms.length === 0) throw new Error('At least one room is required')

  // Get real students of this class
  const students = await db.student.findMany({
    where: { classId, schoolId },
    orderBy: { rollNo: 'asc' },
    include: { user: { select: { name: true } }, class: true },
  })
  if (students.length === 0) throw new Error('No students in this class')

  // Total capacity check
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0)
  if (totalCapacity < students.length) {
    throw new Error(`Insufficient capacity: ${students.length} students, ${totalCapacity} seats available`)
  }

  // Phase 3 — seating regeneration is ONE $transaction: the
  // deleteMany + the per-seat creates commit atomically (a crash mid-way
  // previously left the class with a partial seating plan).
  let seatCounter = 0
  const generated = await db.$transaction(async (tx) => {
    // Clear any existing assignments for this exam+class
    await tx.examSeatAssignment.deleteMany({ where: { examId, classId } })

    // Distribute students across rooms, sorted by roll number
    for (const room of rooms) {
      for (let i = 0; i < room.capacity && seatCounter < students.length; i++) {
        const s = students[seatCounter]
        const seatNumber = i + 1
        const row = Math.floor(i / 5) + 1
        const col = (i % 5) + 1
        await tx.examSeatAssignment.create({
          data: {
            examId,
            classId,
            studentId: s.id,
            room: room.name,
            seatNumber,
            row,
            column: col,
          },
        })
        seatCounter++
        if (seatCounter >= students.length) break
      }
    }
    return seatCounter
  })

  await audit(examId, user, 'SEATING_GENERATED', 'SEATING', null, null, {
    classId,
    studentCount: students.length,
    rooms,
  })
  return { generated }
}

export async function getSeatingPlan(
  examId: string,
  classId: string | null,
  schoolId: string
): Promise<SeatAssignmentDTO[]> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) return []
  const seats = await db.examSeatAssignment.findMany({
    where: { examId, ...(classId ? { classId } : {}) },
    include: { student: { include: { user: { select: { name: true } } } } },
    orderBy: [{ room: 'asc' }, { seatNumber: 'asc' }],
  })
  // Resolve classNames separately
  const classIds = [...new Set(seats.map((s) => s.classId))]
  const classes = await db.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
  const classMap = new Map(classes.map((c) => [c.id, c.name]))
  return seats.map((s) => ({
    id: s.id,
    examId: s.examId,
    classId: s.classId,
    className: classMap.get(s.classId) ?? '',
    studentId: s.studentId,
    studentName: s.student?.user?.name ?? '',
    studentRollNo: s.student?.rollNo ?? null,
    room: s.room,
    seatNumber: s.seatNumber,
    row: s.row,
    column: s.column,
  }))
}

// ─── Exam Attendance ─────────────────────────────────────────────────

export interface ExamAttendanceDTO {
  id: string
  examId: string
  scheduleItemId: string | null
  classId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  subjectId: string | null
  subjectName: string | null
  date: string
  status: MarkStatus
  remarks: string | null
}

export async function markExamAttendance(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  input: {
    scheduleItemId?: string
    classId: string
    studentId: string
    subjectId: string // required — exam attendance is per-subject
    date: string
    status: MarkStatus
    remarks?: string
  }
): Promise<{ upserted: boolean }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (!input.subjectId) throw new Error('subjectId is required for exam attendance')

  // ── Tenant guards (audit 3-b HIGH): FK-in-tenant validation ─────────
  // studentId and subjectId come from the client. Both must exist in
  // the CALLER's school (the student additionally in the given class)
  // before the ExamAttendance upsert links them — otherwise a foreign
  // school's student/subject gets written into this school's rows.
  const student = await db.student.findFirst({
    where: {
      id: input.studentId,
      schoolId,
      ...(input.classId ? { classId: input.classId } : {}),
    },
    select: { id: true },
  })
  if (!student) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Student not found',
      internalDetail: `markExamAttendance: student ${input.studentId} missing or foreign tenant`,
    })
  }
  const subject = await db.subject.findFirst({
    where: { id: input.subjectId, schoolId },
    select: { id: true },
  })
  if (!subject) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Subject not found in this school',
      internalDetail: `markExamAttendance: subject ${input.subjectId} missing or foreign tenant`,
    })
  }

  await db.examAttendance.upsert({
    where: {
      examId_studentId_subjectId_date: {
        examId,
        studentId: input.studentId,
        subjectId: input.subjectId,
        date: new Date(input.date),
      },
    },
    create: {
      examId,
      scheduleItemId: input.scheduleItemId ?? null,
      classId: input.classId,
      studentId: input.studentId,
      subjectId: input.subjectId,
      date: new Date(input.date),
      status: input.status,
      remarks: input.remarks ?? null,
      markedBy: user?.id ?? null,
    },
    update: {
      status: input.status,
      remarks: input.remarks ?? null,
      markedBy: user?.id ?? null,
    },
  })
  await audit(examId, user, 'EXAM_ATTENDANCE_MARKED', 'ATTENDANCE', input.studentId, null, input)
  return { upserted: true }
}

export async function getExamAttendance(
  examId: string,
  classId: string | null,
  schoolId: string
): Promise<ExamAttendanceDTO[]> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) return []
  const attendance = await db.examAttendance.findMany({
    where: { examId, ...(classId ? { classId } : {}) },
    include: {
      student: { include: { user: { select: { name: true } } } },
      scheduleItem: { include: { subject: true } },
    },
    orderBy: { date: 'asc' },
  })
  return attendance.map((a) => ({
    id: a.id,
    examId: a.examId,
    scheduleItemId: a.scheduleItemId,
    classId: a.classId,
    studentId: a.studentId,
    studentName: a.student?.user?.name ?? '',
    studentRollNo: a.student?.rollNo ?? null,
    subjectId: a.subjectId,
    subjectName: a.scheduleItem?.subject?.name ?? null,
    date: a.date.toISOString().split('T')[0],
    status: a.status as MarkStatus,
    remarks: a.remarks,
  }))
}

export async function autoMarkAttendanceFromExamMarks(
  examId: string,
  classId: string,
  schoolId: string,
  user: AuthUserLike | null
): Promise<{ marked: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')

  // For every mark where status != PRESENT, create exam attendance entry
  const marks = await db.examMark.findMany({
    where: { examId, classId, status: { not: 'PRESENT' } },
  })
  let count = 0
  for (const m of marks) {
    const scheduleItem = await db.examScheduleItem.findFirst({
      where: { examId, classId, subjectId: m.subjectId },
    })
    if (!scheduleItem) continue
    await db.examAttendance.upsert({
      where: {
        examId_studentId_subjectId_date: {
          examId,
          studentId: m.studentId,
          subjectId: m.subjectId,
          date: scheduleItem.date,
        },
      },
      create: {
        examId,
        scheduleItemId: scheduleItem.id,
        classId,
        studentId: m.studentId,
        subjectId: m.subjectId,
        date: scheduleItem.date,
        status: m.status as MarkStatus,
        markedBy: user?.id ?? null,
      },
      update: {
        status: m.status as MarkStatus,
        markedBy: user?.id ?? null,
      },
    })
    count++
  }
  await audit(examId, user, 'EXAM_ATTENDANCE_AUTO_MARKED', 'ATTENDANCE', null, null, { count })
  return { marked: count }
}

// ─── Grace / Moderation ───────────────────────────────────────────────

export async function applyGraceMarks(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  input: {
    markId: string
    graceMarks: number
    reason: string
  }
): Promise<ExamMarkDTO> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared' && user?.role !== 'PRINCIPAL') {
    throw new Error('Grace marks after declaration require Principal override')
  }
  if (input.graceMarks <= 0) throw new Error('Grace marks must be positive')
  if (!input.reason?.trim()) throw new Error('Reason is required for grace marks')

  // Read graceMarksLimit rule from school config (default: 5)
  const rule = await db.examRule.findUnique({
    where: { schoolId_key: { schoolId, key: 'graceMarksLimit' } },
  })
  const limit = rule ? Number(rule.value) : 5
  if (input.graceMarks > limit) {
    throw new Error(`Grace marks cannot exceed the school limit of ${limit}`)
  }

  const mark = await db.examMark.findUnique({
    where: { id: input.markId },
    include: { student: { include: { user: { select: { name: true } } } }, subject: true },
  })
  if (!mark || mark.examId !== examId) throw new Error('Mark not found')

  const oldValues = {
    marksObtained: mark.marksObtained,
    graceMarks: mark.graceMarks,
    originalMarks: mark.originalMarks,
  }

  // Preserve original marks the first time grace is applied
  const originalMarks = mark.originalMarks ?? mark.marksObtained ?? 0
  const newMarksObtained = (mark.marksObtained ?? 0) + input.graceMarks

  // Don't allow grace to exceed max marks
  const max = await db.examSubjectConfig.findFirst({
    where: { examId, classId: mark.classId, subjectId: mark.subjectId },
    select: { maxMarks: true },
  })
  const maxMarks = max?.maxMarks ?? 100
  if (newMarksObtained > maxMarks) {
    throw new Error(`Grace marks would exceed the maximum (${maxMarks})`)
  }

  const updated = await db.examMark.update({
    where: { id: input.markId },
    data: {
      originalMarks,
      graceMarks: mark.graceMarks + input.graceMarks,
      graceReason: input.reason,
      graceBy: user?.id ?? null,
      marksObtained: newMarksObtained,
    },
    include: { student: { include: { user: { select: { name: true } } } } },
  })

  await audit(examId, user, 'GRACE_APPLIED', 'MARK', mark.id, oldValues, {
    graceMarks: input.graceMarks,
    reason: input.reason,
    newTotal: newMarksObtained,
    appliedBy: user?.name,
  })

  return toMarkDTO(updated)
}

// ─── Promotion / Compartment / Retest ──────────────────────────────────

export interface ResultOutcomeDTO {
  id: string
  examId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  classId: string
  className: string
  outcome: 'PROMOTED' | 'COMPARTMENT' | 'RETEST' | 'NOT_PROMOTED'
  reason: string | null
  overrideBy: string | null
  notes: string | null
  percentage: number
  grade: string
  passed: boolean
  subjectsFailed: number
}

export async function computeAutoOutcomes(
  examId: string,
  classId: string,
  schoolId: string
): Promise<{ autoCount: number }> {
  const exam = await db.exam.findFirst({
    where: { id: examId, schoolId },
    include: {
      examSubjects: { where: { classId }, include: { subject: true } },
      marks: { where: { classId }, include: { student: { include: { user: { select: { name: true } } } } } },
      examClasses: { include: { class: true } },
    },
  })
  if (!exam) throw new Error('Exam not found')
  const classLink = exam.examClasses.find((ec) => ec.classId === classId)
  if (!classLink) throw new Error('Class not in this exam')

  // Read promotion thresholds from ExamRule (defaults: 1 fail → COMPARTMENT, 2 fails → RETEST)
  const [compartmentRule, retestRule] = await Promise.all([
    db.examRule.findUnique({ where: { schoolId_key: { schoolId, key: 'compartmentThreshold' } } }),
    db.examRule.findUnique({ where: { schoolId_key: { schoolId, key: 'retestThreshold' } } }),
  ])
  const compartmentThreshold = compartmentRule ? Number(compartmentRule.value) : 1
  const retestThreshold = retestRule ? Number(retestRule.value) : 2

  // Fetch grade scale for accurate grading
  const gradeScaleRows = await db.gradeScale.findMany({
    where: { schoolId },
    orderBy: { minPct: 'desc' },
  })
  const gradeScale = gradeScaleRows.map((g) => ({
    grade: g.grade, minPct: g.minPct, maxPct: g.maxPct, color: g.color, sortOrder: g.sortOrder,
  }))

  // Get real students
  const students = await db.student.findMany({
    where: { classId, schoolId },
    orderBy: { rollNo: 'asc' },
    include: { user: { select: { name: true } } },
  })
  const studentDTOs: StudentDTO[] = students.map((s) => ({
    id: s.id, rollNo: s.rollNo, admissionNo: s.admissionNo,
    name: s.user?.name ?? '', classId: s.classId,
  }))
  const subjectDTOs = exam.examSubjects.map((s) => ({
    id: s.id, examId: s.examId, classId: s.classId, subjectId: s.subjectId,
    subjectName: s.subject.name, subjectCode: s.subject.code,
    maxMarks: s.maxMarks, passMarks: s.passMarks,
    theoryMarks: s.theoryMarks, practicalMarks: s.practicalMarks, sortOrder: s.sortOrder,
  }))
  const markDTOs = exam.marks.map((m) => ({
    id: m.id, examId: m.examId, classId: m.classId, subjectId: m.subjectId, studentId: m.studentId,
    studentName: m.student?.user?.name ?? '', studentRollNo: m.student?.rollNo ?? null,
    marksObtained: m.marksObtained, status: m.status as MarkStatus,
    workflowStatus: m.workflowStatus as WorkflowStatus,
    originalMarks: m.originalMarks, graceMarks: m.graceMarks ?? 0,
    graceReason: m.graceReason, remarks: m.remarks, enteredBy: m.enteredBy,
    enteredAt: m.enteredAt?.toISOString() ?? null,
    verifiedBy: m.verifiedBy, verifiedAt: m.verifiedAt?.toISOString() ?? null, lockedBy: m.lockedBy,
  }))

  const results = computeAllResults({
    students: studentDTOs, subjects: subjectDTOs, marks: markDTOs,
    passPercentage: exam.passPercentage, gradeScale,
  })

  // Phase 3 — outcome recomputation is ONE $transaction: the deleteMany
  // + the per-student outcome creates commit atomically (a crash mid-way
  // previously erased the class's outcomes without recomputing them).
  const count = await db.$transaction(async (tx) => {
    // Clear existing auto outcomes for this class
    await tx.examResultOutcome.deleteMany({ where: { examId, classId } })

    let created = 0
    for (const r of results) {
      let outcome: 'PROMOTED' | 'COMPARTMENT' | 'RETEST' | 'NOT_PROMOTED' = 'PROMOTED'
      if (r.passed) {
        outcome = 'PROMOTED'
      } else {
        const failedCount = r.subjectsCount - r.subjectsPassed
        if (failedCount <= compartmentThreshold) outcome = 'COMPARTMENT'
        else if (failedCount <= retestThreshold) outcome = 'RETEST'
        else outcome = 'NOT_PROMOTED'
      }
      await tx.examResultOutcome.create({
        data: {
          examId,
          studentId: r.studentId,
          classId,
          outcome,
          reason: r.passed ? null : `${r.subjectsCount - r.subjectsPassed} subjects failed`,
        },
      })
      created++
    }
    return created
  })
  return { autoCount: count }
}

export async function overrideOutcome(
  examId: string,
  studentId: string,
  schoolId: string,
  user: AuthUserLike | null,
  input: { outcome: 'PROMOTED' | 'COMPARTMENT' | 'RETEST' | 'NOT_PROMOTED'; reason?: string; notes?: string }
): Promise<void> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')

  // Look up the student's actual classId (for new outcome rows).
  // Tenant guard (audit 3-b HIGH): the student is resolved WITH schoolId —
  // findUnique by bare id previously accepted any school's student.
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId },
    select: { classId: true },
  })
  if (!student) throw new Error('Student not found')

  const existing = await db.examResultOutcome.findUnique({
    where: { examId_studentId: { examId, studentId } },
  })
  if (existing) {
    await db.examResultOutcome.update({
      where: { id: existing.id },
      data: {
        outcome: input.outcome,
        reason: input.reason ?? existing.reason,
        notes: input.notes ?? existing.notes,
        overrideBy: user?.id ?? null,
      },
    })
  } else {
    await db.examResultOutcome.create({
      data: {
        examId,
        studentId,
        classId: student.classId ?? '',
        outcome: input.outcome,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        overrideBy: user?.id ?? null,
      },
    })
  }
  await audit(examId, user, 'OUTCOME_OVERRIDDEN', 'OUTCOME', studentId, existing?.outcome, input)
}

export async function getOutcomes(
  examId: string,
  classId: string | null,
  schoolId: string
): Promise<ResultOutcomeDTO[]> {
  const exam = await db.exam.findFirst({
    where: { id: examId, schoolId },
    include: {
      examSubjects: classId ? { where: { classId }, include: { subject: true } } : { include: { subject: true } },
      marks: classId ? { where: { classId }, include: { student: { include: { user: { select: { name: true } } } } } } : { include: { student: { include: { user: { select: { name: true } } } } } },
      examClasses: { include: { class: true } },
      resultOutcomes: true,
    },
  })
  if (!exam) return []

  const classFilter = classId
  const filteredOutcomes = classFilter
    ? exam.resultOutcomes.filter((o) => o.classId === classFilter)
    : exam.resultOutcomes

  if (filteredOutcomes.length === 0) return []

  // Compute analytics for each student
  const students = await db.student.findMany({
    where: { id: { in: filteredOutcomes.map((o) => o.studentId) }, schoolId },
    include: { user: { select: { name: true } }, class: true },
  })

  const studentDTOs: StudentDTO[] = students.map((s) => ({
    id: s.id, rollNo: s.rollNo, admissionNo: s.admissionNo,
    name: s.user?.name ?? '', classId: s.classId,
  }))
  const subjectDTOs = exam.examSubjects
    .filter((s) => !classFilter || s.classId === classFilter)
    .map((s) => ({
      id: s.id, examId: s.examId, classId: s.classId, subjectId: s.subjectId,
      subjectName: s.subject.name, subjectCode: s.subject.code,
      maxMarks: s.maxMarks, passMarks: s.passMarks,
      theoryMarks: s.theoryMarks, practicalMarks: s.practicalMarks, sortOrder: s.sortOrder,
    }))
  const markDTOs = exam.marks.map((m) => ({
    id: m.id, examId: m.examId, classId: m.classId, subjectId: m.subjectId, studentId: m.studentId,
    studentName: m.student?.user?.name ?? '', studentRollNo: m.student?.rollNo ?? null,
    marksObtained: m.marksObtained, status: m.status as MarkStatus,
    workflowStatus: m.workflowStatus as WorkflowStatus,
    originalMarks: m.originalMarks, graceMarks: m.graceMarks ?? 0,
    graceReason: m.graceReason, remarks: m.remarks, enteredBy: m.enteredBy,
    enteredAt: m.enteredAt?.toISOString() ?? null,
    verifiedBy: m.verifiedBy, verifiedAt: m.verifiedAt?.toISOString() ?? null, lockedBy: m.lockedBy,
  }))

  const results = computeAllResults({
    students: studentDTOs, subjects: subjectDTOs, marks: markDTOs,
    passPercentage: exam.passPercentage,
  })

  return filteredOutcomes.map((outcome) => {
    const r = results.find((x) => x.studentId === outcome.studentId)
    const student = students.find((s) => s.id === outcome.studentId)
    return {
      id: outcome.id,
      examId: outcome.examId,
      studentId: outcome.studentId,
      studentName: student?.user?.name ?? '',
      studentRollNo: student?.rollNo ?? null,
      classId: outcome.classId,
      className: student?.class?.name ?? '',
      outcome: outcome.outcome as 'PROMOTED' | 'COMPARTMENT' | 'RETEST' | 'NOT_PROMOTED',
      reason: outcome.reason,
      overrideBy: outcome.overrideBy,
      notes: outcome.notes,
      percentage: r?.percentage ?? 0,
      grade: r?.grade ?? 'E',
      passed: r?.passed ?? false,
      subjectsFailed: r ? (r.subjectsCount - r.subjectsPassed) : 0,
    }
  })
}

// ─── CSV Import ──────────────────────────────────────────────────────

export interface CsvImportRow {
  rollNo: string
  studentName: string
  marksObtained: number | null
  status: MarkStatus
  remarks?: string
}

export interface CsvImportResult {
  accepted: number
  rejected: number
  errors: Array<{ row: number; message: string }>
  applied: Array<{ studentId: string; studentName: string; marks: number | null; status: MarkStatus }>
}

export async function importMarksCsv(
  examId: string,
  classId: string,
  subjectId: string,
  schoolId: string,
  user: AuthUserLike | null,
  rows: CsvImportRow[]
): Promise<CsvImportResult> {
  const exam = await db.exam.findFirst({
    where: { id: examId, schoolId },
    include: {
      examSubjects: { where: { classId, subjectId }, include: { subject: true } },
      examClasses: { include: { class: true } },
    },
  })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared') {
    throw new Error('Cannot import marks after results are declared')
  }

  // ── IQ3000 Phase 8 — CSA scope for TEACHER (audit 3-b HIGH) ─────────
  // importMarksCsv is a bulk marks-entry channel: a TEACHER may only
  // import for an EXACT (classId, subjectId) paper they are appointed
  // to teach (teacherCanEnterMarks) — the same guard as setMark and
  // /api/teacher/marks-entry/submit. PRINCIPAL/MANAGEMENT hold
  // school-wide authority.
  if (user && user.role === 'TEACHER') {
    const { teacherCanEnterMarks } = await import('@/lib/teacher-scope')
    const allowed = await teacherCanEnterMarks(user, schoolId, classId, subjectId)
    if (!allowed) {
      throw new Error('FORBIDDEN')
    }
  }

  const subjConfig = exam.examSubjects[0]
  if (!subjConfig) throw new Error('Subject not configured for this exam/class')

  // Phase 3 (service-layer bounds, defense BEFORE the DB trigger):
  // every row's marksObtained is validated against the subject config's
  // maxMarks up front — out-of-bounds rows are rejected with a 422-style
  // validation error BEFORE any write (the ExamMark DB bound-guard
  // backstops direct-DB writes).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.status === 'PRESENT' && row.marksObtained !== null) {
      if (row.marksObtained < 0 || row.marksObtained > subjConfig.maxMarks) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Row ${i + 2}: marks must be between 0 and ${subjConfig.maxMarks}`,
          internalDetail: `importMarksCsv: row ${i + 2} marks ${row.marksObtained} out of bounds (max ${subjConfig.maxMarks})`,
        })
      }
    }
  }

  const classLink = exam.examClasses.find((ec) => ec.classId === classId)
  if (!classLink) throw new Error('Class not in this exam')

  // Get real students
  const students = await db.student.findMany({
    where: { classId, schoolId },
    include: { user: { select: { name: true } } },
  })

  const result: CsvImportResult = {
    accepted: 0, rejected: 0,
    errors: [], applied: [],
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // header is row 1
    if (!row.rollNo || !row.rollNo.trim()) {
      result.errors.push({ row: rowNum, message: 'Roll number is required' })
      result.rejected++
      continue
    }

    const student = students.find((s) => s.rollNo === row.rollNo.trim())
    if (!student) {
      result.errors.push({ row: rowNum, message: `No student with roll number "${row.rollNo}" in this class` })
      result.rejected++
      continue
    }

    // Validate marks
    if (row.status === 'PRESENT' && row.marksObtained !== null) {
      if (row.marksObtained < 0) {
        result.errors.push({ row: rowNum, message: `Negative marks for "${row.rollNo}"` })
        result.rejected++
        continue
      }
      if (row.marksObtained > subjConfig.maxMarks) {
        result.errors.push({ row: rowNum, message: `Marks ${row.marksObtained} exceeds max ${subjConfig.maxMarks}` })
        result.rejected++
        continue
      }
    }

    // Apply via upsert (preserve existing workflowStatus)
    const existing = await db.examMark.findUnique({
      where: {
        examId_classId_subjectId_studentId: {
          examId, classId, subjectId, studentId: student.id,
        },
      },
    })
    if (existing?.workflowStatus === 'LOCKED') {
      result.errors.push({ row: rowNum, message: `Mark for "${row.rollNo}" is locked` })
      result.rejected++
      continue
    }

    await db.examMark.upsert({
      where: {
        examId_classId_subjectId_studentId: {
          examId, classId, subjectId, studentId: student.id,
        },
      },
      create: {
        examId, classId, subjectId, studentId: student.id,
        marksObtained: row.status === 'PRESENT' ? row.marksObtained : null,
        status: row.status,
        workflowStatus: 'DRAFT',
        originalMarks: row.status === 'PRESENT' ? row.marksObtained : null,
        remarks: row.remarks ?? null,
        enteredBy: user?.id ?? null,
        enteredAt: new Date(),
      },
      update: {
        marksObtained: row.status === 'PRESENT' ? row.marksObtained : null,
        status: row.status,
        remarks: row.remarks ?? existing?.remarks ?? null,
        enteredBy: user?.id ?? null,
        enteredAt: new Date(),
        ...(existing?.workflowStatus === 'SUBMITTED' ? { workflowStatus: 'DRAFT' as const } : {}),
      },
    })

    result.applied.push({
      studentId: student.id,
      studentName: student.user?.name ?? '',
      marks: row.marksObtained,
      status: row.status,
    })
    result.accepted++
  }

  await audit(examId, user, 'MARKS_IMPORTED_CSV', 'MARK', null, null, {
    classId, subjectId, total: rows.length, accepted: result.accepted, rejected: result.rejected,
  })

  return result
}

// ─── Result Publication ──────────────────────────────────────────────

export async function publishResults(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  options: { notifyStudents?: boolean; notifyParents?: boolean } = {}
): Promise<{ published: boolean; notificationsSent: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus !== 'Result Declared') {
    throw new Error('Results must be declared before publishing')
  }

  let notificationsSent = 0
  if (options.notifyStudents || options.notifyParents) {
    // Notification is a school-wide broadcast model (audience-scoped, with
    // per-user read acks) — N per-student rows were N duplicates of the
    // SAME announcement spamming every student's bell N times. Verified no
    // client depends on per-student rows (the publish toast only reads the
    // count). ONE 'STUDENTS' row (+ optionally ONE 'PARENTS' row) carries
    // the same reach; notificationsSent reports the distinct students
    // covered so the "N students notified" copy stays truthful.
    const examClasses = await db.examClass.findMany({
      where: { examId },
      include: {
        // Student.userId is non-nullable — every roster student carries an
        // account, so the reach is simply the distinct roster size.
        class: { include: { students: { select: { id: true } } } },
      },
    })
    const studentReach = new Set(
      examClasses.flatMap((ec) => ec.class.students.map((s) => s.id)),
    ).size

    if (options.notifyStudents) {
      await db.notification.create({
        data: {
          schoolId,
          title: `${exam.name} Results Published`,
          message: `Your results for ${exam.name} are now available. Please check the portal.`,
          audience: 'STUDENTS',
          priority: 'HIGH',
          senderId: user?.id ?? null,
        },
      })
    }
    if (options.notifyParents) {
      await db.notification.create({
        data: {
          schoolId,
          title: `${exam.name} Results Published`,
          message: `Results for ${exam.name} are now available. Please check the parent portal.`,
          audience: 'PARENTS',
          priority: 'HIGH',
          senderId: user?.id ?? null,
        },
      })
    }
    notificationsSent = studentReach
  }
  await audit(examId, user, 'RESULT_PUBLISHED', 'EXAM', examId, null, options)
  return { published: true, notificationsSent }
}
