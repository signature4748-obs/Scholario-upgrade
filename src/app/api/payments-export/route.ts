import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

const METHOD_LABELS: Record<string, string> = {
  UPI: 'UPI',
  CARD: 'Card',
  NETBANKING: 'Net Banking',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  WALLET: 'Wallet',
}

// CSV-escape a single field (quotes, commas, newlines)
const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/payments-export?limit=500
// Streams the transaction ledger as a downloadable CSV. Super admins export
// platform-wide rows; school staff are scoped to their own school.
//
// 3-c fix: role gate added — 'school.finance.export' semantics
// (PRINCIPAL / MANAGEMENT / ACCOUNTANT) PLUS SUPER_ADMIN, which keeps its
// deliberate platform-wide branch. Before, ANY authenticated role
// (STUDENT / TEACHER / PARENT) could download the school payments ledger
// CSV with student names + admission numbers. tenant: 'any' is required
// so the platform admin (schoolId null) is not refused by the
// school-scoped tenant check; every school-scoped caller still reads only
// rows joined through fee.schoolId = ctx.schoolId.
export async function GET(req: NextRequest) {
  return withAuthz(
    { roles: ['SUPER_ADMIN', 'PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'], tenant: 'any' },
    async (ctx) => {
      const url = new URL(req.url)
      const limitRaw = Number(url.searchParams.get('limit') || 500)
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 1), 2000)

      const where =
        ctx.isPlatform
          ? {}
          : { fee: { schoolId: ctx.schoolId || '__none__' } }

      const rows = await db.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          fee: {
            select: {
              title: true,
              student: { select: { user: { select: { name: true } }, admissionNo: true, class: { select: { name: true } } } },
              school: { select: { name: true, code: true } },
            },
          },
        },
      })

      const header = [
        'Txn ID',
        'Date',
        'Student',
        'Admission No',
        'Class',
        'Fee',
        'School',
        'Method',
        'Status',
        'Amount (INR)',
      ]
      const lines = [header.join(',')]
      for (const p of rows) {
        lines.push(
          [
            p.transactionId ?? p.id,
            new Date(p.createdAt).toISOString(),
            p.fee?.student?.user?.name ?? '—',
            p.fee?.student?.admissionNo ?? '—',
            p.fee?.student?.class?.name ?? '—',
            p.fee?.title ?? '—',
            p.fee?.school?.name ?? '—',
            METHOD_LABELS[(p.method || '').toUpperCase()] ?? p.method ?? '—',
            p.status,
            p.amount,
          ]
            .map(csvCell)
            .join(',')
        )
      }

      const stamp = new Date().toISOString().slice(0, 10)

      // Phase 1 — the transaction ledger leaving the system as a file is an
      // auditable security event.
      await auditEvent({
        schoolId: ctx.isPlatform ? null : ctx.schoolId,
        userId: ctx.user.id,
        action: 'STUDENT_DATA_EXPORT',
        requestId: newRequestId(),
        detail: `Payments ledger CSV export served (${rows.length} rows)`,
      }).catch(() => {})

      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="scholario-transactions-${stamp}.csv"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    },
  )
}
