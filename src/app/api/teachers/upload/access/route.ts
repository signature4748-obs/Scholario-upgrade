import { NextRequest } from 'next/server'
import { withUser } from '@/lib/api'
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
 * Phase 1 note: local-disk storage has no per-file ownership registry
 * (fileIds are unguessable server-minted ids). Access is therefore gated
 * to authenticated staff (PRINCIPAL / MANAGEMENT), rate-limited, and
 * every grant is audited. The ownership registry arrives with the
 * object-storage phase.
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
        throw new Error('NOT_FOUND')
      }
      const fileId = fileIdRaw

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
