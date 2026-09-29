import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { invigilatorAssignSchema } from '@/lib/exams/api-schemas'
import { listTeachers, assignInvigilator } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// Teacher directory for invigilator assignment — staff-only (audit 3-b MEDIUM).
export async function GET(
  _req: NextRequest,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    const teachers = await listTeachers(ctx.schoolId)
    return teachers
  })
}

// POST /api/exams/[id]/invigilator  body: { scheduleItemId, teacherId }
// teacherId = null → release the assigned invigilator from that paper.
// Assigning creates a direct Message notification for the teacher (their
// "Examination duty" preference is honored server-side).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, invigilatorAssignSchema)
    const teacherId = body.teacherId && body.teacherId !== '' ? body.teacherId : null
    const result = await assignInvigilator(id, body.scheduleItemId, ctx.schoolId, ctx.user, teacherId)
    return result
  })
}
