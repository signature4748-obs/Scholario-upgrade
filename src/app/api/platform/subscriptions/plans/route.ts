import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { validatePlanInput, PLAN_SCOPES, PLAN_INTERVALS } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * GET /api/platform/subscriptions/plans — the plan registry + commercial
 * model configuration. billing.manage (config visibility for operators);
 * the school plane reads its OWN purchasable subset through
 * /api/subscription (school session), never this route.
 */
export async function GET() {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const [plans, config] = await Promise.all([
      db.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      loadSubscriptionConfig(),
    ])
    return {
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        scope: p.scope,
        interval: p.interval,
        priceMonthly: p.priceMonthly === null ? null : Number(p.priceMonthly),
        priceAnnual: p.priceAnnual === null ? null : Number(p.priceAnnual),
        pricePerStudent: p.pricePerStudent === null ? null : Number(p.pricePerStudent),
        currency: p.currency,
        modules: JSON.parse(p.modules || '{}'),
        limits: JSON.parse(p.limits || '{}'),
        graceDays: p.graceDays,
        allowOnline: p.allowOnline,
        allowOffline: p.allowOffline,
        availableForNew: p.availableForNew,
        availableForRenewal: p.availableForRenewal,
        status: p.status,
        sortOrder: p.sortOrder,
        createdAt: p.createdAt.toISOString(),
      })),
      config,
      meta: { scopes: PLAN_SCOPES, intervals: PLAN_INTERVALS },
    }
  })
}

const planSchema = strictBody({
  code: z.string().min(3).max(40),
  name: z.string().min(2).max(80),
  description: z.string().max(400).optional(),
  scope: z.enum(PLAN_SCOPES),
  interval: z.enum(PLAN_INTERVALS),
  priceMonthly: z.number().positive().max(100_000_000).nullable().optional(),
  priceAnnual: z.number().positive().max(100_000_000).nullable().optional(),
  pricePerStudent: z.number().positive().max(100_000_000).nullable().optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  modules: z.record(z.string(), z.unknown()).optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  graceDays: z.number().int().min(0).max(90).default(14),
  allowOnline: z.boolean().default(true),
  allowOffline: z.boolean().default(true),
  availableForNew: z.boolean().default(true),
  availableForRenewal: z.boolean().default(true),
  sortOrder: z.number().int().min(-9999).max(9999).default(0),
})

/**
 * POST /api/platform/subscriptions/plans — create a plan (billing.manage).
 * Validation failures return a single actionable message list (the UI
 * surfaces them directly). Fully audited.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const raw = await parseJsonBody(req, planSchema)
      const body = {
        ...raw,
        description: raw.description ?? null,
        priceMonthly: raw.priceMonthly ?? null,
        priceAnnual: raw.priceAnnual ?? null,
        pricePerStudent: raw.pricePerStudent ?? null,
        modules: raw.modules ? JSON.stringify(raw.modules) : '{}',
        limits: raw.limits ? JSON.stringify(raw.limits) : '{}',
        graceDays: raw.graceDays ?? 14,
        allowOnline: raw.allowOnline ?? true,
        allowOffline: raw.allowOffline ?? true,
        availableForNew: raw.availableForNew ?? true,
        availableForRenewal: raw.availableForRenewal ?? true,
        sortOrder: raw.sortOrder ?? 0,
      }
      const plan = validatePlanInput(body)

      const created = await db.subscriptionPlan.create({
        data: {
          code: plan.code,
          name: plan.name.trim(),
          description: plan.description?.trim() || null,
          scope: plan.scope,
          interval: plan.interval,
          priceMonthly: plan.priceMonthly ?? null,
          priceAnnual: plan.priceAnnual ?? null,
          pricePerStudent: plan.pricePerStudent ?? null,
          currency: plan.currency,
          modules: plan.modules,
          limits: plan.limits,
          graceDays: plan.graceDays,
          allowOnline: plan.allowOnline,
          allowOffline: plan.allowOffline,
          availableForNew: plan.availableForNew,
          availableForRenewal: plan.availableForRenewal,
          sortOrder: plan.sortOrder,
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.plan_created',
        targetType: 'SUBSCRIPTION_PLAN',
        targetId: created.id,
        ip: clientIpFromHeaders(req.headers),
        reason: `Plan ${created.code} created`,
        metadata: { code: created.code, scope: created.scope, interval: created.interval },
      }).catch(() => {})

      return { ok: true, planId: created.id, code: created.code, message: `Plan ${created.code} created.` }
    },
    { method: 'POST' },
  )
}
