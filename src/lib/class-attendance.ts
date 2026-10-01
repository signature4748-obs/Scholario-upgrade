/**
 * class-attendance — shared server helpers for the Class Attendance
 * module (baseline + subject-session model).
 */

import { db, trackedTransaction } from '@/lib/db'
import { schoolScoped } from '@/lib/api'
import { getTeacherSubjectAssignments } from '@/lib/teacher-scope'

export const VALID_ATTENDANCE_STATUS = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const
export type AttendanceStatusValue = (typeof VALID_ATTENDANCE_STATUS)[number]

export function isValidStatus(value: unknown): value is AttendanceStatusValue {
  return typeof value === 'string' && (VALID_ATTENDANCE_STATUS as readonly string[]).includes(value)
}

export function parseDateParam(value: string | null | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date')
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
  return d
}

export interface ClassScope {
  isClassTeacher: boolean
  subjects: { id: string; name: string }[]
}

/**
 * The SUBJECTS the authenticated teacher may run subject sessions for in
 * ONE class — resolved through the canonical CSA-first resolver
 * (teacher-scope.ts: ClassSubjectAssignment(teacherUserId) ∪
 * Timetable(teacherUserId) ∪ legacy Timetable(teacherName ONLY when the row
 * carries no teacher user id)). PIH-4a: this used to match a bare
 * lowercased teacherName, so any same-named account inherited (or lost)
 * the class's subject scope.
 */
