import { assertModuleEnabled } from '@/lib/platform/module-flags'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, idSchema, safeText } from '@/lib/security/validation'
import { num, dec, outstandingDec, formatINRServer } from '@/lib/money'
import { applyPaymentToLedger, mintReceiptNo } from '@/lib/fee-workflow'

export const runtime = 'nodejs'

/// GET /api/fees — the school fee ledger (fee rows + payment events,
/// optional ?studentId / ?status filters).
///
/// 3-c fix: gated to 'school.finance.read' (PRINCIPAL / MANAGEMENT /
/// ACCOUNTANT). Before, ANY authenticated role (STUDENT / TEACHER / PARENT)
/// could enumerate every student's fee rows + payments with an open
/// ?studentId filter. Students read their OWN fees through /api/student/*
/// (client-grep: the student fees module calls /api/student/payments/*;
/// the principal fees module uses /api/fees/{defaulters,transactions,
/// orders,receipts} — no client consumes this GET, so the gate breaks no
/// legit flow).
export async function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.finance.read' }, async (ctx) => {
    // PHASE 6 — platform module switch (school override ?? platform master).
    await assertModuleEnabled(ctx.schoolId, 'fees')
    const { searchParams } = new URL(req.url)
    const studentId = searchParams.get('studentId')
    const status = searchParams.get('status')
    const fees = await db.fee.findMany({
      where: {
        schoolId: ctx.schoolId,
        ...(studentId ? { studentId } : {}),
        ...(status ? { status } : {}),
      },
      include: { student: { include: { user: { select: { name: true } } } }, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    // Phase 8A: money columns are Prisma.Decimal (NUMERIC) — emit JSON
    // numbers so client formatters/stores are unchanged.
    return fees.map((f) => ({
      ...f,
      amount: num(f.amount),
      paid: num(f.paid),
      payments: f.payments.map((p) => ({ ...p, amount: num(p.amount) })),
    }))
  })
}

/// POST /api/fees — (a) record a payment on an existing fee, or (b) create
/// a new fee row for a student.
///
/// 3-c fixes:
///   · create-fee: body.studentId is validated in-tenant BEFORE the write
///     (db.student.findFirst({ id, schoolId }) → 404) — was a bare
///     cross-tenant FK write.
///   · payment-record: amount bounded (> 0 and ≤ the fee's outstanding
///     balance) so a single POST can no longer mark a fee PAID with a
///     ₹500000 overpayment.
///   · parseJsonBody schema (ids, amount 1..500000, bounded text).
///
/// BATCH2-B4 — the payment-record branch is now CANONICAL: it writes ONE
/// FeeTransaction row (source SCHOOL_OFFICE, status SUCCESS, receipt
/// SCH-YYYY-NNNNNN minted server-side inside the transaction) and credits
/// the ledger through applyPaymentToLedger (idempotency key
/// `manual:{txn.id}`) — exactly the /api/fees/transactions discipline.
/// Before this, the branch wrote a Payment mirror row with NO
/// transactionId (a retried POST double-credited the fee) and NO
/// FeeTransaction row (broke the Σ Payment = Σ FeeTransaction = Σ Fee.paid
/// parity invariant, and minted no receipt). The response keeps its shape
/// ({ ok, feeId, paid, status }) and adds receiptNo/txnId/ledger.
const feePostSchema = z
  .object({
    feeId: idSchema.optional(),
    amount: z.coerce.number().finite().min(1).max(500000),
    method: safeText(40).optional(),
    note: safeText(500).optional(),
    studentId: idSchema.optional(),
    title: safeText(200).optional(),
    type: safeText(50).optional(),
    dueDate: z.string().trim().max(40).optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await parseJsonBody(req, feePostSchema)

    // record a payment on an existing fee
    if (body.feeId) {
      const amount = body.amount
      // BATCH2-B4: canonical writer — the fee is re-read INSIDE the
      // transaction, the outstanding balance is checked against that
      // fresh row, and the money lands through the SAME pipeline every
      // other settlement writer uses: ONE FeeTransaction (SUCCESS,
      // receipt SCH- minted inside the tx) + applyPaymentToLedger
      // (idempotent on `manual:{txn.id}`, clamped to outstanding,
      // Payment mirror with schoolId). A concurrent double-POST can
      // neither overpay the fee (bound-guard backstop) nor double-credit
      // (Payment.transactionId @unique backstop).
      const result = await trackedTransaction('payment-record-manual', async (tx) => {
        const fee = await tx.fee.findUnique({
          where: { id: body.feeId! },
          include: { student: { select: { id: true, user: { select: { name: true } } } } },
        })
        if (!fee || fee.schoolId !== schoolId) throw new AppError('RESOURCE_NOT_FOUND')
        const remaining = outstandingDec(fee.amount, fee.paid)
        if (remaining.lessThanOrEqualTo(0)) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: 'This fee is already fully paid',
            internalDetail: `fee ${fee.id} paid=${num(fee.paid)} amount=${num(fee.amount)}`,
          })
        }
        if (dec(amount).greaterThan(remaining)) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: `Amount exceeds the outstanding balance (₹${formatINRServer(remaining)})`,
            internalDetail: `fee ${fee.id} payment ${amount} > remaining ${formatINRServer(remaining)}`,
          })
        }
        const method = String(body.method || 'CASH').toUpperCase().replace(' ', '_')
        const receiptNo = await mintReceiptNo(schoolId, tx)
        const created = await tx.feeTransaction.create({
          data: {
            schoolId,
            studentId: fee.studentId,
            studentName: fee.student?.user?.name ?? null,
            feeHeadName: fee.title,
            feeId: fee.id,
            amount,
            method,
            status: 'SUCCESS',
            source: 'SCHOOL_OFFICE',
            gatewayName: 'manual',
            receiptNo,
            note: body.note ? String(body.note).slice(0, 500) : null,
            reconciliationStatus: 'unreconciled',
            reconciledBy: ctx.user.id,
          },
        })
        const ledger = await applyPaymentToLedger(
          {
            txnId: `manual:${created.id}`,
            schoolId,
            feeId: fee.id,
            amount,
            method,
          },
          tx,
        )
        const paidNow = num(ledger ? ledger.paid : dec(fee.paid))
        return { feeId: fee.id, paid: paidNow, status: ledger ? ledger.status : fee.status, receiptNo, txnId: created.id, ledger }
      })
      return { ok: true, ...result }
    }

    // create a new fee — 3-c fix: student FK must exist in THIS school
    const studentId = body.studentId
    const amount = body.amount
    if (!studentId) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'studentId and amount required' })
    }
    const student = await db.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true },
    })
    if (!student) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Student not found',
        internalDetail: `fees POST create: student ${studentId} missing or foreign tenant`,
      })
    }
    const fee = await db.fee.create({
      data: {
        schoolId,
        studentId,
        title: body.title || 'Fee',
        amount,
        paid: 0,
        type: body.type || 'TUITION',
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: 'UNPAID',
      },
    })
    return { ...fee, amount: num(fee.amount), paid: num(fee.paid) }
  })
}
