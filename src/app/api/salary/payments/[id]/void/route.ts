import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz, assertTenantRow } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { publishToUser } from '@/lib/realtime/publish'
import { serializePayment } from '../../../serialize'

export const runtime = 'nodejs'

/**
 * POST /api/salary/payments/[id]/void — void a RECORDED payment.
 *
 * PRINCIPAL / MANAGEMENT only. Cross-tenant ids fail safe as 404 (the row
 * "does not exist" for this tenant); only RECORDED rows can be voided
 * (409 otherwise — a VOIDED row is never re-voided). Voiding keeps the row
 * as the audit trail and frees the (teacher, month) slot so the payment
 * can be re-recorded.
 *
 * Audited as SALARY_PAYMENT_VOIDED; a realtime 'salary' signal
 * ({ id, at, voided: true }) notifies the teacher.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
    async (ctx) => {
      const { user, schoolId } = ctx
      const { id } = await params

      // Abuse brake — the salary mutation budget (30/h per user).
      enforceRateLimit(`rl:salary:usr:${user.id}`, RATE_LIMITS.salary)

      // ── Tenant-checked load (404 on missing/foreign — no oracle) ─────
      // assertTenantRow both validates and RETURNS the non-null row —
      // assignment keeps the narrowed type for the code below.
      const payment = assertTenantRow(
        await db.salaryPayment.findFirst({
          where: { id },
          include: {
            teacher: { select: { id: true, employeeId: true, userId: true, user: { select: { name: true } } } },
          },
        }),
        ctx,
        'Salary payment',
      )

      if (payment.status !== 'RECORDED') {
        throw new AppError('CONFLICT', {
          publicMessage: 'Only a recorded payment can be voided',
          internalDetail: `salary void: payment ${id} status ${payment.status}`,
        })
      }

      const voided = await db.salaryPayment.update({
        where: { id },
        data: { status: 'VOIDED' },
        include: {
          teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
        },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SALARY_PAYMENT_VOIDED',
        detail: `Salary payment voided — ${payment.teacher.user.name ?? 'teacher'} · ${voided.month.toISOString().slice(0, 7)} · ₹${voided.amount.toFixed(2)} by ${user.name}`,
      }).catch(() => {})

      await publishToUser(schoolId, payment.teacher.userId, 'salary', {
        id: voided.id,
        at: voided.updatedAt.toISOString(),
        voided: true,
      }).catch(() => {})

      return serializePayment(voided)
    },
  ) as Promise<Response>
}
