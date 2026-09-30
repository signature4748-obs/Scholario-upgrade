import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { hasLiveStepUp, STEP_UP_WINDOW_MS } from '@/lib/platform/auth'
import { parseUserAgent } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/platform/auth/me — the console's session bootstrap: admin
 * identity, effective permissions, live step-up state and this admin's
 * other active sessions (device list).
 *
 * Also serves as the client-side gate: 401 here (no valid platform
 * session) sends the console to /platform/login.
 */
export async function GET() {
  return withPlatform({}, async (ctx) => {
    const sessions = await db.platformAdminSession.findMany({
      where: { adminId: ctx.admin.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return {
      admin: {
        id: ctx.admin.id,
        email: ctx.admin.email,
        name: ctx.admin.name,
        isRoot: ctx.admin.isRoot,
      },
      permissions: [...ctx.permissions],
      session: {
        id: ctx.session.id,
        createdAt: ctx.session.createdAt.toISOString(),
        expiresAt: ctx.session.expiresAt.toISOString(),
        stepUpActive: hasLiveStepUp(ctx.session),
        stepUpUntil: hasLiveStepUp(ctx.session)
          ? new Date(ctx.session.stepUpAt!.getTime() + STEP_UP_WINDOW_MS).toISOString()
          : null,
        device: parseUserAgent(ctx.session.userAgent),
      },
      devices: sessions.map((s) => ({
        id: s.id,
        current: s.id === ctx.session.id,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        device: parseUserAgent(s.userAgent),
        ipAddress: s.ipAddress,
      })),
    }
  })
}
