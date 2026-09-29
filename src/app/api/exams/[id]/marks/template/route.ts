import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/exams/[id]/marks/template?classId=&subjectId=
// Returns a CSV template for marks import — staff-only (audit 3-b MEDIUM).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.marks.read' }, async (ctx) => {
    const { id } = await params
    const url = new URL(req.url)
    const classId = url.searchParams.get('classId')!
    const subjectId = url.searchParams.get('subjectId')!

    if (!classId || !subjectId) throw new Error('classId and subjectId are required')

    // Validate exam + class
    const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId } })
    if (!exam) throw new Error('Exam not found')

    const subjectConfig = await db.examSubjectConfig.findFirst({
      where: { examId: id, classId, subjectId },
      include: { subject: true },
    })
    if (!subjectConfig) throw new Error('Subject not configured for this exam/class')

    // Get real students
    const students = await db.student.findMany({
      where: { classId, schoolId: ctx.schoolId },
      orderBy: { rollNo: 'asc' },
      include: { user: { select: { name: true } } },
    })

    // Build CSV
    const header = 'Roll Number,Student Name,Marks Obtained,Status,Remarks\n'
    const rows = students.map((s) => {
      const rollNo = (s.rollNo ?? '').replace(/"/g, '""')
      const name = (s.user?.name ?? '').replace(/"/g, '""')
      return `${rollNo},"${name}",,PRESENT,`
    }).join('\n')
    const csv = header + rows + '\n'

    return {
      csv,
      filename: `marks_template_${subjectConfig.subject.code ?? subjectConfig.subject.name}_${id}.csv`,
      maxMarks: subjectConfig.maxMarks,
      studentCount: students.length,
    }
  })
}
