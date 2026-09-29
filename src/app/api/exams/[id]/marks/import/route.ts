import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody } from '@/lib/security/validation'
import { importMarksSchema } from '@/lib/exams/api-schemas'
import { importMarksCsv } from '@/lib/exams/service-extended'

export const runtime = 'nodejs'

// POST /api/exams/[id]/marks/import  body: { classId, subjectId, rows: CsvImportRow[] }
// TEACHER callers are CSA-scoped inside importMarksCsv (they must be
// appointed to teach the addressed class+subject paper).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] }, async (ctx) => {
    const { id } = await params
    const body = await parseJsonBody(req, importMarksSchema)
    const result = await importMarksCsv(
      id,
      body.classId,
      body.subjectId,
      ctx.schoolId,
      ctx.user,
      body.rows.map((r) => ({
        rollNo: r.rollNo,
        studentName: r.studentName ?? '',
        marksObtained: r.marksObtained ?? null,
        status: r.status ?? 'PRESENT',
        remarks: r.remarks,
      })),
    )
    return result
  })
}
