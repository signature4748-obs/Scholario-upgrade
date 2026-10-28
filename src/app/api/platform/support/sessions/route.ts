import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  schoolId: z.string().max(64).optional(),
  includeRevoked: z.enum(['true', 'false']).optional(),
  status: z.enum(['live', 'ended', 'all']).optional(),
  q: z.string().max(120).optional(),
})

/**
 * GET /api/platform/support/sessions — support-session registry (newest
 * first). Permission: support.access.
 *
 * Filters (server-side, composable):
 *   · status — live (not revoked, not expired) | ended (revoked or
 *     expired) | all. Takes precedence over includeRevoked when given.
 *   · q      — free text across the reason and the opening admin's
 *     name/email (case-insensitive contains).
 *
 * The legacy `includeRevoked` contract is preserved verbatim for the
 * console registry (default hides revoked rows; includeRevoked=true
 * re-includes them) — pinned by
 * tests/security/platform-support-sessions-revoked.test.ts.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'support.access' }, async () => {
    const query = parseQuery(req, querySchema)
    const now = new Date()

    // Status window (Prisma cannot compare two columns — "live" is
    // expressed with the wall clock, exactly how `live` is derived).
    const statusWhere =
      query.status === 'live'
        ? { revokedAt: null, expiresAt: { gt: now } }
        : query.status === 'ended'
          ? { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] }
          : query.status === 'all'
            ? {}
            : query.includeRevoked === 'true'
              ? {}
              : { revokedAt: null }

    // Compose as AND groups — spreading two `OR` keys into one object
    // literal would silently clobber the status filter with the search
    // filter (or vice versa).
    const andGroups: Array<Record<string, unknown>> = []
    if (query.schoolId) andGroups.push({ schoolId: query.schoolId })
    if (Object.keys(statusWhere).length > 0) andGroups.push(statusWhere)
    if (query.q) {
      andGroups.push({
        OR: [
          { reason: { contains: query.q, mode: 'insensitive' } },
          {
            admin: {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          },
        ],
      })
    }

    const sessions = await db.supportSession.findMany({
      where: andGroups.length > 0 ? { AND: andGroups } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        school: { select: { id: true, name: true, slug: true } },
        admin: { select: { id: true, name: true, email: true } },
      },
    })

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
        live: !s.revokedAt && s.expiresAt.getTime() > now.getTime(),
      })),
    }
  })
}
