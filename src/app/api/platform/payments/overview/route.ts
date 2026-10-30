import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { isSubscriptionSchemaPendingError } from '@/lib/platform/subscription-schema'
import {
  platformGatewayView,
  resolveSchoolFeeProvider,
} from '@/lib/payments/platform-gateway'

export const runtime = 'nodejs'

/**
 * GET /api/platform/payments/overview — the Payments & Gateways control
 * surface (billing.manage): platform gateway configuration view, the
 * school fee-gateway override list, webhook health, the most recent
 * platform subscription payments and the pending-verification pipeline.
 *
 * NEVER returns secrets: gateway views are the browser-safe projections;
 * webhook health carries status counts only.
 *
 * SCHEMA-PENDING TOLERANCE — subsystems that do not exist on a
 * pre-migration database degrade to null with `subscriptionSchemaPending`,
 * never to fabricated zeros.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const url = new URL(req.url)
    const sampleFeeSchoolId = url.searchParams.get('sampleSchoolId')?.trim() ?? ''

    const gateway = await platformGatewayView()

    let schemaPending = false
    let schoolGateways: Array<Record<string, unknown>> = []
    let webhookHealth: { byStatus: Record<string, number>; lastError: string | null } = {
      byStatus: {},
      lastError: null,
    }
    let recentPayments: Array<Record<string, unknown>> = []
    let pending: { orders: number | null; deferredActivations: number | null } = {
      orders: null,
      deferredActivations: null,
    }
    let feeResolutionSample: Record<string, unknown> | null = null


    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [
        gatewayRows,
        webhookByStatusRows,
        recentPaymentRows,
        pendingOrders,
        deferredPayments,
      ] = await Promise.all([
        db.schoolPaymentGateway.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 500,
          include: { school: { select: { id: true, name: true, slug: true } } },
        }),
        db.webhookEvent.groupBy({ by: ['status'], _count: { _all: true }, where: { receivedAt: { gte: since } } }),
        db.platformPayment.findMany({
          orderBy: { paymentDate: 'desc' },
          take: 10,
          include: { school: { select: { id: true, name: true } } },
        }),
        db.subscriptionOrder.count({ where: { status: 'PENDING' } }),
        // Deferred code-gated payments: recorded VERIFIED but the
        // activation waits for the code redemption (statusAfter null).
        db.platformPayment.count({ where: { statusAfter: null } }),
      ])
      schoolGateways = gatewayRows
      webhookHealth.byStatus = Object.fromEntries(
        webhookByStatusRows.map((r) => [r.status, r._count._all]),
      )
      recentPayments = recentPaymentRows
      pending = { orders: pendingOrders, deferredActivations: deferredPayments }
      const lastErrored = await db.webhookEvent.findFirst({
        where: { status: 'error' },
        orderBy: { receivedAt: 'desc' },
        select: { eventId: true, error: true, receivedAt: true },
      })
      webhookHealth.lastError = lastErrored
        ? `${lastErrored.eventId}: ${lastErrored.error ?? 'processing error'}`
        : null
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      schemaPending = true
      schoolGateways = []
      recentPayments = []
      pending = { orders: null, deferredActivations: null }
    }

    // Optional resolution sample (the UI's "what would this school use?"
    // probe) — never secrets, only the resolved SOURCE.
    if (sampleFeeSchoolId) {
      try {
        const r = await resolveSchoolFeeProvider(sampleFeeSchoolId)
        feeResolutionSample = {
          schoolId: sampleFeeSchoolId,
          source: r.source,
          error: r.source === 'none' ? (r.error ?? 'NO_PROVIDER') : null,
          providerName: r.provider?.name ?? null,
          mode: r.provider?.mode ?? null,
        }
      } catch {
        feeResolutionSample = { schoolId: sampleFeeSchoolId, source: 'none', error: 'NO_PROVIDER', providerName: null, mode: null }
      }
    }

    return {
      ...(schemaPending ? { subscriptionSchemaPending: true as const } : {}),
      gateway,
      schoolGateways: (schoolGateways as Array<{
        schoolId: string
        provider: string
        publicKeyId: string | null
        status: string
        lastVerifiedAt: Date | null
        webhookSecretCipher: string | null
        updatedAt: Date
        school: { id: string; name: string; slug: string }
      }>).map((row) => ({
          schoolId: row.schoolId,
          school: row.school,
          provider: row.provider,
          publicKeyId: row.publicKeyId,
          mode:
            row.provider === 'razorpay' && row.publicKeyId
              ? row.publicKeyId.startsWith('rzp_test_')
                ? 'test'
                : 'live'
              : null,
          status: row.status,
          lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
          webhookSecretConfigured: Boolean(row.webhookSecretCipher),
          updatedAt: row.updatedAt.toISOString(),
        })),
      webhookHealth,
      recentPayments: (recentPayments as Array<{
        id: string
        schoolId: string
        school?: { id: string; name: string } | null
        amount: unknown
        currency: string
        mode: string
        periodMonths: number
        paymentDate: Date
        receiptNo: string | null
        statusAfter: string | null
      }>).map((row) => ({
          id: row.id,
          school: row.school ?? null,
          amount: Number(row.amount),
          currency: row.currency,
          mode: row.mode,
          periodMonths: row.periodMonths,
          paymentDate: row.paymentDate.toISOString(),
          receiptNo: row.receiptNo,
          statusAfter: row.statusAfter,
        })),
      pending,
      feeResolutionSample,
    }
  })
}
