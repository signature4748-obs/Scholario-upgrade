import { NextRequest } from 'next/server'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { sanitizeAuditDetail } from '@/lib/security/audit'
import { AppError } from '@/lib/security/errors'
import { repairResendWebhook } from '@/lib/email/webhook-repair'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/platform/operations/email-webhook/repair — recreate the
 * provider-side Resend webhook and rotate the app-side signing secret
 * (docs/EMAIL.md §"Webhooks" → Provider-side repair).
 *
 * WHAT THIS FIXES (live evidence 2026-10-22): the provider webhook is
 * registered but delivers NOTHING — delivered events stopped arriving
 * after 2026-10-12, so provider-accepted rows stay QUEUED forever.
 * The repair deletes the provider's webhook endpoints and creates a
 * fresh one at the canonical platform URL (a fresh endpoint starts
 * delivering; the API returns its signing secret at creation), then
 * syncs that secret to RESEND_WEBHOOK_SECRET on BOTH planes and
 * triggers a redeploy of both planes (runtime env changes require a
 * new deployment). The ROUTE is permission-gated exactly like every
 * other Operations Center action (ops.read — root-implicit,
 * fail-closed) and every outcome is audited.
 *
 * TYPED CONFIRMATION: the body must carry { confirm: 'recreate-webhook' }
 * — an accidental or scripted POST without the typed confirmation is
 * rejected before anything is touched.
 *
 * The response NEVER contains the signing secret — only per-plane
 * outcomes ('created'/'rotated') and per-plane redeploy results.
 */
export async function POST(req: NextRequest) {
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null
    if (!body || body.confirm !== 'recreate-webhook') {
      throw new AppError('INVALID_INPUT', {
        publicMessage:
          'Typed confirmation required: POST { confirm: "recreate-webhook" }. This action deletes and recreates the provider webhook and rotates its signing secret on both planes.',
      })
    }

    // Refuse when a repair already ran very recently (the recreate is
    // idempotent-safe but churny: each run mints a new secret + two
    // redeploys) — a 10-minute cooldown window.
    const recent = await db.platformAuditLog.findFirst({
      where: {
        action: 'platform.ops.email_webhook.repaired',
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      select: { createdAt: true },
    })
    if (recent) {
      throw new AppError('CONFLICT', {
        publicMessage:
          'A webhook repair was recorded within the last 10 minutes. Wait for the redeploys it triggered to finish (a few minutes) and re-run the live email diagnostics before repairing again — each repair mints a fresh signing secret and redeploys both planes.',
      })
    }

    const result = await repairResendWebhook()

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.email_webhook.repaired',
      targetType: 'SETTING',
      targetId: result.createdWebhookId,
      reason: sanitizeAuditDetail(
        `recreated provider webhook at ${result.canonicalEndpoint} ` +
          `(deleted ${result.deleted.length} endpoint(s)) ` +
          `secretSynced=${JSON.stringify(result.secretSynced)} redeploy=${JSON.stringify(result.redeploy)}`,
      ),
    })

    return result
  }, { method: 'POST' })
}
