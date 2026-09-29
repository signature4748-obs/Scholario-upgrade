import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getResultsForClass } from '@/lib/exams/service'

export const runtime = 'nodejs'

// GET /api/exams/[id]/results/class/[classId]
// Full class result sheet (every student's marks, ranks, outcomes) —
// staff-only (audit 3-b HIGH). Students read their OWN declared rows via
// the self-scoped /api/results route.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; classId: string }> }
) {
  return withAuthz({ permission: 'exams.results.read' }, async (ctx) => {
    const { id, classId } = await params
    const result = await getResultsForClass(id, classId, ctx.schoolId)
    return result
  })
}
