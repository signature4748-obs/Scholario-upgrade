import { withAuthz } from '@/lib/security/authz'
import { getLowSubmissionAlerts } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: per-class submission shortfalls — oversight (P/M).
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getLowSubmissionAlerts(schoolId)
  }) as Promise<Response>
}
