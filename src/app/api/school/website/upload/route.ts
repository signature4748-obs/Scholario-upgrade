import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { mkdir, writeFile, unlink } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import {
  WEBSITE_UPLOAD_POLICY,
  sniffFileType,
  EXT_BY_TYPE,
  MIME_BY_TYPE,
  readImageDimensions,
  contentLengthExceedsUploadLimit,
} from '@/lib/security/upload'

export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'website')

/**
 * POST /api/school/website/upload — Website CMS image upload.
 *
 * PRINCIPAL / MANAGEMENT only; magic-byte type policy (JPG/PNG/WebP,
 * ≤4 MB); server-minted opaque file id; registered in the UploadedFile
 * OWNERSHIP REGISTRY (scope 'website', session school). Stored bytes
 * stay PRIVATE by default — they are served publicly only through
 * /api/public/website/media/<fileId> for PUBLISHED gallery images /
 * announcements, or referenced as school branding.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can upload website images.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)

      try {
        enforceRateLimit(`rl:webupload:${user.id}`, RATE_LIMITS.upload)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many uploads. Please try again later.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      // PIH-4c — EARLY size rejection BEFORE the multipart body is buffered:
      // an oversized Content-Length answers 413 immediately without
      // reading the stream (the post-parse file.size guard stays
      // authoritative for missing/chunked lengths).
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

      const bytes = Buffer.from(await file.arrayBuffer())
      const sniffed = sniffFileType(bytes)
      if (!sniffed || !WEBSITE_UPLOAD_POLICY.allowedTypes.includes(sniffed)) {
        return NextResponse.json(
          { success: false, error: 'Unsupported image type. Allowed: JPG, PNG, WebP.' },
          { status: 415, headers: { 'X-Request-Id': requestId } },
        )
      }

      await mkdir(UPLOAD_DIR, { recursive: true })
      const fileId = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
      await writeFile(path.join(UPLOAD_DIR, fileId), bytes)

      try {
        await db.uploadedFile.create({
          data: {
            id: fileId,
            schoolId,
            scope: 'website',
            uploadedById: user.id,
            size: file.size,
          },
        })
      } catch {
        await unlink(path.join(UPLOAD_DIR, fileId)).catch(() => {})
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
        detail: `Website image stored (${sniffed}, ${file.size} bytes) as ${fileId}`,
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
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
