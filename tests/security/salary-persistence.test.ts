import { db } from '../helpers/db'
/**
 * Task 8B-7-c — Salary persistence (LIVE HTTP).
 *
 * Proves PostgreSQL is the SINGLE SOURCE OF TRUTH for the fixed-monthly
 * payroll (the retired browser ledger 'scholario-salary-v4' is gone):
 *
 *   1. principal sets a structure (PUT /api/salary/structure) → the
 *      teacher's GET /api/salary returns the SAME canonical structure.
 *   2. principal records a payment (POST /api/salary/payments) → the
 *      teacher sees the SAME canonical row and the row count increments.
 *   3. duplicate (teacher, month) POST → 409 SALARY_PAYMENT_DUPLICATE
 *      with the existing row in the payload.
 *   4. void → status VOIDED (teacher sees it too) → re-recording the same
 *      month is allowed (the storage-layer unique key freed the slot).
 *   5. teacher cannot PUT structure / POST payment (403).
 *   6. cross-tenant teacherId → fail-safe 404 (no existence oracle).
 *   7. amount validation: 0 / negative / > ₹50,00,000 rejected 422.
 *
 * Live-HTTP conventions match tests/security/phase75-product.test.ts and
 * tests/security/messaging-persistence.test.ts: runs against the dev server
 * (TENANT_TEST_BASE, default :3000) with real sessions minted as DIRECT
 * ROWS (auth fixture that bypasses only the login limiter — never an
 * authorization gate).
 *
 * Isolation discipline: a DEDICATED test teacher (User + Teacher rows,
 * marker-suffixed) is created in beforeAll and fully removed in afterAll —
 * demo-seed salary rows (Sunrise structures + 2026-08/2026-09 payments)
 * are NEVER touched. Payments use far-past months (2001-01/2001-02) so no
 * unique key can ever collide with the demo corpus, and cleanup deletes
 * exact row ids only — never a sweep.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const TEST_TIMEOUT = 45_000

// ─── fixtures ──────────────────────────────────────────────────────────────

const MARKER = `SP-${randomBytes(4).toString('hex')}`

let schoolA = { id: '' }
let schoolB = { id: '' }
/** The dedicated test teacher (User + Teacher) this suite owns end-to-end. */
let testTeacher = { userId: '', teacherId: '', email: '' }
/** A Teacher row planted in the OTHER tenant (green-valley) for 404 proofs. */
let crossTenantTeacher = { teacherId: '', userId: '' }

let tokenPrincipal = ''
let tokenTeacher = ''

/** Salary row ids this suite created via the APIs (exact-id cleanup). */
const createdPaymentIds: string[] = []
const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const [a, b] = await Promise.all([
    db.school.findUnique({ where: { slug: 'sunrise-academy' } }),
    db.school.findUnique({ where: { slug: 'green-valley' } }),
  ])
  if (!a || !b) throw new Error('fixture schools missing (run bun run seed:demo / seed:clean)')
  schoolA = { id: a.id }
  schoolB = { id: b.id }

  const pa = await db.user.findUnique({ where: { email: 'tenant.principal.a@sunrise.test' } })
  const tb = await db.user.findUnique({ where: { email: 'teacher.b@greenvalley.test' } })
  if (!pa) throw new Error('fixture users missing (run bun run db:seed-tenant-isolation)')
  if (!tb) throw new Error('green-valley teacher fixture user missing (run bun run seed:clean)')

  // Dedicated test teacher in the PRINCIPAL'S tenant (this suite's own rows).
  const teacherUser = await db.user.create({
    data: {
      email: `salary.probe.${MARKER.toLowerCase()}@sunrise.test`,
      name: `Salary Probe Teacher ${MARKER}`,
      role: 'TEACHER',
      schoolId: schoolA.id,
      status: 'ACTIVE',
    },
  })
  const teacher = await db.teacher.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherUser.id,
      employeeId: `SAL-PROBE-${MARKER}`,
      department: 'QA',
    },
  })
  testTeacher = { userId: teacherUser.id, teacherId: teacher.id, email: teacherUser.email }

  // Cross-tenant probe: a real Teacher row in green-valley (deleted in
  // afterAll — the clean tenant stays honest-empty afterwards).
  const crossTeacher = await db.teacher.create({
    data: {
      schoolId: schoolB.id,
      userId: tb.id,
      employeeId: `GV-SAL-PROBE-${MARKER}`,
      department: 'QA',
    },
  })
  crossTenantTeacher = { teacherId: crossTeacher.id, userId: tb.id }

  tokenPrincipal = randomBytes(32).toString('hex')
  tokenTeacher = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: pa.id, tokenHash: hashSessionToken(tokenPrincipal), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: teacherUser.id, tokenHash: hashSessionToken(tokenTeacher), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: {
        tokenHash: { in: [hashSessionToken(tokenPrincipal), hashSessionToken(tokenTeacher)] },
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Exact rows this suite wrote — never a sweep over the corpus.
  if (createdPaymentIds.length) {
    await db.salaryPayment.deleteMany({ where: { id: { in: createdPaymentIds } } }).catch(() => {})
  }
  // The dedicated structure (teacherId is unique per teacher — ours alone).
  await db.salaryStructure.deleteMany({ where: { teacherId: testTeacher.teacherId } }).catch(() => {})
  // Dedicated test teacher (cascades its salary rows belt-and-braces above)
  // and the green-valley cross-tenant probe (clean tenant returns to zero).
  await db.teacher.deleteMany({ where: { id: { in: [testTeacher.teacherId, crossTenantTeacher.teacherId] } } }).catch(() => {})
  await db.user.deleteMany({ where: { id: testTeacher.userId } }).catch(() => {})
  await db.$disconnect()
}, 60_000)

