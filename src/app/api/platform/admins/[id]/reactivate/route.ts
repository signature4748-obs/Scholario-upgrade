import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/admins/[id]/reactivate — restore a suspended
 * platform admin (safe direction; audited). Permission: admins.manage.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'admins.manage' },
    async (ctx) => {
      const admin = await db.platformAdmin.findUnique({ where: { id } })
      if (!admin) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Platform admin not found' })
      }
      if (admin.status !== 'SUSPENDED') {
        throw new AppError('CONFLICT', { publicMessage: 'Admin is not suspended' })
      }

      await db.platformAdmin.update({ where: { id }, data: { status: 'ACTIVE' } })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.reactivated',
        targetType: 'ADMIN',
        targetId: admin.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `reactivated ${admin.email}`,
      })
      return { ok: true }
    },
    { method: 'POST' },
  )
}
