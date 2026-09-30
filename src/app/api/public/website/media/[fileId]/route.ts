import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { newRequestId } from '@/lib/security/errors'
import { clientIpFromHeaders, checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { isValidStoredFileId, WEBSITE_UPLOAD_POLICY } from '@/lib/security/upload'
import { notificationVisibilityWhere } from '@/lib/notices'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'website')

/**
 * GET /api/public/website/media/<fileId> — PUBLIC website image bytes.
 *
 * PRIVACY BY DEFAULT: a stored website-scope image is only served when a
 * PUBLISHED reference exists —
 *   · a GalleryImage whose album is published, OR
 *   · a PUBLISHED + visible announcement carrying the image, OR
 *   · the image is the school's branding (logo referenced by School.logoUrl
 *     of an ACTIVE school).
 * Unpublished/draft/private uploads fail-safe 404. No school data beyond
 * the image bytes is ever exposed. Anonymous per-IP rate limited.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = newRequestId()
  try {
    const ip = clientIpFromHeaders(req.headers)
    const verdict = checkRateLimit(`rl:webmedia:${ip}`, RATE_LIMITS.publicSchool)
    if (!verdict.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests.' },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec), 'X-Request-Id': requestId } },
      )
    }

    const { fileId } = await params
    if (!isValidStoredFileId(fileId, WEBSITE_UPLOAD_POLICY.allowedExts)) {
      return new NextResponse('Not found', { status: 404, headers: { 'X-Request-Id': requestId } })
    }

    // Ownership + published-reference check (single registry lookup).
    const file = await db.uploadedFile.findUnique({ where: { id: fileId } })
    if (!file || file.scope !== 'website') {
      return new NextResponse('Not found', { status: 404, headers: { 'X-Request-Id': requestId } })
    }

    const now = new Date()

    const [publishedGalleryImage, publishedAnnouncement, brandLogo] = await Promise.all([
      db.galleryImage.findFirst({
        where: { fileId, album: { published: true, school: { status: 'ACTIVE' } } },
        select: { id: true },
      }),
      db.notification.findFirst({
        where: {
          imageId: fileId,
          status: 'PUBLISHED',
          school: { status: 'ACTIVE' },
          ...notificationVisibilityWhere(now),
        },
        select: { id: true },
      }),
      db.school.findFirst({
        where: { logoUrl: fileId, status: 'ACTIVE' },
        select: { id: true },
      }),
    ])

    if (!publishedGalleryImage && !publishedAnnouncement && !brandLogo) {
      return new NextResponse('Not found', { status: 404, headers: { 'X-Request-Id': requestId } })
    }

    let bytes: Buffer
    try {
      bytes = await readFile(path.join(UPLOAD_DIR, fileId))
    } catch {
      return new NextResponse('Not found', { status: 404, headers: { 'X-Request-Id': requestId } })
    }

    const ext = fileId.split('.').pop()?.toLowerCase()
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
      },
    })
  } catch {
    return new NextResponse('Unavailable', { status: 503, headers: { 'X-Request-Id': requestId } })
  }
}
