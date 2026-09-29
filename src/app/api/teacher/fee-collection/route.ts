import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { classLabelOf } from '@/lib/teacher-hub'
import {
  assertClassTeacherOfStudent,
  assertReferenceUnique,
  audit,
  principalUserIds,
  pushMessage,
  toFeeTxnDto,
  TXN_STATUS,
} from '@/lib/fee-workflow'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/fee-collection — the Class Teacher's Fees & Payments
 * workspace (MASTER TASK §13–§15, §25).
 *
 * Returns, for EVERY class the signed-in teacher is appointed class
 * teacher of (server truth — Class.classTeacherId):
 *   · rosters with each student's fee ledger (items + outstanding +
 *     awaiting-verification) and pre-workflow office payment records;
 *   · the class's collection picture: billed / collected (verified) /
 *     outstanding / overdue / awaiting verification;
 *   · the month sheet (default: current month) — verified collections
 *     and pending-verification totals scoped to ?month=YYYY-MM;
 *   · EVERY collection transaction (FeeTransaction rows carrying a
 *     collection source) for the class's students — the canonical
 *     history the table renders: status, source, collector, verifier,
 *     receipt.
 *
 * A teacher with no appointment gets { classes: [] } — the module
 * renders its honest unavailable state.
 */
export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const monthParam = req.nextUrl.searchParams.get('month') || ''
      const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthParam)
      const now = new Date()
      const year = monthMatch ? Number(monthMatch[1]) : now.getFullYear()
      const month = monthMatch ? Number(monthMatch[2]) - 1 : now.getMonth()
      const monthStart = new Date(year, month, 1, 0, 0, 0, 0)
      const monthEnd = new Date(year, month + 1, 1, 0, 0, 0, 0)

      const classes = await db.class.findMany({
        where: { schoolId, classTeacherId: user.id },
        select: { id: true, name: true, section: true, room: true },
        orderBy: { name: 'asc' },
      })
      if (classes.length === 0) return { month: `${year}-${String(month + 1).padStart(2, '0')}`, classes: [] }

      const classIds = classes.map((c) => c.id)
      const students = await db.student.findMany({
        where: { classId: { in: classIds }, user: { status: 'ACTIVE' } },
        select: {
          id: true,
          rollNo: true,
          guardianName: true,
          guardianPhone: true,
          classId: true,
          user: { select: { name: true } },
        },
        orderBy: { rollNo: 'asc' },
      })
      const studentIds = students.map((s) => s.id)
      const labelByClass = new Map(classes.map((c) => [c.id, classLabelOf(c)]))

      // Fee ledgers + pre-workflow office payments (legacy rows NOT
      // mirrored from a canonical txn — mirrors carry transactionId).
      const feeRows = studentIds.length
        ? await db.fee.findMany({
            where: { studentId: { in: studentIds } },
            include: { payments: { orderBy: { createdAt: 'desc' }, take: 10 } },
            orderBy: [{ dueDate: 'asc' }],
          })
        : []
      const today = new Date()
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

      interface LedgerDto {
        status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'NONE'
        totalBilled: number
        totalPaid: number
        outstanding: number
        awaitingVerification: number
        items: { id: string; title: string; amount: number; paid: number; outstanding: number; status: string; dueDate: string | null }[]
        officePayments: { id: string; feeTitle: string; amount: number; method: string | null; createdAt: string }[]
      }
      const ledgerByStudent = new Map<string, LedgerDto>()
      for (const s of students) {
        const rows = feeRows.filter((f) => f.studentId === s.id)
        if (rows.length === 0) {
          ledgerByStudent.set(s.id, {
            status: 'NONE', totalBilled: 0, totalPaid: 0, outstanding: 0, awaitingVerification: 0,
            items: [], officePayments: [],
          })
          continue
        }
        const items = rows.map((f) => {
          const outstanding = Math.max(0, f.amount - f.paid)
          const status =
            outstanding <= 0 ? 'PAID'
            : f.dueDate && f.dueDate < endOfToday ? 'OVERDUE'
            : f.paid > 0 ? 'PARTIAL' : 'UNPAID'
          return {
            id: f.id, title: f.title, amount: f.amount, paid: f.paid, outstanding,
            status, dueDate: f.dueDate ? f.dueDate.toISOString().slice(0, 10) : null,
          }
        })
        const outstanding = items.reduce((sum, i) => sum + i.outstanding, 0)
        const status: LedgerDto['status'] =
          outstanding <= 0 ? 'PAID'
          : items.some((i) => i.status === 'OVERDUE') ? 'OVERDUE'
          : items.some((i) => i.paid > 0) ? 'PARTIAL' : 'UNPAID'
        ledgerByStudent.set(s.id, {
          status,
          totalBilled: rows.reduce((sum, f) => sum + f.amount, 0),
          totalPaid: rows.reduce((sum, f) => sum + Math.min(f.amount, f.paid), 0),
          outstanding,
          awaitingVerification: 0, // filled from txns below
          items,
          officePayments: rows
            .flatMap((f) =>
              f.payments
                .filter((p) => !p.transactionId)
                .map((p) => ({
                  id: p.id, feeTitle: f.title, amount: p.amount,
                  method: p.method, createdAt: p.createdAt.toISOString(),
                })),
            )
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, 10),
        })
      }

      // Canonical collection transactions for these students.
      const txnRows = studentIds.length
        ? await db.feeTransaction.findMany({
            where: { studentId: { in: studentIds }, source: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 400,
          })
        : []

      // awaiting-verification totals per student.
      const pendingByStudent = new Map<string, number>()
      for (const t of txnRows) {
        if (t.status === TXN_STATUS.PENDING_VERIFICATION && t.studentId) {
          pendingByStudent.set(t.studentId, (pendingByStudent.get(t.studentId) ?? 0) + t.amount)
        }
      }
      for (const [sid, ledger] of ledgerByStudent) {
        ledger.awaitingVerification = pendingByStudent.get(sid) ?? 0
      }

      const classesDto = classes.map((c) => {
        const classStudents = students.filter((s) => s.classId === c.id)
        const studentIdSet = new Set(classStudents.map((s) => s.id))
        const ledgers = classStudents.map((s) => ledgerByStudent.get(s.id)!).filter(Boolean)
        const classTxns = txnRows.filter((t) => t.studentId && studentIdSet.has(t.studentId))
        const inMonth = (d: Date | null) => !!d && d >= monthStart && d < monthEnd
        return {
          classId: c.id,
          label: labelByClass.get(c.id) ?? c.name,
          room: c.room,
          studentCount: classStudents.length,
          summary: {
            totalBilled: ledgers.reduce((sum, l) => sum + l.totalBilled, 0),
            collected: ledgers.reduce((sum, l) => sum + l.totalPaid, 0),
            outstanding: ledgers.reduce((sum, l) => sum + l.outstanding, 0),
            fullyPaid: ledgers.filter((l) => l.status === 'PAID').length,
            overdueStudents: ledgers.filter((l) => l.status === 'OVERDUE').length,
            awaitingVerificationCount: classTxns.filter(
              (t) => t.status === TXN_STATUS.PENDING_VERIFICATION,
            ).length,
            awaitingVerificationAmount: classTxns
              .filter((t) => t.status === TXN_STATUS.PENDING_VERIFICATION)
              .reduce((sum, t) => sum + t.amount, 0),
          },
          month: {
            label: monthStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
            verifiedAmount: classTxns
              .filter((t) => t.status === TXN_STATUS.VERIFIED && inMonth(t.verifiedAt ?? t.collectedAt))
              .reduce((sum, t) => sum + t.amount, 0),
            verifiedCount: classTxns.filter(
              (t) => t.status === TXN_STATUS.VERIFIED && inMonth(t.verifiedAt ?? t.collectedAt),
            ).length,
            pendingAmount: classTxns
              .filter((t) => t.status === TXN_STATUS.PENDING_VERIFICATION && inMonth(t.collectedAt))
              .reduce((sum, t) => sum + t.amount, 0),
            pendingCount: classTxns.filter(
              (t) => t.status === TXN_STATUS.PENDING_VERIFICATION && inMonth(t.collectedAt),
            ).length,
          },
          students: classStudents.map((s) => ({
            id: s.id,
            name: s.user.name,
            rollNo: s.rollNo,
            guardianName: s.guardianName,
            guardianPhone: s.guardianPhone,
            ledger: ledgerByStudent.get(s.id) ?? null,
          })),
          transactions: classTxns.map(toFeeTxnDto),
        }
      })

      return { month: `${year}-${String(month + 1).padStart(2, '0')}`, classes: classesDto }
    },
    { roles: ['TEACHER'] }
  )
}

