import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { graceMarksSchema } from '@/lib/exams/api-schemas'
import { applyGraceMarks } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/grace  body: { markId, graceMarks, reason }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, graceMarksSchema)
    const result = await applyGraceMarks(id, ctx.schoolId, ctx.user, {
      markId: body.markId,
      graceMarks: body.graceMarks,
      reason: body.reason,
    })
    return result
  })
}
