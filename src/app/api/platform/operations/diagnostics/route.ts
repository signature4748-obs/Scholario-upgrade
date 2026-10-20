import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { MONITORING_COVERAGE, coverageSummary } from '@/lib/ops/coverage'
import { runOpsRetention, SNAPSHOT_RETENTION_DAYS } from '@/lib/ops/sync'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/diagnostics — the Audit & Diagnostics
 * tab: monitoring-coverage report, recent platform audit rows (ops
 * actions highlighted), retention state + honest gaps. ops.read.
 */
export async function GET() {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const [opsAudit, recentOpsActions, snapshotCount, eventCount, checkCount] = await Promise.all([
      db.platformAuditLog.count({
        where: { action: { startsWith: 'platform.ops.' } },
      }),
      db.platformAuditLog.findMany({
        where: { action: { startsWith: 'platform.ops.' } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          action: true,
          adminId: true,
          reason: true,
          createdAt: true,
          targetId: true,
        },
      }),
      db.providerUsageSnapshot.count(),
      db.operationalErrorEvent.count(),
      db.monitoringCheck.count(),
    ])

    return {
      coverage: {
        entries: MONITORING_COVERAGE,
        summary: coverageSummary(),
      },
      opsAudit: {
        total: opsAudit,
        recent: recentOpsActions.map((a) => ({
          id: a.id,
          action: a.action,
          at: a.createdAt.toISOString(),
          reason: a.reason,
          target: a.targetId,
        })),
        note: 'The full platform audit trail (all actions, not just ops) is on the Audit Log page.',
      },
      retention: {
        snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
        errorEventRetentionDays: 14,
        monitoringCheckRetentionDays: 30,
        currentRows: { snapshots: snapshotCount, errorEvents: eventCount, checks: checkCount },
        note: 'Group/rollup/alert rows and the platform audit trail are kept permanently (operational history); only event-level history is pruned.',
      },
      knownGaps: [
        'Estimated costs are not shown — no billing API is connected; usage-to-cost would be fabrication.',
        'Shared provider usage (Vercel bandwidth, Supabase compute/egress) is platform-level and cannot be attributed per school; the School Usage tab shows only app-measured metrics.',
        'Vercel usage metrics are plan-restricted (Hobby team); Supabase usage/quota endpoints are not exposed by the connected Management API; Resend plan quotas are not exposed. All displayed as "Not available" with reasons.',
        'Browser-side (frontend) exceptions are not collected server-side; render errors surface through the log stream (instrumentation.ts edge constraint is documented there).',
      ],
    }
  })
}

/**
 * POST /api/platform/operations/diagnostics — run the retention cleanup
 * now (idempotent, additive-safe). Audited as platform.ops.retention.run.
 */
export async function POST() {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.retention.run',
      targetType: 'SETTING',
      reason: 'manual retention cleanup',
    })
    const result = await runOpsRetention()
    return { pruned: result }
  }, { method: 'POST' })
}
