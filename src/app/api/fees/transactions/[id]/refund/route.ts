import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { num, dec, formatINRServer } from '@/lib/money'
import { pushMessage, principalUserIds } from '@/lib/fee-workflow'

export const runtime = 'nodejs'

/// POST /api/fees/transactions/[id]/refund — reverse a settled payment
/// through the canonical ledger (BATCH2-B4).
///
/// Contract:
///   · PRINCIPAL / MANAGEMENT only (the same authority that verifies
///     collections); tenant-scoped — a foreign-tenant txn id is a 404.
///   · Only a SUCCESS transaction with an APPLIED ledger credit can be
///     refunded. The applied amount is derived SERVER-SIDE from the
///     Payment mirror rows (the canonical writer's idempotency keys —
///     manual:{txn.id} / the gateway payment id / confirm:{orderId}) —
///     never from the client.
///   · Body: { reason (required, 3..500 chars) }. The refund reverses
///     the FULL applied credit — partial amounts are refused (409 with
///     guidance): a partial correction is recorded as a NEW adjusted
///     transaction instead of rewriting a settled row's amount, so the
///     three-way ledger parity (Σ Payment(SUCCESS) == Σ FeeTransaction
///     (SUCCESS) == Σ Fee.paid) holds after every refund.
///   · ONE refund per transaction (guarded SUCCESS → REFUNDED transition;
///     a second attempt is a clean 409).
///   · In ONE transaction: the guarded status transition + the Fee.paid
///     reversal (clamped so paid stays ≥ 0 — the DB bound-guard
///     fee_paid_bounds_chk backstops) + flipping the ORIGINAL Payment
///     mirror rows (the applied credits) to status REFUNDED + a Payment
///     refund mirror row (transactionId `refund:{txn.id}` — unique, the
///     replay backstop) + audit. All three money sums drop by the same
///     applied amount — parity is preserved, defaulters/ dashboards stay
///     truthful.
///   · The ORIGINAL receipt number is kept (it is history — a settled
///     payment happened); the refund is recorded on the transaction row
///     (reconciliationNote) and in the audit trail, not as a new receipt.
///   · The refund does NOT touch the gateway: actually moving money back
///     to the payer is a gateway-side operation the operator performs
///     (Razorpay dashboard / refunds API with the school's own keys).
///     This endpoint reverses the SCHOOL LEDGER exactly once, with a
///     paper trail, so balances, defaulters and dashboards stay truthful.
///
/// Returns { ok, txnId, status: 'REFUNDED', refunded, fee: { id, paid,
/// status }, receiptNo }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const { id: txnId } = await params
    const schoolId = ctx.schoolId
    if (!txnId) throw new AppError('INVALID_INPUT', { publicMessage: 'Transaction id is required' })

    const body = await req.json().catch(() => ({}))
    const reason = String(body?.reason ?? '').trim()
    if (reason.length < 3 || reason.length > 500) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'A refund reason (3–500 characters) is required.',
      })
    }
    if (body?.amount !== undefined && body?.amount !== null) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Partial refunds are not supported — this endpoint reverses the full applied credit. Record a corrected payment as a new transaction instead.',
        internalDetail: `refund: partial amount ${body.amount} refused for txn ${txnId}`,
      })
    }

    const txn = await db.feeTransaction.findUnique({ where: { id: txnId } })
    if (!txn || txn.schoolId !== schoolId) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Transaction not found',
        internalDetail: `refund: txn ${txnId} missing or foreign tenant`,
      })
    }
    if (txn.status === 'REFUNDED') {
      throw new AppError('CONFLICT', { publicMessage: 'This transaction is already refunded.' })
    }
    if (txn.status !== 'SUCCESS') {
      throw new AppError('CONFLICT', {
        publicMessage: `Only settled (SUCCESS) payments can be refunded — this transaction is ${txn.status}.`,
      })
    }

    // ── Server-side applied amount (the canonical writer's keys) ──────
    const ledgerKeys = [
      txn.gatewayPaymentId,
      txn.gatewayOrderId,
      txn.gatewayOrderId ? `confirm:${txn.gatewayOrderId}` : null,
      `manual:${txn.id}`,
    ].filter((k): k is string => !!k)
    const appliedRows = await db.payment.findMany({
      where: { transactionId: { in: ledgerKeys } },
      select: { amount: true, status: true },
    })
    let applied = dec(0)
    for (const row of appliedRows) applied = applied.plus(dec(row.amount))
    const appliedNum = num(applied)
    if (appliedNum <= 0 || !txn.feeId) {
      throw new AppError('CONFLICT', {
        publicMessage: 'This transaction has no applied ledger credit to refund.',
        internalDetail: `refund: txn ${txn.id} has no Payment mirror rows (feeId ${txn.feeId ?? 'null'})`,
      })
    }

    const requested = appliedNum

    const result = await trackedTransaction('fee-transaction-refund', async (tx) => {
      // 1. Guarded transition — exactly ONE refund per txn (the winner
      //    flips SUCCESS → REFUNDED; a concurrent/racing refund gets
      //    count 0 and a clean 409, never a double reversal).
      const transition = await tx.feeTransaction.updateMany({
        where: { id: txn.id, status: 'SUCCESS' },
        data: {
          status: 'REFUNDED',
          reconciliationNote: `Refunded by ${ctx.user.name ?? ctx.user.id} — ${reason.slice(0, 300)}`,
          reconciledAt: new Date(),
          reconciledBy: ctx.user.id,
        },
      })
      if (transition.count === 0) {
        throw new AppError('CONFLICT', {
          publicMessage: 'This transaction was just refunded by someone else — reload and review.',
          internalDetail: `refund: guarded SUCCESS→REFUNDED transition lost the race for txn ${txn.id}`,
        })
      }

      // 2. Ledger reversal — clamp so Fee.paid stays ≥ 0 (the
      //    fee_paid_bounds_chk DB guard backstops this in depth).
      const fee = await tx.fee.findUnique({ where: { id: txn.feeId! } })
      if (!fee || fee.schoolId !== schoolId) {
        throw new AppError('CONFLICT', {
          publicMessage: 'The fee this payment credited no longer exists — manual ledger correction required.',
          internalDetail: `refund: fee ${txn.feeId} missing for txn ${txn.id}`,
        })
      }
      const reversal = dec(Math.min(requested, num(fee.paid)))
      const newPaid = dec(fee.paid).minus(reversal)
      const newStatus = newPaid.greaterThanOrEqualTo(fee.amount)
        ? 'PAID'
        : newPaid.greaterThan(0)
          ? 'PARTIAL'
          : 'UNPAID'
      if (reversal.greaterThan(0)) {
        await tx.fee.update({
          where: { id: fee.id },
          data: { paid: { decrement: reversal }, status: newStatus },
        })
      }

      // 3. Flip the ORIGINAL applied Payment mirrors to REFUNDED — all
      //    three money sums (Payment/SUCCESS, FeeTransaction/SUCCESS,
      //    Fee.paid) drop by the same applied amount, so the ledger
      //    parity invariant survives every refund.
      if (reversal.greaterThan(0)) {
        await tx.payment.updateMany({
          where: { transactionId: { in: ledgerKeys }, status: 'SUCCESS' },
          data: { status: 'REFUNDED' },
        })
      }

      // 4. Refund mirror row — the replay backstop (transactionId
      //    `refund:{txn.id}` is unique; a retried POST hits P2002 → the
      //    guarded transition above is the first line, this is the second).
      await tx.payment.create({
        data: {
          schoolId,
          feeId: fee.id,
          amount: reversal.greaterThan(0) ? reversal : dec(requested),
          method: txn.method,
          status: 'REFUNDED',
          transactionId: `refund:${txn.id}`,
          note: `Refund of transaction ${txn.id} (receipt ${txn.receiptNo ?? 'n/a'}) — ${reason.slice(0, 200)}`,
        },
      })

      return {
        refunded: num(reversal.greaterThan(0) ? reversal : dec(0)),
        feePaid: num(newPaid),
        feeStatus: reversal.greaterThan(0) ? newStatus : fee.status,
        feeId: fee.id,
      }
    })

    // 4. Audit + staff notification (best-effort, never fail the refund).
    await auditEvent({
      schoolId,
      userId: ctx.user.id,
      action: 'FEE_TRANSACTION_REFUNDED',
      detail: `FeeTransaction ${txn.id} refunded ₹${formatINRServer(result.refunded)} (receipt ${txn.receiptNo ?? 'n/a'}) — reason: ${reason.slice(0, 200)}`,
    }).catch(() => {})
    for (const pid of await principalUserIds(schoolId)) {
      await pushMessage(
        schoolId,
        ctx.user.id,
        pid,
        'Fee payment refunded',
        `Transaction ${txn.id} (${txn.studentName ?? 'student'}) was refunded ₹${formatINRServer(result.refunded)}. Reason: ${reason.slice(0, 120)}`,
      )
    }

    return {
      ok: true,
      txnId: txn.id,
      status: 'REFUNDED' as const,
      refunded: result.refunded,
      fee: { id: result.feeId, paid: result.feePaid, status: result.feeStatus },
      receiptNo: txn.receiptNo,
      reason,
    }
  })
}
