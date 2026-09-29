// ──────────────────────────────────────────────────────────────────────
// Server-side examination service — single source of truth for all
// exam CRUD, marks workflow, result computation, and audit logging.
// All Prisma reads/writes go through this module.
// ──────────────────────────────────────────────────────────────────────

import 'server-only'
import { db, trackedTransaction } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import {
  type ExamDTO,
  type ExamSubjectConfigDTO,
  type ExamClassDTO,
  type ScheduleItemDTO,
  type StudentDTO,
  type ExamMarkDTO,
  type CreateExamInput,
  type SetMarkInput,
  type AuditLogDTO,
  type MarkStatus,
  type WorkflowStatus,
  type ExamAnalyticsDTO,
  type AuthUserLike,
  EXAM_STATUSES,
} from './types'
import { computeAnalytics, computeAllResults } from './result-engine'
import type { StudentResult } from './types'

// ─── DTO mapping helpers ─────────────────────────────────────────────

export function toSubjectConfigDTO(s: any): ExamSubjectConfigDTO {
  return {
    id: s.id,
    examId: s.examId,
    classId: s.classId,
    subjectId: s.subjectId,
    subjectName: s.subject?.name ?? '',
    subjectCode: s.subject?.code ?? null,
    maxMarks: s.maxMarks,
    passMarks: s.passMarks,
    theoryMarks: s.theoryMarks,
    practicalMarks: s.practicalMarks,
    sortOrder: s.sortOrder ?? 0,
  }
}

export function toExamClassDTO(ec: any): ExamClassDTO {
  return {
    id: ec.id,
    examId: ec.examId,
    classId: ec.classId,
    className: ec.class?.name ?? '',
    gradeLevel: ec.class?.gradeLevel ?? null,
    section: ec.class?.section ?? null,
    stream: ec.class?.stream ?? null,
    studentCount: ec.class?._count?.students ?? 0,
  }
}

export function toScheduleDTO(s: any): ScheduleItemDTO {
  return {
    id: s.id,
    examId: s.examId,
    classId: s.classId,
    className: s.class?.name ?? '',
    subjectId: s.subjectId,
    subjectName: s.subject?.name ?? '',
    date: s.date ? new Date(s.date).toISOString().split('T')[0] : '',
    startTime: s.startTime,
    endTime: s.endTime,
    room: s.room,
    invigilatorId: s.invigilatorId,
    invigilatorName: s.invigilatorName,
  }
}

export function toMarkDTO(m: any): ExamMarkDTO {
  return {
    id: m.id,
    examId: m.examId,
    classId: m.classId,
    subjectId: m.subjectId,
    studentId: m.studentId,
    studentName: m.student?.user?.name ?? '',
    studentRollNo: m.student?.rollNo ?? null,
    marksObtained: m.marksObtained,
    status: m.status as MarkStatus,
    workflowStatus: m.workflowStatus as WorkflowStatus,
    originalMarks: m.originalMarks,
    graceMarks: m.graceMarks ?? 0,
    graceReason: m.graceReason,
    remarks: m.remarks,
    enteredBy: m.enteredBy,
    enteredAt: m.enteredAt ? m.enteredAt.toISOString() : null,
    verifiedBy: m.verifiedBy,
    verifiedAt: m.verifiedAt ? m.verifiedAt.toISOString() : null,
    lockedBy: m.lockedBy,
  }
}

function toExamDTO(e: any): ExamDTO {
  const marks = e.marks ?? []
  const total = marks.length
  const entered = marks.filter((m: any) => m.marksObtained !== null || m.status !== 'PRESENT').length
  const locked = marks.filter((m: any) => m.workflowStatus === 'LOCKED').length
  const submitted = marks.filter((m: any) => m.workflowStatus === 'SUBMITTED').length
  const verified = marks.filter((m: any) => m.workflowStatus === 'VERIFIED').length
  return {
    id: e.id,
    schoolId: e.schoolId,
    name: e.name,
    type: e.type ?? 'Unit Test',
    session: e.session ?? '2025-2026',
    term: e.term ?? null,
    status: e.status ?? 'Draft',
    resultStatus: e.resultStatus ?? 'Not Started',
    passPercentage: e.passPercentage ?? 33,
    startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : null,
    endDate: e.endDate ? new Date(e.endDate).toISOString().split('T')[0] : null,
    declaredAt: e.declaredAt ? e.declaredAt.toISOString() : null,
    declaredBy: e.declaredBy,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    classes: (e.examClasses ?? []).map(toExamClassDTO),
    subjects: (e.examSubjects ?? []).map(toSubjectConfigDTO),
    schedule: (e.scheduleItems ?? []).map(toScheduleDTO),
    markSummary: {
      total,
      entered,
      locked,
      submitted,
      verified,
      pct: total > 0 ? Math.round((entered / total) * 100) : 0,
    },
  }
}

