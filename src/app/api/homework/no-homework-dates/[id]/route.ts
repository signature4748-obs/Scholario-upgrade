import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { removeNoHomeworkDate } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

export function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    // Tenant IDOR guard (3-d audit) lives inside removeNoHomeworkDate:
    // deleteMany scoped to the caller's school; zero rows → 404.
    await removeNoHomeworkDate(schoolId, id)
    return { deleted: true }
  }) as Promise<Response>
}
