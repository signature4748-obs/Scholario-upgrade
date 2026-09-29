import { withAuthz } from '@/lib/security/authz'
import { getComplianceMetrics } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: school-wide compliance metrics (submission rates, teacher
// compliance, pending grievances) — oversight (P/M).
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getComplianceMetrics(schoolId)
  }) as Promise<Response>
}
