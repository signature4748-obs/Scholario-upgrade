import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { getAllSettings } from '@/lib/ops/alerts'
import { DEFAULT_ALERT_SETTINGS } from '@/lib/ops/types'

export const runtime = 'nodejs'

/** GET — current thresholds (settings → documented defaults). */
export async function GET() {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const settings = await getAllSettings()
    return {
      settings,
      defaults: DEFAULT_ALERT_SETTINGS,
      definitions: {
        'usage.warning': '% consumed → warning alert severity',
        'usage.high': '% consumed → high alert severity',
        'usage.critical': '% consumed → critical alert severity',
        'email.failure_rate.warn': '% of 7-day sends failing → warning',
        'email.failure_rate.critical': '% of 7-day sends failing → critical',
        'sync.stale_minutes': 'minutes without a successful provider sync → staleness warning',
        'error_burst.window_minutes': 'error-burst detection window',
        'error_burst.count': 'occurrences of one fingerprint in the window → burst alert',
        'db_size.warning_bytes':
          'operator-configured database capacity expectation (bytes) — an ESTIMATE (the provider does not expose the plan quota); drives the db_size health check, never shown as a provider limit',
      },
    }
  })
}

/**
 * PUT — update thresholds. Partial body: { key: number, … } (unknown
 * keys rejected; values must be finite numbers). Every change audited
 * as platform.ops.alert.settings_updated with the before/after diff.
 */
export async function PUT(req: Request) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return { error: 'Invalid body' }

    const updates: Array<{ key: string; value: number }> = []
    for (const [k, v] of Object.entries(body)) {
      if (!(k in DEFAULT_ALERT_SETTINGS)) {
        return { error: `Unknown setting key: ${k}`, known: Object.keys(DEFAULT_ALERT_SETTINGS) }
      }
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return { error: `Invalid value for ${k}: ${String(v)}` }
      updates.push({ key: k, value: n })
    }
    if (updates.length === 0) return { error: 'No settings provided' }

    const before = await getAllSettings()
    for (const u of updates) {
      await db.platformAlertSetting.upsert({
        where: { key: u.key },
        create: { key: u.key, value: String(u.value), updatedBy: ctx.admin.id },
        update: { value: String(u.value), updatedBy: ctx.admin.id },
      })
    }

    const after = await getAllSettings()
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.alert.settings_updated',
      targetType: 'SETTING',
      reason: updates.map((u) => `${u.key}: ${before[u.key]} → ${u.value}`).join('; ').slice(0, 400),
      metadata: {
        changed: updates.map((u) => ({ key: u.key, from: before[u.key], to: u.value })),
      },
    })

    return { settings: after }
  }, { method: 'PUT' })
}
