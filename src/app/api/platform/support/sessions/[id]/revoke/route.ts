import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokeSupportSession } from '@/lib/platform/auth'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/support/sessions/[id]/revoke — kill an active
 * support session (support tool). Permission: support.access.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'support.access' },
    async (ctx) => {
      const session = await db.supportSession.findUnique({
        where: { id },
        include: { school: { select: { id: true, name: true } } },
      })
      if (!session) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Support session not found' })
      }

      await revokeSupportSession(session.id)
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.support_session.revoked',
        targetType: 'SUPPORT_SESSION',
        targetId: session.id,
        schoolId: session.schoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: `revoked by control plane (was: ${session.reason})`,
        metadata: { schoolName: session.school.name },
      })
      return { ok: true }
    },
    { method: 'POST' },
  )
}
