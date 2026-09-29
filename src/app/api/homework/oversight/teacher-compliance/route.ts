import { withAuthz } from '@/lib/security/authz'
import { getTeacherCompliance } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: per-teacher grading-latency compliance report — oversight (P/M).
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getTeacherCompliance(schoolId)
  }) as Promise<Response>
}
