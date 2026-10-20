import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, parseQuery, strictBody, safeText, boundedInt } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * GET /api/platform/announcements — manage list (all rows incl.
 * expired), paginated: page (1-based) + pageSize (default 20, cap 100),
 * newest first, with the total row count for the pager. Additive: the
 * `announcements` array keeps its exact per-row shape.
 * Permission: announcements.manage.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'announcements.manage' }, async () => {
    const query = parseQuery(req, listQuerySchema)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const [rows, total] = await Promise.all([
      db.platformAnnouncement.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.platformAnnouncement.count(),
    ])
    const now = Date.now()
    return {
      announcements: rows.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        level: a.level,
        audience: a.audience,
        createdAt: a.createdAt.toISOString(),
        expiresAt: a.expiresAt?.toISOString() ?? null,
        expired: a.expiresAt ? a.expiresAt.getTime() < now : false,
      })),
      total,
      page,
      pageSize,
    }
  })
}

const createSchema = strictBody({
  title: safeText(120),
  body: safeText(1000),
  level: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
  audience: z.enum(['ALL', 'SCHOOLS']).default('ALL'),
  expiresInDays: boundedInt(1, 90).optional(),
})

/**
 * POST /api/platform/announcements — publish a platform announcement
 * (surfaces on school login pages). Permission: announcements.manage.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'announcements.manage' },
    async (ctx) => {
      const body = await parseJsonBody(req, createSchema)
      const ip = clientIpFromHeaders(req.headers)

      const announcement = await db.platformAnnouncement.create({
        data: {
          title: body.title,
          body: body.body,
          level: body.level,
          audience: body.audience,
          createdBy: ctx.admin.id,
          expiresAt: body.expiresInDays
            ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.announcement.published',
        targetType: 'ANNOUNCEMENT',
        targetId: announcement.id,
        ip,
        reason: `published "${body.title}" (${body.level}/${body.audience})`,
        metadata: { expiresInDays: body.expiresInDays ?? 30 },
      })

      return { id: announcement.id, ok: true }
    },
    { method: 'POST' },
  )
}
