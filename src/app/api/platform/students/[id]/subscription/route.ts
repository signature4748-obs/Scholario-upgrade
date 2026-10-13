import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { resolvePlanForPurchase } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'
import { recordStudentPayment, applyEntitlementLifecycle, STUDENT_PAYMENT_MODES } from '@/lib/subscription/student'
import { issueActivationCode } from '@/lib/subscription/codes'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * GET /api/platform/students/[id]/subscription — the student's entitlement
 * status, payment history and issued codes (billing.manage). History rows
 * (expired/revoked) included — the financial record is immutable.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const student = await db.student.findUnique({
      where: { id },
      include: {
        school: { select: { id: true, name: true, slug: true, subscription: true } },
        user: { select: { id: true, name: true, email: true, subscriptionStatus: true } },
        class: { select: { name: true } },
        entitlements: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!student) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Student not found' })
    }

    const [payments, codes] = await Promise.all([
      db.studentSubscriptionPayment.findMany({
        where: { studentId: id },
        orderBy: { paymentDate: 'desc' },
        take: 50,
        include: { recordedBy: { select: { name: true, email: true } } },
      }),
      db.activationCode.findMany({
        where: { studentId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
      }),
    ])

    const billingModel = student.school.subscription?.billingModel ?? 'SCHOOL_WIDE'
    return {
      student: {
        id: student.id,
        name: student.user.name,
        email: student.user.email,
        admissionNo: student.admissionNo,
        rollNo: student.rollNo,
        class: student.class?.name ?? null,
        accountLocked: student.user.subscriptionStatus === 'LOCKED',
      },
      school: { id: student.school.id, name: student.school.name, slug: student.school.slug, billingModel },
      entitlements: student.entitlements.map((e) => ({
        id: e.id,
        status: e.status,
        planCode: e.planCode,
        validityStart: e.validityStart.toISOString(),
        validityEnd: e.validityEnd.toISOString(),
        source: e.source,
        activatedAt: e.activatedAt?.toISOString() ?? null,
        revokedAt: e.revokedAt?.toISOString() ?? null,
        revokeReason: e.revokeReason,
        suspendedAt: e.suspendedAt?.toISOString() ?? null,
        suspendReason: e.suspendReason,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo,
        amount: Number(p.amount),
        currency: p.currency,
        mode: p.mode,
        paymentDate: p.paymentDate.toISOString(),
        validityMonths: p.validityMonths,
        reference: p.reference,
        notes: p.notes,
        verification: p.verification,
        recordedBy: p.recordedBy ? { name: p.recordedBy.name, email: p.recordedBy.email } : null,
        statusAfter: p.statusAfter,
        validityEndAfter: p.validityEndAfter?.toISOString() ?? null,
      })),
      codes: codes.map((c) => ({
        id: c.id,
        publicRef: c.publicRef,
        status: c.status,
        scope: c.scope,
        planCode: c.planCode,
        validityMonths: c.validityMonths,
        claimWindowDays: c.claimWindowDays,
        issuedAt: c.issuedAt.toISOString(),
        expiresAt: c.expiresAt.toISOString(),
        claimedAt: c.claimedAt?.toISOString() ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        revokeReason: c.revokeReason,
        events: c.events.map((e) => ({ type: e.type, detail: e.detail, createdAt: e.createdAt.toISOString() })),
      })),
    }
  })
}

const assignSchema = strictBody({
  planCode: z.string().min(3).max(40),
  mode: z.enum(STUDENT_PAYMENT_MODES),
  amount: z.number().min(0).max(100_000_000),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  reference: z.string().max(120).optional(),
  notes: z.string().max(600).optional(),
  validityMonths: z.number().int().min(1).max(36).optional(),
  validityStart: z.string().datetime().optional(),
  validityEnd: z.string().datetime().optional(),
  /** Issue a student-specific activation code instead of direct
   *  activation (the offline handshake — payment recorded VERIFIED, the
   *  student claims the code to activate). Default: false (direct). */
  issueActivationCode: z.boolean().default(false),
  /** Code redemption window (days) when issuing. */
  claimWindowDays: z.number().int().min(1).max(365).optional(),
})

