import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'

export const runtime = 'nodejs'

/**
 * GET /api/platform/admins/recovery — admins.manage.
 *
 * Pending dual-control recovery tickets (root-account credential
 * recovery): id, action, target, initiator, expiry — everything a
 * SECOND authorized admin needs to decide whether to confirm. No
 * secrets are carried (tickets contain no tokens — the executed
 * action mints them only on confirmation).
 */
export async function GET() {
  return withPlatform({ permission: 'admins.manage' }, async () => {
    const tickets = await db.platformRecoveryTicket.findMany({
      where: { confirmedBy: null, executedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    const adminIds = [
      ...new Set(tickets.flatMap((t) => [t.targetAdminId, t.initiatedBy])),
    ]
    const admins = await db.platformAdmin.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true, name: true, isRoot: true },
    })
    const byId = new Map(admins.map((a) => [a.id, a]))
    return {
      tickets: tickets.map((t) => ({
        id: t.id,
        action: t.action,
        createdAt: t.createdAt.toISOString(),
        expiresAt: t.expiresAt.toISOString(),
        reason: t.reason,
        target: byId.get(t.targetAdminId)
          ? { id: t.targetAdminId, email: byId.get(t.targetAdminId)!.email, name: byId.get(t.targetAdminId)!.name }
          : { id: t.targetAdminId, email: null, name: null },
        initiatedBy: byId.get(t.initiatedBy)
          ? { id: t.initiatedBy, email: byId.get(t.initiatedBy)!.email, name: byId.get(t.initiatedBy)!.name }
          : { id: t.initiatedBy, email: null, name: null },
      })),
    }
  })
}
