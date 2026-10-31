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
import { computeSetupReadiness } from '@/lib/school/setup-readiness'
import {
  deriveProvisioningState,
  principalInviteDeliveryState,
} from '@/lib/platform/principal-invite'

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

    // PROVISIONING STATE (Phase 3) — the honest lifecycle vocabulary
    // derived from the live database: School.status + the full
    // setup-readiness document + the principal-invite delivery state.
    // One school, one dossier — the per-school readiness computation is
    // the same one the school-plane route serves.
    const [readiness, invitation] = await Promise.all([
      computeSetupReadiness(school.id),
      principal ? principalInviteDeliveryState(principal.id) : Promise.resolve({ state: 'NONE' as const }),
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

    // STUDENT-ACCESS PAUSE state (mission §3): the platform-owned
    // settings key records the live pause (affected count + reason +
    // time) so the Access surface can show the truth. The ENFORCEMENT
    // is the User.subscriptionStatus LOCKED rows themselves.
    let studentAccessPause: { pausedAt: string; reason: string; affectedCount: number } | null = null
    let settingsExtras: {
      pincode: string | null
      district: string | null
      websiteEnabled: boolean
    } = {
      pincode: null,
      district: null,
      // The provision wizard defaults the switch ON; a missing settings
      // key means the school's public website EXISTS (honest default,
      // never a silent disable).
      websiteEnabled: true,
    }
    try {
      const parsedSettings = school.settings
        ? (JSON.parse(school.settings) as Record<string, unknown>)
        : {}
      const record = parsedSettings.studentAccessPause as
        | { pausedAt: string; reason: string; affectedCount: number }
        | undefined
      if (record && typeof record.pausedAt === 'string') {
        studentAccessPause = {
          pausedAt: record.pausedAt,
          reason: String(record.reason ?? ''),
          affectedCount: Number(record.affectedCount ?? 0),
        }
      }
      if (typeof parsedSettings.pincode === 'string') settingsExtras.pincode = parsedSettings.pincode
      if (typeof parsedSettings.district === 'string') settingsExtras.district = parsedSettings.district
      // PUBLIC-WEBSITE TRUTH (2026-10 doors fix): the wizard writes the
      // switch into the settings JSON; the detail API surfaces it so the
      // Access card can say "not configured" instead of offering a
      // link that does not exist. Strictly boolean — anything else falls
      // back to the honest default above.
      if (typeof parsedSettings.websiteEnabled === 'boolean') {
        settingsExtras.websiteEnabled = parsedSettings.websiteEnabled
      }
    } catch {
      /* unparseable settings — extras stay null, pause state stays null */
    }

    return {
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        code: school.code,
        recordPrefix: school.recordPrefix,
        domain: school.domain,
        shortName: school.shortName,
        tagline: school.tagline,
        website: school.website,
        pincode: settingsExtras.pincode,
        district: settingsExtras.district,
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
        websiteEnabled: settingsExtras.websiteEnabled,
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
              // Phase 3 — the invite-email delivery state for this
              // principal (NONE = no invite on record — honest).
              invitation,
            }
          : null,
      },
      // Phase 3 — the operator-facing provisioning lifecycle state,
      // derived (never stored): PENDING_ACTIVATION | REQUIRES_ATTENTION
      // | READY | NEEDS_SETUP | SUSPENDED, plus the readiness summary
      // that backs it.
      provisioning: {
        state: deriveProvisioningState({
          status: school.status,
          setupUsable: readiness?.summary.usable ?? false,
          inviteState: invitation.state,
          credentialBootstrapPending: principal?.mustChangePassword ?? false,
        }),
        readiness: readiness
          ? {
              requiredDone: readiness.summary.requiredDone,
              requiredTotal: readiness.summary.requiredTotal,
              requiredComplete: readiness.summary.requiredComplete,
              usable: readiness.summary.usable,
            }
          : null,
      },
      // Mission §3 — the live student-access-pause state (null when not
      // paused). The enforcement itself is the LOCKED User rows.
      studentAccessPause,
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

const patchSettingsSchema = z
  .object({
    state: safeText(60).optional(),
    district: safeText(60).optional(),
    pincode: z
      .string()
      .trim()
      .max(12)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/)
      .optional(),
    country: safeText(60).optional(),
    timezone: z
      .string()
      .trim()
      .max(60)
      .regex(/^[A-Za-z0-9_+\-/]+$/)
      .optional(),
  })
  .strict()
  .optional()

// PHASE 2 — the schema now also carries the wizard's identity fields
// (display name, tagline, public website, established year) and the
// settings-JSON location slice (state/district/pincode/country/timezone
// — the SAME keys provisioning writes). Everything is additive; the
// pre-existing fields are untouched.
const patchSchema = strictBody({
  name: safeText(80).optional(),
  shortName: safeText(40).optional(),
  tagline: safeText(120).optional(),
  website: z.string().trim().max(200).optional(),
  established: safeText(20).optional(),
  domain: safeText(120).optional(),
  address: safeText(200).optional(),
  city: safeText(60).optional(),
  phone: safeText(20).optional(),
  email: safeText(120).optional(),
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).optional(),
  themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  academicYear: safeText(20).optional(),
  settings: patchSettingsSchema,
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

      // PHASE 2 — the settings fragment merges into the stored settings
      // JSON (same read-modify-write discipline as the other settings
      // writers; existing keys are preserved, never overwritten).
      const { settings: settingsPatch, ...columnPatch } = body
      let settingsData: string | undefined
      if (settingsPatch && Object.keys(settingsPatch).length > 0) {
        let parsed: Record<string, unknown> = {}
        try {
          const parsedRaw = JSON.parse(school.settings || '{}') as unknown
          if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
            parsed = parsedRaw as Record<string, unknown>
          }
        } catch {
          parsed = {}
        }
        for (const [key, value] of Object.entries(settingsPatch)) {
          if (value !== undefined) parsed[key] = value
        }
        settingsData = JSON.stringify(parsed)
      }

      const changes: Record<string, string> = {}
      for (const [key, value] of Object.entries(columnPatch)) {
        if (value === undefined) continue
        if (String(school[key as keyof typeof school] ?? '') !== String(value)) {
          changes[key] = `${String(school[key as keyof typeof school] ?? '')} → ${String(value)}`
        }
      }
      if (settingsPatch) {
        let oldSettings: Record<string, unknown> = {}
        try {
          const parsedRaw = JSON.parse(school.settings || '{}') as unknown
          if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
            oldSettings = parsedRaw as Record<string, unknown>
          }
        } catch {
          oldSettings = {}
        }
        for (const [key, value] of Object.entries(settingsPatch)) {
          if (value === undefined) continue
          if (String(oldSettings[key] ?? '') !== String(value)) {
            changes[`settings.${key}`] = `${String(oldSettings[key] ?? '')} → ${String(value)}`
          }
        }
      }

      await db.school.update({
        where: { id },
        data: {
          ...columnPatch,
          ...(settingsData !== undefined ? { settings: settingsData } : {}),
        },
      })

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
