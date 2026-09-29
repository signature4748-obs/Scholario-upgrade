import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { getPaymentProvider } from '@/lib/payments/provider'
import { normalizeMethod } from '@/lib/payments/methods'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/// POST /api/student/payments/order
///
/// Creates a gateway order for the STUDENT SELF-SERVICE checkout.
///
/// Security model:
///   · The student is resolved from the SESSION — body schoolId /
///     studentId are never trusted (ignored entirely).
///   · The receipt number is minted SERVER-side: RCP-<year>-<seq> where
///     seq = (# FeeTransaction rows for this school whose receiptNo
///     starts with `RCP-<year>-`) + 1, zero-padded to 4 digits.
///   · The row is created in 'PENDING' state. Only a later server-side
///     signature verification (POST /verify) can flip it to SUCCESS —
///     the client can NEVER declare success itself.
///
/// Body:
///   { amount: number (rupees, 1..500000),
///     method?: 'UPI' | 'Card' | 'Net Banking',
///     feeHead?: string, purpose?: string }
///
/// Returns:
///   { orderId, receiptNo, amountPaise, currency, mode, keyId?,
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
      const purpose = body?.purpose ? String(body.purpose).slice(0, 200) : null

      // ── Resolve the payment provider ──────────────────────────────
      const provider = getPaymentProvider()
      if (!provider) throw new Error('ONLINE_PAYMENTS_UNAVAILABLE')

      // ── Mint the receipt number server-side ────────────────────────
      const year = new Date().getFullYear()
      const priorCount = await db.feeTransaction.count({
        where: { schoolId, receiptNo: { startsWith: `RCP-${year}-` } },
      })
      const receiptNo = `RCP-${year}-${String(priorCount + 1).padStart(4, '0')}`

      // ── Create the gateway order ──────────────────────────────────
      const amountPaise = Math.round(amount * 100)
      const order = await provider.createOrder({
        amountPaise,
        receipt: receiptNo,
        notes: {
          studentId: dbStudent.id,
          studentName: user.name,
          className: dbStudent.class?.name ?? '',
          feeHead: feeHeadName ?? '',
          schoolId,
        },
      })

      // ── Persist the PENDING FeeTransaction ─────────────────────────
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
          receiptNo,
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
        receiptNo,
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
