import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

// Task 4-d (audit 3-a fix #13): same plan/status vocabulary as
// POST /api/schools (see that route for the grep evidence).
const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const
const SCHOOL_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED'] as const

// GET school details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withUser(async (user) => {
    if (user.role !== 'SUPER_ADMIN' && user.schoolId !== id) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found', internalDetail: 'schools/[id]: cross-school read refused without existence oracle' })
    }

    const school = await db.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, students: true, teachers: true, classes: true, exams: true, fees: true },
        },
      },
    })

    if (!school) throw new Error('School not found')

    return {
      ...school,
      isDemo: Boolean(school.isDemo),
      counts: school._count,
    }
  })
}

// PATCH update school (Super Admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withUser(
    async (user) => {
      const body = await req.json().catch(() => ({}))

      const dataToUpdate: any = {}
      if (body.name !== undefined) dataToUpdate.name = String(body.name).trim()
      if (body.domain !== undefined) dataToUpdate.domain = String(body.domain).trim()
      if (body.code !== undefined) dataToUpdate.code = String(body.code).trim().toUpperCase()
      if (body.plan !== undefined) {
        const plan = String(body.plan).trim().toUpperCase()
        if (!SCHOOL_PLANS.includes(plan as (typeof SCHOOL_PLANS)[number])) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid plan' })
        }
        dataToUpdate.plan = plan
      }
      if (body.status !== undefined) {
        const status = String(body.status).trim().toUpperCase()
        if (!SCHOOL_STATUSES.includes(status as (typeof SCHOOL_STATUSES)[number])) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid status' })
        }
        dataToUpdate.status = status
      }
      if (body.city !== undefined) dataToUpdate.city = body.city
      if (body.phone !== undefined) dataToUpdate.phone = body.phone
      if (body.email !== undefined) dataToUpdate.email = body.email
      if (typeof body.isDemo === 'boolean') dataToUpdate.isDemo = body.isDemo

      const updated = await db.school.update({
        where: { id },
        data: dataToUpdate,
      })

      await db.activityLog.create({
        data: {
          schoolId: updated.id,
          userId: user.id,
          action: 'SCHOOL_UPDATED',
          detail: `School "${updated.name}" updated by ${user.email}`,
        },
      })

      return {
        ...updated,
        isDemo: Boolean(updated.isDemo),
      }
    },
    { roles: ['SUPER_ADMIN'] }
  )
}

// DELETE school (Super Admin only)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withUser(
    async (user) => {
      const school = await db.school.findUnique({ where: { id } })
      if (!school) throw new Error('School not found')

      await db.school.delete({ where: { id } })

      await db.activityLog.create({
        data: {
          userId: user.id,
          action: 'SCHOOL_DELETED',
          detail: `School "${school.name}" deleted by ${user.email}`,
        },
      })

      return { success: true, id }
    },
    { roles: ['SUPER_ADMIN'] }
  )
}
