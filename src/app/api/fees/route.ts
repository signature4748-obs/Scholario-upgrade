import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, idSchema, safeText } from '@/lib/security/validation'

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
    return fees
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
      const fee = await db.fee.findUnique({ where: { id: body.feeId } })
      if (!fee || fee.schoolId !== schoolId) throw new AppError('NOT_FOUND')
      const amount = body.amount
      const remaining = fee.amount - fee.paid
      if (remaining <= 0) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'This fee is already fully paid',
          internalDetail: `fee ${fee.id} paid=${fee.paid} amount=${fee.amount}`,
        })
      }
      if (amount > remaining) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Amount exceeds the outstanding balance (₹${remaining})`,
          internalDetail: `fee ${fee.id} payment ${amount} > remaining ${remaining}`,
        })
      }
      const newPaid = fee.paid + amount
      const status = newPaid >= fee.amount ? 'PAID' : newPaid > 0 ? 'PARTIAL' : fee.status
      await db.$transaction([
        db.payment.create({
          data: {
            feeId: fee.id,
            amount,
            method: body.method || 'CASH',
            note: body.note || null,
          },
        }),
        db.fee.update({
          where: { id: fee.id },
          data: { paid: newPaid, status, method: body.method || fee.method, paidDate: new Date() },
        }),
      ])
      return { ok: true, feeId: fee.id, paid: newPaid, status }
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
      throw new AppError('NOT_FOUND', {
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
    return fee
  })
}
