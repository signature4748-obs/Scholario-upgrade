import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { storageUpload, storageDelete } from '@/lib/storage/supabase'
import {
  TEACHER_UPLOAD_POLICY,
  sniffFileType,
  readImageDimensions,
  EXT_BY_TYPE,
  MIME_BY_TYPE,
  sanitizeDisplayFilename,
  contentLengthExceedsUploadLimit,
} from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * POST /api/teachers/upload — teacher photo / signature upload.
 *
 * Phase 1 hardening (baseline B-5 remediation — this endpoint was
 * ANONYMOUS; now it is authenticated + rate-limited + audited):
 *   - Authorization: PRINCIPAL / MANAGEMENT only (the teacher-onboarding
 *     module that consumes it).
 *   - Rate limit: 30 uploads/hour per account.
 *   - Type policy (unchanged, now centralized in lib/security/upload):
 *     JPG / PNG / WebP verified by MAGIC BYTES — a renamed file cannot
 *     pass; dimensions decoded from the actual header (photo ≥ 200×200,
 *     signature ≥ 60×60, both ≤ 6000 px).
 *   - Size: PHOTO 2 MB · SIGNATURE 1 MB (kind=form field).
 *   - Stored filename is SERVER-MINTED (opaque id); the client filename
 *     is sanitized display metadata only.
 *   - Audit row on every stored file.
 *
 * Phase 2 (3-c V5/V10): every stored file is registered in the
 * UploadedFile OWNERSHIP REGISTRY (id = stored fileId, schoolId = the
 * session school, scope 'teachers') — the read/delete/token-mint routes
 * now verify the file belongs to the CALLER's school. Upload requires a
 * school-scoped session (the registry row is the tenancy anchor).
 *
 * Files are stored in the PRIVATE 'school-media' Supabase bucket at
 * `teachers/<schoolId>/<fileId>` (Phase 8A — 8A-C9; validation stack
 * above unchanged; no local-disk fallback).
 */

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  // Non-envelope endpoint (multipart) — auth + rate limit inline, then
  // JSON errors in this route's own { success, error } shape (matching
  // the existing client contract in teacher-media.ts).
  const user = await getCurrentUser()
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 })
  }
  if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
    return NextResponse.json({ success: false, error: 'Not authorized for media uploads.' }, { status: 403 })
  }
  // 3-c V5/V10: the ownership registry binds the file to a school — a
  // schoolless staff account has no tenant to bind to.
  if (!user.schoolId) {
    return NextResponse.json({ success: false, error: 'No school scope for this account.' }, { status: 403 })
  }
  try {
    enforceRateLimit(`rl:upload:${user.id}`, RATE_LIMITS.upload)
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Too many uploads. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }
  void requestId

  try {
    // PIH-4c — EARLY size rejection BEFORE the multipart body is buffered.
    // Coarse ceiling = the photo max (2 MB): the kind field isn't known
    // until the form parses, so the precise 1 MB signature check stays
    // post-parse. Oversized Content-Length → immediate 413, no buffering.
    if (contentLengthExceedsUploadLimit(req, TEACHER_UPLOAD_POLICY.photoMaxBytes)) {
      return NextResponse.json(
        { success: false, error: 'File is too large. Maximum size is 2 MB.' },
        { status: 413 },
      )
    }
    const form = await req.formData()
    const file = form.get('file')
    const kind = form.get('kind') === 'signature' ? 'signature' : 'photo'

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file received.' }, { status: 400 })
    }

    const maxBytes = kind === 'photo' ? TEACHER_UPLOAD_POLICY.photoMaxBytes : TEACHER_UPLOAD_POLICY.signatureMaxBytes
    const maxLabel = kind === 'photo' ? '2 MB' : '1 MB'

    // Size guard — reject oversized uploads regardless of what the client says.
    if (file.size > maxBytes) {
      return NextResponse.json(
        { success: false, error: `File is too large. Maximum size is ${maxLabel}.` },
        { status: 413 },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // Content guard — the actual bytes must decode as JPG/PNG/WebP.
    const sniffed = sniffFileType(bytes)
    if (!sniffed || !TEACHER_UPLOAD_POLICY.allowedTypes.includes(sniffed)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Allowed: JPG, PNG, WebP.' },
        { status: 415 },
      )
    }

    // Dimension guard — decoded from the real header, not client claims.
    const dims = readImageDimensions(bytes, sniffed)
    if (!dims) {
      return NextResponse.json(
        { success: false, error: 'Could not read image dimensions — the file may be corrupt.' },
        { status: 415 },
      )
    }
    const MIN = kind === 'photo' ? 200 : 60
    const MAX = 6000
    if (dims.width < MIN || dims.height < MIN) {
      return NextResponse.json(
        {
          success: false,
          error: `Image is too small (${dims.width} × ${dims.height} px). Minimum is ${MIN} × ${MIN} px.`,
        },
        { status: 415 },
      )
    }
    if (dims.width > MAX || dims.height > MAX) {
      return NextResponse.json(
        {
          success: false,
          error: `Image is too large (${dims.width} × ${dims.height} px). Maximum is ${MAX} × ${MAX} px.`,
        },
        { status: 415 },
      )
    }

    // Server-minted opaque id — client filenames never name an object.
    // Phase 8A: bytes go to Supabase Storage (x-upsert, PRIVATE bucket);
    // the object path is `teachers/<schoolId>/<fileId>`.
    const fileId = `${kind}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
    const stored = await storageUpload(
      'teachers',
      fileId,
      bytes,
      MIME_BY_TYPE[sniffed],
      user.schoolId,
    )

    // Phase 2 (3-c V5/V10) — register the file's SCHOOL ownership. The
    // registry row is what the read/delete/token-mint routes verify;
    // failure to register means the file can never be managed again, so
    // a failed registration fails the upload (no orphan PII in storage).
    try {
      await db.uploadedFile.create({
        data: {
          id: fileId,
          schoolId: user.schoolId!,
          scope: 'teachers',
          uploadedById: user.id,
          size: file.size,
        },
      })
    } catch {
      await storageDelete(stored.bucket, stored.path).catch(() => {})
      return NextResponse.json(
        { success: false, error: 'Upload failed. Please try again.' },
        { status: 500 },
      )
    }

    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_UPLOADED',
      requestId,
      detail: `Teacher ${kind} stored (${sniffed}, ${file.size} bytes) as ${fileId} → supabase://${stored.bucket}/${stored.path}`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      fileId,
      fileName: sanitizeDisplayFilename(file.name),
      size: file.size,
      mime: MIME_BY_TYPE[sniffed],
      width: dims.width,
      height: dims.height,
    })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 },
    )
  }
}
