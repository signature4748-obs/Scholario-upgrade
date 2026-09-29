import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { scheduleItemUpdateSchema } from '@/lib/exams/api-schemas'
import { updateScheduleItem, deleteScheduleItem } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// PATCH /api/exams/[id]/schedule/items/[itemId]
// The item is tenant-verified (exam.schoolId) inside updateScheduleItem.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id, itemId } = await params
    const body = await parseJsonBody(req, scheduleItemUpdateSchema)
    const item = await updateScheduleItem(id, itemId, ctx.schoolId, ctx.user, {
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      room: body.room,
      invigilatorId: body.invigilatorId,
      invigilatorName: body.invigilatorName,
    })
    return item
  })
}

// DELETE /api/exams/[id]/schedule/items/[itemId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id, itemId } = await params
    await deleteScheduleItem(id, itemId, ctx.schoolId, ctx.user)
    return { deleted: true }
  })
}
