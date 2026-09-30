import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/schools/[id]/activate — PENDING → ACTIVE.
 *
 * The provisioning pipeline's explicit second step: until this runs, no
 * user of the school can sign in (school login requires status ACTIVE).
 * Permission: schools.manage. Not destructive (safe direction).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage' },
    async (ctx) => {
      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (school.status === 'ACTIVE') {
        throw new AppError('CONFLICT', { publicMessage: 'School is already active' })
      }
      if (school.status === 'SUSPENDED') {
        // Suspended schools come back through the explicit reactivate flow.
        throw new AppError('CONFLICT', {
          publicMessage: 'School is suspended — use Reactivate',
        })
      }

      await db.school.update({ where: { id }, data: { status: 'ACTIVE' } })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.activated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `activated ${school.name}`,
      })
      return { ok: true, status: 'ACTIVE' }
    },
    { method: 'POST' },
  )
}
