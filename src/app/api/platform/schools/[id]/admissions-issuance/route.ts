import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { parseFlags } from '@/lib/platform/module-flags'
import {
  ADMISSIONS_ISSUANCE_FLAG,
  isAdmissionsIssuanceEnabled,
} from '@/lib/admissions/feature-flag'
import { schoolAcademicYearOrNull } from '@/lib/admissions/academic-year'

export const runtime = 'nodejs'

/**
 * GET/PATCH /api/platform/schools/[id]/admissions-issuance — the audited
 * control-plane surface for the `admissionsServerIssuance` feature flag
 * (FEE-ADMISSIONS MVP, Batch 1 / Workstream C).
 *
 * WHY A DEDICATED ROUTE (not /feature-flags): that route's vocabulary is
 * FLAGGABLE_MODULES — fail-open product-availability toggles (exams, fees,
 * homework…). This flag is a fail-closed FINANCIAL-WORKFLOW gate with
 * different semantics (absent = OFF), a step-up (recent-MFA) requirement,
 * readiness reporting and a dedicated audit vocabulary entry
 * (`platform.school.admissions_issuance_updated`). Mixing the two would
 * either loosen the module validation or weaken this flag's semantics.
 *
 * FAIL-CLOSED SEMANTICS (identical to src/lib/admissions/feature-flag.ts):
 *   School.featureFlags[admissionsServerIssuance] (boolean)
 *   → PlatformSetting.modules[admissionsServerIssuance] (boolean)
 *   → false. Absent key = OFF.
 *
 * GET     permission schools.read  — effective state + resolution source +
 *                                 readiness (academic year, published fee
 *                                 structures). Never any secret material.
 * PATCH   permission schools.manage + step-up — sets the SCHOOL override
 *                                 for the explicitly selected school ONLY
 *                                 (other keys in featureFlags are preserved
 *                                 verbatim; other schools are untouched).
 *                                 One platform audit event per success:
 *                                 actor, school, previous/new state,
 *                                 readiness summary, timestamp.
 */

const patchBodySchema = z
  .object({ enabled: z.boolean() })
  .strict()

/** Readiness = the honest answer to "will the workflow actually work?". */
async function admissionsReadiness(schoolId: string) {
  const academicYear = await schoolAcademicYearOrNull(schoolId)
  const publishedFeeStructures = await db.feeStructure.count({
    where: { schoolId, status: { in: ['current', 'scheduled'] } },
  })
  return {
    academicYear,
    academicYearSet: academicYear !== null,
    publishedFeeStructures,
    ready: academicYear !== null && publishedFeeStructures > 0,
  }
}

/** Where the effective value comes from (school > platform > default OFF). */
async function flagResolution(schoolId: string): Promise<{
  enabled: boolean
  source: 'school' | 'platform' | 'default'
}> {
  const enabled = await isAdmissionsIssuanceEnabled(schoolId)
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { featureFlags: true },
  })
  const schoolFlags = parseFlags(school?.featureFlags ?? '{}')
  if (typeof schoolFlags[ADMISSIONS_ISSUANCE_FLAG] === 'boolean') {
    return { enabled, source: 'school' }
  }
  const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
  const master = parseFlags(setting?.modules ?? '{}')
  if (typeof master[ADMISSIONS_ISSUANCE_FLAG] === 'boolean') {
    return { enabled, source: 'platform' }
  }
  return { enabled, source: 'default' }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'admissions-issuance GET: unknown school id',
      })
    }
    const { enabled, source } = await flagResolution(id)
    const readiness = await admissionsReadiness(id)
    return { enabled, source, readiness }
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        body = {}
      }
      const parsed = patchBodySchema.safeParse(body)
      if (!parsed.success) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'Provide { "enabled": true } or { "enabled": false } — nothing else.',
          internalDetail: 'admissions-issuance PATCH: body validation failed',
        })
      }
      const next = parsed.data.enabled

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'School not found',
          internalDetail: 'admissions-issuance PATCH: unknown school id',
        })
      }

      // Previous EFFECTIVE state (school override ?? platform master ?? off).
      const previous = await isAdmissionsIssuanceEnabled(id)
      // Readiness snapshot BEFORE the write — recorded in the audit trail so
      // the event shows what the operator actually activated.
      const readiness = await admissionsReadiness(id)

      // Scoped write: ONLY this school's featureFlags, preserving every
      // other key verbatim (partial PATCH semantics, same as the
      // feature-flags route).
      const merged = {
        ...parseFlags(school.featureFlags),
        [ADMISSIONS_ISSUANCE_FLAG]: next,
      }
      await db.school.update({
        where: { id },
        data: { featureFlags: JSON.stringify(merged) },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.admissions_issuance_updated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip: clientIpFromHeaders(req.headers),
        reason: 'admissions server-issuance flag updated',
        metadata: {
          previous,
          next,
          academicYearSet: readiness.academicYearSet,
          publishedFeeStructures: readiness.publishedFeeStructures,
        },
      })

      return { ok: true, enabled: next, previous, source: 'school', readiness }
    },
    { method: 'PATCH' },
  )
}
