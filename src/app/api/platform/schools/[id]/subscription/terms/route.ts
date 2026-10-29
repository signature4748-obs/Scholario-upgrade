import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { resolvePlanForPurchase, planPrice } from '@/lib/subscription/plans'
import { BILLING_MODELS } from '@/lib/subscription/config'
import { z } from 'zod'

export const runtime = 'nodejs'

const termsSchema = strictBody({
  /** Link the school to a registry plan (SCHOOL scope, ACTIVE). Sets
   *  planId + planCode; the plan's interval is adopted unless an explicit
   *  interval is also supplied. null clears the linkage. */
  planCode: z.string().min(3).max(40).nullable().optional(),
  /** Commercial model this tenant is billed under. */
  billingModel: z.enum(BILLING_MODELS).optional(),
  /** MONTHLY | ANNUAL (PER_STUDENT tenants are ANNUAL by contract). */
  interval: z.enum(['MONTHLY', 'ANNUAL']).nullable().optional(),
  /** The UNIT price actually charged to this school: per-student annual
   *  price under PER_STUDENT billing, the whole-school fee otherwise.
   *  null clears the snapshot (the plan's catalogue price applies again). */
  price: z.number().positive().max(100_000_000).nullable().optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(),
  /** Licensed student quantity for PER_STUDENT billing (the count the
   *  per-student price multiplies). null clears it. */
  licensedStudents: z.number().int().min(1).max(100_000).nullable().optional(),
  /** Subscription start date (YYYY-MM-DD, within ±1 year of today). */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Audited reason — required (this is commercial-terms surgery). */
  reason: z.string().min(4).max(400),
})

