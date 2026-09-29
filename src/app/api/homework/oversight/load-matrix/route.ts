import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getLoadMatrix } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: school-wide class-load matrix — oversight (P/M).
export function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') || undefined
    return await getLoadMatrix(schoolId, date)
  }) as Promise<Response>
}
