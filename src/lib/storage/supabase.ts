// ============================================================
// 8A-C9 — Supabase Storage wrapper (server-side ONLY)
// ------------------------------------------------------------
// Phase 8A (SQLite → Supabase, mission §27-28): uploads leave the
// local disk (db/uploads/**) and move into Supabase Storage object
// buckets so the app becomes Vercel-compatible (no writable
// filesystem in production).
//
//   · 'school-media' — PRIVATE bucket. EVERYTHING private by
//     default: admissions, teachers, study-materials, avatars.
//     Reads go through the existing authenticated routes, which
//     mint short-TTL SIGNED URLs only AFTER their tenant/role
//     checks pass.
//   · 'public-media' — PUBLIC bucket. Only website-published media
//     (scope 'website'); the /api/public/website/media/[fileId]
//     privacy gate still decides WHO may fetch (published gallery
//     image ∨ visible notification ∨ active-school logoUrl).
//
// API surface (raw fetch against the Storage REST API with the
// SERVICE ROLE key — no SDK dependency, per task rules):
//   ensureBuckets()      idempotent bucket bootstrap (memoized)
//   storageUpload(scope, filename, bytes, mime, tenantId?)
//                        → { bucket, path }   (x-upsert: idempotent)
//   storageSignedUrl(bucket, path, ttlSec) → URL string
//   storagePublicUrl(bucket, path)          → URL string
//   storageDelete(bucket, path)             (missing object = ok)
//   storageDownload(bucket, path)           → ArrayBuffer
//   storageExists(bucket, path)             → boolean (HEAD)
//   storedObjectLocation(scope, schoolId, storedFileName)
//                        deterministic { bucket, path } derivation
//
// PATH CONVENTION: `<scope>/<schoolId-or-scope>/<opaque-filename>`.
// The opaque filename is the EXISTING server-minted id carried in
// the UploadedFile registry / StudyMaterial.fileName / User.avatar
// column — unchanged. Because the UploadedFile model has NO
// dedicated path column (id doubles as the opaque filename, and the
// schema is frozen for this task), the storage location is DERIVED
// deterministically from the row's (scope, schoolId, id) triple —
// the same information the local-disk layout encoded implicitly
// (db/uploads/<scope>/<filename> + registry row). The scheme marker
// `supabase://<bucket>/<path>` is carried in AUDIT details and the
// migration report for human traceability. Rows stay 100%
// backward-compatible (id, scope, schoolId semantics untouched).
//
// PATH SAFETY (§28): every path segment is validated — segments
// containing '..', a leading '/', separators, or empty values are
// rejected loudly; remaining characters are reduced to the safe
// [A-Za-z0-9._-] set. The routes' existing magic-byte/MIME checks
// remain the content-level defense.
//
// FAIL-LOUD POLICY: every wrapper failure throws AppError
// (EXTERNAL_SERVICE_FAILURE / RESOURCE_NOT_FOUND). There is NO
// silent local-disk fallback — a Vercel deployment has no disk to
// fall back to. Missing configuration is a startup-style error
// explaining exactly what to set (dev environments configure
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env; they ARE
// configured for this project).
//
// SERVER-ONLY: this module carries the SERVICE ROLE key. Never
// import it from a Client Component — the guard below fails fast
// if a bundler ever pulls it into a browser bundle. (The
// `server-only` package is deliberately NOT imported so bun-run
// scripts — seeds, the migration script — can use the wrapper.)
// ============================================================

import { AppError } from '@/lib/security/errors'
import { log } from '@/lib/observability/logger'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/storage/supabase.ts is server-side only (it holds the Supabase service-role key). ' +
      'Remove any Client Component import.',
  )
}

/** Buckets (Phase-8A layout — created by ensureBuckets). */
export const SCHOOL_MEDIA_BUCKET = 'school-media' // PRIVATE — default for everything
export const PUBLIC_MEDIA_BUCKET = 'public-media' // PUBLIC  — website-published media only

/** Upload scopes = first path segment + registry `scope` values. */
export type StorageScope = 'admissions' | 'teachers' | 'website' | 'study-materials' | 'avatars'

/** Where a stored file lives. */
export interface StoredObjectLocation {
  bucket: string
  path: string
}

/** Default signed-URL TTL (seconds) — matches the admission/teacher token TTL family. */
export const DEFAULT_SIGNED_URL_TTL_SEC = 600

// ─── environment gate ────────────────────────────────────────────────

interface StorageEnv {
  url: string
  key: string
}

