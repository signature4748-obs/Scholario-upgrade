import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  schoolId: z.string().max(64).optional(),
  includeRevoked: z.enum(['true', 'false']).optional(),
})

/**
 * GET /api/platform/support/sessions — support-session registry (active
 * first). Permission: support.access.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'support.access' }, async () => {
    const query = parseQuery(req, querySchema)
    const includeRevoked = query.includeRevoked === 'true'

    const sessions = await db.supportSession.findMany({
      where: {
        ...(query.schoolId ? { schoolId: query.schoolId } : {}),
        ...(includeRevoked ? {} : { revokedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        school: { select: { id: true, name: true, slug: true } },
        admin: { select: { id: true, name: true, email: true } },
      },
    })

    const now = Date.now()
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        school: s.school,
        admin: s.admin,
        reason: s.reason,
        durationMinutes: s.durationMinutes,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
        live: !s.revokedAt && s.expiresAt.getTime() > now,
      })),
    }
  })
}