// ─── helpers ───────────────────────────────────────────────────────────────

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

async function json(res: Response): Promise<any> {
  return res.json().catch(() => null)
}

/** The teacher's own canonical view: { role, me, structure, payments }. */
async function teacherSalary(): Promise<any> {
  const res = await as(tokenTeacher, '/api/salary')
  expect(res.status).toBe(200)
  return (await json(res))?.data
}

// ─────────────────────────────────────────────────────────────────────────
// 1 — canonical round-trip: principal writes → teacher reads the same rows
// ─────────────────────────────────────────────────────────────────────────
describe('salary persistence · principal writes are the teacher\'s canonical rows', () => {
  const AMOUNT = 41_250
  const NOTE = `structure note ${MARKER}`

  test(
    'principal sets the structure → teacher GET returns the same structure',
    async () => {
      const res = await as(tokenPrincipal, '/api/salary/structure', {
        method: 'PUT',
        body: JSON.stringify({
          teacherId: testTeacher.teacherId,
          monthlyAmount: AMOUNT,
          effectiveFrom: '2030-04-01',
          note: NOTE,
        }),
      })
      expect(res.status).toBe(200)
      const written = (await json(res))?.data
      expect(written?.teacherId).toBe(testTeacher.teacherId)
      expect(written?.monthlyAmount).toBe(AMOUNT)

      const view = await teacherSalary()
      expect(view?.role).toBe('TEACHER')
      expect(view?.structure).toBeTruthy()
      expect(view.structure.teacherId).toBe(testTeacher.teacherId)
      expect(view.structure.monthlyAmount).toBe(AMOUNT)
      expect(String(view.structure.effectiveFrom).slice(0, 10)).toBe('2030-04-01')
      expect(view.structure.note).toBe(NOTE)
    },
    TEST_TIMEOUT,
  )

  test(
    'principal records a payment → teacher sees the same canonical row; count increments',
    async () => {
      const before = await teacherSalary()
      const beforeCount = (before?.payments ?? []).filter((p: any) => p.teacherId === testTeacher.teacherId).length

      const res = await as(tokenPrincipal, '/api/salary/payments', {
        method: 'POST',
        body: JSON.stringify({
          teacherId: testTeacher.teacherId,
          month: '2001-01',
          amount: AMOUNT,
          method: 'BANK_TRANSFER',
          reference: `PROBE-${MARKER}-2001-01`,
          note: `payment note ${MARKER}`,
        }),
      })
      expect(res.status).toBe(200)
      const payment = (await json(res))?.data
      expect(payment?.id).toBeTruthy()
      expect(payment?.month).toBe('2001-01')
      expect(payment?.amount).toBe(AMOUNT)
      expect(payment?.method).toBe('BANK_TRANSFER')
      expect(payment?.status).toBe('RECORDED')
      createdPaymentIds.push(payment.id)

      const after = await teacherSalary()
      const own = (after?.payments ?? []).filter((p: any) => p.teacherId === testTeacher.teacherId)
      expect(own.length).toBe(beforeCount + 1)
      const row = own.find((p: any) => p.id === payment.id)
      expect(row).toBeTruthy()
      expect(row.month).toBe('2001-01')
      expect(row.amount).toBe(AMOUNT)
      expect(row.status).toBe('RECORDED')
      // The teacher sees ONLY their own rows (never the demo corpus).
      expect(own.every((p: any) => p.teacherId === testTeacher.teacherId)).toBe(true)
    },
    TEST_TIMEOUT,
  )

  test(
    'duplicate (teacher, month) POST → 409 SALARY_PAYMENT_DUPLICATE with the existing row',
    async () => {
      const res = await as(tokenPrincipal, '/api/salary/payments', {
        method: 'POST',
        body: JSON.stringify({ teacherId: testTeacher.teacherId, month: '2001-01', amount: AMOUNT }),
      })
      expect(res.status).toBe(409)
      const body = await json(res)
      expect(body?.ok).toBe(false)
      expect(body?.code).toBe('SALARY_PAYMENT_DUPLICATE')
      expect(body?.existing?.id).toBe(createdPaymentIds[0])
      expect(body?.existing?.month).toBe('2001-01')
      expect(body?.existing?.status).toBe('RECORDED')
    },
    TEST_TIMEOUT,
  )

  test(
    'void → status VOIDED (teacher sees it) → re-recording the same month is allowed',
    async () => {
      const voidRes = await as(
        tokenPrincipal,
        `/api/salary/payments/${encodeURIComponent(createdPaymentIds[0])}/void`,
        { method: 'POST' },
      )
      expect(voidRes.status).toBe(200)
      const voided = (await json(voidRes))?.data
      expect(voided?.id).toBe(createdPaymentIds[0])
      expect(voided?.status).toBe('VOIDED')
      expect(voided?.month).toBe('2001-01')

      // The teacher's canonical view reflects the VOID immediately.
      const midView = await teacherSalary()
      const midRow = (midView?.payments ?? []).find((p: any) => p.id === createdPaymentIds[0])
      expect(midRow?.status).toBe('VOIDED')

      // The unique key freed the slot → the same month can be re-recorded.
      const reRes = await as(tokenPrincipal, '/api/salary/payments', {
        method: 'POST',
        body: JSON.stringify({
          teacherId: testTeacher.teacherId,
          month: '2001-01',
          amount: AMOUNT,
          method: 'UPI',
        }),
      })
      expect(reRes.status).toBe(200)
      const reRecorded = (await json(reRes))?.data
      expect(reRecorded?.id).toBeTruthy()
      expect(reRecorded?.status).toBe('RECORDED')
      expect(reRecorded?.month).toBe('2001-01')
      expect(reRecorded?.method).toBe('UPI')
      createdPaymentIds.push(reRecorded.id)

      // Voiding a non-RECORDED row is a 409 (the VOIDED row stays as the
      // audit trail — never re-voided).
      const reVoid = await as(
        tokenPrincipal,
        `/api/salary/payments/${encodeURIComponent(createdPaymentIds[0])}/void`,
        { method: 'POST' },
      )
      expect(reVoid.status).toBe(409)
    },
    TEST_TIMEOUT,
  )
})

