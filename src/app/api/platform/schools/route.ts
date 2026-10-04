import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseQuery, parseJsonBody, strictBody, emailSchema, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { hostnameRejectionReason, normalizeHostname } from '@/lib/tenant/hostname'
import { z } from 'zod'

export const runtime = 'nodejs'

// Same vocabulary as the school-side routes + the platform's PENDING
// provisioning state (a provisioned school cannot sign in until
// activated).
const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING', 'TRIAL']).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
})

/**
 * GET /api/platform/schools — the platform-wide school ledger with live
 * counts (users/students/teachers/classes) per school.
 *
 * Permission: schools.read. This is a PLATFORM surface — a school
 * session can never reach it (disjoint token spaces).
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'schools.read' }, async () => {
    const query = parseQuery(req, listQuerySchema)
    const page = query.page ?? 1
    const pageSize = 25

    const where = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { slug: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
              { domain: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    }

    const [schools, total] = await Promise.all([
      db.school.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { users: true, students: true, teachers: true, classes: true } },
        },
      }),
      db.school.count({ where }),
    ])

    return {
      total,
      page,
      pageSize,
      schools: schools.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        code: s.code,
        domain: s.domain,
        city: s.city,
        plan: s.plan,
        status: s.status,
        board: s.board,
        academicYear: s.academicYear,
        featureFlags: s.featureFlags,
        createdAt: s.createdAt.toISOString(),
        counts: s._count,
      })),
    }
  })
}

const provisionSchema = strictBody({
  name: safeText(80),
  /// STEP 2 — name display (crest label, footers, login wordmark).
  shortName: safeText(40).optional(),
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and hyphens only'),
  code: z.string().min(2).max(16).regex(/^[A-Z0-9-]+$/, 'uppercase letters, numbers and hyphens only'),
  domain: z.string().max(120).optional(),
  /// STEP 1 — school basics.
  address: safeText(120).optional(),
  city: safeText(60).optional(),
  state: safeText(60).optional(),
  phone: safeText(20).optional(),
  plan: z.enum(SCHOOL_PLANS).default('STANDARD'),
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).default('CBSE'),
  principalName: safeText(80),
  principalEmail: emailSchema,
  // ARCHITECTURE RESET — self-service onboarding (Phase 4):
  principalPassword: z.string().max(128).optional(),
  country: safeText(60).optional(),
  timezone: z
    .string()
    .max(60)
    .regex(/^[A-Za-z0-9_+\-/]+$/, 'invalid timezone')
    .optional(),
  academicYear: z.string().max(20).regex(/^[0-9]{4}[-/][0-9]{4}$/, 'format: YYYY-YYYY').optional(),
  officialEmail: emailSchema.optional(),
  authMethod: z.enum(['PASSWORD', 'GOOGLE_SSO']).default('PASSWORD'),
  /// STEP 2 — branding (colors + optional school-provided tagline; the
  /// platform never invents copy). Contrast validation for colors is
  /// enforced on the school-settings write path; provisioning accepts
  /// well-formed hex so the tenant can refine it later.
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '6-digit hex color')
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '6-digit hex color')
    .optional(),
  tagline: safeText(120).optional(),
  /// STEP 3 — website: enabled by default, custom domain is recorded
  /// PENDING with a real verification token (no faked DNS verification).
  websiteEnabled: z.boolean().default(true),
  customDomain: z.string().min(4).max(253).optional(),
  // Bootstrap academic configuration (optional; the readiness tracker
  // honestly reports what was and was not configured).
  classes: z
    .array(z.object({ name: safeText(40), sections: z.array(safeText(8)).max(8).default([]) }))
    .max(40)
    .optional(),
  subjects: z.array(safeText(40)).max(60).optional(),
  rooms: z.array(safeText(40)).max(40).optional(),
  workingDays: z
    .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .max(7)
    .optional(),
})

/**
 * Derive a stable subject CODE from a name (school-unique constraint on
 * Subject.(schoolId, code)): uppercase alnum, collapsed separators, 12
 * chars max, numeric suffix on in-batch collisions. Never empty.
 */
