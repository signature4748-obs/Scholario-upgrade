import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { applyPaymentToLedger, mintReceiptNo, resolveFeeIdForTxn } from '@/lib/fee-workflow'

export const runtime = 'nodejs'

/// GET /api/fees/transactions?status=SUCCESS&from=2025-04-01&to=2025-04-30&recon=unreconciled
/// Returns paginated, filtered fee transactions.
export async function GET(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const { searchParams } = new URL(req.url)
      const status = searchParams.get('status')
      const recon = searchParams.get('recon')
      const method = searchParams.get('method')
      const from = searchParams.get('from')
      const to = searchParams.get('to')
      const limit = Math.min(500, Number(searchParams.get('limit') || 200))

      const where: any = { schoolId }
      if (status) where.status = status
      if (recon) where.reconciliationStatus = recon
      if (method) where.method = method
      if (from || to) {
        where.createdAt = {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        }
      }

      const transactions = await db.feeTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          settlement: { select: { id: true, payoutId: true, status: true, periodStart: true, periodEnd: true } },
        },
      })
      return transactions
      // Audit §11 — the school fee ledger is admin-only; students read
      // their own payments through /api/student/payments/*.
    },
  )
}

/// POST /api/fees/transactions — record a manual (offline) payment as a
/// FeeTransaction row. (Online payments are recorded by the webhook route
/// after gateway callback.)
///
/// Body: { studentId?, studentName?, className?, feeHeadName?, amount, method,
///         note?, referenceNumber?, feeId? }
/// Returns the created transaction.
///
/// 3-c fix: a provided body.studentId is FK-validated in-tenant BEFORE
/// the write (db.student.findFirst({ id, schoolId }) → 404) — was a bare
/// cross-tenant FK write.
///
/// Phase 3 fixes:
///   · body.receiptNo is IGNORED — the receipt number is minted
///     server-side via mintReceiptNo INSIDE the transaction (the
///     (schoolId, receiptNo) DB unique backstops the mint race).
///   · body.referenceNumber is kept, but duplicates are a clean 409
///     CONFLICT with a human message (P2002 on (schoolId, referenceNumber)
///     is translated — no Prisma internals reach the client).
///   · a SUCCESS manual txn created with feeId credits the student ledger
///     through the canonical applyPaymentToLedger, idempotent on
///     Payment.transactionId = `manual:{txn.id}`.
///
/// PIH-4b:
///   · body.feeId is OPTIONAL when body.studentId is present — the target
///     fee is resolved server-side (feeHeadName title match → oldest
///     unsettled fee → minimal fee row) so the ledger is ALWAYS credited
///     for a targetable payment (before, a missing feeId minted a SUCCESS
///     txn that never touched Fee.paid → module/dashboard divergence).
///   · amount > the target fee's outstanding → 409 CONFLICT (overpay
///     guard, same invariant as /api/teacher/fee-collection); the ledger
///     writer's clamp stays as the race backstop.
///   · the response echoes the ledger outcome ({ ledger: { applied, paid,
///     outstanding, status } }) so callers reconcile against server truth.
export async function POST(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const body = await req.json().catch(() => ({}))
      const amount = Number(body.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 5000000) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'amount must be a number between 1 and 5000000' })
      }

      let studentId: string | null = null
      if (body.studentId) {
        const student = await db.student.findFirst({
          where: { id: String(body.studentId), schoolId },
          select: { id: true },
        })
        if (!student) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: `transactions POST: student ${body.studentId} missing or foreign tenant`,
          })
        }
        studentId = student.id
      }

      // Phase 3: optional feeId — FK-validated in-tenant; when present the
      // manual SUCCESS txn credits the ledger atomically.
      let feeId: string | null = null
      if (body.feeId) {
        const fee = await db.fee.findFirst({
          where: { id: String(body.feeId), schoolId },
          select: { id: true },
        })
        if (!fee) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'Fee record not found',
            internalDetail: `transactions POST: fee ${body.feeId} missing or foreign tenant`,
          })
        }
        feeId = fee.id
      }

      const referenceNumber = body.referenceNumber ? String(body.referenceNumber).trim().slice(0, 80) : ''
      const method = String(body.method || 'Cash').toUpperCase().replace(' ', '_')
      const feeHeadName = body.feeHeadName ? String(body.feeHeadName).slice(0, 120) : null

      const txn = await trackedTransaction('fee-transaction-create', async (tx) => {
          // Phase 3: receipt numbers are ALWAYS server-minted inside the tx —
          // client-supplied receiptNo is ignored (it can neither collide with
          // another school's series nor spoof an existing receipt).
          const receiptNo = await mintReceiptNo(schoolId, tx)

          // PIH-4b — the ledger is ALWAYS credited when the payment is
          // targetable: an explicit body.feeId (FK-validated above) wins;
          // otherwise, when body.studentId is present, the target fee is
          // resolved SERVER-SIDE through the canonical resolver (fee head
          // title match → oldest unsettled fee → minimal fee row), the same
          // targeting the gateway confirm path uses. Before this, a caller
          // without a feeId minted a SUCCESS txn that never touched
          // Fee.paid — the fees module (FeeTransaction) and the dashboard
          // (Fee.paid/Payment) diverged on the same money.
          let ledgerFeeId: string | null = feeId
          if (!ledgerFeeId && studentId) {
            ledgerFeeId = await resolveFeeIdForTxn(tx, {
              schoolId,
              studentId,
              feeId: null,
              feeHeadName,
              amount,
              method,
            })
          }

          // PIH-4b — overpay guard (same invariant the teacher-collection
          // route asserts): the manual txn may not exceed the target fee's
          // outstanding balance. The ledger writer keeps its clamp as the
          // race backstop; the 409 is the honest client-facing answer.
          if (ledgerFeeId) {
            const fee = await tx.fee.findUnique({ where: { id: ledgerFeeId } })
            if (fee && fee.schoolId === schoolId) {
              const outstanding = Math.max(0, fee.amount - fee.paid)
              if (amount > outstanding) {
                throw new AppError('CONFLICT', {
                  publicMessage: `Amount exceeds the outstanding balance of this fee (₹${outstanding.toLocaleString('en-IN')}). Partial payments are allowed — overpayments are not.`,
                  internalDetail: `fees/transactions POST: amount ${amount} > outstanding ${outstanding} on fee ${ledgerFeeId}`,
                })
              }
            }
          }

          const created = await tx.feeTransaction.create({
            data: {
              schoolId,
              studentId,
              studentName: body.studentName ? String(body.studentName).slice(0, 120) : null,
              className: body.className ? String(body.className).slice(0, 80) : null,
              feeHeadName,
              feeId: ledgerFeeId,
              amount,
              method,
              status: 'SUCCESS',
              gatewayName: 'manual',
              receiptNo,
              referenceNumber: referenceNumber || null,
              note: body.note ? String(body.note).slice(0, 500) : null,
              reconciliationStatus: 'unreconciled',
              reconciledAt: null,
              reconciledBy: ctx.user.id,
            },
          })

          // Phase 3: a manual SUCCESS txn with a feeId credits the student
          // ledger — canonical writer, idempotent key `manual:{txn.id}` so a
          // retried POST can never double-credit (Payment.transactionId
          // @unique backstops).
          const ledger = ledgerFeeId
            ? await applyPaymentToLedger(
                {
                  txnId: `manual:${created.id}`,
                  schoolId,
                  feeId: ledgerFeeId,
                  amount,
                  method,
                },
                tx,
              )
            : null
          return { created, ledger }
        })
        .catch((e: unknown) => {
          const err = e as { code?: string; message?: string }
          if (err?.code === 'P2002') {
            // (schoolId, referenceNumber) duplicate — clean 409 with a
            // human message; anything else (e.g. a receipt-mint race) is a
            // generic retryable conflict. Prisma internals never surface.
            throw new AppError('CONFLICT', {
              publicMessage:
                referenceNumber && (err.message ?? '').includes('referenceNumber')
                  ? `Reference number ${referenceNumber} is already recorded for this school. A payment cannot be recorded twice with the same reference.`
                  : 'This payment conflicts with an existing record — please retry.',
              internalDetail: `P2002 on fees/transactions POST: ${(err.message ?? '').slice(0, 300)}`,
            })
          }
          throw e
        })
      // Response echoes the ledger outcome (applied amount + closing
      // totals) so the caller can reconcile against server truth.
      return { ...txn.created, ledger: txn.ledger }
    },
  )
}
