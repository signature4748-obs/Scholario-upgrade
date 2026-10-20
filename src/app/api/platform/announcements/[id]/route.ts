import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody, safeText, dateStringSchema } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * DELETE /api/platform/announcements/[id] — retract a platform
 * announcement. This is a HARD DELETE: the row is removed from the
 * database entirely (there is no "history" table keeping it). What
 * survives is the audit trail — the platform.announcement.published /
 * .updated / .deleted events for this id remain in PlatformAuditLog.
 * Permission: announcements.manage.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'announcements.manage' },
    async (ctx) => {
      const announcement = await db.platformAnnouncement.findUnique({ where: { id } })
      if (!announcement) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Announcement not found' })
      }

      await db.platformAnnouncement.delete({ where: { id } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.announcement.deleted',
        targetType: 'ANNOUNCEMENT',
        targetId: announcement.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `retracted "${announcement.title}"`,
      })
      return { ok: true }
    },
    { method: 'DELETE' },
  )
}

/**
 * Same expiry window POST enforces via expiresInDays (1–90 days from
 * now) — PATCH receives the exact instant instead, so validate that it
 * lands inside that window.
 */
const updateSchema = strictBody({
  title: safeText(120).optional(),
  body: safeText(1000).optional(),
  level: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  expiresAt: dateStringSchema
    .refine((d) => d.getTime() >= Date.now() + DAY_MS, 'expiresAt must be at least 1 day from now')
    .refine(
      (d) => d.getTime() <= Date.now() + 90 * DAY_MS,
      'expiresAt must be at most 90 days from now',
    )
    .optional(),
})

/**
 * PATCH /api/platform/announcements/[id] — edit an announcement's
 * title/body/level/expiry. At least one field must be provided AND at
 * least one field must actually change (mirrors the settings PATCH).
 * The audit event records ONLY the changed-field names — never the
 * body text (mirrors platform.settings.updated metadata shape).
 * Permission: announcements.manage.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'announcements.manage' },
    async (ctx) => {
      const body = await parseJsonBody(req, updateSchema)

      const announcement = await db.platformAnnouncement.findUnique({ where: { id } })
      if (!announcement) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Announcement not found' })
      }

      const changes: {
        title?: string
        body?: string
        level?: 'INFO' | 'WARNING' | 'CRITICAL'
        expiresAt?: Date
      } = {}
      if (body.title !== undefined && body.title !== announcement.title) changes.title = body.title
      if (body.body !== undefined && body.body !== announcement.body) changes.body = body.body
      if (body.level !== undefined && body.level !== announcement.level) {
        changes.level = body.level
      }
      if (
        body.expiresAt !== undefined &&
        body.expiresAt.getTime() !== announcement.expiresAt?.getTime()
      ) {
        changes.expiresAt = body.expiresAt
      }
      if (Object.keys(changes).length === 0) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Nothing to update' })
      }

      const updated = await db.platformAnnouncement.update({
        where: { id },
        data: changes,
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.announcement.updated',
        targetType: 'ANNOUNCEMENT',
        targetId: updated.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `updated "${updated.title}"`,
        metadata: { changedFields: Object.keys(changes) },
      })

      const now = Date.now()
      return {
        ok: true,
        changedFields: Object.keys(changes),
        announcement: {
          id: updated.id,
          title: updated.title,
          body: updated.body,
          level: updated.level,
          audience: updated.audience,
          createdAt: updated.createdAt.toISOString(),
          expiresAt: updated.expiresAt?.toISOString() ?? null,
          expired: updated.expiresAt ? updated.expiresAt.getTime() < now : false,
        },
      }
    },
    { method: 'PATCH' },
  )
}
