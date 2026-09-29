import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getGradingAudit } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: per-student marks/grades/feedback audit — oversight data
// (P/M), previously readable by any student/parent account.
export function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const homeworkId = searchParams.get('homeworkId') || undefined
    return await getGradingAudit(schoolId, homeworkId)
  }) as Promise<Response>
}
