import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getOutcomes } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// Promotion/compartment outcomes — staff-only (audit 3-b HIGH): outcomes are
// administrative records; students receive their declared results via the
// self-scoped /api/results route.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.results.read' }, async (ctx) => {
    const { id } = await params
    const url = new URL(req.url)
    const classId = url.searchParams.get('classId')
    const outcomes = await getOutcomes(id, classId, ctx.schoolId)
    return outcomes
  })
}
