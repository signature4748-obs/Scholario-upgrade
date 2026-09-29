import { withAuthz } from '@/lib/security/authz'
import { listNoHomeworkDates, addNoHomeworkDate } from '@/lib/homework/oversight-service'

export const runtime = 'nodejs'

// No-homework calendar dates are a school management control —
// 'school.homework.oversight' (P/M) on read and write.
export function GET() {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    return await listNoHomeworkDates(schoolId)
  }) as Promise<Response>
}

export function POST(req: Request) {
  return withAuthz({ permission: 'school.homework.oversight' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await req.json().catch(() => ({}))
    if (!body.date) throw new Error('Date required')
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined
    return await addNoHomeworkDate(schoolId, body.date, reason)
  }) as Promise<Response>
}
