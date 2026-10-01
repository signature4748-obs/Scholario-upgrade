import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  schoolId: z.string().max(64).optional(),
  adminId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
})

/**
 * GET /api/platform/audit — the platform audit trail viewer.
 *
 * Filters: free-text (action/reason), action prefix, school, admin,
 * pagination (50/page, newest first). Admin names/emails resolve for
 * display; reason strings were sanitized at write time.
 *
 * Permission: audit.read.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'audit.read' }, async () => {
    const query = parseQuery(req, querySchema)
    const page = query.page ?? 1
    const pageSize = 50

    const where = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
      ...(query.schoolId ? { schoolId: query.schoolId } : {}),
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.q
        ? { OR: [{ action: { contains: query.q, mode: 'insensitive' as const } }, { reason: { contains: query.q, mode: 'insensitive' as const } }] }
        : {}),
    }

    const [events, total, adminNames] = await Promise.all([
      db.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.platformAuditLog.count({ where }),
      db.platformAdmin.findMany({ select: { id: true, name: true, email: true } }),
    ])
    const nameById = new Map(adminNames.map((a) => [a.id, a]))

    return {
      total,
      page,
      pageSize,
      events: events.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        action: e.action,
        admin: e.adminId
          ? {
              id: e.adminId,
              name: nameById.get(e.adminId)?.name ?? 'unknown admin',
            }
          : null,
        targetType: e.targetType,
        targetId: e.targetId,
        schoolId: e.schoolId,
        reason: e.reason,
        metadata: e.metadata,
        ip: e.ip,
      })),
    }
  })
}
