import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { requireSchoolAcademicYear, normalizeAcademicYear } from '@/lib/admissions/academic-year'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { canonicalPayloadHash, canonicalPayloadJson } from '@/lib/admissions/canonical-payload'

export const runtime = 'nodejs'

/**
 * FEE-ADMISSIONS MVP — server-owned admission applications (Phase C).
 *
 * POST /api/admissions/applications — submit an application with a
 * per-school UUID idempotency key (clientRequestId):
 *   · same key + same canonical payload  → 200 replay of the EXISTING
 *     application (idempotentReplay: true — never a duplicate, never an
 *     overwrite);
 *   · same key + different payload       → 409 IDEMPOTENCY_KEY_REUSED;
 *   · same key in another school         → independent application.
 *
 * The payload mirrors the existing admission form contract
 * (AdmissionFormData — guardian emails are CONTACT data, the student
 * login email is NOT collected here; it is required at enrolment).
 * Duplicate-applicant detection is ADVISORY (review-time, GET detail) —
 * siblings may share guardian emails without blocking each other.
 *
 * PRINCIPAL-only (v1: the principal operates the office desk); tenant
 * from the session; feature-flagged OFF by default.
 */

const uuidSchema = z.string().uuid()

const formDataCore = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  className: z.string().trim().min(1).max(80),
})

const submissionSchema = z.object({
  clientRequestId: uuidSchema,
  classId: z.string().min(1).max(64).optional(),
  section: z.string().max(40).optional(),
  academicYear: z.string().max(20).optional(),
  formData: formDataCore.passthrough(),
  feeSelections: z
    .object({
      optionalHeadIds: z.array(z.string().max(64)).max(60).optional(),
      quantities: z.record(z.string().max(64), z.number().int().min(1).max(99)).optional(),
      discountCode: z.string().max(64).optional(),
    })
    .optional(),
})

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)

    // Canonical academic year — the SCHOOL's row is the authority; a
    // body-provided year is accepted only when it normalizes to the
    // same value (fail-closed otherwise — conflicting years are never
    // silently reconciled).
    const schoolYear = await requireSchoolAcademicYear(schoolId)

    let body: z.infer<typeof submissionSchema>
    try {
      body = submissionSchema.parse(await req.json().catch(() => ({})))
    } catch (e) {
      const issues = e instanceof z.ZodError ? e.issues : []
      throw new AppError('INVALID_INPUT', {
        publicMessage:
          issues.some((i) => i.path.includes('clientRequestId'))
            ? 'A valid submission reference (clientRequestId UUID) is required.'
            : 'The application form is incomplete (first name, last name and class are required).',
        internalDetail: `applications POST: validation failed (${issues.map((i) => i.path.join('.')).slice(0, 5).join(', ')})`,
      })
    }

    if (body.academicYear) {
      const normalized = normalizeAcademicYear(body.academicYear)
      if (normalized !== schoolYear) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `The academic year on the form (${body.academicYear}) does not match your school's active year (${schoolYear}).`,
          internalDetail: 'applications POST: academic year conflict with school row',
        })
      }
    }

    // ── Idempotency replay / rejection ─────────────────────────────────
    const canonical = {
      formData: body.formData,
      feeSelections: body.feeSelections ?? {},
      classId: body.classId ?? null,
      section: body.section ?? null,
      className: body.formData.className,
    }
    const payloadHash = canonicalPayloadHash(canonical)

    const existing = await db.admissionApplication.findUnique({
      where: { schoolId_clientRequestId: { schoolId, clientRequestId: body.clientRequestId } },
    })
    if (existing) {
      if (existing.payloadHash === payloadHash) {
        // Deterministic replay — the exact same submission (e.g. a
        // network retry). Return the original application untouched.
        return { application: projectApplication(existing), idempotentReplay: true }
      }
      throw new AppError('IDEMPOTENCY_KEY_REUSED', {
        internalDetail: `applications POST: key ${body.clientRequestId.slice(0, 8)}… reused with a different payload`,
      })
    }

    // ── Class FK in-tenant (when provided) ────────────────────────────
    if (body.classId) {
      const cls = await db.class.findFirst({
        where: { id: body.classId, schoolId },
        select: { id: true, name: true },
      })
      if (!cls) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Class not found',
          internalDetail: 'applications POST: classId missing or foreign tenant',
        })
      }
    }

    // ── Create the application (SUBMITTED) ────────────────────────────
    const fd = body.formData
    const application = await db.admissionApplication.create({
      data: {
        schoolId,
        clientRequestId: body.clientRequestId,
        status: 'SUBMITTED',
        academicYear: schoolYear,
        classId: body.classId ?? null,
        className: body.formData.className,
        section: body.section ?? null,
        applicantFirstName: fd.firstName.trim(),
        applicantLastName: fd.lastName.trim(),
        applicantDob: typeof fd.dob === 'string' ? fd.dob : null,
        applicantGender: typeof fd.gender === 'string' ? fd.gender : null,
        // The admission form collects NO applicant login/contact email
        // (guardian emails are contact data only — H1-R2 §3). The
        // student's login email is collected explicitly at enrolment.
        applicantEmail: null,
        guardianName:
          typeof fd.fatherName === 'string' && fd.fatherName
            ? fd.fatherName
            : typeof fd.motherName === 'string' && fd.motherName
              ? fd.motherName
              : null,
        guardianPhone:
          typeof fd.fatherPhone === 'string' && fd.fatherPhone
            ? fd.fatherPhone
            : typeof fd.motherPhone === 'string'
              ? fd.motherPhone
              : null,
        guardianEmail:
          typeof fd.fatherEmail === 'string' && fd.fatherEmail
            ? fd.fatherEmail
            : typeof fd.motherEmail === 'string'
              ? fd.motherEmail
              : null,
        payload: canonicalPayloadJson(canonical),
        payloadHash,
        submittedAt: new Date(),
      },
    })
    await db.admissionApplicationEvent.create({
      data: {
        schoolId,
        applicationId: application.id,
        action: 'SUBMITTED',
        actorUserId: ctx.user.id,
        actorRole: ctx.role,
        notes: `Submitted for ${body.formData.className}${body.section ? ` (${body.section})` : ''}`,
      },
    })
    return { application: projectApplication(application), idempotentReplay: false }
  })
}

