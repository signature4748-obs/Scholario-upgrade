import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/// GET /api/fees/payments?orderId=… — SETTLEMENT STATUS LOOKUP (UX-3 §31).
///
/// Lets the client re-check an UNCERTAIN order after a network error: the
/// demo-gateway settlement call may have landed server-side even though the
/// response never reached the browser. The answer is always the server's
/// own FeeTransaction state — the client re-syncs its UI mirror from THIS,
/// never from its own assumption.
///
/// Authorisation mirrors /api/fees/payments/confirm:
///   · roles [PRINCIPAL, MANAGEMENT, ACCOUNTANT, PARENT, STUDENT]
///   · the order is matched by gatewayOrderId AND schoolId (tenant
///     isolation).
///   · STUDENT: the order's studentId must equal the session's linked
///     Student row id (§25 — only your own orders).
///   · PARENT (3-c fix): the order's studentId must be one of the
///     caller's OWN children (guardianId = user.id, same school) — a
///     parent could previously look up ANY family's order status by id.
///
/// Returns the same settlement snapshot shape as the confirm endpoint:
///   { status, receiptNo, gatewayPaymentId, orderId, amount, method, txnId, note }

export async function GET(req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'PARENT', 'STUDENT'] },
    async (ctx) => {
      const schoolId = ctx.schoolId
      const user = ctx.user
      const orderId = req.nextUrl.searchParams.get('orderId') || ''
      if (!orderId) throw new AppError('INVALID_INPUT', { publicMessage: 'orderId is required.' })

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

      return {
        status: txn.status,
        receiptNo: txn.receiptNo,
        gatewayPaymentId: txn.gatewayPaymentId,
        orderId: txn.gatewayOrderId ?? '',
        amount: num(txn.amount),
        method: txn.method,
        txnId: txn.id,
        note: txn.note,
      }
    },
  )
}
