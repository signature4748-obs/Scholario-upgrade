// ──────────────────────────────────────────────────────────────────────
// Homework service — CRUD + submissions + review + analytics + audit.
// All reads/writes go through Prisma. No mock data.
// ──────────────────────────────────────────────────────────────────────

import 'server-only'
import { db } from '@/lib/db'
import type { AuthUser } from '@/lib/auth'
import { AppError } from '@/lib/security/errors'

// ─── DTOs ────────────────────────────────────────────────────────────

export interface HomeworkDTO {
  id: string
  schoolId: string
  title: string
  description: string | null
  classId: string
  className: string
  subjectId: string | null
  subjectName: string | null
  teacherId: string | null
  teacherName: string | null
  topic: string | null
  chapter: string | null
  learningObjective: string | null
  content: string | null
  attachments: Array<{ name: string; url: string; type: string }> | null
  maxMarks: number | null
  gradingType: string
  assignedDate: string
  dueDate: string
  dueTime: string
  status: string
  derivedStatus: string
  allowLateSubmission: boolean
  lateDeadline: string | null
  latePenalty: number
  allowResubmission: boolean
  createdBy: string | null
  createdByName: string | null
  publishedAt: string | null
  closedAt: string | null
  originalDueDate: string | null
  deadlineChangedBy: string | null
  deadlineChangedAt: string | null
  deadlineChangeReason: string | null
  createdAt: string
  updatedAt: string
  submissionSummary: {
    total: number
    submitted: number
    reviewed: number
    late: number
    returned: number
    pending: number
    notStarted: number
  }
}

export interface SubmissionDTO {
  id: string
  homeworkId: string
  studentId: string
  studentName: string
  studentRollNo: string | null
  attemptNumber: number
  status: string
  responseText: string | null
  attachments: Array<{ name: string; url: string; type: string }> | null
  submittedAt: string | null
  submittedLate: boolean
  lateByMinutes: number | null
  marks: number | null
  grade: string | null
  feedback: string | null
  privateNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  returnedAt: string | null
  resubmissionReason: string | null
}

export interface HomeworkAuditDTO {
  id: string
  homeworkId: string
  userId: string | null
  userName: string | null
  action: string
  entity: string | null
  entityId: string | null
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

export interface HomeworkAnalyticsDTO {
  totalHomework: number
  activeHomework: number
  totalSubmissions: number
  pendingReview: number
  overdue: number
  dueToday: number
  completionRate: number
  byClass: Array<{ classId: string; className: string; assigned: number; submitted: number; pending: number; completionPct: number }>
  bySubject: Array<{ subjectId: string | null; subjectName: string; count: number }>
  byTeacher: Array<{ teacherId: string | null; teacherName: string; activeHomework: number; pendingReviews: number; completionPct: number; overdue: number }>
  submissionTrend: Array<{ date: string; assigned: number; submitted: number; reviewed: number }>
}

export interface CreateHomeworkInput {
  title: string
  description?: string
  classId: string
  subjectId?: string
  teacherId?: string
  teacherName?: string
  topic?: string
  chapter?: string
  learningObjective?: string
  content?: string
  attachments?: Array<{ name: string; url: string; type: string }>
  maxMarks?: number
  gradingType?: string
  assignedDate: string
  dueDate: string
  dueTime?: string
  allowLateSubmission?: boolean
  lateDeadline?: string
  latePenalty?: number
  allowResubmission?: boolean
  status?: string
}

// ─── Authorization + input guards (3-d audit: ownership & FK-in-tenant) ─

/** Canonical Homework.status vocabulary (schema comment + deriveStatus). */
const HOMEWORK_STATUSES = ['DRAFT', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const

const MAX_MARKS_LIMIT = 1000
const LATE_PENALTY_LIMIT = 100
const MAX_ATTACHMENTS = 20
const ATTACHMENT_FIELD_CAPS = { name: 200, url: 1000, type: 100 } as const

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Whitelist a client-provided status; unknown values are rejected. */
function assertStatusAllowed(status: string): string {
  const upper = status.trim().toUpperCase()
  if (!(HOMEWORK_STATUSES as readonly string[]).includes(upper)) {
    throw new AppError('INVALID_INPUT', {
      publicMessage: `Status must be one of ${HOMEWORK_STATUSES.join(', ')}`,
      internalDetail: `homework status whitelist rejected: ${status.slice(0, 40)}`,
    })
  }
  return upper
}

/** Bound the attachments JSON: ≤ 20 entries, each string field length-capped. */
function sanitizeAttachments(
  attachments: Array<{ name: string; url: string; type: string }> | null | undefined,
): string | null {
  if (!attachments || !Array.isArray(attachments)) return null
  const capped = attachments.slice(0, MAX_ATTACHMENTS).map((a) => ({
    name: String(a?.name ?? '').slice(0, ATTACHMENT_FIELD_CAPS.name),
    url: String(a?.url ?? '').slice(0, ATTACHMENT_FIELD_CAPS.url),
    type: String(a?.type ?? '').slice(0, ATTACHMENT_FIELD_CAPS.type),
  }))
  return JSON.stringify(capped)
}

/**
 * FK-in-tenant validation: a subject id from the request body must exist in
 * the CALLER's school before it is linked into a homework row (foreign ids
 * "do not exist" — 404, no cross-tenant oracle).
 */
async function assertSubjectInTenant(schoolId: string, subjectId: string): Promise<void> {
  const subject = await db.subject.findFirst({
    where: { id: subjectId, schoolId },
    select: { id: true },
  })
  if (!subject) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Subject not found',
      internalDetail: `assertSubjectInTenant: subject ${subjectId} missing or foreign tenant`,
    })
  }
}

