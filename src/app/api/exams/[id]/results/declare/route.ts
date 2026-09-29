import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { declareResults } from '@/lib/exams/service'

export const runtime = 'nodejs'

// POST /api/exams/[id]/results/declare
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const result = await declareResults(id, ctx.schoolId, ctx.user)
    return result
  })
}
