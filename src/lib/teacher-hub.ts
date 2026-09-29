/**
 * teacher-hub — server-side authorization + serialization for the
 * Teacher Hub modules (parent conversations / Student Growth).
 *
 * SECURITY MODEL (mirrors learning.ts's requireStudent pattern):
 *   erp_session cookie → getCurrentUser → requireTeacher → Teacher row →
 *   school scope → class-teacher classes → authorized student set.
 * Client-supplied ids are NEVER trusted — every mutation re-validates that
 * the target student/conversation/record belongs to the
 * authenticated teacher's scope:
 *   • Parent conversations are owned by the teacher (teacherId).
 *   • Growth events are visible to every teacher with the student in
 *     scope (the growth system is transparent by design, §28).
 * A teacher can never touch another school's rows: every query is
 * schoolId-scoped from the session, never from the request body.
 */

import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { schoolScoped } from '@/lib/api'
import type { AuthUser } from '@/lib/auth'
import type { FollowUpItem, StudentRef } from '@/lib/teacher-hub-types'

export interface TeacherClassInfo {
  id: string
  name: string
  section: string | null
  label: string
}

export interface TeacherHubContext {
  schoolId: string
  /** User.id of the authenticated teacher */
  userId: string
  /** Teacher profile row id */
  teacherId: string
  name: string
  /** classes where this user is the class teacher (Class.classTeacherId = User.id) */
  classTeacherOf: TeacherClassInfo[]
  /** classes where this teacher TEACHES a subject (timetable rows carrying
   *  their name — the same permission source as the Student Directory /
   *  Lesson Planner). A subject teacher's authorized students are the
   *  students of these classes (spec §13: subject teachers act within
   *  their authorized scope, never beyond it). */
  taughtClasses: TeacherClassInfo[]
}

/** All classes the teacher may act on (class-teacher ∪ subject-taught). */
export function scopeClassIds(ctx: TeacherHubContext): string[] {
  const ids = new Set<string>([
    ...ctx.classTeacherOf.map((c) => c.id),
    ...ctx.taughtClasses.map((c) => c.id),
  ])
  return [...ids]
}

export function classLabelOf(c: { name: string; section: string | null } | null | undefined): string {
  if (!c) return 'Unassigned'
  // The class name may already carry the section ("Grade 9 - A") — never
  // render it twice (same rule as /api/auth/me + student dashboard).
  if (c.section) {
    const esc = c.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`[-–\\s]${esc}\\s*$`, 'i').test(c.name)) return c.name
    return `${c.name} - ${c.section}`
  }
  return c.name
}

/** Resolve the authenticated teacher + her full scope (class-teacher
 *  classes ∪ subject-taught classes). Throws honest errors. */
export async function requireTeacher(user: AuthUser): Promise<TeacherHubContext> {
  const schoolId = schoolScoped(user)
  const teacher = await db.teacher.findUnique({ where: { userId: user.id } })
  if (!teacher || teacher.schoolId !== schoolId) throw new Error('NO_TEACHER_RECORD')
  const teacherName = (user.name || '').trim().toLowerCase()
  const [ctClasses, ttRows] = await Promise.all([
    db.class.findMany({
      where: { schoolId, classTeacherId: user.id },
      select: { id: true, name: true, section: true },
      orderBy: { name: 'asc' },
    }),
    teacherName
      ? db.timetable.findMany({
          where: { schoolId, teacherName: { not: null }, subjectId: { not: null } },
          select: { classId: true, teacherName: true },
          distinct: ['classId', 'teacherName'],
        })
      : Promise.resolve([]),
  ])
  const ctIds = new Set(ctClasses.map((c) => c.id))
  const taughtIds = new Set(
    ttRows
      .filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherName)
      .map((r) => r.classId),
  )
  const taught = taughtIds.size
    ? await db.class.findMany({
        where: { schoolId, id: { in: [...taughtIds] } },
        select: { id: true, name: true, section: true },
        orderBy: { name: 'asc' },
      })
    : []
  return {
    schoolId,
    userId: user.id,
    teacherId: teacher.id,
    name: user.name || 'Teacher',
    classTeacherOf: ctClasses.map((c) => ({ ...c, label: classLabelOf(c) })),
    taughtClasses: taught.filter((c) => !ctIds.has(c.id)).map((c) => ({ ...c, label: classLabelOf(c) })),
  }
}