/**
 * FK-in-tenant validation for the assigned teacher. Homework.teacherId
 * carries the TEACHER'S USER id (the canonical identity the ownership
 * helper compares against) — verify a Teacher row exists for that user id
 * inside the caller's school.
 */
async function assertTeacherUserInTenant(schoolId: string, teacherId: string): Promise<void> {
  const teacher = await db.teacher.findFirst({
    where: { userId: teacherId, schoolId },
    select: { id: true },
  })
  if (!teacher) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Teacher not found',
      internalDetail: `assertTeacherUserInTenant: teacher user ${teacherId} missing or foreign tenant`,
    })
  }
}

/**
 * ONE ownership predicate for every homework mutation:
 *   · PRINCIPAL / MANAGEMENT — school-wide authority (tenant-checked by the
 *     route layer before this runs).
 *   · TEACHER — creator, assigned teacher (teacherId = user id), or the
 *     class teacher of the homework's class.
 * Everyone else (students/parents/null) fails closed.
 */
export async function canManageHomework(
  schoolId: string,
  user: AuthUser | null,
  homework: { classId: string; createdBy: string | null; teacherId: string | null },
): Promise<boolean> {
  if (!user) return false
  if (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT') return true
  if (user.role !== 'TEACHER') return false
  if (homework.createdBy === user.id) return true
  if (homework.teacherId && homework.teacherId === user.id) return true
  const ownClass = await db.class.findFirst({
    where: { id: homework.classId, schoolId, classTeacherId: user.id },
    select: { id: true },
  })
  return !!ownClass
}

/** Fail-closed wrapper: 403 (safe copy) when the caller cannot manage the row. */
async function assertCanManage(
  schoolId: string,
  user: AuthUser | null,
  homework: { classId: string; createdBy: string | null; teacherId: string | null },
): Promise<void> {
  if (!(await canManageHomework(schoolId, user, homework))) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You can only manage homework you created, are assigned to, or that belongs to your class',
      internalDetail: `homework ownership: user ${user?.id ?? 'null'} (${user?.role ?? 'null'}) not authorized for homework in class ${homework.classId}`,
    })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseAttachments(json: string | null): HomeworkDTO['attachments'] {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

function deriveStatus(homework: { status: string; dueDate: Date; dueTime: string }): string {
  if (homework.status === 'ARCHIVED') return 'ARCHIVED'
  if (homework.status === 'CLOSED') return 'CLOSED'
  if (homework.status === 'DRAFT') return 'DRAFT'
  const now = new Date()
  const dueDateTime = new Date(homework.dueDate)
  const [hours, minutes] = (homework.dueTime || '23:59').split(':').map(Number)
  dueDateTime.setHours(hours || 23, minutes || 59, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDay = new Date(dueDateTime)
  dueDay.setHours(0, 0, 0, 0)
  if (dueDay.getTime() === today.getTime()) return 'DUE_TODAY'
  if (dueDateTime < now) return 'OVERDUE'
  return 'ACTIVE'
}

export function toHomeworkDTO(h: any): HomeworkDTO {
  const submissions = h.submissions ?? []
  const total = submissions.length
  const submitted = submissions.filter((s: any) => ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)).length
  const reviewed = submissions.filter((s: any) => s.status === 'REVIEWED').length
  const late = submissions.filter((s: any) => s.status === 'LATE' || s.submittedLate).length
  const returned = submissions.filter((s: any) => s.status === 'RETURNED' || s.status === 'RESUBMISSION_REQUIRED').length
  const pending = submissions.filter((s: any) => ['SUBMITTED', 'LATE'].includes(s.status)).length
  const notStarted = submissions.filter((s: any) => s.status === 'NOT_STARTED').length

  return {
    id: h.id,
    schoolId: h.schoolId,
    title: h.title,
    description: h.description,
    classId: h.classId,
    className: h.class?.name ?? '',
    subjectId: h.subjectId,
    subjectName: h.subject?.name ?? null,
    teacherId: h.teacherId,
    teacherName: h.teacherName ?? h.creator?.name ?? null,
    topic: h.topic,
    chapter: h.chapter,
    learningObjective: h.learningObjective,
    content: h.content,
    attachments: parseAttachments(h.attachments),
    maxMarks: h.maxMarks,
    gradingType: h.gradingType,
    assignedDate: h.assignedDate ? new Date(h.assignedDate).toISOString().split('T')[0] : '',
    dueDate: h.dueDate ? new Date(h.dueDate).toISOString().split('T')[0] : '',
    dueTime: h.dueTime,
    status: h.status,
    derivedStatus: deriveStatus(h),
    allowLateSubmission: h.allowLateSubmission,
    lateDeadline: h.lateDeadline ? new Date(h.lateDeadline).toISOString() : null,
    latePenalty: h.latePenalty,
    allowResubmission: h.allowResubmission,
    createdBy: h.createdBy,
    createdByName: h.creator?.name ?? null,
    publishedAt: h.publishedAt ? h.publishedAt.toISOString() : null,
    closedAt: h.closedAt ? h.closedAt.toISOString() : null,
    originalDueDate: h.originalDueDate ? new Date(h.originalDueDate).toISOString().split('T')[0] : null,
    deadlineChangedBy: h.deadlineChangedBy,
    deadlineChangedAt: h.deadlineChangedAt ? h.deadlineChangedAt.toISOString() : null,
    deadlineChangeReason: h.deadlineChangeReason,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
    submissionSummary: { total, submitted, reviewed, late, returned, pending, notStarted },
  }
}

export function toSubmissionDTO(s: any): SubmissionDTO {
  return {
    id: s.id,
    homeworkId: s.homeworkId,
    studentId: s.studentId,
    studentName: s.student?.user?.name ?? '',
    studentRollNo: s.student?.rollNo ?? null,
    attemptNumber: s.attemptNumber,
    status: s.status,
    responseText: s.responseText,
    attachments: parseAttachments(s.attachments),
    submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
    submittedLate: s.submittedLate,
    lateByMinutes: s.lateByMinutes,
    marks: s.marks,
    grade: s.grade,
    feedback: s.feedback,
    privateNote: s.privateNote,
    reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    returnedAt: s.returnedAt ? s.returnedAt.toISOString() : null,
    resubmissionReason: s.resubmissionReason,
  }
}

function toAuditDTO(a: any): HomeworkAuditDTO {
  return {
    id: a.id,
    homeworkId: a.homeworkId,
    userId: a.userId,
    userName: a.userName,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    oldValue: a.oldValue,
    newValue: a.newValue,
    createdAt: a.createdAt.toISOString(),
  }
}

async function audit(
  homeworkId: string,
  schoolId: string,
  user: AuthUser | null,
  action: string,
  entity: string | null = null,
  entityId: string | null = null,
  oldValue: unknown = null,
  newValue: unknown = null
) {
  try {
    await db.homeworkAuditLog.create({
      data: {
        homeworkId,
        schoolId,
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
    console.error('homework audit log failed', err)
  }
}

// ─── List & Read ──────────────────────────────────────────────────────

const HOMEWORK_INCLUDE = {
  class: true,
  subject: true,
  creator: { select: { name: true } },
  submissions: true,
}

export async function listHomework(
  schoolId: string,
  filters: { status?: string; classId?: string; subjectId?: string; teacherId?: string; search?: string } = {}
): Promise<HomeworkDTO[]> {
  const where: any = { schoolId }
  if (filters.status && filters.status !== 'all') {
    where.status = filters.status.toUpperCase()
  }
  if (filters.classId && filters.classId !== 'all') where.classId = filters.classId
  if (filters.subjectId && filters.subjectId !== 'all') where.subjectId = filters.subjectId
  if (filters.teacherId && filters.teacherId !== 'all') where.teacherId = filters.teacherId
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { description: { contains: filters.search } },
      { teacherName: { contains: filters.search } },
    ]
  }
  const homework = await db.homework.findMany({
    where,
    include: HOMEWORK_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return homework.map(toHomeworkDTO)
}

export async function getHomework(id: string, schoolId: string): Promise<HomeworkDTO | null> {
  const h = await db.homework.findFirst({
    where: { id, schoolId },
    include: HOMEWORK_INCLUDE,
  })
  return h ? toHomeworkDTO(h) : null
}

export async function getClasses(schoolId: string) {
  const classes = await db.class.findMany({
    where: { schoolId },
    orderBy: { gradeLevel: 'asc' },
    include: {
      subjects: { orderBy: { name: 'asc' } },
      _count: { select: { students: true } },
    },
  })
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    gradeLevel: c.gradeLevel,
    section: c.section,
    studentCount: c._count.students,
    subjects: c.subjects.map((s) => ({ id: s.id, name: s.name, code: s.code })),
  }))
}

export async function getTeachers(schoolId: string) {
  const teachers = await db.teacher.findMany({
    where: { schoolId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  })
  return teachers.map((t) => ({
    id: t.id,
    name: t.user?.name ?? '',
    email: t.user?.email ?? '',
    department: t.department,
    employeeId: t.employeeId,
  }))
}

// ─── Create / Update / Delete ────────────────────────────────────────

export async function createHomework(
  schoolId: string,
  user: AuthUser | null,
  input: CreateHomeworkInput
): Promise<HomeworkDTO> {
  if (!input.title?.trim()) throw new Error('Title is required')
  if (!input.classId) throw new Error('Class is required')
  if (!input.dueDate) throw new Error('Due date is required')

  const validClass = await db.class.findFirst({ where: { id: input.classId, schoolId } })
  if (!validClass) throw new Error('Class not found')

  // ── FK-in-tenant validation + input clamps (3-d audit) ──
  if (input.subjectId) await assertSubjectInTenant(schoolId, input.subjectId)
  if (input.teacherId) await assertTeacherUserInTenant(schoolId, input.teacherId)
  const status = input.status ? assertStatusAllowed(input.status) : 'DRAFT'
  const maxMarks =
    input.maxMarks != null && Number.isFinite(input.maxMarks)
      ? clampNumber(input.maxMarks, 0, MAX_MARKS_LIMIT)
      : null
  const latePenalty =
    input.latePenalty != null && Number.isFinite(input.latePenalty)
      ? clampNumber(input.latePenalty, 0, LATE_PENALTY_LIMIT)
      : 0

  const h = await db.homework.create({
    data: {
      schoolId,
      title: input.title.trim(),
      description: input.description || null,
      classId: input.classId,
      subjectId: input.subjectId || null,
      teacherId: input.teacherId || null,
      teacherName: input.teacherName || user?.name || null,
      topic: input.topic || null,
      chapter: input.chapter || null,
      learningObjective: input.learningObjective || null,
      content: input.content || null,
      attachments: sanitizeAttachments(input.attachments),
      maxMarks,
      gradingType: input.gradingType || 'marks',
      assignedDate: new Date(input.assignedDate || Date.now()),
      dueDate: new Date(input.dueDate),
      dueTime: input.dueTime || '23:59',
      status,
      allowLateSubmission: input.allowLateSubmission ?? true,
      lateDeadline: input.lateDeadline ? new Date(input.lateDeadline) : null,
      latePenalty,
      allowResubmission: input.allowResubmission ?? true,
      createdBy: user?.id ?? null,
      originalDueDate: new Date(input.dueDate),
    },
    include: HOMEWORK_INCLUDE,
  })

  // Auto-create empty submission rows for every student in the class —
  // Phase 3: ONE createMany instead of N sequential creates (all rows are
  // attempt 1 of a BRAND-NEW homework, so the (homeworkId, studentId,
  // attemptNumber) unique cannot collide; a crash mid-loop previously
  // left a partially-seeded roster).
  const students = await db.student.findMany({ where: { classId: input.classId, schoolId } })
  if (students.length > 0) {
    await db.homeworkSubmission.createMany({
      data: students.map((s) => ({
        homeworkId: h.id,
        studentId: s.id,
        schoolId,
        attemptNumber: 1,
        status: 'NOT_STARTED',
      })),
    })
  }

  await audit(h.id, schoolId, user, 'HOMEWORK_CREATED', 'HOMEWORK', h.id, null, { title: h.title })
  return toHomeworkDTO(h)
}

export async function updateHomework(
  id: string,
  schoolId: string,
  user: AuthUser | null,
  updates: Partial<CreateHomeworkInput>
): Promise<HomeworkDTO> {
  const existing = await db.homework.findFirst({ where: { id, schoolId } })
  if (!existing) throw new Error('Homework not found')

  // ── Ownership (3-d audit): only the creator, the assigned teacher, the
  //    class teacher, or PRINCIPAL/MANAGEMENT may edit a homework row. ──
  await assertCanManage(schoolId, user, existing)

  // ── FK-in-tenant validation + input clamps for every provided field. ──
  if (updates.subjectId) await assertSubjectInTenant(schoolId, updates.subjectId)
  if (updates.teacherId) await assertTeacherUserInTenant(schoolId, updates.teacherId)
  if (updates.status !== undefined && updates.status) assertStatusAllowed(updates.status)
  const maxMarks =
    updates.maxMarks !== undefined && updates.maxMarks != null && Number.isFinite(updates.maxMarks)
      ? clampNumber(updates.maxMarks, 0, MAX_MARKS_LIMIT)
      : undefined
  const latePenalty =
    updates.latePenalty !== undefined && updates.latePenalty != null && Number.isFinite(updates.latePenalty)
      ? clampNumber(updates.latePenalty, 0, LATE_PENALTY_LIMIT)
      : undefined

  const updated = await db.homework.update({
    where: { id },
    data: {
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.subjectId !== undefined ? { subjectId: updates.subjectId } : {}),
      ...(updates.teacherId !== undefined ? { teacherId: updates.teacherId } : {}),
      ...(updates.teacherName !== undefined ? { teacherName: updates.teacherName } : {}),
      ...(updates.topic !== undefined ? { topic: updates.topic } : {}),
      ...(updates.chapter !== undefined ? { chapter: updates.chapter } : {}),
      ...(updates.learningObjective !== undefined ? { learningObjective: updates.learningObjective } : {}),
      ...(updates.content !== undefined ? { content: updates.content } : {}),
      ...(updates.attachments !== undefined ? { attachments: sanitizeAttachments(updates.attachments) } : {}),
      ...(maxMarks !== undefined ? { maxMarks } : {}),
      ...(updates.gradingType !== undefined ? { gradingType: updates.gradingType } : {}),
      ...(updates.assignedDate !== undefined ? { assignedDate: new Date(updates.assignedDate) } : {}),
      ...(updates.dueDate !== undefined ? { dueDate: new Date(updates.dueDate) } : {}),
      ...(updates.dueTime !== undefined ? { dueTime: updates.dueTime } : {}),
      ...(updates.allowLateSubmission !== undefined ? { allowLateSubmission: updates.allowLateSubmission } : {}),
      ...(updates.lateDeadline !== undefined ? { lateDeadline: updates.lateDeadline ? new Date(updates.lateDeadline) : null } : {}),
      ...(latePenalty !== undefined ? { latePenalty } : {}),
      ...(updates.allowResubmission !== undefined ? { allowResubmission: updates.allowResubmission } : {}),
    },
    include: HOMEWORK_INCLUDE,
  })
  await audit(id, schoolId, user, 'HOMEWORK_UPDATED', 'HOMEWORK', id, { title: existing.title }, updates)
  return toHomeworkDTO(updated)
}

export async function deleteHomework(id: string, schoolId: string, user: AuthUser | null): Promise<void> {
  const h = await db.homework.findFirst({ where: { id, schoolId } })
  if (!h) throw new Error('Homework not found')
  // Deleting cascades submissions + audit rows — PRINCIPAL/MANAGEMENT only
  // (3-d audit: a peer teacher deleting homework orphans other teachers'
  // submission/grading data; kept conservative).
  if (!user || (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT')) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'Only the principal or management can delete homework',
      internalDetail: `deleteHomework: role ${user?.role ?? 'null'} attempted delete`,
    })
  }
  await db.homework.delete({ where: { id } })
}

