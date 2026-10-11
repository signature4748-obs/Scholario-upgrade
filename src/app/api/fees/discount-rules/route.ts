import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { num } from '@/lib/money'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'

export const runtime = 'nodejs'

/**
 * FEE-ADMISSIONS MVP — explicit fee-discount-rule configuration
 * (H1-R2: v1 single-rule, no stacking, eligible-head-scoped).
 *
 * GET  /api/fees/discount-rules           — list the school's rules
 * POST /api/fees/discount-rules           — create a rule
 * PATCH /api/fees/discount-rules?id=…     — update (name/head/value/active)
 *
 * PRINCIPAL-only, tenant-scoped, flag-gated. Rules only ever take
 * effect through the server-side quote engine (which enforces the
 * one-rule, eligible-head, active-only policy at use time).
 */

const ruleCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, numbers, dash and underscore only'),
  name: z.string().trim().min(2).max(120),
  headId: z.string().max(64).nullable().optional(),
  type: z.enum(['PERCENT', 'FLAT']).default('PERCENT'),
  value: z.number().finite().positive(),
  active: z.boolean().default(true),
  description: z.string().max(500).optional(),
})

const rulePatchSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(120).optional(),
  headId: z.string().max(64).nullable().optional(),
  type: z.enum(['PERCENT', 'FLAT']).optional(),
  value: z.number().finite().positive().optional(),
  active: z.boolean().optional(),
  description: z.string().max(500).optional(),
})

export async function GET() {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    await assertAdmissionsIssuanceEnabled(ctx.schoolId)
    const rules = await db.feeDiscountRule.findMany({
      where: { schoolId: ctx.schoolId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return rules.map((r) => ({ ...r, value: num(r.value) }))
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)

    let body: z.infer<typeof ruleCreateSchema>
    try {
      body = ruleCreateSchema.parse(await req.json().catch(() => ({})))
    } catch {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Invalid discount rule. Codes are 2-40 chars (letters/numbers/dash); values must be positive.',
        internalDetail: 'discount-rules POST: validation failed',
      })
    }
    if (body.type === 'PERCENT' && body.value > 100) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'A percentage discount cannot exceed 100.',
      })
    }
    if (body.type === 'FLAT' && body.value > 500000) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'A flat discount cannot exceed the fee-amount bound (500000).',
      })
    }

    // headId (when set) must be a FeeHead in THIS school.
    if (body.headId) {
      const head = await db.feeHead.findFirst({
        where: { id: body.headId, schoolId },
        select: { id: true, name: true },
      })
      if (!head) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'The eligible fee head was not found in your school.',
          internalDetail: 'discount-rules POST: headId missing or foreign tenant',
        })
      }
    }

    try {
      const rule = await db.feeDiscountRule.create({
        data: {
          schoolId,
          code: body.code,
          name: body.name,
          headId: body.headId ?? null,
          type: body.type,
          value: body.value,
          active: body.active,
          description: body.description ?? null,
        },
      })
      return { ...rule, value: num(rule.value) }
    } catch (e) {
      const err = e as { code?: string }
      if (err?.code === 'P2002') {
        throw new AppError('CONFLICT', {
          publicMessage: 'A discount rule with this code already exists.',
        })
      }
      throw e
    }
  })
}

export async function PATCH(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    await assertAdmissionsIssuanceEnabled(schoolId)

    let body: z.infer<typeof rulePatchSchema>
    try {
      body = rulePatchSchema.parse(await req.json().catch(() => ({})))
    } catch {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Invalid discount rule update.',
        internalDetail: 'discount-rules PATCH: validation failed',
      })
    }
    if (body.type === 'PERCENT' && body.value !== undefined && body.value > 100) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'A percentage discount cannot exceed 100.' })
    }

    const existing = await db.feeDiscountRule.findFirst({
      where: { id: body.id, schoolId },
    })
    if (!existing) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Discount rule not found',
        internalDetail: 'discount-rules PATCH: rule missing or foreign tenant',
      })
    }
    if (body.headId) {
      const head = await db.feeHead.findFirst({
        where: { id: body.headId, schoolId },
        select: { id: true },
      })
      if (!head) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'The eligible fee head was not found in your school.',
          internalDetail: 'discount-rules PATCH: headId missing or foreign tenant',
        })
      }
    }

    const updated = await db.feeDiscountRule.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.headId !== undefined ? { headId: body.headId ?? null } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    })
    return { ...updated, value: num(updated.value) }
  })
}
