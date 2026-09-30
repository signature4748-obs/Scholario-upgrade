import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  schoolId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * GET /api/platform/school-sessions — live school-user sessions
 * (the support tool's session browser). Sessions are resolved through
 * User.schoolId — NEVER a client-supplied school id alone: when no
 * schoolId filter is given, the platform-wide list is returned (this is
 * the platform plane; the school plane never sees this endpoint).
 *
 * Permission: support.access.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'support.access' }, async () => {
    const query = parseQuery(req, querySchema)
    const limit = query.limit ?? 50

    const sessions = await db.session.findMany({
      where: {
        expiresAt: { gt: new Date() },
        ...(query.schoolId ? { user: { schoolId: query.schoolId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, schoolId: true, school: { select: { name: true } } },
        },
      },
    })

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        user: {
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          role: s.user.role,
        },
        schoolName: s.user.school?.name ?? null,
        schoolId: s.user.schoolId,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
      })),
    }
  })
}
