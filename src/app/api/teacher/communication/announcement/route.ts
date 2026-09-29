import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { requireTeacher, auditTeacherAction, parseDate, classLabelOf } from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

// POST /api/teacher/communication/announcement — publish a school
// announcement as ONE canonical Notification row with audience targeting
// (never per-recipient copies). Authorization is enforced server-side and
// SPLIT by scope (3-d audit fix):
//   · CLASS-SCOPED audiences require the class-teacher appointment for a
//     TEACHER (the classId is re-derived from the session —
//     ctx.classTeacherOf; a client can never target a class the teacher is
//     not appointed to). PRINCIPAL/MANAGEMENT may target any class in
//     their school.
//   · SCHOOL-WIDE audiences are PRINCIPAL/MANAGEMENT ONLY
//     ('school.announcements.publish' in the server-side permission
//     matrix). The previous gate consulted the CLIENT-side
//     teachers-store SEED roster (SEED_TEACHERS position permissions) —
//     client-store data is never authorization; that import is removed.
//     The principal's own school-wide flow is untouched (it publishes via
//     /api/announcements); a normal teacher can still reach her own class.
const SCHOOL_AUDIENCE_TAGS: Record<string, string> = {
  'all-teachers': 'TEACHERS',
  'all-parents': 'PARENTS',
  'all-staff': 'STAFF',
  'whole-school': 'ALL',
}
const PRIORITIES = new Set(['NORMAL', 'HIGH', 'URGENT'])

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      // Per-user announce throttle (same profile as the messaging routes).
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)

      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      const audienceInput = typeof body.audience === 'string' ? body.audience.trim() : ''
      const priority =
        typeof body.priority === 'string' && PRIORITIES.has(body.priority)
          ? body.priority
          : 'NORMAL'

      if (!title || title.length < 3) throw new Error('Title must be at least 3 characters')
      if (title.length > 120) throw new Error('Title must be at most 120 characters')
      if (!message || message.length < 3) throw new Error('Message must be at least 3 characters')
      if (message.length > 2000) throw new Error('Message must be at most 2000 characters')
      if (!audienceInput) throw new Error('Audience is required')

      // ── Audience resolution (structured value, re-derived server-side) ──
      //   school-wide: 'whole-school' | 'all-teachers' | 'all-parents' | 'all-staff'
      //   class-scoped: 'class:<classId>' | 'class-parents:<classId>' | 'class-students:<classId>'
      let audience: string
      if (SCHOOL_AUDIENCE_TAGS[audienceInput]) {
        if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
          throw new AppError('FORBIDDEN', {
            publicMessage: 'School-wide announcements require a principal or management account',
            internalDetail: `announcement POST: role ${user.role} attempted school-wide audience`,
          })
        }
        audience = SCHOOL_AUDIENCE_TAGS[audienceInput]
      } else {
        const [kindRaw, classIdRaw] = audienceInput.split(':')
        const kind = (kindRaw ?? '').toLowerCase()
        const classId = (classIdRaw ?? '').trim()
        if (!['class', 'class-parents', 'class-students'].includes(kind) || !classId) {
          throw new Error('Audience must be a school-wide group or one of your classes')
        }
        if (user.role === 'TEACHER') {
          // Re-derive the class from the session — the appointment IS the
          // permission for class-scoped announcements.
          const ctx = await requireTeacher(user)
          const ownClass = ctx.classTeacherOf.find((c) => c.id === classId)
          if (!ownClass) {
            throw new AppError('FORBIDDEN', {
              publicMessage: 'You can only announce to classes you are the class teacher of',
              internalDetail: `announcement POST: teacher ${user.id} not class teacher of ${classId}`,
            })
          }
          audience =
            kind === 'class-parents'
              ? `CLASS_PARENTS:${ownClass.label}`
              : kind === 'class-students'
                ? `CLASS_STUDENTS:${ownClass.label}`
                : `CLASS:${ownClass.label}`
        } else {
          // PRINCIPAL / MANAGEMENT: any class inside their own school.
          const cls = await db.class.findFirst({
            where: { id: classId, schoolId },
            select: { id: true, name: true, section: true },
          })
          if (!cls) {
            throw new AppError('NOT_FOUND', {
              publicMessage: 'Class not found',
              internalDetail: `announcement POST: class ${classId} missing or foreign tenant`,
            })
          }
          const label = classLabelOf(cls)
          audience =
            kind === 'class-parents'
              ? `CLASS_PARENTS:${label}`
              : kind === 'class-students'
                ? `CLASS_STUDENTS:${label}`
                : `CLASS:${label}`
        }
      }

      // ── Optional schedule + expiry (Notification.publishAt / expiresAt —
      //    every reader filters through notificationVisibilityWhere, so a
      //    scheduled row stays invisible until due and an expired one
      //    disappears everywhere at once). ──
      let publishAt: Date | null = null
      let expiresAt: Date | null = null
      if (body.publishAt != null && body.publishAt !== '') {
        if (typeof body.publishAt !== 'string') throw new Error('Publish date must be a date-time')
        publishAt = parseDate(body.publishAt, 'Publish date')
      }
      if (body.expiresAt != null && body.expiresAt !== '') {
        if (typeof body.expiresAt !== 'string') throw new Error('Expiry date must be a date-time')
        expiresAt = parseDate(body.expiresAt, 'Expiry date')
        if (publishAt && expiresAt.getTime() <= publishAt.getTime()) {
          throw new Error('Expiry must be after the publish date')
        }
        if (!publishAt && expiresAt.getTime() <= Date.now()) {
          throw new Error('Expiry must be in the future')
        }
      }

      const notification = await db.notification.create({
        data: {
          schoolId,
          title,
          message,
          audience,
          priority,
          senderId: user.id,
          ...(publishAt ? { publishAt } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        },
      })

      await auditTeacherAction(
        user,
        schoolId,
        user.role === 'TEACHER' ? 'TEACHER_ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_PUBLISHED',
        `"${title}" → ${audience}${publishAt ? ` (scheduled ${publishAt.toISOString()})` : ''} (notification ${notification.id})`,
      )

      return {
        id: notification.id,
        title: notification.title,
        audience: notification.audience,
        priority: notification.priority,
        publishAt: notification.publishAt ? notification.publishAt.toISOString() : null,
        expiresAt: notification.expiresAt ? notification.expiresAt.toISOString() : null,
        createdAt: notification.createdAt.toISOString(),
      }
    },
    { roles: ['TEACHER', 'PRINCIPAL', 'MANAGEMENT'] },
  )
}
