import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  parseDateParam,
  resolveClassScope,
  isValidStatus,
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
// audit journal); nothing in the client POSTs here (grep-verified), but
// the endpoint is hardened anyway (3-d audit: it previously upserted by
// bare { studentId, date } — a cross-tenant collision on the unique key
// would have OVERWRITTEN the other school's canonical record).
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

      const date = body?.date ? parseDateParam(body.date) : new Date()

      // ── Class belongs to the caller's school ──
      const cls = await db.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true },
      })
      if (!cls) {
        throw new AppError('NOT_FOUND', {
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
          throw new AppError('NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: 'attendance POST: malformed entry (studentId missing)',
          })
        }
        // Fail-safe: a studentId outside this class's roster (foreign
        // school, wrong class, or invented) is a 404, never a silent write.
        if (!rosterIds.has(e.studentId)) {
          throw new AppError('NOT_FOUND', {
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
      await db.$transaction(async (tx) => {
        for (const e of valid) {
          const existing = await tx.attendance.findFirst({
            where: { studentId: e.studentId, date },
            select: { id: true, schoolId: true },
          })
          if (existing && existing.schoolId !== schoolId) {
            // Cross-tenant collision on the (studentId, date) unique key:
            // the row "does not exist" for this caller — never overwrite.
            throw new AppError('NOT_FOUND', {
              publicMessage: 'Student not found',
              internalDetail: `attendance POST: (student, date) row belongs to school ${existing.schoolId}`,
            })
          }
          if (existing) {
            await tx.attendance.update({
              where: { id: existing.id },
              data: { status: e.status, markedBy: user.id, classId },
            })
          } else {
            await tx.attendance.create({
              data: {
                schoolId,
                studentId: e.studentId,
                classId,
                date,
                status: e.status,
                markedBy: user.id,
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
