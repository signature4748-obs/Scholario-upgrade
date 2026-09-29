import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { updateGradeScale, deleteGradeScale } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { gradeScaleUpdateSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

// PATCH/DELETE are tenant-scoped inside the settings-service: a foreign
// school's GradeScale id 404s instead of mutating (audit 3-b CRITICAL).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, gradeScaleUpdateSchema)
    return await updateGradeScale(ctx.schoolId, id, {
      grade: body.grade,
      minPct: body.minPct,
      maxPct: body.maxPct,
      color: body.color,
    })
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const { id } = await params
    await deleteGradeScale(ctx.schoolId, id)
    return { deleted: true }
  })
}
