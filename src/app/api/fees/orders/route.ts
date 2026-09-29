import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

/// POST /api/fees/orders
///
/// Create a Razorpay-style order for online payment. Records a
/// FeeTransaction row in 'PENDING' state with the gatewayOrderId, so
/// the webhook can later match the gateway's payment.captured event
/// back to this row by gatewayOrderId.
///
/// Body:
///   { studentId?, studentName?, className?, feeHeadName?, amount,
///     method?: 'UPI' | 'Card' | 'Net Banking', notes?: { studentId, feeHead, ... } }
/// Returns:
///   { orderId, amount, currency, receiptNo, txnId, notes }
///
/// NOTE: This endpoint stubs the gateway call (no real Razorpay SDK).
/// In production, the gateway's SDK would be called here with the
/// `notes` field set so the webhook can auto-reconcile. The stub
/// returns a deterministic-looking order id `order_<random>` so the
/// frontend can pass it to the Razorpay checkout JS.
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      // Phase 1 — payment endpoint rate limit + amount bounds.
      enforceRateLimit(`rl:pay:${user.id}`, RATE_LIMITS.payment)
      const body = await req.json().catch(() => ({}))
      const amount = Number(body.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) {
        throw new Error('amount must be a number between 1 and 500000')
      }

      // Carry forward notes — used by the webhook for auto-reconciliation.
      const notes: Record<string, string> = {
        studentId: String(body.studentId || body.notes?.studentId || ''),
        studentName: String(body.studentName || body.notes?.studentName || ''),
        className: String(body.className || body.notes?.className || ''),
        feeHead: String(body.feeHeadName || body.notes?.feeHead || ''),
        schoolId,
        userId: user.id,
        source: 'scholario-fees',
      }

      // ── GATEWAY STUB ────────────────────────────────────────────
      // Real impl would be:
      //   const razorpay = new Razorpay({ keyId, keySecret })
      //   const order = await razorpay.orders.create({
      //     amount: Math.round(amount * 100), // paise
      //     currency: 'INR',
      //     receipt: `RCP-${Date.now()}`,
      //     notes,
      //   })
      //   return order
      //
      // For the demo, we just mint a unique order id locally and persist
      // it on the FeeTransaction row so the webhook can match it back.
      const receiptNo = `RCP-${Date.now()}`
      const gatewayOrderId = `order_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`
      const gatewayName = String(body.gateway || 'razorpay')

      const txn = await db.feeTransaction.create({
        data: {
          schoolId,
          studentId: notes.studentId || null,
          studentName: notes.studentName || null,
          className: notes.className || null,
          feeHeadName: notes.feeHead || null,
          amount,
          method: String(body.method || 'UPI').toUpperCase().replace(' ', '_'),
          status: 'PENDING',
          gatewayName,
          gatewayOrderId,
          gatewaySignature: null,
          gatewayPaymentId: null,
          receiptNo,
          reconciliationStatus: 'pending',
          note: 'Order created — awaiting gateway payment.captured webhook',
        },
      })

      return {
        orderId: gatewayOrderId,
        amount: Math.round(amount * 100), // paise — matches Razorpay convention
        currency: 'INR',
        receiptNo,
        txnId: txn.id,
        notes,
        gateway: gatewayName,
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'PARENT', 'STUDENT'] }
  )
}
