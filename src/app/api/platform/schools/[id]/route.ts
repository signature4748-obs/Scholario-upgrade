import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { parseFlags } from '@/lib/platform/module-flags'
import { schoolLoginUrl, schoolPublicUrl } from '@/lib/plane'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id] — full school dossier for the control
 * plane: profile, counts, recent school activity, active sessions,
 * the founding principal's access state, and the tenant's canonical
 * doors (login URL / public URL — the two-project topology surface).
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

    // ACCESS/INFRASTRUCTURE (Phase 10 — the platform UI exposes the
    // truth): the founding principal (earliest PRINCIPAL row) with the
    // credential/last-login state an operator actually needs, plus the
    // tenant-domain rows for the domain-status surface.
    const [principal, tenantDomains] = await Promise.all([
      db.user.findFirst({
        where: { schoolId: school.id, role: 'PRINCIPAL' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          mustChangePassword: true,
          passwordChangedAt: true,
          lastLoginAt: true,
        },
      }),
      db.tenantDomain.findMany({
        where: { schoolId: school.id },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { hostname: true, status: true, isPrimary: true },
      }),
    ])

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
      // TWO-PROJECT TOPOLOGY — canonical doors + the Access card truth:
      // URLs computed from SCHOOL_APP_BASE_URL (never guessed), the
      // principal's credential state (mustChangePassword = bootstrap
      // credential not yet replaced; lastLoginAt = has actually signed
      // in), and the tenant-domain rows (custom-domain status).
      access: {
        loginUrl: schoolLoginUrl(school.slug),
        publicUrl: schoolPublicUrl(school.slug),
        principal: principal
          ? {
              id: principal.id,
              email: principal.email,
              name: principal.name,
              status: principal.status,
              credentialState: principal.mustChangePassword
                ? 'BOOTSTRAP_PENDING'
                : principal.passwordChangedAt
                  ? 'OWNED'
                  : 'UNKNOWN',
              lastLoginAt: principal.lastLoginAt?.toISOString() ?? null,
            }
          : null,
      },
      domains: tenantDomains.map((d) => ({
        hostname: d.hostname,
        status: d.status,
        isPrimary: d.isPrimary,
      })),
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
