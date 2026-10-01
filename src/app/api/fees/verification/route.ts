import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { classLabelOf } from '@/lib/teacher-hub'
import {
  applyPaymentToLedger,
  assertReferenceUnique,
  audit,
  mintReceiptNo,
  pushMessage,
  resolveFeeIdForTxn,
  toFeeTxnDto,
  TXN_STATUS,
} from '@/lib/fee-workflow'
import { num, dec, outstandingDec, formatINRServer } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/fees/verification — the Principal's payment verification
 * workspace (MASTER TASK §8, §27).
 *
 *   · pending — every FeeTransaction awaiting verification (school-wide,
 *     the authoritative queue: student, class, fee, amount, method,
 *     collected by, when, reference);
 *   · recent — the last 25 resolved collection transactions (verified +
 *     rejected) with receipts — the trace: WHO collected WHEN from WHOM
 *     HOW MUCH for WHAT through WHICH method, WHO verified, WHICH
 *     receipt (§27);
 *   · stats — pending count/amount + this month's verified/rejected
 *     totals, all derived from the canonical rows (no fake numbers);
 *   · students — the school roster with open fee items, powering the
 *     "Record Direct Payment" dialog (§10: payments made directly
 *     through the Principal / School Office land in the SAME canonical
 *     ledger the class teacher reads).
 *
 * PRINCIPAL / MANAGEMENT only — a class teacher can never call this.
 */
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      const [pendingRows, recentRows] = await Promise.all([
        db.feeTransaction.findMany({
          where: { schoolId, status: TXN_STATUS.PENDING_VERIFICATION },
          orderBy: { collectedAt: 'asc' },
          take: 200,
        }),
        db.feeTransaction.findMany({
          where: {
            schoolId,
            source: { not: null },
            status: { in: [TXN_STATUS.VERIFIED, TXN_STATUS.REJECTED] },
          },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        }),
      ])

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthTxns = await db.feeTransaction.findMany({
        where: {
          schoolId,
          source: { not: null },
          OR: [
            { verifiedAt: { gte: monthStart } },
            { rejectedAt: { gte: monthStart } },
            { collectedAt: { gte: monthStart } },
          ],
        },
        select: { status: true, amount: true },
      })

      // Roster for the direct-payment dialog — students + their OPEN fee
      // items (outstanding > 0), school-wide (principal authority).
      const students = await db.student.findMany({
        where: { schoolId, user: { status: 'ACTIVE' } },
        select: {
          id: true,
          rollNo: true,
          user: { select: { name: true } },
          classId: true,
          class: { select: { name: true, section: true } },
        },
        orderBy: [{ class: { name: 'asc' } }, { rollNo: 'asc' }],
      })
      const feeItems = await db.fee.findMany({
        where: { studentId: { in: students.map((s) => s.id) } },
        select: {
          id: true, studentId: true, title: true, amount: true, paid: true,
          dueDate: true, status: true,
        },
        orderBy: [{ dueDate: 'asc' }],
      })
      const byStudent = new Map<string, typeof feeItems>()
      for (const f of feeItems) {
        const list = byStudent.get(f.studentId) ?? []
        list.push(f)
        byStudent.set(f.studentId, list)
      }

      return {
        pending: pendingRows.map(toFeeTxnDto),
        recent: recentRows.map(toFeeTxnDto),
        stats: {
          pendingCount: pendingRows.length,
          pendingAmount: num(pendingRows.reduce((sum, t) => sum.plus(t.amount), dec(0))),
          verifiedThisMonth: num(
            monthTxns
              .filter((t) => t.status === TXN_STATUS.VERIFIED)
              .reduce((sum, t) => sum.plus(t.amount), dec(0)),
          ),
          verifiedCountThisMonth: monthTxns.filter((t) => t.status === TXN_STATUS.VERIFIED).length,
          rejectedThisMonth: monthTxns.filter((t) => t.status === TXN_STATUS.REJECTED).length,
        },
        students: students.map((s) => ({
          id: s.id,
          name: s.user.name,
          rollNo: s.rollNo,
          classLabel: s.class ? classLabelOf({ name: s.class.name, section: s.class.section }) : 'Unassigned',
          openFees: (byStudent.get(s.id) ?? [])
            .filter((f) => dec(f.amount).minus(f.paid).greaterThan(0))
            .map((f) => ({
              id: f.id,
              title: f.title,
              amount: num(f.amount),
              paid: num(f.paid),
              outstanding: num(outstandingDec(f.amount, f.paid)),
              dueDate: f.dueDate ? f.dueDate.toISOString().slice(0, 10) : null,
            })),
        })),
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}

