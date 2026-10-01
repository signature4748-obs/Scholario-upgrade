import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { AppError, newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { verifyFileToken } from '@/lib/security/file-signing'
import { isValidStoredFileId, ADMISSION_UPLOAD_POLICY } from '@/lib/security/upload'
import { auditEvent } from '@/lib/security/audit'
import {
  storedObjectLocation,
  storageExists,
  storageSignedUrl,
  storageDelete,
} from '@/lib/storage/supabase'

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
 *     to the caller's school — a foreign-school row is a fail-safe 404 (it
 *     "does not exist"; previously ANY school's PRINCIPAL could read
 *     any other school's admission document). UNREGISTERED legacy files
 *     keep the Phase-1 behavior (any school's P/M may read).
 *   · GET via a VALID SIGNED TOKEN stays allowed regardless of the
 *     registry — the token is an unguessable server-minted HMAC bound to
 *     this exact id (backward compatibility for pre-registry links).
 *   · DELETE: registered + foreign school → 404; NO registry row → 404
 *     (ownership cannot be verified, so the delete is refused).
 *
 * Phase 8A (8A-C9) — the bytes live in the PRIVATE 'school-media'
 * bucket at `admissions/<schoolId>/<id>` (unregistered legacy ids
 * derive the scope-fallback path). Authorization is byte-for-byte the
 * code above and runs BEFORE any URL is minted; an allowed read then
 * REDIRECTS (302) to a short-TTL Supabase signed URL — TTL 900 s for
 * HMAC-token links and 3600 s for session reads, mirroring the
 * previous Cache-Control lifetimes (private, max-age=900/3600).
 * `?download=1` is preserved via the Storage `download` query param
 * (Content-Disposition: attachment). A missing object keeps the honest
 * 404 contract (existence is probed before minting).
 */

/** Registry row for this id (null = legacy pre-registry file). */
async function registryRow(id: string) {
  return db.uploadedFile.findUnique({ where: { id } })
}

type ReadVerdict = 'allow' | 'not-found' | 'unauthorized'

/**
 * Authorization + registry row (the row also derives the storage
 * location; the token path — which historically never touched the DB —
 * fetches it too, purely to compute the object path).
 */
async function authorizeFileRead(
  req: NextRequest,
  id: string,
): Promise<{ verdict: ReadVerdict; row: Awaited<ReturnType<typeof registryRow>> }> {
  // Path 1 — signed URL token (unguessable HMAC over id|scope|exp);
  // validity alone authorizes the read (legacy files included).
  const token = req.nextUrl.searchParams.get('t')
  if (token && verifyFileToken(id, 'admissions', token)) {
    return { verdict: 'allow', row: await registryRow(id) }
  }

  // Path 2 — authenticated staff session.
  const user = await getCurrentUser()
  if (user && user.status === 'ACTIVE' && (user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT')) {
    if (user.schoolId) {
      // 3-c V5/V10: prefer the registry when a row exists.
      const row = await registryRow(id)
      if (row) {
        return row.schoolId === user.schoolId && row.scope === 'admissions'
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidStoredFileId(id, ADMISSION_UPLOAD_POLICY.allowedExts)) {
    return NextResponse.json({ success: false, error: 'Invalid document id.' }, { status: 400 })
  }

  const { verdict, row } = await authorizeFileRead(req, id)
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

  // ── Storage read (Phase 8A): tenant checks have passed; derive the
  // object location from the registry triple (scope fallback for
  // unregistered legacy ids), keep the honest-404 contract, then
  // redirect to a short-TTL signed URL.
  const location = storedObjectLocation('admissions', row?.schoolId ?? null, id)
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
        { success: false, error: 'Document not found. It may have been removed.' },
        { status: 404 },
      )
    }
    // Storage outage / misconfiguration — fail loud, no silent fallback.
    const status = e instanceof AppError ? e.status : 500
    const error = e instanceof AppError ? e.publicMessage : 'Document storage is temporarily unavailable.'
    return NextResponse.json({ success: false, error }, { status })
  }
  if (download) {
    // Signed URLs already carry ?token=… — append the attachment hint.
    target += `&download=${encodeURIComponent(id)}`
  }

  const res = NextResponse.redirect(target, 302)
  res.headers.set(
    'Cache-Control',
    signed ? 'private, max-age=900' : 'private, max-age=3600',
  )
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Request-Id', newRequestId())
  return res
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
    const location = storedObjectLocation('admissions', row.schoolId, id)
    await storageDelete(location.bucket, location.path)
    // The registry row goes with the file (no stale ownership records).
    await db.uploadedFile.delete({ where: { id } }).catch(() => {})
    await auditEvent({
      schoolId: user.schoolId ?? null,
      userId: user.id,
      action: 'FILE_DELETED',
      requestId,
      detail: `Admission document removed (${id}) → supabase://${location.bucket}/${location.path}`,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch {
    // Deleting a missing object is fine (storageDelete maps NoSuchKey to
    // ok); a genuine storage failure still clears the record — the
    // metadata must never outlive its delete intent (legacy semantics).
    await db.uploadedFile.delete({ where: { id } }).catch(() => {})
    return NextResponse.json({ success: true })
  }
}
