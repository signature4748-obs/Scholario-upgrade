import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getUserPreferences, saveUserPreferences } from '@/lib/user-preferences'

export const runtime = 'nodejs'

/**
 * GET /api/student/settings — the signed-in student's preferences.
 * Identity (and school scope) is derived from the erp_session cookie via
 * the central withAuthz pipeline (ACTIVE-status enforced — 3-c fix: the
 * previous raw getCurrentUser check never verified the account status, so
 * a SUSPENDED student could still read/write preferences). A student
 * never sees another student's or another school's rows: the lookup key
 * is the SESSION's user id, full stop.
 */
export async function GET() {
  return withAuthz({ roles: ['STUDENT'] }, async (ctx) => {
    return await getUserPreferences(ctx.user.id)
  })
}

/**
 * PUT /api/student/settings — persist preference domains.
 * Body: { notifications?: {...booleans}, learning?: {...booleans} }.
 * Values are normalized server-side (unknown keys dropped, non-booleans
 * ignored) — a malformed payload can never poison the stored JSON, and
 * schoolId comes from the session, never the body.
 */
export async function PUT(req: NextRequest) {
  return withAuthz({ roles: ['STUDENT'] }, async (ctx) => {
    const body = await req.json().catch(() => ({}))
    return await saveUserPreferences(ctx.user.id, ctx.schoolId, {
      notifications: body?.notifications,
      learning: body?.learning,
    })
  })
}
