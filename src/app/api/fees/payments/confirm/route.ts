import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { applyPaymentToLedger, mintReceiptNo, resolveFeeIdForTxn } from '@/lib/fee-workflow'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/// POST /api/fees/payments/confirm — DEMO GATEWAY SETTLEMENT (UX-3 §25–§31).
///
/// ROLE: this endpoint plays the part the SIGNED Razorpay webhook plays in
/// production (see /api/webhooks/razorpay/route.ts — HMAC-verified,
/// DB-idempotent, auto-reconciling). The demo gateway has no real bank, so
/// the settlement decision happens HERE, on the server: the client may ask
/// for settlement of an order it created via /api/fees/orders, but it can
/// never assert an amount, a student, or an outcome — those are read from
/// the server's own FeeTransaction row and decided by the demo settlement
/// rules below. No client trust is involved in the financial state machine.
/// In production this PENDING → SUCCESS transition happens ONLY via the
/// webhook's verified payment.captured event; this route exists so the demo
/// flow exercises the same server-owned transition end-to-end.
///
/// Input (deliberately minimal):
///   { orderId: string }                    — the only thing the client owns
///   { orderId, outcome: 'cancelled' }      — the user abandoned the gateway
///                                           page mid-checkout. 'cancelled'
///                                           is NOT a financial success
///                                           claim, so honouring it
///                                           server-side as FAILED is safe
///                                           and honest (no money moved).
///
/// Authorisation:
///   · roles [PRINCIPAL, MANAGEMENT, ACCOUNTANT, PARENT, STUDENT] (school
///     tenants only — the demo settlement rail is not a platform surface).
///   · the order is looked up by gatewayOrderId AND schoolId: a student
///     from school X can never settle school Y's order.
///   · STUDENT: the txn's studentId must equal the session's linked Student
///     row id (User → Student by userId) — student A can never confirm
///     student B's order (§25).
///   · PARENT (3-c fix): the txn's studentId must be one of the caller's
///     OWN children (db.student.findMany({ schoolId, guardianId: user.id }))
///     — a parent could previously settle/cancel ANY family's pending order.
///
/// Environment gate (3-c fix):
///   In production this route is refused outright unless
///   PAYMENTS_SANDBOX=1 is set — the real money movement in production is
///   the HMAC-verified webhook, never a client-invoked settlement call.
///   In development (and explicit sandbox deployments) the demo payment
///   flow keeps working unchanged.
///
/// Idempotency (the webhook's discipline, mirrored here):
///   · SUCCESS → return the SAME authoritative result again (no double
///     credit, no state change).
///   · FAILED → return the failure again.
///   · Only PENDING rows transition.
///
/// Demo settlement rules (server-decided, deterministic — the client cannot
/// choose the outcome):
///   · UPI / CARD        → SUCCESS (captured) with a minted gatewayPaymentId.
///   · NET_BANKING       → stays PENDING ("awaiting bank settlement" — bank
///                          verification lag; reconciles later, §31 honest
///                          state).
///   · outcome cancelled → FAILED ("cancelled at gateway").
///
/// Returns:
///   { status, receiptNo, gatewayPaymentId, orderId, amount, method, txnId }

/** The authoritative settlement snapshot every caller gets back. */
function settlementOf(txn: {
  id: string
  status: string
  receiptNo: string | null
  gatewayPaymentId: string | null
  gatewayOrderId: string | null
  amount: number
  method: string
}) {
  return {
    status: txn.status,
    receiptNo: txn.receiptNo,
    gatewayPaymentId: txn.gatewayPaymentId,
    orderId: txn.gatewayOrderId ?? '',
    amount: txn.amount,
    method: txn.method,
    txnId: txn.id,
  }
}

