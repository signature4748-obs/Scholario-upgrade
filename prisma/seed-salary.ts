/**
 * seed-salary — canonical payroll demo data for the DEMO tenant (Phase 8B,
 * Task 8B-7-c salary persistence).
 *
 * ONLY for Sunrise Academy (the isDemo school — verified before any write).
 * Gives the salary module its live demo corpus:
 *
 *   · SalaryStructure — one fixed MONTHLY amount per existing Teacher
 *     (deterministic ladder by roster index: ₹28,000 + ₹6,000 × i, capped
 *     at ₹52,000; effective-from = the current academic session's April 1).
 *     NO components/HRA/deductions — the business model is one monthly
 *     amount, nothing else.
 *   · SalaryPayment — RECORDED rows for the LAST 2 COMPLETED months per
 *     teacher, amount = the teacher's monthly salary, mixed methods
 *     (deterministic cycle BANK_TRANSFER → UPI → CASH), deterministic
 *     references (`SAL-<YYYY-MM>-<employeeId>`), paidOn = a fixed day
 *     inside each month.
 *
 * Idempotency: SKIP-IF-EXISTS per unique key (structure per teacherId;
 * payment per schoolId+teacherId+month+status). Re-running never overwrites
 * a row the principal edited and never duplicates a payment month — a
 * later re-run simply plants the newer completed months it finds missing.
 *
 * Principles (same as the other Phase-8A domain seeds):
 *   · runtime-resolved ids only — school by slug, teachers by roster,
 *     principal by email; NO hardcoded cuids;
 *   · relative months (derived from now) so the demo never goes stale;
 *   · honest data — every row is a real row the salary module reads.
 *
 * Run: bun prisma/seed-salary.ts   (also wired as pipeline step 12 of
 * prisma/seed-demo.ts)
 */
import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG } from './seed-identity'

const db = new PrismaClient()

/** Demo principal — the canonical author of every seeded payroll row. */
const DEMO_PRINCIPAL_EMAIL = 'principal@sunriseacademy.edu'

/** Fixed monthly-salary ladder: ₹28,000 → ₹52,000 by roster index. */
const SALARY_BASE = 28_000
const SALARY_STEP = 6_000
const SALARY_MAX = 52_000

/** Deterministic method cycle for the demo payment rows. */
const METHODS = ['BANK_TRANSFER', 'UPI', 'CASH'] as const

/** The last `count` COMPLETED months as 'YYYY-MM' keys (newest last). */
function lastCompletedMonths(count: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** 'YYYY-MM' → first day of that month, UTC (the storage-layer month shape). */
function monthStart(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
}

/** paidOn for a seeded month — a fixed working day inside that month. */
function paidOnFor(monthKey: string, offset: number): Date {
  const start = monthStart(monthKey)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 5 + offset, 4, 30))
}

/** Current academic session start (April 1) — informational provenance. */
function sessionStart(now = new Date()): Date {
  const y = now.getUTCFullYear()
  return new Date(Date.UTC(now.getUTCMonth() >= 3 ? y : y - 1, 3, 1))
}

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-salary')

  const school = await db.school.findUnique({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) throw new Error(`[seed-salary] demo school ${DEMO_SCHOOL_SLUG} not found (run bun run seed:demo first)`)
  // Mission invariant: demo payroll data is ONLY ever planted in the isDemo
  // tenant — a non-demo school with this slug is a hard error, not a warning.
  if (!school.isDemo) {
    throw new Error(`[seed-salary] refusing to seed salary into non-demo school ${school.name} (${school.slug})`)
  }

  const principal = await db.user.findUnique({
    where: { email: DEMO_PRINCIPAL_EMAIL },
    select: { id: true, name: true },
  })
  if (!principal) {
    throw new Error(`[seed-salary] demo principal ${DEMO_PRINCIPAL_EMAIL} not found`)
  }

  const teachers = await db.teacher.findMany({
    where: { schoolId: school.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, employeeId: true, user: { select: { name: true } } },
  })
  if (teachers.length === 0) {
    console.log('[seed-salary] no teachers on the roster — nothing to plant (honest empty payroll)')
    return
  }

  const effectiveFrom = sessionStart()
  const months = lastCompletedMonths(2)

  // ── 1. Structures — skip-if-exists per teacher (never overwrites) ──────
  let structuresPlanted = 0
  for (const [i, t] of teachers.entries()) {
    const monthlyAmount = Math.min(SALARY_BASE + SALARY_STEP * i, SALARY_MAX)
    const exists = await db.salaryStructure.findUnique({ where: { teacherId: t.id }, select: { id: true } })
    if (exists) continue
    await db.salaryStructure.create({
      data: {
        schoolId: school.id,
        teacherId: t.id,
        monthlyAmount,
        effectiveFrom,
        updatedById: principal.id,
      },
    })
    structuresPlanted++
  }

  // ── 2. Payments — skip-if-exists per (teacher, month, RECORDED) ────────
  let paymentsPlanted = 0
  for (const [i, t] of teachers.entries()) {
    const structure = await db.salaryStructure.findUnique({ where: { teacherId: t.id } })
    if (!structure) continue // honest: no structure → no seeded payment
    const employeeTag = (t.employeeId ?? t.id.slice(-6)).replace(/[^A-Za-z0-9-]/g, '')
    for (const [m, monthKey] of months.entries()) {
      const exists = await db.salaryPayment.findFirst({
        where: { schoolId: school.id, teacherId: t.id, month: monthStart(monthKey), status: 'RECORDED' },
        select: { id: true },
      })
      if (exists) continue
      await db.salaryPayment.create({
        data: {
          schoolId: school.id,
          teacherId: t.id,
          month: monthStart(monthKey),
          amount: structure.monthlyAmount,
          paidOn: paidOnFor(monthKey, m),
          method: METHODS[(i + m) % METHODS.length],
          reference: `SAL-${monthKey}-${employeeTag}`,
          status: 'RECORDED',
          recordedById: principal.id,
        },
      })
      paymentsPlanted++
    }
  }

  // ── Summary (deterministic audit of what the demo tenant now holds) ───
  const counts = {
    teachers: teachers.length,
    structures: await db.salaryStructure.count({ where: { schoolId: school.id } }),
    payments: await db.salaryPayment.count({ where: { schoolId: school.id } }),
  }
  console.log(
    `[seed-salary] ${school.name}: ${structuresPlanted} structure(s) + ${paymentsPlanted} payment(s) planted for months ${months.join(' + ')}`,
  )
  console.log(`[seed-salary] totals now on the tenant: ${JSON.stringify(counts)}`)
  console.log('[seed-salary] principal author:', principal.name, '· effectiveFrom:', effectiveFrom.toISOString().slice(0, 10))
  console.log('[seed-salary] skip-if-exists idempotent — safe to re-run')
}

main()
  .catch((e) => {
    console.error('[seed-salary] FAILED:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
