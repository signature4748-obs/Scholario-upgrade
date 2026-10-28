import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import {
  AUDIT_CATEGORIES,
  auditCategoryOr,
  auditActionFailed,
  type AuditCategory,
} from '@/lib/platform/audit-format'
import { z } from 'zod'

export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  schoolId: z.string().max(64).optional(),
  adminId: z.string().max(64).optional(),
  target: z.string().max(80).optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  outcome: z.enum(['failure', 'success']).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
})

/** Accept only parseable timestamps (bad input → validation error). */
const dateLike = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid date' })

/**
 * GET /api/platform/audit — the platform audit trail viewer.
 *
 * Filters (all server-side, all composable):
 *   · q            — free text across action, reason, targetId AND the
 *                    actor's name/email (relational contains)
 *   · action       — action substring (contains, case-insensitive)
 *   · category     — support_access | auth_security | school_config |
 *                    subscription | admin_actions (prefix sets)
 *   · outcome      — failure | success, derived from the action's own
 *                    failure markers (.failed/.locked/.refused/failure)
 *   · from / to    — createdAt range (inclusive bounds)
 *   · schoolId     — tenant scope · adminId — actor scope
 *   · target       — targetId substring
 *   · page         — pagination (50/page, newest first)
 *
 * Response adds `requestId` (correlation id when the funnel captured
 * one) and `metadata` as a PARSED object (corrupt blobs → null — the
 * UI renders labeled fields, never raw JSON strings).
 *
 * Permission: audit.read (server-enforced; the school plane 404s this
 * route entirely — plane isolation, not just a permission check).
 *
 * Outcome queries cannot be a pure Prisma predicate (the classification
 * is a regex over the action string): the newest 5,000 matching rows
 * are classified in memory and paginated from that honest window.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'audit.read' }, async () => {
    const query = parseQuery(req, querySchema)
    const from = query.from ? dateLike.parse(query.from) : null
    const to = query.to ? dateLike.parse(query.to) : null
    const page = query.page ?? 1
    const pageSize = 50

    // Actor search: PlatformAuditLog.adminId carries NO relation (rows
    // survive admin deletion by design), so actor names/emails are
    // resolved to ids first — empty match = no actor arm in the OR.
    let actorIds: string[] | null = null
    if (query.q) {
      const actors = await db.platformAdmin.findMany({
        where: {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
          ],
        },
        select: { id: true },
        take: 100,
      })
      actorIds = actors.map((a) => a.id)
    }

    // Compose as an AND of predicate groups — an object literal with two
    // `OR` keys would silently clobber one filter with the other.
    const andGroups: Array<Record<string, unknown>> = []
    if (query.action) andGroups.push({ action: { contains: query.action, mode: 'insensitive' } })
    if (query.schoolId) andGroups.push({ schoolId: query.schoolId })
    if (query.adminId) andGroups.push({ adminId: query.adminId })
    if (query.target) andGroups.push({ targetId: { contains: query.target, mode: 'insensitive' } })
    if (query.category) andGroups.push({ OR: auditCategoryOr(query.category as AuditCategory) })
    if (from || to) {
      andGroups.push({
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        },
      })
    }
    if (query.q) {
      andGroups.push({
        OR: [
          { action: { contains: query.q, mode: 'insensitive' } },
          { reason: { contains: query.q, mode: 'insensitive' } },
          { targetId: { contains: query.q, mode: 'insensitive' } },
          ...(actorIds ? [{ adminId: { in: actorIds } }] : []),
        ],
      })
    }
    const where = andGroups.length > 0 ? { AND: andGroups } : {}

    if (query.outcome) {
      const wantFailure = query.outcome === 'failure'
      const candidates = await db.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5_000,
        select: { id: true, action: true },
      })
      const kept = candidates
        .filter((c) => (wantFailure ? auditActionFailed(c.action) : !auditActionFailed(c.action)))
        .map((c) => c.id)
      const pageIds = kept.slice((page - 1) * pageSize, page * pageSize)
      const events = pageIds.length
        ? await db.platformAuditLog.findMany({
            where: { id: { in: pageIds } },
            orderBy: { createdAt: 'desc' },
          })
        : []
      return {
        total: kept.length,
        page,
        pageSize,
        events: await decorate(events),
      }
    }

    const [events, total] = await Promise.all([
      db.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.platformAuditLog.count({ where }),
    ])

    return {
      total,
      page,
      pageSize,
      events: await decorate(events),
    }
  })
}

/** Resolve actor names + parse metadata blobs for one page of rows. */
async function decorate(
  events: Array<{
    id: string
    adminId: string | null
    action: string
    targetType: string | null
    targetId: string | null
    schoolId: string | null
    reason: string | null
    metadata: string | null
    ip: string | null
    requestId: string | null
    createdAt: Date
  }>,
) {
  const adminIds = [...new Set(events.map((e) => e.adminId).filter((a): a is string => !!a))]
  const admins = adminIds.length
    ? await db.platformAdmin.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const nameById = new Map(admins.map((a) => [a.id, a]))

  return events.map((e) => ({
    id: e.id,
    at: e.createdAt.toISOString(),
    action: e.action,
    admin: e.adminId
      ? {
          id: e.adminId,
          name: nameById.get(e.adminId)?.name ?? 'unknown admin',
          email: nameById.get(e.adminId)?.email ?? null,
        }
      : null,
    targetType: e.targetType,
    targetId: e.targetId,
    schoolId: e.schoolId,
    reason: e.reason,
    metadata: parseMetadata(e.metadata),
    ip: e.ip,
    requestId: e.requestId,
  }))
}

/** Metadata blob → parsed object (corrupt/oversized → null, honest). */
function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
