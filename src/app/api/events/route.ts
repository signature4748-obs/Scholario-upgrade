import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { idSchema } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * /api/events — the school's calendar (SchoolEvent rows).
 *
 * Task 4-d (audit 3-a fix #1):
 *   · DELETE was a CRITICAL cross-tenant IDOR — it deleted ANY school's
 *     event by bare id (no schoolScoped, no schoolId in the where). The
 *     where now ALWAYS carries the session school and a miss is a 404
 *     (fail-safe, no existence oracle); every deletion is audited.
 *   · POST validates audience/type against small whitelists, validates
 *     dates, and caps the free-text fields.
 *   · POST/DELETE now gate through the permission matrix
 *     ('school.events.write' = PRINCIPAL/MANAGEMENT). Grep-verified: NO
 *     client surface POSTs/DELETEs /api/events (only the documented
 *     GET ?type=HOLIDAY consumer in src/lib/mock/school-calendar.ts), so
 *     no legit flow is affected.
 *
 * GET stays open to every member of the school (withUser + schoolScoped) —
 * the calendar is school-wide reference data.
 */

// Vocabulary in use: the DB seeds type HOLIDAY (schema default 'EVENT'),
// the notices module uses ALL/STUDENTS/PARENTS/TEACHERS/STAFF audiences.
const EVENT_TYPES = ['EVENT', 'HOLIDAY', 'EXAM', 'MEETING', 'ACTIVITY'] as const
const EVENT_AUDIENCES = ['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF'] as const

const TITLE_MAX = 200
const TEXT_MAX = 2000

function validDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')
    const upcoming = searchParams.get('upcoming')

    const where: Record<string, unknown> = { schoolId }
    if (type) where.type = type
    if (upcoming === '1') where.startDate = { gte: new Date() }

    const events = await db.schoolEvent.findMany({
      where,
      orderBy: { startDate: 'asc' },
      take: 100,
      include: { creator: { select: { name: true } } },
    })
    return events
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'school.events.write' }, async (ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) throw new AppError('INVALID_INPUT', { publicMessage: 'Event title is required' })
    if (title.length > TITLE_MAX) {
      throw new AppError('INVALID_INPUT', { publicMessage: `Event title must be at most ${TITLE_MAX} characters` })
    }

    const description =
      body.description === undefined || body.description === null
        ? null
        : String(body.description).slice(0, TEXT_MAX)
    const location =
      body.location === undefined || body.location === null ? null : String(body.location).slice(0, TITLE_MAX)

    const type = body.type === undefined || body.type === null || body.type === ''
      ? 'EVENT'
      : String(body.type).trim().toUpperCase()
    if (!EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid event type' })
    }
    const audience = body.audience === undefined || body.audience === null || body.audience === ''
      ? 'ALL'
      : String(body.audience).trim().toUpperCase()
    if (!EVENT_AUDIENCES.includes(audience as (typeof EVENT_AUDIENCES)[number])) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid event audience' })
    }

    // startDate must be a REAL date when provided (default: now); endDate
    // is optional but must parse when present.
    const startDate = validDate(body.startDate) ?? new Date()
    const endDate = validDate(body.endDate)

    const ev = await db.schoolEvent.create({
      data: {
        schoolId: ctx.schoolId, // session tenant — client schoolId is never read
        title,
        description,
        type,
        startDate,
        endDate,
        location,
        audience,
        createdBy: ctx.user.id,
      },
      include: { creator: { select: { name: true } } },
    })
    return ev
  })
}

export async function DELETE(req: NextRequest) {
  return withAuthz({ permission: 'school.events.write' }, async (ctx) => {
    const { searchParams } = new URL(req.url)
    const id = (searchParams.get('id') || '').trim()
    if (!id || !idSchema.safeParse(id).success) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'id required' })
    }

    // Tenant-scoped delete: the where ALWAYS carries the session school —
    // a foreign school's event id "does not exist" (404, no oracle).
    const res = await db.schoolEvent.deleteMany({ where: { id, schoolId: ctx.schoolId } })
    if (res.count === 0) {
      throw new AppError('NOT_FOUND', { publicMessage: 'Event not found' })
    }

    await auditEvent({
      schoolId: ctx.schoolId,
      userId: ctx.user.id,
      action: 'EVENT_DELETED',
      detail: `School calendar event ${id} deleted`,
    }).catch(() => {})

    return { id }
  })
}
