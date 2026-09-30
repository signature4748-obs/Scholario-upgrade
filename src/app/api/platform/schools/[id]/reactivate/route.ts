import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/schools/[id]/reactivate — SUSPENDED → ACTIVE
 * (the safe direction; suspension itself needed step-up, this reversal
 * does not — it restores service, and is audited like everything else).
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
      if (school.status !== 'SUSPENDED') {
        throw new AppError('CONFLICT', { publicMessage: 'School is not suspended' })
      }

      await db.school.update({ where: { id }, data: { status: 'ACTIVE' } })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.reactivated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `reactivated ${school.name}`,
      })
      return { ok: true, status: 'ACTIVE' }
    },
    { method: 'POST' },
  )
}
