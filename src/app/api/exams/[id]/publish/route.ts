import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { publishResultsSchema } from '@/lib/exams/api-schemas'
import { publishResults } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/publish  body: { notifyStudents?, notifyParents? }
// Result publication fans out ONE school-wide STUDENTS notification (plus
// optionally ONE PARENTS notification) — see service-extended publishResults.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, publishResultsSchema)
    const result = await publishResults(id, ctx.schoolId, ctx.user, {
      notifyStudents: body.notifyStudents,
      notifyParents: body.notifyParents,
    })
    return result
  })
}