// ─── Audit logging ────────────────────────────────────────────────────

export async function audit(
  examId: string,
  user: AuthUserLike | null,
  action: string,
  entity: string | null = null,
  entityId: string | null = null,
  oldValue: unknown = null,
  newValue: unknown = null
) {
  try {
    await db.examAuditLog.create({
      data: {
        examId,
        userId: user?.id ?? null,
        userName: user?.name ?? null,
        action,
        entity,
        entityId,
        oldValue: oldValue ? JSON.stringify(oldValue) : null,
        newValue: newValue ? JSON.stringify(newValue) : null,
      },
    })
  } catch (err) {
    console.error('audit log failed', err)
  }
}

// ─── Read operations ──────────────────────────────────────────────────

const EXAM_INCLUDE = {
  examClasses: { include: { class: { include: { _count: { select: { students: true } } } } } },
  examSubjects: { include: { subject: true } },
  scheduleItems: { include: { class: true, subject: true } },
  marks: true,
}

export async function listExams(schoolId: string): Promise<ExamDTO[]> {
  const exams = await db.exam.findMany({
    where: { schoolId },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    include: EXAM_INCLUDE,
  })
  return exams.map(toExamDTO)
}

export async function getExam(examId: string, schoolId: string): Promise<ExamDTO | null> {
  const exam = await db.exam.findFirst({
    where: { id: examId, schoolId },
    include: EXAM_INCLUDE,
  })
  if (!exam) return null
  return toExamDTO(exam)
}

export async function getClasses(schoolId: string) {
  // Spec §26/§42: Students & Classes is the source of truth for subjects.
  // We read from ClassSubjectAssignment (the canonical class→subject mapping),
  // JOINed to Subject (the canonical identity). This replaces the legacy
  // direct Class.subjects relation, which was class-scoped and led to
  // duplicate subject identities.
  const classes = await db.class.findMany({
    where: { schoolId },
    include: {
      subjectAssignments: {
        where: { isActive: true },
        include: {
          subject: {
            select: {
              id: true,
              name: true,
              code: true,
              fullMarks: true,
              passMarks: true,
              status: true,
            },
          },
        },
        orderBy: { displayOrder: 'asc' },
      },
      _count: { select: { students: true } },
    },
  })
  // Sort numerically by gradeLevel, then by stream
  const sorted = classes.sort((a, b) => {
    const ga = parseInt(a.gradeLevel ?? '0', 10)
    const gb = parseInt(b.gradeLevel ?? '0', 10)
    if (ga !== gb) return ga - gb
    return (a.stream ?? '').localeCompare(b.stream ?? '')
  })
  return sorted.map((c) => ({
    id: c.id,
    name: c.name,
    gradeLevel: c.gradeLevel,
    section: c.section,
    stream: c.stream,
    studentCount: c._count.students,
    // Spec §18: only Active subjects appear in new exam creation.
    // Archived subjects remain queryable for historical records but are
    // excluded here.
    subjects: c.subjectAssignments
      .filter((a) => a.subject.status === 'Active')
      .map((a) => ({
        id: a.subject.id,
        name: a.subject.name,
        code: a.subject.code,
        fullMarks: a.subject.fullMarks ?? 100,
        passMarks: a.subject.passMarks ?? 33,
        isCore: a.isCore,
        examinable: a.examinable,
        displayOrder: a.displayOrder,
      })),
  }))
}

export async function getStudentsForClass(classId: string, schoolId: string): Promise<StudentDTO[]> {
  const students = await db.student.findMany({
    where: { classId, schoolId },
    orderBy: { rollNo: 'asc' },
    include: { user: { select: { name: true, email: true } } },
  })
  return students.map((s) => ({
    id: s.id,
    rollNo: s.rollNo,
    admissionNo: s.admissionNo,
    name: s.user?.name ?? '',
    classId: s.classId,
  }))
}

export async function getMarks(examId: string, schoolId: string): Promise<ExamMarkDTO[]> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId }, select: { id: true } })
  if (!exam) return []
  const marks = await db.examMark.findMany({
    where: { examId },
    include: { student: { include: { user: { select: { name: true } } } } },
  })
  return marks.map(toMarkDTO)
}

export async function getMarksForSubject(
  examId: string,
  classId: string,
  subjectId: string,
  schoolId: string
): Promise<ExamMarkDTO[]> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId }, select: { id: true } })
  if (!exam) return []
  const marks = await db.examMark.findMany({
    where: { examId, classId, subjectId },
    include: { student: { include: { user: { select: { name: true } } } } },
  })
  return marks.map(toMarkDTO)
}

