import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { publishHomework, closeHomework, archiveHomework, duplicateHomework, extendDeadline, reviewSubmission } from '@/lib/homework/service'

export const runtime = 'nodejs'

// POST /api/homework/[id]/action  body: { action: 'publish'|'close'|'archive'|'duplicate'|'extend'|'review', ... }
// 3-d audit: role gate 'school.homework.write' (P/M/T) + per-action
// ownership inside the service (creator / assigned teacher / class
// teacher / P-M) — a peer teacher can no longer publish, close, archive,
// duplicate, re-deadline or review another teacher's homework.
export function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.write' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    switch (body.action) {
      case 'publish':
        return await publishHomework(id, schoolId, ctx.user)
      case 'close':
        return await closeHomework(id, schoolId, ctx.user)
      case 'archive':
        return await archiveHomework(id, schoolId, ctx.user)
      case 'duplicate':
        return await duplicateHomework(id, schoolId, ctx.user)
      case 'extend':
        if (!body.newDueDate || !body.reason) throw new Error('newDueDate and reason are required')
        return await extendDeadline(id, schoolId, ctx.user, body.newDueDate, body.reason)
      case 'review':
        if (!body.submissionId) throw new Error('submissionId is required')
        return await reviewSubmission(id, body.submissionId, schoolId, ctx.user, {
          marks: body.marks,
          grade: body.grade,
          feedback: body.feedback,
          privateNote: body.privateNote,
          action: body.reviewAction || 'review',
        })
      default:
        throw new Error(`Unknown action: ${body.action}`)
    }
  }) as Promise<Response>
}
