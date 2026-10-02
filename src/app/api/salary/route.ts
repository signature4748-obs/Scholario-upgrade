import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { serializePayment, serializeStructure } from './serialize'

export const runtime = 'nodejs'

/**
 * GET /api/salary — the canonical payroll read (Phase 8B, Task 8B-7-c).
 *
 * PostgreSQL is the single source of truth for salary: this route replaces
 * the browser-localStorage payroll ledger ('scholario-salary-v4').
 *
 * BUSINESS MODEL (strict): fixed MONTHLY salary only — one configured
 * SalaryStructure row per teacher (monthlyAmount), payments recorded by
 * the principal as canonical SalaryPayment rows (RECORDED | VOIDED). No
 * HRA/PF/tax/deduction/gross-net arithmetic exists anywhere in the payload.
 *
 * Views (tenant ALWAYS from the session — never client input):
 *   · PRINCIPAL / MANAGEMENT — the whole school:
 *       { role, structures, payments, teachers } — structures include the
 *       owning teacher (user name/email); payments ordered month-desc
 *       (capped at 500 — the workspace is a working ledger, not an export);
 *       teachers = the real Teacher+User roster for pickers/assignments.
 *   · TEACHER — own rows only: { role, me, structure, payments } resolved
 *       via the session's OWN Teacher row (userId match, tenant-checked).
 *       A teacher without a Teacher row gets honest nulls/empty arrays.
 *   · Other school roles (STUDENT/PARENT/…) → 403 at the role gate.
 */
export async function GET(_req: NextRequest) {
  return withAuthz(
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
    async (ctx) => {
      const { user, schoolId, role } = ctx

      // ── TEACHER — own structure + own canonical payments only ─────────
      if (role === 'TEACHER') {
        const teacher = await db.teacher.findFirst({
          where: { userId: user.id, schoolId },
          select: {
            id: true,
            employeeId: true,
            department: true,
            user: { select: { name: true } },
          },
        })
        if (!teacher) {
          // Honest empty: the account has no staff record at this school.
          return { role, me: null, structure: null, payments: [] }
        }
        const structure = await db.salaryStructure.findUnique({
          where: { teacherId: teacher.id },
          include: {
            teacher: {
              select: { id: true, employeeId: true, department: true, user: { select: { name: true, email: true } } },
            },
          },
        })
        const payments = await db.salaryPayment.findMany({
          where: { schoolId, teacherId: teacher.id },
          include: {
            teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
          },
          orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
        })
        return {
          role,
          me: {
            id: teacher.id,
            name: teacher.user.name ?? 'Unnamed teacher',
            employeeId: teacher.employeeId ?? '',
            department: teacher.department ?? '',
          },
          structure: structure ? serializeStructure(structure) : null,
          payments: payments.map(serializePayment),
        }
      }

      // ── PRINCIPAL / MANAGEMENT — the whole school's payroll ──────────
      const [teachers, structures, payments] = await Promise.all([
        db.teacher.findMany({
          where: { schoolId },
          select: {
            id: true,
            employeeId: true,
            department: true,
            user: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        db.salaryStructure.findMany({
          where: { schoolId },
          include: {
            teacher: {
              select: { id: true, employeeId: true, department: true, user: { select: { name: true, email: true } } },
            },
          },
          orderBy: { updatedAt: 'desc' },
        }),
        db.salaryPayment.findMany({
          where: { schoolId },
          include: {
            teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
          },
          orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
          take: 500,
        }),
      ])

      return {
        role,
        teachers: teachers.map((t) => ({
          id: t.id,
          name: t.user.name ?? 'Unnamed teacher',
          employeeId: t.employeeId ?? '',
          department: t.department ?? '',
        })),
        structures: structures.map(serializeStructure),
        payments: payments.map(serializePayment),
      }
    },
  ) as Promise<Response>
}
