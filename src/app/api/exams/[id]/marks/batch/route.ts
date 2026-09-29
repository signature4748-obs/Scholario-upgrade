import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { setMarksBatchSchema } from '@/lib/exams/api-schemas'
import { setMarksBatch } from '@/lib/exams/service'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/batch  body: { marks: SetMarkInput[] }
// Response: { updated, errors: [{ index, studentId, message }] } — rejected
// rows (foreign student, CSA denial, locked marks, …) are REPORTED, never
// silently skipped (audit 3-b).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.marks.write' }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, setMarksBatchSchema)
    const result = await setMarksBatch(
      id,
      ctx.schoolId,
      ctx.user,
      body.marks.map((m) => ({
        classId: m.classId,
        subjectId: m.subjectId,
        studentId: m.studentId,
        marksObtained: m.marksObtained ?? null,
        status: m.status ?? 'PRESENT',
        remarks: m.remarks,
      })),
    )
    return result
  })
}
