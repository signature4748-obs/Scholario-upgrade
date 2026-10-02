import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError, newRequestId } from '@/lib/security/errors'
import { strictBody, cuidSchema, parseJsonBody } from '@/lib/security/validation'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { publishToUser } from '@/lib/realtime/publish'
import { sendEmail } from '@/lib/email'
import { serializePayment } from '../serialize'

export const runtime = 'nodejs'

/**
 * POST /api/salary/payments — the principal records one monthly payment.
 *
 * PRINCIPAL / MANAGEMENT only. One RECORDED row per (school, teacher,
 * month) — enforced by the storage-layer unique key; a duplicate POST is
 * answered 409 with code SALARY_PAYMENT_DUPLICATE and the existing row
 * (the caller's OWN tenant data — safe to surface). VOIDED rows survive as
 * the audit trail, so a voided month may be re-recorded.
 *
 * Month is 'YYYY-MM' (not the future beyond +1 month — payroll is never
 * pre-recorded further than the current cycle) and is normalized to the
 * first day of that month, UTC. Every write is audit-logged
 * (SALARY_PAYMENT_RECORDED) and realtime-published to the teacher's user
 * channel ('salary' — a notification signal only, never row data).
 */
const paymentBodySchema = strictBody({
  teacherId: cuidSchema,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be a YYYY-MM period key'),
  amount: z
    .number({ message: 'amount must be a number' })
    .finite()
    .positive()
    .max(5_000_000, 'amount must be at most ₹50,00,000'),
  paidOn: z.string().datetime({ offset: true }).optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER']).optional(),
  reference: z.string().max(100, 'reference must be at most 100 characters').optional(),
  note: z.string().max(500, 'note must be at most 500 characters').optional(),
})

/** Current month + 1 in 'YYYY-MM' — the farthest recordable period. */
function maxRecordableMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
    async (ctx) => {
      const { user, schoolId } = ctx

      const body = await parseJsonBody(req, paymentBodySchema)

      if (body.month > maxRecordableMonth()) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'month cannot be further ahead than next month',
          internalDetail: `salary payment POST: month ${body.month} beyond +1 month`,
        })
      }

      // Abuse brake — the salary mutation budget (30/h per user).
      enforceRateLimit(`rl:salary:usr:${user.id}`, RATE_LIMITS.salary)

      // ── Teacher FK must exist in THIS school (no existence oracle) ────
      const teacher = await db.teacher.findFirst({
        where: { id: body.teacherId, schoolId },
        select: { id: true, userId: true, user: { select: { name: true, email: true, status: true } } },
      })
      if (!teacher) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Teacher not found',
          internalDetail: `salary payment POST: teacher ${body.teacherId} missing or foreign tenant`,
        })
      }

      // ── Normalize month → first day of month, UTC ────────────────────
      const [y, m] = body.month.split('-').map(Number)
      const monthDate = new Date(Date.UTC(y, m - 1, 1))

      const paidOn = body.paidOn ? new Date(body.paidOn) : new Date()
      if (Number.isNaN(paidOn.getTime())) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'paidOn is not a valid datetime' })
      }

      let payment
      try {
        payment = await db.salaryPayment.create({
          data: {
            schoolId,
            teacherId: body.teacherId,
            month: monthDate,
            amount: body.amount,
            paidOn,
            method: body.method ?? null,
            reference: body.reference?.trim() || null,
            note: body.note?.trim() || null,
            status: 'RECORDED',
            recordedById: user.id,
          },
          include: {
            teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
          },
        })
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'P2002') {
          // Storage-layer duplicate: one RECORDED row per (school, teacher,
          // month). Surface the caller's own existing row — same tenant,
          // safe data — as a typed 409 envelope (code SALARY_PAYMENT_
          // DUPLICATE + `existing` payload).
          const existing = await db.salaryPayment.findFirst({
            where: { schoolId, teacherId: body.teacherId, month: monthDate, status: 'RECORDED' },
            include: {
              teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
            },
          })
          const requestId = (await headers()).get('x-request-id') ?? newRequestId()
          const serialized = existing ? serializePayment(existing) : null
          return NextResponse.json(
            {
              ok: false,
              error: serialized
                ? `A payment for ${body.month} was already recorded for ${serialized.teacher.user.name} on ${serialized.paidOn.slice(0, 10)} (₹${serialized.amount.toLocaleString('en-IN')}${serialized.method ? ` · ${serialized.method}` : ''}). Void it first to re-record.`
                : `A payment for ${body.month} is already recorded for this teacher. Void it first to re-record.`,
              code: 'SALARY_PAYMENT_DUPLICATE',
              requestId,
              existing: serialized,
            },
            { status: 409, headers: { 'Cache-Control': 'no-store' } },
          )
        }
        throw e
      }

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'SALARY_PAYMENT_RECORDED',
        detail: `Salary payment recorded — ${teacher.user.name ?? 'teacher'} · ${body.month} · ₹${body.amount.toLocaleString('en-IN')} by ${user.name}`,
      }).catch(() => {})

      // Realtime notification signal to the teacher's own channel —
      // ids/hints only, amount as string; the DB stays the source of truth.
      await publishToUser(schoolId, teacher.userId, 'salary', {
        id: payment.id,
        at: payment.createdAt.toISOString(),
        month: body.month,
        amount: payment.amount.toFixed(2),
      }).catch(() => {})

      // PHASE 8B (8B-7-e trigger) — canonical payment receipt email to the
      // teacher (tenant-branded, idempotent on the payment row id). The
      // dev/test transport logs instead of sending until RESEND_API_KEY is
      // provisioned; sendEmail never throws, so the API contract is safe.
      if (teacher.user.email) {
        const emailRequestId = (await headers()).get('x-request-id') ?? newRequestId()
        await sendEmail({
          to: teacher.user.email,
          template: 'salary-payment-recorded',
          props: {
            teacherName: teacher.user.name ?? 'Teacher',
            month: body.month,
            amount: payment.amount.toFixed(2),
          },
          schoolId,
          dedupeKey: `salary-payment:${payment.id}`,
          requestId: emailRequestId,
        })
      }

      return serializePayment(payment)
    },
  ) as Promise<Response>
}
