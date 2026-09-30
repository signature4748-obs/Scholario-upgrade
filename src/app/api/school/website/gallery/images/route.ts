import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * Gallery image management (session-scoped).
 *
 * POST   /api/school/website/gallery/images
 *        { albumId, fileId, caption? } — attach an UPLOADED website image
 *        to an album (file must be registered in the CALLER's school).
 * PATCH  { imageId, caption?, order? } — edit caption / reorder.
 * DELETE ?imageId=… — remove the image row.
 */

async function albumOfSessionSchool(albumId: string, schoolId: string) {
  return db.galleryAlbum.findFirst({ where: { id: albumId, schoolId } })
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage the gallery.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:galimg:${user.id}`, RATE_LIMITS.upload)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const albumId = String(body?.albumId || '')
      const fileId = String(body?.fileId || '').trim()
      const caption = body?.caption ? String(body.caption).trim().slice(0, 200) : null
      if (!albumId || !fileId) {
        return NextResponse.json(
          { success: false, error: 'albumId and fileId are required.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const album = await albumOfSessionSchool(albumId, schoolId)
      if (!album) {
        return NextResponse.json(
          { success: false, error: 'Album not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      // The file must be a WEBSITE-scope upload OWNED by this school —
      // a foreign school's file id is indistinguishable from a missing one.
      const file = await db.uploadedFile.findFirst({ where: { id: fileId, schoolId, scope: 'website' } })
      if (!file) {
        return NextResponse.json(
          { success: false, error: 'Image not found. Upload it first.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      const maxOrder = await db.galleryImage.aggregate({
        where: { albumId },
        _max: { order: true },
      })
      const image = await db.galleryImage.create({
        data: { albumId, fileId, caption, order: (maxOrder._max.order ?? 0) + 1 },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'GALLERY_UPDATED',
        requestId,
        detail: `Gallery image added to "${album.title}" (${fileId}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            image: {
              id: image.id, fileId: image.fileId, caption: image.caption, order: image.order,
              url: `/api/public/website/media/${image.fileId}`,
            },
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function PATCH(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage the gallery.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const imageId = String(body?.imageId || '')
      if (!imageId) {
        return NextResponse.json(
          { success: false, error: 'imageId is required.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      // Tenant-safe: join image → album → session school.
      const image = await db.galleryImage.findFirst({
        where: { id: imageId, album: { schoolId } },
      })
      if (!image) {
        return NextResponse.json(
          { success: false, error: 'Image not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      const patch: Record<string, unknown> = {}
      if ('caption' in (body ?? {})) {
        patch.caption = body?.caption ? String(body.caption).trim().slice(0, 200) : null
      }
      if (typeof body?.order === 'number' && Number.isFinite(body.order)) {
        patch.order = Math.max(0, Math.min(9999, Math.trunc(body.order)))
      }
      if (!Object.keys(patch).length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const updated = await db.galleryImage.update({ where: { id: imageId }, data: patch })
      return NextResponse.json(
        {
          success: true,
          data: {
            image: {
              id: updated.id, fileId: updated.fileId, caption: updated.caption, order: updated.order,
              url: `/api/public/website/media/${updated.fileId}`,
            },
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function DELETE(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage the gallery.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      const imageId = req.nextUrl.searchParams.get('imageId') || ''
      if (!imageId) {
        return NextResponse.json(
          { success: false, error: 'imageId is required.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      const image = await db.galleryImage.findFirst({
        where: { id: imageId, album: { schoolId } },
      })
      if (!image) {
        return NextResponse.json(
          { success: false, error: 'Image not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      await db.galleryImage.delete({ where: { id: imageId } })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'GALLERY_UPDATED',
        requestId,
        detail: `Gallery image removed (${image.fileId}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json({ success: true }, { headers: { 'X-Request-Id': requestId } })
    },
  )
}
