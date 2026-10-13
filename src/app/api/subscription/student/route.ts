import { withUser } from '@/lib/api'
import { db } from '@/lib/db'
import { entitlementForUser } from '@/lib/entitlement/server'
import { evaluateStudentEntitlement, publicStudentEntitlement } from '@/lib/entitlement/student'
import { loadSubscriptionConfig } from '@/lib/subscription/config'

export const runtime = 'nodejs'

/**
 * GET /api/subscription/student — the student's OWN subscription status
 * (STUDENT role; exempt-route reachable so a locked student can always see
 * why and how to activate).
 *
 * Server-side evaluation from the session identity: school-wide coverage
 * vs the individual entitlement, the live validity window, and the
 * purchasable student plans (real configured prices — never invented).
 * NEVER exposes another student's state or codes.
 */
export async function GET() {
  return withUser(
    async (user) => {
      if (user.role !== 'STUDENT' || !user.schoolId) {
        return { ok: false as const, error: 'Student subscription status is available to student accounts.' }
      }

      const [student, config, plans] = await Promise.all([
        db.student.findUnique({
          where: { userId: user.id },
          select: { id: true, schoolId: true, admissionNo: true },
        }),
        loadSubscriptionConfig(),
        db.subscriptionPlan.findMany({
          where: { scope: 'STUDENT', status: 'ACTIVE', allowOnline: true, availableForNew: true },
          orderBy: [{ sortOrder: 'asc' }],
          select: { code: true, name: true, description: true, pricePerStudent: true, currency: true },
        }),
      ])

      if (!student || student.schoolId !== user.schoolId) {
        return { ok: false as const, error: 'No student record is linked to this account.' }
      }

      const live = await db.studentEntitlement.findFirst({
        where: { studentId: student.id, status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
        orderBy: { validityEnd: 'desc' },
        select: { status: true, validityStart: true, validityEnd: true, source: true, planCode: true },
      })
      const lastRevoked = await db.studentEntitlement.findFirst({
        where: { studentId: student.id, status: 'REVOKED' },
        orderBy: { revokedAt: 'desc' },
        select: { revokedAt: true, revokeReason: true },
      })

      const tenant = entitlementForUser(user)
      const decision = evaluateStudentEntitlement({
        accountSubscriptionStatus: user.subscriptionStatus,
        tenant,
        billingModel: user.school?.subscription?.billingModel,
        entitlement: live,
      })

      const [lastPayment] = await db.studentSubscriptionPayment.findMany({
        where: { studentId: student.id },
        orderBy: { paymentDate: 'desc' },
        take: 1,
        select: { receiptNo: true, amount: true, currency: true, mode: true, paymentDate: true, validityEndAfter: true },
      })

      return {
        entitlement: publicStudentEntitlement(decision, live ?? {}),
        billingModel: user.school?.subscription?.billingModel ?? 'SCHOOL_WIDE',
        coveredBySchool: decision.state === 'COVERED_BY_SCHOOL',
        lastRevoked: lastRevoked
          ? { revokedAt: lastRevoked.revokedAt?.toISOString() ?? null, reason: lastRevoked.revokeReason }
          : null,
        lastPayment: lastPayment
          ? {
              receiptNo: lastPayment.receiptNo,
              amount: Number(lastPayment.amount),
              currency: lastPayment.currency,
              mode: lastPayment.mode,
              paymentDate: lastPayment.paymentDate.toISOString(),
              validityEndAfter: lastPayment.validityEndAfter?.toISOString() ?? null,
            }
          : null,
        plans: plans.map((p) => ({
          code: p.code,
          name: p.name,
          description: p.description,
          price: Number(p.pricePerStudent ?? 0),
          currency: p.currency,
        })),
        onlinePaymentsAvailable: config.models.student.enabled,
        claimInstructions: {
          message:
            'Your school office issues activation codes for offline payments. Enter your code below to activate your subscription.',
        },
      }
    },
    { allowLockedSubscription: true },
  )
}
