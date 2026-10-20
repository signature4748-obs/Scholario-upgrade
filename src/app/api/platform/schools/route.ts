import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  parseQuery,
  parseJsonBody,
  strictBody,
  emailSchema,
  phoneSchema,
  safeText,
} from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { hostnameRejectionReason, normalizeHostname } from '@/lib/tenant/hostname'
import { schoolLoginUrl, schoolPublicUrl } from '@/lib/plane'
import { evaluateTenantEntitlement } from '@/lib/entitlement/entitlement'
import {
  isSubscriptionSchemaPendingError,
  subscriptionSchemaPending as subscriptionSchemaPendingProbe,
  SUBSCRIPTION_LEGACY_SELECT,
} from '@/lib/platform/subscription-schema'
import {
  inviteStateFromRowStatus,
  principalInviteDeliveryState,
  provisionInviteKey,
  sendPrincipalInvite,
} from '@/lib/platform/principal-invite'
import { allocateRecordPrefix } from '@/lib/platform/school-prefix'
import { z } from 'zod'

export const runtime = 'nodejs'

// Same vocabulary as the school-side routes + the platform's PENDING
// provisioning state (a provisioned school cannot sign in until
// activated).
const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  /** ATTENTION is the overview's needs-attention rule: schools whose
   *  lifecycle is PENDING (setup not completed) or TRIAL — the same
   *  two statuses the Overview metric counts. */
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING', 'TRIAL', 'ATTENTION']).optional(),
  /** Legacy tenant plan marker (school.plan). */
  plan: z.enum(['FREE', 'STANDARD', 'PRO', 'ENTERPRISE']).optional(),
  /** Subscription billing model (SchoolSubscription.billingModel). */
  billingModel: z.enum(['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED']).optional(),
  /** Computed entitlement state (ACTIVE/GRACE/RESTRICTED/SUSPENDED/NOT_ACTIVATED). */
  subscriptionState: z
    .enum(['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED', 'NOT_ACTIVATED'])
    .optional(),
  /** Demo/production classification (School.isDemo). */
  demo: z.enum(['demo', 'production']).optional(),
  /** Onboarding readiness (all 5 required setup sections done). */
  readiness: z.enum(['ready', 'incomplete']).optional(),
  /** Board filter (mission §4 — the full legacy vocabulary is listable). */
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).optional(),
  /** Billing frequency filter (SchoolSubscription.interval). */
  billingFrequency: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  /** Subscription periodEnd within N days (renewal report). */
  expiringDays: z.coerce.number().int().min(1).max(365).optional(),
  /** Sort key (server-side; default newest first). */
  sort: z
    .enum(['created_desc', 'created_asc', 'name_asc', 'name_desc', 'updated_desc'])
    .optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  /** Include the KPI summary (computed for the CURRENT filter set). */
  summary: z.coerce.boolean().optional(),
})