export async function getAuditLogs(examId: string, schoolId: string): Promise<AuditLogDTO[]> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId }, select: { id: true } })
  if (!exam) return []
  const logs = await db.examAuditLog.findMany({
    where: { examId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return logs.map((l) => ({
    id: l.id,
    examId: l.examId,
    userId: l.userId,
    userName: l.userName,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    oldValue: l.oldValue,
    newValue: l.newValue,
    createdAt: l.createdAt.toISOString(),
  }))
}

// ─── Create Exam ──────────────────────────────────────────────────────

export async function createExam(
  schoolId: string,
  user: AuthUserLike | null,
  input: CreateExamInput
): Promise<ExamDTO> {
  if (!input.name?.trim()) throw new Error('Examination name is required')
  if (input.classIds.length === 0) throw new Error('At least one class is required')

  // Spec §37: Server-side past date validation (frontend min=today is not enough)
  // Start date must be today or future; End date must be on/after start date.
  if (input.startDate) {
    const start = new Date(input.startDate)
    start.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (start.getTime() < today.getTime()) {
      throw new Error('Examination start date cannot be in the past')
    }
  }
  if (input.startDate && input.endDate) {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)
    if (end.getTime() < start.getTime()) {
      throw new Error('Examination end date cannot be before the start date')
    }
  }

  // Validate classes belong to school
  const validClasses = await db.class.findMany({
    where: { id: { in: input.classIds }, schoolId },
    select: { id: true, name: true },
  })
  if (validClasses.length !== input.classIds.length) {
    throw new Error('One or more classes not found in this school')
  }

  // Validate subjects exist + are assigned to the class via ClassSubjectAssignment.
  // Spec §19/§26: subjects are canonical; class membership is through assignments.
  // The legacy Subject.classId column is no longer authoritative.
  for (const classId of input.classIds) {
    const subjects = input.subjectsByClass[classId] ?? []
    if (subjects.length === 0) throw new Error(`No subjects selected for class ${validClasses.find((c) => c.id === classId)?.name}`)
    const subjectIds = subjects.map((s) => s.subjectId)
    // Check that each subjectId is assigned to this class via ClassSubjectAssignment.
    const assignments = await db.classSubjectAssignment.findMany({
      where: { classId, subjectId: { in: subjectIds }, isActive: true },
      select: { subjectId: true },
    })
    const assignedIds = new Set(assignments.map((a) => a.subjectId))
    const missing = subjectIds.filter((id) => !assignedIds.has(id))
    if (missing.length > 0) {
      throw new Error(`One or more subjects not found for the selected class (ClassSubjectAssignment check failed for: ${missing.join(', ')})`)
    }
  }

  // Phase 3 — the exam create, schedule-item creates and mark seeding
  // are ONE $transaction (was: exam create, then N sequential
  // examScheduleItem.create + C + S×M sequential examMark.upsert ≈ 2.8k
  // queries/request — a crash mid-way left an exam with a partial roster).
  // Mark seeding is now: ONE roster findMany + ONE examMark.createMany
  // (the exam is brand-new — no mark rows exist yet, so createMany is safe
  // and the composite unique backstops any duplicate).
  const exam = await trackedTransaction('exam-create', async (tx) => {
    const created = await tx.exam.create({
      data: {
        schoolId,
        name: input.name.trim(),
        type: input.type,
        session: input.session ?? '2025-2026',
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        status: 'Draft',
        resultStatus: 'Not Started',
        passPercentage: input.passPercentage ?? 33,
        createdBy: user?.id ?? null,
        examClasses: {
          create: input.classIds.map((classId) => ({ classId })),
        },
        examSubjects: {
          create: input.classIds.flatMap((classId) =>
            (input.subjectsByClass[classId] ?? []).map((s, idx) => ({
              classId,
              subjectId: s.subjectId,
              maxMarks: s.maxMarks ?? 100,
              passMarks: s.passMarks ?? 33,
              theoryMarks: s.theoryMarks ?? s.maxMarks ?? 100,
              practicalMarks: s.practicalMarks ?? 0,
              sortOrder: idx,
            }))
          ),
        },
      },
    })

    // Create schedule items if provided (single createMany inside the tx).
    if (input.schedule && input.schedule.length > 0) {
      await tx.examScheduleItem.createMany({
        data: input.schedule.map((item) => ({
          examId: created.id,
          classId: item.classId,
          subjectId: item.subjectId,
          date: new Date(item.date),
          startTime: item.startTime,
          endTime: item.endTime,
          room: item.room ?? null,
          invigilatorName: item.invigilatorName ?? null,
        })),
      })
    }

    // Auto-create empty ExamMark rows for every student in every
    // class × subject — ONE roster query + ONE createMany.
    const roster = await tx.student.findMany({
      where: { classId: { in: input.classIds }, schoolId },
      select: { id: true, classId: true },
    })
    const markRows: Array<{
      examId: string
      classId: string
      subjectId: string
      studentId: string
      marksObtained: null
      status: string
      workflowStatus: string
    }> = []
    for (const student of roster) {
      if (!student.classId) continue
      for (const subject of input.subjectsByClass[student.classId] ?? []) {
        markRows.push({
          examId: created.id,
          classId: student.classId,
          subjectId: subject.subjectId,
          studentId: student.id,
          marksObtained: null,
          status: 'PRESENT',
          workflowStatus: 'DRAFT',
        })
      }
    }
    if (markRows.length > 0) {
      await tx.examMark.createMany({ data: markRows })
    }

    return created
  })

  await audit(exam.id, user, 'EXAM_CREATED', 'EXAM', exam.id, null, { name: exam.name, type: exam.type })

  const fresh = await db.exam.findUnique({ where: { id: exam.id }, include: EXAM_INCLUDE })
  return toExamDTO(fresh!)
}

// ─── Update / Delete Exam ─────────────────────────────────────────────

export async function updateExam(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  updates: { name?: string; type?: string; session?: string; startDate?: string; endDate?: string; status?: string; passPercentage?: number }
): Promise<ExamDTO> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')

  // Whitelist status (audit 3-b LOW): status is a free string today —
  // only the canonical ExamStatus lifecycle values are accepted.
  if (updates.status !== undefined && !(EXAM_STATUSES as readonly string[]).includes(updates.status)) {
    throw new AppError('INVALID_INPUT', {
      publicMessage: `Invalid exam status "${updates.status}" — allowed: ${EXAM_STATUSES.join(', ')}`,
      internalDetail: `updateExam: rejected status "${updates.status}"`,
    })
  }

  // Spec §37: server-side date validation on update too.
  // Merge pending updates onto existing exam dates so partial patches are validated correctly.
  const effectiveStart = updates.startDate !== undefined ? updates.startDate : (exam.startDate?.toISOString().split('T')[0] ?? null)
  const effectiveEnd = updates.endDate !== undefined ? updates.endDate : (exam.endDate?.toISOString().split('T')[0] ?? null)
  // Only validate past-start-date for Draft exams — Published/Archived exams may keep historical dates.
  if (exam.status === 'Draft' && effectiveStart) {
    const start = new Date(effectiveStart)
    start.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (start.getTime() < today.getTime()) {
      throw new Error('Examination start date cannot be in the past')
    }
  }
  if (effectiveStart && effectiveEnd) {
    const start = new Date(effectiveStart)
    const end = new Date(effectiveEnd)
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)
    if (end.getTime() < start.getTime()) {
      throw new Error('Examination end date cannot be before the start date')
    }
  }

  const oldSnapshot = { name: exam.name, type: exam.type, status: exam.status, resultStatus: exam.resultStatus }
  const updated = await db.exam.update({
    where: { id: examId },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.type !== undefined ? { type: updates.type } : {}),
      ...(updates.session !== undefined ? { session: updates.session } : {}),
      ...(updates.startDate !== undefined ? { startDate: updates.startDate ? new Date(updates.startDate) : null } : {}),
      ...(updates.endDate !== undefined ? { endDate: updates.endDate ? new Date(updates.endDate) : null } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.passPercentage !== undefined ? { passPercentage: updates.passPercentage } : {}),
    },
    include: EXAM_INCLUDE,
  })
  await audit(examId, user, 'EXAM_UPDATED', 'EXAM', examId, oldSnapshot, {
    name: updates.name,
    type: updates.type,
    status: updates.status,
  })
  return toExamDTO(updated)
}

