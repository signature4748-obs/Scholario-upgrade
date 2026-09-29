import { withAuthz } from '@/lib/security/authz'
import { getTeacherActivity } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: per-teacher activity feed (who created/published/graded) —
// staff-privacy oversight data, gated to PRINCIPAL/MANAGEMENT.
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getTeacherActivity(schoolId)
  }) as Promise<Response>
}
