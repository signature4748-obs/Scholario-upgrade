import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { latestChecks } from '@/lib/ops/health'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/health — the latest STORED result per
 * check plus recent history (no live probes on the read path).
 * Permission: ops.read.
 */
export async function GET() {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const checks = await latestChecks()
    const history = await db.monitoringCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      take: 120,
      select: {
        checkKey: true,
        status: true,
        severity: true,
        latencyMs: true,
        checkedAt: true,
      },
    })
    return {
      checks,
      history: history.map((h) => ({ ...h, checkedAt: h.checkedAt.toISOString() })),
      liveness: {
        endpoint: '/health/live',
        note: 'Unauthenticated liveness probe (exists since Phase 8B) — responds 200 while the process serves; no infrastructure details exposed.',
      },
      readiness: {
        endpoint: '/health/ready',
        note: 'Unauthenticated readiness probe — verifies database connectivity; the detailed dependency suite lives here (platform admin only).',
      },
    }
  })
}
