import { db } from '@/lib/db'
import { getCurrentUser, getCurrentSession } from '@/lib/auth'
import { api } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * DELETE /api/auth/sessions/[id] — sign out ONE other session.
 * Ownership enforced server-side: the row must belong to the caller AND
 * must not be the current session (current signs out via /api/auth/logout).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    // Task 4-d (fix #9) — mirror withUser semantics (ACTIVE accounts only).
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

    const { id } = await params
    const current = await getCurrentSession()

    const row = await db.session.findUnique({ where: { id } })
    if (!row || row.userId !== user.id) throw new Error('NOT_FOUND')
    if (current && row.id === current.id) {
      throw new Error('Use sign out to end the current session')
    }

    await db.session.delete({ where: { id } })

    await db.activityLog.create({
      data: {
        schoolId: user.schoolId ?? null,
        userId: user.id,
        action: 'session_revoked',
        detail: 'One other session signed out.',
      },
    }).catch(() => {})

    return { ok: true }
  })
}
