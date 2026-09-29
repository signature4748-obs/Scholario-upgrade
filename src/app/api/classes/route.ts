import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { searchParams } = new URL(req.url)
      const withCounts = searchParams.get('counts') === '1'
      const classes = await db.class.findMany({
        where: { schoolId },
        orderBy: { gradeLevel: 'asc' },
        include: withCounts
          ? { _count: { select: { students: true, subjects: true } } }
          : undefined,
      })
      return classes
    },
    // Audit §11 — class registry is staff-only (teacher surfaces use
    // /api/teacher/* payloads scoped to their own classes).
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const name = String(body.name || '').trim()
      if (!name) throw new Error('Class name is required')
      // Task 4-d (audit 3-a fix #4): classTeacherId is client input — a
      // foreign school's teacher id must NOT be linked into this school's
      // class (cross-tenant FK injection). Class.classTeacherId stores the
      // teacher's USER id, so the lookup is teacher.userId + schoolId.
      // (The add-class flow only ever submits this school's teachers —
      // valid ids pass unchanged; foreign/unknown ids fail-safe 404.)
      const classTeacherId =
        typeof body.classTeacherId === 'string' && body.classTeacherId.trim() ? body.classTeacherId.trim() : null
      if (classTeacherId) {
        const teacher = await db.teacher.findFirst({
          where: { userId: classTeacherId, schoolId },
          select: { userId: true },
        })
        if (!teacher) {
          throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Teacher not found in this school' })
        }
      }
      const cls = await db.class.create({
        data: {
          schoolId,
          name,
          gradeLevel: String(body.gradeLevel || ''),
          section: body.section || null,
          capacity: Number(body.capacity) || 40,
          room: body.room || null,
          classTeacherId,
        },
      })
      return cls
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
