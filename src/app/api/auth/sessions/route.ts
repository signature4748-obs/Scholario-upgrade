import { db } from '@/lib/db'
import { getCurrentUser, getCurrentSession, parseUserAgent } from '@/lib/auth'
import { api } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * GET /api/auth/sessions — the caller's OWN active sessions only
 * (Settings → Devices). Never exposes tokens; the current session is
 * flagged server-side by comparing against the caller's cookie token.
 */
export async function GET() {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    // Task 4-d (fix #9) — mirror withUser semantics (ACTIVE accounts only).
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

    // Expired rows are pruned opportunistically (same policy as login).
    await db.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })

    const current = await getCurrentSession()
    const rows = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    return {
      sessions: rows.map((s) => {
        const device = parseUserAgent(s.userAgent)
        return {
          id: s.id,
          isCurrent: current ? s.id === current.id : false,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          ipAddress: s.ipAddress,
          browser: device.browser,
          os: device.os,
          deviceType: device.device,
        }
      }),
    }
  })
}

/**
 * DELETE /api/auth/sessions — "Sign out of other sessions". Removes every
 * session EXCEPT the caller's current one. Ownership is derived from the
 * authenticated session — no ids are accepted from the client body.
 */
export async function DELETE() {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    // Task 4-d (fix #9) — mirror withUser semantics (ACTIVE accounts only).
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

    // Sensitive authentication operation — throttled (Phase 1).
    enforceRateLimit(`rl:sessrevoke:${user.id}`, RATE_LIMITS.sessionRevoke)

    const current = await getCurrentSession()
    const revoked = await db.session.deleteMany({
      where: { userId: user.id, ...(current ? { token: { not: current.token } } : {}) },
    })

    await db.activityLog.create({
      data: {
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'SESSIONS_REVOKED',
        detail: `Signed out ${revoked.count} other session(s).`,
      },
    }).catch(() => {})
    console.log(
      JSON.stringify({
        channel: 'audit',
        action: 'SESSIONS_REVOKED',
        userId: user.id,
        requestId: newRequestId(),
        count: revoked.count,
      }),
    )

    return { ok: true, signedOut: revoked.count }
  })
}
