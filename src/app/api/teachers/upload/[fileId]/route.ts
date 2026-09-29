import { NextRequest, NextResponse } from 'next/server'
import { stat, readFile, unlink } from 'fs/promises'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { verifyFileToken } from '@/lib/security/file-signing'
import { isValidStoredFileId, TEACHER_UPLOAD_POLICY, MIME_BY_TYPE } from '@/lib/security/upload'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * GET  /api/teachers/upload/[fileId]         → serve a stored photo/signature inline
 * GET  /api/teachers/upload/[fileId]?download=1 → force download
 * DELETE /api/teachers/upload/[fileId]       → remove a stored media file
 *
 * Phase 1 hardening (baseline B-6 remediation — these handlers were
 * ANONYMOUS):
 *   - GET requires EITHER an authenticated staff session (PRINCIPAL /
 *     MANAGEMENT) OR a short-lived HMAC-signed URL token minted by
 *     POST /api/teachers/upload/access. Teacher photos and signatures are
 *     PII — no anonymous reads.
 *   - DELETE requires an authenticated PRINCIPAL / MANAGEMENT session and
 *     is rate-limited + audited.
 *   - fileId stays an opaque server-minted id (traversal-proof regex).
 */

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'teachers')

async function authorizeFileRead(req: NextRequest, fileId: string): Promise<boolean> {
  // Path 1 — signed URL token (works for <img>/<a> where auth headers
  // cannot ride along, e.g. the dev preview iframe).
  const token = req.nextUrl.searchParams.get('t')
  if (verifyFileToken(fileId, 'teachers', token)) return true

  // Path 2 — session (cookie or dev Bearer).
  const user = await getCurrentUser()
  if (user && user.status === 'ACTIVE' && (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT')) {
    return true
  }
  return false
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params
  if (!isValidStoredFileId(fileId, TEACHER_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid file id.' }, { status: 400 })
  }

  if (!(await authorizeFileRead(req, fileId))) {
    return NextResponse.json(
      { success: false, error: 'Authentication required to access this file.' },
      { status: 401 },
    )
  }

  const filePath = path.join(UPLOAD_DIR, fileId)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    const data = await readFile(filePath)
    const ext = fileId.split('.').pop()!.toLowerCase()
    const download = req.nextUrl.searchParams.get('download') === '1'
    const signed = !!req.nextUrl.searchParams.get('t')

    const res = new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': MIME_BY_TYPE[ext] || 'application/octet-stream',
        'Content-Length': String(info.size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fileId}"`,
        // Signed-URL responses may be cached by the browser for the life
        // of the link; session responses stay private no-store-adjacent.
        'Cache-Control': signed ? 'private, max-age=900' : 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    res.headers.set('X-Request-Id', newRequestId())
    return res
  } catch {
    return NextResponse.json(
      { success: false, error: 'File not found. It may have been removed.' },
      { status: 404 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = newRequestId()
  const { fileId } = await params
  if (!isValidStoredFileId(fileId, TEACHER_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid file id.' }, { status: 400 })
  }

  const user = await getCurrentUser()
  if (!user || user.status !== 'ACTIVE' || (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT')) {
    return NextResponse.json(
      { success: false, error: 'Authentication required to remove this file.' },
      { status: 401 },
    )
  }
  try {
    enforceRateLimit(`rl:uploaddel:${user.id}`, RATE_LIMITS.upload)
  } catch {
    return NextResponse.json(
      { success: false, error: 'Too many delete requests. Please try again later.' },
      { status: 429 },
    )
  }

  try {
    await unlink(path.join(UPLOAD_DIR, fileId))
    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_DELETED',
      requestId,
      detail: `Teacher media removed (${fileId})`,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch {
    // Deleting a missing file is fine — the record is being cleared anyway.
    return NextResponse.json({ success: true })
  }
}