export async function publishHomework(id: string, schoolId: string, user: AuthUser | null): Promise<HomeworkDTO> {
  const h = await db.homework.findFirst({ where: { id, schoolId } })
  if (!h) throw new Error('Homework not found')
  await assertCanManage(schoolId, user, h)
  const updated = await db.homework.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
    include: HOMEWORK_INCLUDE,
  })
  await audit(id, schoolId, user, 'HOMEWORK_PUBLISHED', 'HOMEWORK', id, h.status, 'PUBLISHED')
  return toHomeworkDTO(updated)
}

export async function closeHomework(id: string, schoolId: string, user: AuthUser | null): Promise<HomeworkDTO> {
  const h = await db.homework.findFirst({ where: { id, schoolId } })
  if (!h) throw new Error('Homework not found')
  await assertCanManage(schoolId, user, h)
  const updated = await db.homework.update({
    where: { id },
    data: { status: 'CLOSED', closedAt: new Date() },
    include: HOMEWORK_INCLUDE,
  })
  await audit(id, schoolId, user, 'HOMEWORK_CLOSED', 'HOMEWORK', id, h.status, 'CLOSED')
  return toHomeworkDTO(updated)
}

export async function archiveHomework(id: string, schoolId: string, user: AuthUser | null): Promise<HomeworkDTO> {
  const h = await db.homework.findFirst({ where: { id, schoolId } })
  if (!h) throw new Error('Homework not found')
  await assertCanManage(schoolId, user, h)
  const updated = await db.homework.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    include: HOMEWORK_INCLUDE,
  })
  await audit(id, schoolId, user, 'HOMEWORK_ARCHIVED', 'HOMEWORK', id, h.status, 'ARCHIVED')
  return toHomeworkDTO(updated)
}

