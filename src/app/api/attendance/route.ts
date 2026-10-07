import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  parseDateParam,
  resolveClassScope,
  isValidStatus,
  istDayKey,
  type AttendanceStatusValue,
} from '@/lib/class-attendance'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { searchParams } = new URL(req.url)
      const classId = searchParams.get('classId')
      const date = searchParams.get('date')
      const month = searchParams.get('month')

      // Month rollup mode: GET /api/attendance?month=YYYY-MM[&classId=]
      // → one row per (class, calendar day) with the real status counts —
      // the principal Attendance History tab's data source (no fabricated
      // corpora; months without records return an honest empty list).
      if (month) {
        const m = /^(\d{4})-(\d{2})$/.exec(month.trim())
        if (!m) throw new AppError('INVALID_INPUT', { publicMessage: 'month must be YYYY-MM' })
        const year = Number(m[1])
        const mon = Number(m[2])
        if (mon < 1 || mon > 12) throw new AppError('INVALID_INPUT', { publicMessage: 'month must be YYYY-MM' })
        const start = new Date(Date.UTC(year, mon - 1, 1))
        const end = new Date(Date.UTC(year, mon, 1))
        const monthWhere: Record<string, unknown> = {
          schoolId,
          date: { gte: start, lt: end },
        }
        if (classId) monthWhere.classId = classId
        // Status breakdown per (class, day): statuses are stored as
        // PRESENT/ABSENT/LATE/LEAVE — count them per group.
        const detail = await db.attendance.findMany({
          where: monthWhere as never,
          select: { classId: true, date: true, status: true },
        })
        const classes = await db.class.findMany({
          where: { schoolId },
          select: { id: true, name: true, section: true },
        })
        const classById = new Map(classes.map((c) => [c.id, c]))
        const groups = new Map<string, { classId: string; date: Date; total: number; present: number; absent: number; late: number; leave: number }>()
        for (const r of detail) {
          const key = `${r.classId}|${r.date.toISOString().slice(0, 10)}`
          let g = groups.get(key)
          if (!g) {
            g = { classId: r.classId, date: r.date, total: 0, present: 0, absent: 0, late: 0, leave: 0 }
            groups.set(key, g)
          }
          g.total += 1
          const st = (r.status ?? '').toUpperCase()
          if (st === 'PRESENT') g.present += 1
          else if (st === 'ABSENT') g.absent += 1
          else if (st === 'LATE') g.late += 1
          else if (st === 'LEAVE') g.leave += 1
        }
        const records = [...groups.values()]
          .map((g) => {
            const cls = classById.get(g.classId)
            const attended = g.present + g.late
            const rate = g.total > 0 ? Math.round((attended / g.total) * 1000) / 10 : 0
            return {
              date: g.date.toISOString().slice(0, 10),
              classId: g.classId,
              className: cls ? `${cls.name}` : 'Class',
              section: cls?.section ?? '',
              total: g.total,
              present: g.present,
              late: g.late,
              absent: g.absent,
              leave: g.leave,
              rate,
              status: rate >= 95 ? 'Excellent' : rate >= 90 ? 'Good' : 'Needs Attention',
            }
          })
          .sort((a, b) => (a.date === b.date ? a.className.localeCompare(b.className) : a.date.localeCompare(b.date)))
        return { month: month.trim(), records }
      }

      const where: Record<string, unknown> = { schoolId }
      if (classId) where.classId = classId
      if (date) where.date = new Date(date)
      const rows = await db.attendance.findMany({
        where,
        include: { student: { include: { user: { select: { name: true } } } } },
        orderBy: { date: 'desc' },
        take: 500,
      })
      return rows
    },
    // Audit §11 — attendance rosters are staff-only; students read their
    // own rows through /api/student/dashboard.
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}

