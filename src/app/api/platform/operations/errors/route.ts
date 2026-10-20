import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/errors — error GROUP list with filters
 * + cursor pagination. Filters: range (hours), severity, category,
 * status, schoolId, provider, route contains, statusCode. Permission:
 * ops.read (cross-tenant view is root/admin-only by design).
 */
export async function GET(req: Request) {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const url = new URL(req.url)
    const hours = Math.min(90 * 24, Math.max(1, Number(url.searchParams.get('hours') ?? 24 * 7)))
    const severity = url.searchParams.get('severity') // warning|error|critical
    const category = url.searchParams.get('category')
    const status = url.searchParams.get('status') // open|acknowledged|resolved|all
    const schoolId = url.searchParams.get('schoolId')
    const provider = url.searchParams.get('provider')
    const routeQ = url.searchParams.get('route')?.slice(0, 120) ?? null
    const statusCode = url.searchParams.get('statusCode')
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get('limit') ?? 20)))

    const where: Prisma.OperationalErrorWhereInput = {
      lastSeenAt: { gte: new Date(Date.now() - hours * 60 * 60 * 1000) },
    }
    if (severity) where.severity = severity
    if (category) where.category = category
    if (status && status !== 'all') where.status = status
    if (schoolId) where.schoolId = schoolId
    if (provider) where.provider = provider
    if (routeQ) where.lastRoute = { contains: routeQ }
    if (statusCode) where.lastStatusCode = Number(statusCode)

    const [rows, total] = await Promise.all([
      db.operationalError.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          fingerprint: true,
          category: true,
          severity: true,
          status: true,
          env: true,
          message: true,
          lastRoute: true,
          lastMethod: true,
          lastStatusCode: true,
          provider: true,
          schoolId: true,
          requestId: true,
          firstSeenAt: true,
          lastSeenAt: true,
          occurrences: true,
        },
      }),
      db.operationalError.count({ where }),
    ])

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)

    // School names for attribution display (ids only in the error rows).
    const schoolIds = [...new Set(page.map((r) => r.schoolId).filter((v): v is string => Boolean(v)))]
    const schools = schoolIds.length
      ? await db.school.findMany({
          where: { id: { in: schoolIds } },
          select: { id: true, name: true },
        })
      : []
    const schoolNames = new Map(schools.map((s) => [s.id, s.name]))

    return {
      groups: page.map((r) => ({
        ...r,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        schoolName: r.schoolId ? (schoolNames.get(r.schoolId) ?? null) : null,
      })),
      total,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      filterEcho: { hours, severity, category, status, schoolId, provider, route: routeQ, statusCode },
    }
  })
}
