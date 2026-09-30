import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * DELETE /api/platform/announcements/[id] — retract a platform
 * announcement (row kept in history; removed from school surfaces by
 * the delete). Permission: announcements.manage.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'announcements.manage' },
    async (ctx) => {
      const announcement = await db.platformAnnouncement.findUnique({ where: { id } })
      if (!announcement) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Announcement not found' })
      }

      await db.platformAnnouncement.delete({ where: { id } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.announcement.deleted',
        targetType: 'ANNOUNCEMENT',
        targetId: announcement.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `retracted "${announcement.title}"`,
      })
      return { ok: true }
    },
    { method: 'DELETE' },
  )
}
