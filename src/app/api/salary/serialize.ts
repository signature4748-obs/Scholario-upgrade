import type { SalaryPayment, SalaryStructure } from '@prisma/client'
import { num } from '@/lib/money'

/**
 * PHASE 8B (Task 8B-7-c) — salary route serialization.
 *
 * Canonical payroll DTOs for the fixed-MONTHLY-salary model:
 *   · SalaryStructure — ONE configured monthly amount per teacher
 *     (Decimal(12,2) → JSON number via num(), the established money-route
 *     boundary — see src/lib/money.ts and /api/fees/*).
 *   · SalaryPayment — the principal-recorded monthly payment
 *     (RECORDED | VOIDED); `month` is emitted as the 'YYYY-MM' period key
 *     so clients never re-derive it from a Date.
 *
 * Money leaves as JSON NUMBERS (num() is exact for 2-decimal NUMERIC(12,2)
 * values — the same contract every fees route uses); the realtime payload
 * alone carries the amount as a string (notification-signal discipline).
 */

/** 'YYYY-MM' period key of a salary-month Date (stored as first-of-month UTC). */
export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Teacher fragments the salary routes include — STRUCTURAL (not the full
 * Prisma Teacher row): each route selects exactly the fields the DTOs
 * emit, and Prisma's include result carries only those. Every call site
 * (GET /api/salary, PUT structure, POST payments, POST void) selects at
 * least this shape.
 */
interface TeacherForStructure {
  id: string
  employeeId: string | null
  department: string | null
  user: { name: string | null; email?: string | null }
}

interface TeacherForPayment {
  id: string
  employeeId: string | null
  user: { name: string | null }
}

export interface SerializedStructure {
  id: string
  teacherId: string
  monthlyAmount: number
  effectiveFrom: string | null
  note: string | null
  updatedAt: string
  teacher: {
    id: string
    employeeId: string | null
    department: string | null
    user: { name: string; email?: string | null }
  }
}

export interface SerializedPayment {
  id: string
  teacherId: string
  /** 'YYYY-MM' — the salary month this payment settles. */
  month: string
  amount: number
  paidOn: string
  method: string | null
  reference: string | null
  note: string | null
  status: string
  createdAt: string
  updatedAt: string
  teacher: {
    id: string
    employeeId: string | null
    user: { name: string }
  }
}

export function serializeStructure(
  row: SalaryStructure & { teacher: TeacherForStructure },
): SerializedStructure {
  return {
    id: row.id,
    teacherId: row.teacherId,
    monthlyAmount: num(row.monthlyAmount),
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString() : null,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
    teacher: {
      id: row.teacher.id,
      employeeId: row.teacher.employeeId,
      department: row.teacher.department,
      user: {
        name: row.teacher.user.name ?? 'Unnamed teacher',
        email: row.teacher.user.email ?? null,
      },
    },
  }
}

export function serializePayment(
  row: SalaryPayment & { teacher: TeacherForPayment },
): SerializedPayment {
  return {
    id: row.id,
    teacherId: row.teacherId,
    month: monthKeyOf(row.month),
    amount: num(row.amount),
    paidOn: row.paidOn.toISOString(),
    method: row.method,
    reference: row.reference,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    teacher: {
      id: row.teacher.id,
      employeeId: row.teacher.employeeId,
      user: { name: row.teacher.user.name ?? 'Unnamed teacher' },
    },
  }
}
