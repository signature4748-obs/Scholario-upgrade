import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getSeatingPlan } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// Seating plan (student roster + room/seat assignment) — staff-only
// (audit 3-b MEDIUM).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    const { id } = await params
    const url = new URL(req.url)
    const classId = url.searchParams.get('classId')
    const seats = await getSeatingPlan(id, classId, ctx.schoolId)
    return seats
  })
}
