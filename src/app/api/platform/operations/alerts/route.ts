import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/alerts — alert list with filters
 * (status, severity, type) + counts. Permission: ops.read.
 */
export async function GET(req: Request) {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') // open|acknowledged|resolved|all
    const severity = url.searchParams.get('severity')
    const type = url.searchParams.get('type')

    const where: Prisma.PlatformAlertWhereInput = {}
    if (status && status !== 'all') where.status = status
    if (severity) where.severity = severity
    if (type) where.type = type

    const [rows, counts] = await Promise.all([
      db.platformAlert.findMany({
        where,
        orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
        take: 100,
      }),
      db.platformAlert.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const statusCounts: Record<string, number> = { open: 0, acknowledged: 0, resolved: 0 }
    for (const c of counts) statusCounts[c.status] = c._count._all

    return {
      alerts: rows.map((r) => ({
        id: r.id,
        fingerprint: r.fingerprint,
        type: r.type,
        severity: r.severity,
        status: r.status,
        metricKey: r.metricKey,
        metricLabel: r.metricLabel,
        observedValue: r.observedValue,
        threshold: r.threshold,
        unit: r.unit,
        message: r.message,
        detail: (() => {
          try {
            return r.detail ? JSON.parse(r.detail) : null
          } catch {
            return null
          }
        })(),
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        occurrences: r.occurrences,
        acknowledgedBy: r.acknowledgedBy,
        resolvedBy: r.resolvedBy,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolutionNote: r.resolutionNote,
      })),
      statusCounts,
      notificationNote:
        'No notification channel (email/Slack) is configured for alerts in this deployment — alerts are visible here and in the platform audit trail only. Alerts are never silently dropped.',
    }
  })
}
