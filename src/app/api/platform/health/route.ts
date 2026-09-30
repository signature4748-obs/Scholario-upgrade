import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'

export const runtime = 'nodejs'

/**
 * GET /api/platform/health — control-plane system health:
 *   · DB liveness + latency (SELECT 1);
 *   · entity counts (schools by status, users, platform admins);
 *   · live session counts (platform + school + support);
 *   · process health (uptime, memory);
 *   · recent platform audit failures (security signal).
 *
 * Readable by ANY platform admin (operational visibility).
 */
export async function GET() {
  return withPlatform({}, async () => {
    const started = Date.now()
    let dbOk = true
    let dbLatencyMs: number | null = null
    try {
      await db.$queryRaw`SELECT 1`
      dbLatencyMs = Date.now() - started
    } catch {
      dbOk = false
    }

    const [
      schoolsActive,
      schoolsSuspended,
      schoolsPending,
      totalUsers,
      platformAdmins,
      livePlatformSessions,
      liveSchoolSessions,
      liveSupportSessions,
      recentFailures,
    ] = await Promise.all([
      db.school.count({ where: { status: 'ACTIVE' } }),
      db.school.count({ where: { status: 'SUSPENDED' } }),
      db.school.count({ where: { status: 'PENDING' } }),
      db.user.count(),
      db.platformAdmin.count(),
      db.platformAdminSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.session.count({ where: { expiresAt: { gt: new Date() } } }),
      db.supportSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.platformAuditLog.count({
        where: { action: { in: ['platform.login.failed', 'platform.step_up.failed', 'platform.login.locked'] } },
      }),
    ])

    const mem = process.memoryUsage()

    return {
      status: dbOk ? 'healthy' : 'degraded',
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      schools: { active: schoolsActive, suspended: schoolsSuspended, pending: schoolsPending },
      users: totalUsers,
      platformAdmins,
      sessions: {
        platform: livePlatformSessions,
        school: liveSchoolSessions,
        support: liveSupportSessions,
      },
      security: { recentAuthFailures: recentFailures },
      process: {
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        nodeEnv: process.env.NODE_ENV ?? 'development',
      },
      checkedAt: new Date().toISOString(),
    }
  })
}
