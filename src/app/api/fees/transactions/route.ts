import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'

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
///         note?, receiptNo? }
/// Returns the created transaction.
///
/// 3-c fix: a provided body.studentId is FK-validated in-tenant BEFORE
/// the write (db.student.findFirst({ id, schoolId }) → 404) — was a bare
/// cross-tenant FK write.
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
          throw new AppError('NOT_FOUND', {
            publicMessage: 'Student not found',
            internalDetail: `transactions POST: student ${body.studentId} missing or foreign tenant`,
          })
        }
        studentId = student.id
      }

      const receiptNo = body.receiptNo || `RCP-${Date.now()}`
      const txn = await db.feeTransaction.create({
        data: {
          schoolId,
          studentId,
          studentName: body.studentName ? String(body.studentName).slice(0, 120) : null,
          className: body.className ? String(body.className).slice(0, 80) : null,
          feeHeadName: body.feeHeadName ? String(body.feeHeadName).slice(0, 120) : null,
          amount,
          method: String(body.method || 'Cash').toUpperCase().replace(' ', '_'),
          status: 'SUCCESS',
          gatewayName: 'manual',
          receiptNo,
          note: body.note ? String(body.note).slice(0, 500) : null,
          reconciliationStatus: 'unreconciled',
          reconciledAt: null,
          reconciledBy: ctx.user.id,
        },
      })
      return txn
    },
  )
}
