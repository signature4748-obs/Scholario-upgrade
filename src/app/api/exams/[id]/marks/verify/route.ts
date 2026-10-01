import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { marksWorkflowFilterSchema } from '@/lib/exams/api-schemas'
import { verifyMarks } from '@/lib/exams/service'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/verify  body: { classId?, subjectId? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, marksWorkflowFilterSchema)
    const result = await verifyMarks(id, ctx.schoolId, ctx.user, {
      classId: body.classId,
      subjectId: body.subjectId,
    })
    // PIH-4a (audit-trail gap) — verifying marks is an office mutation on
    // the official record (same funnel/vocabulary as marks submit).
    await auditEvent({
      schoolId: ctx.schoolId,
      userId: ctx.user.id,
      action: 'MARKS_CHANGE',
      requestId,
      detail: `Marks verified for exam ${id} (${result.verified} rows)`,
    }).catch(() => {})
    return result
  })
}