export async function deleteExam(examId: string, schoolId: string, _user: AuthUserLike | null): Promise<void> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  // Phase 3 — declared results are auditable history: the exam (and its
  // cascading marks/results rows) must survive for report cards and
  // compliance. Refuse with 409 CONFLICT — archive instead.
  if (exam.resultStatus === 'Result Declared') {
    throw new AppError('CONFLICT', {
      publicMessage:
        'Results for this examination have been declared — it is part of the auditable academic record and cannot be deleted. Archive it instead.',
      internalDetail: `deleteExam: exam ${examId} resultStatus=Result Declared`,
    })
  }
  await db.exam.delete({ where: { id: examId } })
  // Audit log is deleted with cascade — but record to an external log if needed.
}

// ─── Schedule management ──────────────────────────────────────────────

/** Convert "HH:MM" to minutes-since-midnight for overlap checks. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** True if two [start,end) intervals overlap. */
function timeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = timeToMinutes(aStart), aE = timeToMinutes(aEnd)
  const bS = timeToMinutes(bStart), bE = timeToMinutes(bEnd)
  return aS < bE && bS < aE
}

export async function addScheduleItem(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  data: {
    classId: string
    subjectId: string
    date: string
    startTime: string
    endTime: string
    room?: string
    invigilatorName?: string
  }
): Promise<ScheduleItemDTO> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (!data.subjectId) throw new Error('Subject is required')
  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    throw new Error('End time must be after start time')
  }

  // ── Tenant + membership guards (audit 3-b HIGH): mirror createExam ──
  // classId/subjectId come from the client. Both must exist in the
  // CALLER's school, the class must be part of THIS exam, and the
  // subject must be configured for that class in THIS exam —
  // otherwise a foreign school's class/subject gets linked into this
  // school's schedule (and the schedule DTOs leak their names).
  const cls = await db.class.findFirst({
    where: { id: data.classId, schoolId },
    select: { id: true },
  })
  if (!cls) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Class not found in this school',
      internalDetail: `addScheduleItem: class ${data.classId} missing or foreign tenant`,
    })
  }
  const subject = await db.subject.findFirst({
    where: { id: data.subjectId, schoolId },
    select: { id: true },
  })
  if (!subject) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Subject not found in this school',
      internalDetail: `addScheduleItem: subject ${data.subjectId} missing or foreign tenant`,
    })
  }
  const examClassLink = await db.examClass.findFirst({
    where: { examId, classId: data.classId },
    select: { id: true },
  })
  if (!examClassLink) throw new Error('Class is not part of this examination')
  const subjectConfig = await db.examSubjectConfig.findFirst({
    where: { examId, classId: data.classId, subjectId: data.subjectId },
    select: { id: true },
  })
  if (!subjectConfig) throw new Error('Subject is not configured for this exam/class')

  // Overlap-aware conflict detection — fetch existing items on same date and check overlap.
  const sameDateItems = await db.examScheduleItem.findMany({
    where: { examId, date: new Date(data.date) },
  })
  const roomTrim = data.room?.trim() ?? ''
  const invTrim = data.invigilatorName?.trim() ?? ''
  for (const it of sameDateItems) {
    const overlapsTime = timeOverlaps(data.startTime, data.endTime, it.startTime, it.endTime)
    if (!overlapsTime) continue
    if (it.classId === data.classId) {
      throw new Error('Schedule conflict: this class already has an exam at this time')
    }
    if (roomTrim && it.room && it.room === roomTrim) {
      throw new Error(`Schedule conflict: room "${roomTrim}" already booked at this time`)
    }
    if (invTrim && it.invigilatorName && it.invigilatorName === invTrim) {
      throw new Error(`Schedule conflict: ${invTrim} is already invigilating another exam at this time`)
    }
  }

  const item = await db.examScheduleItem.create({
    data: {
      examId,
      classId: data.classId,
      subjectId: data.subjectId,
      date: new Date(data.date),
      startTime: data.startTime,
      endTime: data.endTime,
      room: roomTrim || null,
      invigilatorName: invTrim || null,
    },
    include: { class: true, subject: true },
  })

  // Auto-transition: Draft → Scheduled when the first schedule item is added
  if (exam.status === 'Draft') {
    await db.exam.update({ where: { id: examId }, data: { status: 'Scheduled' } })
  }

  await audit(examId, user, 'SCHEDULE_ADDED', 'SCHEDULE', item.id, null, data)
  return toScheduleDTO(item)
}

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
    invigilatorName?: string
  }
): Promise<ScheduleItemDTO> {
  const item = await db.examScheduleItem.findFirst({
    where: { id: itemId, examId },
    include: { exam: true },
  })
  if (!item || item.exam.schoolId !== schoolId) throw new Error('Schedule item not found')
  const updated = await db.examScheduleItem.update({
    where: { id: itemId },
    data: {
      ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
      ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
      ...(data.room !== undefined ? { room: data.room } : {}),
      ...(data.invigilatorName !== undefined ? { invigilatorName: data.invigilatorName } : {}),
    },
    include: { class: true, subject: true },
  })
  await audit(examId, user, 'SCHEDULE_UPDATED', 'SCHEDULE', itemId, item, data)
  return toScheduleDTO(updated)
}

