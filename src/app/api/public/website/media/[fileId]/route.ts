import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { newRequestId } from '@/lib/security/errors'
import { clientIpFromHeaders, checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { isValidStoredFileId, WEBSITE_UPLOAD_POLICY } from '@/lib/security/upload'
import { notificationVisibilityWhere } from '@/lib/notices'
import {
  storedObjectLocation,
  storageDownload,
} from '@/lib/storage/supabase'

export const runtime = 'nodejs'

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
 *
 * Phase 8A (8A-C9) — the bytes live in the PUBLIC 'public-media' bucket
 * (`website/<schoolId>/<fileId>`). This gate route still decides WHO
 * may fetch: when (and only when) the published-reference check passes,
 * the route REDIRECTS (302) to the object's public URL. TRUST MODEL
 * (documented per mission): the public URL is unguessable-ish — the
 * fileId is an opaque server-minted id — but PUBLIC once known; that is
 * the same trust model the local-disk public media had (the gate has
 * always been the only thing standing between an unpublished upload and
 * the world). The public Cache-Control policy is preserved on the
 * redirect; existence is probed first so "row exists but bytes gone"
 * keeps the honest 404.
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

    // ── Gate passed (Phase 8A): stream the object bytes SAME-ORIGIN.
    // The earlier 302-redirect design broke the Next <Image> optimizer
    // (/_next/image fetches the redirect target — a remote Supabase host
    // that is neither allow-listed nor resolvable by the optimizer —
    // HTTP 400 "not a valid image", QA 8A-QA/B8). Streaming the bytes
    // through this gate keeps the privacy model AND makes the route a
    // plain same-origin image source the optimizer can consume. The
    // public Cache-Control policy is preserved on the byte response.
    const location = storedObjectLocation('website', file.schoolId, fileId)
    const bytes = await storageDownload(location.bucket, location.path).catch(() => null)
    if (!bytes || bytes.byteLength === 0) {
      return new NextResponse('Not found', { status: 404, headers: { 'X-Request-Id': requestId } })
    }

    // Content type from the extension (the route's ext allowlist already
    // gated the id; the bucket objects were magic-byte-validated at upload).
    const ext = fileId.toLowerCase().split('.').pop() ?? ''
    const contentType =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    const res = new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(bytes.byteLength),
        'X-Request-Id': requestId,
      },
    })
    return res
  } catch {
    return new NextResponse('Unavailable', { status: 503, headers: { 'X-Request-Id': requestId } })
  }
}
