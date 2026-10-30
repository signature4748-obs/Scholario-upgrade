import { NextRequest } from 'next/server'
import { AppError } from '@/lib/security/errors'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, clientIpFromHeaders, RATE_LIMITS } from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { claimStaffActivationCode } from '@/lib/subscription/codes'
import { publicStaffEntitlement } from '@/lib/entitlement/staff'
import { z } from 'zod'

export const runtime = 'nodejs'

const claimSchema = strictBody({
  code: z.string().min(12).max(40),
})

/**
 * POST /api/subscription/staff/claim — a TEACHER claims their staff
 * activation code (role TEACHER; allowLockedSubscription so a per-seat
 * locked teacher can always activate).
 *
 * Same discipline as the student claim surface:
 *  · the claimant identity + canonical role + tenant come from the
 *    SESSION (never from the request body) — a student or principal
 *    session is rejected by scope before anything else;
 *  · double rate limits (per-user AND per-IP) on the 5/15-min
 *    subscriptionCodeClaim budget — code guessing is capped;
 *  · one atomic transaction with a conditional ISSUED→CLAIMED update —
 *    concurrent claims cannot double-activate (the partial unique index
 *    StaffEntitlement_one_live_per_user is the DB backstop);
 *  · generic rejection messages (no existence/scope oracle); rejection
 *    reason classes land in ActivationCodeEvent for forensics.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const body = await parseJsonBody(req, claimSchema)
      const ip = clientIpFromHeaders(req.headers)
      if (!user.schoolId) {
        throw new AppError('FORBIDDEN', { internalDetail: 'staff claim: no school binding' })
      }
      // Server-verified identity against the tenant's EFFECTIVE staff role
      // coverage (tenant override → linked plan's declaration → default).
      // A role outside the covered set can never redeem a staff code —
      // never a student, never a principal, regardless of the code's scope.
      const { resolveStaffCoveredRoles } = await import('@/lib/subscription/staff')
      const tenantSub = await db.schoolSubscription.findUnique({
        where: { schoolId: user.schoolId },
        select: { staffCoverageRoles: true, planDef: { select: { coveredRoles: true } } },
      })
      const coveredRoles = resolveStaffCoveredRoles({
        tenantRoles: tenantSub?.staffCoverageRoles,
        planRoles: tenantSub?.planDef?.coveredRoles,
      })
      if (!coveredRoles.includes(user.role)) {
        throw new AppError('SUBSCRIPTION_REQUIRED', {
          publicMessage: 'Staff activation codes can be redeemed by the staff roles this school\u2019s plan covers only.',
          internalDetail: `staff claim: role ${user.role} not in covered set [${coveredRoles.join(',')}]`,
        })
      }
      enforceRateLimit(`rl:subclaim:${user.id}`, RATE_LIMITS.subscriptionCodeClaim)
      enforceRateLimit(`rl:subclaim-ip:${ip}`, RATE_LIMITS.subscriptionCodeClaim)

      const result = await claimStaffActivationCode(body.code, {
        userId: user.id,
        schoolId: user.schoolId,
        role: user.role,
        coveredRoles,
        ip,
      })

      auditEvent({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'STAFF_SUBSCRIPTION_CODE_CLAIMED',
        ip: ip ?? undefined,
        detail: `publicRef=${result.publicRef} status=${result.status} validUntil=${result.validityEnd.toISOString().slice(0, 10)}`,
      }).catch(() => {})

      return {
        ok: true,
        entitlement: publicStaffEntitlement(
          { state: result.status, businessAllowed: result.status === 'ACTIVE', needsIndividualEntitlement: false, message: null, validityEnd: result.validityEnd },
          { source: 'OFFLINE_CODE', planCode: result.planCode },
        ),
        publicRef: result.publicRef,
        validityStart: result.validityStart.toISOString(),
        validityEnd: result.validityEnd.toISOString(),
        status: result.status,
        message:
          result.status === 'SUSPENDED'
            ? 'Code redeemed. Your entitlement is currently suspended — the paid period is reserved and starts when your administrator reactivates it.'
            : result.status === 'PENDING'
              ? `Code redeemed. Your staff subscription starts on ${result.validityStart.toISOString().slice(0, 10)}.`
              : `Code redeemed. Your staff subscription is active until ${result.validityEnd.toISOString().slice(0, 10)}.`,
      }
    },
    { allowLockedSubscription: true },
  )
}
