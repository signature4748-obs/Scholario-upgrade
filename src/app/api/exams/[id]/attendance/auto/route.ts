import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { z } from 'zod'
import { idSchema } from '@/lib/security/validation'
import { autoMarkAttendanceFromExamMarks } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/attendance/auto  body: { classId }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, z.object({ classId: idSchema }).strict())
    const result = await autoMarkAttendanceFromExamMarks(id, body.classId, ctx.schoolId, ctx.user)
    return result
  })
}
