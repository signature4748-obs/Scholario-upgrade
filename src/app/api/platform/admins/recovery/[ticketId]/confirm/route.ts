import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { AppError } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { revokeAllPlatformSessions } from '@/lib/platform/auth'
import { issueAndEmailPasswordReset } from '@/lib/platform/password-reset'
import { unlinkGoogleIdentity } from '@/lib/platform/google-account'

export const runtime = 'nodejs'

/**
 * POST /api/platform/admins/recovery/[ticketId]/confirm —
 * admins.manage + STEP-UP. THE SECOND PERSON of the two-person rule.
 *
 * The confirming admin must be a DIFFERENT identity from BOTH the
 * initiator and the target (structural two-person control — one
 * account can never confirm its own initiated root takeover, and
 * the target can never confirm their own recovery). Only then does
 * the ticketed effect execute:
 *
 *   PASSWORD_RESET → reset email to the target root (the acting
 *                    admins still never see a password — the
 *                    target's verified inbox is the third factor)
 *                    + full session revocation.
 *   GOOGLE_UNLINK  → identity removed + sessions revoked.
 *
 * Expired/confirmed/executed tickets are refused; every transition
 * is audited (platform.recovery.confirmed / .executed / .refused).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params
  return withPlatform(
    { permission: 'admins.manage', stepUp: true },
    async (ctx) => {
      const ticket = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
      if (!ticket) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Recovery ticket not found' })
      }
      const ip = clientIpFromHeaders(req.headers)

      /** Audited refusal → typed CONFLICT error (fail-closed). The
       *  EXPLICIT annotation makes the never-returning contract visible
       *  to control-flow analysis (the target narrows after a refusal). */
      const refuse: (detail: string, publicMessage: string) => never = (detail, publicMessage) => {
        void platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.recovery.refused',
          targetType: 'ADMIN',
          targetId: ticket.targetAdminId,
          ip,
          reason: `ticket ${ticket.id}: ${detail}`,
          metadata: { ticketId: ticket.id, action: ticket.action },
        }).catch(() => {})
        throw new AppError('CONFLICT', { publicMessage, internalDetail: `recovery confirm: ${detail}` })
      }

      if (ticket.executedAt || ticket.confirmedBy) {
        refuse('already confirmed or executed', 'This recovery ticket was already actioned.')
      }
      if (ticket.expiresAt < new Date()) {
        refuse('expired', 'This recovery ticket expired. Initiate a new one.')
      }
      // ── The two-person rule, enforced ────────────────────────────────
      if (ctx.admin.id === ticket.initiatedBy) {
        refuse(
          'confirming admin is the initiator (two-person rule)',
          'A recovery ticket cannot be confirmed by the administrator who initiated it.',
        )
      }
      if (ctx.admin.id === ticket.targetAdminId) {
        refuse(
          'confirming admin is the target (two-person rule)',
          'A recovery ticket cannot be confirmed by the account it targets.',
        )
      }

      const target = await db.platformAdmin.findUnique({
        where: { id: ticket.targetAdminId },
      })
      if (!target) {
        refuse('target admin no longer exists', 'The target platform admin no longer exists.')
      }

      // ── Execute the ticketed action ─────────────────────────────────
      if (ticket.action === 'PASSWORD_RESET') {
        if (target.status !== 'ACTIVE') {
          refuse('target not ACTIVE', 'Reactivate the target admin before resetting their password.')
        }
        const origin =
          (process.env.APP_URL ?? '').trim() ||
          `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? 'localhost:3000'}`
        const { emailStatus } = await issueAndEmailPasswordReset(
          { id: target.id, email: target.email, name: target.name },
          { origin, requestIp: ip },
        )
        const revoked = await revokeAllPlatformSessions(target.id)
        await db.platformRecoveryTicket.update({
          where: { id: ticket.id },
          data: {
            confirmedBy: ctx.admin.id,
            confirmedAt: new Date(),
            executedAt: new Date(),
            metadata: JSON.stringify({ emailStatus, revokedSessions: revoked }),
          },
        })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.recovery.executed',
          targetType: 'ADMIN',
          targetId: target.id,
          ip,
          reason: `root password reset executed (initiated by another admin) — reset email to ${target.email}`,
          metadata: { ticketId: ticket.id, action: 'PASSWORD_RESET', emailStatus, revokedSessions: revoked },
        })
        if (emailStatus === 'failed') {
          throw new AppError('EXTERNAL_SERVICE_FAILURE', {
            publicMessage:
              'The ticket was executed but the reset email could not be delivered. Check the platform email configuration and re-initiate.',
            internalDetail: 'recovery confirm: reset email delivery failed',
          })
        }
        return { message: 'Root password reset executed — reset link sent to the target admin\u2019s email.' }
      }

      if (ticket.action === 'GOOGLE_UNLINK') {
        const unlinked = await unlinkGoogleIdentity(target.id, { ip, byAdminId: ctx.admin.id })
        const revoked = await revokeAllPlatformSessions(target.id)
        await db.platformRecoveryTicket.update({
          where: { id: ticket.id },
          data: {
            confirmedBy: ctx.admin.id,
            confirmedAt: new Date(),
            executedAt: new Date(),
            metadata: JSON.stringify({ revokedSessions: revoked, wasLinked: unlinked.wasLinked }),
          },
        })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.recovery.executed',
          targetType: 'ADMIN',
          targetId: target.id,
          ip,
          reason: `root google unlink executed (initiated by another admin) for ${target.email}`,
          metadata: { ticketId: ticket.id, action: 'GOOGLE_UNLINK', revokedSessions: revoked },
        })
        return { message: 'Root Google identity unlinked and sessions revoked.' }
      }

      // Unknown action string (defensive — creators only write the two
      // values above; a tampered row fails closed).
      refuse(`unknown action '${ticket.action}'`, 'This recovery ticket has an unsupported action.')
    },
    { method: 'POST' },
  )
}
