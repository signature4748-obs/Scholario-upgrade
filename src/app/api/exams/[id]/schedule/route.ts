import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { scheduleItemSchema } from '@/lib/exams/api-schemas'
import { addScheduleItem } from '@/lib/exams/service'

export const runtime = 'nodejs'

// POST /api/exams/[id]/schedule  body: { classId, subjectId, date, startTime, endTime, room?, invigilatorName? }
// classId/subjectId are tenant-verified (school + exam membership) inside
// addScheduleItem before any ExamScheduleItem row is created.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const data = await parseJsonBody(req, scheduleItemSchema)
    const item = await addScheduleItem(id, ctx.schoolId, ctx.user, {
      classId: data.classId,
      subjectId: data.subjectId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      room: data.room,
      invigilatorName: data.invigilatorName,
    })
    return item
  })
}