/**
 * POST /api/teacher/fee-collection — STAGE 1 of the two-stage workflow
 * (MASTER TASK §7): a Class Teacher records a fee collection for a
 * student of a class they are APPOINTED to. Creates the canonical
 * FeeTransaction with status UNDER_VERIFICATION — the money is NOT
 * final until the Principal verifies (§8), so the student ledger is
 * deliberately left untouched and the response carries the honest
 * acknowledgement copy.
 *
 * Body: { studentId, feeId, amount, method, referenceNumber?, notes? }
 *
 * Server-enforced (§21–§22):
 *   · the teacher MUST be the student's class's appointed class teacher;
 *   · the fee MUST belong to this student in this school;
 *   · amount > 0 and ≤ the fee's remaining outstanding (no overpay);
 *   · duplicate reference numbers are rejected (§29-8);
 *   · principals receive a verification ping; an audit row is written.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const studentId = String(body.studentId || '')
      const feeId = String(body.feeId || '')
      const amount = Math.round(Number(body.amount) * 100) / 100
      const method = String(body.method || 'CASH').toUpperCase()
      const referenceNumber = String(body.referenceNumber || '').trim()
      const notes = String(body.notes || '').trim()

      if (!studentId || !feeId) throw new Error('studentId and feeId are required')
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero')

      // ── Permission: appointed class teacher of THIS student's class ──
      const { student, cls } = await assertClassTeacherOfStudent(user, schoolId, studentId)
      const classLabel = classLabelOf(cls)

      const fee = await db.fee.findFirst({ where: { id: feeId, studentId, schoolId } })
      if (!fee) throw new Error('Fee record not found for this student')
      const outstanding = Math.max(0, fee.amount - fee.paid)
      if (outstanding <= 0) throw new Error('This fee is already fully paid')
      if (amount > outstanding) {
        throw new Error(
          `Amount exceeds the outstanding balance of this fee (₹${outstanding.toLocaleString('en-IN')}). Partial payments are allowed — overpayments are not.`,
        )
      }

      // ── Pending-collection guard (audit: no double receipts) ──────────
      // Pending collections deliberately do NOT reduce the ledger's
      // outstanding — so without this check, two overlapping collections
      // could EACH pass the outstanding check and verification would mint
      // a receipt for money not owed. The guard keeps the SAME invariant
      // pending-money holds as verified-money: never beyond the balance.
      const pendingOnFee = await db.feeTransaction.findMany({
        where: { feeId: fee.id, status: TXN_STATUS.PENDING_VERIFICATION },
        select: { amount: true },
      })
      const pendingSum = pendingOnFee.reduce((s, t) => s + t.amount, 0)
      if (pendingSum > 0 && pendingSum + amount > outstanding) {
        throw new Error(
          `₹${pendingSum.toLocaleString('en-IN')} towards "${fee.title}" is already awaiting the Principal's verification. Once verified (or rejected), you can collect up to the remaining balance of ₹${Math.max(0, outstanding - pendingSum).toLocaleString('en-IN')}.`,
        )
      }

      await assertReferenceUnique(schoolId, referenceNumber)

      const studentName = student.user.name ?? 'Student'
      // Phase 3: the reference-uniqueness pre-check stays (human copy),
      // but the DB (schoolId, referenceNumber) unique is now the source of
      // truth for the RACE — a P2002 from a concurrent duplicate reference
      // is translated to a clean 409 CONFLICT instead of a 500.
      const txn = await db.feeTransaction
        .create({
          data: {
            schoolId,
            studentId,
            studentName,
            className: classLabel,
            feeId: fee.id,
            feeHeadName: fee.title,
            amount,
            method,
            status: TXN_STATUS.PENDING_VERIFICATION,
            source: 'CLASS_TEACHER',
            referenceNumber: referenceNumber || null,
            note: notes || null,
            collectedById: user.id,
            collectedByName: user.name ?? 'Class Teacher',
            collectedAt: new Date(),
          },
        })
        .catch((e: unknown) => {
          const err = e as { code?: string; message?: string }
          if (err?.code === 'P2002' && (err.message ?? '').includes('referenceNumber')) {
            // Clean 409 CONFLICT — the DB unique caught the race the
            // pre-check missed; no Prisma internals reach the client.
            throw new AppError('CONFLICT', {
              publicMessage: `Duplicate reference number — ${referenceNumber} is already recorded for this school. A payment cannot be recorded twice with the same reference.`,
              internalDetail: `P2002 (schoolId, referenceNumber) on teacher/fee-collection: ${(err.message ?? '').slice(0, 300)}`,
            })
          }
          throw e
        })

      // ── Verification ping to the principal + audit (best-effort) ────
      const recipients = await principalUserIds(schoolId)
      await Promise.all([
        ...recipients.map((pid) =>
          pushMessage(
            schoolId,
            user.id,
            pid,
            `Fee collection awaiting verification · ${studentName}`,
            `${user.name ?? 'A class teacher'} recorded a ${method === 'CASH' ? 'cash' : method} collection of ₹${amount.toLocaleString('en-IN')} from ${studentName} (${classLabel}) towards "${fee.title}". The payment is awaiting your verification before it becomes a final receipt.`,
          ),
        ),
        audit(
          schoolId,
          user.id,
          'fee.collected',
          `₹${amount.toLocaleString('en-IN')} from ${studentName} (${classLabel}) towards "${fee.title}" — awaiting Principal verification (txn ${txn.id})`,
        ),
      ])

      return {
        txn: toFeeTxnDto(txn),
        acknowledgement: {
          headline: 'Collection recorded — awaiting Principal verification',
          body: `Your ${method === 'CASH' ? 'cash' : method} collection of ₹${amount.toLocaleString('en-IN')} from ${studentName} is saved and pending. It is NOT a final receipt yet — the Principal verifies it first. The student's fee balance updates only after verification; until then the amount shows as "awaiting verification".`,
        },
      }
    },
    { roles: ['TEACHER'] }
  )
}
