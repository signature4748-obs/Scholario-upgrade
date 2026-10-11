import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { getTenantPaymentProvider } from '@/lib/payments/tenant-gateway'
import { normalizeMethod } from '@/lib/payments/methods'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { outstandingForOrder } from '@/lib/fee-workflow'
import { formatINRServer } from '@/lib/money'

export const runtime = 'nodejs'

/// POST /api/student/payments/order
///
/// Creates a gateway order for the STUDENT SELF-SERVICE checkout.
///
/// Security model:
///   · The student is resolved from the SESSION — body schoolId /
///     studentId are never trusted (ignored entirely).
///   · BATCH2-B2: the requested amount is bounded by the student's REAL
///     outstanding obligation, computed SERVER-SIDE from the fee ledger
///     (open fees only). amount > outstanding → 409; outstanding = 0 →
///     409. The client can never pick an arbitrary order amount.
///   · BATCH2-B4: NO receipt number is minted or persisted at order
///     creation — receipts belong to SETTLEMENT (PIH-4b). The PENDING
///     row carries receiptNo: null; the settling writer (checkout verify
///     after signature verification, or the gateway webhook after the
///     amount-agreement gate) mints the canonical SCH-YYYY-NNNNNN number
///     inside its settlement transaction. The response keeps the
///     `receiptNo` key (null until settlement) for contract
///     compatibility.
///   · The row is created in 'PENDING' state. Only a later server-side
///     signature verification (POST /verify) can flip it to SUCCESS —
///     the client can NEVER declare success itself.
///
/// Body:
///   { amount: number (rupees, 1..500000, ≤ outstanding),
///     method?: 'UPI' | 'Card' | 'Net Banking',
///     feeHead?: string, purpose?: string }
///
/// Returns:
///   { orderId, receiptNo: null, amountPaise, currency, mode, keyId?,
///     sandbox?: { paymentId, signature } }
///
/// Sandbox mode additionally mints the signed confirmation server-side
/// (provider.confirmSandboxPayment) and returns it under `sandbox` (also
/// mirrored top-level as paymentId/signature for convenience). The
/// client relays { orderId, paymentId, signature } to POST /verify,
/// which re-verifies the HMAC against the server-held secret — a forged
/// client payload fails verification, so the security property holds.
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      // Phase 1 — payment endpoints are rate-limited (20/hour per user).
      enforceRateLimit(`rl:pay:${user.id}`, RATE_LIMITS.payment)

      // ── Resolve the student from the session (never the body) ──────
      const dbUser = await db.user.findUnique({
        where: { id: user.id },
        include: { student: { include: { class: { select: { name: true } } } } },
      })
      const dbStudent = dbUser?.student
      if (!dbStudent) throw new Error('NO_STUDENT_RECORD')

      // ── Validate the request ───────────────────────────────────────
      const body = await req.json().catch(() => ({}))
      const amount = Number(body?.amount)
      if (!Number.isFinite(amount) || amount < 1 || amount > 500000) {
        throw new Error('amount must be a number between 1 and 500000')
      }

      const method = normalizeMethod(body?.method) // 'UPI' | 'CARD' | 'NET_BANKING'
      const feeHeadName = body?.feeHead ? String(body.feeHead).slice(0, 120) : null
      const _purpose = body?.purpose ? String(body.purpose).slice(0, 200) : null

      // ── BATCH2-B2: server-side obligation gate (amount tampering) ──
      // The requested amount is bounded by what the student actually
      // owes (open fees only) — computed from the fee ledger, never from
      // the client's claim. Partial payments stay allowed.
      const obligation = await outstandingForOrder(db, {
        schoolId,
        studentId: dbStudent.id,
      })
      if (obligation.outstanding <= 0) {
        throw new AppError('CONFLICT', {
          publicMessage: 'You have no outstanding fee balance to pay.',
          internalDetail: `student/payments/order: no open fee for student ${dbStudent.id} in tenant ${schoolId}`,
        })
      }
      if (amount > obligation.outstanding) {
        throw new AppError('CONFLICT', {
          publicMessage: `Amount exceeds your outstanding fee balance (₹${formatINRServer(obligation.outstanding)}). Partial payments are allowed — overpayments are not.`,
          internalDetail: `student/payments/order: amount ${amount} > outstanding ${formatINRServer(obligation.outstanding)} for student ${dbStudent.id}`,
        })
      }

      // ── Resolve the payment provider (§3B: tenant-scoped) ────────
      const provider = await getTenantPaymentProvider(schoolId)
      if (!provider) throw new Error('ONLINE_PAYMENTS_UNAVAILABLE')

      // ── Create the gateway order ──────────────────────────────────
      // BATCH2-B4: the gateway's free-text `receipt` field carries a
      // non-receipt ORDER reference (matching is by gatewayOrderId) — the
      // canonical SCH- receipt is minted at settlement by the settling
      // writer, never here.
      const amountPaise = Math.round(amount * 100)
      const order = await provider.createOrder({
        amountPaise,
        receipt: `order-ref-${dbStudent.id.slice(0, 12)}-${Date.now()}`,
        notes: {
          studentId: dbStudent.id,
          studentName: user.name,
          className: dbStudent.class?.name ?? '',
          feeHead: feeHeadName ?? '',
          schoolId,
        },
      })

      // ── Persist the PENDING FeeTransaction ─────────────────────────
      // BATCH2-B4: receiptNo is null — receipts belong to settlement.
      // Matching to the gateway order is by gatewayOrderId (unique).
      const txn = await db.feeTransaction.create({
        data: {
          schoolId,
          studentId: dbStudent.id,
          studentName: user.name,
          className: dbStudent.class?.name ?? '',
          feeHeadName,
          amount,
          method,
          status: 'PENDING',
          gatewayName: provider.name,
          gatewayOrderId: order.orderId,
          receiptNo: null,
          reconciliationStatus: 'pending',
          note: 'Order created by student self-service checkout',
        },
      })

      // ── Sandbox: mint the signed confirmation server-side ─────────
      let sandbox: { paymentId: string; signature: string } | undefined
      if (provider.confirmSandboxPayment) {
        const confirmation = provider.confirmSandboxPayment({ orderId: order.orderId, amountPaise })
        sandbox = { paymentId: confirmation.paymentId, signature: confirmation.signature }
      }

      return {
        orderId: order.orderId,
        receiptNo: null,
        amountPaise,
        currency: order.currency,
        mode: order.mode,
        keyId: order.keyId ?? null,
        // Sandbox convenience mirror (also under `sandbox` below) — the
        // client relays these to POST /verify exactly like a Razorpay
        // checkout handler payload.
        paymentId: sandbox?.paymentId ?? null,
        signature: sandbox?.signature ?? null,
        sandbox,
        txnId: txn.id,
      }
    },
    { roles: ['STUDENT'] }
  )
}
