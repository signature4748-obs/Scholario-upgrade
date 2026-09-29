import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { getStudentsForClass, getMarksForSubject } from '@/lib/exams/service'

export const runtime = 'nodejs'

// GET /api/exams/[id]/marks?classId=&subjectId=
// Marks roster — staff-only (audit 3-b HIGH): STUDENT/PARENT readers get
// their declared results through the self-scoped /api/results route, never
// through the raw marks surface.
// Phase 2 tenant semantics: a foreign-school exam id fails safe with 404
// (never an empty 200 — the exam "does not exist" for this tenant).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.marks.read' }, async (ctx) => {
    const { id } = await params
    const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true } })
    if (!exam) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Exam not found', internalDetail: 'marks GET: exam missing or foreign tenant' })
    const url = new URL(req.url)
    const classId = url.searchParams.get('classId')
    const subjectId = url.searchParams.get('subjectId')
    if (!classId) throw new Error('classId is required')
    const students = await getStudentsForClass(classId, ctx.schoolId)
    const marks = subjectId ? await getMarksForSubject(id, classId, subjectId, ctx.schoolId) : []
    return { students, marks }
  })
}
