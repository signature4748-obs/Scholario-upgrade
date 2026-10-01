// ============================================================
// SS-1 — AVATAR STORAGE (server-side profile photo helpers)
// ------------------------------------------------------------
// Follows the RB-1 study-materials storage discipline. Phase 8A
// (8A-C9b): bytes live in the PRIVATE Supabase Storage bucket
// 'school-media' under the deterministic object path
// `avatars/<schoolId-or-'avatars'>/<safe-file-name>` (derived via
// storedObjectLocation, exactly like the admissions/study-materials
// routes — same inputs always map to the same object, so
// User.avatar's opaque fileName is the only state the schema needs).
// Avatars are served ONLY through the authorized
// /api/profile/avatar/[userId] route (cookie-authenticated,
// same-school), never from a public bucket. The stored fileName is
// server-generated (never from the user's upload name); User.avatar
// stores it, User.avatarUrl carries the serve path for <img src>
// (same-origin requests carry the cookie).
// ============================================================

import { randomBytes } from 'crypto'
import {
  storedObjectLocation,
  storageUpload,
  storageDelete,
  StoredObjectLocation,
} from '@/lib/storage/supabase'

/** Upload ceiling — 5 MB (bytes). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/** Allowed MIME types → canonical extension (narrow, image-only). */
export const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Content-Type by stored extension (download side). */
export const AVATAR_EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Light magic-byte sniff on top of the declared MIME — rejects polyglot
 * or mislabeled payloads before a single byte hits storage.
 */
export function avatarBytesMatchMime(mime: string, buf: Buffer): boolean {
  if (buf.byteLength < 12) return false
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (mime === 'image/png')
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (mime === 'image/webp')
    return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
  return false
}

/** Server-generated safe file name (userId-scoped prefix + random base). */
export function generateAvatarFileName(userId: string, mimeType: string): string {
  const ext = AVATAR_MIME_TO_EXT[mimeType] ?? 'bin'
  const id = `av${Date.now().toString(36)}${randomBytes(10).toString('hex')}`
  // Prefix with the sanitized user id so object ownership is auditable.
  const safeUser = userId.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase()
  return `${safeUser}-${id}.${ext}`
}

/** Defense-in-depth path guard (same policy as study materials). */
export function isSafeAvatarFileName(fileName: string): boolean {
  return /^[a-z0-9]+-[a-z0-9]+\.[a-z0-9]{1,8}$/.test(fileName)
}

/**
 * Deterministic storage location for a stored avatar:
 * `avatars/<schoolId-or-'avatars'>/<fileName>` in the PRIVATE
 * 'school-media' bucket. `schoolId` is the OWNING user's school (the
 * scope fallback covers schoolless SUPER_ADMIN accounts) — POST (owner)
 * and GET (target) derive the identical path from the same user row.
 */
export function avatarLocation(
  schoolId: string | null | undefined,
  fileName: string,
): StoredObjectLocation {
  return storedObjectLocation('avatars', schoolId, fileName)
}

/**
 * Upload avatar bytes (x-upsert, idempotent). Mirrors the admissions
 * upload pattern: opaque server-minted fileName + tenant segment.
 */
export function avatarUpload(
  schoolId: string | null | undefined,
  fileName: string,
  bytes: Uint8Array,
  mime: string,
): Promise<StoredObjectLocation> {
  return storageUpload('avatars', fileName, bytes, mime, schoolId)
}

/**
 * Remove an avatar object (missing object = success — the same
 * best-effort semantics the disk `rm(..., { force: true })` had).
 */
export async function avatarDelete(
  schoolId: string | null | undefined,
  fileName: string,
): Promise<void> {
  const location = avatarLocation(schoolId, fileName)
  await storageDelete(location.bucket, location.path).catch(() => {})
}

/** Public serve path for a user's avatar (cache-busted client-side). */
export function avatarServePath(userId: string): string {
  return `/api/profile/avatar/${userId}`
}
