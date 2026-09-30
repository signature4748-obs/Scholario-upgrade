import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireStudent } from '@/lib/learning'

export const runtime = 'nodejs'

/// GET /api/student/attendance
///
/// 7-b — the REAL personal attendance record behind the Student
/// "My Attendance" module. Identity is resolved entirely server-side
/// (erp_session cookie → user → student → school), exactly like the
/// sibling /api/student/* routes — a client-supplied studentId is never
/// trusted, so a student can only ever read their OWN Attendance rows.
///
/// Window: the last 90 days (date desc). Every row the Teacher/Principal
/// marking flow writes (canonical Attendance rows, last-write-wins on the
/// (studentId, date) unique) is visible here — including corrections,
/// because an edit updates the same row.
///
/// Response shape:
///   { records: Array<{ date: 'YYYY-MM-DD', status: 'present'|'late'|'absent'|'leave',
///                       className: string | null, note: null,
///                       markedAt: string /* ISO */ }>,
///     windowDays: 90, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
///
/// No fabricated rows: a student with no teacher-marked records yet gets
/// an empty array (the module renders its honest empty state).
export async function GET(_req: NextRequest) {
  return withUser(
    async (user) => {
      const ctx = await requireStudent(user)

      // ── Window: [today − 90 days, today] (UTC calendar days — the marking
      // flow stores dates as UTC midnights from YYYY-MM-DD strings). ──
      const to = new Date()
      to.setUTCHours(23, 59, 59, 999)
      const from = new Date(to)
      from.setUTCDate(from.getUTCDate() - 90)
      from.setUTCHours(0, 0, 0, 0)

      const rows = await db.attendance.findMany({
        where: { studentId: ctx.studentId, date: { gte: from, lte: to } },
        orderBy: { date: 'desc' },
        include: { class: { select: { name: true } } },
        take: 200,
      })

      // Last-write-wins per calendar day (same convention as the attendance
      // overview route): legacy rows can share a date when the time-of-day
      // component differed, so the LATEST write is the current status.
      const latestByDay = new Map<string, (typeof rows)[number]>()
      for (const r of rows) {
        const day = r.date.toISOString().slice(0, 10)
        const prev = latestByDay.get(day)
        if (!prev || prev.createdAt <= r.createdAt) latestByDay.set(day, r)
      }

      const records = [...latestByDay.values()]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .map((r) => ({
          date: r.date.toISOString().slice(0, 10),
          status: normalizeStatus(r.status),
          className: r.class?.name ?? ctx.classLabel ?? null,
          note: null,
          markedAt: r.createdAt.toISOString(),
        }))

      return {
        records,
        windowDays: 90,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      }
    },
    { roles: ['STUDENT'] },
  )
}

/** DB vocabulary (PRESENT/ABSENT/LATE/LEAVE) → the student module's lowercase tokens. */
function normalizeStatus(status: string): 'present' | 'late' | 'absent' | 'leave' {
  switch (status) {
    case 'PRESENT':
      return 'present'
    case 'LATE':
      return 'late'
    case 'ABSENT':
      return 'absent'
    case 'LEAVE':
      return 'leave'
    default:
      return 'absent'
  }
}
