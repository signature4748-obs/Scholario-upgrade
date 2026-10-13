import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { validatePlanInput, PLAN_INTERVALS } from '@/lib/subscription/plans'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * PATCH /api/platform/subscriptions/plans/[id] — update an ACTIVE plan
 * (billing.manage). The `code` is immutable once referenced by purchases
 * (snapshot history depends on it); everything else is editable.
 */
const patchSchema = strictBody({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(400).nullable().optional(),
  interval: z.enum(PLAN_INTERVALS).optional(),
  priceMonthly: z.number().positive().max(100_000_000).nullable().optional(),
  priceAnnual: z.number().positive().max(100_000_000).nullable().optional(),
  pricePerStudent: z.number().positive().max(100_000_000).nullable().optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(),
  modules: z.record(z.string(), z.unknown()).optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
  allowOnline: z.boolean().optional(),
  allowOffline: z.boolean().optional(),
  availableForNew: z.boolean().optional(),
  availableForRenewal: z.boolean().optional(),
  sortOrder: z.number().int().min(-9999).max(9999).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const plan = await db.subscriptionPlan.findUnique({ where: { id } })
      if (!plan) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Plan not found' })
      }
      if (plan.status !== 'ACTIVE') {
        throw new AppError('CONFLICT', { publicMessage: 'Archived plans cannot be edited — create a successor plan instead.' })
      }

      const raw = await parseJsonBody(req, patchSchema)
      const merged = {
        code: plan.code,
        name: raw.name ?? plan.name,
        description: raw.description === undefined ? plan.description : raw.description,
        scope: plan.scope,
        interval: raw.interval ?? plan.interval,
        priceMonthly: raw.priceMonthly === undefined ? (plan.priceMonthly === null ? null : Number(plan.priceMonthly)) : raw.priceMonthly,
        priceAnnual: raw.priceAnnual === undefined ? (plan.priceAnnual === null ? null : Number(plan.priceAnnual)) : raw.priceAnnual,
        pricePerStudent: raw.pricePerStudent === undefined ? (plan.pricePerStudent === null ? null : Number(plan.pricePerStudent)) : raw.pricePerStudent,
        currency: raw.currency ?? plan.currency,
        modules: raw.modules ? JSON.stringify(raw.modules) : plan.modules,
        limits: raw.limits ? JSON.stringify(raw.limits) : plan.limits,
        graceDays: raw.graceDays ?? plan.graceDays,
        allowOnline: raw.allowOffline === undefined ? plan.allowOnline : (raw.allowOnline ?? plan.allowOnline),
        allowOffline: raw.allowOffline ?? plan.allowOffline,
        availableForNew: raw.availableForNew ?? plan.availableForNew,
        availableForRenewal: raw.availableForRenewal ?? plan.availableForRenewal,
        sortOrder: raw.sortOrder ?? plan.sortOrder,
      }
      const validated = validatePlanInput(merged)

      const updated = await db.subscriptionPlan.update({
        where: { id: plan.id },
        data: {
          name: validated.name.trim(),
          description: validated.description?.trim() || null,
          interval: validated.interval,
          priceMonthly: validated.priceMonthly ?? null,
          priceAnnual: validated.priceAnnual ?? null,
          pricePerStudent: validated.pricePerStudent ?? null,
          currency: validated.currency,
          modules: validated.modules,
          limits: validated.limits,
          graceDays: validated.graceDays,
          allowOnline: validated.allowOnline,
          allowOffline: validated.allowOffline,
          availableForNew: validated.availableForNew,
          availableForRenewal: validated.availableForRenewal,
          sortOrder: validated.sortOrder,
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.plan_updated',
        targetType: 'SUBSCRIPTION_PLAN',
        targetId: updated.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `Plan ${updated.code} updated`,
        metadata: { code: updated.code, fields: Object.keys(raw) },
      }).catch(() => {})

      return { ok: true, message: `Plan ${updated.code} updated.` }
    },
    { method: 'PATCH' },
  )
}

/**
 * DELETE /api/platform/subscriptions/plans/[id] — ARCHIVE (never delete:
 * purchase snapshots reference plans). Archived plans are hidden from new
 * purchases; history stays intact. billing.manage.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const plan = await db.subscriptionPlan.findUnique({ where: { id } })
      if (!plan) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Plan not found' })
      }
      const inUse =
        (await db.schoolSubscription.count({ where: { planId: plan.id } })) +
        (await db.subscriptionOrder.count({ where: { planId: plan.id } })) +
        (await db.studentEntitlement.count({ where: { planId: plan.id } })) +
        (await db.activationCode.count({ where: { planId: plan.id } }))
      if (inUse > 0 && plan.status === 'ACTIVE') {
        // Archive is still allowed (snapshots keep history) — but state it.
        await db.subscriptionPlan.update({ where: { id: plan.id }, data: { status: 'ARCHIVED', availableForNew: false, availableForRenewal: false } })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.plan_archived',
          targetType: 'SUBSCRIPTION_PLAN',
          targetId: plan.id,
          ip: clientIpFromHeaders(req.headers),
          reason: `Plan ${plan.code} archived (${inUse} historical references retained)`,
        }).catch(() => {})
        return { ok: true, archived: true, references: inUse, message: `Plan ${plan.code} archived. ${inUse} historical purchase references remain intact.` }
      }
      if (inUse === 0 && plan.status === 'ACTIVE') {
        await db.subscriptionPlan.update({ where: { id: plan.id }, data: { status: 'ARCHIVED', availableForNew: false, availableForRenewal: false } })
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.plan_archived',
          targetType: 'SUBSCRIPTION_PLAN',
          targetId: plan.id,
          ip: clientIpFromHeaders(req.headers),
          reason: `Plan ${plan.code} archived (no references)`,
        }).catch(() => {})
        return { ok: true, archived: true, references: 0, message: `Plan ${plan.code} archived.` }
      }
      return { ok: true, archived: true, references: inUse, message: `Plan ${plan.code} is already archived.` }
    },
    { method: 'DELETE' },
  )
}