export async function POST(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const user = ctx.user

      // ── 3-c fix: production env gate ────────────────────────────────
      // The demo settlement rail is a DEV/sandbox affordance. In production
      // the only PENDING → SUCCESS transition is the signed webhook.
      if (process.env.NODE_ENV === 'production' && process.env.PAYMENTS_SANDBOX !== '1') {
        throw new AppError('FORBIDDEN', {
          publicMessage: 'Payment confirmation is disabled',
          internalDetail:
            'demo-gateway settlement endpoint refused: NODE_ENV=production and PAYMENTS_SANDBOX is not "1"',
        })
      }

      // ── 3-c fix: settlement attempts are rate-limited (20/hour) ─────
      enforceRateLimit(`rl:payconfirm:${user.id}`, RATE_LIMITS.payment)

      const body = await req.json().catch(() => ({}))
      const orderId = String(body.orderId || '')
      if (!orderId) throw new AppError('INVALID_INPUT', { publicMessage: 'orderId is required.' })
      const cancelled = body.outcome === 'cancelled'

      // ── Tenant isolation: the order must belong to THIS school ────
      const txn = await db.feeTransaction.findFirst({
        where: { gatewayOrderId: orderId, schoolId },
      })
      if (!txn) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Order not found for this school.' })

      // ── §25 student authorisation: only your OWN orders ───────────
      if (user.role === 'STUDENT') {
        const me = await db.student.findFirst({ where: { userId: user.id } })
        if (!me || me.schoolId !== schoolId || txn.studentId !== me.id) {
          throw new AppError('FORBIDDEN')
        }
      }

      // ── 3-c fix: PARENT authorisation: only your OWN children's orders ──
      if (user.role === 'PARENT') {
        const children = await db.student.findMany({
          where: { schoolId, guardianId: user.id },
          select: { id: true },
        })
        const childIds = new Set(children.map((c) => c.id))
        if (!txn.studentId || !childIds.has(txn.studentId)) {
          throw new AppError('FORBIDDEN')
        }
      }

      // ── Idempotency — terminal states answer with themselves ──────
      if (txn.status === 'SUCCESS' || txn.status === 'FAILED') {
        return settlementOf(txn)
      }
      if (txn.status !== 'PENDING') {
        // UNDER_VERIFICATION / REFUNDED are office-managed states — the
        // gateway rail never rewrites them.
        throw new AppError('INVALID_INPUT', {
          publicMessage: `This order is ${txn.status.toLowerCase()} — settlement is handled by the school office.`,
        })
      }

      // ── outcome: cancelled (user abandoned the gateway page) ──────
      if (cancelled) {
        const updated = await trackedTransaction('payment-confirm-cancel', async (tx) => {
          // PIH-4b — guarded transition: only a still-PENDING order may
          // become FAILED. A concurrent settlement (SUCCESS + ledger
          // credit) is never overwritten by a late cancellation.
          await tx.feeTransaction.updateMany({
            where: { id: txn.id, status: 'PENDING' },
            data: {
              status: 'FAILED',
              reconciliationStatus: 'exception',
              reconciledAt: new Date(),
              reconciledBy: 'demo-gateway',
              note: 'cancelled at gateway',
            },
          })
          return tx.feeTransaction.findUnique({ where: { id: txn.id } })
        })
        if (!updated) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Order not found for this school.' })
        return settlementOf(updated)
      }

      // ── Demo settlement rules (server-decided) ────────────────────
      if (txn.method === 'NET_BANKING') {
        // Bank verification lag — stays PENDING, reconciles later (§31).
        const updated = await db.feeTransaction.update({
          where: { id: txn.id },
          data: { note: 'awaiting bank settlement' },
        })
        return settlementOf(updated)
      }

      // UPI / CARD → captured. gatewayPaymentId minted server-side; the
      // demo gateway carries no signature (production: the webhook's HMAC).
      //
      // Phase 3: the SUCCESS transition and the LEDGER application are ONE
      // atomic unit — the demo flow can no longer produce SUCCESS rows
      // with no Fee.paid effect. The ledger is credited through the
      // canonical applyPaymentToLedger, idempotent on
      // Payment.transactionId = the gateway payment id (the same key
      // family the webhook/verify paths use), with the same fee
      // targeting (txn feeId → feeHeadName title → oldest unsettled fee →
      // minimal fee row).
      //
      // PIH-4b — TWO race fixes:
      //   · the idempotency key is DERIVED from the order
      //     (`confirm:${orderId}`), not minted per call: a double-confirm
      //     (retry, double-click, two tabs) resolves to the SAME
      //     Payment.transactionId, so applyPaymentToLedger's
      //     existing-mirror check returns the current totals and writes
      //     nothing — the per-call random key minted a NEW key every
      //     attempt and double-credited the ledger.
      //   · the terminal-state check rides ON the write inside the
      //     transaction (updateMany with status: 'PENDING'): when a
      //     concurrent confirm already settled this order, 0 rows update
      //     and the loser returns the winner's authoritative state
      //     (idempotent response, no error, no second credit).
      const gatewayPaymentId = `confirm:${orderId}`
      const updated = await trackedTransaction('payment-confirm-capture', async (tx) => {
        // PIH-4b — fee targeting BEFORE the state write: the resolved fee
        // id is PERSISTED on the canonical row (same discipline as the
        // student verify path), so a settled order always carries its
        // ledger link — an auditor reading the FeeTransaction sees exactly
        // which Fee row the money landed on.
        const feeId = txn.studentId
          ? await resolveFeeIdForTxn(tx, {
              schoolId: txn.schoolId,
              studentId: txn.studentId,
              feeId: txn.feeId,
              feeHeadName: txn.feeHeadName,
              amount: txn.amount,
              method: txn.method,
            })
          : txn.feeId
        // PIH-4b — receipts belong to SETTLEMENT: the canonical
        // SCH-YYYY-NNNNNN number is minted HERE (inside the settlement
        // transaction, only by the winner) — /api/fees/orders no longer
        // persists a receipt on the PENDING row.
        const receiptNo = await mintReceiptNo(txn.schoolId, tx)
        const settled = await tx.feeTransaction.updateMany({
          where: { id: txn.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            gatewayPaymentId,
            gatewaySignature: null,
            reconciliationStatus: 'reconciled',
            reconciledAt: new Date(),
            reconciledBy: 'demo-gateway',
            note: 'Settled server-side by the demo gateway',
            receiptNo,
            ...(feeId ? { feeId } : {}),
          },
        })
        if (settled.count > 0 && feeId) {
          await applyPaymentToLedger(
            {
              txnId: gatewayPaymentId,
              schoolId: txn.schoolId,
              feeId,
              amount: txn.amount,
              method: txn.method,
            },
            tx,
          )
        }
        return tx.feeTransaction.findUnique({ where: { id: txn.id } })
      })
      if (!updated) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Order not found for this school.' })
      // Audit parity with the webhook's auto-reconciliation — Phase 3:
      // existence-checked (transactionId + settlementId) before the create
      // so a retried confirm cannot duplicate recon rows (the DB unique
      // on (transactionId, settlementId) backstops).
      const reconExists = await db.reconciliation.findFirst({
        where: { transactionId: txn.id, settlementId: txn.settlementId },
        select: { id: true },
      })
      if (!reconExists) {
        await db.reconciliation
          .create({
            data: {
              schoolId,
              transactionId: txn.id,
              settlementId: txn.settlementId,
              status: 'reconciled',
              matchedBy: 'demo-gateway',
              note: `Settled via gateway order ${orderId}`,
            },
          })
          .catch(() => {
            /* best-effort audit row */
          })
      }

      return settlementOf(updated)
    },
  )
}
