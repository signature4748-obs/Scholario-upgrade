import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody, idSchema } from '@/lib/security/validation'
import { computeAutoOutcomes } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/outcomes/compute  body: { classId }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, z.object({ classId: idSchema }).strict())
    const result = await computeAutoOutcomes(id, body.classId, ctx.schoolId)
    return result
  })
}
