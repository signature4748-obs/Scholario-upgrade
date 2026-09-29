import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'

export const runtime = 'nodejs'

/// GET /api/fees/settlements — list all gateway settlements for the school.
///
/// 3-c fix: gated to 'school.finance.read' (PRINCIPAL / MANAGEMENT /
/// ACCOUNTANT). Before, ANY authenticated role could read the payout
/// register with per-transaction student names. (Client-grep: no client
/// surface fetches this route — the finance dashboard renders the
/// fee-store's settlement mock; the gate breaks no legit flow.)
export async function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.finance.read' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where: any = { schoolId }
    if (status) where.status = status
    if (from || to) {
      where.periodStart = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      }
    }

    const settlements = await db.settlement.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      include: {
        _count: { select: { transactions: true } },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            receiptNo: true,
            studentName: true,
            className: true,
            amount: true,
            method: true,
            status: true,
            reconciliationStatus: true,
            gatewayOrderId: true,
            gatewayPaymentId: true,
            createdAt: true,
          },
        },
      },
      take: 100,
    })
    return settlements
  })
}
