import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { storageUpload, storageDelete } from '@/lib/storage/supabase'
import {
  sniffFileType,
  EXT_BY_TYPE,
  MIME_BY_TYPE,
  contentLengthExceedsUploadLimit,
} from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * POST /api/school/website/notices/attachment — notice/announcement
 * DOCUMENT upload (task 2-a). Same machinery as the website image
 * pipeline, widened for the circular family: PDF / JPG / PNG / WebP,
 * ≤5 MB. The file is registered in the UploadedFile OWNERSHIP REGISTRY
 * (scope 'website', session school) and stored in the public bucket at
 * `website/<schoolId>/<fileId>` — the bytes are served publicly ONLY
 * through /api/public/website/media/<fileId> while a PUBLISHED notice
 * references them (the public media gate checks that reference).
 *
 * PRINCIPAL / MANAGEMENT only; magic-byte type policy (no client-declared
 * MIME trust); server-minted opaque file id; rate-limited + audited.
 */
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['pdf', 'jpeg', 'png', 'webp'] as const

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can upload notice attachments.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webattach:${user.id}`, RATE_LIMITS.upload)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many uploads. Please try again later.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      // PIH-4c — early oversized-body rejection (no body I/O).
      if (contentLengthExceedsUploadLimit(req, MAX_BYTES)) {
        return NextResponse.json(
          { success: false, error: 'Attachment is too large. Maximum size is 5 MB.' },
          { status: 413, headers: { 'X-Request-Id': requestId } },
        )
      }

      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json(
          { success: false, error: 'No attachment received.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { success: false, error: 'Attachment is too large. Maximum size is 5 MB.' },
          { status: 413, headers: { 'X-Request-Id': requestId } },
        )
      }

      const bytes = Buffer.from(await file.arrayBuffer())
      const sniffed = sniffFileType(bytes)
      if (!sniffed || !ALLOWED_TYPES.includes(sniffed)) {
        return NextResponse.json(
          { success: false, error: 'Unsupported attachment type. Allowed: PDF, JPG, PNG, WebP.' },
          { status: 415, headers: { 'X-Request-Id': requestId } },
        )
      }

      const fileId = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
      const stored = await storageUpload('website', fileId, bytes, MIME_BY_TYPE[sniffed], schoolId)

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
        await storageDelete(stored.bucket, stored.path).catch(() => {})
        return NextResponse.json(
          { success: false, error: 'Upload failed. Please try again.' },
          { status: 500, headers: { 'X-Request-Id': requestId } },
        )
      }

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'FILE_UPLOADED',
        requestId,
        detail: `Notice attachment stored (${sniffed}, ${file.size} bytes) as ${fileId} → supabase://${stored.bucket}/${stored.path}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            fileId,
            mime: MIME_BY_TYPE[sniffed],
            size: file.size,
            filename: file.name,
            url: `/api/public/website/media/${fileId}`,
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
