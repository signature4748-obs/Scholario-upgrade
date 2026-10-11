import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { contentLengthExceedsUploadLimit } from '@/lib/security/upload'
import { isCanonicalSchoolRole } from '@/lib/security/permissions'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TO_EXT,
  avatarBytesMatchMime,
  avatarServePath,
  avatarDelete,
  avatarUpload,
  generateAvatarFileName,
  isSafeAvatarFileName,
} from '@/lib/avatar'

export const runtime = 'nodejs'

/**
 * POST /api/profile/avatar — upload (or replace) the CALLER's own profile
 * photo. Multipart form with a single `file` field. Any authenticated
 * CANONICAL school role (PRINCIPAL | TEACHER | STUDENT — Gate F identity
 * invariant) may set their own; nobody can set someone else's (the target
 * is always the session user). Validates MIME allowlist + magic bytes +
 * 5MB cap; replaces the previous file atomically-enough (write new, then
 * remove old).
 *
 * Phase 8A (8A-C9b): the bytes go to the PRIVATE 'school-media' bucket at
 * the deterministic path `avatars/<schoolId-or-'avatars'>/<fileName>`
 * (x-upsert). The validation/authorization/audit/User.avatar + avatarUrl
 * column semantics are IDENTICAL to the disk era — only the byte
 * destination changed. No local-disk fallback.
 */
export async function POST(req: NextRequest) {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')
    // GATE F — identity-surface canonical-role invariant, mirroring
    // /api/auth/me: a non-canonical school-role session (PARENT, MANAGEMENT,
    // ACCOUNTANT, DRIVER, SUPER_ADMIN, stray values) hydrates as logged-out.
    if (!isCanonicalSchoolRole(user.role)) throw new Error('UNAUTHORIZED')

    // PIH-4c — EARLY size rejection BEFORE the multipart body is buffered:
    // an oversized Content-Length answers 413 (PAYLOAD_TOO_LARGE)
    // immediately without reading the stream; the post-parse file.size
    // guard below stays authoritative.
    if (contentLengthExceedsUploadLimit(req, AVATAR_MAX_BYTES)) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        publicMessage: 'Photo must be smaller than 5 MB',
        internalDetail: `avatar upload: declared Content-Length exceeds ${AVATAR_MAX_BYTES} bytes`,
      })
    }

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || !(file instanceof File)) throw new Error('A photo file is required')

    const mime = file.type || ''
    if (!AVATAR_MIME_TO_EXT[mime]) {
      throw new Error('Photo must be a JPG, PNG or WebP image')
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new Error('Photo must be smaller than 5 MB')
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!avatarBytesMatchMime(mime, bytes)) {
      throw new Error('That file does not look like a valid image')
    }

    const fileName = generateAvatarFileName(user.id, mime)
    const stored = await avatarUpload(user.schoolId, fileName, bytes, mime)

    // Remove the previous photo's bytes (best-effort; a user whose
    // schoolId changed since the old upload simply leaves an unreachable
    // object — same leniency the disk-era force-rm had).
    const prev = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true } })
    if (prev?.avatar && isSafeAvatarFileName(prev.avatar) && prev.avatar !== fileName) {
      await avatarDelete(user.schoolId, prev.avatar)
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        avatar: fileName,
        avatarUrl: `${avatarServePath(user.id)}?v=${Date.now()}`,
      },
      select: { id: true, avatarUrl: true },
    })

    await db.activityLog.create({
      data: {
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'avatar_changed',
        detail: `Profile photo updated. → supabase://${stored.bucket}/${stored.path}`,
      },
    }).catch(() => {})

    return updated
  })
}

/**
 * DELETE /api/profile/avatar — remove the caller's own photo (back to the
 * initials avatar everywhere). Only the session user's row/file is touched.
 * Active canonical-role session required (Gate F — same invariant as POST
 * and /api/auth/me). Phase 8A: the object is deleted from the PRIVATE
 * 'school-media' bucket at the same deterministic path (missing object = ok).
 */
export async function DELETE() {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')
    // GATE F — identity-surface canonical-role invariant (mirrors /me).
    if (!isCanonicalSchoolRole(user.role)) throw new Error('UNAUTHORIZED')

    const row = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true } })
    if (row?.avatar && isSafeAvatarFileName(row.avatar)) {
      await avatarDelete(user.schoolId, row.avatar)
    }

    await db.user.update({
      where: { id: user.id },
      data: { avatar: null, avatarUrl: null },
      select: { id: true, avatarUrl: true },
    })

    await db.activityLog.create({
      data: {
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'avatar_changed',
        detail: 'Profile photo removed.',
      },
    }).catch(() => {})

    return { ok: true, avatarUrl: null }
  })
}
