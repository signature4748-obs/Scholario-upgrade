import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import {
  ADMISSION_UPLOAD_POLICY,
  sniffFileType,
  EXT_BY_TYPE,
  MIME_BY_TYPE,
  sanitizeDisplayFilename,
} from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * POST /api/admissions/upload — supporting-document upload for admission
 * applications.
 *
 * Phase 1 hardening (baseline B-5 remediation — this endpoint was
 * ANONYMOUS, allowing unauthenticated writes to server disk):
 *   - Authorization: PRINCIPAL / MANAGEMENT (the admission module that
 *     calls it; the public website inquiry form does NOT upload files).
 *   - Rate limit: 30 uploads/hour per account.
 *   - Type policy: PDF / JPG / PNG verified by MAGIC BYTES (centralized
 *     in lib/security/upload); max 5 MB.
 *   - Stored filename is SERVER-MINTED; the client filename is sanitized
 *     display metadata only.
 *   - Audit row on every stored document.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  const user = await getCurrentUser()
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 })
  }
  if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
    return NextResponse.json({ success: false, error: 'Not authorized for document uploads.' }, { status: 403 })
  }
  try {
    enforceRateLimit(`rl:upload:${user.id}`, RATE_LIMITS.upload)
  } catch {
    return NextResponse.json(
      { success: false, error: 'Too many uploads. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  try {
    const form = await req.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file received.' }, { status: 400 })
    }

    // Size guard — reject oversized uploads regardless of what the client says.
    if (file.size > ADMISSION_UPLOAD_POLICY.maxBytes) {
      return NextResponse.json(
        { success: false, error: 'File is too large. Maximum size is 5 MB.' },
        { status: 413 },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // Content guard — the actual bytes must decode as PDF/JPG/PNG.
    const sniffed = sniffFileType(bytes)
    if (!sniffed || !ADMISSION_UPLOAD_POLICY.allowedTypes.includes(sniffed)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Allowed: PDF, JPG, PNG.' },
        { status: 415 },
      )
    }

    await mkdir(UPLOAD_DIR, { recursive: true })
    // Server-minted opaque id — client filenames never touch the disk.
    const fileId = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${EXT_BY_TYPE[sniffed]}`
    await writeFile(path.join(UPLOAD_DIR, fileId), bytes)

    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_UPLOADED',
      requestId,
      detail: `Admission document stored (${sniffed}, ${file.size} bytes) as ${fileId}`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      fileId,
      fileName: sanitizeDisplayFilename(file.name),
      size: file.size,
      mime: MIME_BY_TYPE[sniffed],
    })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 },
    )
  }
}

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'admissions')
