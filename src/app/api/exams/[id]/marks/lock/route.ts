import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { marksWorkflowFilterSchema } from '@/lib/exams/api-schemas'
import { lockMarks } from '@/lib/exams/service'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/lock  body: { classId?, subjectId? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, marksWorkflowFilterSchema)
    const result = await lockMarks(id, ctx.schoolId, ctx.user, {
      classId: body.classId,
      subjectId: body.subjectId,
    })
    return result
  })
}
