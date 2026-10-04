import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * SaaS-HARDENING (§8) — school-plane identity change-request workflow.
 *
 *   GET  /api/school-settings/profile-change-request
 *        → this school's requests + their review states (own tenant only)
 *   POST /api/school-settings/profile-change-request
 *        → principal requests a LEGAL identity change (name/code/
 *          affiliation). The request lands as PENDING for a PLATFORM
 *          admin to review — the principal can never apply it directly.
 *
 * Tenant scoping: session-derived school only; cross-tenant requests do
 * not exist on this route by construction.
 */

const REQUESTABLE_FIELDS = {
  name: 'Legal school name',
  code: 'School code',
  affiliation: 'Affiliation number',
} as const
type RequestableField = keyof typeof REQUESTABLE_FIELDS

const createSchema = strictBody({
  field: z.enum(['name', 'code', 'affiliation']),
  requestedValue: z.string().trim().min(2).max(160),
  reason: z.string().trim().min(10).max(600),
})

export async function GET() {
  return withUser(async (user) => {
    if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
      throw new AppError('FORBIDDEN', {
        publicMessage: 'Only the principal or management can view identity change requests.',
        internalDetail: `profile-change-requests GET by role ${user.role}`,
      })
    }
    const schoolId = schoolScoped(user)
    const rows = await db.schoolProfileChangeRequest.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return {
      requests: rows.map((r) => ({
        id: r.id,
        field: r.field,
        fieldLabel: REQUESTABLE_FIELDS[r.field as RequestableField] ?? r.field,
        currentValue: r.currentValue,
        requestedValue: r.requestedValue,
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      fields: Object.entries(REQUESTABLE_FIELDS).map(([value, label]) => ({ value, label })),
    }
  })
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only the principal or management can request an identity change.',
          internalDetail: `profile-change-request POST by role ${user.role}`,
        })
      }
      const schoolId = schoolScoped(user)
      enforceRateLimit(`rl:idreq:${schoolId}`, RATE_LIMITS.message)

      const body = await parseJsonBody(req, createSchema)

      // One OPEN request per field (a second open request is a conflict —
      // review the pending one first; honest, no silent replacement).
      const open = await db.schoolProfileChangeRequest.findFirst({
        where: { schoolId, field: body.field, status: 'PENDING' },
      })
      if (open) {
        throw new AppError('CONFLICT', {
          publicMessage: `A request to change the ${REQUESTABLE_FIELDS[body.field]} is already pending review.`,
        })
      }

      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { name: true, code: true, affiliation: true },
      })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      const currentValue =
        body.field === 'name'
          ? school.name
          : body.field === 'code'
            ? school.code
            : school.affiliation
      if ((currentValue ?? '') === body.requestedValue.trim()) {
        throw new AppError('CONFLICT', {
          publicMessage: 'The requested value is the same as the current one.',
        })
      }

      const row = await db.schoolProfileChangeRequest.create({
        data: {
          schoolId,
          field: body.field,
          currentValue: currentValue ?? null,
          requestedValue: body.requestedValue.trim(),
          reason: body.reason,
          status: 'PENDING',
          requestedById: user.id,
        },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'IDENTITY_CHANGE_REQUESTED',
        detail: `[${body.field}] → "${body.requestedValue.trim().slice(0, 80)}" — ${body.reason.slice(0, 200)}`,
      }).catch(() => {})

      return {
        ok: true,
        request: { id: row.id, field: row.field, status: row.status },
        message: 'Request submitted for platform review. You will see the outcome in this list.',
      }
    },
  )
}
