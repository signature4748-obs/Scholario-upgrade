import { withAuthz } from '@/lib/security/authz'
import { getChronicNonSubmitters } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// 3-d audit: names named students who repeatedly miss submissions —
// PII-bearing oversight data, gated to PRINCIPAL/MANAGEMENT.
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await getChronicNonSubmitters(schoolId)
  }) as Promise<Response>
}
