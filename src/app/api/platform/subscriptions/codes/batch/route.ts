import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { resolvePlanForPurchase, planPrice } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'
import { recordDeferredSchoolPaymentInTx } from '@/lib/platform/billing'
import { issueActivationCodeBatch, BATCH_CODE_LIMITS } from '@/lib/subscription/codes'
import { resolveStaffCoveredRoles } from '@/lib/subscription/staff'
import { z } from 'zod'

export const runtime = 'nodejs'

const batchSchema = strictBody({
  schoolId: z.string().min(10).max(40),
  /** Who will redeem the codes: per-student seats or per-seat staff. */
  scope: z.enum(['STUDENT_ENTITLEMENT', 'STAFF_ENTITLEMENT']),
  /** The product every code in the batch unlocks (STUDENT or STAFF scope
   *  plan, ACTIVE, offline-allowed). */
  planCode: z.string().min(3).max(40),
  quantity: z.number().int().min(BATCH_CODE_LIMITS.min).max(BATCH_CODE_LIMITS.max),
  /** Redemption deadline (days after issuance) — separate from the
   *  entitlement validity policy below. */
  claimWindowDays: z.number().int().min(1).max(365).optional(),
  validityMonths: z.number().int().min(1).max(36).optional(),
  /** Explicit entitlement window (Model C date-picked; overrides months).
   *  valid-from is honored; the entitlement expiry stays authoritative. */
  validityStart: z.string().datetime().optional(),
  validityEnd: z.string().datetime().optional(),
  /** Assignment policy: OPEN (securely claimed by any eligible member of
   *  the tenant) or ASSIGNED (pre-bound to specific members — the claim
   *  verifies the authenticated identity against the assignment). */
  assignment: z.enum(['OPEN', 'ASSIGNED']).default('OPEN'),
  /** ASSIGNED only — student ids (STUDENT scope) or staff User ids
   *  (STAFF scope), one per code, order preserved. */
  assignedIds: z.array(z.string().min(10).max(40)).max(BATCH_CODE_LIMITS.max).optional(),
  /** What authorizes this batch: a VERIFIED payment recorded NOW
   *  (deferred — per-seat rows for ASSIGNED, one batch-level row for
   *  OPEN) or an explicitly authorized complimentary grant. Generating
   *  codes is NEVER by itself proof of payment. */
  backing: z.enum(['PAYMENT', 'COMPLIMENTARY']),
  /** PAYMENT: per-code amount (default: the plan's price). Currency. */
  amountPerCode: z.number().min(0).max(100_000_000).optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  reference: z.string().max(120).optional(),
  /** Audited reason — REQUIRED (min 10 chars) for every batch. */
  notes: z.string().min(10).max(600),
})

