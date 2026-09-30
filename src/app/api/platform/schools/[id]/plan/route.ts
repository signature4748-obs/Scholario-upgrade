import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const

const planSchema = strictBody({
  plan: z.enum(SCHOOL_PLANS),
  reason: z.string().min(4).max(400).optional(),
})

/**
 * PATCH /api/platform/schools/[id]/plan — DESTRUCTIVE (BILLING), STEP-UP.
 *
 * Plan/subscription configuration is a billing-impactful change: it
 * requires the billing.manage permission AND a live step-up, and is
 * audited with the old → new plan and the stated reason.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, planSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (school.plan === body.plan) {
        throw new AppError('CONFLICT', { publicMessage: `School is already on the ${body.plan} plan` })
      }

      await db.school.update({ where: { id }, data: { plan: body.plan } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.plan_changed',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason ?? `plan change`,
        metadata: { from: school.plan, to: body.plan },
      })

      return { ok: true, plan: body.plan }
    },
    { method: 'PATCH' },
  )
}
