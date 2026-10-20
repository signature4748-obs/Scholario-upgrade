import { withPlatform } from '@/lib/platform/authz'
import { aggregateSchoolUsage, schoolApiOperationSeries, usageDateBucket } from '@/lib/ops/usage-meter'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/school-usage — per-school usage over a
 * date range (default: last 7 days; max 90). Cross-tenant by design →
 * ops.read only. `schoolId` restricts to one school (drill-down) and
 * adds the apiOperations daily series for the chart.
 *
 * HONESTY NOTE (returned with every response): per-school metrics are
 * APP-MEASURED (logins, api operations, emails, uploads, active users).
 * Shared provider usage (bandwidth, compute) is NOT attributed per
 * school — it is reported at platform level in the Usage tab.
 */
export async function GET(req: Request) {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const url = new URL(req.url)
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 7)))
    const schoolId = url.searchParams.get('schoolId')

    const to = usageDateBucket(new Date())
    const from = usageDateBucket(new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000))

    const rows = await aggregateSchoolUsage({ from, to, schoolId })

    let series: Array<{ date: string; apiOperations: number }> = []
    let schoolMeta: { name: string; status: string; plan: string | null } | null = null
    if (schoolId) {
      series = await schoolApiOperationSeries(schoolId, from, to)
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { name: true, status: true, subscription: { select: { plan: true } } },
      })
      if (school) {
        schoolMeta = { name: school.name, status: school.status, plan: school.subscription?.plan ?? null }
      }
    }

    return {
      window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
      schoolId,
      schoolMeta,
      rows: rows.sort((a, b) => b.apiOperations - a.apiOperations),
      series,
      attributionNote:
        'All metrics here are measured by the application itself (server-derived tenant attribution). Shared provider usage (Vercel bandwidth, Supabase compute, storage egress) CANNOT be attributed per school — see the Usage & Limits tab for platform-level provider metrics.',
      definitions: {
        apiOperations: 'Authenticated business-API requests metered server-side (atomic daily counter).',
        activeUsers: 'Distinct authenticated users seen in the window (SchoolActiveUserDay).',
        dau: 'Distinct users on the most recent day with recorded activity.',
        mau: 'Distinct users in the last 30 days.',
        logins: 'ActivityLog LOGIN_SUCCESS count.',
        failedLogins: 'ActivityLog LOGIN_FAILED + expired-credential refusals.',
        loginLockouts: 'ActivityLog LOGIN_LOCKED + rate-blocked attempts.',
        emailsAttempted: 'EmailDelivery rows created (any status) in the window.',
        emailsAccepted: '… status QUEUED (provider 2xx — delivery unconfirmed).',
        emailsDelivered: '… status SENT (delivery evidence — never assumed from acceptance).',
        emailsFailed: '… status FAILED/BOUNCED/COMPLAINED.',
        uploads: 'UploadedFile rows; uploadBytes = sum of stored sizes.',
      },
    }
  })
}
