import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { runHealthChecks } from '@/lib/ops/health'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/health/run — run the dependency/readiness
 * check suite NOW (bounded parallel; each check isolated + timed out).
 * Results are persisted to MonitoringCheck and returned. Audited as
 * platform.ops.health_checks.run.
 */
export async function POST() {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.health_checks.run',
      targetType: 'SETTING',
      reason: 'manual health check run',
    })
    const results = await runHealthChecks()
    return {
      ranAt: new Date().toISOString(),
      results,
      summary: {
        healthy: results.filter((r) => r.status === 'healthy').length,
        degraded: results.filter((r) => r.status === 'degraded').length,
        down: results.filter((r) => r.status === 'down').length,
        unknown: results.filter((r) => r.status === 'unknown' || r.status === 'not_configured').length,
      },
    }
  }, { method: 'POST' })
}
