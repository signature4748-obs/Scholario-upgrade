import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError, newRequestId } from '@/lib/security/errors'
import { applyPaymentToLedger, resolveFeeIdForTxn } from '@/lib/fee-workflow'
import { getPaymentProvider } from '@/lib/payments/provider'
import { paymentMethodFor, prettyMethod } from '@/lib/payments/methods'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/// POST /api/student/payments/verify
///
/// Server-side checkout confirmation verification — the ONLY path that
/// can flip a FeeTransaction to SUCCESS. The client is never trusted to
/// declare success: it relays the checkout-handler payload
/// { orderId, paymentId, signature } (real Razorpay checkout, or the
/// server-minted sandbox confirmation returned by /order) and this route
/// re-computes the HMAC_SHA256(`${orderId}|${paymentId}`, secret) with
/// the SERVER-HELD secret (timing-safe compare). A forged payload fails.
///
/// Idempotent: if the transaction is already SUCCESS, the same result
/// payload is returned — no second receipt, no duplicate Payment /
/// Notification / WebhookEvent rows.
///
/// On failed verification the transaction is marked FAILED with
/// reconciliationStatus 'exception' and the request errors 400
/// ('SIGNATURE_VERIFICATION_FAILED').
///
/// On success (single logical transaction):
///   · FeeTransaction → SUCCESS + reconciled (+ gateway ids/signature)
///   · Payment row created (fires the live event-stream poller:
///     Payment JOIN Fee JOIN Student JOIN User WHERE status='SUCCESS')
///   · the student's Fee row paid/status/method/paidDate updated
///     (or a minimal Fee row created if none exists)
///   · Notification row created (appears in /api/notifications-feed)
///   · WebhookEvent audit row (best-effort, duplicate-safe)
///
/// Body: { orderId: string, paymentId: string, signature: string }
/// Returns:
///   { receiptNo, amount, method, status: 'SUCCESS',
///     gatewayPaymentId, txnId, paidAt }
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withAuthz(
    { roles: ['STUDENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId

      // Phase 1 — verification attempts are rate-limited (20/hour).
      enforceRateLimit(`rl:payverify:${ctx.user.id}`, RATE_LIMITS.payment)

      const body = await req.json().catch(() => ({}))
      const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
      const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
      const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
      if (!orderId || !paymentId || !signature) throw new AppError('INVALID_INPUT', { publicMessage: 'orderId, paymentId and signature are required' })

      // ── 1. Locate the transaction (RLS: same school as the session) ──
      const txn = await db.feeTransaction.findUnique({ where: { gatewayOrderId: orderId } })
      if (!txn) throw new AppError('NOT_FOUND')
      if (txn.schoolId !== schoolId) throw new AppError('FORBIDDEN')

      // ── 1b. 3-c fix: OWNERSHIP — only the CALLER's own orders ──────
      // The route previously checked txn.schoolId but NOT txn.studentId:
      // any student of the school could complete ANOTHER student's order
      // given the signature triple (which the order creator relays).
      // Both rows are in-tenant, so a mismatch is a straight FORBIDDEN.
      const me = await db.student.findFirst({
        where: { schoolId, userId: ctx.user.id },
        select: { id: true },
      })
      if (!me || txn.studentId !== me.id) {
        throw new AppError('FORBIDDEN', {
          internalDetail: `student/payments/verify: txn ${txn.id} studentId ${txn.studentId ?? 'null'} ≠ caller student ${me?.id ?? 'none'}`,
        })
      }

      // ── 2. Idempotency — already verified? ───────────────────────
      // Phase 3 (SUCCESS-without-ledger hole): when the txn is ALREADY
      // SUCCESS on arrival (the webhook won the race), do not blindly
      // early-return — RECONCILE-IF-UNAPPLIED first: if no Payment row
      // with transactionId === txn.gatewayPaymentId exists yet (legacy
      // rows transitioned before the webhook applied the ledger), apply
      // the ledger ONCE through the canonical writer (same idempotency
      // key — a second application is a no-op), then answer.
      if (txn.status === 'SUCCESS') {
        const reconcileKey = txn.gatewayPaymentId ?? txn.gatewayOrderId
        if (reconcileKey) {
          const appliedAlready = await db.payment.findUnique({
            where: { transactionId: reconcileKey },
            select: { id: true },
          })
          const txnStudentId = txn.studentId
          if (!appliedAlready && txnStudentId) {
            await db.$transaction(async (tx) => {
              // Same fee targeting as the primary path — the txn's own
              // feeId, else feeHeadName title, else the oldest unsettled
              // fee, else a minimal Fee row.
              const feeId = await resolveFeeIdForTxn(tx, {
                schoolId: txn.schoolId,
                studentId: txnStudentId,
                feeId: txn.feeId,
                feeHeadName: txn.feeHeadName,
                amount: txn.amount,
                method: paymentMethodFor(txn.method),
              })
              return applyPaymentToLedger(
                {
                  txnId: reconcileKey,
                  schoolId: txn.schoolId,
                  feeId,
                  amount: txn.amount,
                  method: paymentMethodFor(txn.method),
                },
                tx,
              )
            })
          }
        }
        return {
          receiptNo: txn.receiptNo,
          amount: txn.amount,
          method: prettyMethod(txn.method),
          status: 'SUCCESS' as const,
          gatewayPaymentId: txn.gatewayPaymentId,
          txnId: txn.id,
          paidAt: (txn.reconciledAt ?? txn.updatedAt).toISOString(),
        }
      }
      if (txn.status !== 'PENDING') throw new Error('TRANSACTION_NOT_VERIFIABLE')

      // ── 3. Verify the checkout signature (server-held secret) ──────
      const provider = getPaymentProvider()
      if (!provider) throw new Error('ONLINE_PAYMENTS_UNAVAILABLE')
      const verdict = provider.verifyCheckoutConfirmation({ orderId, paymentId, signature })
      if (!verdict.ok) {
        await db.feeTransaction.update({
          where: { id: txn.id },
          data: {
            status: 'FAILED',
            gatewayPaymentId: paymentId,
            gatewaySignature: signature,
            reconciliationStatus: 'exception',
            reconciliationNote: 'Checkout signature verification failed',
            note: 'Checkout signature verification failed — client payload rejected',
          },
        })
        throw new Error('SIGNATURE_VERIFICATION_FAILED')
      }

      // ── 4. Record the success (one logical transaction) ─────────────
      const studentId = txn.studentId
      if (!studentId) throw new Error('NO_STUDENT_RECORD')
      const paymentMethod = paymentMethodFor(txn.method) // 'UPI' | 'CARD' | 'NETBANKING'
      const paidAt = new Date()

      const updatedTxn = await db.$transaction(async (tx) => {
        // ── 4a. CONDITIONAL transition — only a PENDING row can become ─
        // SUCCESS. If count === 0 the webhook (or a concurrent verify)
        // already transitioned it — and, since Phase 3, applied the ledger
        // in the SAME transaction — so we answer idempotently and apply
        // NOTHING (the double-credit race is closed at the winner).
        const transition = await tx.feeTransaction.updateMany({
          where: { id: txn.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            gatewayPaymentId: paymentId,
            gatewaySignature: signature,
            reconciliationStatus: 'reconciled',
            reconciledAt: paidAt,
            reconciledBy: `${provider.name}-checkout-verify`,
            reconciliationNote: 'Verified by server-side checkout signature check',
            note: `Paid online via ${provider.name} checkout · receipt ${txn.receiptNo}`,
          },
        })
        if (transition.count === 0) {
          return { raced: true as const, txn: await tx.feeTransaction.findUnique({ where: { id: txn.id } }) }
        }
        const updated = await tx.feeTransaction.findUnique({ where: { id: txn.id } })

        // Resolve the student's Fee row (Phase 3 targeting improvement,
        // documented): the txn's own feeId, else an exact feeHeadName title
        // match, else the student's OLDEST unsettled fee — never blindly
        // credit the first fee row (a random paid fee can no longer
        // silently absorb the money). If none exists, a minimal Fee row is
        // created so the ledger linkage always exists.
        const feeId = await resolveFeeIdForTxn(tx, {
          schoolId: txn.schoolId,
          studentId,
          feeId: txn.feeId,
          feeHeadName: txn.feeHeadName,
          amount: txn.amount,
          method: paymentMethod,
          paidAt,
        })

        // ── 4b. THE single ledger writer (Phase 3): Fee.paid is credited ─
        // through applyPaymentToLedger — clamped to the outstanding
        // balance, idempotent on Payment.transactionId (the gateway
        // payment id — the SAME key the webhook uses), schoolId stamped
        // on the mirror row.
        await applyPaymentToLedger(
          {
            txnId: paymentId,
            schoolId: txn.schoolId,
            feeId,
            amount: txn.amount,
            method: paymentMethod,
          },
          tx,
        )

        // Staff-facing notification — surfaces in /api/notifications-feed.
        // 3-c fix: audience 'STAFF' (PRINCIPAL/TEACHER see it) — a
        // student's payment receipt broadcast to 'ALL' leaked fee
        // amounts + names to every student/parent in the school.
        await tx.notification.create({
          data: {
            schoolId: txn.schoolId,
            title: 'Fee payment received',
            message: `${ctx.user.name} paid ₹${txn.amount} via ${prettyMethod(txn.method)} · Receipt ${txn.receiptNo}`,
            audience: 'STAFF',
            priority: 'NORMAL',
            senderId: ctx.user.id,
          },
        })

        return { raced: false as const, txn: updated }
      })

      // Lost the race (webhook won) — idempotent already-processed answer.
      if (updatedTxn.raced) {
        const current = updatedTxn.txn ?? txn
        return {
          receiptNo: current.receiptNo,
          amount: current.amount,
          method: prettyMethod(current.method),
          status: 'SUCCESS' as const,
          gatewayPaymentId: current.gatewayPaymentId ?? paymentId,
          txnId: current.id,
          paidAt: (current.reconciledAt ?? current.updatedAt).toISOString(),
        }
      }

      // ── 5. WebhookEvent audit row (duplicate-safe, best-effort) ─────
      try {
        await db.webhookEvent.create({
          data: {
            eventId: `verify-${txn.gatewayOrderId}`,
            eventType: 'payment.verified',
            gatewayName: provider.name,
            signature,
            rawPayload: JSON.stringify({
              orderId,
              paymentId,
              amount: txn.amount,
              method: txn.method,
              receiptNo: txn.receiptNo,
            }),
            status: 'processed',
            schoolId: txn.schoolId,
            matchedTransactionId: updatedTxn.txn?.id ?? txn.id,
            processedAt: paidAt,
          },
        })
      } catch {
        // Duplicate eventId (idempotent retry) — the audit trail already
        // exists; this must never fail the verified payment.
      }

      await auditEvent({
        schoolId: txn.schoolId,
        userId: ctx.user.id,
        action: 'PAYMENT_VERIFIED',
        requestId,
        detail: `FeeTransaction ${txn.id} verified · receipt ${txn.receiptNo} · ₹${txn.amount}`,
      }).catch(() => {})

      return {
        receiptNo: txn.receiptNo,
        amount: txn.amount,
        method: prettyMethod(txn.method),
        status: 'SUCCESS' as const,
        gatewayPaymentId: paymentId,
        txnId: updatedTxn.txn?.id ?? txn.id,
        paidAt: paidAt.toISOString(),
      }
    },
  )
}
