import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'

export const runtime = 'nodejs'

/**
 * GET /api/platform/overview — the control-plane dashboard summary:
 * platform stats, schools by status, active support sessions, recent
 * platform audit trail, live announcements. Any platform admin.
 */
export async function GET() {
  return withPlatform({}, async () => {
    const [schoolCounts, sessions, supportSessions, recentAudit, announcements] = await Promise.all([
      db.school.groupBy({ by: ['status'], _count: { _all: true } }),
      db.platformAdminSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.supportSession.findMany({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          school: { select: { name: true } },
          admin: { select: { name: true } },
        },
      }),
      db.platformAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      db.platformAnnouncement.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, level: true, createdAt: true },
      }),
    ])

    const statusMap: Record<string, number> = { ACTIVE: 0, SUSPENDED: 0, PENDING: 0, TRIAL: 0 }
    for (const group of schoolCounts) {
      statusMap[group.status] = group._count._all
    }

    return {
      schools: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        byStatus: statusMap,
      },
      platformSessions: sessions,
      activeSupportSessions: supportSessions.map((s) => ({
        id: s.id,
        school: s.school.name,
        admin: s.admin.name,
        reason: s.reason,
        expiresAt: s.expiresAt.toISOString(),
      })),
      recentAudit: recentAudit.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        action: e.action,
        schoolId: e.schoolId,
        reason: e.reason,
      })),
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        level: a.level,
        createdAt: a.createdAt.toISOString(),
      })),
    }
  })
}
