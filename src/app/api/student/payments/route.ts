import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireStudent } from '@/lib/learning'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/// GET /api/student/payments — the signed-in student's OWN payment
/// history from the canonical fee ledger (FeeTransaction rows).
///
/// STUDENT-QA S5-7 fix: the Fees module's "Payments & receipts" section
/// previously read ONLY the client fee-store's transaction mirror, so on
/// a fresh browser it rendered "No payments recorded yet this session"
/// even when the canonical DB ledger held real SUCCESS receipts for this
/// student. This route is the server truth for the receipts list —
/// resolved from the SESSION (a client-supplied studentId is never
/// trusted), scoped to the caller's school AND student row, and mapped
/// to the module's display shape.
///
/// Returns: { payments: FeeTransaction[] } (display shape; newest first,
/// max 50). Failed/Refunded rows are EXCLUDED — receipts history shows
/// countable money only (Success + Under Verification), the same rule
/// the Statement component applies.
export async function GET() {
  return withUser(
    async (user) => {
      const ctx = await requireStudent(user)

      const rows = await db.feeTransaction.findMany({
        where: {
          schoolId: ctx.schoolId,
          studentId: ctx.studentId,
          status: { in: ['SUCCESS', 'UNDER_VERIFICATION'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      const payments = rows.map((t) => ({
        id: t.id,
        receiptNo: t.receiptNo ?? '',
        studentId: t.studentId ?? '',
        studentName: t.studentName ?? '',
        admissionNo: '',
        className: t.className ?? '',
        classId: '',
        amount: num(t.amount),
        mode: (t.method ?? 'Cash') as
          | 'UPI'
          | 'Card'
          | 'Net Banking'
          | 'Cash'
          | 'Cheque'
          | 'Bank Transfer',
        status: (t.status === 'SUCCESS' ? 'Success' : 'Under Verification') as
          | 'Success'
          | 'Under Verification',
        date: (t.collectedAt ?? t.createdAt).toISOString().slice(0, 10),
        recordedAt: (t.collectedAt ?? t.createdAt).toISOString(),
        purpose: t.note ?? t.reconciliationNote ?? '',
        feeHead: t.feeHeadName ?? '',
        collectedBy: t.collectedByName ?? '',
        verifiedBy: t.verifiedByName ?? null,
        verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
        referenceNo: t.referenceNumber ?? null,
        academicYear: '',
        gatewayPaymentId: t.gatewayPaymentId ?? undefined,
      }))

      return { payments }
    },
    { roles: ['STUDENT'] },
  )
}
