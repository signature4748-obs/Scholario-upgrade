import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listExams, createExam, getClasses } from '@/lib/exams/service'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  return withAuthz({ permission: 'exams.read' }, async (ctx) => {
    const school = await db.school.findUnique({ where: { id: ctx.schoolId }, select: { academicYear: true } })
    const exams = await listExams(ctx.schoolId)
    return { exams, classes: await getClasses(ctx.schoolId), academicYear: school?.academicYear ?? '2025-2026' }
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const body = await req.json().catch(() => ({}))
    const exam = await createExam(ctx.schoolId, ctx.user, body)
    return exam
  })
}
