import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { parseFlags } from '@/lib/platform/module-flags'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id] — full school dossier for the control
 * plane: profile, counts, recent school activity, active sessions.
 *
 * The school id in the URL is re-verified against the real School table
 * (fail-safe 404) — a platform admin sees real data only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    const school = await db.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, students: true, teachers: true, classes: true, exams: true, fees: true },
        },
      },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'platform school detail: no such school',
      })
    }

    const [recentActivity, activeSchoolSessions, activeSupportSessions] = await Promise.all([
      db.activityLog.findMany({
        where: { schoolId: school.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.session.count({
        where: { user: { schoolId: school.id }, expiresAt: { gt: new Date() } },
      }),
      db.supportSession.count({
        where: { schoolId: school.id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ])

    return {
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        code: school.code,
        domain: school.domain,
        address: school.address,
        city: school.city,
        phone: school.phone,
        email: school.email,
        board: school.board,
        plan: school.plan,
        status: school.status,
        academicYear: school.academicYear,
        themeColor: school.themeColor,
        accentColor: school.accentColor,
        isDemo: school.isDemo,
        featureFlags: parseFlags(school.featureFlags),
        createdAt: school.createdAt.toISOString(),
        updatedAt: school.updatedAt.toISOString(),
      },
      counts: school._count,
      activeSchoolSessions,
      activeSupportSessions,
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        detail: a.detail,
        at: a.createdAt.toISOString(),
      })),
    }
  })
}

const patchSchema = strictBody({
  name: safeText(80).optional(),
  domain: safeText(120).optional(),
  address: safeText(200).optional(),
  city: safeText(60).optional(),
  phone: safeText(20).optional(),
  email: safeText(120).optional(),
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).optional(),
  themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  academicYear: safeText(20).optional(),
})

/**
 * PATCH /api/platform/schools/[id] — school metadata (profile, branding,
 * domain configuration). Audited field-by-field.
 *
 * Permission: schools.manage + live step-up (VERIFY-FIX: identity/domain
 * metadata is platform-controlled school identity — the same policy
 * class as the domain-mapping, plan and suspend mutations. `domain`
 * changes school routing; `name`/`email` are the school's legal/brand
 * identity. While platform TOTP is stood down the step-up gate is
 * dormant (re-arms automatically when MFA is re-enabled) — identical
 * posture to every other step-up route.)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, patchSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'School not found',
          internalDetail: 'platform school patch: no such school',
        })
      }

      const changes: Record<string, string> = {}
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        if (String(school[key as keyof typeof school] ?? '') !== String(value)) {
          changes[key] = `${String(school[key as keyof typeof school] ?? '')} → ${String(value)}`
        }
      }

      await db.school.update({ where: { id }, data: body })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.updated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: 'metadata update',
        metadata: { changes },
      })

      return { ok: true, updatedFields: Object.keys(changes) }
    },
    { method: 'PATCH' },
  )
}

/**
 * DELETE /api/platform/schools/[id] — DESTRUCTIVE, STEP-UP + TYPED
 * CONFIRMATION.
 *
 * Requires `confirmName` in the query string to EXACTLY match the
 * school's name (the UI forces the admin to type it). Cascades delete
 * every tenant row (schema-level onDelete: Cascade). PlatformAuditLog
 * rows deliberately SURVIVE (no FKs by design — audit outlives
 * resources).
 *
 * Permission: schools.manage + live step-up.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)
      const confirmName = req.nextUrl.searchParams.get('confirmName') ?? ''

      const school = await db.school.findUnique({
        where: { id },
        include: { _count: { select: { users: true, students: true, teachers: true } } },
      })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (confirmName !== school.name) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'Confirmation failed — type the school name exactly to delete',
          internalDetail: 'platform school delete: typed confirmation mismatch',
        })
      }

      await db.school.delete({ where: { id } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.deleted',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: `deleted ${school.name} (typed confirmation)`,
        metadata: {
          name: school.name,
          slug: school.slug,
          deletedUsers: school._count.users,
          deletedStudents: school._count.students,
          deletedTeachers: school._count.teachers,
        },
      })

      return { ok: true, deleted: school.name }
    },
    { method: 'DELETE' },
  )
}
