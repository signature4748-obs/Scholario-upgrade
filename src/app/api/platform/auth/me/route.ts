import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { hasLiveStepUp, STEP_UP_WINDOW_MS } from '@/lib/platform/auth'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import { parseUserAgent } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/platform/auth/me — the console's session bootstrap: admin
 * identity, effective permissions, live step-up state and this admin's
 * other active sessions (device list).
 *
 * `mfaEnabled` tells the console the platform's current MFA posture
 * (PRODUCT-DIRECTION RESET Part 1 — off for now) so the step-up pill
 * and its TOTP dialog are hidden instead of becoming a dead end.
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
        // ACCOUNT-RECOVERY — Google sign-in state for the settings
        // surface (email shown so the admin can verify WHICH Google
        // identity is linked; sub is never exposed).
        googleLinked: ctx.admin.googleSub !== null,
        googleEmail: ctx.admin.googleEmail ?? null,
      },
      permissions: [...ctx.permissions],
      // Current MFA posture — see lib/platform/mfa-config.ts.
      mfaEnabled: isPlatformTotpEnabled(),
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
