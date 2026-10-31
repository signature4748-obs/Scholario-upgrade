import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
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
 * POST /api/platform/schools/[id]/branding-logo — platform-side school
 * logo/favicon upload (PHASE 2 Setup wizard, Branding step).
 *
 * REUSES the existing secure upload pipeline end-to-end (same policy,
 * same storage, same ownership registry, same public-serving gate as the
 * school-side Branding tab — no second asset system):
 *   · magic-byte type policy (JPG/PNG/WebP, ≤ 4 MB) — the client-declared
 *     MIME type is never trusted;
 *   · early 413 on Content-Length before the multipart body is buffered;
 *   · server-minted opaque fileId, uploaded to the PUBLIC 'public-media'
 *     bucket at `website/<schoolId>/<fileId>` (the school-logo family is
 *     served through /api/public/website/media/<fileId>, whose privacy
 *     gate explicitly allows the school's logoUrl/faviconUrl);
 *   · the UploadedFile OWNERSHIP REGISTRY row (scope 'website') is the
 *     tenant-scoped truth — a storage row without its registry row is
 *     deleted again (never orphan bytes).
 *
 * The target column (School.logoUrl | School.faviconUrl) is set IN THIS
 * ROUTE (upload + point are one audited operation) — the platform never
 * accepts a raw fileId/URL for these columns from the client.
 *
 * School handover: branding remains editable by the school's own
 * administrators through the existing school-side flow; the platform
 * PATCH keeps the same columns (single source of record).
 *
 * Permission: schools.manage. Audited: platform.school.branding_updated.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const ip = clientIpFromHeaders(req.headers)

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true, logoUrl: true, faviconUrl: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'branding-logo: no such school',
      })
    }

    // target is a QUERY parameter (multipart body — no JSON envelope).
    const target = req.nextUrl.searchParams.get('target') === 'favicon' ? 'favicon' : 'logo'

    if (contentLengthExceedsUploadLimit(req, WEBSITE_UPLOAD_POLICY.maxBytes)) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        publicMessage: 'Image is too large. Maximum size is 4 MB.',
      })
    }

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'No image received.' })
    }
    if (file.size > WEBSITE_UPLOAD_POLICY.maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        publicMessage: 'Image is too large. Maximum size is 4 MB.',
      })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffFileType(bytes)
    if (!sniffed || !WEBSITE_UPLOAD_POLICY.allowedTypes.includes(sniffed)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        publicMessage: 'Unsupported image type. Allowed: JPG, PNG, WebP.',
      })
    }

    // Phase 8A pipeline: PUBLIC bucket, x-upsert, opaque server-minted id.
    const fileId = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
    const stored = await storageUpload('website', fileId, bytes, MIME_BY_TYPE[sniffed], school.id)

    try {
      await db.uploadedFile.create({
        data: {
          id: fileId,
          schoolId: school.id,
          scope: 'website',
          // Platform-side upload — no school User row exists. The column
          // is an opaque string (no FK); the `platform:` prefix keeps the
          // identity space explicit and the admin traceable in audit.
          uploadedById: `platform:${ctx.admin.id}`,
          size: file.size,
        },
      })
    } catch {
      await storageDelete(stored.bucket, stored.path).catch(() => {})
      throw new AppError('DATABASE_FAILURE', {
        publicMessage: 'Upload failed. Please try again.',
        internalDetail: 'branding-logo: UploadedFile registry insert failed',
      })
    }

    const previous = target === 'favicon' ? school.faviconUrl : school.logoUrl
    await db.school.update({
      where: { id: school.id },
      data: target === 'favicon' ? { faviconUrl: fileId } : { logoUrl: fileId },
    })

    const dims = readImageDimensions(bytes, sniffed)
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.branding_updated',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: `${target} uploaded via setup wizard`,
      metadata: {
        target,
        fileId,
        mime: MIME_BY_TYPE[sniffed],
        size: file.size,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        replaced: previous ?? null,
      },
    })

    return {
      ok: true,
      target,
      fileId,
      url: `/api/public/website/media/${fileId}`,
    }
  })
}
