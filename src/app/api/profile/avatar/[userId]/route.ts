import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { AppError } from '@/lib/security/errors'
import { storageDownload } from '@/lib/storage/supabase'
import { avatarLocation, AVATAR_EXT_TO_MIME, isSafeAvatarFileName } from '@/lib/avatar'

export const runtime = 'nodejs'

/**
 * GET /api/profile/avatar/[userId] — authorized avatar stream.
 *
 * Visibility: the photo at <img src> is fetched with the viewer's cookie,
 * so this route can authenticate per-request. A viewer may see a user's
 * avatar when they ARE that user, share the school, or are the platform
 * super admin — the same trust boundary the rest of the ERP uses for
 * cross-role identity surfaces. Never public, never cached cross-user.
 *
 * Phase 8A (8A-C9b): the bytes are read from the PRIVATE 'school-media'
 * bucket at the deterministic `avatars/<schoolId-or-'avatars'>/<fileName>`
 * path (same derivation the POST route writes). A missing object keeps
 * the honest 404 (row exists but bytes gone); the byte-streaming
 * response contract (status/headers) is identical to the disk era.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const viewer = await getCurrentUser()
    if (!viewer) return unauthorized()

    const { userId } = await params
    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true, avatar: true, status: true },
    })
    if (!target?.avatar || !isSafeAvatarFileName(target.avatar)) return notFound()

    const allowed =
      viewer.id === target.id ||
      viewer.role === 'SUPER_ADMIN' ||
      (target.schoolId !== null && viewer.schoolId === target.schoolId)
    if (!allowed) return forbidden()

    // ── Storage read (Phase 8A): authorization has passed; derive the
    // object path from the target row exactly like the POST route does.
    const location = avatarLocation(target.schoolId, target.avatar)
    let bytes: ArrayBuffer
    try {
      bytes = await storageDownload(location.bucket, location.path)
    } catch (e) {
      // Row exists but the object is gone — honest 404, never a 500.
      if (e instanceof AppError && (e.code === 'RESOURCE_NOT_FOUND' || e.status === 404)) {
        return notFound()
      }
      throw e
    }
    const ext = target.avatar.split('.').pop() ?? ''
    const mime = AVATAR_EXT_TO_MIME[ext] ?? 'application/octet-stream'

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.byteLength),
        // Private per-viewer: the authorization is cookie-based, so caches
        // must not share the bytes across users/devices.
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 400 })
  }
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
}
function forbidden() {
  return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
}
function notFound() {
  return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
}
