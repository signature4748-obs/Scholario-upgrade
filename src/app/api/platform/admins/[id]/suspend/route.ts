import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokeAllPlatformSessions } from '@/lib/platform/auth'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/admins/[id]/suspend — DESTRUCTIVE (kills an
 * admin's access) → admins.manage + STEP-UP. Every live session of the
 * admin is revoked immediately.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'admins.manage', stepUp: true },
    async (ctx) => {
      const admin = await db.platformAdmin.findUnique({ where: { id } })
      if (!admin) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Platform admin not found' })
      }
      if (admin.id === ctx.admin.id) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'You cannot suspend your own account' })
      }
      if (admin.status === 'SUSPENDED') {
        throw new AppError('CONFLICT', { publicMessage: 'Admin is already suspended' })
      }

      await db.platformAdmin.update({ where: { id }, data: { status: 'SUSPENDED' } })
      const revoked = await revokeAllPlatformSessions(admin.id)

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.suspended',
        targetType: 'ADMIN',
        targetId: admin.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `suspended ${admin.email}`,
        metadata: { revokedSessions: revoked },
      })

      return { ok: true, revokedSessions: revoked }
    },
    { method: 'POST' },
  )
}
