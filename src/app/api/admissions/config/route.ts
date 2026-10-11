import { withAuthz } from '@/lib/security/authz'
import { isAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { schoolAcademicYearOrNull } from '@/lib/admissions/academic-year'

export const runtime = 'nodejs'

/**
 * GET /api/admissions/config — the client's ONE lookup for the new
 * workflow's state (FEE-ADMISSIONS MVP, Phase F):
 *
 *   { enabled: boolean, academicYear: string | null }
 *
 * `enabled` is the effective `admissionsServerIssuance` flag (default
 * OFF). When false, the existing client-side admission workflow runs
 * UNCHANGED — every new-workflow API refuses with FEATURE_DISABLED.
 * `academicYear` is the school's canonical year (null = not set; the
 * UI must show the honest "Session not set" state, never invent one).
 *
 * PRINCIPAL-only (the workflow's operator).
 */
export async function GET() {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const enabled = await isAdmissionsIssuanceEnabled(ctx.schoolId)
    const academicYear = enabled ? await schoolAcademicYearOrNull(ctx.schoolId) : null
    return { enabled, academicYear }
  })
}
