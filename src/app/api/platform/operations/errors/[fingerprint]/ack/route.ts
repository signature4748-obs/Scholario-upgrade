import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { sanitizeAuditDetail } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/errors/[fingerprint]/ack — acknowledge
 * an error group (records WHO + WHEN; the group stays visible).
 * Audited as platform.ops.error.acknowledged.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ fingerprint: string }> }) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const { fingerprint } = await params
    const group = await db.operationalError.findUnique({ where: { fingerprint } })
    if (!group) return { error: 'Error group not found' }

    const updated = await db.operationalError.update({
      where: { fingerprint },
      data: {
        status: 'acknowledged',
        acknowledgedBy: ctx.admin.id,
        acknowledgedAt: new Date(),
      },
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.error.acknowledged',
      targetType: 'SETTING',
      targetId: fingerprint,
      reason: sanitizeAuditDetail(group.message.slice(0, 200)),
      metadata: { occurrences: group.occurrences, category: group.category },
    })

    return { status: updated.status, acknowledgedBy: ctx.admin.id, at: updated.acknowledgedAt?.toISOString() }
  }, { method: 'POST' })
}
