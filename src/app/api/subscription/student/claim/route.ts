import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS, clientIpFromHeaders } from '@/lib/security/rate-limit'
import { claimStudentActivationCode } from '@/lib/subscription/codes'

export const runtime = 'nodejs'

const claimSchema = strictBody({
  code: z.string().min(10).max(60),
})

/**
 * POST /api/subscription/student/claim — a STUDENT claims their
 * student-specific activation code (Model B/C offline delivery).
 *
 * Security contract (codes.ts):
 *   · Authenticated claimant; the student identity is resolved from the
 *     session (server-side) — client input NEVER supplies tenant/student.
 *   · Per-user + per-IP anti-guessing rate limits (5 / 15 min).
 *   · The claim is ONE atomic transaction: conditional UPDATE
 *     (ISSUED→CLAIMED) + entitlement creation, backed by the partial
 *     unique index (one live entitlement per student — concurrent
 *     double-claims are impossible).
 *   · Generic error responses — no oracle about the code's existence,
 *     scope, owner or another tenant's state. Rejection reason classes
 *     are recorded internally (ActivationCodeEvent) for diagnostics.
 *   · Exempt-route reachable: a NOT_SUBSCRIBED student can always claim
 *     (that is the point of the surface).
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'STUDENT') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Only student accounts can claim student activation codes.',
          internalDetail: `student claim by role ${user.role}`,
        })
      }
      const schoolId = schoolScoped(user)
      const ip = clientIpFromHeaders(req.headers)
      enforceRateLimit(`rl:subclaim:${user.id}`, RATE_LIMITS.subscriptionCodeClaim)
      enforceRateLimit(`rl:subclaim-ip:${ip}`, RATE_LIMITS.subscriptionCodeClaim)

      const body = await parseJsonBody(req, claimSchema)

      const student = await db.student.findUnique({
        where: { userId: user.id },
        select: { id: true, schoolId: true },
      })
      if (!student || student.schoolId !== schoolId) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'No student record is linked to this account.',
          internalDetail: 'student claim: no student row for session user',
        })
      }

      const result = await claimStudentActivationCode(body.code, {
        userId: user.id,
        schoolId,
        studentId: student.id,
        ip,
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'STUDENT_SUBSCRIPTION_CODE_CLAIMED',
        detail: `Activation code ${result.publicRef} claimed — entitlement ${result.status} until ${result.validityEnd.toISOString().slice(0, 10)}`,
      }).catch(() => {})

      return {
        ok: true,
        entitlement: {
          status: result.status,
          validityStart: result.validityStart.toISOString(),
          validityEnd: result.validityEnd.toISOString(),
          planCode: result.planCode,
        },
        message:
          result.status === 'SUSPENDED'
            ? `Code accepted — the paid period is reserved until ${result.validityEnd.toISOString().slice(0, 10)}. Your subscription is currently suspended; it starts when your school reactivates it.`
            : result.status === 'PENDING'
              ? `Code accepted — your subscription starts on ${result.validityStart.toISOString().slice(0, 10)} and runs until ${result.validityEnd.toISOString().slice(0, 10)}.`
              : `Subscription active until ${result.validityEnd.toISOString().slice(0, 10)}.`,
      }
    },
    { allowLockedSubscription: true },
  )
}
