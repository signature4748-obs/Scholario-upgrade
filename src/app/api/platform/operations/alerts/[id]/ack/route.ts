import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { sanitizeAuditDetail } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/alerts/[id]/ack — acknowledge an alert.
 * Audited. The alert stays visible; escalating severity re-opens it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const { id } = await params
    const alert = await db.platformAlert.findUnique({ where: { id } })
    if (!alert) return { error: 'Alert not found' }
    if (alert.status === 'resolved') return { error: 'Alert is already resolved' }

    const updated = await db.platformAlert.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedBy: ctx.admin.id },
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.alert.acknowledged',
      targetType: 'SETTING',
      targetId: alert.fingerprint,
      reason: sanitizeAuditDetail(alert.message.slice(0, 200)),
    })

    return { status: updated.status, acknowledgedBy: ctx.admin.id }
  }, { method: 'POST' })
}
