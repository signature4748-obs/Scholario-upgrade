import { NextRequest } from 'next/server'
import { getSessionToken, destroySession, clearSessionCookie, hashSessionToken } from '@/lib/auth'
import { api } from '@/lib/api'
import { db } from '@/lib/db'
import { newRequestId } from '@/lib/security/errors'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const token = await getSessionToken()
    if (token) {
      // Audit the sign-out BEFORE destroying the session row (the row
      // carries the userId we need). PHASE 8A: lookup by hash — the raw
      // token exists only on the wire.
      const session = await db.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        select: { userId: true, user: { select: { schoolId: true } } },
      }).catch(() => null)
      await destroySession(token)
      if (session) {
        await auditEvent({
          schoolId: session.user?.schoolId ?? null,
          userId: session.userId,
          action: 'LOGOUT',
          ip: clientIpFromHeaders(req.headers),
          requestId,
          detail: 'Signed out',
        }).catch(() => {})
      }
    }
    await clearSessionCookie()
    return { ok: true }
  })
}
