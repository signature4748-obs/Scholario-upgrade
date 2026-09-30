import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * PATCH /api/announcements/[id] — edit an announcement (PHASE 7.5
 * lifecycle): title/message/audience/priority, status transitions
 * (draft → publish → archive), publishAt/expiresAt rescheduling, image
 * attach/replace/remove.
 *
 * PRINCIPAL / MANAGEMENT only. The row must belong to the session
 * school (cross-tenant id = fail-safe 404). Edits of PUBLISHED rows
 * re-broadcast through the event-stream (publish flow unchanged);
 * updatedBy audit is recorded on every write.
 */
function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const AUDIENCE_MAP: Record<string, string> = {
  'All Parents': 'PARENTS',
  'All Students': 'STUDENTS',
  'All Teachers': 'TEACHERS',
  'All Staff': 'STAFF',
  'Whole School': 'ALL',
}

function mapAudience(raw: string): string {
  const trimmed = raw.trim()
  if (AUDIENCE_MAP[trimmed]) return AUDIENCE_MAP[trimmed]
  if (/class|grade|section/i.test(trimmed)) return `CLASS:${trimmed}`
  return trimmed.toUpperCase()
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') throw new Error('FORBIDDEN')
      const schoolId = schoolScoped(user)
      const { id } = await params

      const existing = await db.notification.findFirst({ where: { id, schoolId } })
      if (!existing) throw new Error('Announcement not found')

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      if (!body) throw new Error('Invalid request body')

      const patch: Record<string, unknown> = { updatedById: user.id }

      if (typeof body.title === 'string') {
        const title = body.title.trim()
        if (title.length < 3 || title.length > 120) throw new Error('Title must be 3–120 characters')
        patch.title = title
      }
      if (typeof body.message === 'string') {
        const message = body.message.trim()
        if (message.length < 3 || message.length > 2000) throw new Error('Message must be 3–2000 characters')
        patch.message = message
      }
      if (typeof body.audience === 'string' && body.audience.trim()) {
        patch.audience = mapAudience(body.audience)
      }
      if (typeof body.priority === 'string' && ['NORMAL', 'HIGH', 'URGENT'].includes(body.priority)) {
        patch.priority = body.priority
      }

      // Lifecycle transitions
      if (typeof body.status === 'string' && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(body.status)) {
        patch.status = body.status
        // Publishing now (or scheduling): keep provided publishAt/expiry
      }
      if ('publishAt' in body) {
        const publishAt = parseDate(body.publishAt)
        if (body.publishAt !== null && !publishAt) throw new Error('Invalid publish date')
        patch.publishAt = publishAt
      }
      if ('expiresAt' in body) {
        const expiresAt = parseDate(body.expiresAt)
        if (body.expiresAt !== null && !expiresAt) throw new Error('Invalid expiry date')
        patch.expiresAt = expiresAt
      }

      const finalStatus = (patch.status as string) ?? existing.status
      const finalPublishAt = (patch.publishAt as Date | null | undefined) ?? existing.publishAt
      const finalExpiresAt = (patch.expiresAt as Date | null | undefined) ?? existing.expiresAt
      if (finalStatus === 'PUBLISHED' && finalPublishAt && finalPublishAt.getTime() < Date.now() - 60_000) {
        throw new Error('Scheduled publish time must be in the future')
      }
      if (finalExpiresAt && finalPublishAt && finalExpiresAt.getTime() <= finalPublishAt.getTime()) {
        throw new Error('Expiry must be after the publish time')
      }

      // Image attach/replace/remove (null removes)
      if ('imageId' in body) {
        if (body.imageId === null || body.imageId === '') {
          patch.imageId = null
        } else if (typeof body.imageId === 'string') {
          const imageFile = await db.uploadedFile.findFirst({
            where: { id: body.imageId.trim(), schoolId, scope: 'website' },
            select: { id: true },
          })
          if (!imageFile) throw new Error('Image not found. Upload it first.')
          patch.imageId = imageFile.id
        }
      }

      const updated = await db.notification.update({
        where: { id },
        data: patch,
        include: { sender: { select: { name: true } } },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'ANNOUNCEMENT_UPDATED',
        detail: `Announcement "${updated.title}" updated (${Object.keys(patch).filter((k) => k !== 'updatedById').join(', ') || 'no-op'}) by ${user.name}`,
      }).catch(() => {})

      return {
        id: updated.id,
        title: updated.title,
        message: updated.message,
        audience: updated.audience,
        priority: updated.priority,
        status: updated.status,
        publishAt: updated.publishAt,
        expiresAt: updated.expiresAt,
        imageId: updated.imageId,
        imageUrl: updated.imageId ? `/api/public/website/media/${updated.imageId}` : null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        sender: updated.sender?.name ?? user.name,
        live: updated.status === 'PUBLISHED',
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}

/**
 * DELETE /api/announcements/[id] — remove an announcement (draft or
 * published). The row must belong to the session school. Read receipts
 * cascade with the row; the uploaded image (registry-owned) is left in
 * place (it may be referenced by other rows; unpublished references stop
 * serving publicly automatically).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') throw new Error('FORBIDDEN')
      const schoolId = schoolScoped(user)
      const { id } = await params

      const existing = await db.notification.findFirst({ where: { id, schoolId } })
      if (!existing) throw new Error('Announcement not found')

      await db.notification.delete({ where: { id } })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'ANNOUNCEMENT_DELETED',
        detail: `Announcement "${existing.title}" deleted by ${user.name}`,
      }).catch(() => {})

      return { deleted: true, id }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
