import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  parseDateParam,
  resolveClassScope,
  isValidStatus,
  writeCanonicalAttendance,
  istDayKey,
  type AttendanceStatusValue,
} from '@/lib/class-attendance'

export const runtime = 'nodejs'

interface BaselineBody {
  classId?: string
  date?: string
  entries?: { studentId: string; status: string }[]
}

/**
 * POST /api/teacher/class-attendance/baseline — the CLASS TEACHER saves
 * the official daily attendance for her class. Upserts the canonical
 * Attendance rows (unique per student+date) that students/parents see and
 * that subject teachers prefill from. Only the class teacher of this
 * class may write the baseline; the roster is re-derived server-side and
 * every status is validated. Every EDIT of an already-saved status is
 * journaled (AttendanceAuditLog — who/when/previous → new), and any open
 * draft for the day is cleared (an explicit save supersedes autosave).
 */
export async function POST(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = (await request.json().catch(() => null)) as BaselineBody | null
      if (!body?.classId || !body?.date || !Array.isArray(body.entries) || body.entries.length === 0) {
        throw new Error('classId, date and entries are required')
      }
      const day = parseDateParam(body.date)
      // TQA-6: the IST calendar is the authority — a date beyond the
      // school's TODAY (IST) is a future day and can never be marked.
      // (The old `Date.now() + 24h` window accepted a full day early.)
      const istToday = new Date(`${istDayKey()}T00:00:00.000Z`)
      if (day.getTime() > istToday.getTime()) throw new Error('Future dates cannot be marked')

      const { isClassTeacher } = await resolveClassScope(user, schoolId, body.classId)
      if (!isClassTeacher) throw new Error('FORBIDDEN — only the class teacher can save the daily baseline')

      // Roster truth comes from the server, never the request.
      const students = await db.student.findMany({
        where: { classId: body.classId, user: { status: 'ACTIVE' } },
        select: { id: true },
      })
      const rosterIds = new Set(students.map((s) => s.id))
      const seen = new Set<string>()
      const entries = body.entries.filter(
        (e): e is { studentId: string; status: AttendanceStatusValue } =>
          rosterIds.has(e.studentId) && isValidStatus(e.status) && !seen.has(e.studentId) && (seen.add(e.studentId), true)
      )
      if (entries.length !== rosterIds.size) {
        throw new Error('Every student needs a valid status')
      }

      const result = await writeCanonicalAttendance({
        schoolId,
        classId: body.classId,
        date: day,
        entries,
        actor: { id: user.id, name: user.name ?? 'Class Teacher' },
        source: 'BASELINE',
        markedBy: user.name ?? 'Class Teacher',
      })
      return { ...result, canonical: true }
    },
    { roles: ['TEACHER'] }
  )
}
