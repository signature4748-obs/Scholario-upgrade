import { NextRequest } from 'next/server'
import { rm, writeFile } from 'fs/promises'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { contentLengthExceedsUploadLimit } from '@/lib/security/upload'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TO_EXT,
  avatarBytesMatchMime,
  avatarPath,
  avatarServePath,
  ensureAvatarDir,
  generateAvatarFileName,
  isSafeAvatarFileName,
} from '@/lib/avatar'

export const runtime = 'nodejs'

/**
 * POST /api/profile/avatar — upload (or replace) the CALLER's own profile
 * photo. Multipart form with a single `file` field. Any authenticated role
 * may set their own; nobody can set someone else's (the target is always
 * the session user). Validates MIME allowlist + magic bytes + 5MB cap;
 * replaces the previous file atomically-enough (write new, then remove old).
 */
export async function POST(req: NextRequest) {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

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
    await ensureAvatarDir()
    await writeFile(avatarPath(fileName), bytes)

    // Remove the previous photo's bytes (best-effort).
    const prev = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true } })
    if (prev?.avatar && isSafeAvatarFileName(prev.avatar) && prev.avatar !== fileName) {
      await rm(avatarPath(prev.avatar), { force: true }).catch(() => {})
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
        detail: 'Profile photo updated.',
      },
    }).catch(() => {})

    return updated
  })
}

/**
 * DELETE /api/profile/avatar — remove the caller's own photo (back to the
 * initials avatar everywhere). Only the session user's row/file is touched.
 */
export async function DELETE() {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')

    const row = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true } })
    if (row?.avatar && isSafeAvatarFileName(row.avatar)) {
      await rm(avatarPath(row.avatar), { force: true }).catch(() => {})
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
