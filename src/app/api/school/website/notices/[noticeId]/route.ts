import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * PATCH   /api/school/website/notices/[noticeId] — edit fields, publish,
 *         unpublish, pin/unpin, expire, re-schedule. The row must belong
 *         to the SESSION school (cross-tenant id = fail-safe 404, no
 *         existence oracle).
 * DELETE  — remove the notice (tenant-scoped).
 *
 * PRINCIPAL / MANAGEMENT only. Mutations are rate-limited + audited;
 * publish/unpublish transitions audit as WEBSITE_NOTICE_PUBLISHED /
 * WEBSITE_NOTICE_UNPUBLISHED.
 */

function serializeNotice(n: {
  id: string
  kind: string
  title: string
  body: string
  category: string | null
  status: string
  publishAt: Date | null
  expiresAt: Date | null
  pinned: boolean
  attachmentFileId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const now = Date.now()
  let effective: string = n.status
  if (n.expiresAt && n.expiresAt.getTime() <= now) effective = 'EXPIRED'
  else if (n.status === 'SCHEDULED' && (!n.publishAt || n.publishAt.getTime() <= now)) effective = 'PUBLISHED'
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    category: n.category,
    status: n.status,
    effectiveStatus: effective,
    publishAt: n.publishAt?.toISOString() ?? null,
    expiresAt: n.expiresAt?.toISOString() ?? null,
    pinned: n.pinned,
    attachmentFileId: n.attachmentFileId,
    attachmentUrl: n.attachmentFileId ? `/api/public/website/media/${n.attachmentFileId}` : null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ noticeId: string }> },
) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage website notices.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webnotice:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const { noticeId } = await params
      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      if (!body) {
        return NextResponse.json(
          { success: false, error: 'Invalid request body.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Tenant-scoped lookup: a foreign id is a 404, never a 403.
      const notice = await db.websiteNotice.findFirst({ where: { id: noticeId, schoolId } })
      if (!notice) {
        return NextResponse.json(
          { success: false, error: 'Notice not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      const patch: Record<string, unknown> = {}
      if (typeof body.title === 'string') {
        const title = body.title.trim()
        if (title.length < 3 || title.length > 120) {
          return NextResponse.json(
            { success: false, error: 'Title must be 3–120 characters.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.title = title
      }
      if (typeof body.body === 'string') {
        const text = body.body.trim()
        if (text.length < 3 || text.length > 5000) {
          return NextResponse.json(
            { success: false, error: 'Body must be 3–5000 characters.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.body = text
      }
      if ('category' in body) {
        patch.category = body?.category ? String(body.category).trim().slice(0, 40) || null : null
      }
      if (typeof body.pinned === 'boolean') patch.pinned = body.pinned

      // Lifecycle transitions. `action` is the canonical verb; a bare
      // `status` string is also accepted for parity with the announcements
      // API style.
      let action = ''
      if (body.action === 'publish' || body.action === 'unpublish' || body.action === 'expire') {
        action = body.action
      } else if (typeof body.status === 'string' && ['DRAFT', 'SCHEDULED', 'PUBLISHED'].includes(body.status)) {
        action = body.status === 'PUBLISHED' ? 'publish' : body.status === 'SCHEDULED' ? 'schedule' : 'unpublish'
      }
      if (action === 'publish') {
        patch.status = 'PUBLISHED'
        patch.publishAt = new Date()
      } else if (action === 'unpublish') {
        patch.status = 'DRAFT'
      } else if (action === 'expire') {
        // Expire now: the row's expiresAt is set to the current moment
        // (lazy expiry at read does the rest — the stored status stays).
        patch.expiresAt = new Date()
      }
      if ('publishAt' in body && action !== 'publish') {
        const publishAt = parseDate(body.publishAt)
        if (body.publishAt !== null && !publishAt) {
          return NextResponse.json(
            { success: false, error: 'Invalid publish date.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.publishAt = publishAt
      }
      if ('expiresAt' in body) {
        const expiresAt = parseDate(body.expiresAt)
        if (body.expiresAt !== null && !expiresAt) {
          return NextResponse.json(
            { success: false, error: 'Invalid expiry date.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.expiresAt = expiresAt
      }
      if (action === 'schedule') {
        const publishAt = (patch.publishAt as Date | null | undefined) ?? notice.publishAt
        if (!publishAt || publishAt.getTime() < Date.now() - 60_000) {
          return NextResponse.json(
            { success: false, error: 'Scheduled publish time must be in the future.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.status = 'SCHEDULED'
      }

      // Coherence against the post-patch values.
      const finalStatus = (patch.status as string | undefined) ?? notice.status
      const finalPublishAt = (patch.publishAt as Date | null | undefined) ?? notice.publishAt
      const finalExpiresAt = (patch.expiresAt as Date | null | undefined) ?? notice.expiresAt
      void finalStatus
      if (finalExpiresAt && finalExpiresAt.getTime() <= (finalPublishAt?.getTime() ?? 0)) {
        return NextResponse.json(
          { success: false, error: 'Expiry must be after the publish time.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Attachment attach/replace/remove (null removes).
      if ('attachmentFileId' in body) {
        if (body.attachmentFileId === null || body.attachmentFileId === '') {
          patch.attachmentFileId = null
        } else if (typeof body.attachmentFileId === 'string') {
          const file = await db.uploadedFile.findFirst({
            where: { id: body.attachmentFileId.trim(), schoolId, scope: 'website' },
            select: { id: true },
          })
          if (!file) {
            return NextResponse.json(
              { success: false, error: 'Attachment not found. Upload it first.' },
              { status: 404, headers: { 'X-Request-Id': requestId } },
            )
          }
          patch.attachmentFileId = file.id
        }
      }

      if (!Object.keys(patch).length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const updated = await db.websiteNotice.update({ where: { id: noticeId }, data: patch })

      // Transition-sensitive audit vocabulary.
      const wasPublished = notice.status === 'PUBLISHED'
      const isPublished = updated.status === 'PUBLISHED'
      let auditAction:
        | 'WEBSITE_CONTENT_UPDATED'
        | 'WEBSITE_NOTICE_PUBLISHED'
        | 'WEBSITE_NOTICE_UNPUBLISHED' = 'WEBSITE_CONTENT_UPDATED'
      if (!wasPublished && isPublished) auditAction = 'WEBSITE_NOTICE_PUBLISHED'
      else if (wasPublished && !isPublished && notice.status !== 'EXPIRED') auditAction = 'WEBSITE_NOTICE_UNPUBLISHED'
      await auditEvent({
        schoolId,
        userId: user.id,
        action: auditAction,
        requestId,
        detail: `Website ${updated.kind.toLowerCase()} "${updated.title}" updated (${Object.keys(patch).join(', ')}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { notice: serializeNotice(updated) } },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ noticeId: string }> },
) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage website notices.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webnotice:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const { noticeId } = await params
      const notice = await db.websiteNotice.findFirst({ where: { id: noticeId, schoolId } })
      if (!notice) {
        return NextResponse.json(
          { success: false, error: 'Notice not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      await db.websiteNotice.delete({ where: { id: noticeId } })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: notice.status === 'PUBLISHED' ? 'WEBSITE_NOTICE_UNPUBLISHED' : 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Website ${notice.kind.toLowerCase()} "${notice.title}" deleted by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json({ success: true }, { headers: { 'X-Request-Id': requestId } })
    },
  )
}