// POST /api/attendance — the LEGACY bulk class-day marker. The canonical
// teacher flow is /api/teacher/class-attendance/** (baseline + drafts +
// audit journal); nothing in the client POSTs here (grep-verified — the
// tenant-isolation suite still pins this endpoint's fail-safe behaviour,
// so the handler is retained, hardened, and PIH-4b day-anchored).
//
// Hardening model (mirrors the class-attendance service):
//   · classId must exist in the CALLER's school (fail-safe 404)
//   · PRINCIPAL/MANAGEMENT may mark any class; a TEACHER must have
//     class-teacher/CSA scope for the target class (resolveClassScope)
//   · the roster is re-derived server-side; any entry whose studentId is
//     not an ACTIVE student of that class+school → 404 (fail-safe, no
//     silent foreign writes)
//   · status must be in the canonical vocabulary (PRESENT/ABSENT/LATE/LEAVE)
//   · the write itself is tenant-safe: an existing { studentId, date } row
//     belonging to ANOTHER school is never touched (404), same-school rows
//     update, otherwise a new row is created carrying the caller's schoolId.
//   · PIH-4b: an omitted date defaults to TODAY ANCHORED AT MIDNIGHT UTC
//     (the canonical day key — a time-of-day `new Date()` wrote rows the
//     day-level unique can never reconcile), and markedBy stores the
//     caller's DISPLAY NAME (the canonical provenance convention).
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => null)
      const classId = typeof body?.classId === 'string' ? body.classId : ''
      const entries: Array<{ studentId: string; status: string }> = Array.isArray(body?.entries)
        ? body.entries
        : []
      if (!classId || !entries.length) throw new Error('classId and entries[] required')

      const date = body?.date ? parseDateParam(body.date) : parseDateParam(istDayKey())

      // ── Class belongs to the caller's school ──
      const cls = await db.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true },
      })
      if (!cls) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Class not found',
          internalDetail: `attendance POST: class ${classId} missing or foreign tenant`,
        })
      }

      // ── Role gate: TEACHER needs class-teacher/CSA scope for this class ──
      if (user.role === 'TEACHER') {
        await resolveClassScope(user, schoolId, classId) // throws NOT_FOUND / FORBIDDEN
      }

      // ── Roster truth from the server, never the request ──
      const roster = await db.student.findMany({
        where: { classId, schoolId, user: { status: 'ACTIVE' } },
        select: { id: true },
      })
      const rosterIds = new Set(roster.map((s) => s.id))

      const seen = new Set<string>()
      const valid: { studentId: string; status: AttendanceStatusValue }[] = []
      for (const e of entries) {
        if (!e || typeof e.studentId !== 'string') {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: 'attendance POST: malformed entry (studentId missing)',
          })
        }
        // Fail-safe: a studentId outside this class's roster (foreign
        // school, wrong class, or invented) is a 404, never a silent write.
        if (!rosterIds.has(e.studentId)) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: `attendance POST: student ${e.studentId} not in roster of class ${classId}`,
          })
        }
        if (!isValidStatus(e.status)) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: 'Status must be one of PRESENT, ABSENT, LATE, LEAVE',
            internalDetail: `attendance POST: invalid status ${String(e.status).slice(0, 40)}`,
          })
        }
        if (seen.has(e.studentId)) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: 'Each student may appear only once',
            internalDetail: `attendance POST: duplicate entry for ${e.studentId}`,
          })
        }
        seen.add(e.studentId)
        valid.push({ studentId: e.studentId, status: e.status })
      }

      // ── Tenant-safe upsert (never overwrite another school's row) ──
      await trackedTransaction('attendance-batch-mark', async (tx) => {
        for (const e of valid) {
          const existing = await tx.attendance.findFirst({
            where: { studentId: e.studentId, date },
            select: { id: true, schoolId: true },
          })
          if (existing && existing.schoolId !== schoolId) {
            // Cross-tenant collision on the (studentId, date) unique key:
            // the row "does not exist" for this caller — never overwrite.
            throw new AppError('RESOURCE_NOT_FOUND', {
              publicMessage: 'Student not found',
              internalDetail: `attendance POST: (student, date) row belongs to school ${existing.schoolId}`,
            })
          }
          if (existing) {
            await tx.attendance.update({
              where: { id: existing.id },
              data: { status: e.status, markedBy: user.name ?? user.id, classId },
            })
          } else {
            await tx.attendance.create({
              data: {
                schoolId,
                studentId: e.studentId,
                classId,
                date,
                status: e.status,
                markedBy: user.name ?? user.id,
              },
            })
          }
        }
      })
      return { marked: valid.length, date }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}
