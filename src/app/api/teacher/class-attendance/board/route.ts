import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  parseDateParam,
  resolveClassScope,
  resolveClassScopeOrNull,
  attendanceSettingsFor,
} from '@/lib/class-attendance'
import { classLabelOf } from '@/lib/teacher-hub'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/class-attendance/board?classId=&date= — one attendance
 * board: the roster, the class-teacher baseline for that date (what
 * subject teachers prefill from), the caller's own subject sessions for
 * that date, the open draft (autosave resume, §19), the school's
 * end-of-day autosave policy, and the class's recent attendance audit
 * trail (§18). Reading NEVER writes anything.
 */
export async function GET(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const url = new URL(request.url)
      const classId = url.searchParams.get('classId')
      const date = url.searchParams.get('date')
      if (!classId) throw new Error('classId is required')
      const day = parseDateParam(date)
      const nextDay = new Date(day.getTime() + 86_400_000)

      const { isClassTeacher, subjects } = await resolveClassScope(user, schoolId, classId)
      // The appointed class teacher's name — the subject-teacher view uses
      // it for the honest “managed by {name}” context (§9–§10).
      const scopeInfo = await resolveClassScopeOrNull(user, schoolId, classId)
      const classTeacherName = scopeInfo?.classTeacherName ?? null
      const cls = await db.class.findUnique({
        where: { id: classId },
        select: { name: true, section: true },
      })
      const students = await db.student.findMany({
        where: { classId, user: { status: 'ACTIVE' } },
        select: { id: true, rollNo: true, user: { select: { name: true } } },
        orderBy: { rollNo: 'asc' },
      })

      // Class-teacher baseline for the date (official daily record).
      // Dedupe by student (latest row wins) — legacy rows may carry times.
      const baselineRaw = await db.attendance.findMany({
        where: { classId, date: { gte: day, lt: nextDay } },
        select: { studentId: true, status: true, markedBy: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
      const byStudent = new Map<string, (typeof baselineRaw)[number]>()
      for (const r of baselineRaw) byStudent.set(r.studentId, r)
      const baselineRows = [...byStudent.values()]
      const baseline =
        baselineRows.length > 0
          ? {
              exists: true,
              entries: Object.fromEntries(baselineRows.map((r) => [r.studentId, r.status])) as Record<string, string>,
              markedBy: baselineRows[0]?.markedBy ?? null,
              savedAt: baselineRows[0]?.createdAt?.toISOString() ?? null,
              counts: {
                present: baselineRows.filter((r) => r.status === 'PRESENT').length,
                absent: baselineRows.filter((r) => r.status === 'ABSENT').length,
                late: baselineRows.filter((r) => r.status === 'LATE').length,
                leave: baselineRows.filter((r) => r.status === 'LEAVE').length,
              },
            }
          : { exists: false, entries: {}, markedBy: null, savedAt: null, counts: { present: 0, absent: 0, late: 0, leave: 0 } }

      // The open draft for this class-day (§19 resume) — never a second
      // attendance record, just the not-yet-submitted sheet.
      const draftRow = await db.attendanceDraft.findUnique({
        where: { classId_date: { classId, date: day } },
      })
      let draftEntries: Record<string, string> = {}
      if (draftRow) {
        try {
          const parsed = JSON.parse(draftRow.entries) as { studentId: string; status: string }[]
          draftEntries = Object.fromEntries(parsed.map((e) => [e.studentId, e.status]))
        } catch {
          draftEntries = {}
        }
      }
      const draft = draftRow
        ? {
            exists: true as const,
            entries: draftEntries,
            source: draftRow.source,
            updatedAt: draftRow.updatedAt.toISOString(),
            updatedByName: draftRow.updatedByName,
          }
        : { exists: false as const, entries: {}, source: null, updatedAt: null, updatedByName: null }

      // Recent attendance audit trail for the class (§18) — the last 8
      // journaled changes inside a 30-day window, student-named.
      const auditSince = new Date(Date.now() - 30 * 86_400_000)
      const auditRows = await db.attendanceAuditLog.findMany({
        where: { classId, date: { gte: auditSince } },
        select: {
          studentId: true,
          previousStatus: true,
          newStatus: true,
          source: true,
          changedBy: true,
          date: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })
      const nameById = new Map(students.map((s) => [s.id, s.user?.name ?? 'Student']))
      const audit = auditRows.map((r) => ({
        studentName: nameById.get(r.studentId) ?? 'Student',
        previousStatus: r.previousStatus,
        newStatus: r.newStatus,
        source: r.source,
        changedBy: r.changedBy,
        date: r.date.toISOString().slice(0, 10),
        createdAt: r.createdAt.toISOString(),
      }))

      // The school's end-of-day autosave policy (§19) — the UI shows the
      // boundary honestly; finalization itself is an explicit POST.
      const settings = await attendanceSettingsFor(schoolId)

      // Recent history: the last 10 MARKED school days for this class (the
      // official baselines), inside a 30-calendar-day lookback window ending
      // at TODAY (not the viewed date — the week strip and insights describe
      // the class around now). Rows are stored at midnight UTC (the baseline
      // contract), so the UTC day key is exact.
      const historyUntil = new Date()
      historyUntil.setUTCHours(0, 0, 0, 0)
      historyUntil.setUTCDate(historyUntil.getUTCDate() + 1)
      const historySince = new Date(historyUntil.getTime() - 30 * 86_400_000)
      const historyRaw = await db.attendance.findMany({
        where: { classId, date: { gte: historySince, lt: historyUntil } },
        select: { studentId: true, status: true, date: true },
      })
      const byDay = new Map<string, Map<string, string>>()
      for (const r of historyRaw) {
        const key = r.date.toISOString().slice(0, 10)
        let dayEntries = byDay.get(key)
        if (!dayEntries) {
          dayEntries = new Map()
          byDay.set(key, dayEntries)
        }
        dayEntries.set(r.studentId, r.status) // unique per student+date — last row wins
      }
      const historyDays = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-10)
        .map(([dateKey, entries]) => {
          const counts = {
            present: 0,
            absent: 0,
            late: 0,
            leave: 0,
          }
          for (const status of entries.values()) {
            if (status === 'PRESENT') counts.present++
            else if (status === 'ABSENT') counts.absent++
            else if (status === 'LATE') counts.late++
            else if (status === 'LEAVE') counts.leave++
          }
          const total = counts.present + counts.absent + counts.late + counts.leave
          return {
            date: dateKey,
            counts,
            rate: total > 0 ? counts.present / total : 0,
            entries: Object.fromEntries(entries) as Record<string, string>,
          }
        })

      return {
        classId,
        label: cls ? classLabelOf(cls) : 'Class',
        date: url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10),
        isClassTeacher,
        classTeacherName,
        subjects,
        students: students.map((s) => ({ id: s.id, rollNo: s.rollNo, name: s.user?.name ?? 'Student' })),
        baseline,
        draft,
        audit,
        autosave: settings,
        history: { days: historyDays },
      }
    },
    { feature: 'attendance.mark', roles: ['TEACHER'] }
  )
}
