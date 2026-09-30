import { api } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  getPlatformSession,
  clearPlatformSessionCookie,
  revokePlatformSession,
} from '@/lib/platform/auth'

export const runtime = 'nodejs'

/**
 * POST /api/platform/auth/logout — revoke the CURRENT platform session
 * and clear the cookie.
 */
export async function POST() {
  const requestId = newRequestId()
  return api(async () => {
    const auth = await getPlatformSession()
    if (auth) {
      await revokePlatformSession(auth.session.id)
      await platformAuditEvent({
        adminId: auth.admin.id,
        action: 'platform.logout',
        targetType: 'PLATFORM_SESSION',
        targetId: auth.session.id,
        requestId,
      }).catch(() => {})
    }
    await clearPlatformSessionCookie()
    return { ok: true }
  })
}
