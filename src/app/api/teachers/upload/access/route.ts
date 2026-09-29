import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { signFileToken } from '@/lib/security/file-signing'
import { auditEvent } from '@/lib/security/audit'
import { isValidStoredFileId, TEACHER_UPLOAD_POLICY } from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * POST /api/teachers/upload/access — { fileId, download? } → { url, expiresAt }
 *
 * Mints a SHORT-LIVED (default 1h) HMAC-signed URL for one stored media
 * file, so `<img src>` / `<a href>` navigation can authorize without an
 * Authorization header (dev preview iframe; any future embed).
 *
 * Phase 2 (3-c audit V5/V10) — the token binds scope+fileId but never a
 * tenant, so the MINT is now ownership-checked against the UploadedFile
 * registry: the file must be REGISTERED and belong to the CALLER's
 * school. An unregistered (legacy pre-registry) file is refused — we
 * cannot prove ownership, so we never sign a URL for it. (Access remains
 * PRINCIPAL / MANAGEMENT, rate-limited, every grant audited.)
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      enforceRateLimit(`rl:fileaccess:${user.id}`, RATE_LIMITS.fileAccess)

      const body = await req.json().catch(() => ({}))
      // fileId shape (incl. extension) is fully validated by
      // isValidStoredFileId below — read bounded + reject junk shapes.
      const fileIdRaw = typeof body?.fileId === 'string' ? body.fileId.trim().slice(0, 120) : ''
      const download = body?.download === true || body?.download === '1'

      if (!fileIdRaw || !isValidStoredFileId(fileIdRaw, TEACHER_UPLOAD_POLICY.allowedExts)) {
        throw new AppError('NOT_FOUND')
      }
      const fileId = fileIdRaw

      // ── 3-c V5/V10: registry ownership check before minting ────────
      // A foreign school's file "does not exist" (fail-safe 404); a
      // legacy unregistered file cannot be ownership-verified → refuse.
      const row = await db.uploadedFile.findUnique({ where: { id: fileId } })
      if (!row || row.scope !== 'teachers' || !user.schoolId || row.schoolId !== user.schoolId) {
        throw new AppError('NOT_FOUND', {
          internalDetail: `teachers upload access: file ${fileId} unregistered or foreign tenant`,
        })
      }

      const { token, expiresAt } = signFileToken(fileId, 'teachers')
      const qs = new URLSearchParams({ t: token })
      if (download) qs.set('download', '1')
      const url = `/api/teachers/upload/${encodeURIComponent(fileId)}?${qs.toString()}`

      await auditEvent({
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'FILE_ACCESS_GRANTED',
        requestId,
        detail: `Signed URL granted for teacher media ${fileId}${download ? ' (download)' : ''}`,
      }).catch(() => {})

      return { url, expiresAt: new Date(expiresAt).toISOString() }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