export async function deleteScheduleItem(
  examId: string,
  itemId: string,
  schoolId: string,
  user: AuthUserLike | null
): Promise<void> {
  const item = await db.examScheduleItem.findFirst({
    where: { id: itemId, examId },
    include: { exam: true },
  })
  if (!item || item.exam.schoolId !== schoolId) throw new Error('Schedule item not found')
  await db.examScheduleItem.delete({ where: { id: itemId } })
  await audit(examId, user, 'SCHEDULE_DELETED', 'SCHEDULE', itemId, toScheduleDTO(item), null)
}

// ─── Marks management ─────────────────────────────────────────────────

export async function setMark(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  input: SetMarkInput
): Promise<ExamMarkDTO> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared') {
    throw new Error('Cannot modify marks after results are declared')
  }

  // ── IQ3000 Phase 8 — assignment-driven marks authorization ──────────
  // PRINCIPAL/MANAGEMENT hold school-wide authority. A TEACHER must be
  // APPOINTED to teach this (class, subject) — the class-teacher role
  // alone does NOT grant subject marks entry. Server-side enforcement:
  // the client's picker restriction is never trusted.
  if (user && user.role === 'TEACHER') {
    const { teacherCanEnterMarks } = await import('@/lib/teacher-scope')
    const allowed = await teacherCanEnterMarks(user, schoolId, input.classId, input.subjectId)
    if (!allowed) {
      throw new Error('You are not appointed to teach this subject for this class — marks entry is not permitted.')
    }
  }

  // Validate marks against max
  const subjectConfig = await db.examSubjectConfig.findFirst({
    where: { examId, classId: input.classId, subjectId: input.subjectId },
  })
  if (!subjectConfig) throw new Error('Subject not configured for this exam/class')

  // ── Tenant guard (audit 3-b HIGH): FK-in-tenant validation ──────────
  // The studentId comes from the client. Before ANY ExamMark row is
  // written, the student must exist in the CALLER's school AND sit in
  // the given class — otherwise a foreign school's student could be
  // linked into this school's exam (and the mark DTOs would leak their
  // name to every reader). Foreign ids 404: no existence oracle.
  const student = await db.student.findFirst({
    where: {
      id: input.studentId,
      schoolId,
      ...(input.classId ? { classId: input.classId } : {}),
    },
    select: { id: true },
  })
  if (!student) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Student not found',
      internalDetail: `setMark: student ${input.studentId} missing or foreign tenant`,
    })
  }

  const max = subjectConfig.maxMarks
  // Phase 3 (service-layer bounds, defense BEFORE the DB trigger):
  // 422-style validation error — the ExamMark DB bound-guard backstops
  // direct-DB writes.
  if (input.status === 'PRESENT' && input.marksObtained !== null) {
    if (input.marksObtained < 0) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Marks cannot be negative',
        internalDetail: `setMark: negative marks ${input.marksObtained}`,
      })
    }
    if (input.marksObtained > max) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Marks cannot exceed maximum (${max})`,
        internalDetail: `setMark: marks ${input.marksObtained} > max ${max}`,
      })
    }
  }
  if (input.status !== 'PRESENT' && input.marksObtained !== null && input.marksObtained !== 0) {
    // For ABSENT/MEDICAL/EXEMPTED we typically store null; coerce
    input.marksObtained = null
  }

  const existing = await db.examMark.findUnique({
    where: {
      examId_classId_subjectId_studentId: {
        examId,
        classId: input.classId,
        subjectId: input.subjectId,
        studentId: input.studentId,
      },
    },
  })

  // If mark is already LOCKED, cannot modify without override flow
  if (existing?.workflowStatus === 'LOCKED') {
    throw new Error('Mark is locked. Use the unlock/reopen workflow to modify.')
  }
  if (existing?.workflowStatus === 'VERIFIED' && user?.role !== 'PRINCIPAL' && user?.role !== 'MANAGEMENT') {
    throw new Error('Verified marks can only be modified by Principal')
  }

  const oldValue = existing ? {
    marksObtained: existing.marksObtained,
    status: existing.status,
  } : null

  // Preserve workflow status if already SUBMITTED/VERIFIED — but updates after submission
  // remain allowed for teachers only if not yet LOCKED.
  const updated = await db.examMark.upsert({
    where: {
      examId_classId_subjectId_studentId: {
        examId,
        classId: input.classId,
        subjectId: input.subjectId,
        studentId: input.studentId,
      },
    },
    create: {
      examId,
      classId: input.classId,
      subjectId: input.subjectId,
      studentId: input.studentId,
      marksObtained: input.status === 'PRESENT' ? input.marksObtained : null,
      status: input.status,
      workflowStatus: 'DRAFT',
      originalMarks: input.status === 'PRESENT' ? input.marksObtained : null,
      remarks: input.remarks ?? null,
      enteredBy: user?.id ?? null,
      enteredAt: new Date(),
    },
    update: {
      marksObtained: input.status === 'PRESENT' ? input.marksObtained : null,
      status: input.status,
      remarks: input.remarks ?? existing?.remarks ?? null,
      enteredBy: user?.id ?? existing?.enteredBy ?? null,
      enteredAt: new Date(),
      // If reverting from SUBMITTED to DRAFT (any edit), allow it
      ...(existing?.workflowStatus === 'SUBMITTED' ? { workflowStatus: 'DRAFT' as const } : {}),
    },
    include: { student: { include: { user: { select: { name: true } } } } },
  })

  // Auto-transition: Scheduled → Ongoing when the first mark is entered
  if (exam.status === 'Scheduled') {
    await db.exam.update({ where: { id: examId }, data: { status: 'Ongoing' } })
  }
  // Update exam resultStatus to "Marks Entry" if it was "Not Started"
  if (exam.resultStatus === 'Not Started') {
    await db.exam.update({ where: { id: examId }, data: { resultStatus: 'Marks Entry' } })
  }

  await audit(examId, user, 'MARK_ENTERED', 'MARK', updated.id, oldValue, {
    marksObtained: updated.marksObtained,
    status: updated.status,
  })
  return toMarkDTO(updated)
}

export interface BatchRowError {
  /** Index of the offending row inside the submitted marks[] array. */
  index: number
  /** Student id (when the row carried one) — for client-side row surfacing. */
  studentId: string | null
  /** Safe, human-readable reason the row was rejected. */
  message: string
}

export async function setMarksBatch(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  marks: SetMarkInput[]
): Promise<{ updated: number; errors: BatchRowError[] }> {
  // ── Pre-validation (audit 3-b HIGH): the WHOLE batch is checked ONCE ──
  // against the caller's school roster before any write. Rows whose
  // studentId is not a student of this school (in the row's own class)
  // are rejected with a per-row error — never silently skipped, never
  // cross-tenant-linked into ExamMark.
  const errors: BatchRowError[] = []
  const classIds = [...new Set(marks.map((m) => m.classId).filter((id): id is string => Boolean(id)))]
  const rosterByClass = new Map<string, Set<string>>()
  if (classIds.length > 0) {
    const roster = await db.student.findMany({
      where: { schoolId, classId: { in: classIds } },
      select: { id: true, classId: true },
    })
    for (const s of roster) {
      // classId is nullable on the model but the query above filters
      // `classId IN (…)` so it is guaranteed present here.
      if (!s.classId) continue
      const set = rosterByClass.get(s.classId) ?? new Set<string>()
      set.add(s.id)
      rosterByClass.set(s.classId, set)
    }
  }
  const validRows: Array<{ index: number; m: SetMarkInput }> = []
  marks.forEach((m, index) => {
    const roster = rosterByClass.get(m.classId)
    if (!roster || !m.studentId || !roster.has(m.studentId)) {
      errors.push({
        index,
        studentId: m.studentId ?? null,
        message: 'Student not found in this class',
      })
      return
    }
    validRows.push({ index, m })
  })

  let updated = 0
  for (const { index, m } of validRows) {
    try {
      await setMark(examId, schoolId, user, m)
      updated++
    } catch (err) {
      // Keep the partial-success shape, but report EVERY rejected row
      // (CSA FORBIDDEN, locked marks, validation, …) instead of
      // swallowing it into a silent { updated: 0 } (audit 3-b MEDIUM).
      const message = err instanceof Error ? err.message : 'Row rejected'
      errors.push({
        index,
        studentId: m.studentId ?? null,
        message: message.length > 200 ? message.slice(0, 200) : message,
      })
    }
  }
  return { updated, errors }
}

export async function submitMarks(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  filter: { classId?: string; subjectId?: string }
): Promise<{ submitted: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared') {
    throw new Error('Cannot modify marks after results are declared')
  }
  // ── IQ3000 Phase 8 — CSA scope for TEACHER (audit 3-b MEDIUM) ────────
  // Mirrors /api/teacher/marks-entry/submit: a teacher may only submit
  // marks for an EXACT (classId, subjectId) paper they are appointed to
  // teach. A partial or empty filter would bulk-submit other teachers'
  // papers school-wide — refused with FORBIDDEN.
  if (user && user.role === 'TEACHER') {
    const { teacherCanEnterMarks } = await import('@/lib/teacher-scope')
    if (!filter.classId || !filter.subjectId) {
      throw new Error('FORBIDDEN')
    }
    const allowed = await teacherCanEnterMarks(user, schoolId, filter.classId, filter.subjectId)
    if (!allowed) {
      throw new Error('FORBIDDEN')
    }
  }
  const result = await db.examMark.updateMany({
    where: {
      examId,
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      workflowStatus: 'DRAFT',
      // Must have either marks entered OR a non-PRESENT status (absent/medical/exempted)
      OR: [
        { marksObtained: { not: null } },
        { status: { not: 'PRESENT' } },
      ],
    },
    data: {
      workflowStatus: 'SUBMITTED',
      enteredBy: user?.id ?? null,
    },
  })
  // Move exam to Under Verification if all marks submitted
  const remainingDrafts = await db.examMark.count({ where: { examId, workflowStatus: 'DRAFT' } })
  if (remainingDrafts === 0) {
    await db.exam.update({ where: { id: examId }, data: { resultStatus: 'Under Verification' } })
  } else {
    await db.exam.update({ where: { id: examId }, data: { resultStatus: 'Marks Entry' } })
  }
  await audit(examId, user, 'MARK_SUBMITTED', 'MARK', null, null, filter)
  return { submitted: result.count }
}

export async function verifyMarks(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  filter: { classId?: string; subjectId?: string }
): Promise<{ verified: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared') {
    throw new Error('Cannot modify marks after results are declared')
  }
  const result = await db.examMark.updateMany({
    where: {
      examId,
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      workflowStatus: 'SUBMITTED',
    },
    data: {
      workflowStatus: 'VERIFIED',
      verifiedBy: user?.id ?? null,
      verifiedAt: new Date(),
    },
  })
  const remainingSubmitted = await db.examMark.count({ where: { examId, workflowStatus: 'SUBMITTED' } })
  if (remainingSubmitted === 0) {
    const remainingDrafts = await db.examMark.count({ where: { examId, workflowStatus: 'DRAFT' } })
    if (remainingDrafts === 0) {
      await db.exam.update({ where: { id: examId }, data: { resultStatus: 'Result Ready' } })
    }
  }
  await audit(examId, user, 'MARK_VERIFIED', 'MARK', null, null, filter)
  return { verified: result.count }
}

export async function lockMarks(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null,
  filter: { classId?: string; subjectId?: string }
): Promise<{ locked: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus === 'Result Declared') {
    throw new Error('Cannot modify marks after results are declared')
  }
  // Lock everything matching filter (DRAFT/SUBMITTED/VERIFIED → LOCKED)
  const result = await db.examMark.updateMany({
    where: {
      examId,
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      workflowStatus: { in: ['DRAFT', 'SUBMITTED', 'VERIFIED'] },
    },
    data: {
      workflowStatus: 'LOCKED',
      lockedBy: user?.id ?? null,
    },
  })
  await db.exam.update({ where: { id: examId }, data: { resultStatus: 'Result Ready' } })
  await audit(examId, user, 'MARK_LOCKED', 'MARK', null, null, filter)
  return { locked: result.count }
}

// ─── Results ──────────────────────────────────────────────────────────

export async function getResultsForClass(
  examId: string,
  classId: string,
  schoolId: string
): Promise<{ students: StudentDTO[]; subjects: ExamSubjectConfigDTO[]; marks: ExamMarkDTO[]; results: StudentResult[]; analytics: ExamAnalyticsDTO }> {
  const exam = await db.exam.findFirst({
    where: { id: examId, schoolId },
    include: {
      examSubjects: { include: { subject: true }, where: { classId } },
      marks: { where: { classId }, include: { student: { include: { user: { select: { name: true } } } } } },
      examClasses: { include: { class: { include: { _count: { select: { students: true } } } } } },
    },
  })
  if (!exam) throw new Error('Exam not found')
  const cls = exam.examClasses.find((ec) => ec.classId === classId)?.class
  if (!cls) throw new Error('Class not part of this exam')

  // Fetch school-configured grade scale for accurate grading
  const gradeScaleRows = await db.gradeScale.findMany({
    where: { schoolId },
    orderBy: { minPct: 'desc' },
  })
  const gradeScale = gradeScaleRows.map((g) => ({
    grade: g.grade,
    minPct: g.minPct,
    maxPct: g.maxPct,
    color: g.color,
    sortOrder: g.sortOrder,
  }))

  // Get real students of this class
  const students = await db.student.findMany({
    where: { classId, schoolId },
    orderBy: { rollNo: 'asc' },
    include: { user: { select: { name: true } } },
  })

  const studentDTOs: StudentDTO[] = students.map((s) => ({
    id: s.id,
    rollNo: s.rollNo,
    admissionNo: s.admissionNo,
    name: s.user?.name ?? '',
    classId: s.classId,
  }))

  const subjectDTOs = exam.examSubjects.map(toSubjectConfigDTO)
  const markDTOs = exam.marks.map(toMarkDTO)

  const results = computeAllResults({
    students: studentDTOs,
    subjects: subjectDTOs,
    marks: markDTOs,
    passPercentage: exam.passPercentage,
    gradeScale,
  })
  for (const r of results) r.className = cls.name

  const analytics = computeAnalytics(
    {
      students: studentDTOs,
      subjects: subjectDTOs,
      marks: markDTOs,
      passPercentage: exam.passPercentage,
      gradeScale,
    },
    cls.name
  )

  return { students: studentDTOs, subjects: subjectDTOs, marks: markDTOs, results, analytics }
}

export async function declareResults(
  examId: string,
  schoolId: string,
  user: AuthUserLike | null
): Promise<{ declared: boolean }> {
  const exam = await db.exam.findFirst({ where: { id: examId, schoolId } })
  if (!exam) throw new Error('Exam not found')
  if (exam.resultStatus !== 'Result Ready') {
    throw new Error('Results can only be declared from Result Ready state')
  }
  await db.exam.update({
    where: { id: examId },
    data: {
      resultStatus: 'Result Declared',
      status: 'Completed',
      declaredAt: new Date(),
      declaredBy: user?.id ?? null,
    },
  })
  await audit(examId, user, 'RESULT_DECLARED', 'EXAM', examId, null, null)
  return { declared: true }
}

export type { StudentResult }
