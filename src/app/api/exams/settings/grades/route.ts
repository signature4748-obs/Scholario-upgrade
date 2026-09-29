import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listGradeScales, createGradeScale } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { gradeScaleCreateSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

// Grade scales — staff read; mutations are Principal/Management.
export async function GET() {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    return await listGradeScales(ctx.schoolId)
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const body = await parseJsonBody(req, gradeScaleCreateSchema)
    return await createGradeScale(ctx.schoolId, {
      grade: body.grade,
      minPct: body.minPct,
      maxPct: body.maxPct,
      color: body.color,
    })
  })
}
