import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { num, outstandingDec } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/fees/receipts/[txnId] — the canonical receipt document
 * (MASTER TASK §16–§18) for ONE payment transaction, rendered by the
 * shared receipt viewer (teacher collection table, principal queue,
 * student profile history all open the SAME document).
 *
 *   · VERIFIED — the official FEE PAYMENT RECEIPT: school branding,
 *     receipt number, student, class, admission no, fee details, total,
 *     method, source, collected by, verified by, verification date,
 *     academic year + the ledger state after this payment (balance due
 *     from the SAME Fee row every other surface reads).
 *   · UNDER_VERIFICATION — the PROVISIONAL COLLECTION ACKNOWLEDGEMENT
 *     (§18): clearly marked as awaiting Principal verification, NOT an
 *     official receipt, no receipt number is shown as final.
 *   · REJECTED — an honest rejection notice with the reason.
 *
 * Authorisation (§17, §21):
 *   · PRINCIPAL / MANAGEMENT — any receipt in their school;
 *   · TEACHER — only students of classes they are CURRENTLY appointed
 *     class teacher of (the appointment IS the permission);
 *   · STUDENT — only their own payment.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ txnId: string }> }) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { txnId } = await params

      const txn = await db.feeTransaction.findFirst({
        where: { id: txnId, schoolId },
        include: { school: { select: { name: true, address: true, city: true, phone: true, email: true, academicYear: true } } },
      })
      if (!txn) throw new Error('NOT_FOUND')

      // ── Authorisation ──────────────────────────────────────────────
      if (user.role === 'TEACHER') {
        if (!txn.studentId) throw new Error('FORBIDDEN')
        const student = await db.student.findFirst({
          where: { id: txn.studentId, schoolId },
          select: { classId: true, class: { select: { classTeacherId: true } } },
        })
        if (!student?.class || student.class.classTeacherId !== user.id) throw new Error('FORBIDDEN')
      } else if (user.role === 'STUDENT') {
        const me = await db.student.findFirst({ where: { userId: user.id, schoolId } })
        if (!me || txn.studentId !== me.id) throw new Error('FORBIDDEN')
      }

      // Student + fee context (the student's own admission number and
      // the ledger line this payment applies to).
      let studentInfo: {
        name: string
        admissionNo: string | null
        rollNo: string | null
        classLabel: string
        guardianName: string | null
      } | null = null
      if (txn.studentId) {
        const s = await db.student.findFirst({
          where: { id: txn.studentId, schoolId },
          select: {
            admissionNo: true, rollNo: true, guardianName: true,
            user: { select: { name: true } },
            class: { select: { name: true, section: true } },
          },
        })
        if (s) {
          studentInfo = {
            name: s.user.name ?? 'Student',
            admissionNo: s.admissionNo,
            rollNo: s.rollNo,
            classLabel: classLabelOf(s.class ? { name: s.class.name, section: s.class.section } : null),
            guardianName: s.guardianName,
          }
        }
      }

      // Ledger state AFTER this payment (verified) / CURRENT (pending).
      let feeLine: { title: string; amount: number; paid: number; outstanding: number } | null = null
      if (txn.feeId) {
        const fee = await db.fee.findUnique({ where: { id: txn.feeId } })
        if (fee && fee.schoolId === schoolId) {
          feeLine = {
            title: fee.title,
            amount: num(fee.amount),
            paid: num(fee.paid),
            outstanding: num(outstandingDec(fee.amount, fee.paid)),
          }
        }
      }

      return {
        txn: {
          id: txn.id,
          status: txn.status,
          receiptNo: txn.receiptNo,
          amount: num(txn.amount),
          method: txn.method,
          source: txn.source,
          referenceNumber: txn.referenceNumber,
          note: txn.note,
          studentName: txn.studentName,
          className: txn.className,
          feeHeadName: txn.feeHeadName,
          collectedByName: txn.collectedByName,
          collectedAt: txn.collectedAt ? txn.collectedAt.toISOString() : null,
          verifiedByName: txn.verifiedByName,
          verifiedAt: txn.verifiedAt ? txn.verifiedAt.toISOString() : null,
          rejectedByName: txn.rejectedByName,
          rejectedAt: txn.rejectedAt ? txn.rejectedAt.toISOString() : null,
          rejectionReason: txn.rejectionReason,
          createdAt: txn.createdAt.toISOString(),
        },
        school: {
          name: txn.school.name,
          address: txn.school.address,
          city: txn.school.city,
          phone: txn.school.phone,
          email: txn.school.email,
          academicYear: txn.school.academicYear,
        },
        student: studentInfo,
        fee: feeLine,
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'STUDENT'] }
  )
}
