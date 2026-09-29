import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getAuditLogs } from '@/lib/homework/service'

export const runtime = 'nodejs'

// 3-d audit: the per-homework audit trail (who created/published/graded
// what and when) is oversight data — 'school.homework.oversight' (P/M),
// never exposed to teachers, students or parents.
export function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    return await getAuditLogs(id, schoolId)
  }) as Promise<Response>
}
