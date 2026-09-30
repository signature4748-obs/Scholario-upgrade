import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { getUserPreferences, getTeacherPreferences } from '@/lib/user-preferences'
import { audienceAllows, notificationVisibilityWhere } from '@/lib/notices'

export const runtime = 'nodejs'

// LR-1 — audience scoping now lives in ONE place: src/lib/notices.ts
// (shared with /api/student/notices so the bell feed and the Notices
// module can never disagree about who sees what).

// GET aggregated notifications feed: unread messages + recent announcements.
// Announcement read-state is persisted per-user via the NotificationRead table,
// so acknowledgements survive reloads (messages use their own `read` column).
export async function GET() {
  return withUser(async (user) => {
    // Super admin has no school scope — return empty feed
    if (user.role === 'SUPER_ADMIN' || !user.schoolId) {
      return { feed: [], unreadCount: 0 }
    }

    const schoolId = user.schoolId

    // SS-1 — server-enforced notification preferences. The bell feed is
    // the MESSAGE/ANNOUNCEMENT surface, so those channels are honored
    // HERE for both students and teachers (the student's other channels
    // gate the Notices module client-side against the same prefs).
    let prefMessages = true
    let prefAnnouncements = true
    if (user.role === 'STUDENT') {
      const prefs = await getUserPreferences(user.id).catch(() => null)
      prefMessages = prefs?.notifications.messages ?? true
      prefAnnouncements = prefs?.notifications.announcements ?? true
    } else if (user.role === 'TEACHER') {
      // TS-SETTINGS — teacher channel keys (parentMessages / announcements).
      const prefs = await getTeacherPreferences(user.id).catch(() => null)
      prefMessages = prefs?.notifications.parentMessages ?? true
      prefAnnouncements = prefs?.notifications.announcements ?? true
    }

    // Unread messages addressed to this user
    const unreadMessages = prefMessages
      ? await db.message.findMany({
          where: { schoolId, recipientId: user.id, read: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { sender: { select: { name: true, role: true } } },
        })
      : []

    // Recent school announcements (last 8 visible to this role) with read marks.
    // Audience filtering happens app-side because audience tags are free-form
    // (fetch a wider window, filter, then trim so the list stays full).
    const announcementRows = prefAnnouncements
      ? await db.notification.findMany({
          where: { schoolId, status: 'PUBLISHED', ...notificationVisibilityWhere() },
          orderBy: { createdAt: 'desc' },
          take: 24,
          include: { reads: { where: { userId: user.id }, select: { id: true } } },
        })
      : []
    const announcements: typeof announcementRows = []
    const seenBroadcasts = new Set<string>() // title+message of class-fanned announcements
    for (const row of announcementRows) {
      if (announcements.length >= 8) break
      if (await audienceAllows(row.audience, user)) {
        // One announcement per target class is fanned out at publish time.
        // Students match only their own class row, but staff (and role
        // masquerade) match EVERY class row — identical title+message rows
        // would repeat N times in the panel. Show the broadcast once.
        const key = `${row.title}\u0000${row.message}`
        if (seenBroadcasts.has(key)) continue
        seenBroadcasts.add(key)
        announcements.push(row)
      }
    }

    // Combine into a unified feed
    const feed = [
      ...unreadMessages.map((m) => ({
        id: m.id,
        type: 'MESSAGE',
        title: m.sender?.name ?? 'Unknown sender',
        description: m.subject,
        timestamp: m.createdAt,
        read: false,
      })),
      ...announcements.map((a) => ({
        id: a.id,
        type: 'ANNOUNCEMENT',
        title: a.title,
        description: a.message,
        timestamp: a.createdAt,
        read: a.reads.length > 0,
        priority: a.priority,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const unreadAnnouncements = announcements.filter((a) => a.reads.length === 0).length

    return {
      feed: feed.slice(0, 15),
      unreadCount: unreadMessages.length + unreadAnnouncements,
    }
  })
}

// PATCH — persist read state. MESSAGE items set `read` on the row;
// ANNOUNCEMENT items upsert a per-user NotificationRead acknowledgement.
export async function PATCH(req: NextRequest) {
  return withUser(async (user) => {
    const body = await req.json().catch(() => null)
    const id = body?.id
    const type = (body?.type || 'MESSAGE').toUpperCase()
    if (!id || typeof id !== 'string') throw new Error('BAD_REQUEST')

    if (type === 'MESSAGE') {
      // Ensure the message belongs to this user before marking read
      const msg = await db.message.findUnique({ where: { id }, select: { recipientId: true } })
      if (!msg || msg.recipientId !== user.id) throw new Error('NOT_FOUND')
      await db.message.update({ where: { id }, data: { read: true } })
      return { ok: true, persisted: true }
    }

    if (type === 'ANNOUNCEMENT') {
      // Ensure the announcement exists in this user's school scope
      const ntf = await db.notification.findUnique({ where: { id }, select: { schoolId: true } })
      if (!ntf || ntf.schoolId !== user.schoolId) throw new Error('NOT_FOUND')
      await db.notificationRead.upsert({
        where: { notificationId_userId: { notificationId: id, userId: user.id } },
        create: { notificationId: id, userId: user.id },
        update: {},
      })
      return { ok: true, persisted: true }
    }

    return { ok: true, persisted: false }
  })
}
