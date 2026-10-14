import { NextRequest } from 'next/server'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { loadSubscriptionConfig, saveSubscriptionConfig, BILLING_MODELS } from '@/lib/subscription/config'

export const runtime = 'nodejs'

/**
 * GET /api/platform/subscriptions/config — commercial-model configuration
 * (billing.manage). Which models are enabled, default billing model for
 * new schools, default claim-window/validity/grace values.
 */
export async function GET() {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const config = await loadSubscriptionConfig()
    return { config, billingModels: BILLING_MODELS }
  })
}

/**
 * PATCH /api/platform/subscriptions/config — update the commercial-model
 * configuration (billing.manage). Validated by the config service
 * (fail-closed: at least one model must stay enabled). Audited.
 */
export async function PATCH(req: NextRequest) {
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const raw = await req.json().catch(() => ({}))
      const patch = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      const config = await saveSubscriptionConfig(patch)
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.config_updated',
        targetType: 'SETTING',
        targetId: 'global',
        ip: clientIpFromHeaders(req.headers),
        reason: 'Subscription commercial-model configuration updated',
        metadata: { models: config.models, defaultBillingModel: config.defaultBillingModel },
      }).catch(() => {})
      return { ok: true, config, message: 'Subscription configuration saved.' }
    },
    { method: 'PATCH' },
  )
}
