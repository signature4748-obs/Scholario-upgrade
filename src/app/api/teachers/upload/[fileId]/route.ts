import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { AppError, newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { verifyFileToken } from '@/lib/security/file-signing'
import { isValidStoredFileId, TEACHER_UPLOAD_POLICY } from '@/lib/security/upload'
import { auditEvent } from '@/lib/security/audit'
import {
  storedObjectLocation,
  storageExists,
  storageSignedUrl,
  storageDelete,
} from '@/lib/storage/supabase'

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
 *
 * Phase 2 (3-c audit V5/V10) — UploadedFile OWNERSHIP REGISTRY:
 *   · GET (session path): when the file is REGISTERED, it must belong to
 *     the caller's school — a foreign-school row is a fail-safe 404 (it
 *     "does not exist"). UNREGISTERED (legacy, pre-registry) files keep
 *     the Phase-1 behavior: any school's PRINCIPAL/MANAGEMENT may read.
 *   · GET via a VALID SIGNED TOKEN stays allowed regardless of the
 *     registry — the token is an unguessable server-minted HMAC bound to
 *     this exact fileId (backward compatibility for links minted before
 *     the registry existed).
 *   · DELETE: registered file + foreign school → 404; NO registry row →
 *     404 (ownership cannot be verified, so the delete is refused).
 *
 * Phase 8A (8A-C9) — bytes live in the PRIVATE 'school-media' bucket at
 * `teachers/<schoolId>/<fileId>` (scope-fallback path for unregistered
 * legacy ids). Authorization runs BEFORE any URL is minted; an allowed
 * read REDIRECTS (302) to a short-TTL Supabase signed URL (900 s for
 * HMAC-token links / 3600 s session reads — the previous Cache-Control
 * lifetimes). `?download=1` rides the Storage `download` param. Missing
 * objects keep the honest-404 contract.
 */

/** Registry row for this fileId (null = legacy pre-registry file). */
async function registryRow(fileId: string) {
  return db.uploadedFile.findUnique({ where: { id: fileId } })
}

type ReadVerdict = 'allow' | 'not-found' | 'unauthorized'

/**
 * Authorization + registry row (the row also derives the storage
 * location; the token path fetches it purely to compute the path).
 */
async function authorizeFileRead(
  req: NextRequest,
  fileId: string,
): Promise<{ verdict: ReadVerdict; row: Awaited<ReturnType<typeof registryRow>> }> {
  // Path 1 — signed URL token (works for <img>/<a> where auth headers
  // cannot ride along, e.g. the dev preview iframe). The token is an
  // unguessable HMAC over fileId|scope|exp — validity alone authorizes
  // the read (legacy files included).
  const token = req.nextUrl.searchParams.get('t')
  if (token && verifyFileToken(fileId, 'teachers', token)) {
    return { verdict: 'allow', row: await registryRow(fileId) }
  }

  // Path 2 — session (cookie or dev Bearer): PRINCIPAL / MANAGEMENT.
  const user = await getCurrentUser()
  if (user && user.status === 'ACTIVE' && (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT')) {
    if (user.schoolId) {
      // 3-c V5/V10: prefer the registry when a row exists.
      const row = await registryRow(fileId)
      if (row) {
        return row.schoolId === user.schoolId && row.scope === 'teachers'
          ? { verdict: 'allow', row }
          : { verdict: 'not-found', row }
      }
    }
    // Legacy (unregistered) file — pre-Phase-2 behavior stands.
    return { verdict: 'allow', row: null }
  }
  return { verdict: 'unauthorized', row: null }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params
  if (!isValidStoredFileId(fileId, TEACHER_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid file id.' }, { status: 400 })
  }

  const { verdict, row } = await authorizeFileRead(req, fileId)
  if (verdict === 'not-found') {
    // Fail-safe: a foreign school's file "does not exist".
    return NextResponse.json(
      { success: false, error: 'File not found. It may have been removed.' },
      { status: 404 },
    )
  }
  if (verdict === 'unauthorized') {
    return NextResponse.json(
      { success: false, error: 'Authentication required to access this file.' },
      { status: 401 },
    )
  }

  // ── Storage read (Phase 8A): tenant checks passed → derive the object
  // location, probe existence (honest 404), then redirect to a signed URL.
  const location = storedObjectLocation('teachers', row?.schoolId ?? null, fileId)
  const download = req.nextUrl.searchParams.get('download') === '1'
  const signed = !!req.nextUrl.searchParams.get('t')

  let target: string
  try {
    if (!(await storageExists(location.bucket, location.path))) {
      throw new AppError('RESOURCE_NOT_FOUND')
    }
    target = await storageSignedUrl(
      location.bucket,
      location.path,
      signed ? 900 : 3600, // mirrors the previous Cache-Control lifetimes
    )
  } catch (e) {
    if (e instanceof AppError && (e.code === 'RESOURCE_NOT_FOUND' || e.status === 404)) {
      return NextResponse.json(
        { success: false, error: 'File not found. It may have been removed.' },
        { status: 404 },
      )
    }
    // Storage outage / misconfiguration — fail loud, no silent fallback.
    const status = e instanceof AppError ? e.status : 500
    const error = e instanceof AppError ? e.publicMessage : 'File storage is temporarily unavailable.'
    return NextResponse.json({ success: false, error }, { status })
  }
  if (download) {
    // Signed URLs already carry ?token=… — append the attachment hint.
    target += `&download=${encodeURIComponent(fileId)}`
  }

  const res = NextResponse.redirect(target, 302)
  // Signed-URL responses may be cached by the browser for the life of
  // the link; session responses stay private (same lifetimes as before).
  res.headers.set('Cache-Control', signed ? 'private, max-age=900' : 'private, max-age=3600')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Request-Id', newRequestId())
  return res
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

  // 3-c V5/V10: ownership MUST be verifiable before a destructive action.
  // A registered file that belongs to another school "does not exist";
  // an unregistered legacy file cannot be verified → refuse the delete.
  const row = await registryRow(fileId)
  if (!row || row.scope !== 'teachers' || !user.schoolId || row.schoolId !== user.schoolId) {
    return NextResponse.json(
      { success: false, error: 'File not found. It may have been removed.' },
      { status: 404 },
    )
  }

  try {
    const location = storedObjectLocation('teachers', row.schoolId, fileId)
    await storageDelete(location.bucket, location.path)
    // The registry row goes with the file (no stale ownership records).
    await db.uploadedFile.delete({ where: { id: fileId } }).catch(() => {})
    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_DELETED',
      requestId,
      detail: `Teacher media removed (${fileId}) → supabase://${location.bucket}/${location.path}`,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch {
    // Deleting a missing object is fine (storageDelete maps NoSuchKey to
    // ok); a genuine storage failure still clears the record — the
    // metadata must never outlive its delete intent (legacy semantics).
    await db.uploadedFile.delete({ where: { id: fileId } }).catch(() => {})
    return NextResponse.json({ success: true })
  }
}