/**
 * Prisma `where` for students this teacher may act on:
 * students of her class-teacher classes ∪ students of the classes she
 * teaches a subject in (the Directory scope — spec §13) ∪ students
 * already connected to her through any Teacher Hub relation
 * (conversation, behavior record).
 */
export function authorizedStudentWhere(ctx: TeacherHubContext) {
  const classIds = scopeClassIds(ctx)
  const clauses: Record<string, unknown>[] = classIds.length
    ? [{ classId: { in: classIds } }]
    : []
  clauses.push({ parentConversations: { some: { teacherId: ctx.userId } } })
  clauses.push({ behaviorRecords: { some: { recordedById: ctx.userId } } })
  return { schoolId: ctx.schoolId, OR: clauses }
}

export interface ScopedStudent {
  id: string
  userId: string
  rollNo: string | null
  admissionNo: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianId: string | null
  classId: string | null
  class: { id: string; name: string; section: string | null; stream?: string | null } | null
  user: { id: string; name: string | null } | null
  gender: string | null
  dob: string | null
  bloodGroup: string | null
  address: string | null
}

/** Validate + fetch a student inside the teacher's authorized scope. */
export async function assertStudentInScope(
  ctx: TeacherHubContext,
  studentId: unknown,
): Promise<ScopedStudent> {
  if (typeof studentId !== 'string' || !studentId.trim()) throw new Error('Student is required')
  const student = await db.student.findFirst({
    where: { id: studentId, ...authorizedStudentWhere(ctx) },
    include: {
      class: { select: { id: true, name: true, section: true, stream: true } },
      user: { select: { id: true, name: true } },
    },
  })
  if (!student) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Student not found in your scope', internalDetail: 'assertStudentInScope: student missing or outside teacher scope' })
  return student as ScopedStudent
}

// ---------- serializers ----------

type StudentRow = {
  id: string
  rollNo: string | null
  classId?: string | null
  class: { name: string; section: string | null } | null
  user: { name: string | null } | null
}

export function toStudentRef(s: StudentRow): StudentRef {
  return {
    id: s.id,
    name: s.user?.name ?? 'Unnamed student',
    rollNo: s.rollNo,
    classLabel: classLabelOf(s.class),
    classId: s.classId ?? null,
  }
}

type FollowUpRow = {
  id: string
  kind: string
  reason: string
  note: string | null
  dueDate: Date
  priority: string
  status: string
  conversationId: string | null
  recordId: string | null
  createdAt: Date
  student: StudentRow | null
}

export function toFollowUpItem(f: FollowUpRow): FollowUpItem {
  return {
    id: f.id,
    kind: f.kind as FollowUpItem['kind'],
    reason: f.reason,
    note: f.note,
    dueDate: f.dueDate.toISOString(),
    priority: f.priority as FollowUpItem['priority'],
    status: f.status as FollowUpItem['status'],
    student: f.student ? toStudentRef(f.student) : null,
    conversationId: f.conversationId,
    recordId: f.recordId,
    createdAt: f.createdAt.toISOString(),
  }
}

// ---------- audit (existing ActivityLog system — best-effort, never fails the op) ----------

export async function auditTeacherAction(
  user: AuthUser,
  schoolId: string,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await db.activityLog.create({ data: { schoolId, userId: user.id, action, detail } })
  } catch {
    // audit is best-effort by design (matches the ActivityLog call sites in /api)
  }
}

// ---------- shared validation helpers ----------

export function parseDate(v: unknown, field: string): Date {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`)
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is not a valid date`)
  return d
}

export function parseString(
  v: unknown,
  field: string,
  opts: { required?: boolean; max?: number } = {},
): string | null {
  const required = opts.required ?? false
  if (v == null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new Error(`${field} is required`)
    return null
  }
  if (typeof v !== 'string') throw new Error(`${field} must be text`)
  const s = v.trim()
  if (opts.max && s.length > opts.max) throw new Error(`${field} must be at most ${opts.max} characters`)
  return s
}

export function isDueOrOverdue(due: Date): boolean {
  const today = new Date()
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  return due.getTime() <= endOfToday.getTime()
}
