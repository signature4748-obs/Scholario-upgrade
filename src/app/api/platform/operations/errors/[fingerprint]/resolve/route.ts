import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { sanitizeAuditDetail } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/errors/[fingerprint]/resolve — resolve
 * an error group with a required operator note. Audited as
 * platform.ops.error.resolved. (A recurrence re-opens the group.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ fingerprint: string }> }) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const { fingerprint } = await params
    const body = (await req.json().catch(() => ({}))) as { note?: string }
    const note = (body.note ?? '').trim()
    if (note.length < 3) {
      return { error: 'A resolution note is required (minimum 3 characters)' }
    }
    const group = await db.operationalError.findUnique({ where: { fingerprint } })
    if (!group) return { error: 'Error group not found' }

    const updated = await db.operationalError.update({
      where: { fingerprint },
      data: {
        status: 'resolved',
        resolvedBy: ctx.admin.id,
        resolvedAt: new Date(),
        resolutionNote: sanitizeAuditDetail(note.slice(0, 400)),
      },
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.error.resolved',
      targetType: 'SETTING',
      targetId: fingerprint,
      reason: sanitizeAuditDetail(note.slice(0, 200)),
      metadata: { occurrences: group.occurrences, category: group.category },
    })

    return {
      status: updated.status,
      resolvedBy: ctx.admin.id,
      at: updated.resolvedAt?.toISOString(),
      note: updated.resolutionNote,
    }
  }, { method: 'POST' })
}