function subjectCodeOf(name: string, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12) || 'SUB'
  let code = base
  let n = 2
  while (used.has(code)) {
    code = `${base.slice(0, 10)}${n}`
    n += 1
  }
  used.add(code)
  return code
}

/**
 * POST /api/platform/schools — provision a NEW school (status PENDING).
 *
 * Creates the School row + the founding PRINCIPAL User. The school
 * cannot sign in until an explicit `activate` action (separate audit
 * event, separate permission path).
 *
 * PHASE 8C — ATOMICITY REPAIR (mission §11): School + Principal are now
 * created in ONE database transaction. The previous two-write flow could
 * orphan the School row (principal-email race → P2002 AFTER the school
 * insert committed — exactly the forbidden "school created + principal
 * creation fails = orphan school" state). Race safety: the pre-checks
 * below are UX fast-path only; the DATABASE uniques are the authority,
 * and any P2002 (concurrent duplicate slug/code/email) now maps to a
 * typed CONFLICT instead of surfacing as a raw 500 — with the whole
 * transaction rolled back either way.
 *
 * ARCHITECTURE RESET (Phase 4 — self-service onboarding): the provision
 * payload now carries the full onboarding data — country/timezone/academic
 * session (settings JSON + academicYear column), official email, branding
 * color, auth-method choice, and an optional academic bootstrap (classes
 * with sections + subjects) created in the SAME transaction. Everything is
 * DATA — no code change, no new deployment, no new database per school.
 *
 * Auth-method honesty: GOOGLE_SSO is an ARCHITECTED-ONLY capability. The
 * route refuses it with a typed error instead of pretending the tenant is
 * connected — no fake "connected" state, ever. See
 * docs/GOOGLE_SSO_ARCHITECTURE.md.
 *
 * Password policy: caller-supplied or generated (tempPassword surfaced
 * ONCE — same convention as the student/teacher create routes).
 *
 * Permission: schools.provision.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'schools.provision' },
    async (ctx) => {
      const body = await parseJsonBody(req, provisionSchema)
      const ip = clientIpFromHeaders(req.headers)

      // HONEST capability gate — Google SSO is architected but NOT
      // implemented; provisioning with it must fail loudly, not silently
      // record a fake "connected" integration state.
      if (body.authMethod === 'GOOGLE_SSO') {
        throw new AppError('INVALID_INPUT', {
          publicMessage:
            'Google SSO is not yet connected on this platform. Provision with email authentication — Google identity can be enabled for this school once the integration is configured.',
          internalDetail: 'provision: authMethod GOOGLE_SSO refused (integration not implemented)',
        })
      }

      // UX fast-path pre-checks (the transaction's DB uniques are the
      // authority under concurrency — see the P2002 mapping below).
      const [slugTaken, codeTaken, emailTaken] = await Promise.all([
        db.school.findUnique({ where: { slug: body.slug } }),
        db.school.findUnique({ where: { code: body.code } }),
        db.user.findUnique({ where: { email: body.principalEmail.toLowerCase() } }),
      ])
      if (slugTaken) throw new AppError('CONFLICT', { publicMessage: 'School slug is already in use' })
      if (codeTaken) throw new AppError('CONFLICT', { publicMessage: 'School code is already in use' })
      if (emailTaken) throw new AppError('CONFLICT', { publicMessage: 'Principal email is already registered' })

      // Optional password: caller-supplied (policy-checked inside) or a
      // crypto-random temp password surfaced ONCE in the response.
      const { password: principalPassword, generated } = resolveProvisionedPassword(body.principalPassword)

      // STEP 3 — custom domain: validate + normalize BEFORE the
      // transaction (a bad hostname is a plain 400, never a 500). The
      // TenantDomain row itself is created inside the transaction below
      // with a REAL verification token — status PENDING until the school
      // proves ownership with the DNS TXT record. DNS verification is
      // never faked.
      let customDomainHostname: string | null = null
      if (body.customDomain) {
        customDomainHostname = normalizeHostname(body.customDomain)
        if (!customDomainHostname) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'customDomain could not be normalized' })
        }
        const rejection = hostnameRejectionReason(customDomainHostname)
        if (rejection) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: `Invalid custom domain: ${rejection}`,
          })
        }
      }

      const principalEmail = body.principalEmail.toLowerCase()
      // The school's platform subdomain — DATA derived from the slug
      // (Part 4 STEP 3): <slug>.scholario.cloud, with the ?tenant= link
      // as the pre-DNS development fallback. Never a custom domain.
      const tempDomain = `${body.slug}.scholario.cloud`
      let school: {
        id: string
        name: string
        slug: string
        code: string
        status: string
        plan: string
      }
      let principal: { id: string; email: string; name: string | null }
      let domainRecord: { hostname: string; status: string } | null = null
      let bootstrapCounts: { classes: number; sections: number; subjects: number; rooms: number } = {
        classes: 0,
        sections: 0,
        subjects: 0,
        rooms: 0,
      }

      try {
        ;({ school, principal, domainRecord } = await db.$transaction(async (tx) => {
          // Onboarding settings (data-driven, no schema change): country,
          // state, timezone, the website toggle, working days, the derived
          // temporary platform domain, and the chosen auth method live in
          // School.settings.
          const settings: Record<string, unknown> = {}
          if (body.country) settings.country = body.country
          if (body.state) settings.state = body.state
          if (body.timezone) settings.timezone = body.timezone
          if (body.workingDays?.length) settings.workingDays = body.workingDays
          settings.websiteEnabled = body.websiteEnabled
          settings.tempDomain = tempDomain
          settings.authMethod = 'PASSWORD'

          const createdSchool = await tx.school.create({
            data: {
              name: body.name,
              slug: body.slug,
              code: body.code,
              domain: body.domain || null,
              address: body.address || null,
              city: body.city || null,
              phone: body.phone || null,
              email: body.officialEmail || null,
              shortName: body.shortName || null,
              tagline: body.tagline || null,
              academicYear: body.academicYear || null,
              themeColor: body.themeColor || '#0f766e',
              accentColor: body.accentColor || '#f59e0b',
              plan: body.plan,
              board: body.board,
              status: 'PENDING', // sign-in blocked until platform activation
              featureFlags: '{}',
              settings: JSON.stringify(settings),
            },
          })
          // SaaS-HARDENING — the tenant's subscription row is part of the
          // SAME transaction: ACTIVE (no expiry until the first recorded
          // payment — honest default: billing starts when billing starts).
          await tx.schoolSubscription.create({
            data: {
              schoolId: createdSchool.id,
              status: 'ACTIVE',
              plan: body.plan,
              periodStart: new Date(),
              periodEnd: null,
            },
          })
          // Same transaction: a principal-creation failure (concurrent
          // email claim) rolls the School row back — no orphans, ever.
          //
          // CREDENTIAL-RESET — the founding principal ALWAYS starts in the
          // forced first-password-change state, whether the password was
          // caller-supplied or server-generated: the value in the wizard
          // is a one-time bootstrap the principal must replace at first
          // sign-in (server-enforced in withUser, audited at completion).
          // Production can therefore never end up running on a shared or
          // documented password.
          const createdPrincipal = await tx.user.create({
            data: {
              schoolId: createdSchool.id,
              email: principalEmail,
              passwordHash: hashPassword(principalPassword),
              name: body.principalName,
              role: 'PRINCIPAL',
              status: 'ACTIVE',
              mustChangePassword: true,
            },
          })

          // STEP 3 — the canonical TenantDomain record (custom domain,
          // PENDING with a real verification token). The platform never
          // routes traffic through an unverified mapping.
          let createdDomain: { hostname: string; status: string } | null = null
          if (customDomainHostname) {
            const row = await tx.tenantDomain.create({
              data: {
                schoolId: createdSchool.id,
                hostname: customDomainHostname,
                isPrimary: true,
                status: 'PENDING',
                verificationToken: randomBytes(16).toString('hex'),
              },
            })
            createdDomain = { hostname: row.hostname, status: row.status }
          }

          // Academic bootstrap (optional): classes (+ sections),
          // school-level subjects and rooms — same transaction, tenant-scoped.
          const usedSubjectCodes = new Set<string>()
          if (body.subjects?.length) {
            for (const subjectName of body.subjects) {
              await tx.subject.create({
                data: {
                  schoolId: createdSchool.id,
                  name: subjectName,
                  code: subjectCodeOf(subjectName, usedSubjectCodes),
                },
              })
            }
            bootstrapCounts.subjects = body.subjects.length
          }
          if (body.classes?.length) {
            for (const cls of body.classes) {
              const sections =
                cls.sections.length > 0 ? cls.sections : [null]
              for (const section of sections) {
                await tx.class.create({
                  data: {
                    schoolId: createdSchool.id,
                    name: cls.name,
                    section,
                  },
                })
                bootstrapCounts.sections += 1
              }
              bootstrapCounts.classes += 1
            }
          }
          if (body.rooms?.length) {
            const seen = new Set<string>()
            for (const roomName of body.rooms) {
              if (seen.has(roomName)) continue
              seen.add(roomName)
              await tx.room.create({
                data: {
                  schoolId: createdSchool.id,
                  name: roomName,
                  type: 'Classroom',
                },
              })
              bootstrapCounts.rooms += 1
            }
          }

          return {
            school: createdSchool,
            principal: createdPrincipal,
            domainRecord: createdDomain,
          }
        }))
      } catch (err) {
        // Concurrent duplicate — the DB unique won; map it to the same
        // typed CONFLICT the fast path returns (never a raw 500).
        const code = (err as { code?: string }).code
        if (code === 'P2002') {
          const target = String(
            (err as { meta?: { target?: string[] | string } }).meta?.target ?? '',
          )
          if (target.includes('slug')) {
            throw new AppError('CONFLICT', { publicMessage: 'School slug is already in use' })
          }
          if (target.includes('code')) {
            throw new AppError('CONFLICT', { publicMessage: 'School code is already in use' })
          }
          if (target.includes('email')) {
            throw new AppError('CONFLICT', { publicMessage: 'Principal email is already registered' })
          }
          if (target.includes('hostname') || target.includes('TenantDomain')) {
            throw new AppError('CONFLICT', {
              publicMessage: 'The custom domain is already mapped to a school',
            })
          }
        }
        throw err
      }

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.provisioned',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: `provisioned ${body.name} (${body.slug}) with plan ${body.plan}`,
        metadata: {
          plan: body.plan,
          principalEmail,
          principalId: principal.id,
          country: body.country ?? null,
          timezone: body.timezone ?? null,
          academicYear: body.academicYear ?? null,
          authMethod: 'PASSWORD',
          customDomain: customDomainHostname,
          websiteEnabled: body.websiteEnabled,
          bootstrap: bootstrapCounts,
        },
      })

      return {
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          code: school.code,
          status: school.status,
          plan: school.plan,
        },
        principal: { id: principal.id, email: principal.email, name: principal.name },
        // The created tenant-domain ecosystem (Part 5): the custom-domain
        // record (PENDING — real DNS verification happens later from the
        // school record's Domains tab) + the derived temporary platform
        // domain + the tenant link for previewing the website now.
        domain: {
          customDomain: domainRecord,
          tempDomain,
          previewUrl: `/?tenant=${encodeURIComponent(school.slug)}`,
        },
        // tempPassword convention: surfaced ONCE, only when generated
        // server-side (the operator hands it to the principal, who MUST
        // replace it at first sign-in — server-enforced forced change).
        ...(generated ? { tempPassword: principalPassword } : {}),
        // The forced-change contract for the client: the principal's
        // bootstrap credential is single-purpose.
        mustChangePassword: true,
        bootstrap: bootstrapCounts,
        nextStep: 'activate',
      }
    },
    { method: 'POST' },
  )
}
