import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/profile-change-requests — the tenant's
 * legal-identity change requests (school name / code / affiliation).
 * Read access for the platform review workflow (schools.manage).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async () => {
    const rows = await db.schoolProfileChangeRequest.findMany({
      where: { schoolId: id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    })
    const school = await db.school.findUnique({
      where: { id },
      select: { name: true, code: true, affiliation: true },
    })
    return {
      school: school ? { name: school.name, code: school.code, affiliation: school.affiliation } : null,
      requests: rows.map((r) => ({
        id: r.id,
        field: r.field,
        currentValue: r.currentValue,
        requestedValue: r.requestedValue,
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
        requestedById: r.requestedById,
        reviewedById: r.reviewedById,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })
}
