import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { outcomeOverrideSchema } from '@/lib/exams/api-schemas'
import { overrideOutcome } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// PATCH /api/exams/[id]/outcomes/[studentId]  body: { outcome, reason?, notes? }
// studentId is tenant-verified inside overrideOutcome (school-scoped lookup).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id, studentId } = await params
    const body = await parseJsonBody(req, outcomeOverrideSchema)
    await overrideOutcome(id, studentId, ctx.schoolId, ctx.user, {
      outcome: body.outcome,
      reason: body.reason,
      notes: body.notes,
    })
    return { updated: true }
  })
}
