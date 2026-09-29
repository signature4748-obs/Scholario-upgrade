import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { getAuditLogs } from '@/lib/exams/service'

export const runtime = 'nodejs'

// Exam audit trail — Principal/Management only ('exams.audit.read').
// Phase 2 tenant semantics: foreign-school exam id → 404 (never empty 200).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'exams.audit.read' }, async (ctx) => {
    const { id } = await params
    const exam = await db.exam.findFirst({ where: { id, schoolId: ctx.schoolId }, select: { id: true } })
    if (!exam) throw new AppError('NOT_FOUND', { publicMessage: 'Exam not found', internalDetail: 'audit GET: exam missing or foreign tenant' })
    const logs = await getAuditLogs(id, ctx.schoolId)
    return logs
  })
}
