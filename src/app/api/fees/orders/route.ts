import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

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
/// 3-c fix — student identity is SERVER-DERIVED for self-service callers:
///   · STUDENT: studentId/studentName/className come from the session's
///     linked Student row (User → Student by userId); client-supplied
///     student metadata is ignored.
///   · PARENT: body.studentId must be one of the caller's OWN children
///     (guardianId = user.id, same school) — else 404; the name/class
///     metadata is then read from that row, never the client.
///   · Staff (P/M/ACCOUNTANT) keep the collect-dialog flow as-is
///     (client-grep: fees-collect-payment posts the canonical store
///     student id + display metadata; the DB write is fire-and-forget
///     audit trail, the in-memory ledger stays the UI system of record).
///   · Text metadata is length-capped so the persisted FeeTransaction
///     columns can no longer carry free-form junk.
///
/// NOTE: This endpoint stubs the gateway call (no real Razorpay SDK).
/// In production, the gateway's SDK would be called here with the
/// `notes` field set so the webhook can auto-reconcile. The stub
/// returns a deterministic-looking order id `order_<random>` so the
/// frontend can pass it to the Razorpay checkout JS.
export async function POST(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const user = ctx.user

      // Phase 1 — payment endpoint rate limit + amount bounds.
      enforceRateLimit(`rl:pay:${user.id}`, RATE_LIMITS.payment)
      const body = await req.json().catch(() => ({}))
      const amount = Number(body.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'amount must be a number between 1 and 500000' })
      }

      // ── 3-c fix: resolve the STUDENT server-side for self-service ──
      let studentId: string | null = null
      let studentName: string | null = null
      let className: string | null = null

      if (ctx.role === 'STUDENT') {
        const me = await db.student.findFirst({
          where: { userId: user.id, schoolId },
          include: { class: { select: { name: true } }, user: { select: { name: true } } },
        })
        if (!me) {
          throw new AppError('NOT_FOUND', {
            publicMessage: 'No student record is linked to this account',
            internalDetail: 'fees/orders: STUDENT caller has no Student row in tenant',
          })
        }
        studentId = me.id
        studentName = me.user?.name ?? null
        className = me.class?.name ?? null
      } else if (ctx.role === 'PARENT') {
        const children = await db.student.findMany({
          where: { schoolId, guardianId: user.id },
          include: { class: { select: { name: true } }, user: { select: { name: true } } },
        })
        const requested = String(body.studentId || body.notes?.studentId || '')
        const child = requested ? children.find((c) => c.id === requested) : null
        if (!child) {
          throw new AppError('NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: 'fees/orders: PARENT body.studentId is not one of the caller children',
          })
        }
        studentId = child.id
        studentName = child.user?.name ?? null
        className = child.class?.name ?? null
      } else {
        // Staff — collect-dialog flow (canonical store ids + display copy).
        studentId = String(body.studentId || body.notes?.studentId || '').slice(0, 64) || null
        studentName = String(body.studentName || body.notes?.studentName || '').slice(0, 120) || null
        className = String(body.className || body.notes?.className || '').slice(0, 80) || null
      }

      const feeHead = String(body.feeHeadName || body.notes?.feeHead || '').slice(0, 120)

      // Carry forward notes — used by the webhook for auto-reconciliation.
      const notes: Record<string, string> = {
        studentId: studentId ?? '',
        studentName: studentName ?? '',
        className: className ?? '',
        feeHead,
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
      // Phase 3: receipt-mint race guard — the Date.now() scheme is kept
      // (format preserved); if the (schoolId, receiptNo) DB unique rejects
      // a same-millisecond collision, retry ONCE with a deterministic
      // suffix.
      const baseReceiptNo = `RCP-${Date.now()}`
      const gatewayOrderId = `order_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`
      const gatewayName = String(body.gateway || 'razorpay').slice(0, 40)

      let receiptNo = baseReceiptNo
      let txn
      try {
        txn = await db.feeTransaction.create({
          data: {
            schoolId,
            studentId: studentId ?? null,
            studentName: studentName ?? null,
            className: className ?? null,
            feeHeadName: feeHead || null,
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
      } catch (e) {
        const err = e as { code?: string }
        if (err?.code !== 'P2002') throw e
        receiptNo = `${baseReceiptNo}-2`
        txn = await db.feeTransaction.create({
          data: {
            schoolId,
            studentId: studentId ?? null,
            studentName: studentName ?? null,
            className: className ?? null,
            feeHeadName: feeHead || null,
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
      }

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
  )
}