/// GET /api/admissions/applications?status=SUBMITTED&classId=…
/// List the school's applications (principal-only; payload omitted —
/// fetch the detail route for the full form data).
export async function GET(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const classId = searchParams.get('classId')
    const applications = await db.admissionApplication.findMany({
      where: {
        schoolId,
        ...(status ? { status } : {}),
        ...(classId ? { classId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { feeSnapshot: { select: { totalAmount: true } } },
    })
    return applications.map((a) => ({
      ...projectApplication(a),
      feeSnapshotTotal: a.feeSnapshot ? Number(a.feeSnapshot.totalAmount) : null,
    }))
  })
}

/** Public projection — the payload blob and hashes stay internal. */
function projectApplication(a: {
  id: string
  status: string
  academicYear: string
  classId: string | null
  className: string
  section: string | null
  applicantFirstName: string
  applicantLastName: string
  applicantDob: string | null
  applicantGender: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  submittedAt: Date | null
  reviewedAt: Date | null
  decisionAt: Date | null
  decisionNotes: string | null
  rejectionReason: string | null
  enrolledAt: Date | null
  enrolledStudentId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: a.id,
    status: a.status,
    academicYear: a.academicYear,
    classId: a.classId,
    className: a.className,
    section: a.section,
    applicantName: `${a.applicantFirstName} ${a.applicantLastName}`.trim(),
    applicantDob: a.applicantDob,
    applicantGender: a.applicantGender,
    guardianName: a.guardianName,
    guardianPhone: a.guardianPhone,
    guardianEmail: a.guardianEmail,
    submittedAt: a.submittedAt,
    reviewedAt: a.reviewedAt,
    decisionAt: a.decisionAt,
    decisionNotes: a.decisionNotes,
    rejectionReason: a.rejectionReason,
    enrolledAt: a.enrolledAt,
    enrolledStudentId: a.enrolledStudentId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}
