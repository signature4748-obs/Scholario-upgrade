import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { setMarkSchema } from '@/lib/exams/api-schemas'
import { setMark } from '@/lib/exams/service'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/single  body: { classId, subjectId, studentId, marksObtained, status, remarks? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.marks.write' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, setMarkSchema)
    const mark = await setMark(id, ctx.schoolId, ctx.user, {
      classId: body.classId,
      subjectId: body.subjectId,
      studentId: body.studentId,
      marksObtained: body.marksObtained ?? null,
      status: body.status ?? 'PRESENT',
      remarks: body.remarks,
    })
    return mark
  })
}
