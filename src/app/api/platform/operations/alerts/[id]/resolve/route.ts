import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { sanitizeAuditDetail } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/alerts/[id]/resolve — resolve an alert
 * with a required note. Audited. (If the underlying condition persists,
 * the next evaluation re-opens the alert.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { note?: string }
    const note = (body.note ?? '').trim()
    if (note.length < 3) return { error: 'A resolution note is required (minimum 3 characters)' }

    const alert = await db.platformAlert.findUnique({ where: { id } })
    if (!alert) return { error: 'Alert not found' }

    const updated = await db.platformAlert.update({
      where: { id },
      data: {
        status: 'resolved',
        resolvedBy: ctx.admin.id,
        resolvedAt: new Date(),
        resolutionNote: sanitizeAuditDetail(note.slice(0, 400)),
      },
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.alert.resolved',
      targetType: 'SETTING',
      targetId: alert.fingerprint,
      reason: sanitizeAuditDetail(note.slice(0, 200)),
    })

    return {
      status: updated.status,
      resolvedBy: ctx.admin.id,
      resolvedAt: updated.resolvedAt?.toISOString(),
      note: updated.resolutionNote,
    }
  }, { method: 'POST' })
}