/**
 * POST /api/fees/verification — STAGE 2 of the two-stage workflow
 * (MASTER TASK §8, §10, §35). PRINCIPAL / MANAGEMENT only — a class
 * teacher calling this is rejected at the role gate (§21).
 *
 * Actions:
 *   verify        { txnId }
 *     UNDER_VERIFICATION → SUCCESS (inside one DB transaction):
 *       · unique sequential receipt minted (SCH-YYYY-NNNN);
 *       · student ledger applied (Fee.paid += amount, status, paidDate)
 *         + legacy Payment mirror — the ONE canonical transaction now
 *         feeds every screen (§19, §37);
 *       · collector notified with the receipt number; audit row written.
 *   reject        { txnId, reason }
 *     UNDER_VERIFICATION → REJECTED with reason — the ledger was never
 *     touched (pending collections are not paid money), the collector
 *     is notified with the reason.
 *   record-direct { studentId, feeId, amount, method, source,
 *                   referenceNumber?, notes? }
 *     The student paid directly at the office (§10): a canonical
 *     transaction is created ALREADY VERIFIED with receipt + ledger
 *     applied, source PRINCIPAL / SCHOOL_OFFICE, collector = caller.
 *     The class teacher of the student's class is notified so they
 *     never think the student still owes money.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const action = String(body.action || '')

      // ── VERIFY ───────────────────────────────────────────────────────
      if (action === 'verify') {
        const txnId = String(body.txnId || '')
        if (!txnId) throw new Error('txnId is required')

        const result = await trackedTransaction('fee-verification', async (tx) => {
          const txn = await tx.feeTransaction.findUnique({ where: { id: txnId } })
          if (!txn || txn.schoolId !== schoolId) throw new Error('NOT_FOUND')
          if (txn.status !== TXN_STATUS.PENDING_VERIFICATION) {
            throw new Error(
              txn.status === TXN_STATUS.VERIFIED
                ? 'This payment is already verified.'
                : `This payment is ${txn.status === TXN_STATUS.REJECTED ? 'rejected' : txn.status.toLowerCase()} — only pending collections can be verified.`,
            )
          }
          // PIH-4b — feeId resolution for ledger application: when the
          // pending collection carries no feeId (seeded demo rows, legacy
          // callers), the target fee is resolved SERVER-SIDE through the
          // canonical resolver (feeHeadName title match → oldest unsettled
          // fee → minimal fee row) — the same targeting the student
          // payment-verify and manual-transaction paths use. Before this,
          // verifying such a row minted SUCCESS with NO ledger credit
          // (Fee.paid never moved) — the module/dashboard divergence. The
          // resolved id is PERSISTED on the canonical row so the audit
          // trail always shows which Fee the money landed on.
          const ledgerFeeId =
            txn.feeId ??
            (txn.studentId
              ? await resolveFeeIdForTxn(tx, {
                  schoolId,
                  studentId: txn.studentId,
                  feeId: null,
                  feeHeadName: txn.feeHeadName,
                  amount: txn.amount,
                  method: txn.method,
                })
              : null)
          const receiptNo = await mintReceiptNo(schoolId, tx)
          const updated = await tx.feeTransaction.update({
            where: { id: txn.id },
            data: {
              status: TXN_STATUS.VERIFIED,
              receiptNo,
              verifiedById: user.id,
              verifiedByName: user.name ?? 'Principal',
              verifiedAt: new Date(),
              reconciliationStatus: 'reconciled',
              reconciledAt: new Date(),
              reconciledBy: user.name ?? 'principal',
              ...(ledgerFeeId ? { feeId: ledgerFeeId } : {}),
            },
          })
          const ledger = await applyPaymentToLedger(
            {
              txnId: txn.id,
              schoolId,
              feeId: ledgerFeeId,
              amount: txn.amount,
              method: txn.method,
            },
            tx,
          )
          return { txn: updated, ledger }
        })

        // Notify the collector (best-effort) + audit.
        if (result.txn.collectedById) {
          await pushMessage(
            schoolId,
            user.id,
            result.txn.collectedById,
            `Payment verified · ${result.txn.studentName ?? 'Student'}`,
            `Your collection of ₹${formatINRServer(result.txn.amount)} from ${result.txn.studentName ?? 'the student'}${result.txn.className ? ` (${result.txn.className})` : ''} is verified by ${user.name ?? 'the Principal'}. Receipt ${result.txn.receiptNo} has been issued and the student's fee balance is updated.`,
          )
        }
        await audit(
          schoolId,
          user.id,
          'fee.verified',
          `Verified ₹${formatINRServer(result.txn.amount)} from ${result.txn.studentName ?? 'student'} — receipt ${result.txn.receiptNo} (txn ${result.txn.id})`,
        )

        return { txn: toFeeTxnDto(result.txn), ledger: result.ledger }
      }

      // ── REJECT ───────────────────────────────────────────────────────
      if (action === 'reject') {
        const txnId = String(body.txnId || '')
        const reason = String(body.reason || '').trim()
        if (!txnId) throw new Error('txnId is required')
        if (!reason) throw new Error('A rejection reason is required — the collector must know why.')

        // PIH-4b — race-free reject: the status predicate rides ON the
        // update, inside one transaction (mirrors the verify path's
        // pattern). updateMany → 0 rows means the txn was settled
        // concurrently → 409 CONFLICT. The old flow pre-checked with
        // findFirst then did an UNGUARDED update: a verify landing in that
        // window would have been overwritten to REJECTED while the ledger
        // had already credited Fee.paid (money-state divergence).
        const txn = await trackedTransaction('fee-verification-reject', async (tx) => {
          const result = await tx.feeTransaction.updateMany({
            where: { id: txnId, schoolId, status: TXN_STATUS.PENDING_VERIFICATION },
            data: {
              status: TXN_STATUS.REJECTED,
              rejectedById: user.id,
              rejectedByName: user.name ?? 'Principal',
              rejectedAt: new Date(),
              rejectionReason: reason,
            },
          })
          if (result.count === 0) {
            const existing = await tx.feeTransaction.findFirst({ where: { id: txnId, schoolId } })
            if (!existing) throw new Error('NOT_FOUND')
            throw new AppError('CONFLICT', {
              publicMessage:
                existing.status === TXN_STATUS.VERIFIED
                  ? 'This payment is already verified.'
                  : `This payment is ${existing.status.toLowerCase()} — only pending collections can be rejected.`,
              internalDetail: `fee-verification reject: txn ${txnId} settled concurrently (status ${existing.status})`,
            })
          }
          return tx.feeTransaction.findUnique({ where: { id: txnId } })
        })
        if (!txn) throw new Error('NOT_FOUND')

        if (txn.collectedById) {
          await pushMessage(
            schoolId,
            user.id,
            txn.collectedById,
            `Payment rejected · ${txn.studentName ?? 'Student'}`,
            `The collection of ₹${formatINRServer(txn.amount)} from ${txn.studentName ?? 'the student'}${txn.className ? ` (${txn.className})` : ''} was rejected by ${user.name ?? 'the Principal'}: "${reason}". The student's fee balance was not changed — please follow up with the family and re-record the payment when resolved.`,
          )
        }
        await audit(
          schoolId,
          user.id,
          'fee.rejected',
          `Rejected ₹${formatINRServer(txn.amount)} from ${txn.studentName ?? 'student'} — "${reason}" (txn ${txn.id})`,
        )

        return { txn: toFeeTxnDto(txn) }
      }

      // ── RECORD DIRECT (Principal / School Office payment) ───────────
      if (action === 'record-direct') {
        const studentId = String(body.studentId || '')
        const feeId = String(body.feeId || '')
        const amount = Math.round(Number(body.amount) * 100) / 100
        const method = String(body.method || 'CASH').toUpperCase()
        const source = String(body.source || 'SCHOOL_OFFICE').toUpperCase()
        const referenceNumber = String(body.referenceNumber || '').trim()
        const notes = String(body.notes || '').trim()
        if (!studentId || !feeId) throw new Error('studentId and feeId are required')
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero')
        if (!['PRINCIPAL', 'SCHOOL_OFFICE'].includes(source)) {
          throw new Error('Direct payments are recorded as PRINCIPAL or SCHOOL_OFFICE source.')
        }

        const student = await db.student.findFirst({
          where: { id: studentId, schoolId },
          include: { class: true, user: { select: { name: true } } },
        })
        if (!student) throw new Error('NOT_FOUND')

        const classLabel = student.class ? classLabelOf(student.class) : 'Unassigned'
        const studentName = student.user.name ?? 'Student'

        // Phase 3 (TOCTOU fix): the fee lookup, the outstanding-balance
        // check AND the reference-uniqueness check all run INSIDE the
        // transaction now — a concurrent direct-record (or a webhook racing
        // this call) can no longer slip a second ₹amount past the pre-check
        // window. The Fee.paid DB bound-guard + the (schoolId, referenceNumber)
        // unique constraint backstop anything still racing inside the tx.
        const result = await trackedTransaction('fee-direct-record', async (tx) => {
          const fee = await tx.fee.findFirst({ where: { id: feeId, studentId, schoolId } })
          if (!fee) throw new Error('Fee record not found for this student')
          const outstanding = outstandingDec(fee.amount, fee.paid)
          if (outstanding.lessThanOrEqualTo(0)) throw new Error('This fee is already fully paid')
          if (dec(amount).greaterThan(outstanding)) {
            throw new Error(
              `Amount exceeds the outstanding balance of this fee (₹${formatINRServer(outstanding)}).`,
            )
          }
          await assertReferenceUnique(schoolId, referenceNumber, tx)

          const receiptNo = await mintReceiptNo(schoolId, tx)
          const txn = await tx.feeTransaction.create({
            data: {
              schoolId,
              studentId,
              studentName,
              className: classLabel,
              feeId: fee.id,
              feeHeadName: fee.title,
              amount,
              method,
              status: TXN_STATUS.VERIFIED,
              source,
              referenceNumber: referenceNumber || null,
              note: notes || null,
              collectedById: user.id,
              collectedByName: source === 'PRINCIPAL' ? `${user.name ?? 'Principal'} (Principal)` : 'School Office',
              collectedAt: new Date(),
              verifiedById: user.id,
              verifiedByName: user.name ?? 'Principal',
              verifiedAt: new Date(),
              receiptNo,
              reconciliationStatus: 'reconciled',
              reconciledAt: new Date(),
              reconciledBy: user.name ?? 'principal',
            },
          })
          const ledger = await applyPaymentToLedger(
            {
              txnId: txn.id,
              schoolId,
              feeId: fee.id,
              amount,
              method,
            },
            tx,
          )
          return { txn, ledger }
        })

        // Tell the class teacher the money is already in (§10 — the
        // teacher must never think the student still owes it).
        const cls = student.class
        if (cls?.classTeacherId && cls.classTeacherId !== user.id) {
          await pushMessage(
            schoolId,
            user.id,
            cls.classTeacherId,
            `Direct fee payment · ${studentName}`,
            `A fee payment of ₹${formatINRServer(amount)} from ${studentName} (${classLabel}) towards "${result.txn.feeHeadName}" was recorded directly through ${source === 'PRINCIPAL' ? 'the Principal' : 'the School Office'} by ${user.name ?? 'the Principal'}. Receipt ${result.txn.receiptNo} is issued — no further collection is needed for this amount.`,
          )
        }
        await audit(
          schoolId,
          user.id,
          'fee.direct-recorded',
          `Direct ${source} payment ₹${formatINRServer(amount)} from ${studentName} (${classLabel}) — receipt ${result.txn.receiptNo} (txn ${result.txn.id})`,
        )

        return { txn: toFeeTxnDto(result.txn), ledger: result.ledger }
      }

      throw new Error('Unknown action — expected verify | reject | record-direct.')
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
