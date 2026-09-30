import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokePlatformSession, revokeAllPlatformSessions } from '@/lib/platform/auth'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({ all: z.enum(['true', 'false']).optional() })

/**
 * POST /api/platform/sessions/[id]/revoke — revoke one platform session
 * by id. `?all=true` on the current session's id revokes EVERY session
 * of the caller (sign out everywhere). Own sessions only (admins.manage
 * covers OTHER admins via suspend).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    {},
    async (ctx) => {
      const query = parseQuery(req, querySchema)

      if (query.all === 'true') {
        // Idempotent "revoke all mine" (the id in the URL is the current
        // session's, carried by the console for route shape only).
        const revoked = await revokeAllPlatformSessions(ctx.admin.id)
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.session.revoked',
          targetType: 'PLATFORM_SESSION',
          targetId: ctx.admin.id,
          reason: `revoked ${revoked} own session(s)`,
          metadata: { revoked, scope: 'all' },
        }).catch(() => {})
        return { ok: true, revoked, scope: 'all' }
      }

      const session = await db.platformAdminSession.findUnique({ where: { id } })
      if (!session) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Session not found' })
      }
      if (session.adminId !== ctx.admin.id) {
        // Other admins' sessions are managed through the admin lifecycle
        // (suspend) — not per-session by peers.
        throw new AppError('FORBIDDEN', {
          publicMessage: 'You can only revoke your own sessions',
          internalDetail: 'platform session revoke: not the caller session',
        })
      }

      await revokePlatformSession(session.id)
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.session.revoked',
        targetType: 'PLATFORM_SESSION',
        targetId: session.id,
        reason: 'revoked own session',
        metadata: { scope: 'one' },
      }).catch(() => {})
      return { ok: true, revoked: 1, scope: 'one' }
    },
    { method: 'POST' },
  )
}
