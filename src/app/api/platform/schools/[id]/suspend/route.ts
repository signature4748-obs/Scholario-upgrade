import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'

const suspendSchema = strictBody({ reason: z.string().min(10).max(400) })

/**
 * POST /api/platform/schools/[id]/suspend — DESTRUCTIVE, STEP-UP + REASON.
 *
 * Effects (all audited):
 *   · school.status → SUSPENDED;
 *   · every live school Session for the tenant is revoked (users are
 *     signed out immediately);
 *   · school login refuses the tenant's users (SCHOOL_SUSPENDED).
 *
 * Permission: schools.manage + a live step-up (recent MFA).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, suspendSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (school.status === 'SUSPENDED') {
        throw new AppError('CONFLICT', { publicMessage: 'School is already suspended' })
      }

      // Revoke every live school session of the tenant (best-effort count).
      const revoked = await db.session.deleteMany({
        where: { user: { schoolId: school.id }, expiresAt: { gt: new Date() } },
      })

      await db.school.update({ where: { id }, data: { status: 'SUSPENDED' } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.suspended',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: { revokedSessions: revoked.count },
      })

      return { ok: true, status: 'SUSPENDED', revokedSessions: revoked.count }
    },
    { method: 'POST' },
  )
}
