import { NextRequest, NextResponse } from 'next/server'
import { stat, readFile, unlink } from 'fs/promises'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
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
 *
 * Phase 2 (3-c audit V5/V10) — UploadedFile OWNERSHIP REGISTRY:
 *   · GET (session path): when the document is REGISTERED, it must belong
 *     to the caller's school — a foreign-school row is a fail-safe 404
 *     (it "does not exist"; previously ANY school's PRINCIPAL could read
 *     any other school's admission document). UNREGISTERED legacy files
 *     keep the Phase-1 behavior (any school's P/M may read).
 *   · GET via a VALID SIGNED TOKEN stays allowed regardless of the
 *     registry — the token is an unguessable server-minted HMAC bound to
 *     this exact id (backward compatibility for pre-registry links).
 *   · DELETE: registered + foreign school → 404; NO registry row → 404
 *     (ownership cannot be verified, so the delete is refused).
 */

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads', 'admissions')

/** Registry row for this id (null = legacy pre-registry file). */
async function registryRow(id: string) {
  return db.uploadedFile.findUnique({ where: { id } })
}

type ReadVerdict = 'allow' | 'not-found' | 'unauthorized'

async function authorizeFileRead(req: NextRequest, id: string): Promise<ReadVerdict> {
  // Path 1 — signed URL token (unguessable HMAC over id|scope|exp);
  // validity alone authorizes the read (legacy files included).
  const token = req.nextUrl.searchParams.get('t')
  if (token && verifyFileToken(id, 'admissions', token)) return 'allow'

  // Path 2 — authenticated staff session.
  const user = await getCurrentUser()
  if (user && user.status === 'ACTIVE' && (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT')) {
    if (user.schoolId) {
      // 3-c V5/V10: prefer the registry when a row exists.
      const row = await registryRow(id)
      if (row) {
        return row.schoolId === user.schoolId && row.scope === 'admissions' ? 'allow' : 'not-found'
      }
    }
    // Legacy (unregistered) file — pre-Phase-2 behavior stands.
    return 'allow'
  }
  return 'unauthorized'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidStoredFileId(id, ADMISSION_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid document id.' }, { status: 400 })
  }

  const verdict = await authorizeFileRead(req, id)
  if (verdict === 'not-found') {
    // Fail-safe: a foreign school's document "does not exist".
    return NextResponse.json(
      { success: false, error: 'Document not found. It may have been removed.' },
      { status: 404 },
    )
  }
  if (verdict === 'unauthorized') {
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
  { params }: { params: Promise<{ id: string }> }
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

  // 3-c V5/V10: ownership MUST be verifiable before a destructive action.
  // A registered document that belongs to another school "does not
  // exist"; an unregistered legacy document cannot be verified → refuse.
  const row = await registryRow(id)
  if (!row || row.scope !== 'admissions' || !user.schoolId || row.schoolId !== user.schoolId) {
    return NextResponse.json(
      { success: false, error: 'Document not found. It may have been removed.' },
      { status: 404 },
    )
  }

  try {
    await unlink(path.join(UPLOAD_DIR, id))
    // The registry row goes with the file (no stale ownership records).
    await db.uploadedFile.delete({ where: { id } }).catch(() => {})
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
    await db.uploadedFile.delete({ where: { id } }).catch(() => {})
    return NextResponse.json({ success: true })
  }
}
