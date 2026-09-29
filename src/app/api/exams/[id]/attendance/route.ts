import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { examAttendanceSchema } from '@/lib/exams/api-schemas'
import { markExamAttendance, getExamAttendance } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// Exam attendance register — staff-only (audit 3-b MEDIUM).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    const { id } = await params
    const url = new URL(req.url)
    const classId = url.searchParams.get('classId')
    const attendance = await getExamAttendance(id, classId, ctx.schoolId)
    return attendance
  })
}

// POST /api/exams/[id]/attendance  body: { scheduleItemId?, classId, studentId, subjectId?, date, status, remarks? }
// studentId/subjectId are tenant-verified inside markExamAttendance before any write.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.marks.write' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, examAttendanceSchema)
    const result = await markExamAttendance(id, ctx.schoolId, ctx.user, {
      scheduleItemId: body.scheduleItemId,
      classId: body.classId,
      studentId: body.studentId,
      subjectId: body.subjectId ?? '',
      date: body.date,
      status: body.status ?? 'PRESENT',
      remarks: body.remarks,
    })
    return result
  })
}