function storageEnv(): StorageEnv {
  const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !key) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'File storage is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set ' +
        '(server-side only — configure them in .env; never expose the service key to clients).',
      internalDetail:
        'storage env gate: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing — ' +
        'upload/serving routes cannot run without object storage. No local-disk fallback exists by design (mission §27-28).',
    })
  }
  return { url, key }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const { key } = storageEnv()
  return { authorization: `Bearer ${key}`, apikey: key, ...extra }
}

/** URI-encode a storage path segment-by-segment (never encode the '/'). */
function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function storageFailure(operation: string, status: number, detail: string): AppError {
  log('error', 'storage_failure', { operation, status, detail })
  return new AppError('EXTERNAL_SERVICE_FAILURE', {
    publicMessage: 'File storage is temporarily unavailable.',
    internalDetail: `storage ${operation} failed: HTTP ${status} — ${detail}`,
  })
}

// ─── path validation (§28) ───────────────────────────────────────────

/**
 * Validate + sanitize ONE storage path segment. Fails loud (AppError)
 * on the dangerous shapes: empty, containing '..' (traversal),
 * leading '/' (absolute), or embedded separators. Remaining
 * characters outside [A-Za-z0-9._-] are replaced with '-' (defense in
 * depth — call sites already mint opaque ids).
 */
function sanitizeStorageSegment(segment: string, label: string): string {
  const raw = segment
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `storage path segment (${label}) rejected: empty`,
    })
  }
  if (segment.includes('..')) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `storage path segment (${label}) rejected: contains '..' — ${JSON.stringify(raw.slice(0, 40))}`,
    })
  }
  if (segment.startsWith('/')) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `storage path segment (${label}) rejected: leading '/' — ${JSON.stringify(raw.slice(0, 40))}`,
    })
  }
  if (segment.includes('/') || segment.includes('\\')) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `storage path segment (${label}) rejected: path separator inside segment — ${JSON.stringify(raw.slice(0, 40))}`,
    })
  }
  const sanitized = segment.replace(/[^A-Za-z0-9._-]/g, '-')
  if (sanitized.length === 0) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `storage path segment (${label}) rejected: sanitizes to empty`,
    })
  }
  return sanitized
}

// ─── deterministic location derivation ──────────────────────────────

/** Website-published media is the ONLY public-bucket scope. */
export function bucketForScope(scope: StorageScope): string {
  return scope === 'website' ? PUBLIC_MEDIA_BUCKET : SCHOOL_MEDIA_BUCKET
}

/**
 * Deterministic storage location for a stored file:
 * `<scope>/<schoolId-or-scope>/<opaque-filename>`.
 *
 *   · registered uploads    → schoolId of the registry row
 *   · unregistered legacy   → scope as the second segment
 *   · avatars of schoolless users (SUPER_ADMIN) → scope fallback
 *
 * Same inputs always map to the same object — upload, serving and
 * migration all call this, so the registry needs no path column.
 */
export function storedObjectLocation(
  scope: StorageScope,
  schoolId: string | null | undefined,
  storedFileName: string,
): StoredObjectLocation {
  const bucket = bucketForScope(scope)
  const path = [
    sanitizeStorageSegment(scope, 'scope'),
    sanitizeStorageSegment(schoolId && schoolId.length > 0 ? schoolId : scope, 'tenant'),
    sanitizeStorageSegment(storedFileName, 'filename'),
  ].join('/')
  return { bucket, path }
}

// ─── bucket bootstrap ────────────────────────────────────────────────

let bucketsPromise: Promise<void> | null = null

