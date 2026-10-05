import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { AppError, newRequestId } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { unlinkGoogleIdentity } from '@/lib/platform/google-account'
import { revokeAllPlatformSessions } from '@/lib/platform/auth'

export const runtime = 'nodejs'

/**
 * POST /api/platform/auth/google/unlink — AUTHENTICATED + STEP-UP.
 *
 * Removes the signed-in admin's linked Google identity (their own
 * account, their own action — the settings surface). Password login
 * is never affected. A conservative extra: unlinking also revokes
 * the admin's live sessions (forces a fresh authentication with the
 * surviving credential — an unlink should never leave silently
 * borrowed sessions alive).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withPlatform(
    { stepUp: true },
    async (ctx) => {
      const admin = await db.platformAdmin.findUnique({ where: { id: ctx.admin.id } })
      if (!admin?.googleSub) {
        throw new AppError('CONFLICT', {
          publicMessage: 'No Google identity is linked to this account.',
          internalDetail: 'google unlink: nothing linked',
        })
      }
      const result = await unlinkGoogleIdentity(ctx.admin.id, {
        ip: clientIpFromHeaders(req.headers),
        requestId,
        byAdminId: ctx.admin.id,
      })
      if (!result.ok) {
        throw new AppError('CONFLICT', {
          publicMessage: 'No Google identity is linked to this account.',
          internalDetail: 'google unlink: nothing linked (raced)',
        })
      }
      // Fresh authentication with the surviving credential.
      const revoked = await revokeAllPlatformSessions(ctx.admin.id)
      return { ok: true, revokedSessions: revoked }
    },
    { method: 'POST' },
  )
}
