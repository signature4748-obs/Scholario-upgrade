import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listExamTypes, createExamType } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { examTypeCreateSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

// Exam type config — staff read (the exam-settings UI and the Fees module's
// exam-type picker both consume this); mutations are Principal/Management.
export async function GET() {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    return await listExamTypes(ctx.schoolId)
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const body = await parseJsonBody(req, examTypeCreateSchema)
    return await createExamType(ctx.schoolId, { name: body.name, code: body.code })
  })
}
