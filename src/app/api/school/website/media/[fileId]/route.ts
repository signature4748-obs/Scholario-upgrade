import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { storageDelete, storedObjectLocation } from '@/lib/storage/supabase'

export const runtime = 'nodejs'

/**
 * PATCH   /api/school/website/media/[fileId] — curation metadata:
 *         title / altText / usage / published (archive = unpublish).
 * DELETE  — remove the media-library row. The UploadedFile registry row
 *         and the storage object are removed ONLY when no other reference
 *         exists (gallery image, announcement image, notice attachment,
 *         school logo) — otherwise the file stays owned in the registry
 *         and simply stops being served once no PUBLISHED reference
 *         remains (the established privacy-gate pattern).
 *
 * PRINCIPAL / MANAGEMENT only; tenant-scoped lookups (cross-tenant id =
 * fail-safe 404); rate-limited + audited.
 */

const USAGES = new Set(['LIBRARY', 'GALLERY', 'HERO', 'LOGO'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can curate the media library.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webmedia:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const { fileId } = await params
      // The WebsiteMedia row is keyed by (schoolId, fileId) — the tenant is
      // the session's, never the client's.
      const media = await db.websiteMedia.findFirst({ where: { fileId, schoolId } })
      if (!media) {
        return NextResponse.json(
          { success: false, error: 'Media item not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const patch: Record<string, unknown> = {}
      if ('title' in (body ?? {})) {
        patch.title = body?.title ? String(body.title).trim().slice(0, 120) || null : null
      }
      if ('altText' in (body ?? {})) {
        patch.altText = body?.altText ? String(body.altText).trim().slice(0, 200) || null : null
      }
      if (typeof body?.usage === 'string' && USAGES.has(body.usage)) {
        patch.usage = body.usage
      }
      if (typeof body?.published === 'boolean') patch.published = body.published

      if (!Object.keys(patch).length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const updated = await db.websiteMedia.update({ where: { id: media.id }, data: patch })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Media item ${fileId} updated (${Object.keys(patch).join(', ')}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            media: {
              id: updated.id,
              fileId: updated.fileId,
              mediaType: updated.mediaType,
              title: updated.title,
              altText: updated.altText,
              usage: updated.usage,
              published: updated.published,
              url: `/api/public/website/media/${updated.fileId}`,
            },
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can curate the media library.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webmedia:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const { fileId } = await params
      const media = await db.websiteMedia.findFirst({ where: { fileId, schoolId } })
      if (!media) {
        return NextResponse.json(
          { success: false, error: 'Media item not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Does anything else still reference the file? (All lookups are
      // tenant-bounded — a foreign school's gallery/notice row can never
      // keep THIS school's file alive, and vice versa.)
      const [galleryUse, announcementUse, noticeUse, logoUse] = await Promise.all([
        db.galleryImage.findFirst({ where: { fileId, album: { schoolId } }, select: { id: true } }),
        db.notification.findFirst({ where: { imageId: fileId, schoolId }, select: { id: true } }),
        db.websiteNotice.findFirst({ where: { attachmentFileId: fileId, schoolId }, select: { id: true } }),
        db.school.findFirst({ where: { logoUrl: fileId, id: schoolId }, select: { id: true } }),
      ])
      const referenced = Boolean(galleryUse || announcementUse || noticeUse || logoUse)

      await db.websiteMedia.delete({ where: { id: media.id } })

      if (!referenced) {
        // Nothing references the bytes — remove the registry row and the
        // storage object too (the established rollback pattern).
        const location = storedObjectLocation('website', schoolId, fileId)
        await db.uploadedFile.delete({ where: { id: fileId } }).catch(() => {})
        await storageDelete(location.bucket, location.path).catch(() => {})
      }

      await auditEvent({
        schoolId,
        userId: user.id,
        action: referenced ? 'WEBSITE_CONTENT_UPDATED' : 'FILE_DELETED',
        requestId,
        detail: `Media item ${fileId} removed from the library by ${user.name}${referenced ? ' (file kept — still referenced)' : ' (file + object deleted)'}`,
      }).catch(() => {})

      return NextResponse.json({ success: true }, { headers: { 'X-Request-Id': requestId } })
    },
  )
}
