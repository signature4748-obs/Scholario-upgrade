import { withAuthz } from '@/lib/security/authz'
import { getSubjectDistribution } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: school-wide subject workload distribution — oversight (P/M).
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getSubjectDistribution(schoolId)
  }) as Promise<Response>
}
