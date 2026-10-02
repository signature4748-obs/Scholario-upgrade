/**
 * PHASE 8C (mission §12) — school setup-readiness computation, shared by:
 *   · GET /api/platform/schools/[id]/setup-readiness (platform console)
 *   · GET /api/school/setup-readiness (the principal's own school)
 *
 * THE CONTRACT: every section is COMPUTED from the live database (counts
 * + column presence), never self-reported by the client and never
 * fabricated. A newly provisioned school honestly shows zero-progress
 * sections; a configured school shows what actually exists. PENDING
 * schools are never "usable" regardless of content (the lifecycle gate
 * is activation, audited on the platform side).
 *
 * Read-only by design: provisioning/configuration happen through their
 * own audited routes; this module only OBSERVES state.
 */
import { db } from '@/lib/db'

export interface SetupSection {
  id: string
  label: string
  required: boolean
  done: boolean
  detail: string
  counts: Record<string, number>
}

export interface SetupSummary {
  requiredTotal: number
  requiredDone: number
  requiredComplete: boolean
  optionalDone: number
  optionalTotal: number
  /** ACTIVE + every required section done. */
  usable: boolean
}

export interface SetupReadiness {
  school: { id: string; name: string; status: string }
  sections: SetupSection[]
  summary: SetupSummary
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Compute the full readiness document for one school. ONE batched round
 * of live counts (grouped where the model allows) + one school read.
 */
export async function computeSetupReadiness(schoolId: string): Promise<SetupReadiness | null> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      status: true,
      // identity completeness
      address: true,
      city: true,
      phone: true,
      email: true,
      website: true,
      principalName: true,
      // branding
      logoUrl: true,
      faviconUrl: true,
      shortName: true,
      tagline: true,
      // academic
      academicYear: true,
      // website CMS
      websiteContent: true,
      // domain
      domain: true,
    },
  })
  if (!school) return null

  const [
    classCount,
    subjectCount,
    teacherCount,
    studentCount,
    roomCount,
    feeStructureCount,
    feeCount,
    examCount,
    timetableCount,
    announcementCount,
    principalCount,
    domainCount,
  ] = await Promise.all([
    db.class.count({ where: { schoolId } }),
    db.subject.count({ where: { schoolId } }),
    db.teacher.count({ where: { schoolId } }),
    db.student.count({ where: { schoolId } }),
    db.room.count({ where: { schoolId } }),
    db.feeStructure.count({ where: { schoolId } }),
    db.fee.count({ where: { schoolId } }),
    db.exam.count({ where: { schoolId } }),
    db.timetable.count({ where: { schoolId } }),
    db.notification.count({ where: { schoolId, status: 'PUBLISHED' } }),
    db.user.count({ where: { schoolId, role: 'PRINCIPAL', status: 'ACTIVE' } }),
    db.tenantDomain.count({ where: { schoolId, status: 'VERIFIED' } }),
  ])

  const identityFields = [
    school.address,
    school.city,
    school.phone,
    school.email,
    school.website,
    school.principalName,
  ]
  const identitySet = identityFields.filter(Boolean).length
  const brandingSet = [school.logoUrl, school.faviconUrl, school.shortName, school.tagline].filter(
    Boolean,
  ).length
  const hasCustomBrand = brandingSet > 0
  const websiteContent: Record<string, unknown> = safeParseJson(school.websiteContent)
  const websiteKeys = Object.keys(websiteContent).filter((k) => websiteContent[k] != null)
  const hasDomain = domainCount > 0 || Boolean(school.domain)

  const sections: SetupSection[] = [
    {
      id: 'identity',
      label: 'Identity',
      required: true,
      done: true, // name/slug/code exist by construction post-provision
      detail: `${identitySet}/6 contact fields · ${school.status}`,
      counts: { contactFields: identitySet, contactTotal: 6 },
    },
    {
      id: 'principal',
      label: 'Principal',
      required: true,
      done: principalCount > 0,
      detail: principalCount > 0 ? 'active principal account' : 'no principal account',
      counts: { principals: principalCount },
    },
    {
      id: 'branding',
      label: 'Branding',
      required: false,
      done: hasCustomBrand,
      detail: hasCustomBrand ? `${brandingSet}/4 brand assets` : 'defaults in use',
      counts: { brandAssets: brandingSet, brandTotal: 4 },
    },
    {
      id: 'academic',
      label: 'Academic setup',
      required: true,
      done: (school.academicYear ? 1 : 0) + classCount > 0,
      detail: `${school.academicYear ?? 'no session'} · ${classCount} classes · ${subjectCount} subjects`,
      counts: { classes: classCount, subjects: subjectCount },
    },
    {
      id: 'people',
      label: 'People',
      required: true,
      done: teacherCount > 0 && studentCount > 0,
      detail: `${teacherCount} teachers · ${studentCount} students`,
      counts: { teachers: teacherCount, students: studentCount },
    },
    {
      id: 'rooms',
      label: 'Rooms',
      required: false,
      done: roomCount > 0,
      detail: `${roomCount} rooms`,
      counts: { rooms: roomCount },
    },
    {
      id: 'fees',
      label: 'Fees',
      required: true,
      done: feeStructureCount > 0 || feeCount > 0,
      detail: `${feeStructureCount} structures · ${feeCount} student fees`,
      counts: { feeStructures: feeStructureCount, fees: feeCount },
    },
    {
      id: 'exams',
      label: 'Examinations',
      required: false,
      done: examCount > 0,
      detail: `${examCount} exams`,
      counts: { exams: examCount },
    },
    {
      id: 'timetable',
      label: 'Timetable',
      required: false,
      done: timetableCount > 0,
      detail: `${timetableCount} slots`,
      counts: { timetableSlots: timetableCount },
    },
    {
      id: 'website',
      label: 'Website',
      required: false,
      done: websiteKeys.length > 0 || announcementCount > 0,
      detail: `${websiteKeys.length} content sections · ${announcementCount} published announcements`,
      counts: { contentSections: websiteKeys.length, announcements: announcementCount },
    },
    {
      id: 'domain',
      label: 'Domain',
      required: false,
      done: hasDomain,
      detail: hasDomain ? 'custom domain connected' : 'default tenant URL',
      counts: { verifiedDomains: domainCount },
    },
  ]

  const requiredSections = sections.filter((s) => s.required)
  const completedRequired = requiredSections.filter((s) => s.done).length

  return {
    school: { id: school.id, name: school.name, status: school.status },
    sections,
    summary: {
      requiredTotal: requiredSections.length,
      requiredDone: completedRequired,
      requiredComplete: completedRequired === requiredSections.length,
      optionalDone: sections.filter((s) => !s.required && s.done).length,
      optionalTotal: sections.filter((s) => !s.required).length,
      // PENDING schools are not usable regardless of content readiness.
      usable: school.status === 'ACTIVE' && completedRequired === requiredSections.length,
    },
  }
}
