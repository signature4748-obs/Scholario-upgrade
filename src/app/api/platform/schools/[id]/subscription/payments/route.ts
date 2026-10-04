import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { recordPlatformPayment, PAYMENT_MODES, type PaymentMode } from '@/lib/platform/billing'
import { z } from 'zod'

export const runtime = 'nodejs'

const recordSchema = strictBody({
  amount: z.number().positive().max(100_000_000),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  mode: z.enum(PAYMENT_MODES),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  periodMonths: z.number().int().min(1).max(60).default(12),
  reference: z.string().max(120).optional(),
  notes: z.string().max(600).optional(),
})

/**
 * POST /api/platform/schools/[id]/subscription/payments — record a
 * VERIFIED offline payment (BILLING, STEP-UP).
 *
 * The platform admin records what the school actually paid:
 *   School · Amount · Currency · Payment mode · Payment date ·
 *   Subscription period · Reference number · Notes · Recorded by ·
 *   Timestamp · Receipt/audit information
 *
 * After a verified manual payment the subscription becomes ACTIVE for
 * THAT SCHOOL ONLY (recordPlatformPayment is transactional: payment row
 * + subscription extension + snapshots atomically; receipt numbered
 * SCH-RCP-<year>-<seq>; full platform audit trail). This is the A-domain
 * (school pays SCHOLARIO) — never mixed with student-fee payments.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, recordSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      const paymentDate =
        body.paymentDate.length === 10
          ? new Date(`${body.paymentDate}T00:00:00Z`)
          : new Date(body.paymentDate)

      const result = await recordPlatformPayment({
        schoolId: school.id,
        amount: body.amount,
        currency: body.currency,
        mode: body.mode as PaymentMode,
        paymentDate,
        periodMonths: body.periodMonths,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        recordedById: ctx.admin.id,
        source: 'admin',
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.payment_recorded',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.notes ?? 'Offline subscription payment recorded',
        metadata: {
          receiptNo: result.receiptNo,
          amount: body.amount,
          currency: body.currency,
          mode: body.mode,
          periodMonths: body.periodMonths,
          statusAfter: result.statusAfter,
          periodEndAfter: result.periodEndAfter.toISOString(),
        },
      })

      return {
        ok: true,
        payment: {
          id: result.paymentId,
          receiptNo: result.receiptNo,
          statusAfter: result.statusAfter,
          periodEndAfter: result.periodEndAfter.toISOString(),
        },
        message: `Payment recorded (receipt ${result.receiptNo}). Subscription is ACTIVE until ${result.periodEndAfter.toISOString().slice(0, 10)}.`,
      }
    },
    { method: 'POST' },
  )
}
