import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { strictBody, cuidSchema, parseJsonBody } from '@/lib/security/validation'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { serializeStructure } from '../serialize'

export const runtime = 'nodejs'

/**
 * PUT /api/salary/structure — set ONE teacher's fixed MONTHLY salary.
 *
 * PRINCIPAL / MANAGEMENT only. Business rule (strict): a salary structure
 * is a single monthlyAmount — no components, allowances, deductions or
 * gross/net arithmetic exist. The row is upserted per teacher
 * (SalaryStructure.teacherId is unique) and every write is audit-logged
 * (SALARY_STRUCTURE_SET) and rate-limited ('salary' profile, 30/h per
 * user).
 *
 * Tenant semantics: the teacherId FK is validated in the CALLER's school
 * (fail-safe 404 — a foreign-tenant id reveals nothing).
 */
const structureBodySchema = strictBody({
  teacherId: cuidSchema,
  monthlyAmount: z
    .number({ message: 'monthlyAmount must be a number' })
    .finite()
    .positive()
    .max(5_000_000, 'monthlyAmount must be at most ₹50,00,000'),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be a YYYY-MM-DD date')
    .optional(),
  note: z.string().max(500, 'note must be at most 500 characters').optional(),
})

export async function PUT(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
    async (ctx) => {
      const { user, schoolId } = ctx

      const body = await parseJsonBody(req, structureBodySchema)

      // Abuse brake — the salary mutation budget (30/h per user).
      enforceRateLimit(`rl:salary:usr:${user.id}`, RATE_LIMITS.salary)

      // ── Teacher FK must exist in THIS school (no existence oracle) ────
      const teacher = await db.teacher.findFirst({
        where: { id: body.teacherId, schoolId },
        select: { id: true, userId: true, schoolId: true, user: { select: { name: true } } },
      })
      if (!teacher) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Teacher not found',
          internalDetail: `salary structure PUT: teacher ${body.teacherId} missing or foreign tenant`,
        })
      }

      const effectiveFrom = body.effectiveFrom
        ? new Date(`${body.effectiveFrom}T00:00:00.000Z`)
        : null
      if (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'effectiveFrom is not a valid date' })
      }

      const row = await db.salaryStructure.upsert({
        where: { teacherId: body.teacherId },
        create: {
          schoolId,
          teacherId: body.teacherId,
          monthlyAmount: body.monthlyAmount,
          effectiveFrom,
          note: body.note?.trim() || null,
          updatedById: user.id,
        },
        update: {
          monthlyAmount: body.monthlyAmount,
          effectiveFrom,
          note: body.note?.trim() || null,
          updatedById: user.id,
        },
        include: {
          teacher: {
            select: { id: true, employeeId: true, department: true, user: { select: { name: true, email: true } } },
          },
        },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SALARY_STRUCTURE_SET',
        detail: `Monthly salary set to ₹${body.monthlyAmount.toLocaleString('en-IN')} for ${teacher.user.name ?? 'teacher'} by ${user.name}`,
      }).catch(() => {})

      return serializeStructure(row)
    },
  ) as Promise<Response>
}
