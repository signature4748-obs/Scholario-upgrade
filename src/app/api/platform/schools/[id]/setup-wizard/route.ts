import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { parseFlags, effectiveModuleFlags, PLATFORM_MODULE_FLAGS_SELECT } from '@/lib/platform/module-flags'
import { computeSetupReadiness } from '@/lib/school/setup-readiness'
import { mergeWebsiteContent } from '@/lib/website-content'
import { principalInviteDeliveryState } from '@/lib/platform/principal-invite'
import { schoolLoginUrl, schoolPublicUrl } from '@/lib/plane'
import {
  deriveWizardSteps,
  computeActivationRequirements,
  identityCoreComplete,
  type WizardSchoolSnapshot,
  type WizardExtraCounts,
} from '@/lib/platform/setup-wizard-state'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/setup-wizard — the guided Setup
 * wizard's ONE aggregate read (PHASE 2).
 *
 * Everything here is DERIVED from the live database — the wizard has no
 * progress table and no client-side state of record. The readiness
 * engine (computeSetupReadiness) is THE progress oracle; this route adds
 * the wizard-specific slices the readiness document deliberately does
 * not carry: the founding principal's access state, effective module
 * flags (school override → platform master → default), the initial fee
 * catalogue / exam-type counts, the website presence document and the
 * derived activation requirements (reported here, enforced by the
 * activate route's opt-in strict mode).
 *
 * Permission: schools.read (read-only surface — every write stays in its
 * own audited route).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        shortName: true,
        tagline: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        website: true,
        established: true,
        academicYear: true,
        board: true,
        status: true,
        themeColor: true,
        accentColor: true,
        logoUrl: true,
        faviconUrl: true,
        slug: true,
        code: true,
        plan: true,
        settings: true,
        websiteContent: true,
        featureFlags: true,
      },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'setup-wizard: no such school',
      })
    }

    const [
      readiness,
      principal,
      masterFeeHeads,
      feeStructures,
      examTypes,
      gradeScales,
      platformSetting,
      schoolTeachers,
    ] = await Promise.all([
      computeSetupReadiness(school.id),
      db.user.findFirst({
        where: { schoolId: school.id, role: 'PRINCIPAL' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          mustChangePassword: true,
          passwordChangedAt: true,
          lastLoginAt: true,
          credentialExpiresAt: true,
        },
      }),
      db.masterFeeHead.count({ where: { schoolId: school.id } }),
      db.feeStructure.count({ where: { schoolId: school.id } }),
      db.examTypeConfig.count({ where: { schoolId: school.id } }),
      db.gradeScale.count({ where: { schoolId: school.id } }),
      db.platformSetting.findUnique({ where: { id: 'global' }, select: PLATFORM_MODULE_FLAGS_SELECT }),
      db.teacher.count({ where: { schoolId: school.id } }),
    ])

    if (!readiness) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'setup-wizard: readiness returned null',
      })
    }

    const invitation = principal
      ? await principalInviteDeliveryState(principal.id)
      : { state: 'NONE' as const }

    // Location slice — the SAME settings keys the provisioning wizard
    // writes (one vocabulary, never a parallel store).
    const settingsRaw = safeParse(school.settings)
    const location = {
      state: textOrNull(settingsRaw.state),
      district: textOrNull(settingsRaw.district),
      pincode: textOrNull(settingsRaw.pincode),
      country: textOrNull(settingsRaw.country),
      timezone: textOrNull(settingsRaw.timezone),
      workingDays: Array.isArray(settingsRaw.workingDays)
        ? (settingsRaw.workingDays as string[]).filter((d) => typeof d === 'string')
        : [],
      websiteEnabled: typeof settingsRaw.websiteEnabled === 'boolean' ? settingsRaw.websiteEnabled : true,
    }

    const snapshot: WizardSchoolSnapshot = {
      name: school.name,
      shortName: school.shortName,
      tagline: school.tagline,
      address: school.address,
      city: school.city,
      phone: school.phone,
      email: school.email,
      website: school.website,
      established: school.established,
      academicYear: school.academicYear,
      board: school.board,
      status: school.status,
      themeColor: school.themeColor,
      accentColor: school.accentColor,
      logoUrl: school.logoUrl,
      faviconUrl: school.faviconUrl,
      location,
    }

    const [principalCount, admissionsIssuanceFlag] = await Promise.all([
      db.user.count({ where: { schoolId: school.id, role: 'PRINCIPAL', status: 'ACTIVE' } }),
      Promise.resolve(parseAdmissionsFlag(school.settings)),
    ])

    const extras: WizardExtraCounts = {
      masterFeeHeads,
      feeStructures,
      examTypes,
      gradeScales,
      teachers: schoolTeachers,
      schoolFlagOverrides: Object.keys(parseFlags(school.featureFlags)).length,
    }

    const steps = deriveWizardSteps(snapshot, readiness, extras)
    const identityCore = identityCoreComplete(snapshot)
    const activation = computeActivationRequirements(snapshot, readiness, principalCount, false, identityCore)
    const activationStrict = computeActivationRequirements(snapshot, readiness, principalCount, true, identityCore)

    // Effective module availability — the EXISTING resolver (school
    // override → platform master → default). Module availability is a
    // product toggle, NOT an authorization boundary; the wizard only
    // mirrors it here.
    const effective = await effectiveModuleFlags(school.id)
    const schoolFlags = parseFlags(school.featureFlags)
    const masterFlags = parseFlags(platformSetting?.modules ?? '{}')

    // Website presence — the SAME CMS document the school edits through
    // /api/school/website (the wizard only seeds hero/about/contact/seo;
    // the school owns the full editor after handover).
    const content = mergeWebsiteContent(school.websiteContent)

    return {
      school: {
        id: school.id,
        name: school.name,
        shortName: school.shortName,
        tagline: school.tagline,
        slug: school.slug,
        code: school.code,
        plan: school.plan,
        status: school.status,
        board: school.board,
        academicYear: school.academicYear,
        address: school.address,
        city: school.city,
        phone: school.phone,
        email: school.email,
        website: school.website,
        established: school.established,
        themeColor: school.themeColor,
        accentColor: school.accentColor,
        logoUrl: school.logoUrl,
        faviconUrl: school.faviconUrl,
        location,
      },
      readiness,
      steps,
      // TWO-PROJECT TOPOLOGY — the canonical doors, computed from
      // SCHOOL_APP_BASE_URL server-side (never guessed client-side).
      access: {
        loginUrl: schoolLoginUrl(school.slug),
        publicUrl: schoolPublicUrl(school.slug),
      },
      activation: {
        /** Non-strict verdict (false only when no principal exists). */
        ok: activation.ok,
        missing: activation.missing,
        /** The wizard's strict checklist verdict — drives the review screen. */
        wizardChecklistOk: activationStrict.ok,
        wizardMissing: activationStrict.missing,
      },
      principal: principal
        ? {
            id: principal.id,
            email: principal.email,
            name: principal.name,
            phone: principal.phone,
            status: principal.status,
            credentialState: principal.mustChangePassword
              ? 'BOOTSTRAP_PENDING'
              : principal.passwordChangedAt
                ? 'OWNED'
                : 'UNKNOWN',
            lastLoginAt: principal.lastLoginAt?.toISOString() ?? null,
            credentialExpiresAt: principal.credentialExpiresAt?.toISOString() ?? null,
            invitation,
          }
        : null,
      counts: {
        teachers: schoolTeachers,
        classes: readiness.sections.find((s) => s.id === 'academic')?.counts.classes ?? 0,
        subjects: readiness.sections.find((s) => s.id === 'academic')?.counts.subjects ?? 0,
        masterFeeHeads,
        feeStructures,
        examTypes,
        gradeScales,
      },
      modules: {
        master: masterFlags,
        school: schoolFlags,
        effective,
        admissionsIssuance: admissionsIssuanceFlag,
      },
      website: {
        enabled: location.websiteEnabled,
        hero: content.hero,
        about: content.about,
        contact: content.contact,
        seo: content.seo,
      },
    }
  })
}

function safeParse(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** Fail-closed admissions-issuance flag read (absent = OFF). The
 *  AUTHORITATIVE read/write path stays the dedicated admissions-issuance
 *  route; this mirror only feeds the wizard's Modules step display. */
function parseAdmissionsFlag(settingsRaw: string | null | undefined): boolean {
  const parsed = safeParse(settingsRaw)
  return parsed.admissionsServerIssuance === true
}
