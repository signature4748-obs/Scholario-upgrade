import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/admissions/applications/[id] — full application detail
 * (principal-only, tenant-scoped, flag-gated): the submitted payload
 * (canonical form data), the lifecycle event trail, the issued fee
 * snapshot (if any) and the ADVISORY duplicate-applicant check.
 *
 * Duplicate detection is advisory-only (H1-R2 §3): it surfaces other
 * applications in the SAME school that may describe the same applicant
 * (same first+last name with same dob, or the same guardian phone).
 * It NEVER blocks, mutates or deduplicates — siblings legitimately
 * share guardian emails and phones.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)
    const { id } = await params

    const application = await db.admissionApplication.findFirst({
      where: { id, schoolId },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        feeSnapshot: true,
      },
    })
    if (!application) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Application not found',
        internalDetail: 'applications GET: id missing or foreign tenant',
      })
    }

    // ── Advisory duplicate detection (same school only) ───────────────
    // Never an existence oracle across tenants: the query is scoped to
    // the caller's school and only surfaces matches to THIS applicant.
    const possibleDuplicates = await db.admissionApplication.findMany({
      where: {
        schoolId,
        id: { not: application.id },
        OR: [
          {
            applicantFirstName: application.applicantFirstName,
            applicantLastName: application.applicantLastName,
            ...(application.applicantDob ? { applicantDob: application.applicantDob } : {}),
          },
          ...(application.guardianPhone
            ? [{ guardianPhone: application.guardianPhone }]
            : []),
        ],
      },
      select: {
        id: true,
        status: true,
        className: true,
        section: true,
        applicantFirstName: true,
        applicantLastName: true,
        applicantDob: true,
        guardianPhone: true,
        submittedAt: true,
      },
      take: 10,
    })

    return {
      application: {
        id: application.id,
        status: application.status,
        academicYear: application.academicYear,
        classId: application.classId,
        className: application.className,
        section: application.section,
        applicantFirstName: application.applicantFirstName,
        applicantLastName: application.applicantLastName,
        applicantDob: application.applicantDob,
        applicantGender: application.applicantGender,
        guardianName: application.guardianName,
        guardianPhone: application.guardianPhone,
        guardianEmail: application.guardianEmail,
        submittedAt: application.submittedAt,
        reviewedAt: application.reviewedAt,
        decisionAt: application.decisionAt,
        decisionNotes: application.decisionNotes,
        rejectionReason: application.rejectionReason,
        enrolledAt: application.enrolledAt,
        enrolledStudentId: application.enrolledStudentId,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        payload: JSON.parse(application.payload),
      },
      events: application.events.map((e) => ({
        id: e.id,
        action: e.action,
        actorRole: e.actorRole,
        notes: e.notes,
        createdAt: e.createdAt,
      })),
      feeSnapshot: application.feeSnapshot
        ? {
            totalAmount: num(application.feeSnapshot.totalAmount),
            discountAmount: num(application.feeSnapshot.discountAmount),
            discountName: application.feeSnapshot.discountName,
            academicYear: application.feeSnapshot.academicYear,
            structureVersion: application.feeSnapshot.structureVersion,
            issuedAt: application.feeSnapshot.issuedAt,
            lineItems: JSON.parse(application.feeSnapshot.lineItems),
          }
        : null,
      duplicateAdvisory: {
        checked: true,
        possibleDuplicates: possibleDuplicates.map((d) => ({
          id: d.id,
          status: d.status,
          applicantName: `${d.applicantFirstName} ${d.applicantLastName}`.trim(),
          className: d.className,
          section: d.section,
          applicantDob: d.applicantDob,
          submittedAt: d.submittedAt,
        })),
      },
    }
  })
}
