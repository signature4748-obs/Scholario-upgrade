import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import {
  recordPlatformPayment,
  applySchoolSubscriptionPeriodInTx,
  recordDeferredSchoolPaymentInTx,
  PAYMENT_MODES,
  type PaymentMode,
} from '@/lib/platform/billing'
import { resolvePlanForPurchase, planPrice } from '@/lib/subscription/plans'
import { BILLING_MODELS } from '@/lib/subscription/config'
import { issueActivationCode } from '@/lib/subscription/codes'
import { z } from 'zod'

export const runtime = 'nodejs'

const recordSchema = strictBody({
  /** Legacy path (no planCode): free-form amount/months exactly as before. */
  planCode: z.string().min(3).max(40).optional(),
  amount: z.number().positive().max(100_000_000),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  mode: z.enum(PAYMENT_MODES),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  periodMonths: z.number().int().min(1).max(60).default(12),
  reference: z.string().max(120).optional(),
  notes: z.string().max(600).optional(),
  /**
   * SUBSCRIPTION & ENTITLEMENT SYSTEM (offline Model A flow): issue a
   * school-wide activation code. The VERIFIED payment row is recorded
   * immediately (immutable financial record); the subscription activates
   * when the school redeems the code. Default false = legacy direct
   * activation (backwards compatible).
   */
  issueActivationCode: z.boolean().default(false),
  claimWindowDays: z.number().int().min(1).max(365).optional(),
  billingModel: z.enum(BILLING_MODELS).optional(),
})

