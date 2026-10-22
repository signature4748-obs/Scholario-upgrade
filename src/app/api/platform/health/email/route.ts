import { NextRequest } from 'next/server'
import { withPlatform } from '@/lib/platform/authz'
import { getEmailDiagnostics } from '@/lib/email/diagnostics'

export const runtime = 'nodejs'

/**
 * GET /api/platform/health/email — secret-safe transactional-email
 * diagnostics for platform admins (docs/EMAIL.md §Diagnostics).
 *
 * Answers "why are emails not arriving?" WITHOUT exposing a single
 * credential: active provider + selection reason, Resend key/webhook
 * presence, sender address, optional LIVE read-only provider checks
 * (?live=1 — GET /domains via the configured key; proves the key is
 * valid and shows the verified-domain count, i.e. testing mode, AND
 * GET /webhooks: the registered endpoints with URLs + subscribed
 * events so "webhook missing/stale" answers "delivered but stuck
 * QUEUED" in-app), optional targeted per-message delivery probe
 * (?message=<providerMessageId> — GET /emails/{id}, allowlisted to
 * id/last_event/status/created_at), Gmail SMTP presence (masked
 * address), 7-day outbox status counts and the latest failure's typed
 * error class.
 *
 * Readable by ANY authenticated platform admin (operational
 * visibility, same posture as /api/platform/health). No step-up: this
 * route READS provider state; it can never send email, rotate keys or
 * mutate the outbox.
 *
 * (2026-10-20: returns the plain diagnostics object through the
 * standard api() envelope — the raw NextResponse.json passthrough
 * predated any UI consumer; the console SystemHealthCard now reads
 * this endpoint via platformApi.)
 */
export async function GET(req: NextRequest) {
  return withPlatform({}, async () => {
    const live = req.nextUrl.searchParams.get('live') === '1'
    // Optional targeted probe: ?message=<providerMessageId> adds the live
    // per-message delivery state (GET /emails/{id}, field-allowlisted) to
    // the report — the "did the provider actually deliver THIS one?"
    // answer, read with the runtime provider key.
    const message = req.nextUrl.searchParams.get('message') ?? undefined
    return getEmailDiagnostics(live, message)
  })
}
