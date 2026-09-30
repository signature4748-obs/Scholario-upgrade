import { api } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  getPlatformSession,
  clearPlatformSessionCookie,
  revokeAllPlatformSessions,
} from '@/lib/platform/auth'

export const runtime = 'nodejs'

/**
 * POST /api/platform/auth/logout-all — revoke EVERY live session for
 * the signed-in platform admin (sign out of all devices).
 */
export async function POST() {
  const requestId = newRequestId()
  return api(async () => {
    const auth = await getPlatformSession()
    if (!auth) {
      await clearPlatformSessionCookie()
      return { revoked: 0 }
    }
    const revoked = await revokeAllPlatformSessions(auth.admin.id)
    await clearPlatformSessionCookie()
    await platformAuditEvent({
      adminId: auth.admin.id,
      action: 'platform.logout_all',
      targetType: 'PLATFORM_SESSION',
      targetId: auth.admin.id,
      requestId,
      metadata: { revoked },
    }).catch(() => {})
    return { revoked }
  })
}
