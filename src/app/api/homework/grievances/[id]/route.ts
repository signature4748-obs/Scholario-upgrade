import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { resolveGrievance } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

const GRIEVANCE_RESOLUTION_STATUSES = ['resolved', 'dismissed'] as const

export function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const response = typeof body.response === 'string' ? body.response.trim() : ''
    if (!response) throw new Error('Response required')
    if (response.length > 2000) throw new Error('Response must be at most 2000 characters')
    // Whitelist the terminal status (the service type only accepts
    // resolved|dismissed — anything else from the client is coerced safely).
    const status = (GRIEVANCE_RESOLUTION_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as 'resolved' | 'dismissed')
      : 'resolved'
    // Tenant IDOR guard (3-d audit) lives inside resolveGrievance: a
    // foreign-school grievance id is a 404, never a write.
    return await resolveGrievance(schoolId, id, ctx.user, response, status)
  }) as Promise<Response>
}
