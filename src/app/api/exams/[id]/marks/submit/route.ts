import { NextRequest } from 'next/server'
import { withUser, schoolScoped } from '@/lib/api'
import { submitMarks } from '@/lib/exams/service'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/submit  body: { classId?, subjectId? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const result = await submitMarks(id, schoolId, user, {
        classId: body.classId,
        subjectId: body.subjectId,
      })
      // Phase 1 — marks changes are auditable security events.
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'MARKS_CHANGE',
        requestId,
        detail: `Marks submitted for exam ${id}`,
      }).catch(() => {})
      return result
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] }
  )
}