/**
 * PATCH /api/platform/schools/[id]/subscription/terms — update the school's
 * commercial terms AFTER creation (BILLING, STEP-UP).
 *
 * THE MISSING CONTROL-PLANE CAPABILITY (2026-10-29 subscription UX
 * redesign): before this route, billingModel / licensedStudents /
 * priceSnapshot / interval / periodStart / plan linkage could only be set
 * inside the add-school wizard (or incidentally when a plan payment was
 * recorded). licensedStudents in particular was immutable after creation.
 * This route writes EXACTLY those existing SchoolSubscription columns —
 * no new fields, no new enums — so an existing school can be assigned or
 * renegotiated at any time.
 *
 * HONEST BILLING CONTRACT (unchanged): setting terms is NOT a payment.
 * status / periodEnd / overrideStatus are never touched here — the paid
 * period only moves when a VERIFIED payment is recorded (or a code is
 * redeemed). The response says so.
 *
 * Permission: billing.manage + live step-up (identical posture to the
 * payment-recording and override routes).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, termsSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      // ── Current terms (rich select; a pre-migration database fails
      // honestly through the central SUBSCRIPTION_SYSTEM_PENDING
      // classifier — terms management needs the pending columns). ──
      const current = await db.schoolSubscription.findUnique({
        where: { schoolId: school.id },
        select: {
          id: true,
          billingModel: true,
          licensedStudents: true,
          interval: true,
          planId: true,
          planCode: true,
          priceSnapshot: true,
          currencySnapshot: true,
          periodStart: true,
          status: true,
          periodEnd: true,
        },
      })

      // ── Plan linkage (optional). SCHOOL-scope ACTIVE plans only — the
      // school's own subscription; per-student products are assigned per
      // student through the student-entitlement flow, never here. ──
      let plan: Awaited<ReturnType<typeof resolvePlanForPurchase>> | null = null
      if (body.planCode !== undefined && body.planCode !== null) {
        plan = await resolvePlanForPurchase({
          code: body.planCode,
          expectedScope: 'SCHOOL',
          // Linking terms is not a purchase: neither new nor renewal
          // availability should block a metadata linkage.
          kind: 'assignment',
        })
      }

      // ── Merge onto the current values (partial update semantics). ──
      const finalModel = body.billingModel ?? current?.billingModel ?? 'SCHOOL_WIDE'
      const finalInterval =
        body.interval !== undefined
          ? body.interval
          : current?.interval ?? (plan ? plan.interval : null)
      const finalLicensed =
        body.licensedStudents !== undefined ? body.licensedStudents : current?.licensedStudents ?? null
      const finalPrice =
        body.price !== undefined ? body.price : current?.priceSnapshot == null ? null : Number(current.priceSnapshot)
      const finalCurrency = body.currency ?? current?.currencySnapshot ?? 'INR'
      const finalPeriodStart = body.periodStart
        ? new Date(`${body.periodStart}T00:00:00Z`)
        : current?.periodStart ?? null

      // ── Cross-field commercial rules (mirrors the add-school wizard's
      // server-side contract — one rule set, both entry points). ──
      if (finalModel === 'PER_STUDENT' && finalInterval === 'MONTHLY') {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage:
            'Per-student billing is charged yearly only — choose annual, or switch to school-wide billing for monthly.',
          internalDetail: 'terms: PER_STUDENT + MONTHLY refused',
        })
      }
      if (finalModel === 'PER_STUDENT' && finalLicensed == null) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage:
            'Per-student billing needs the licensed student count (the quantity the per-student price multiplies).',
          internalDetail: 'terms: PER_STUDENT without licensedStudents',
        })
      }
      if (finalLicensed != null && finalModel !== 'PER_STUDENT') {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Licensed student count applies to per-student billing only.',
          internalDetail: 'terms: licensedStudents on non-PER_STUDENT model',
        })
      }
      if (body.periodStart && finalPeriodStart) {
        const days = (Date.now() - finalPeriodStart.getTime()) / 86_400_000
        if (Number.isNaN(finalPeriodStart.getTime()) || days > 366 || days < -366) {
          throw new AppError('VALIDATION_FAILED', {
            publicMessage: 'Subscription start date must be within one year of today.',
            internalDetail: 'terms: periodStart out of range',
          })
        }
      }

      // ── Write (only the commercial-terms columns; the paid period and
      // enforced state are untouched — setting terms is not a payment). ──
      const data: {
        billingModel: string
        planId?: string | null
        planCode?: string | null
        interval?: string | null
        priceSnapshot?: number | null
        currencySnapshot?: string
        licensedStudents?: number | null
        periodStart?: Date
      } = { billingModel: finalModel }
      if (plan) {
        data.planId = plan.id
        data.planCode = plan.code
      } else if (body.planCode === null) {
        data.planId = null
        data.planCode = null
      }
      if (body.interval !== undefined || plan) data.interval = finalInterval
      if (body.price !== undefined) data.priceSnapshot = finalPrice
      if (body.currency) data.currencySnapshot = finalCurrency
      if (body.licensedStudents !== undefined) data.licensedStudents = finalLicensed
      if (body.periodStart && finalPeriodStart) data.periodStart = finalPeriodStart

      const updated = await db.schoolSubscription.upsert({
        where: { schoolId: school.id },
        create: {
          schoolId: school.id,
          status: current?.status ?? 'ACTIVE',
          plan: 'STANDARD',
          ...data,
        },
        update: data,
      })

      // Before → after diff for the audit row (never the price alone —
      // the operator's reason is the human-readable cause).
      const before = {
        planCode: current?.planCode ?? null,
        billingModel: current?.billingModel ?? 'SCHOOL_WIDE',
        interval: current?.interval ?? null,
        priceSnapshot: current?.priceSnapshot == null ? null : Number(current.priceSnapshot),
        currencySnapshot: current?.currencySnapshot ?? null,
        licensedStudents: current?.licensedStudents ?? null,
        periodStart: current?.periodStart?.toISOString() ?? null,
      }
      const after = {
        planCode: updated.planCode,
        billingModel: updated.billingModel,
        interval: updated.interval,
        priceSnapshot: updated.priceSnapshot == null ? null : Number(updated.priceSnapshot),
        currencySnapshot: updated.currencySnapshot,
        licensedStudents: updated.licensedStudents,
        periodStart: updated.periodStart?.toISOString() ?? null,
      }

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.terms_updated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: { before, after },
      }).catch(() => {})

      // Catalogue price context for the UI (honest: what the plan normally
      // charges vs what this school was set to).
      const cataloguePrice = plan ? planPrice(plan).amount : null

      return {
        ok: true,
        terms: after,
        ...(cataloguePrice != null ? { cataloguePrice, catalogueCurrency: plan!.currency } : {}),
        message:
          'Commercial terms saved. This records the agreed plan and price only — the paid period still starts (or extends) when a verified payment is recorded.',
      }
    },
    { method: 'PATCH' },
  )
}
