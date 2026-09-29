import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { seatingGenerateSchema } from '@/lib/exams/api-schemas'
import { generateSeatingPlan } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/seating/generate  body: { classId, rooms: [{name, capacity}] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, seatingGenerateSchema)
    const result = await generateSeatingPlan(id, body.classId, ctx.schoolId, ctx.user, body.rooms)
    return result
  })
}