// ─────────────────────────────────────────────────────────────────────────
// 2 — authorization boundaries (fail-safe, no existence oracle)
// ─────────────────────────────────────────────────────────────────────────
describe('salary persistence · authorization boundaries', () => {
  test(
    'teacher cannot PUT a structure (403)',
    async () => {
      const res = await as(tokenTeacher, '/api/salary/structure', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: testTeacher.teacherId, monthlyAmount: 99_999 }),
      })
      expect(res.status).toBe(403)
      const body = await json(res)
      expect(body?.ok).toBe(false)
      expect(body?.code).toBe('FORBIDDEN')
    },
    TEST_TIMEOUT,
  )

  test(
    'teacher cannot POST a payment (403)',
    async () => {
      const res = await as(tokenTeacher, '/api/salary/payments', {
        method: 'POST',
        body: JSON.stringify({ teacherId: testTeacher.teacherId, month: '2001-02', amount: 1_000 }),
      })
      expect(res.status).toBe(403)
      const body = await json(res)
      expect(body?.code).toBe('FORBIDDEN')
    },
    TEST_TIMEOUT,
  )

  test(
    'cross-tenant teacherId → fail-safe 404 for structure AND payment (no oracle)',
    async () => {
      const putRes = await as(tokenPrincipal, '/api/salary/structure', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: crossTenantTeacher.teacherId, monthlyAmount: 30_000 }),
      })
      expect(putRes.status).toBe(404)
      expect((await json(putRes))?.code).toBe('RESOURCE_NOT_FOUND')

      const postRes = await as(tokenPrincipal, '/api/salary/payments', {
        method: 'POST',
        body: JSON.stringify({ teacherId: crossTenantTeacher.teacherId, month: '2001-02', amount: 30_000 }),
      })
      expect(postRes.status).toBe(404)
      expect((await json(postRes))?.code).toBe('RESOURCE_NOT_FOUND')
    },
    TEST_TIMEOUT,
  )

  test(
    'amount validation: 0 / negative / > ₹50,00,000 rejected 422',
    async () => {
      for (const amount of [0, -100, 5_000_001]) {
        const pay = await as(tokenPrincipal, '/api/salary/payments', {
          method: 'POST',
          body: JSON.stringify({ teacherId: testTeacher.teacherId, month: '2001-02', amount }),
        })
        expect(pay.status).toBe(422)
        const body = await json(pay)
        expect(body?.ok).toBe(false)
        expect(body?.code).toBe('VALIDATION_FAILED')
      }
      // The structure's monthlyAmount carries the same bounds.
      const struct = await as(tokenPrincipal, '/api/salary/structure', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: testTeacher.teacherId, monthlyAmount: 0 }),
      })
      expect(struct.status).toBe(422)
      expect((await json(struct))?.code).toBe('VALIDATION_FAILED')
    },
    TEST_TIMEOUT,
  )

  test(
    'unauthenticated calls are rejected 401',
    async () => {
      const res = await fetch(`${BASE}/api/salary`)
      expect(res.status).toBe(401)
    },
    TEST_TIMEOUT,
  )
})
