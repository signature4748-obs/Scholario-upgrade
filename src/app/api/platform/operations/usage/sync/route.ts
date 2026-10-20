import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { syncAllProviders, syncProvider } from '@/lib/ops/sync'
import type { ProviderId } from '@/lib/ops/types'

export const runtime = 'nodejs'

const VALID_PROVIDERS = ['vercel', 'supabase', 'resend'] as const

/**
 * POST /api/platform/operations/usage/sync — manual "Sync now": run the
 * provider adapters live (bounded timeouts, per-provider isolation —
 * syncProvider never throws, one provider failing cannot fail the
 * others). Body: { provider?: 'vercel'|'supabase'|'resend' } —
 * omitted = all providers. Audited as platform.ops.sync.triggered;
 * rate-limited by the withPlatform per-admin mutation brake.
 */
export async function POST(req: Request) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    let provider: ProviderId | undefined
    try {
      const body = (await req.json().catch(() => ({}))) as { provider?: string }
      if (body.provider) {
        if (!(VALID_PROVIDERS as readonly string[]).includes(body.provider)) {
          return { error: 'Invalid provider', valid: VALID_PROVIDERS }
        }
        provider = body.provider as ProviderId
      }
    } catch {
      /* empty body = all providers */
    }

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.sync.triggered',
      targetType: 'SETTING',
      reason: provider ? `manual sync: ${provider}` : 'manual sync: all providers',
    })

    const statuses = provider
      ? await (async () => {
          const r = await syncProvider(provider!, 'manual')
          return { [provider!]: r.error ? (r.samples.length ? 'partial' : 'failed') : 'success' }
        })()
      : await syncAllProviders('manual')

    return {
      statuses,
      note: 'Provider adapters ran live with bounded timeouts; results are persisted as snapshots and shown on the next read.',
    }
  }, { method: 'POST' })
}
