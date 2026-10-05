import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { AppError } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { issueAndEmailPasswordReset } from '@/lib/platform/password-reset'

export const runtime = 'nodejs'

/** Dual-control ticket window. */
const RECOVERY_TICKET_TTL_MS = 15 * 60 * 1000

/**
 * POST /api/platform/admins/[id]/reset-password — admins.manage + STEP-UP.
 *
 * Admin-assisted credential recovery: emails the target admin a
 * single-use password reset link (the SAME pipeline as self-service
 * forgot-password — the acting admin NEVER sees a password) and
 * revokes the target's live sessions when the reset completes.
 *
 * DUAL-CONTROL (docs/PLATFORM_ACCOUNT_RECOVERY.md §Root recovery):
 *   · NON-ROOT target → executes immediately (single admins.manage
 *     + step-up decision, the suspend/reactivate posture).
 *   · ROOT target → a RECOVERY TICKET is created and must be
 *     CONFIRMED by a SECOND, distinct admins.manage holder within
 *     15 minutes (POST /api/platform/admins/recovery/[ticketId]/confirm)
 *     before anything is sent. Root-account takeover is structurally
 *     a two-person action — no single identity can complete it.
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
      if (target.status !== 'ACTIVE') {
        throw new AppError('CONFLICT', {
          publicMessage: 'Reactivate this admin before resetting their password.',
          internalDetail: 'admin-assisted reset: target not ACTIVE',
        })
      }

      const origin =
        (process.env.APP_URL ?? '').trim() ||
        `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? 'localhost:3000'}`
      const ip = clientIpFromHeaders(req.headers)

      // ── Root target → dual-control ticket, nothing executes yet ──────
      if (target.isRoot) {
        const ticket = await db.platformRecoveryTicket.create({
          data: {
            action: 'PASSWORD_RESET',
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
          reason: `root password reset — dual-control ticket ${ticket.id} awaiting a second admins.manage holder`,
          metadata: { ticketId: ticket.id, action: 'PASSWORD_RESET' },
        })
        return {
          dualControl: true,
          ticketId: ticket.id,
          message:
            'Root-account password reset requires a second authorized administrator to confirm (15-minute window).',
        }
      }

      // ── Non-root target → direct (single authorized decision) ───────
      const { emailStatus } = await issueAndEmailPasswordReset(
        { id: target.id, email: target.email, name: target.name },
        { origin, requestIp: ip, requestId: undefined },
      )
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.password_reset_initiated',
        targetType: 'ADMIN',
        targetId: target.id,
        ip,
        reason: `admin-assisted password reset email sent to ${target.email}`,
        metadata: { emailStatus },
      })
      if (emailStatus === 'failed') {
        throw new AppError('EXTERNAL_SERVICE_FAILURE', {
          publicMessage:
            'The reset email could not be delivered. Check the platform email configuration and retry.',
          internalDetail: 'admin-assisted reset: email delivery failed',
        })
      }
      return {
        dualControl: false,
        message: 'Password reset link sent to the admin\u2019s email address.',
      }
    },
    { method: 'POST' },
  )
}
