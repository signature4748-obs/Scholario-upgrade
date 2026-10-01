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
 * Permission: schools.provision.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'schools.provision' },
    async (ctx) => {
      const body = await parseJsonBody(req, provisionSchema)
      const ip = clientIpFromHeaders(req.headers)

      // Uniqueness guards (school-side identity space).
      const [slugTaken, codeTaken, emailTaken] = await Promise.all([
        db.school.findUnique({ where: { slug: body.slug } }),
        db.school.findUnique({ where: { code: body.code } }),
        db.user.findUnique({ where: { email: body.principalEmail.toLowerCase() } }),
      ])
      if (slugTaken) throw new AppError('CONFLICT', { publicMessage: 'School slug is already in use' })
      if (codeTaken) throw new AppError('CONFLICT', { publicMessage: 'School code is already in use' })
      if (emailTaken) throw new AppError('CONFLICT', { publicMessage: 'Principal email is already registered' })

      const school = await db.school.create({
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

      const principal = await db.user.create({
        data: {
          schoolId: school.id,
          email: body.principalEmail.toLowerCase(),
          passwordHash: hashPassword(body.principalPassword),
          name: body.principalName,
          role: 'PRINCIPAL',
          status: 'ACTIVE',
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.provisioned',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: `provisioned ${body.name} (${body.slug}) with plan ${body.plan}`,
        metadata: { plan: body.plan, principalEmail: body.principalEmail.toLowerCase(), principalId: principal.id },
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
