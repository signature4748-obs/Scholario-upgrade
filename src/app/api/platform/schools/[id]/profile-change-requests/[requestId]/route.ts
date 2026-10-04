import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'

const reviewSchema = strictBody({
  action: z.enum(['approve', 'reject']),
  reviewNote: z.string().max(400).optional(),
})

const APPLICABLE_COLUMNS: Record<string, 'name' | 'code' | 'affiliation'> = {
  name: 'name',
  code: 'code',
  affiliation: 'affiliation',
}

/**
 * PATCH /api/platform/schools/[id]/profile-change-requests/[requestId]
 * — review a legal-identity change request (STEP-UP + schools.manage).
 *
 * approve → the requested value is applied to the School row (the ONLY
 *           path that mutates legal identity), the request is marked
 *           APPROVED, and the change is fully audited.
 * reject  → the request is marked REJECTED with the review note.
 *
 * Cross-tenant safety: the request must belong to THIS school (the path
 * tenant); a mismatched id is a 404 (no existence oracle).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, reviewSchema)
      const ip = clientIpFromHeaders(req.headers)

      const row = await db.schoolProfileChangeRequest.findFirst({
        where: { id: requestId, schoolId: id },
      })
      if (!row) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Change request not found' })
      }
      if (row.status !== 'PENDING') {
        throw new AppError('CONFLICT', {
          publicMessage: `This request was already ${row.status.toLowerCase()}.`,
        })
      }

      if (body.action === 'reject') {
        await db.schoolProfileChangeRequest.update({
          where: { id: row.id },
          data: {
            status: 'REJECTED',
            reviewNote: body.reviewNote ?? null,
            reviewedById: ctx.admin.id,
            reviewedAt: new Date(),
          },
        })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.school.identity_request_rejected',
          targetType: 'SCHOOL',
          targetId: id,
          schoolId: id,
          ip,
          reason: body.reviewNote ?? 'Identity change request rejected',
          metadata: { field: row.field, requestedValue: row.requestedValue },
        })
        return { ok: true, status: 'REJECTED' }
      }

      // approve → apply the change (the only legal-identity mutation path)
      const column = APPLICABLE_COLUMNS[row.field]
      if (!column) {
        throw new AppError('VALIDATION_FAILED', { publicMessage: 'Unsupported identity field' })
      }
      const value = row.requestedValue.trim()
      if (column === 'name' && value.length < 2) {
        throw new AppError('VALIDATION_FAILED', { publicMessage: 'School name too short' })
      }

      await db.$transaction([
        db.school.update({ where: { id }, data: { [column]: value } }),
        db.schoolProfileChangeRequest.update({
          where: { id: row.id },
          data: {
            status: 'APPROVED',
            reviewNote: body.reviewNote ?? null,
            reviewedById: ctx.admin.id,
            reviewedAt: new Date(),
          },
        }),
      ])

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.identity_changed',
        targetType: 'SCHOOL',
        targetId: id,
        schoolId: id,
        ip,
        reason: body.reviewNote ?? 'Identity change request approved and applied',
        metadata: { field: row.field, from: row.currentValue, to: value },
      })

      return { ok: true, status: 'APPROVED', applied: { field: row.field, value } }
    },
    { method: 'PATCH' },
  )
}
