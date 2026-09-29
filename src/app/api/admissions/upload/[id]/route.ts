import { NextRequest, NextResponse } from 'next/server'
import { stat, readFile, unlink } from 'fs/promises'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { verifyFileToken } from '@/lib/security/file-signing'
import { isValidStoredFileId, ADMISSION_UPLOAD_POLICY, MIME_BY_TYPE } from '@/lib/security/upload'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * GET  /api/admissions/upload/[id]         → serve a stored document inline (View)
 * GET  /api/admissions/upload/[id]?download=1 → force download (Download)
 * DELETE /api/admissions/upload/[id]       → remove a stored document
 *
 * Phase 1 hardening (these handlers were ANONYMOUS; admission documents
 * are PII — birth certificates, marksheets):
 *   - GET requires EITHER an authenticated staff session (PRINCIPAL /
 *     MANAGEMENT) OR a short-lived HMAC-signed URL token minted by
 *     POST /api/admissions/upload/access.
 *   - DELETE requires an authenticated PRINCIPAL / MANAGEMENT session,
 *     rate-limited + audited.
 *   - id stays an opaque server-minted token (traversal-proof regex).
 */

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'admissions')

async function authorizeFileRead(req: NextRequest, id: string): Promise<boolean> {
  // Path 1 — signed URL token.
  const token = req.nextUrl.searchParams.get('t')
  if (verifyFileToken(id, 'admissions', token)) return true

  // Path 2 — authenticated staff session.
  const user = await getCurrentUser()
  if (user && user.status === 'ACTIVE' && (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT')) {
    return true
  }
  return false
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidStoredFileId(id, ADMISSION_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid document id.' }, { status: 400 })
  }

  if (!(await authorizeFileRead(req, id))) {
    return NextResponse.json(
      { success: false, error: 'Authentication required to access this document.' },
      { status: 401 },
    )
  }

  const filePath = path.join(UPLOAD_DIR, id)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    const data = await readFile(filePath)
    const ext = id.split('.').pop()!.toLowerCase()
    const download = req.nextUrl.searchParams.get('download') === '1'
    const signed = !!req.nextUrl.searchParams.get('t')

    const res = new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': MIME_BY_TYPE[ext] || 'application/octet-stream',
        'Content-Length': String(info.size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${id}"`,
        'Cache-Control': signed ? 'private, max-age=900' : 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
    res.headers.set('X-Request-Id', newRequestId())
    return res
  } catch {
    return NextResponse.json(
      { success: false, error: 'Document not found. It may have been removed.' },
      { status: 404 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId()
  const { id } = await params
  if (!isValidStoredFileId(id, ADMISSION_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid document id.' }, { status: 400 })
  }

  const user = await getCurrentUser()
  if (!user || user.status !== 'ACTIVE' || (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT')) {
    return NextResponse.json(
      { success: false, error: 'Authentication required to remove this document.' },
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
    await unlink(path.join(UPLOAD_DIR, id))
    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_DELETED',
      requestId,
      detail: `Admission document removed (${id})`,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch {
    // Deleting a missing file is fine — the record is being cleared anyway.
    return NextResponse.json({ success: true })
  }
}
