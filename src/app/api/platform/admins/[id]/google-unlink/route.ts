import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { AppError } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokeAllPlatformSessions } from '@/lib/platform/auth'
import { unlinkGoogleIdentity } from '@/lib/platform/google-account'

export const runtime = 'nodejs'

const RECOVERY_TICKET_TTL_MS = 15 * 60 * 1000

/**
 * POST /api/platform/admins/[id]/google-unlink — admins.manage + STEP-UP.
 *
 * Emergency Google-identity removal for a locked-out admin (the
 * account's own unlink is Settings → Sign-in methods). Non-root
 * targets: executes directly. ROOT targets: dual-control ticket —
 * a second, distinct admins.manage holder must confirm within 15
 * minutes (POST /api/platform/admins/recovery/[ticketId]/confirm).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'admins.manage', stepUp: true },
    async (ctx) => {
      const target = await db.platformAdmin.findUnique({ where: { id } })
      if (!target) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Platform admin not found' })
      }
      const ip = clientIpFromHeaders(req.headers)

      if (!target.googleSub) {
        throw new AppError('CONFLICT', {
          publicMessage: 'No Google identity is linked to this account.',
          internalDetail: 'admin google-unlink: nothing linked',
        })
      }

      // ── Root target → dual-control ticket ────────────────────────────
      if (target.isRoot) {
        const ticket = await db.platformRecoveryTicket.create({
          data: {
            action: 'GOOGLE_UNLINK',
            targetAdminId: target.id,
            initiatedBy: ctx.admin.id,
            expiresAt: new Date(Date.now() + RECOVERY_TICKET_TTL_MS),
          },
        })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.recovery.initiated',
          targetType: 'ADMIN',
          targetId: target.id,
          ip,
          reason: `root google unlink — dual-control ticket ${ticket.id} awaiting a second admins.manage holder`,
          metadata: { ticketId: ticket.id, action: 'GOOGLE_UNLINK' },
        })
        return {
          dualControl: true,
          ticketId: ticket.id,
          message:
            'Root-account Google unlink requires a second authorized administrator to confirm (15-minute window).',
        }
      }

      // ── Non-root target → direct ─────────────────────────────────────
      const result = await unlinkGoogleIdentity(target.id, { ip, byAdminId: ctx.admin.id })
      if (!result.ok) {
        throw new AppError('CONFLICT', {
          publicMessage: 'No Google identity is linked to this account.',
          internalDetail: 'admin google-unlink: nothing linked (raced)',
        })
      }
      const revoked = await revokeAllPlatformSessions(target.id)
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.google_unlinked',
        targetType: 'ADMIN',
        targetId: target.id,
        ip,
        reason: `admin-assisted google unlink for ${target.email}`,
        metadata: { revokedSessions: revoked },
      })
      return { dualControl: false, message: 'Google identity unlinked.', revokedSessions: revoked }
    },
    { method: 'POST' },
  )
}