async function ensureBucket(name: string, isPublic: boolean): Promise<void> {
  const { url } = storageEnv()
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ name, public: isPublic }),
  })
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  if (body.code === 'BucketAlreadyExists' || body.message?.includes('already exists')) return
  // Not a duplicate → verify existence directly before failing.
  const check = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(name)}`, {
    headers: authHeaders(),
  })
  if (check.ok) return
  throw storageFailure('ensureBuckets', res.status, `bucket ${name}: ${body.code ?? body.message ?? 'unknown'}`)
}

/**
 * Idempotent bucket bootstrap — 'school-media' (PRIVATE) +
 * 'public-media' (PUBLIC). Memoized per process; every upload awaits
 * it, so routes never need explicit setup. Re-running against an
 * existing project is a no-op (BucketAlreadyExists → verified ok).
 */
export function ensureBuckets(): Promise<void> {
  if (!bucketsPromise) {
    bucketsPromise = (async () => {
      await ensureBucket(SCHOOL_MEDIA_BUCKET, false)
      await ensureBucket(PUBLIC_MEDIA_BUCKET, true)
    })().catch((e) => {
      bucketsPromise = null // failed bootstrap may be retried on the next call
      throw e
    })
  }
  return bucketsPromise
}

// ─── object operations ───────────────────────────────────────────────

/**
 * Upload bytes into Supabase Storage. `x-upsert: true` makes the
 * write idempotent (re-running a seed or the migration script
 * overwrites in place). The stored object carries `mime` as its
 * Content-Type — serving routes rely on it.
 *
 * `tenantId` (the row's schoolId) selects the second path segment;
 * omit it for scope-tenant-less files (falls back to the scope).
 */
export async function storageUpload(
  scope: StorageScope,
  filename: string,
  bytes: Uint8Array,
  mime: string,
  tenantId?: string | null,
): Promise<StoredObjectLocation> {
  const { url } = storageEnv()
  await ensureBuckets()
  const { bucket, path } = storedObjectLocation(scope, tenantId, filename)
  // `new Uint8Array(bytes)` re-types the value as Uint8Array<ArrayBuffer> so
  // it satisfies the DOM fetch() BodyInit contract (runtime-identical copy;
  // TS 5.9's Uint8Array<ArrayBufferLike> is not assignable to BodyInit).
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': mime || 'application/octet-stream', 'x-upsert': 'true' }),
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
    throw storageFailure('upload', res.status, `bucket ${bucket} path ${path}: ${body.code ?? body.message ?? 'unknown'}`)
  }
  return { bucket, path }
}

/**
 * Mint a time-limited signed URL for a (private or public) object.
 * Returns the FULL URL (host included). The query already carries
 * the token; append extra params (e.g. `download=<name>`) with '&'.
 */
export async function storageSignedUrl(bucket: string, path: string, ttlSec: number): Promise<string> {
  const { url } = storageEnv()
  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ expiresIn: ttlSec }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
    throw storageFailure('sign', res.status, `bucket ${bucket} path ${path}: ${body.code ?? body.message ?? 'unknown'}`)
  }
  const data = (await res.json()) as { signedURL?: string; signedUrl?: string }
  const signed = data.signedURL ?? data.signedUrl
  if (!signed) {
    throw storageFailure('sign', res.status, `bucket ${bucket} path ${path}: no signedURL in response`)
  }
  return signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`
}

/** Public (unsigned, anonymous) URL for an object in a PUBLIC bucket. */
export function storagePublicUrl(bucket: string, path: string): string {
  const { url } = storageEnv()
  return `${url}/storage/v1/object/public/${bucket}/${encodeStoragePath(path)}`
}

/**
 * Download object bytes with the service key. 404/NoSuchKey →
 * RESOURCE_NOT_FOUND (honest not-found); other failures →
 * EXTERNAL_SERVICE_FAILURE.
 */
export async function storageDownload(bucket: string, path: string): Promise<ArrayBuffer> {
  const { url } = storageEnv()
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
    headers: authHeaders(),
  })
  if (res.ok) return res.arrayBuffer()
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  const notFound = res.status === 404 || body.code === 'NoSuchKey' || body.code === 'not_found'
  if (notFound) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      internalDetail: `storage download: object ${bucket}/${path} not found`,
    })
  }
  throw storageFailure('download', res.status, `bucket ${bucket} path ${path}: ${body.code ?? body.message ?? 'unknown'}`)
}

/**
 * Delete an object. A missing object is SUCCESS (same semantics as
 * `unlink(..., { force: true })`); other failures throw. Path
 * segments are re-validated defensively before the destructive call.
 */
export async function storageDelete(bucket: string, path: string): Promise<void> {
  const { url } = storageEnv()
  const validated = path.split('/').map((s) => sanitizeStorageSegment(s, 'delete-segment')).join('/')
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeStoragePath(validated)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (res.ok) return
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  const missing = res.status === 404 || body.code === 'NoSuchKey' || body.code === 'not_found'
  if (missing) return
  throw storageFailure('delete', res.status, `bucket ${bucket} path ${path}: ${body.code ?? body.message ?? 'unknown'}`)
}

/**
 * Existence probe (HEAD, service key). Serving routes use this to
 * keep their honest-404 contract — "row exists but bytes gone"
 * stays a 404 instead of a redirect into a broken target. The
 * Storage API answers 200 for present objects and 400/404 for
 * missing ones; anything else is a service failure (loud).
 */
export async function storageExists(bucket: string, path: string): Promise<boolean> {
  const { url } = storageEnv()
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
    method: 'HEAD',
    headers: authHeaders(),
  })
  if (res.ok) return true
  if (res.status === 400 || res.status === 404) return false
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  throw storageFailure('exists', res.status, `bucket ${bucket} path ${path}: ${body.code ?? body.message ?? 'unknown'}`)
}
