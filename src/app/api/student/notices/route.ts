import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { audienceAllows, audienceLabel , notificationVisibilityWhere} from '@/lib/notices'

export const runtime = 'nodejs'

/// GET /api/student/notices
///
/// LR-1 — the REAL announcements feed behind the student Notices module
/// (Announcements tab + the My Feed "School news" slice). Everything is
/// derived from Notification rows published by the school, scoped to the
/// authenticated student's school (session-derived — client ids are never
/// trusted), audience-filtered (ALL / STUDENTS / CLASS:<their class>), and
/// carries the per-user read state from NotificationRead so acknowledged
/// notices stay acknowledged across devices and reloads.
///
/// Marking a notice read reuses the existing
/// PATCH /api/notifications-feed { id, type: 'ANNOUNCEMENT' } (same
/// NotificationRead upsert — one acknowledgement path everywhere).
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = user.schoolId
      if (!schoolId) return { notices: [] }

      // Audience tags are free-form — fetch a wider window, filter to what
      // THIS student may see, then trim.
      const rows = await db.notification.findMany({
        where: { schoolId, status: 'PUBLISHED', ...notificationVisibilityWhere() },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: {
          sender: { select: { name: true, role: true } },
          reads: { where: { userId: user.id }, select: { id: true, readAt: true } },
        },
      })

      const seenBroadcasts = new Set<string>() // class-fanout dedupe (one broadcast, one row)
      const notices: {
        id: string
        title: string
        message: string
        audience: string
        priority: string
        sender: string
        senderRole: string | null
        createdAt: string
        read: boolean
        readAt: string | null
      }[] = []
      for (const row of rows) {
        if (notices.length >= 30) break
        if (!(await audienceAllows(row.audience, user))) continue
        const key = `${row.title}\u0000${row.message}`
        if (seenBroadcasts.has(key)) continue
        seenBroadcasts.add(key)
        const read = row.reads[0]
        notices.push({
          id: row.id,
          title: row.title,
          message: row.message,
          audience: audienceLabel(row.audience),
          priority: row.priority,
          sender: row.sender?.name ?? 'School office',
          senderRole: row.sender?.role ?? null,
          createdAt: row.createdAt.toISOString(),
          read: !!read,
          readAt: read ? read.readAt.toISOString() : null,
        })
      }

      return { notices }
    },
    { roles: ['STUDENT'] },
  )
}
