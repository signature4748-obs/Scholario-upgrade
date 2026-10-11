import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/admissions/applications/[id]/fee-snapshot — the persisted
 * AdmissionFeeSnapshot (Phase E). THE authoritative fee statement for
 * official admission documents: issued atomically with enrolment,
 * immutable thereafter (later fee-structure edits never change it).
 *
 * Principal-only, tenant-scoped (fail-safe 404), flag-gated. The
 * response is the exact persisted content — line items, discount and
 * totals — never a recomputation.
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
      select: { id: true, status: true, enrolledStudentId: true, className: true, section: true, academicYear: true },
    })
    if (!application) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Application not found',
        internalDetail: 'fee-snapshot GET: application missing or foreign tenant',
      })
    }
    const snapshot = await db.admissionFeeSnapshot.findUnique({
      where: { applicationId: application.id },
    })
    if (!snapshot) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'No fee snapshot has been issued for this application yet.',
        internalDetail: 'fee-snapshot GET: no snapshot row',
      })
    }
    return {
      applicationId: application.id,
      status: application.status,
      studentId: snapshot.studentId,
      className: application.className,
      section: application.section,
      academicYear: snapshot.academicYear,
      structureId: snapshot.structureId,
      structureVersion: snapshot.structureVersion,
      discountName: snapshot.discountName,
      discountAmount: num(snapshot.discountAmount),
      totalAmount: num(snapshot.totalAmount),
      issuedAt: snapshot.issuedAt,
      lineItems: JSON.parse(snapshot.lineItems),
    }
  })
}