async function subjectsInClassScope(
  user: { id: string; name: string | null },
  schoolId: string,
  classId: string
): Promise<{ id: string; name: string }[]> {
  const assignments = await getTeacherSubjectAssignments(user, schoolId)
  const subjectIds = [
    ...new Set(assignments.filter((a) => a.classId === classId).map((a) => a.subjectId)),
  ]
  if (subjectIds.length === 0) return []
  const rows = await db.subject.findMany({
    where: { schoolId, id: { in: subjectIds } },
    select: { id: true, name: true },
  })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve what the authenticated teacher may do with a class:
 * class-teacher → owns the daily baseline; subject teacher (appointed
 * via CSA / timetable) → subject sessions for her own subjects only.
 */
export async function resolveClassScope(
  user: { id: string; name: string | null },
  schoolId: string,
  classId: string
): Promise<ClassScope> {
  const cls = await db.class.findUnique({
    where: { id: classId },
    select: { id: true, schoolId: true, classTeacherId: true },
  })
  if (!cls || cls.schoolId !== schoolId) throw new Error('NOT_FOUND')
  const isClassTeacher = cls.classTeacherId === user.id

  const subjects = await subjectsInClassScope(user, schoolId, classId)

  if (!isClassTeacher && subjects.length === 0) throw new Error('FORBIDDEN')
  return { isClassTeacher, subjects }
}

export function schoolIdOf(user: { schoolId: string | null }): string {
  return schoolScoped(user as never)
}

/**
 * A READ-ONLY scope probe for honest rejection/annotation copy: returns
 * null when the caller has no relationship with the class, otherwise the
 * class-teacher flag, her subjects, and the appointed class teacher's
 * name (attendance is managed by HER — spec §7–§10). Never throws, never
 * writes.
 */
export async function resolveClassScopeOrNull(
  user: { id: string; name: string | null },
  schoolId: string,
  classId: string
): Promise<
  | (ClassScope & { classTeacherName: string | null })
  | null
> {
  const cls = await db.class.findUnique({
    where: { id: classId },
    select: {
      id: true,
      schoolId: true,
      classTeacherId: true,
    },
  })
  if (!cls || cls.schoolId !== schoolId) return null
  const classTeacherName = cls.classTeacherId
    ? ((await db.user.findUnique({ where: { id: cls.classTeacherId }, select: { name: true } }))?.name ?? null)
    : null

  const subjects = await subjectsInClassScope(user, schoolId, classId)

  const isClassTeacher = cls.classTeacherId === user.id
  if (!isClassTeacher && subjects.length === 0) return null
  return {
    isClassTeacher,
    subjects,
    classTeacherName,
  }
}

// ─── Canonical write + audit + draft workflow (spec §18/§19) ───────────

export type AttendanceWriteSource = 'BASELINE' | 'SUBJECT_SESSION' | 'AUTOSAVE'

export interface AttendanceWriteActor {
  id: string
  name: string
}

export interface CanonicalWriteResult {
  saved: number
  /** rows whose status actually changed vs the previous canonical record */
  changed: number
  counts: { present: number; absent: number; late: number; leave: number }
}

/**
 * writeCanonicalAttendance — the ONE server-side writer for the official
 * daily record (CLASS + DATE + STUDENT). Every path funnels through here:
 * the class-teacher baseline, an authorized subject teacher completing the
 * class/day, and the end-of-day autosave. Guarantees:
 *
 *   · one row per student (existing day rows are replaced, never duplicated)
 *   · every EDIT of an already-saved status is journaled to
 *     AttendanceAuditLog (who / when / previous → new / source) — §18
 *   · any open draft for the class-day is cleared (a canonical write
 *     supersedes it)
 */
export async function writeCanonicalAttendance(input: {
  schoolId: string
  classId: string
  date: Date
  entries: { studentId: string; status: AttendanceStatusValue }[]
  actor: AttendanceWriteActor
  source: AttendanceWriteSource
  /** provenance line stored on the rows (e.g. "Rohan Mehta" / "Autosaved · Rohan Mehta") */
  markedBy: string
}): Promise<CanonicalWriteResult> {
  const day = input.date
  const nextDay = new Date(day.getTime() + 86_400_000)

  const existing = await db.attendance.findMany({
    where: { classId: input.classId, date: { gte: day, lt: nextDay } },
    select: { studentId: true, status: true },
  })
  const previous = new Map(existing.map((r) => [r.studentId, r.status]))

  const counts = {
    present: input.entries.filter((e) => e.status === 'PRESENT').length,
    absent: input.entries.filter((e) => e.status === 'ABSENT').length,
    late: input.entries.filter((e) => e.status === 'LATE').length,
    leave: input.entries.filter((e) => e.status === 'LEAVE').length,
  }

  // Real changes only: a status that differs from the saved canonical value.
  // First-time marking has no previous value — it is not an edit (§18).
  const changed = input.entries.filter((e) => {
    const prev = previous.get(e.studentId)
    return prev != null && prev !== e.status
  })

  await trackedTransaction('attendance-canonical-write', async (tx) => {
    // The authoritative day-window replace (legacy rows may carry times —
    // a range delete avoids unique-constraint collisions).
    await tx.attendance.deleteMany({
      where: { classId: input.classId, date: { gte: day, lt: nextDay } },
    })
    for (const e of input.entries) {
      await tx.attendance.create({
        data: {
          schoolId: input.schoolId,
          studentId: e.studentId,
          classId: input.classId,
          date: day,
          status: e.status,
          markedBy: input.markedBy,
        },
      })
    }
    if (changed.length > 0) {
      await tx.attendanceAuditLog.createMany({
        data: changed.map((e) => ({
          schoolId: input.schoolId,
          classId: input.classId,
          studentId: e.studentId,
          date: day,
          previousStatus: previous.get(e.studentId)!,
          newStatus: e.status,
          source: input.source,
          changedBy: input.actor.name,
          changedById: input.actor.id,
        })),
      })
    }
    // A canonical write supersedes any open draft for the day.
    await tx.attendanceDraft.deleteMany({
      where: { classId: input.classId, date: { gte: day, lt: nextDay } },
    })
  })

  return { saved: input.entries.length, changed: changed.length, counts }
}

export interface AttendanceWorkflowSettings {
  autosaveFinalize: boolean
  endOfDayMinutes: number
}

/** Load the school's attendance workflow policy (self-seeding defaults). */
export async function attendanceSettingsFor(schoolId: string): Promise<AttendanceWorkflowSettings> {
  const row = await db.attendanceSetting.findUnique({ where: { schoolId } })
  if (row) {
    return { autosaveFinalize: row.autosaveFinalize, endOfDayMinutes: row.endOfDayMinutes }
  }
  return { autosaveFinalize: true, endOfDayMinutes: 930 }
}

/** Minutes-from-midnight in school time (IST, UTC+5:30 — no DST). */
export function istMinutesNow(now = new Date()): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return (utcMinutes + 330) % 1440
}

