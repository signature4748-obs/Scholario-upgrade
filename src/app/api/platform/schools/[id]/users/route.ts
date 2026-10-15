import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { AppError } from '@/lib/security/errors'
import { parseQuery } from '@/lib/security/validation'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().max(120).optional(),
  role: z
    .enum(['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'STUDENT', 'PARENT', 'SUPER_ADMIN'])
    .optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).optional(),
})

/**
 * GET /api/platform/schools/[id]/users — the tenant-scoped user
 * administration roster for the school workspace's "Users & Access" tab.
 *
 * READ-ONLY by design: status changes, credential re-issue and access
 * resets each happen through their own audited routes (danger zone,
 * reissue-credential, support sessions). This surface only OBSERVES
 * who holds an account on the tenant — with the honest credential /
 * lock state the platform already tracks.
 *
 * Tenant isolation: the school id is re-verified server-side and every
 * query filters by schoolId. Platform-plane accounts (schoolId NULL)
 * are never listed here — they live in the Users console.
 *
 * Permission: schools.read.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, code: true, status: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
    }

    const query = parseQuery(req, querySchema)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25

    const where: Record<string, unknown> = { schoolId: school.id }
    if (query.role) where.role = query.role
    if (query.status) where.status = query.status
    if (query.q) {
      const q = query.q.trim()
      where.OR = [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
      ]
    }

    const [users, total, roleCounts, liveSessions] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          subscriptionStatus: true,
          mustChangePassword: true,
          passwordChangedAt: true,
          lastLoginAt: true,
          createdAt: true,
          sessions: { where: { expiresAt: { gt: new Date() } }, select: { id: true } },
        },
      }),
      db.user.count({ where }),
      db.user.groupBy({
        by: ['role'],
        where: { schoolId: school.id },
        _count: { _all: true },
      }),
      db.session.count({
        where: { user: { schoolId: school.id }, expiresAt: { gt: new Date() } },
      }),
    ])

    return {
      school: { id: school.id, name: school.name, slug: school.slug, code: school.code, status: school.status },
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        /** Account lock (subscription) — distinct from tenant lifecycle. */
        accountLocked: u.subscriptionStatus === 'LOCKED',
        /** One-time bootstrap credential not yet replaced by the user. */
        credentialState: u.mustChangePassword ? 'BOOTSTRAP_PENDING' : u.passwordChangedAt ? 'OWNED' : 'UNKNOWN',
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        liveSessions: u.sessions.length,
      })),
      roleCounts: Object.fromEntries(roleCounts.map((r) => [r.role, r._count._all])),
      liveSessions,
      total,
      page,
      pageSize,
    }
  })
}
