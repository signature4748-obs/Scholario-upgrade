import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { auditEvent } from '@/lib/security/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/school-sessions/[id]/revoke — force-sign-out one
 * school-user session (support tool). The Session row is deleted (same
 * mechanism as the school's own logout). Audited on BOTH trails
 * (platform + the affected school's ActivityLog).
 *
 * Permission: support.access.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'support.access' },
    async (ctx) => {
      const session = await db.session.findUnique({
        where: { id },
        include: { user: { select: { id: true, name: true, role: true, schoolId: true, school: { select: { name: true } } } } },
      })
      if (!session) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Session not found' })
      }

      await db.session.delete({ where: { id } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school_session.revoked',
        targetType: 'PLATFORM_SESSION',
        targetId: session.id,
        schoolId: session.user.schoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: `revoked school session for ${session.user.name ?? session.user.id}`,
        metadata: { userRole: session.user.role, schoolName: session.user.school?.name ?? null },
      })
      await auditEvent({
        schoolId: session.user.schoolId,
        userId: session.user.id,
        action: 'SESSIONS_REVOKED',
        detail: 'Session revoked by platform support',
      }).catch(() => {})

      return { ok: true }
    },
    { method: 'POST' },
  )
}
