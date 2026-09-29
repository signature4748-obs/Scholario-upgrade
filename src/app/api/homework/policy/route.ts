import { withAuthz } from '@/lib/security/authz'
import { listPolicies, updatePolicy } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// Homework policy (per-grade daily minutes caps) is a management control —
// 'school.homework.oversight' (P/M) on BOTH read and write.
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await listPolicies(schoolId)
  }) as Promise<Response>
}

export function PATCH(req: Request) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await req.json().catch(() => ({}))
    if (!body.id) throw new Error('Policy id required')
    if (body.maxMinutesPerDay !== undefined) {
      const max = Number(body.maxMinutesPerDay)
      if (!Number.isFinite(max) || !Number.isInteger(max) || max < 0 || max > 1440) {
        throw new Error('maxMinutesPerDay must be a whole number between 0 and 1440')
      }
    }
    // Tenant IDOR guard (3-d audit) lives inside updatePolicy.
    return await updatePolicy(schoolId, body.id, {
      maxMinutesPerDay: body.maxMinutesPerDay !== undefined ? Number(body.maxMinutesPerDay) : undefined,
      enabled: body.enabled,
    })
  }) as Promise<Response>
}