/**
 * GET /api/platform/schools — the platform-wide school ledger with live
 * counts (users/students/teachers/classes) per school.
 *
 * Permission: schools.read. This is a PLATFORM surface — a school
 * session can never reach it (disjoint token spaces).
 *
 * Directory capabilities (§3A): search (name/slug/code/domain), filters
 * (lifecycle status, legacy plan marker, billing model, COMPUTED
 * subscription entitlement state, demo/production classification,
 * onboarding readiness, expiring-within-N-days), server-side sorting
 * (created/name/updated), pagination, and an optional KPI summary —
 * every number DB-derived, none fabricated.
 *
 * Computed-state filters (subscriptionState/readiness) are evaluated
 * over the whole filtered set BEFORE pagination — page 1 of a filtered
 * view is genuinely page 1 of that view, not a page-local slice.
 *
 * Each row also carries the access truth an operator needs without
 * opening the record: the demo/production marker (isDemo) and the
 * FOUNDING principal (earliest PRINCIPAL row — the same resolution rule
 * as the detail dossier) with email/name/status, the bootstrap-credential
 * state and last sign-in. Emails are visible to schools.read holders —
 * the same audience the detail route already serves.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'schools.read' }, async () => {
    const query = parseQuery(req, listQuerySchema)
    const page = query.page ?? 1
    const pageSize = 25

    const baseWhere: Record<string, unknown> = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { slug: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
              { recordPrefix: { contains: query.q, mode: 'insensitive' as const } },
              { domain: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { phone: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.status
        ? query.status === 'ATTENTION'
          ? { status: { in: ['PENDING', 'TRIAL'] } }
          : { status: query.status }
        : {}),
      ...(query.plan ? { plan: query.plan } : {}),
      ...(query.board ? { board: query.board } : {}),
      ...(query.demo ? { isDemo: query.demo === 'demo' } : {}),
      ...(query.billingModel || query.billingFrequency
        ? {
            subscription: {
              ...(query.billingModel ? { billingModel: query.billingModel } : {}),
              ...(query.billingFrequency ? { interval: query.billingFrequency } : {}),
            },
          }
        : {}),
    }

    const now = new Date()

    // ── Light pass over the filtered set: id + the fields the computed
    // filters and the per-row subscription chip need (no joins/counts —
    // one bounded query; every downstream number stays DB-derived).
    //
    // SCHEMA-PENDING RESILIENCE — the directory is the control plane's
    // primary surface: it must list REAL schools even when the deployed
    // database has not yet applied the subscription-system migration
    // (owner-gated). First attempt carries the post-migration chip
    // columns; a pending-shape P2021/P2022 retries with the legacy
    // select (entitlement computation needs only the legacy fields) and
    // flags the response `subscriptionSchemaPending: true` so the UI can
    // state exactly WHY plan/billing-model chips read “—” and the
    // billingModel filter is not applied. No row, count or state is
    // fabricated — only the unavailable columns degrade to null. ──
    let subscriptionSchemaPending = false
    let lightRows: Array<{
      id: string
      name: string
      createdAt: Date
      updatedAt: Date
      status: string
      isDemo: boolean
      academicYear: string | null
      recordPrefix: string | null
      subscription: {
        status: string
        plan: string
        periodEnd: Date | null
        graceDays: number
        overrideStatus: string | null
        planCode?: string | null
        billingModel?: string | null
      } | null
    }>
    try {
      lightRows = await db.school.findMany({
        where: baseWhere,
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          status: true,
          isDemo: true,
          academicYear: true,
          recordPrefix: true,
          subscription: {
            select: {
              status: true,
              plan: true,
              planCode: true,
              billingModel: true,
              periodEnd: true,
              graceDays: true,
              overrideStatus: true,
            },
          },
        },
      })
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      subscriptionSchemaPending = true
      // Pre-migration retry: legacy columns only; the billingModel and
      // billingFrequency filters (pending columns) cannot be served
      // and are reported via the flag.
      const { subscription: _drop, ...whereNoSubscription } = baseWhere as Record<string, unknown>
      lightRows = await db.school.findMany({
        where: whereNoSubscription,
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          status: true,
          isDemo: true,
          academicYear: true,
          recordPrefix: true,
          subscription: { select: { ...SUBSCRIPTION_LEGACY_SELECT } },
        },
      })
    }

    // ── Onboarding readiness inputs (5 required sections): grouped
    // counts over the filtered school set — bounded, one round. ──
    const needsReadiness = Boolean(query.readiness || query.summary)
    let readinessBySchool: Map<string, { requiredDone: number; ready: boolean }> | null = null
    if (needsReadiness && lightRows.length) {
      const ids = lightRows.map((r) => r.id)
      const [classCounts, teacherCounts, studentCounts, feeStructCounts, feeCounts, principalCounts] =
        await Promise.all([
          db.class.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: { _all: true } }),
          db.teacher.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: { _all: true } }),
          db.student.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: { _all: true } }),
          db.feeStructure.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: { _all: true } }),
          db.fee.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: { _all: true } }),
          db.user.groupBy({
            by: ['schoolId'],
            where: { schoolId: { in: ids }, role: 'PRINCIPAL', status: 'ACTIVE' },
            _count: { _all: true },
          }),
        ])
      const toMap = (rows: Array<{ schoolId: string | null; _count: { _all: number } }>) =>
        new Map(rows.filter((r) => r.schoolId).map((r) => [r.schoolId as string, r._count._all]))
      const classMap = toMap(classCounts)
      const teacherMap = toMap(teacherCounts)
      const studentMap = toMap(studentCounts)
      const feeStructMap = toMap(feeStructCounts)
      const feeMap = toMap(feeCounts)
      const principalMap = toMap(principalCounts)
      readinessBySchool = new Map(
        lightRows.map((r) => {
          // Same 5 required sections as computeSetupReadiness (identity is
          // done by construction post-provision; principal/academic/people/
          // fees from these live counts; academic = year AND ≥1 class —
          // the §7 consistency fix; fees = structures OR student fees).
          let requiredDone = 1 // identity
          if ((principalMap.get(r.id) ?? 0) > 0) requiredDone += 1
          if (r.academicYear && (classMap.get(r.id) ?? 0) > 0) requiredDone += 1
          if ((teacherMap.get(r.id) ?? 0) > 0 && (studentMap.get(r.id) ?? 0) > 0) requiredDone += 1
          if ((feeStructMap.get(r.id) ?? 0) > 0 || (feeMap.get(r.id) ?? 0) > 0) requiredDone += 1
          return [r.id, { requiredDone, ready: requiredDone === 5 }]
        }),
      )
    }

    // ── Computed entitlement state per school (the same pure evaluator
    // the school plane enforces — the directory can never disagree). ──
    const stateBySchool = new Map(
      lightRows.map((r) => [
        r.id,
        evaluateTenantEntitlement({
          schoolStatus: r.status,
          accountSubscriptionStatus: 'ACTIVE',
          subscription: r.subscription,
        }),
      ]),
    )

    // ── Apply computed filters BEFORE pagination (honest page math). ──
    let filtered = lightRows
    if (query.subscriptionState) {
      filtered = filtered.filter((r) => stateBySchool.get(r.id)?.state === query.subscriptionState)
    }
    if (query.expiringDays) {
      const before = new Date(now.getTime() + query.expiringDays * 24 * 60 * 60 * 1000)
      filtered = filtered.filter((r) => {
        const end = r.subscription?.periodEnd
        return end != null && end >= now && end <= before
      })
    }
    if (query.readiness && readinessBySchool) {
      filtered = filtered.filter((r) => readinessBySchool.get(r.id)?.ready === (query.readiness === 'ready'))
    }

    // ── Server-side sort (default: newest first). ──
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
    const sortKey = query.sort ?? 'created_desc'
    filtered.sort((a, b) => {
      switch (sortKey) {
        case 'created_asc':
          return a.createdAt.getTime() - b.createdAt.getTime()
        case 'name_asc':
          return collator.compare(a.name, b.name)
        case 'name_desc':
          return collator.compare(b.name, a.name)
        case 'updated_desc':
          return b.updatedAt.getTime() - a.updatedAt.getTime()
        default:
          return b.createdAt.getTime() - a.createdAt.getTime()
      }
    })

    const total = filtered.length
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
    const pageIds = pageRows.map((r) => r.id)

    // ── Full rows for the page (counts + founding principal + invites). ──
    const schools = pageIds.length
      ? await db.school.findMany({
          where: { id: { in: pageIds } },
          include: {
            _count: { select: { users: true, students: true, teachers: true, classes: true } },
          },
        })
      : []
    // Re-order the fetched rows to match the sorted page slice.
    const byId = new Map(schools.map((s) => [s.id, s]))
    const ordered = pageIds.map((id) => byId.get(id)).filter((s): s is (typeof schools)[number] => Boolean(s))

    // Founding principal per school (earliest PRINCIPAL row) — one
    // grouped query for the whole page. A school provisioned through
    // the wizard ALWAYS has exactly one founding principal; a missing
    // row (manually crafted data) is reported as null, never guessed.
    const principals = pageIds.length
      ? await db.user.findMany({
          where: { schoolId: { in: pageIds }, role: 'PRINCIPAL' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            schoolId: true,
            email: true,
            name: true,
            status: true,
            mustChangePassword: true,
            passwordChangedAt: true,
            lastLoginAt: true,
          },
        })
      : []
    const foundingBySchool = new Map<string, { id: string; email: string; name: string | null; status: string; mustChangePassword: boolean; passwordChangedAt: Date | null; lastLoginAt: Date | null }>()
    for (const p of principals) {
      // orderBy createdAt asc → the FIRST row seen per school is the
      // founding principal; later principals are ignored here (the
      // detail dossier is the full surface). (schoolId is typed
      // nullable on User — the `in` filter above guarantees a value.)
      const { schoolId, ...principalSummary } = p
      if (schoolId && !foundingBySchool.has(schoolId)) foundingBySchool.set(schoolId, principalSummary)
    }

    // Invite-delivery state per founding principal (Phase 3): one
    // prefix-lookup pass over EmailDelivery (dedupeKey is unique → the
    // LIKE-prefix uses the index). Rows are ordered so the LATEST row
    // per principal wins (re-issues supersede the original invite).
    const principalIds = [...foundingBySchool.values()].map((p) => p.id)
    const inviteRows = principalIds.length
      ? await db.emailDelivery.findMany({
          where: {
            OR: principalIds.map((id) => ({ dedupeKey: { startsWith: `principal-invite:${id}` } })),
          },
          orderBy: { updatedAt: 'desc' },
          select: { dedupeKey: true, status: true },
        })
      : []
    const inviteByPrincipal = new Map<string, string>()
    for (const row of inviteRows) {
      const principalId = row.dedupeKey?.match(/^principal-invite:([^:]+)/)?.[1]
      if (principalId && !inviteByPrincipal.has(principalId)) {
        inviteByPrincipal.set(principalId, row.status)
      }
    }

    // ── KPI summary for the CURRENT filter set (every number computed
    // from the rows above — no fabricated counts). ──
    let summary: Record<string, unknown> | undefined
    if (query.summary) {
      const statusCounts = { ACTIVE: 0, SUSPENDED: 0, PENDING: 0, TRIAL: 0 } as Record<string, number>
      const stateCounts: Record<string, number> = {}
      let demoCount = 0
      let expiringSoon = 0
      const expiringBefore = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      for (const r of filtered) {
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1
        const st = stateBySchool.get(r.id)?.state ?? 'NOT_ACTIVATED'
        stateCounts[st] = (stateCounts[st] ?? 0) + 1
        if (r.isDemo) demoCount += 1
        const end = r.subscription?.periodEnd
        if (end != null && end >= now && end <= expiringBefore) expiringSoon += 1
      }
      const readyCount = readinessBySchool
        ? filtered.filter((r) => readinessBySchool.get(r.id)?.ready).length
        : null
      summary = {
        total,
        byStatus: statusCounts,
        bySubscriptionState: stateCounts,
        demo: demoCount,
        production: filtered.length - demoCount,
        onboardingReady: readyCount,
        subscriptionsExpiringWithin30Days: expiringSoon,
      }
    }

    return {
      total,
      page,
      pageSize,
      ...(summary ? { summary } : {}),
      // Honest schema-pending signal: subscription chip columns degrade to
      // null and the billingModel filter is not applied (see above).
      ...(subscriptionSchemaPending ? { subscriptionSchemaPending: true as const } : {}),
      schools: ordered.map((s) => {
        const founding = foundingBySchool.get(s.id)
        const light = pageRows.find((r) => r.id === s.id)
        const entitlement = light ? stateBySchool.get(s.id) : undefined
        return {
          id: s.id,
          name: s.name,
          slug: s.slug,
          code: s.code,
          recordPrefix: s.recordPrefix,
          domain: s.domain,
          city: s.city,
          plan: s.plan,
          status: s.status,
          board: s.board,
          academicYear: s.academicYear,
          featureFlags: s.featureFlags,
          isDemo: s.isDemo,
          createdAt: s.createdAt.toISOString(),
          counts: s._count,
          // The subscription chip: the SAME computed entitlement state the
          // school plane enforces + the authoritative plan/billing fields
          // (nulls = legacy tenant without a registry plan yet, or the
          // schema-pending flag explains why the columns are unavailable).
          subscription: light?.subscription
            ? {
                state: entitlement?.state ?? 'NOT_ACTIVATED',
                businessAllowed: entitlement?.businessAllowed ?? false,
                renewalRequired: entitlement?.renewalRequired ?? false,
                planCode: light.subscription.planCode ?? null,
                billingModel: light.subscription.billingModel ?? null,
                periodEnd: light.subscription.periodEnd?.toISOString() ?? null,
                graceDays: light.subscription.graceDays,
              }
            : {
                state: entitlement?.state ?? 'NOT_ACTIVATED',
                businessAllowed: entitlement?.businessAllowed ?? false,
                renewalRequired: entitlement?.renewalRequired ?? false,
                planCode: null,
                billingModel: null,
                periodEnd: null,
                graceDays: null,
              },
          // The founding principal's access state (same vocabulary as
          // the detail dossier — BOOTSTRAP_PENDING means the one-time
          // credential has not been replaced yet) + the invite-email
          // delivery state (Phase 3: NONE = no invite on record —
          // honestly unknown, never fabricated OK).
          principal: founding
            ? {
                email: founding.email,
                name: founding.name,
                status: founding.status,
                credentialState: founding.mustChangePassword
                  ? ('BOOTSTRAP_PENDING' as const)
                  : founding.passwordChangedAt
                    ? ('OWNED' as const)
                    : ('UNKNOWN' as const),
                lastLoginAt: founding.lastLoginAt?.toISOString() ?? null,
                invitation: inviteStateFromRowStatus(inviteByPrincipal.get(founding.id) ?? 'NONE'),
              }
            : null,
          // TWO-PROJECT TOPOLOGY — the canonical cross-plane doors this
          // row's tenant is reached through (SCHOOL_APP_BASE_URL on the
          // platform project; relative fallback on the unified legacy
          // deployment). Admins must never GUESS a school's URL.
          loginUrl: schoolLoginUrl(s.slug),
          publicUrl: schoolPublicUrl(s.slug),
        }
      }),
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
  /// STEP 1 — the school's OWN external/official code, OPTIONAL since
  /// 2026-10-20 (mission §2): some schools have one, others do not.
  /// When absent the server assigns the allocated internal record
  /// prefix as the code (guaranteed unique by construction).
  code: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'uppercase letters, numbers and hyphens only')
    .optional(),
  domain: z.string().max(120).optional(),
  /// STEP 1 — school basics.
  address: safeText(200).optional(),
  addressLine2: safeText(120).optional(),
  city: safeText(60).optional(),
  district: safeText(60).optional(),
  pincode: z
    .string()
    .trim()
    .max(12)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, 'invalid postal code characters')
    .optional(),
  state: safeText(60).optional(),
  phone: safeText(20).optional(),
  /// STEP 6 — the school's existing external website (School.website,
  /// shown on its public page). Hostname or https URL, 200 chars max.
  website: z
    .string()
    .trim()
    .max(200)
    .refine(
      (v) => {
        const bare = v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '')
        return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(bare)
      },
      'must look like a website host (e.g. school.edu)',
    )
    .optional(),
  plan: z.enum(SCHOOL_PLANS).default('STANDARD'),
  /// Subscription billing model (mission §4 — the wizard's subscription
  /// configuration; defaults to SCHOOL_WIDE, the same default the schema
  /// applies when absent).
  billingModel: z.enum(['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED']).default('SCHOOL_WIDE'),
  /// ADD-SCHOOL WIZARD (mission §2 STEP 3) — the agreed commercial terms.
  /// billingFrequency: MONTHLY (school-based monthly) | ANNUAL (school-
  /// based yearly AND the only frequency a student-based subscription
  /// may ever have — enforced cross-field below + by the wizard UI).
  billingFrequency: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  /// The agreed commercial UNIT price: monthly/yearly price for
  /// school-based, per-student annual price for student-based. NEVER a
  /// hardcoded plan price and never fabricated — recording a PAYMENT is
  /// a separate operation.
  agreedAmount: z.number().positive().max(100_000_000).optional(),
  /// Existing supported currency set (src/lib/platform/billing.ts).
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(),
  /// Licensed student quantity for PER_STUDENT billing (the count the
  /// per-student price multiplies). Required when billingModel is
  /// PER_STUDENT and terms are provided.
  licensedStudents: z.coerce.number().int().min(1).max(100_000).optional(),
  /// Subscription start date (YYYY-MM-DD). Defaults to today when terms
  /// are provided; the paid period only begins when a payment is
  /// actually recorded (periodEnd stays null — honest).
  subscriptionStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format: YYYY-MM-DD').optional(),
  /// NEW PROVISIONS accept the two boards the product onboards (mission
  /// §2 STEP 1): UP Board or CBSE only. Existing rows keep the full
  /// legacy vocabulary (CBSE | UP_BOARD | ICSE | STATE | CUSTOM).
  board: z.enum(['CBSE', 'UP_BOARD']).default('CBSE'),
  principalName: safeText(80),
  principalEmail: emailSchema,
  /// Principal contact phone — optional, stored on the User row using
  /// the shared phone validator (no new verification system invented).
  principalPhone: phoneSchema.optional(),
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
}).superRefine((v, ctx) => {
  // ── Cross-field commercial rules (mission §2 STEP 3) ──────────────────
  // Student-based is YEARLY ONLY — reject before any write (the UI
  // never offers the combination; the API is the authority).
  if (v.billingModel === 'PER_STUDENT' && v.billingFrequency === 'MONTHLY') {
    ctx.addIssue({
      code: 'custom',
      path: ['billingFrequency'],
      message: 'Student-based subscriptions are billed yearly only — choose yearly, or switch to school-based billing for monthly.',
    })
  }
  // The licensed student quantity is required whenever student-based
  // commercial terms are being configured.
  if (v.billingModel === 'PER_STUDENT' && v.billingFrequency != null && v.licensedStudents == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['licensedStudents'],
      message: 'Licensed student count is required for student-based billing',
    })
  }
  // Frequency and amount are one unit: an agreed price is always for an
  // interval, and an interval is always priced.
  if (v.agreedAmount != null && v.billingFrequency == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['billingFrequency'],
      message: 'Billing frequency is required when an agreed amount is provided',
    })
  }
  if (v.billingFrequency != null && v.agreedAmount == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['agreedAmount'],
      message: 'The agreed commercial amount is required when billing frequency is provided',
    })
  }
  if (v.licensedStudents != null && v.billingModel !== 'PER_STUDENT') {
    ctx.addIssue({
      code: 'custom',
      path: ['licensedStudents'],
      message: 'Licensed student count applies to student-based billing only',
    })
  }
  // ── Address cross-field validation (mission §2 STEP 6) ────────────────
  // Indian PIN codes are validated as Indian (6 digits, first 1–8) —
  // never rejected by an international-only rule; other countries use a
  // permissive generic postal code.
  if ((v.country ?? '').trim().toLowerCase() === 'india' && v.pincode != null && !/^[1-8][0-9]{5}$/.test(v.pincode.trim())) {
    ctx.addIssue({
      code: 'custom',
      path: ['pincode'],
      message: 'Indian PIN code must be 6 digits (first digit 1–8)',
    })
  }
  // Start-date sanity: not more than a year in the past or future.
  if (v.subscriptionStartsOn != null) {
    const d = new Date(`${v.subscriptionStartsOn}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', path: ['subscriptionStartsOn'], message: 'Invalid subscription start date' })
    } else {
      const days = (Date.now() - d.getTime()) / 86_400_000
      if (days > 366 || days < -366) {
        ctx.addIssue({
          code: 'custom',
          path: ['subscriptionStartsOn'],
          message: 'Subscription start date must be within one year of today',
        })
      }
    }
  }
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
      // SCHEMA-PENDING RESILIENCE — probe once (TTL-cached); see the
      // subscription-create note inside the transaction.
      const subscriptionSchemaPending = await subscriptionSchemaPendingProbe()
      const principalEmail = body.principalEmail.toLowerCase()

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

      // IDEMPOTENT REPLAY (Phase 3 — mission §4: idempotency for
      // retries and duplicate requests). A retry of a just-provisioned
      // request (lost response, double submit, network error
      // mid-flight) must not bury the operator in an opaque 409. When a
      // school exists whose FULL identity fingerprint matches this
      // payload — same slug AND code AND founding-principal email — AND
      // it was provisioned by THIS admin (audit-proven) AND it is still
      // PENDING, the retry is a REPLAY: the original school is returned
      // with `replayed: true` and NO second school/principal is created.
      //
      // OPTIONAL-CODE EXTENSION (2026-10-20): when the retry carries NO
      // external code, the fingerprint matches a school whose code was
      // auto-assigned from its internal record prefix (code ===
      // recordPrefix) — the deterministic outcome of the original
      // no-code provision. The database uniques remain the authority;
      // anything that does not match ALL replay conditions falls
      // through to the standard CONFLICT path below. The one-time
      // tempPassword is deliberately NOT re-surfaced (only its scrypt
      // hash exists) — the recovery path for a lost credential is the
      // reissue-credential route.
      const existingBySlug = await db.school.findUnique({ where: { slug: body.slug } })
      if (existingBySlug) {
        const [existingPrincipal, origProvisionAudit, existingPrefixRow] = await Promise.all([
          db.user.findFirst({
            where: { schoolId: existingBySlug.id, role: 'PRINCIPAL' },
            orderBy: { createdAt: 'asc' },
            select: { id: true, email: true, name: true, mustChangePassword: true },
          }),
          db.platformAuditLog.findFirst({
            where: {
              action: 'platform.school.provisioned',
              targetId: existingBySlug.id,
              adminId: ctx.admin.id,
            },
            select: { id: true },
          }),
          db.school.findUnique({
            where: { id: existingBySlug.id },
            select: { recordPrefix: true },
          }),
        ])
        const codeMatches =
          body.code != null
            ? existingBySlug.code === body.code
            : // Auto-assigned code: the school's code IS its record prefix.
              existingPrefixRow?.recordPrefix != null && existingBySlug.code === existingPrefixRow.recordPrefix
        const isReplay =
          codeMatches &&
          existingBySlug.status === 'PENDING' &&
          !!existingPrincipal &&
          existingPrincipal.email === principalEmail &&
          !!origProvisionAudit
        if (isReplay && existingPrincipal) {
          const [tenantDomains, invitation] = await Promise.all([
            db.tenantDomain.findMany({
              where: { schoolId: existingBySlug.id },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              select: { hostname: true, status: true, isPrimary: true },
            }),
            principalInviteDeliveryState(existingPrincipal.id),
          ])
          const custom = tenantDomains.find((d) => d.isPrimary) ?? tenantDomains[0] ?? null
          await platformAuditEvent({
            adminId: ctx.admin.id,
            action: 'platform.school.provision_replayed',
            targetType: 'SCHOOL',
            targetId: existingBySlug.id,
            schoolId: existingBySlug.id,
            ip,
            reason: `idempotent replay of provision for ${existingBySlug.slug} (retry by the same admin; no duplicate created)`,
          })
          return {
            replayed: true,
            school: {
              id: existingBySlug.id,
              name: existingBySlug.name,
              slug: existingBySlug.slug,
              code: existingBySlug.code,
              recordPrefix: existingPrefixRow?.recordPrefix ?? null,
              status: existingBySlug.status,
              plan: existingBySlug.plan,
            },
            principal: {
              id: existingPrincipal.id,
              email: existingPrincipal.email,
              name: existingPrincipal.name,
            },
            loginUrl: schoolLoginUrl(existingBySlug.slug),
            publicUrl: schoolPublicUrl(existingBySlug.slug),
            domain: {
              customDomain: custom ? { hostname: custom.hostname, status: custom.status } : null,
              tempDomain: `${existingBySlug.slug}.scholario.cloud`,
              previewUrl: `/?tenant=${encodeURIComponent(existingBySlug.slug)}`,
            },
            mustChangePassword: existingPrincipal.mustChangePassword,
            invitation,
            nextStep: 'activate',
            replayNote:
              'This request matched a school you provisioned that is still PENDING — no duplicate was created. The one-time credential was displayed only at the original creation; if it was lost, re-issue it from the school record (Access card).',
          }
        }
      }

      // UX fast-path pre-checks (the transaction's DB uniques are the
      // authority under concurrency — see the P2002 mapping below). The
      // external code is checked only when the operator supplied one;
      // an absent code is resolved to the allocated record prefix inside
      // the transaction, unique by construction.
      const [slugTaken, codeTaken, emailTaken] = await Promise.all([
        db.school.findUnique({ where: { slug: body.slug } }),
        body.code ? db.school.findUnique({ where: { code: body.code } }) : null,
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

      // The school's platform subdomain — DATA derived from the slug
      // (Part 4 STEP 3): <slug>.scholario.cloud, with the ?tenant= link
      // as the pre-DNS development fallback. Never a custom domain.
      const tempDomain = `${body.slug}.scholario.cloud`
      let school: {
        id: string
        name: string
        slug: string
        code: string
        recordPrefix: string | null
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
      // The agreed commercial terms that were PERSISTED (reported back
      // honestly; never fabricated beyond what the operator entered).
      const subscriptionTerms =
        body.billingFrequency != null && body.agreedAmount != null
          ? {
              billingModel: body.billingModel,
              interval: body.billingFrequency,
              unitPrice: body.agreedAmount,
              currency: body.currency ?? 'INR',
              licensedStudents:
                body.billingModel === 'PER_STUDENT' ? (body.licensedStudents ?? null) : null,
              periodStart: (body.subscriptionStartsOn ?? new Date().toISOString().slice(0, 10)) as string,
              // HONEST BILLING: provisioning records the AGREED terms only.
              // No payment is fabricated — periodEnd stays null until a
              // VERIFIED payment is recorded through the subscription flow.
              periodEnd: null as string | null,
              paymentsRecorded: 0,
            }
          : null

      try {
        ;({ school, principal, domainRecord } = await db.$transaction(async (tx) => {
          // ── INTERNAL RECORD PREFIX (mission §2 STEP 1-B) ────────────
          // Allocated FIRST, inside this transaction, under a Postgres
          // advisory lock (serialized across concurrent provisions) with
          // the UNIQUE index as the DB-enforced backstop. Immutable after
          // this write; when the operator supplied no external code,
          // this prefix doubles as the assigned School.code.
          const recordPrefix = await allocateRecordPrefix(tx, body.name)
          const resolvedCode = body.code ?? recordPrefix

          // Onboarding settings (data-driven, no schema change): country,
          // state, timezone, the website toggle, working days, the derived
          // temporary platform domain, the chosen auth method and the
          // extended address fields live in School.settings.
          const settings: Record<string, unknown> = {}
          if (body.country) settings.country = body.country
          if (body.state) settings.state = body.state
          if (body.timezone) settings.timezone = body.timezone
          if (body.workingDays?.length) settings.workingDays = body.workingDays
          if (body.addressLine2) settings.addressLine2 = body.addressLine2
          if (body.district) settings.district = body.district
          if (body.pincode) settings.pincode = body.pincode
          settings.websiteEnabled = body.websiteEnabled
          settings.tempDomain = tempDomain
          settings.authMethod = 'PASSWORD'

          const createdSchool = await tx.school.create({
            data: {
              name: body.name,
              slug: body.slug,
              code: resolvedCode,
              recordPrefix,
              domain: body.domain || null,
              address: body.address || null,
              city: body.city || null,
              phone: body.phone || null,
              email: body.officialEmail || null,
              shortName: body.shortName || null,
              tagline: body.tagline || null,
              website: body.website || null,
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
          // SCHEMA-PENDING RESILIENCE — `billingModel` is a pending-migration
          // column: provisioning is the control plane's PRIMARY workflow and
          // must keep working on a pre-migration database. Under pending we
          // omit the column (the migration's default SCHOOL_WIDE applies
          // retroactively when the owner applies it) and flag the response;
          // a non-default billing model choice is honestly refused — it
          // could not be persisted yet and pretending otherwise would
          // misstate the tenant's commercial model.
          if (subscriptionSchemaPending && body.billingModel !== 'SCHOOL_WIDE') {
            throw new AppError('SUBSCRIPTION_SYSTEM_PENDING', {
              publicMessage:
                'Per-student and mixed billing models require the pending subscription-system migration. Provision with the school-wide model (the default) — the platform owner can switch the model after the migration is applied.',
              internalDetail: `provision: billingModel ${body.billingModel} refused (schema pending)`,
            })
          }
          // Onboarding commercial terms (interval/priceSnapshot/currency/
          // licensedStudents) are ALSO pending-migration columns — a
          // pending database cannot persist them, so the request is
          // honestly refused instead of silently dropping the operator's
          // agreed terms.
          if (
            subscriptionSchemaPending &&
            (body.billingFrequency != null ||
              body.agreedAmount != null ||
              body.currency != null ||
              body.licensedStudents != null ||
              body.subscriptionStartsOn != null)
          ) {
            throw new AppError('SUBSCRIPTION_SYSTEM_PENDING', {
              publicMessage:
                'Agreed subscription terms cannot be recorded until the pending subscription-system migration is applied. Provision without them and record the commercial terms afterwards.',
              internalDetail: 'provision: subscription terms refused (schema pending)',
            })
          }
          if (subscriptionSchemaPending) {
            // RAW INSERT with the legacy column set only — the generated
            // client's INSERT/RETURNING references the pending-migration
            // columns (billingModel + snapshot fields) even when they are
            // omitted from `data`, so model.create() cannot run at all on
            // a pre-migration database. The migration's own default
            // (billingModel 'SCHOOL_WIDE') applies to this row when the
            // owner applies the migration.
            await tx.$executeRawUnsafe(
              `INSERT INTO "SchoolSubscription" ("id","schoolId","status","plan","periodStart","periodEnd","graceDays","updatedAt","createdAt")
               VALUES ($1,$2,'ACTIVE',$3,$4,NULL,14,NOW(),NOW())`,
              `sub-${randomBytes(12).toString('hex')}`,
              createdSchool.id,
              body.plan,
              new Date(),
            )
          } else {
            await tx.schoolSubscription.create({
              data: {
                schoolId: createdSchool.id,
                status: 'ACTIVE',
                plan: body.plan,
                billingModel: body.billingModel,
                // AGREED TERMS (mission §2 STEP 3) — persisted exactly as
                // the operator entered them: interval (MONTHLY/ANNUAL),
                // the unit price snapshot, the currency and the licensed
                // student count. periodEnd stays null: billing starts when
                // a VERIFIED payment is recorded — never fabricated here.
                ...(body.billingFrequency ? { interval: body.billingFrequency } : {}),
                ...(body.agreedAmount != null ? { priceSnapshot: body.agreedAmount } : {}),
                ...(body.currency ? { currencySnapshot: body.currency } : {}),
                ...(body.billingModel === 'PER_STUDENT' && body.licensedStudents != null
                  ? { licensedStudents: body.licensedStudents }
                  : {}),
                periodStart:
                  body.subscriptionStartsOn != null
                    ? new Date(`${body.subscriptionStartsOn}T00:00:00Z`)
                    : new Date(),
                periodEnd: null,
              },
            })
          }
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
              ...(body.principalPhone ? { phone: body.principalPhone } : {}),
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
            // SERVER-SIDE DEDUPE (mission §2 STEP 4): one Class row per
            // (name, section) pair — a repeated row in the payload must
            // never become duplicate classes/sections in the tenant.
            const seenClass = new Set<string>()
            for (const cls of body.classes) {
              const sections =
                cls.sections.length > 0 ? cls.sections : [null]
              for (const section of sections) {
                const key = `${cls.name.toLowerCase()}|${(section ?? '').toLowerCase()}`
                if (seenClass.has(key)) continue
                seenClass.add(key)
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
          if (target.includes('recordPrefix')) {
            // The advisory lock makes this near-impossible; the unique
            // index still guarantees no duplicate is ever persisted.
            throw new AppError('CONFLICT', {
              publicMessage: 'Internal record prefix allocation conflict — please retry',
            })
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
          principalPhone: body.principalPhone ?? null,
          country: body.country ?? null,
          timezone: body.timezone ?? null,
          academicYear: body.academicYear ?? null,
          authMethod: 'PASSWORD',
          customDomain: customDomainHostname,
          websiteEnabled: body.websiteEnabled,
          recordPrefix: school.recordPrefix,
          codeAssignedFromPrefix: body.code == null,
          billingModel: body.billingModel,
          // The AGREED commercial terms exactly as entered (a payment is
          // a separate, audited operation — see subscription/payments).
          billingFrequency: body.billingFrequency ?? null,
          agreedAmount: body.agreedAmount ?? null,
          currency: body.currency ?? null,
          licensedStudents: body.licensedStudents ?? null,
          subscriptionStartsOn: body.subscriptionStartsOn ?? null,
          pincode: body.pincode ?? null,
          district: body.district ?? null,
          bootstrap: bootstrapCounts,
        },
      })

      // PRINCIPAL INVITE (Phase 3) — best-effort credential-delivery
      // email through the shared pipeline, AFTER the transaction and
      // audit are durable. sendEmail NEVER throws: a failed delivery
      // is a VALUE (state FAILED) surfaced to the operator — the school
      // itself is fully provisioned and the one-time tempPassword above
      // remains the authoritative channel. The email includes the
      // password ONLY when it was server-generated (same convention as
      // the response field). Dedupe: one logical invite per principal
      // bootstrap (a SENT/QUEUED row is never re-sent).
      const invitation = await sendPrincipalInvite({
        school: { id: school.id, name: school.name, slug: school.slug, status: school.status },
        principal: { id: principal.id, email: principal.email, name: principal.name },
        ...(generated ? { tempPassword: principalPassword } : {}),
        dedupeKey: provisionInviteKey(principal.id),
      })

      return {
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          code: school.code,
          // The stable internal record prefix (immutable from here on).
          recordPrefix: school.recordPrefix,
          status: school.status,
          plan: school.plan,
        },
        principal: { id: principal.id, email: principal.email, name: principal.name },
        // TWO-PROJECT TOPOLOGY — the school's canonical doors, computed
        // from SCHOOL_APP_BASE_URL (the platform never guesses URLs):
        //   loginUrl  → the /s/<slug>/login sign-in door
        //   publicUrl → the /s/<slug> public website
        loginUrl: schoolLoginUrl(school.slug),
        publicUrl: schoolPublicUrl(school.slug),
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
        // The AGREED commercial terms as persisted (mission §2 STEP 3).
        // paymentsRecorded is the honest count (0) — provisioning records
        // terms, never a payment; the subscription flow does that.
        ...(subscriptionTerms ? { subscription: subscriptionTerms } : {}),
        // Invite-delivery state (honest: SENT/QUEUED/FAILED — never
        // fabricated; FAILED ⇒ deliver the credential manually or
        // re-issue it from the school record).
        invitation,
        nextStep: 'activate',
        ...(subscriptionSchemaPending
          ? {
              subscriptionSchemaPending: true as const,
              subscriptionPendingNote:
                'The tenant subscription row was created with the legacy schema fields; the billing model will default to school-wide until the pending subscription-system migration is applied.',
            }
          : {}),
      }
    },
    { method: 'POST' },
  )
}
