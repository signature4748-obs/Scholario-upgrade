import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getAdmitCardConfig, updateAdmitCardConfig } from '@/lib/exams/settings-service'
import { parseJsonBody } from '@/lib/security/validation'
import { admitCardConfigSchema } from '@/lib/exams/api-schemas'

export const runtime = 'nodejs'

export async function GET() {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    return await getAdmitCardConfig(ctx.schoolId)
  })
}

export async function PUT(req: NextRequest) {
  return withAuthz({ permission: 'exams.settings.write' }, async (ctx) => {
    const body = await parseJsonBody(req, admitCardConfigSchema)
    return await updateAdmitCardConfig(ctx.schoolId, body)
  })
}
