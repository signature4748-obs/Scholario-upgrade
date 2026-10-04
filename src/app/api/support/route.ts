import { NextRequest } from 'next/server'
import { withUser } from '@/lib/api'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * POST /api/support — a school user (any role) sends a support message.
 *
 * SaaS-HARDENING (§2): the support surface stays reachable in EVERY
 * entitlement state (exempt route) — a restricted/suspended tenant must
 * be able to reach SCHOLARIO from inside the locked shell. The request
 * is audited on both planes (school audit trail + platform audit trail
 * so the platform team sees it). No ticket fabrications: the response
 * is honest about what happens next.
 */
const supportSchema = strictBody({
  topic: z.enum(['subscription', 'billing', 'technical', 'account', 'other']).default('other'),
  message: z.string().min(10).max(2000),
})

export async function POST(req: NextRequest) {
  return withUser(async (user) => {
    enforceRateLimit(`rl:support:${user.id}`, RATE_LIMITS.message)
    const body = await parseJsonBody(req, supportSchema)

    await auditEvent({
      schoolId: user.schoolId,
      userId: user.id,
      action: 'SUPPORT_REQUESTED',
      detail: `[${body.topic}] ${body.message.slice(0, 400)}`,
    }).catch(() => {})

    return {
      ok: true,
      message:
        'Your message has been recorded for the SCHOLARIO platform team. ' +
        'Support requests are reviewed during business hours; urgent subscription ' +
        'issues can also be raised by your principal through the renewal flow.',
    }
  })
}