/**
 * POST /api/platform/schools/[id]/subscription/payments — record a
 * VERIFIED offline payment (BILLING, STEP-UP).
 *
 * Two paths:
 *   LEGACY (no planCode): recordPlatformPayment — direct activation,
 *     exactly the documented Phase-8 behavior (tests rely on it).
 *   PLAN-DRIVEN (planCode): validates the plan (school scope, offline
 *     allowed), snapshots plan/interval/price, optionally sets the
 *     tenant's billing model, and either activates directly OR (with
 *     issueActivationCode) records the VERIFIED payment + issues the
 *     school-wide activation code for the principal to redeem.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, recordSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true, subscription: true } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      const paymentDate =
        body.paymentDate.length === 10 ? new Date(`${body.paymentDate}T00:00:00Z`) : new Date(body.paymentDate)

      // Optional billing-model change (only via this controlled flow). It
      // is applied INSIDE (or after) the successful payment path — never
      // committed on a request that fails plan/price validation first.
      const modelChange =
        body.billingModel && body.billingModel !== (school.subscription?.billingModel ?? 'SCHOOL_WIDE')
          ? body.billingModel
          : null

      // ── LEGACY path: no planCode → the original direct-activation flow. ──
      if (!body.planCode) {
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
        // The model switch follows the successful payment (best-effort —
        // the financial record stands; a failed switch is surfaced in the
        // audit metadata rather than failing the recorded payment).
        let modelApplied = false
        if (modelChange) {
          try {
            await db.schoolSubscription.upsert({
              where: { schoolId: school.id },
              create: { schoolId: school.id, billingModel: modelChange, plan: school.subscription?.plan ?? 'STANDARD' },
              update: { billingModel: modelChange },
            })
            modelApplied = true
          } catch {
            modelApplied = false
          }
        }
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
            billingModelRequested: modelChange,
            billingModelApplied: modelApplied,
          },
        }).catch(() => {})
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
      }

      // ── PLAN-DRIVEN path (Model A offline). ──
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: 'SCHOOL',
        kind: 'new',
        requireOffline: body.mode !== 'ONLINE_PAYMENT',
      })
      const price = planPrice(plan)
      if (Math.abs(price.amount - body.amount) > 0.01) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: `Recorded amount (${body.amount}) does not match the plan price (${price.amount} ${plan.currency}). Record the actual paid amount equal to the plan price, or use the legacy path without a plan.`,
          internalDetail: `plan price mismatch: plan ${plan.code} ${price.amount} vs ${body.amount}`,
        })
      }

      if (!body.issueActivationCode) {
        // Plan-driven direct activation (online-recorded/manual with plan).
        const result = await db.$transaction(async (tx) =>
          applySchoolSubscriptionPeriodInTx(tx, {
            schoolId: school.id,
            planId: plan.id,
            planCode: plan.code,
            interval: price.interval,
            priceSnapshot: price.amount,
            currency: plan.currency,
            amount: body.amount,
            mode: body.mode as PaymentMode,
            paymentDate,
            validityMonths: price.interval === 'MONTHLY' ? 1 : 12,
            reference: body.reference ?? null,
            notes: body.notes ?? null,
            recordedById: ctx.admin.id,
            // Model switch rides the payment transaction.
            billingModel: modelChange,
          }),
        )
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.payment_recorded',
          targetType: 'SCHOOL',
          targetId: school.id,
          schoolId: school.id,
          ip,
          reason: body.notes ?? 'Offline plan payment recorded (direct activation)',
          metadata: {
            planCode: plan.code,
            interval: price.interval,
            amount: body.amount,
            mode: body.mode,
            receiptNo: result.receiptNo,
            statusAfter: result.statusAfter,
            periodEndAfter: result.periodEndAfter.toISOString(),
          },
        }).catch(() => {})
        return {
          ok: true,
          payment: {
            id: result.paymentId,
            receiptNo: result.receiptNo,
            statusAfter: result.statusAfter,
            periodEndAfter: result.periodEndAfter.toISOString(),
          },
          message: `Plan ${plan.code} payment recorded (receipt ${result.receiptNo}). Subscription ACTIVE until ${result.periodEndAfter.toISOString().slice(0, 10)}.`,
        }
      }

      // Offline code handshake: VERIFIED payment row + school-wide code;
      // the subscription activates when the principal redeems the code.
      // recordDeferredSchoolPaymentInTx records the payment WITHOUT
      // applying the period (activation happens at redemption through
      // existingPaymentId) — no apply-then-rollback of live tenant state,
      // no stale-snapshot risk.
      const issued = await db.$transaction(async (tx) => {
        const payment = await recordDeferredSchoolPaymentInTx(tx, {
          schoolId: school.id,
          planId: plan.id,
          planCode: plan.code,
          interval: price.interval,
          priceSnapshot: price.amount,
          currency: plan.currency,
          amount: body.amount,
          mode: body.mode as PaymentMode,
          paymentDate,
          validityMonths: price.interval === 'MONTHLY' ? 1 : 12,
          reference: body.reference ?? null,
          notes: (body.notes ?? 'Offline plan payment — activation code issued') + ' [PENDING REDEMPTION]',
          recordedById: ctx.admin.id,
          billingModel: modelChange,
        })
        const code = await issueActivationCode({
          scope: 'SCHOOL_SUBSCRIPTION',
          schoolId: school.id,
          planId: plan.id,
          planCode: plan.code,
          interval: price.interval,
          validityMonths: price.interval === 'MONTHLY' ? 1 : 12,
          claimWindowDays: body.claimWindowDays ?? 30,
          issuedById: ctx.admin.id,
          paymentRef: `platformPayment:${payment.paymentId}`,
          tx,
        })
        return { payment, code }
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.payment_recorded',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.notes ?? 'Offline plan payment recorded + school activation code issued',
        metadata: {
          planCode: plan.code,
          amount: body.amount,
          mode: body.mode,
          receiptNo: issued.payment.receiptNo,
          publicRef: issued.code.publicRef,
          activation: 'CODE_REDEMPTION',
        },
      }).catch(() => {})

      return {
        ok: true,
        payment: { id: issued.payment.paymentId, receiptNo: issued.payment.receiptNo },
        activationCode: {
          codeId: issued.code.codeId,
          publicRef: issued.code.publicRef,
          /** The ONLY copy — show once, deliver to the principal. */
          code: issued.code.code,
          expiresAt: issued.code.expiresAt.toISOString(),
        },
        message: `Payment recorded (receipt ${issued.payment.receiptNo}). Activation code ${issued.code.publicRef} issued — the subscription activates when the school redeems it. Show and copy the code now; it will not be visible again.`,
      }
    },
    { method: 'POST' },
  )
}
