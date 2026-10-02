import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { notificationVisibilityWhere } from '@/lib/notices'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { AppError } from '@/lib/security/errors'
import { publishToSchool } from '@/lib/realtime/publish'

export const runtime = 'nodejs'

// Audience vocabulary this route may mint. Class-family tags
// (CLASS:/CLASS_STUDENTS:/CLASS_PARENTS:) are intentionally NOT accepted
// here — class-scoped publishing is the announcement route's job, where
// the class-teacher appointment is re-derived server-side.
const AUDIENCE_WHITELIST = ['ALL', 'STUDENTS', 'PARENTS', 'TEACHERS', 'STAFF'] as const
const PRIORITY_WHITELIST = ['NORMAL', 'HIGH', 'URGENT'] as const

export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const notifs = await db.notification.findMany({
        where: { schoolId, ...notificationVisibilityWhere() },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { sender: { select: { name: true } } },
      })
      return notifs
    },
    // Audit §11 — staff announcement feed; the student-facing bell feed
    // is the separately scoped /api/notifications-feed.
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}

// POST /api/notifications — publish a school-wide announcement Notification.
//
// 3-d audit fix: this route previously let ANY teacher publish school-wide
// announcements, bypassing the announcements-permission gate enforced on
// /api/teacher/communication/announcement. Client-consumer evidence
// (grep '"/api/notifications"' across src/components + src/lib): NO client
// surface calls this route — the teacher Communication Hub publishes via
// /api/teacher/communication/announcement and the principal via
// /api/announcements. Publishing here is therefore gated to
// PRINCIPAL/MANAGEMENT ('school.announcements.publish'); teachers keep
// their (scoped) route, so no working legit flow is broken.
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only the principal or management can publish school-wide announcements',
          internalDetail: `notifications POST: role ${user.role} lacks school.announcements.publish`,
        })
      }

      // Per-user announce throttle (same profile the messaging routes use).
      enforceRateLimit(`rl:notify:${user.id}`, RATE_LIMITS.message)

      const body = await req.json().catch(() => ({}))
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (!title || !message) throw new Error('title and message required')
      if (title.length > 120) throw new Error('Title must be at most 120 characters')
      if (message.length > 2000) throw new Error('Message must be at most 2000 characters')

      const audienceRaw = typeof body.audience === 'string' ? body.audience.trim().toUpperCase() : 'ALL'
      if (!(AUDIENCE_WHITELIST as readonly string[]).includes(audienceRaw)) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Audience must be one of ${AUDIENCE_WHITELIST.join(', ')}`,
          internalDetail: `notifications POST: audience whitelist rejected: ${String(body.audience).slice(0, 60)}`,
        })
      }
      const priorityRaw = typeof body.priority === 'string' ? body.priority.trim().toUpperCase() : 'NORMAL'
      if (!(PRIORITY_WHITELIST as readonly string[]).includes(priorityRaw)) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Priority must be one of ${PRIORITY_WHITELIST.join(', ')}`,
          internalDetail: `notifications POST: priority whitelist rejected: ${String(body.priority).slice(0, 40)}`,
        })
      }

      const n = await db.notification.create({
        data: {
          schoolId,
          title,
          message,
          audience: audienceRaw,
          priority: priorityRaw,
          senderId: user.id,
        },
      })

      // PHASE 8B — realtime announcement frame (school-wide, fire-and-forget):
      // rows default to PUBLISHED, no scheduling on this surface.
      // AWAITED (Phase 8C-N fix — Vercel freezes the function after the
      // response; un-awaited publish fetches never complete).
      await publishToSchool(schoolId, 'all', 'announcement', {
        id: n.id,
        at: n.createdAt.toISOString(),
        schoolId,
        title,
        detail: message.slice(0, 120),
      })

      // Audit trail (ActivityLog — the same school-scoped domain journal the
      // teacher announcement route writes to; auditEvent's canonical
      // vocabulary has no announcement action and security/* is owned by
      // the central-layer agent, so the domain action lands here).
      try {
        await db.activityLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'ANNOUNCEMENT_PUBLISHED',
            detail: `"${title}" → ${audienceRaw} (${priorityRaw}) (notification ${n.id})`,
          },
        })
      } catch {
        // audit is best-effort by design — never fails the publish
      }

      return n
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}