export async function duplicateHomework(id: string, schoolId: string, user: AuthUser | null): Promise<HomeworkDTO> {
  const original = await db.homework.findFirst({ where: { id, schoolId }, include: HOMEWORK_INCLUDE })
  if (!original) throw new Error('Homework not found')
  await assertCanManage(schoolId, user, original)
  const newHomework = await db.homework.create({
    data: {
      schoolId,
      title: `${original.title} (Copy)`,
      description: original.description,
      classId: original.classId,
      subjectId: original.subjectId,
      teacherId: original.teacherId,
      teacherName: original.teacherName,
      topic: original.topic,
      chapter: original.chapter,
      learningObjective: original.learningObjective,
      content: original.content,
      attachments: original.attachments,
      maxMarks: original.maxMarks,
      gradingType: original.gradingType,
      assignedDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      dueTime: original.dueTime,
      status: 'DRAFT',
      allowLateSubmission: original.allowLateSubmission,
      latePenalty: original.latePenalty,
      allowResubmission: original.allowResubmission,
      createdBy: user?.id ?? null,
      originalDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    include: HOMEWORK_INCLUDE,
  })
  // Phase 3: ONE createMany instead of N sequential creates (attempt 1 of
  // a brand-new homework — the (homeworkId, studentId, attemptNumber)
  // unique cannot collide).
  const students = await db.student.findMany({ where: { classId: original.classId, schoolId } })
  if (students.length > 0) {
    await db.homeworkSubmission.createMany({
      data: students.map((s) => ({
        homeworkId: newHomework.id,
        studentId: s.id,
        schoolId,
        attemptNumber: 1,
        status: 'NOT_STARTED',
      })),
    })
  }
  await audit(newHomework.id, schoolId, user, 'HOMEWORK_DUPLICATED', 'HOMEWORK', newHomework.id, { originalId: id }, { newId: newHomework.id })
  return toHomeworkDTO(newHomework)
}

export async function extendDeadline(
  id: string,
  schoolId: string,
  user: AuthUser | null,
  newDueDate: string,
  reason: string
): Promise<HomeworkDTO> {
  const h = await db.homework.findFirst({ where: { id, schoolId } })
  if (!h) throw new Error('Homework not found')
  await assertCanManage(schoolId, user, h)
  const oldDue = h.dueDate
  const updated = await db.homework.update({
    where: { id },
    data: {
      dueDate: new Date(newDueDate),
      originalDueDate: h.originalDueDate ?? oldDue,
      deadlineChangedBy: user?.id ?? null,
      deadlineChangedAt: new Date(),
      deadlineChangeReason: reason,
    },
    include: HOMEWORK_INCLUDE,
  })
  await audit(id, schoolId, user, 'DEADLINE_CHANGED', 'HOMEWORK', id, { oldDueDate: oldDue, newDueDate }, { reason })
  return toHomeworkDTO(updated)
}

// ─── Submissions ──────────────────────────────────────────────────────

export async function getSubmissions(homeworkId: string, schoolId: string): Promise<SubmissionDTO[]> {
  const h = await db.homework.findFirst({ where: { id: homeworkId, schoolId }, select: { id: true } })
  if (!h) return []
  const submissions = await db.homeworkSubmission.findMany({
    where: { homeworkId },
    include: { student: { include: { user: { select: { name: true } } } } },
    orderBy: { student: { rollNo: 'asc' } },
  })
  return submissions.map(toSubmissionDTO)
}

export async function reviewSubmission(
  homeworkId: string,
  submissionId: string,
  schoolId: string,
  user: AuthUser | null,
  data: { marks?: number; grade?: string; feedback?: string; privateNote?: string; action: 'review' | 'return' | 'resubmit' }
): Promise<SubmissionDTO> {
  const h = await db.homework.findFirst({ where: { id: homeworkId, schoolId } })
  if (!h) throw new Error('Homework not found')
  const sub = await db.homeworkSubmission.findUnique({ where: { id: submissionId } })
  if (!sub || sub.homeworkId !== homeworkId) throw new Error('Submission not found')

  // ── Ownership (3-d audit): the reviewer must be able to manage the
  //    homework (creator / assigned teacher / class teacher / P/M) — a
  //    peer teacher may not grade another teacher's submissions. ──
  await assertCanManage(schoolId, user, h)

  if (data.marks !== undefined && data.marks != null && (data.marks < 0 || !Number.isFinite(data.marks))) {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Marks must be a non-negative number' })
  }
  if (data.marks !== undefined && h.maxMarks && data.marks > h.maxMarks) {
    throw new Error(`Marks cannot exceed maximum (${h.maxMarks})`)
  }

  let newStatus = 'REVIEWED'
  if (data.action === 'return') newStatus = 'RETURNED'
  else if (data.action === 'resubmit') newStatus = 'RESUBMISSION_REQUIRED'

  const updated = await db.homeworkSubmission.update({
    where: { id: submissionId },
    data: {
      marks: data.marks ?? sub.marks,
      grade: data.grade ?? sub.grade,
      feedback: data.feedback ?? sub.feedback,
      privateNote: data.privateNote ?? sub.privateNote,
      status: newStatus,
      reviewedBy: user?.id ?? null,
      reviewedAt: data.action === 'review' ? new Date() : sub.reviewedAt,
      returnedAt: data.action === 'return' ? new Date() : sub.returnedAt,
      resubmissionReason: data.action === 'resubmit' ? (data.feedback || 'Resubmission required') : sub.resubmissionReason,
    },
    include: { student: { include: { user: { select: { name: true } } } } },
  })

  const actionMap = { review: 'SUBMISSION_REVIEWED', return: 'SUBMISSION_RETURNED', resubmit: 'RESUBMISSION_REQUESTED' }
  await audit(homeworkId, schoolId, user, actionMap[data.action], 'SUBMISSION', submissionId, { oldStatus: sub.status }, { newStatus, marks: data.marks })
  return toSubmissionDTO(updated)
}

// ─── Analytics ────────────────────────────────────────────────────────

export async function getAnalytics(schoolId: string): Promise<HomeworkAnalyticsDTO> {
  const homework = await db.homework.findMany({
    where: { schoolId, status: { notIn: ['ARCHIVED'] } },
    include: {
      class: true,
      subject: true,
      creator: { select: { name: true } },
      submissions: true,
    },
  })

  const now = new Date()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const activeHomework = homework.filter((h) => ['PUBLISHED', 'ACTIVE'].includes(h.status)).length
  const overdue = homework.filter((h) => {
    if (!['PUBLISHED', 'ACTIVE'].includes(h.status)) return false
    const due = new Date(h.dueDate)
    const [hh, mm] = (h.dueTime || '23:59').split(':').map(Number)
    due.setHours(hh || 23, mm || 59, 0, 0)
    return due < now
  }).length
  const dueToday = homework.filter((h) => {
    if (!['PUBLISHED', 'ACTIVE'].includes(h.status)) return false
    const due = new Date(h.dueDate)
    due.setHours(0, 0, 0, 0)
    return due.getTime() === today.getTime()
  }).length

  const totalSubmissions = homework.reduce((sum, h) => sum + h.submissions.filter((s) => ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)).length, 0)
  const pendingReview = homework.reduce((sum, h) => sum + h.submissions.filter((s) => ['SUBMITTED', 'LATE'].includes(s.status)).length, 0)
  const totalSlots = homework.reduce((sum, h) => sum + h.submissions.length, 0)
  const completionRate = totalSlots > 0 ? Math.round((totalSubmissions / totalSlots) * 100) : 0

  // By class
  const classMap = new Map<string, { className: string; assigned: number; submitted: number; pending: number; slots: number }>()
  for (const h of homework) {
    const key = h.classId
    if (!classMap.has(key)) classMap.set(key, { className: h.class?.name ?? '', assigned: 0, submitted: 0, pending: 0, slots: 0 })
    const entry = classMap.get(key)!
    entry.assigned += 1
    entry.submitted += h.submissions.filter((s) => ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)).length
    entry.pending += h.submissions.filter((s) => s.status === 'NOT_STARTED').length
    entry.slots += h.submissions.length
  }
  const byClass = Array.from(classMap.entries()).map(([classId, v]) => ({
    classId, className: v.className, assigned: v.assigned, submitted: v.submitted, pending: v.pending,
    completionPct: v.slots > 0 ? Math.round((v.submitted / v.slots) * 100) : 0,
  }))

  // By subject
  const subjectMap = new Map<string, number>()
  for (const h of homework) {
    const key = h.subjectId ?? 'no_subject'
    subjectMap.set(key, (subjectMap.get(key) ?? 0) + 1)
  }
  const bySubject = Array.from(subjectMap.entries()).map(([subjectId, count]) => ({
    subjectId: subjectId === 'no_subject' ? null : subjectId,
    subjectName: homework.find((h) => (h.subjectId ?? 'no_subject') === subjectId)?.subject?.name ?? 'General',
    count,
  }))

  // By teacher
  const teacherMap = new Map<string, { teacherName: string; activeHomework: number; pendingReviews: number; overdue: number; totalSubmissions: number; totalSlots: number }>()
  for (const h of homework) {
    const key = h.teacherId ?? h.createdBy ?? 'unknown'
    const name = h.teacherName ?? h.creator?.name ?? 'Unknown'
    if (!teacherMap.has(key)) teacherMap.set(key, { teacherName: name, activeHomework: 0, pendingReviews: 0, overdue: 0, totalSubmissions: 0, totalSlots: 0 })
    const entry = teacherMap.get(key)!
    if (['PUBLISHED', 'ACTIVE'].includes(h.status)) entry.activeHomework++
    entry.pendingReviews += h.submissions.filter((s) => ['SUBMITTED', 'LATE'].includes(s.status)).length
    const due = new Date(h.dueDate)
    const [hh, mm] = (h.dueTime || '23:59').split(':').map(Number)
    due.setHours(hh || 23, mm || 59, 0, 0)
    if (['PUBLISHED', 'ACTIVE'].includes(h.status) && due < now) entry.overdue++
    entry.totalSubmissions += h.submissions.filter((s) => ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)).length
    entry.totalSlots += h.submissions.length
  }
  const byTeacher = Array.from(teacherMap.entries()).map(([teacherId, v]) => ({
    teacherId,
    teacherName: v.teacherName,
    activeHomework: v.activeHomework,
    pendingReviews: v.pendingReviews,
    completionPct: v.totalSlots > 0 ? Math.round((v.totalSubmissions / v.totalSlots) * 100) : 0,
    overdue: v.overdue,
  }))

  // Submission trend (last 7 days)
  const submissionTrend: Array<{ date: string; assigned: number; submitted: number; reviewed: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const dayStart = new Date(d)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(d)
    dayEnd.setHours(23, 59, 59, 999)
    const assigned = homework.filter((h) => {
      const ad = new Date(h.assignedDate)
      return ad >= dayStart && ad <= dayEnd
    }).length
    let submitted = 0
    let reviewed = 0
    for (const h of homework) {
      for (const s of h.submissions) {
        if (s.submittedAt && s.submittedAt >= dayStart && s.submittedAt <= dayEnd) submitted++
        if (s.reviewedAt && s.reviewedAt >= dayStart && s.reviewedAt <= dayEnd) reviewed++
      }
    }
    submissionTrend.push({ date: dateStr, assigned, submitted, reviewed })
  }

  return {
    totalHomework: homework.length,
    activeHomework,
    totalSubmissions,
    pendingReview,
    overdue,
    dueToday,
    completionRate,
    byClass: byClass.slice(0, 10),
    bySubject: bySubject.slice(0, 10),
    byTeacher: byTeacher.slice(0, 10),
    submissionTrend,
  }
}

// ─── Audit logs ──────────────────────────────────────────────────────

export async function getAuditLogs(homeworkId: string, schoolId: string): Promise<HomeworkAuditDTO[]> {
  const h = await db.homework.findFirst({ where: { id: homeworkId, schoolId }, select: { id: true } })
  if (!h) return []
  const logs = await db.homeworkAuditLog.findMany({
    where: { homeworkId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return logs.map(toAuditDTO)
}
