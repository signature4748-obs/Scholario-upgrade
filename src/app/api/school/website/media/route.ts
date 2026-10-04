import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { storageUpload, storageDelete } from '@/lib/storage/supabase'
import {
  WEBSITE_UPLOAD_POLICY,
  sniffFileType,
  EXT_BY_TYPE,
  MIME_BY_TYPE,
  readImageDimensions,
  contentLengthExceedsUploadLimit,
} from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * Media library (task 2-a).
 *
 * GET  /api/school/website/media — this school's WebsiteMedia rows joined
 *      with their UploadedFile registry metadata (curation view).
 * POST — upload a new image (multipart `file`, optional `title`/`altText`).
 *      Follows the website image pipeline EXACTLY: magic-byte type policy
 *      (JPG/PNG/WebP, ≤4 MB), server-minted opaque fileId, UploadedFile
 *      registry row (scope 'website', session school), public-bucket
 *      object at `website/<schoolId>/<fileId>`. The bytes are served
 *      publicly ONLY while a published reference exists — for the library
 *      that is the WebsiteMedia row's own `published` flag (the public
 *      media gate checks it).
 *
 * PRINCIPAL / MANAGEMENT writes. The tenant is session-derived — a client
 * schoolId is never read. Uploads are rate-limited + audited.
 */

function serializeMedia(
  m: {
    id: string
    fileId: string
    mediaType: string
    title: string | null
    altText: string | null
    usage: string
    published: boolean
    createdAt: Date
    updatedAt: Date
  },
  file: { id: string; size: number | null; uploadedById: string; createdAt: Date } | null,
) {
  return {
    id: m.id,
    fileId: m.fileId,
    mediaType: m.mediaType,
    title: m.title,
    altText: m.altText,
    usage: m.usage,
    published: m.published,
    url: `/api/public/website/media/${m.fileId}`,
    size: file?.size ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }
}

export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const media = await db.websiteMedia.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      // The UploadedFile registry rows carry size/uploadedAt metadata —
      // fetched with the SAME tenant bound (a foreign row can never
      // leak into this school's library view).
      const files = media.length
        ? await db.uploadedFile.findMany({
            where: { id: { in: media.map((m) => m.fileId) }, schoolId, scope: 'website' },
            select: { id: true, size: true, uploadedById: true, createdAt: true },
          })
        : []
      const fileById = new Map(files.map((f) => [f.id, f]))
      return NextResponse.json(
        {
          success: true,
          data: {
            media: media.map((m) =>
              serializeMedia(m, fileById.get(m.fileId) ?? null),
            ),
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can upload website media.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webmedia:${user.id}`, RATE_LIMITS.upload)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many uploads. Please try again later.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      // PIH-4c — early oversized-body rejection (no body I/O).
      if (contentLengthExceedsUploadLimit(req, WEBSITE_UPLOAD_POLICY.maxBytes)) {
        return NextResponse.json(
          { success: false, error: 'Image is too large. Maximum size is 4 MB.' },
          { status: 413, headers: { 'X-Request-Id': requestId } },
        )
      }

      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json(
          { success: false, error: 'No image received.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      if (file.size > WEBSITE_UPLOAD_POLICY.maxBytes) {
        return NextResponse.json(
          { success: false, error: 'Image is too large. Maximum size is 4 MB.' },
          { status: 413, headers: { 'X-Request-Id': requestId } },
        )
      }
      const title = typeof form?.get('title') === 'string' ? String(form.get('title')).trim().slice(0, 120) || null : null
      const altText = typeof form?.get('altText') === 'string' ? String(form.get('altText')).trim().slice(0, 200) || null : null

      const bytes = Buffer.from(await file.arrayBuffer())
      const sniffed = sniffFileType(bytes)
      if (!sniffed || !WEBSITE_UPLOAD_POLICY.allowedTypes.includes(sniffed)) {
        return NextResponse.json(
          { success: false, error: 'Unsupported image type. Allowed: JPG, PNG, WebP.' },
          { status: 415, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Same storage layout as the website image pipeline: public bucket,
      // `website/<schoolId>/<fileId>`, x-upsert idempotent.
      const fileId = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
      const stored = await storageUpload('website', fileId, bytes, MIME_BY_TYPE[sniffed], schoolId)

      try {
        // Registry + curation rows land together; the storage object is
        // rolled back when the registry write fails.
        await db.uploadedFile.create({
          data: {
            id: fileId,
            schoolId,
            scope: 'website',
            uploadedById: user.id,
            size: file.size,
          },
        })
        await db.websiteMedia.create({
          data: {
            schoolId,
            fileId,
            mediaType: 'IMAGE',
            title,
            altText,
            usage: 'LIBRARY',
            published: false,
          },
        })
      } catch {
        await storageDelete(stored.bucket, stored.path).catch(() => {})
        return NextResponse.json(
          { success: false, error: 'Upload failed. Please try again.' },
          { status: 500, headers: { 'X-Request-Id': requestId } },
        )
      }

      const dims = readImageDimensions(bytes, sniffed)
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'FILE_UPLOADED',
        requestId,
        detail: `Media library image stored (${sniffed}, ${file.size} bytes) as ${fileId} → supabase://${stored.bucket}/${stored.path}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            fileId,
            mime: MIME_BY_TYPE[sniffed],
            size: file.size,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            url: `/api/public/website/media/${fileId}`,
          },
        },
        { status: 201, headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
