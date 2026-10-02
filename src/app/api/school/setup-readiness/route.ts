import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { computeSetupReadiness } from '@/lib/school/setup-readiness'

export const runtime = 'nodejs'

/**
 * GET /api/school/setup-readiness — PHASE 8C-F (mission §12).
 *
 * The PRINCIPAL's own guided-setup progress: the same DB-computed
 * readiness document the platform console sees, scoped to the
 * SESSION-DERIVED tenant (a client schoolId is never read — the tenant
 * comes from the authenticated principal's school binding).
 *
 * Powers the dashboard Setup Guide: a school that is still being built
 * sees exactly which required sections remain (with honest counts and
 * deep-links into the modules that complete them); a fully configured
 * school sees requiredComplete=true and the guide hides itself.
 *
 * Roles: PRINCIPAL / MANAGEMENT only (the school's builders). Teachers
 * and students have no setup responsibilities — 403.
 */
export async function GET(_req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const readiness = await computeSetupReadiness(ctx.schoolId)
    if (!readiness) {
      // Unreachable in practice (the session's school exists), but the
      // branch keeps the route fail-closed rather than fabricating.
      return { school: { id: ctx.schoolId, name: '', status: 'UNKNOWN' }, sections: [], summary: {
        requiredTotal: 0, requiredDone: 0, requiredComplete: false,
        optionalDone: 0, optionalTotal: 0, usable: false,
      } }
    }
    return readiness
  })
}
