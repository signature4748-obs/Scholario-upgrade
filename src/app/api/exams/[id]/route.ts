import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { getExam, updateExam, deleteExam } from '@/lib/exams/service'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    const { id } = await params
    const exam = await getExam(id, ctx.schoolId)
    if (!exam) throw new Error('NOT_FOUND')
    return exam
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const updated = await updateExam(id, ctx.schoolId, ctx.user, body)
    return updated
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id } = await params
    await deleteExam(id, ctx.schoolId, ctx.user)
    return { deleted: true }
  })
}