/** The IST calendar date as YYYY-MM-DD (attendance days are stored at
 *  midnight UTC — the day key the whole system agrees on). */
export function istDayKey(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000)
  return ist.toISOString().slice(0, 10)
}

/**
 * The end-of-day autosave (§19): finalize an open draft for a PAST day
 * (or today, once the school's end-of-day boundary has passed) into the
 * canonical record. Never a fake "final submission" — the provenance line
 * says AUTOSAVE, and it only runs when school policy allows it.
 *
 * Returns the finalization outcome so callers can report honestly.
 */
export async function finalizeDraftIfDue(params: {
  schoolId: string
  classId: string
  dayKey: string
  settings?: AttendanceWorkflowSettings
}): Promise<{ finalized: boolean; reason: 'no-draft' | 'already-submitted' | 'before-boundary' | 'disabled' | 'ok'; saved?: number }> {
  const settings = params.settings ?? (await attendanceSettingsFor(params.schoolId))
  if (!settings.autosaveFinalize) return { finalized: false, reason: 'disabled' }

  const day = parseDateParam(params.dayKey)
  if (day.getTime() > Date.now() + 86_400_000) return { finalized: false, reason: 'before-boundary' }
  const isToday = params.dayKey === istDayKey()
  if (isToday && istMinutesNow() < settings.endOfDayMinutes) {
    return { finalized: false, reason: 'before-boundary' }
  }

  const draft = await db.attendanceDraft.findUnique({
    where: { classId_date: { classId: params.classId, date: day } },
  })
  if (!draft) return { finalized: false, reason: 'no-draft' }

  // Already submitted? The draft is stale — clear it, change nothing.
  const existing = await db.attendance.findMany({
    where: { classId: params.classId, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
    select: { id: true },
  })
  if (existing.length > 0) {
    await db.attendanceDraft.deleteMany({
      where: { classId: params.classId, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
    })
    return { finalized: false, reason: 'already-submitted' }
  }

  let entries: { studentId: string; status: string }[] = []
  try {
    entries = JSON.parse(draft.entries) as { studentId: string; status: string }[]
  } catch {
    return { finalized: false, reason: 'no-draft' }
  }
  const valid = entries.filter((e) => isValidStatus(e.status))
  if (valid.length === 0) return { finalized: false, reason: 'no-draft' }

  // Only a COMPLETE sheet may become the canonical record — the autosave
  // finalizes "valid changes", never a half-marked roster. Roster truth is
  // re-derived server-side.
  const roster = await db.student.findMany({
    where: { classId: params.classId, user: { status: 'ACTIVE' } },
    select: { id: true },
  })
  const rosterIds = new Set(roster.map((s) => s.id))
  const covered = valid.filter((e) => rosterIds.has(e.studentId))
  if (covered.length !== rosterIds.size || rosterIds.size === 0) {
    return { finalized: false, reason: 'no-draft' }
  }

  const result = await writeCanonicalAttendance({
    schoolId: params.schoolId,
    classId: params.classId,
    date: day,
    entries: covered as { studentId: string; status: AttendanceStatusValue }[],
    actor: { id: draft.updatedById, name: draft.updatedByName },
    source: 'AUTOSAVE',
    markedBy: `Autosaved · ${draft.updatedByName}`,
  })
  return { finalized: true, reason: 'ok', saved: result.saved }
}
