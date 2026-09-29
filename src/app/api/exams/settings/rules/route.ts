import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listExamRules, updateManyExamRules } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { examRulesPutSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

// Exam rules (key-value school config) — staff read; writes are
// Principal/Management.
export async function GET() {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    return await listExamRules(ctx.schoolId)
  })
}

export async function PUT(req: NextRequest) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const body = await parseJsonBody(req, examRulesPutSchema)
    await updateManyExamRules(ctx.schoolId, body.rules)
    return { saved: true }
  })
}
