import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { getSupportToken, revokeSupportSession, clearSupportSessionCookie, hashToken } from '@/lib/platform/auth'
import { platformAuditEvent } from '@/lib/platform/audit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/support/exit — end the caller's support session
 * (explicit exit; the banner's Exit button). Revoked + audited +
 * cookie cleared.
 */
export async function POST() {
  return api(async () => {
    const token = await getSupportToken()
    if (!token) {
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'No active support session',
        internalDetail: 'support exit: no support token',
      })
    }
    const support = await db.supportSession.findUnique({
      where: { tokenHash: hashToken(token) },
    })
    if (support && !support.revokedAt) {
      await revokeSupportSession(support.id)
      await platformAuditEvent({
        adminId: support.adminId,
        action: 'platform.support_session.revoked',
        targetType: 'SUPPORT_SESSION',
        targetId: support.id,
        schoolId: support.schoolId,
        reason: support.reason,
      }).catch(() => {})
    }
    await clearSupportSessionCookie()
    return { ok: true }
  })
}
