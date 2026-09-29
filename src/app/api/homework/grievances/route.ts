import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listGrievances } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: parent grievances carry parent/student names + free-text
// complaints — oversight data, gated to PRINCIPAL/MANAGEMENT
// ('school.homework.oversight').
export function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || undefined
    return await listGrievances(schoolId, status)
  }) as Promise<Response>
}
