import { NextRequest, NextResponse } from 'next/server'
import { withPlatform } from '@/lib/platform/authz'
import { getEmailDiagnostics } from '@/lib/email/diagnostics'

export const runtime = 'nodejs'

/**
 * GET /api/platform/health/email — secret-safe transactional-email
 * diagnostics for platform admins (docs/EMAIL.md §Diagnostics).
 *
 * Answers "why are emails not arriving?" WITHOUT exposing a single
 * credential: active provider + selection reason, Resend key/webhook
 * presence, sender address, optional LIVE read-only domain check
 * (?live=1 — GET /domains via the configured key; proves the key is
 * valid and shows the verified-domain count, i.e. testing mode),
 * Gmail SMTP presence (masked address), 7-day outbox status counts
 * and the latest failure's typed error class.
 *
 * Readable by ANY authenticated platform admin (operational
 * visibility, same posture as /api/platform/health). No step-up: this
 * route READS provider state; it can never send email, rotate keys or
 * mutate the outbox.
 */
export async function GET(req: NextRequest) {
  return withPlatform({}, async () => {
    const live = req.nextUrl.searchParams.get('live') === '1'
    const diagnostics = await getEmailDiagnostics(live)
    return NextResponse.json(diagnostics)
  })
}
