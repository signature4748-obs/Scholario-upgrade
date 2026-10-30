import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { resolvePlanForPurchase } from '@/lib/subscription/plans'
import { loadSubscriptionConfig } from '@/lib/subscription/config'
import {
  recordStaffPayment,
  applyStaffEntitlementLifecycle,
  resolveStaffUser,
  resolveStaffCoveredRoles,
} from '@/lib/subscription/staff'
import { issueActivationCode } from '@/lib/subscription/codes'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * GET /api/platform/users/[id]/subscription — the staff member's
 * entitlement status, payment history and issued/assigned codes
 * (billing.manage). History rows (expired/revoked) included — the
 * financial record is immutable.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, status: true, subscriptionStatus: true,
        schoolId: true,
        school: { select: { id: true, name: true, slug: true, subscription: { select: { billingModel: true, staffCoverage: true } } } },
        staffEntitlements: { orderBy: { createdAt: 'desc' }, take: 20 },
        staffSubscriptionPayments: { orderBy: { paymentDate: 'desc' }, take: 50 },
      },
    })
    if (!user) {
      throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'User not found' })
    }

    const codes = await db.activationCode.findMany({
      where: { assignedUserId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
    })

    return {
      staff: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountLocked: user.subscriptionStatus === 'LOCKED',
      },
      school: {
        id: user.schoolId,
        name: user.school?.name ?? null,
        slug: user.school?.slug ?? null,
        billingModel: (user.school?.subscription as { billingModel?: string } | null)?.billingModel ?? 'SCHOOL_WIDE',
        staffCoverage: (user.school?.subscription as { staffCoverage?: string } | null)?.staffCoverage ?? 'TENANT',
      },
      entitlements: user.staffEntitlements.map((e) => ({
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
      payments: user.staffSubscriptionPayments.map((p) => ({
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
  /** Operator-recorded payment modes ONLY — ONLINE_PAYMENT is reserved
   *  for the gateway settlement lanes (same rule as the student route). */
  mode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER', 'COMPLIMENTARY']),
  amount: z.number().min(0).max(100_000_000),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  reference: z.string().max(120).optional(),
  /** Audit reason — REQUIRED for complimentary grants. */
  notes: z.string().max(600).optional(),
  validityMonths: z.number().int().min(1).max(36).optional(),
  validityStart: z.string().datetime().optional(),
  validityEnd: z.string().datetime().optional(),
  /** Issue a staff activation code instead of direct activation (the
   *  offline handshake — payment recorded VERIFIED, the teacher claims
   *  the code to activate). Default: false (direct). */
  issueActivationCode: z.boolean().default(false),
  /** Code redemption window (days) when issuing. */
  claimWindowDays: z.number().int().min(1).max(365).optional(),
})

/**
 * POST /api/platform/users/[id]/subscription — staff Model C manual/
 * operator assignment (billing.manage; COMPLIMENTARY additionally
 * requires billing.complimentary and amount 0).
 *
 * The target is resolved server-side and MUST be a canonical TEACHER row
 * of the school — a principal or student identity can never be assigned a
 * staff entitlement. Records the VERIFIED payment (immutable financial
 * row) and either activates directly or issues a staff activation code.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    // step-up (dormant while platform TOTP is stood down — re-arms with
    // MFA): this route mints paid/complimentary entitlements.
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, assignSchema)

      if (body.mode === 'COMPLIMENTARY' && !ctx.permissions.has('billing.complimentary')) {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Assigning complimentary entitlements requires the billing.complimentary permission.',
          internalDetail: 'staff subscription assign: complimentary without permission',
        })
      }
      if (body.mode === 'COMPLIMENTARY' && (!body.notes || body.notes.trim().length < 10)) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Complimentary grants require an audit note (at least 10 characters) explaining why.',
          internalDetail: 'staff subscription assign: complimentary without audit reason',
        })
      }

      const staffUser = await db.user.findUnique({
        where: { id },
        select: { id: true, schoolId: true, school: { select: { id: true, name: true } } },
      })
      if (!staffUser || !staffUser.schoolId || !staffUser.school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'User not found' })
      }
      const staffSchoolId: string = staffUser.schoolId
      // Server-verified ELIGIBILITY FIRST (before the plan lookup — the
      // identity check is the cheap, most-specific rejection): the target
      // must hold a role in the tenant's EFFECTIVE covered set (tenant
      // override → plan declaration → default; the plan's declaration can
      // only ever re-state the seat-eligible set, so resolving without it
      // here is equivalent for the gate). A principal or student identity
      // can never be assigned a staff entitlement.
      const tenantPolicy = await db.schoolSubscription.findUnique({
        where: { schoolId: staffSchoolId },
        select: { staffCoverageRoles: true },
      })
      const eligibilityRoles = resolveStaffCoveredRoles({
        tenantRoles: tenantPolicy?.staffCoverageRoles,
      })
      await resolveStaffUser(staffUser.id, staffSchoolId, eligibilityRoles)

      const config = await loadSubscriptionConfig()
      const plan = await resolvePlanForPurchase({
        code: body.planCode,
        expectedScope: 'STAFF',
        kind: 'assignment',
        requireOffline: true,
      })
      // STAFF ROLE COVERAGE (PHASE 5C) — the full effective set (tenant
      // override → the plan's declaration → default) guards the writes.
      const coveredRoles = resolveStaffCoveredRoles({
        tenantRoles: tenantPolicy?.staffCoverageRoles,
        planRoles: plan.coveredRoles,
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
        // ── Offline handshake: payment row + staff code; entitlement at claim. ──
        const payment = await recordStaffPayment({
          schoolId: staffSchoolId,
          userId: staffUser.id,
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
          coveredRoles,
        })
        const issued = await issueActivationCode({
          scope: 'STAFF_ENTITLEMENT',
          schoolId: staffSchoolId,
          assignedUserId: staffUser.id,
          planId: plan.id,
          planCode: plan.code,
          interval: 'ANNUAL',
          validityMonths,
          validityStartOverride: validityStart,
          validityEndOverride: validityEnd,
          claimWindowDays: body.claimWindowDays ?? config.student.defaultClaimWindowDays,
          issuedById: ctx.admin.id,
          paymentRef: `staffPayment:${payment.paymentId}`,
        })

        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.staff_payment_recorded',
          targetType: 'STAFF',
          targetId: staffUser.id,
          schoolId: staffSchoolId,
          ip: clientIpFromHeaders(req.headers),
          reason: body.notes ?? 'Offline staff subscription payment recorded + activation code issued',
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
          message: `Payment recorded (receipt ${payment.receiptNo}) and staff activation code ${issued.publicRef} issued. Show and copy the code now — it will not be visible again.`,
        }
      }

      // ── Direct activation (operator-assigned). ──
      const result = await recordStaffPayment({
        schoolId: staffSchoolId,
        userId: staffUser.id,
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
        coveredRoles,
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.staff_entitlement_assigned',
        targetType: 'STAFF',
        targetId: staffUser.id,
        schoolId: staffSchoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: body.notes ?? 'Staff entitlement assigned (operator workflow)',
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
        message:
          result.statusAfter === 'SUSPENDED'
            ? `Payment recorded (receipt ${result.receiptNo}). The entitlement is suspended — the paid period is reserved until ${result.validityEnd.toISOString().slice(0, 10)} and starts when it is reactivated.`
            : result.statusAfter === 'PENDING'
              ? `Entitlement scheduled (starts ${result.validityStart.toISOString().slice(0, 10)}) until ${result.validityEnd.toISOString().slice(0, 10)} (receipt ${result.receiptNo}).`
              : `Entitlement activated until ${result.validityEnd.toISOString().slice(0, 10)} (receipt ${result.receiptNo}).`,
      }
    },
    { method: 'POST' },
  )
}

const lifecycleSchema = strictBody({
  action: z.enum(['revoke', 'suspend', 'reactivate', 'adjust-validity']),
  /** REQUIRED (min 10) — withdrawing/adjusting a paid entitlement is a
   *  destructive platform action; the audit trail carries the reason. */
  reason: z.string().min(10).max(400),
  validityEnd: z.string().datetime().optional(),
})

/**
 * PATCH /api/platform/users/[id]/subscription — lifecycle on the staff
 * member's LIVE entitlement (billing.manage): revoke / suspend /
 * reactivate / adjust-validity. Financial rows are never modified.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, lifecycleSchema)
      const live = await db.staffEntitlement.findFirst({
        where: { userId: id, status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
        orderBy: [{ status: 'asc' }, { validityEnd: 'desc' }],
      })
      if (!live) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'This staff member has no live entitlement to act on.',
          internalDetail: 'staff subscription lifecycle: no live row',
        })
      }
      const result = await applyStaffEntitlementLifecycle({
        entitlementId: live.id,
        adminId: ctx.admin.id,
        action: body.action,
        reason: body.reason,
        validityEnd: body.validityEnd ? new Date(body.validityEnd) : undefined,
      })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: `platform.billing.staff_entitlement_${body.action.replace('-', '_')}`,
        targetType: 'STAFF',
        targetId: id,
        schoolId: live.schoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: body.reason,
        metadata: {
          entitlementId: live.id,
          result: result.status,
          validityEndBefore: live.validityEnd.toISOString(),
          validityEndAfter: body.validityEnd ?? result.reanchored?.validityEnd.toISOString() ?? null,
          ...(result.reanchored
            ? { reanchoredStart: result.reanchored.validityStart.toISOString(), reanchoredEnd: result.reanchored.validityEnd.toISOString() }
            : {}),
        },
      }).catch(() => {})
      return { ok: true, status: result.status, message: `Entitlement ${result.status.toLowerCase().replace('_', ' ')} — financial records unchanged.` }
    },
    { method: 'PATCH' },
  )
}
