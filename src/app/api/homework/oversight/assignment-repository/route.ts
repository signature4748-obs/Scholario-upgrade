import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getAssignmentRepository } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: quality-control oversight surface — 'school.homework.oversight'
// (P/M). Exposes every teacher's assignments across the school.
export function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    return await getAssignmentRepository(schoolId, {
      teacherId: searchParams.get('teacherId') || undefined,
      subjectId: searchParams.get('subjectId') || undefined,
      classId: searchParams.get('classId') || undefined,
      search: searchParams.get('search') || undefined,
    })
  }) as Promise<Response>
}
