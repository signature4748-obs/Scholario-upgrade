import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { marksWorkflowFilterSchema } from '@/lib/exams/api-schemas'
import { submitMarks } from '@/lib/exams/service'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/submit  body: { classId?, subjectId? }
// TEACHER callers must address an exact (classId, subjectId) paper they
// are appointed to teach — enforced inside submitMarks (CSA scope).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  return withAuthz({ permission: 'exams.marks.submit' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, marksWorkflowFilterSchema)
    const result = await submitMarks(id, ctx.schoolId, ctx.user, {
      classId: body.classId,
      subjectId: body.subjectId,
    })
    // Phase 1 — marks changes are auditable security events.
    await auditEvent({
      schoolId: ctx.schoolId,
      userId: ctx.user.id,
      action: 'MARKS_CHANGE',
      requestId,
      detail: `Marks submitted for exam ${id}`,
    }).catch(() => {})
    return result
  })
}