/**
 * POST /api/platform/students/[id]/subscription — MODEL C manual/operator
 * assignment (billing.manage; COMPLIMENTARY additionally requires
 * billing.complimentary and amount 0).
 *
 * Records the VERIFIED payment (immutable financial row) and either
 * activates directly or issues a student-specific activation code.
 * Explicit validity dates (start/end) or months; everything audited.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const body = await parseJsonBody(req, assignSchema)

      // COMPLIMENTARY = the separate permission-protected workflow.
      if (body.mode === 'COMPLIMENTARY' && !ctx.permissions.has('billing.complimentary')) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Assigning complimentary entitlements requires the billing.complimentary permission.',
          internalDetail: 'student subscription assign: complimentary without permission',
        })
      }

      const student = await db.student.findUnique({
        where: { id },
        include: { school: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } },
      })
      if (!student || !student.school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Student not found' })
      }

      const config = await loadSubscriptionConfig()
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: 'STUDENT',
        kind: 'assignment',
        requireOffline: body.mode !== 'ONLINE_PAYMENT',
      })

      const paymentDate =
        body.paymentDate.length === 10 ? new Date(`${body.paymentDate}T00:00:00Z`) : new Date(body.paymentDate)
      const validityMonths = body.validityMonths ?? config.student.defaultValidityMonths
      const validityStart = body.validityStart ? new Date(body.validityStart) : null
      const validityEnd = body.validityEnd ? new Date(body.validityEnd) : null

      if (body.mode === 'COMPLIMENTARY' && body.amount !== 0) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Complimentary entitlements carry no amount — choose a paid mode for paid assignments.',
        })
      }

      if (body.issueActivationCode) {
        // ── Offline handshake: payment row + student code; entitlement at claim. ──
        const payment = await recordStudentPayment({
          schoolId: student.school.id,
          studentId: student.id,
          planId: plan.id,
          planCode: plan.code,
          interval: 'ANNUAL',
          amount: body.amount,
          currency: body.currency,
          mode: body.mode,
          paymentDate,
          validityMonths,
          validityStart,
          validityEnd,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          recordedById: ctx.admin.id,
          source: body.mode === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : 'MANUAL',
          deferEntitlement: true,
        })
        const issued = await issueActivationCode({
          scope: 'STUDENT_ENTITLEMENT',
          schoolId: student.school.id,
          studentId: student.id,
          planId: plan.id,
          planCode: plan.code,
          interval: 'ANNUAL',
          validityMonths,
          validityStartOverride: validityStart,
          validityEndOverride: validityEnd,
          claimWindowDays: body.claimWindowDays ?? config.student.defaultClaimWindowDays,
          issuedById: ctx.admin.id,
          paymentRef: `studentPayment:${payment.paymentId}`,
        })

        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.student_payment_recorded',
          targetType: 'STUDENT',
          targetId: student.id,
          schoolId: student.school.id,
          ip: clientIpFromHeaders(req.headers),
          reason: body.notes ?? 'Offline student subscription payment recorded + activation code issued',
          metadata: {
            receiptNo: payment.receiptNo,
            amount: body.amount,
            currency: body.currency,
            mode: body.mode,
            publicRef: issued.publicRef,
            validityMonths,
            planCode: plan.code,
          },
        }).catch(() => {})

        return {
          ok: true,
          payment: { id: payment.paymentId, receiptNo: payment.receiptNo },
          activationCode: {
            codeId: issued.codeId,
            publicRef: issued.publicRef,
            /** The ONLY copy — show once, deliver out-of-band. */
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
          },
          message: `Payment recorded (receipt ${payment.receiptNo}) and activation code ${issued.publicRef} issued. Show and copy the code now — it will not be visible again.`,
        }
      }

      // ── Direct activation (operator-assigned). ──
      const result = await recordStudentPayment({
        schoolId: student.school.id,
        studentId: student.id,
        planId: plan.id,
        planCode: plan.code,
        interval: 'ANNUAL',
        amount: body.amount,
        currency: body.currency,
        mode: body.mode,
        paymentDate,
        validityMonths,
        validityStart,
        validityEnd,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        recordedById: ctx.admin.id,
        source: body.mode === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : 'MANUAL',
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.student_entitlement_assigned',
        targetType: 'STUDENT',
        targetId: student.id,
        schoolId: student.school.id,
        ip: clientIpFromHeaders(req.headers),
        reason: body.notes ?? 'Student entitlement assigned (operator workflow)',
        metadata: {
          receiptNo: result.receiptNo,
          entitlementId: result.entitlementId,
          amount: body.amount,
          currency: body.currency,
          mode: body.mode,
          validityEnd: result.validityEnd.toISOString(),
          planCode: plan.code,
        },
      }).catch(() => {})

      return {
        ok: true,
        payment: { id: result.paymentId, receiptNo: result.receiptNo },
        entitlement: {
          id: result.entitlementId,
          statusAfter: result.statusAfter,
          validityStart: result.validityStart.toISOString(),
          validityEnd: result.validityEnd.toISOString(),
        },
        message: `Entitlement ${result.statusAfter === 'PENDING' ? 'scheduled (starts ' + result.validityStart.toISOString().slice(0, 10) + ')' : 'activated'} until ${result.validityEnd.toISOString().slice(0, 10)} (receipt ${result.receiptNo}).`,
      }
    },
    { method: 'POST' },
  )
}

const lifecycleSchema = strictBody({
  action: z.enum(['revoke', 'suspend', 'reactivate', 'adjust-validity']),
  reason: z.string().min(4).max(400).optional(),
  validityEnd: z.string().datetime().optional(),
})

/**
 * PATCH /api/platform/students/[id]/subscription — lifecycle on the
 * student's LIVE entitlement (billing.manage): revoke / suspend /
 * reactivate / adjust-validity. Financial rows are never modified.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage' },
    async (ctx) => {
      const body = await parseJsonBody(req, lifecycleSchema)
      const live = await db.studentEntitlement.findFirst({
        where: { studentId: id, status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
        orderBy: { validityEnd: 'desc' },
      })
      if (!live) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'This student has no live entitlement to act on.',
          internalDetail: 'student subscription lifecycle: no live row',
        })
      }
      const result = await applyEntitlementLifecycle({
        entitlementId: live.id,
        adminId: ctx.admin.id,
        action: body.action,
        reason: body.reason,
        validityEnd: body.validityEnd ? new Date(body.validityEnd) : undefined,
      })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: `platform.billing.student_entitlement_${body.action.replace('-', '_')}`,
        targetType: 'STUDENT',
        targetId: id,
        schoolId: live.schoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: body.reason ?? `Entitlement ${body.action}`,
        metadata: { entitlementId: live.id, result: result.status },
      }).catch(() => {})
      return { ok: true, status: result.status, message: `Entitlement ${result.status.toLowerCase().replace('_', ' ')} — financial records unchanged.` }
    },
    { method: 'PATCH' },
  )
}
