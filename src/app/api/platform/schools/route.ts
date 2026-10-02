import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseQuery, parseJsonBody, strictBody, emailSchema, passwordInputSchema, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
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
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and hyphens only'),
  code: z.string().min(2).max(16).regex(/^[A-Z0-9-]+$/, 'uppercase letters, numbers and hyphens only'),
  domain: z.string().max(120).optional(),
  city: safeText(60).optional(),
  plan: z.enum(SCHOOL_PLANS).default('STANDARD'),
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).default('CBSE'),
  principalName: safeText(80),
  principalEmail: emailSchema,
  principalPassword: passwordInputSchema,
})

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
 * Permission: schools.provision.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'schools.provision' },
    async (ctx) => {
      const body = await parseJsonBody(req, provisionSchema)
      const ip = clientIpFromHeaders(req.headers)

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

      const principalEmail = body.principalEmail.toLowerCase()
      let school: { id: string; name: string; slug: string; code: string; status: string; plan: string }
      let principal: { id: string; email: string; name: string | null }

      try {
        ;({ school, principal } = await db.$transaction(async (tx) => {
          const createdSchool = await tx.school.create({
            data: {
              name: body.name,
              slug: body.slug,
              code: body.code,
              domain: body.domain || null,
              city: body.city || null,
              plan: body.plan,
              board: body.board,
              status: 'PENDING', // sign-in blocked until platform activation
              featureFlags: '{}',
            },
          })
          // Same transaction: a principal-creation failure (concurrent
          // email claim) rolls the School row back — no orphans, ever.
          const createdPrincipal = await tx.user.create({
            data: {
              schoolId: createdSchool.id,
              email: principalEmail,
              passwordHash: hashPassword(body.principalPassword),
              name: body.principalName,
              role: 'PRINCIPAL',
              status: 'ACTIVE',
            },
          })
          return {
            school: createdSchool,
            principal: createdPrincipal,
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
        metadata: { plan: body.plan, principalEmail, principalId: principal.id },
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
        nextStep: 'activate',
      }
    },
    { method: 'POST' },
  )
}
