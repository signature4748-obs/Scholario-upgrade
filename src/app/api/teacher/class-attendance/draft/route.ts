import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { runJob } from '@/lib/observability/jobs'
import {
  parseDateParam,
  resolveClassScope,
  isValidStatus,
  attendanceSettingsFor,
  finalizeDraftIfDue,
  istDayKey,
  istMinutesNow,
} from '@/lib/class-attendance'

export const runtime = 'nodejs'

interface DraftBody {
  classId?: string
  date?: string
  /** legacy field — subject-teacher drafts are retired (§7–§10) */
  subjectId?: string
  entries?: { studentId: string; status: string }[]
}

/**
 * PUT /api/teacher/class-attendance/draft — persist the CLASS TEACHER'S
 * OPEN, NOT-YET-SUBMITTED attendance sheet (spec §11 autosave + §7–§10
 * ownership). Only the appointed class teacher may keep a draft: a subject
 * teacher is view-only and can never stage attendance, not even for her
 * own subject. This never writes the canonical Attendance rows: a draft
 * is a draft. The roster is validated server-side (entries may be partial
 * — a half-marked sheet is honest progress, it just can never
 * auto-finalize), statuses are validated, and the draft is keyed
 * one-per-class+date. An explicit Save/Submit (baseline) deletes the
 * draft; the school's end-of-day boundary finalizes it when policy allows.
 */
export async function PUT(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = (await request.json().catch(() => null)) as DraftBody | null
      if (!body?.classId || !body?.date || !Array.isArray(body.entries)) {
        throw new Error('classId, date and entries are required')
      }
      const day = parseDateParam(body.date)
      if (day.getTime() > Date.now() + 86_400_000) throw new Error('Future dates cannot be marked')

      const { isClassTeacher } = await resolveClassScope(user, schoolId, body.classId)
      if (!isClassTeacher) {
        throw new Error(
          'Attendance is managed by the class teacher. Subject teachers have view-only access.',
        )
      }

      const students = await db.student.findMany({
        where: { classId: body.classId, user: { status: 'ACTIVE' } },
        select: { id: true },
      })
      const rosterIds = new Set(students.map((s) => s.id))
      const seen = new Set<string>()
      const entries = body.entries.filter((e) => {
        if (!rosterIds.has(e.studentId) || !isValidStatus(e.status) || seen.has(e.studentId)) return false
        seen.add(e.studentId)
        return true
      })

      // An empty draft after filtering = nothing worth persisting; clear
      // any previous draft instead of storing junk.
      if (entries.length === 0) {
        await db.attendanceDraft.deleteMany({
          where: { classId: body.classId, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
        })
        return { saved: 0, cleared: true }
      }

      // PHANTOM-DRAFT GUARD — a debounced autosave can race the explicit
      // Save (the PUT fires while the baseline POST transaction is still
      // committing): the canonical rows land, then the draft is re-created
      // for a day whose record already says the same thing. A draft that
      // is IDENTICAL to the canonical record is meaningless — clear it and
      // report a no-op instead of upserting. A genuinely different draft
      // (a post-save EDIT in progress) is kept untouched.
      const canonicalRows = await db.attendance.findMany({
        where: {
          schoolId,
          classId: body.classId,
          date: { gte: day, lt: new Date(day.getTime() + 86_400_000) },
        },
        select: { studentId: true, status: true },
      })
      if (canonicalRows.length > 0) {
        const canonicalByStudent = new Map(canonicalRows.map((r) => [r.studentId, r.status]))
        const inSync = entries.every(
          (e) => canonicalByStudent.get(e.studentId) === e.status,
        )
        if (inSync) {
          await db.attendanceDraft.deleteMany({
            where: { classId: body.classId, date: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
          })
          return { saved: entries.length, inSyncWithCanonical: true, cleared: true }
        }
      }

      await db.attendanceDraft.upsert({
        where: { classId_date: { classId: body.classId, date: day } },
        create: {
          schoolId,
          classId: body.classId,
          date: day,
          entries: JSON.stringify(entries),
          updatedById: user.id,
          updatedByName: user.name ?? 'Teacher',
          source: 'BASELINE',
        },
        update: {
          entries: JSON.stringify(entries),
          updatedById: user.id,
          updatedByName: user.name ?? 'Teacher',
          source: 'BASELINE',
        },
      })
      return { saved: entries.length }
    },
    { roles: ['TEACHER'] }
  )
}

/**
 * POST /api/teacher/class-attendance/draft?classId=&date= — the
 * end-of-school-hours AUTOSAVE (spec §11): finalize the CLASS TEACHER'S
 * open draft into the canonical record once the school's configured
 * end-of-day boundary has passed (policy permitting). Idempotent — no
 * draft / already submitted / before the boundary all return honest
 * outcomes. Subject teachers are view-only (§7–§10) and never finalize.
 */
export async function POST(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const url = new URL(request.url)
      const classId = url.searchParams.get('classId')
      const date = url.searchParams.get('date')
      if (!classId || !date) throw new Error('classId and date are required')
      parseDateParam(date)

      const { isClassTeacher } = await resolveClassScope(user, schoolId, classId)
      if (!isClassTeacher) {
        throw new Error(
          'Attendance is managed by the class teacher. Subject teachers have view-only access.',
        )
      }

      const settings = await attendanceSettingsFor(schoolId)
      // Phase 4 (item 8): the deferred finalization runs as a TRACKED job —
      // JobRun row + structured logs (job id, start/finish, duration,
      // success/failure, error). No idempotencyKey: this is a re-check job
      // whose fn is state-idempotent (no draft / already-submitted are
      // honest no-op outcomes — the Phase-3 test suite proves the
      // double-submit case).
      const outcome = await runJob({
        name: 'attendance-draft-autofinalize',
        schoolId,
        trigger: 'request',
        fn: () => finalizeDraftIfDue({ schoolId, classId, dayKey: date, settings }),
      })
      const result =
        outcome.status === 'success'
          ? outcome.result ?? { finalized: false, reason: 'no-draft' as const }
          : { finalized: false, reason: 'no-draft' as const }
      return {
        ...result,
        jobStatus: outcome.status,
        boundaryPassed:
          date !== istDayKey() || istMinutesNow() >= settings.endOfDayMinutes,
        endOfDayMinutes: settings.endOfDayMinutes,
      }
    },
    { roles: ['TEACHER'] }
  )
}
