import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * GET /api/school/website/gallery — this school's albums (with images).
 * Management-view: includes UNPUBLISHED albums + drafts (session school).
 */
export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const albums = await db.galleryAlbum.findMany({
        where: { schoolId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: {
          images: {
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          },
        },
      })
      return NextResponse.json(
        {
          success: true,
          data: {
            albums: albums.map((a) => ({
              id: a.id,
              title: a.title,
              description: a.description,
              published: a.published,
              order: a.order,
              imageCount: a.images.length,
              images: a.images.map((i) => ({
                id: i.id,
                fileId: i.fileId,
                url: `/api/public/website/media/${i.fileId}`,
                caption: i.caption,
                order: i.order,
              })),
            })),
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

/**
 * POST /api/school/website/gallery — create an album.
 * { title, description? } — title unique per school (3..80 chars).
 */
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
      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const title = String(body?.title || '').trim()
      const description = body?.description ? String(body.description).trim().slice(0, 400) : null
      if (title.length < 3 || title.length > 80) {
        return NextResponse.json(
          { success: false, error: 'Album title must be 3–80 characters.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const exists = await db.galleryAlbum.findUnique({
        where: { schoolId_title: { schoolId, title } },
        select: { id: true },
      })
      if (exists) {
        return NextResponse.json(
          { success: false, error: 'An album with this title already exists.' },
          { status: 409, headers: { 'X-Request-Id': requestId } },
        )
      }

      const maxOrder = await db.galleryAlbum.aggregate({
        where: { schoolId },
        _max: { order: true },
      })
      const album = await db.galleryAlbum.create({
        data: { schoolId, title, description, order: (maxOrder._max.order ?? 0) + 1 },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'GALLERY_UPDATED',
        requestId,
        detail: `Gallery album created "${title}" by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { album: { id: album.id, title: album.title, published: album.published, order: album.order } } },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

/**
 * PATCH /api/school/website/gallery — update an album
 * { albumId, title?, description?, published?, order? }.
 * The album must belong to the session school (cross-tenant = 404).
 */
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
      const albumId = String(body?.albumId || '')
      if (!albumId) {
        return NextResponse.json(
          { success: false, error: 'albumId is required.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const album = await db.galleryAlbum.findFirst({ where: { id: albumId, schoolId } })
      if (!album) {
        return NextResponse.json(
          { success: false, error: 'Album not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      const patch: Record<string, unknown> = {}
      if ('title' in (body ?? {})) {
        const title = String(body?.title || '').trim()
        if (title.length < 3 || title.length > 80) {
          return NextResponse.json(
            { success: false, error: 'Album title must be 3–80 characters.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        if (title !== album.title) {
          const dupe = await db.galleryAlbum.findUnique({
            where: { schoolId_title: { schoolId, title } },
            select: { id: true },
          })
          if (dupe) {
            return NextResponse.json(
              { success: false, error: 'An album with this title already exists.' },
              { status: 409, headers: { 'X-Request-Id': requestId } },
            )
          }
        }
        patch.title = title
      }
      if ('description' in (body ?? {})) {
        patch.description = body?.description ? String(body.description).trim().slice(0, 400) : null
      }
      if (body?.published === true || body?.published === false) patch.published = body.published
      if (typeof body?.order === 'number' && Number.isFinite(body.order)) {
        patch.order = Math.max(0, Math.min(9999, Math.trunc(body.order)))
      }

      if (!Object.keys(patch).length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const updated = await db.galleryAlbum.update({
        where: { id: albumId },
        data: patch,
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'GALLERY_UPDATED',
        requestId,
        detail: `Gallery album "${updated.title}" updated (${Object.keys(patch).join(', ')}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { album: { id: updated.id, title: updated.title, published: updated.published, order: updated.order } } },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

/**
 * DELETE /api/school/website/gallery?albumId=… — remove an album and its
 * image rows (uploaded files stay owned in the registry; the public
 * media route stops serving them once no published reference remains).
 */
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
      const albumId = req.nextUrl.searchParams.get('albumId') || ''
      if (!albumId) {
        return NextResponse.json(
          { success: false, error: 'albumId is required.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      const album = await db.galleryAlbum.findFirst({ where: { id: albumId, schoolId } })
      if (!album) {
        return NextResponse.json(
          { success: false, error: 'Album not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      await db.galleryAlbum.delete({ where: { id: albumId } })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'GALLERY_UPDATED',
        requestId,
        detail: `Gallery album "${album.title}" deleted by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json({ success: true }, { headers: { 'X-Request-Id': requestId } })
    },
  )
}
