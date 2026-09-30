import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { enforceRateLimit, clientIpFromHeaders, RATE_LIMITS } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * GET /api/platform/announcements/public — active platform
 * announcements for the SCHOOL LOGIN page (title/level/body only —
 * this is an anonymous, rate-limited, status-page-style surface).
 *
 * No platform credential: nothing here is sensitive, and school users
 * must see platform notices at the sign-in door.
 */
export async function GET() {
  return api(async () => {
    enforceRateLimit(`rl:pf-ann-public:${clientIpFromHeaders(new Headers())}`, RATE_LIMITS.platformAnnouncementPublic)

    const announcements = await db.platformAnnouncement.findMany({
      where: {
        OR: [{ audience: 'ALL' }, { audience: 'SCHOOLS' }],
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 3,
      select: { id: true, title: true, body: true, level: true, createdAt: true },
    })

    return {
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        level: a.level,
        at: a.createdAt.toISOString(),
      })),
    }
  })
}