/**
 * POST /api/platform/subscriptions/codes/batch — generate a configurable
 * batch of student/staff activation codes (BILLING + STEP-UP).
 *
 * · Every code is bound to the tenant, the plan (product), the scope and
 *   the selected validity policy; redemption deadline is independent.
 * · The batch is authorized by a VERIFIED payment (recorded in the SAME
 *   transaction — a failure rolls back every code with it) or an explicit
 *   complimentary grant (separate billing.complimentary permission).
 * · Plaintext codes exist ONCE — returned in this response for the
 *   one-time display; at rest only the keyed verifier; never re-shown by
 *   any GET (the registry exposes publicRef/status only).
 * · Server-verified eligibility: ASSIGNED staff ids must be canonical
 *   TEACHER rows of THIS tenant; ASSIGNED student ids must be Student
 *   rows of THIS tenant. Cross-tenant assignment is impossible.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, batchSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({
        where: { id: body.schoolId },
        select: {
          id: true,
          name: true,
          subscription: { select: { staffCoverageRoles: true } },
        },
      })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      // COMPLIMENTARY = the separate permission-protected workflow.
      if (body.backing === 'COMPLIMENTARY' && !ctx.permissions.has('billing.complimentary')) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Complimentary batches require the billing.complimentary permission.',
          internalDetail: 'codes batch: complimentary without permission',
        })
      }

      const config = await loadSubscriptionConfig()
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: body.scope === 'STUDENT_ENTITLEMENT' ? 'STUDENT' : 'STAFF',
        kind: 'assignment',
        // Operator-recorded batches are offline/hand-verified by definition.
        requireOffline: true,
      })

      // STAFF ROLE COVERAGE (PHASE 5C) — the tenant's EFFECTIVE covered
      // role set (tenant override → the batch plan's declaration →
      // default). A staff batch can only ever bind roles the plan covers;
      // the check runs again per assigned member below and again at claim
      // time (the plan snapshot on the code + the then-current tenant
      // policy agree or the claim is rejected).
      const coveredRoles = resolveStaffCoveredRoles({
        tenantRoles: school.subscription?.staffCoverageRoles,
        planRoles: plan.coveredRoles,
      })

      const amountPerCode = body.backing === 'COMPLIMENTARY'
        ? 0
        : body.amountPerCode ?? planPrice(plan).amount
      if (body.backing === 'COMPLIMENTARY' && (body.amountPerCode ?? 0) !== 0) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Complimentary codes carry no amount — choose the payment backing for paid batches.',
        })
      }
      const paymentDate = body.paymentDate
        ? body.paymentDate.length === 10
          ? new Date(`${body.paymentDate}T00:00:00Z`)
          : new Date(body.paymentDate)
        : new Date()

      // ── Server-verified pre-assignment (tenant-scoped, role-checked). ──
      let assignedIds: string[] | undefined
      if (body.assignment === 'ASSIGNED') {
        if (!body.assignedIds || body.assignedIds.length !== body.quantity) {
          throw new AppError('VALIDATION_FAILED', {
            publicMessage: 'ASSIGNED batches need exactly one member per requested code.',
            internalDetail: 'codes batch: assignedIds count mismatch',
          })
        }
        const unique = new Set(body.assignedIds)
        if (unique.size !== body.assignedIds!.length) {
          throw new AppError('VALIDATION_FAILED', {
            publicMessage: 'Each code must be assigned to a different member.',
            internalDetail: 'codes batch: duplicate assignedIds',
          })
        }
        if (body.scope === 'STUDENT_ENTITLEMENT') {
          const students = await db.student.findMany({
            where: { id: { in: body.assignedIds! }, schoolId: school.id },
            select: { id: true },
          })
          if (students.length !== body.assignedIds!.length) {
            throw new AppError('VALIDATION_FAILED', {
              publicMessage: 'One or more students were not found in this school — nothing was generated.',
              internalDetail: 'codes batch: assigned students outside tenant',
            })
          }
        } else {
          // STAFF: server-verified members of THIS tenant whose canonical
          // role is in the tenant's EFFECTIVE covered role set — never a
          // principal, never a student, never another tenant's user, and
          // never a role the plan does not cover.
          const staff = await db.user.findMany({
            where: { id: { in: body.assignedIds! }, schoolId: school.id, role: { in: coveredRoles } },
            select: { id: true },
          })
          if (staff.length !== body.assignedIds!.length) {
            throw new AppError('VALIDATION_FAILED', {
              publicMessage: 'One or more assigned members are not covered staff accounts of this school — nothing was generated.',
              internalDetail: `codes batch: assigned staff outside tenant / role not in [${coveredRoles.join(',')}]`,
            })
          }
        }
        assignedIds = body.assignedIds
      }

      const validityStart = body.validityStart ? new Date(body.validityStart) : null
      const validityEnd = body.validityEnd ? new Date(body.validityEnd) : null
      if (validityEnd && validityStart && validityEnd.getTime() <= validityStart.getTime()) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Entitlement expiry must be after the validity start.',
        })
      }
      const claimWindowDays = body.claimWindowDays ?? config.student.defaultClaimWindowDays
      const validityMonths = body.validityMonths ?? config.student.defaultValidityMonths

      const result = await db.$transaction(async (tx) => {
        let paymentRefs: (string | null)[] | undefined
        let batchPaymentId: string | null = null
        let batchReceiptNo: string | null = null

        if (body.backing === 'PAYMENT') {
          if (body.assignment === 'ASSIGNED') {
            // Per-seat deferred VERIFIED payment rows (the existing
            // single-code handshake, × N — every code traces to its own
            // immutable financial row).
            paymentRefs = []
            for (const assignedId of assignedIds!) {
              if (body.scope === 'STUDENT_ENTITLEMENT') {
                const { recordStudentPayment } = await import('@/lib/subscription/student')
                const payment = await recordStudentPayment({
                  schoolId: school.id,
                  studentId: assignedId,
                  planId: plan.id,
                  planCode: plan.code,
                  interval: 'ANNUAL',
                  amount: amountPerCode,
                  currency: body.currency ?? 'INR',
                  mode: 'CASH',
                  paymentDate,
                  validityMonths,
                  validityStart,
                  validityEnd,
                  reference: body.reference ?? null,
                  notes: `[BATCH] ${body.notes}`,
                  recordedById: ctx.admin.id,
                  source: 'MANUAL',
                  deferEntitlement: true,
                  tx,
                })
                paymentRefs.push(`studentPayment:${payment.paymentId}`)
              } else {
                const { recordStaffPayment } = await import('@/lib/subscription/staff')
                const payment = await recordStaffPayment({
                  schoolId: school.id,
                  userId: assignedId,
                  planId: plan.id,
                  planCode: plan.code,
                  interval: 'ANNUAL',
                  amount: amountPerCode,
                  currency: body.currency ?? 'INR',
                  mode: 'CASH',
                  paymentDate,
                  validityMonths,
                  validityStart,
                  validityEnd,
                  reference: body.reference ?? null,
                  notes: `[BATCH] ${body.notes}`,
                  recordedById: ctx.admin.id,
                  source: 'MANUAL',
                  deferEntitlement: true,
                  coveredRoles,
                  tx,
                })
                paymentRefs.push(`staffPayment:${payment.paymentId}`)
              }
            }
          } else {
            // OPEN batch: ONE tenant-level deferred VERIFIED payment (the
            // school-wide handshake pattern, amount = unit × quantity).
            // Per-seat attribution lives on the code events + entitlements
            // created at claim time; the payment row stays the immutable
            // batch-purchase record.
            const deferred = await recordDeferredSchoolPaymentInTx(tx, {
              schoolId: school.id,
              planId: plan.id,
              planCode: plan.code,
              interval: 'ANNUAL',
              priceSnapshot: amountPerCode,
              currency: body.currency ?? 'INR',
              amount: Math.round(amountPerCode * body.quantity * 100) / 100,
              mode: 'CASH',
              paymentDate,
              validityMonths,
              reference: body.reference ?? null,
              notes: `[BATCH×${body.quantity} ${body.scope === 'STUDENT_ENTITLEMENT' ? 'student' : 'staff'} seats] ${body.notes}`,
              recordedById: ctx.admin.id,
            })
            batchPaymentId = deferred.paymentId
            batchReceiptNo = deferred.receiptNo
            paymentRefs = Array.from({ length: body.quantity }, () => `platformPayment:${deferred.paymentId}`)
          }
        }

        const issued = await issueActivationCodeBatch({
          scope: body.scope,
          schoolId: school.id,
          planId: plan.id,
          planCode: plan.code,
          interval: 'ANNUAL',
          validityMonths,
          validityStartOverride: validityStart,
          validityEndOverride: validityEnd,
          claimWindowDays,
          issuedById: ctx.admin.id,
          quantity: body.quantity,
          assignedIds,
          paymentRefs,
          tx,
        })
        return { issued, batchPaymentId, batchReceiptNo }
      }, { timeout: 30_000 })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.codes_batch_issued',
        targetType: 'ACTIVATION_CODE',
        targetId: result.issued.items[0]?.codeId ?? null,
        schoolId: school.id,
        ip,
        reason: body.notes,
        metadata: {
          requested: result.issued.requested,
          generated: result.issued.generated,
          scope: body.scope,
          planCode: plan.code,
          coveredRoles,
          backing: body.backing,
          assignment: body.assignment,
          claimWindowDays,
          validityMonths,
          validityStart: validityStart?.toISOString() ?? null,
          validityEnd: validityEnd?.toISOString() ?? null,
          batchPaymentId: result.batchPaymentId,
          batchReceiptNo: result.batchReceiptNo,
        },
      }).catch(() => {})

      return {
        ok: true,
        requested: result.issued.requested,
        generated: result.issued.generated,
        plan: { code: plan.code, name: plan.name },
        backing: body.backing,
        batchPayment: result.batchReceiptNo ? { id: result.batchPaymentId, receiptNo: result.batchReceiptNo } : null,
        /** The ONLY copy of these codes — one-time display. */
        items: result.issued.items.map((i) => ({
          codeId: i.codeId,
          publicRef: i.publicRef,
          code: i.code,
          assignedId: i.assignedId,
          expiresAt: i.expiresAt.toISOString(),
        })),
        message: `${result.issued.generated} of ${result.issued.requested} codes generated. Copy and distribute them now — they will not be shown again.`,
      }
    },
    { method: 'POST' },
  )
}
