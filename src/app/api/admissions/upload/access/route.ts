import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { signFileToken } from '@/lib/security/file-signing'
import { auditEvent } from '@/lib/security/audit'
import { isValidStoredFileId, ADMISSION_UPLOAD_POLICY } from '@/lib/security/upload'

export const runtime = 'nodejs'

/**
 * POST /api/admissions/upload/access — { fileId, download? } → { url, expiresAt }
 *
 * Mints a short-lived (default 1h) HMAC-signed URL for one stored
 * admission document (View / Download links in the admission module).
 *
 * Phase 2 (3-c audit V5/V10) — the token binds scope+fileId but never a
 * tenant, so the MINT is now ownership-checked against the UploadedFile
 * registry: the document must be REGISTERED and belong to the CALLER's
 * school (previously any school's PRINCIPAL could mint a signed URL for
 * any other school's document). An unregistered legacy file is refused —
 * ownership cannot be proven, so no URL is ever signed for it.
 * PRINCIPAL / MANAGEMENT only; rate-limited; every grant audited.
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

      if (!fileIdRaw || !isValidStoredFileId(fileIdRaw, ADMISSION_UPLOAD_POLICY.allowedExts)) {
        throw new AppError('NOT_FOUND')
      }
      const fileId = fileIdRaw

      // ── 3-c V5/V10: registry ownership check before minting ────────
      // A foreign school's document "does not exist" (fail-safe 404); a
      // legacy unregistered document cannot be ownership-verified → refuse.
      const row = await db.uploadedFile.findUnique({ where: { id: fileId } })
      if (!row || row.scope !== 'admissions' || !user.schoolId || row.schoolId !== user.schoolId) {
        throw new AppError('NOT_FOUND', {
          internalDetail: `admissions upload access: file ${fileId} unregistered or foreign tenant`,
        })
      }

      const { token, expiresAt } = signFileToken(fileId, 'admissions')
      const qs = new URLSearchParams({ t: token })
      if (download) qs.set('download', '1')
      const url = `/api/admissions/upload/${encodeURIComponent(fileId)}?${qs.toString()}`

      await auditEvent({
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'FILE_ACCESS_GRANTED',
        requestId,
        detail: `Signed URL granted for admission document ${fileId}${download ? ' (download)' : ''}`,
      }).catch(() => {})

      return { url, expiresAt: new Date(expiresAt).toISOString() }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
