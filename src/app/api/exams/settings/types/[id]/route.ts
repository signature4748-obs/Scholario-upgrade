import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { updateExamType, deleteExamType } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { examTypeUpdateSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

// PATCH/DELETE are tenant-scoped inside the settings-service: a foreign
// school's ExamTypeConfig id 404s instead of mutating (audit 3-b CRITICAL).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, examTypeUpdateSchema)
    return await updateExamType(ctx.schoolId, id, {
      name: body.name,
      code: body.code,
      enabled: body.enabled,
    })
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const { id } = await params
    await deleteExamType(ctx.schoolId, id)
    return { deleted: true }
  })
}
