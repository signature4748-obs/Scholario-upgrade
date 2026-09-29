import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { getHomework, updateHomework, deleteHomework, getSubmissions } from '@/lib/homework/service'

export const runtime = 'nodejs'

// 3-d audit role gates: 'school.homework.read' (P/M/T) — no student client
// surface consumes this route (grep-verified), so DRAFT homework and other
// teachers' submission payloads (responseText/marks/feedback/privateNote)
// can never reach a STUDENT/PARENT account.
// Phase 2 tenant semantics: a foreign-school homework id fails safe with
// 404 — never a null/empty 200 (the row "does not exist" for this tenant).
export function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.read' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const include = searchParams.get('include')

    if (include === 'submissions') {
      const [homework, submissions] = await Promise.all([
        getHomework(id, schoolId),
        getSubmissions(id, schoolId),
      ])
      if (!homework) throw new AppError('NOT_FOUND', { publicMessage: 'Homework not found', internalDetail: 'homework GET: missing or foreign tenant' })
      return { homework, submissions }
    }
    const homework = await getHomework(id, schoolId)
    if (!homework) throw new AppError('NOT_FOUND', { publicMessage: 'Homework not found', internalDetail: 'homework GET: missing or foreign tenant' })
    return homework
  }) as Promise<Response>
}

export function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.write' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    // Ownership (creator / assigned teacher / class teacher) is enforced
    // inside updateHomework — a peer teacher cannot edit another's row.
    return await updateHomework(id, schoolId, ctx.user, body)
  }) as Promise<Response>
}

// Delete cascades submissions + audit rows — PRINCIPAL/MANAGEMENT only
// (school.homework.oversight); the service re-checks the role fail-closed.
export function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    await deleteHomework(id, schoolId, ctx.user)
    return { deleted: true }
  }) as Promise<Response>
}
