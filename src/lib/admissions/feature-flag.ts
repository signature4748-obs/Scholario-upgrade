import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { parseFlags } from '@/lib/platform/module-flags'

/**
 * admissionsServerIssuance — the feature flag gating the ENTIRE new
 * server-issued admissions workflow (FEE-ADMISSIONS MVP, H1-R2).
 *
 * SEMANTICS — deliberately DIFFERENT from the module availability flags
 * (src/lib/platform/module-flags.ts):
 *   · Module flags are product-availability toggles that default ON
 *     (absent key = enabled, fail-open) — they hide modules, they are
 *     not security boundaries.
 *   · THIS flag gates a NEW financial-records workflow. Absent key =
 *     DISABLED (fail-closed). Enabling it is an explicit production
 *     decision (per-school override in School.featureFlags, or the
 *     platform-wide master switch in PlatformSetting.modules).
 *
 * Resolution: School.featureFlags["admissionsServerIssuance"] (boolean)
 * → PlatformSetting.modules["admissionsServerIssuance"] (boolean)
 * → false. Never anything else.
 */
export const ADMISSIONS_ISSUANCE_FLAG = 'admissionsServerIssuance'

/** Effective flag value for a school (default OFF — fail-closed). */
export async function isAdmissionsIssuanceEnabled(schoolId: string): Promise<boolean> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { featureFlags: true },
  })
  const schoolFlags = parseFlags(school?.featureFlags ?? '{}')
  if (typeof schoolFlags[ADMISSIONS_ISSUANCE_FLAG] === 'boolean') {
    return schoolFlags[ADMISSIONS_ISSUANCE_FLAG]
  }
  const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
  const master = parseFlags(setting?.modules ?? '{}')
  if (typeof master[ADMISSIONS_ISSUANCE_FLAG] === 'boolean') {
    return master[ADMISSIONS_ISSUANCE_FLAG]
  }
  return false
}

/** Guard for new-workflow routes: 403 FEATURE_DISABLED when off. */
export async function assertAdmissionsIssuanceEnabled(schoolId: string): Promise<void> {
  const enabled = await isAdmissionsIssuanceEnabled(schoolId)
  if (!enabled) {
    throw new AppError('FEATURE_DISABLED', {
      publicMessage:
        'Server-issued admissions is not enabled for your school yet. The existing admission workflow continues to work unchanged.',
      internalDetail: `assertAdmissionsIssuanceEnabled: ${ADMISSIONS_ISSUANCE_FLAG} off for school ${schoolId.slice(0, 8)}…`,
    })
  }
}
