import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Mechanical withAuthz migration of the previous withUser + schoolScoped
  // (no role gate before, none added — assignments are not sensitive and
  // students already receive theirs through /api/student/dashboard).
  return withAuthz({}, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const items = await db.assignment.findMany({
      where: { schoolId, ...(classId ? { classId } : {}) },
      include: { class: true, subject: true, creator: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return items
  })
}

/// POST — 3-c fix: classId / subjectId are FK-validated in-tenant before
/// the Assignment row is created (both are optional, but a provided id
/// must exist in THIS school → 404 otherwise; no cross-tenant FK writes).
export async function POST(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const body = await req.json().catch(() => ({}))
      const title = String(body.title || '').trim()
      if (!title) throw new AppError('INVALID_INPUT', { publicMessage: 'title required' })

      if (body.classId) {
        const cls = await db.class.findFirst({
          where: { id: String(body.classId), schoolId },
          select: { id: true },
        })
        if (!cls) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Class not found',
            internalDetail: `assignments POST: class ${body.classId} missing or foreign tenant`,
          })
        }
      }
      if (body.subjectId) {
        const subject = await db.subject.findFirst({
          where: { id: String(body.subjectId), schoolId },
          select: { id: true },
        })
        if (!subject) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Subject not found',
            internalDetail: `assignments POST: subject ${body.subjectId} missing or foreign tenant`,
          })
        }
      }

      const a = await db.assignment.create({
        data: {
          schoolId,
          classId: body.classId || null,
          subjectId: body.subjectId || null,
          title,
          description: body.description || null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          createdBy: ctx.user.id,
        },
      })
      return a
    },
  )
}
