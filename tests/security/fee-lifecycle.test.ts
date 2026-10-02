import { db } from '../helpers/db'
/**
 * PIH-5 — INVARIANT: the fee money lifecycle (parity, receipts, guards).
 *
 * THE INVARIANTS UNDER TEST (demo tenant + DB-wide where stated):
 *   1. LEDGER PARITY (DB): for the demo school, Σ Payment(SUCCESS) ==
 *      Σ FeeTransaction(SUCCESS) == Σ Fee.paid — the payment ledger, the
 *      canonical transaction ledger and the student fee ledger are ONE
 *      money truth (B-wave backfill + single-ledger-writer).
 *   2. RECEIPT INVARIANT (DB): every FeeTransaction.receiptNo is either
 *      null (not yet settled) or matches /^SCH-\d{4}-\d{6}$/ (the one
 *      sequential per-school scheme); no duplicate receipt per school.
 *   3. DAY-LEVEL ATTENDANCE (DB, all tenants): zero (studentId,
 *      calendar-day) groups with more than one row, and every
 *      Attendance.date is anchored at midnight UTC (ms % 86400000 == 0).
 *   4. OVERPAY GUARD (live): a manual fee transaction above the fee's
 *      outstanding balance is refused 409 and the ledger is untouched.
 *   5. VERIFY-THEN-REJECT (live): a pending class-teacher collection
 *      verified by the principal settles atomically (SUCCESS + receipt +
 *      Fee.paid credited + Payment mirror); rejecting the SAME txn id
 *      afterwards is refused (already settled) and the ledger does NOT
 *      move — the B-wave race-free reject guard.
 *
 * Live-HTTP conventions match tests/security/tenant-isolation.test.ts and
 * tests/security/phase75-product.test.ts: dev server (TENANT_TEST_BASE,
 * default :3000), sessions minted as DIRECT ROWS (bypasses ONLY the login
 * limiter, never an authorization gate), requests ride the session cookie
 * through a manual cookie jar.
 *
 * Cleanup discipline: DB invariants run FIRST (pre-mutation truth); every
 * row the live flow creates (FeeTransaction, Payment mirror, verification
 * messages, audit rows) is deleted, Fee.paid/status/method/paidDate are
 * restored to their pre-test values, and the ledger parity is RE-asserted
 * after cleanup — the suite leaves the DB exactly as it found it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000 // generous: first-hit dev compilation (tenant-isolation precedent)

const MARKER = randomBytes(4).toString('hex')

// ── resolved fixtures ──────────────────────────────────────────────────────
let schoolId = ''
let teacher1 = { id: '', name: '', email: 'teacher1@hawkingshigh.edu' }
let principal = { id: '', email: 'principal@hawkingshigh.edu' }
let teacherToken = ''
let principalToken = ''
/** A fee OUTSIDE teacher1's class-teacher roster, for the overpay guard. */
let overpayFee = { id: '', studentId: '', amount: 0, paid: 0 }
/** A fee belonging to a student of one of teacher1's appointed classes. */
let collectFee = { id: '', studentId: '', amount: 0, paid: 0, outstanding: 0 }

const TXN_PENDING = 'UNDER_VERIFICATION'
const TXN_SUCCESS = 'SUCCESS'

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing (run the canonical seeds)')
  schoolId = school.id

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`fixture user missing: ${email}`)
    return u
  }
  const [t1, p1] = await Promise.all([byEmail(teacher1.email), byEmail(principal.email)])
  teacher1 = { ...teacher1, id: t1.id, name: t1.name ?? '' }
  principal = { ...principal, id: p1.id }

  teacherToken = randomBytes(32).toString('hex')
  principalToken = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      // PHASE 8A — rows store sha256(token); the RAW tokens ride the
      // cookie jar below (createSession wire contract).
      { userId: t1.id, tokenHash: hashSessionToken(teacherToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: p1.id, tokenHash: hashSessionToken(principalToken), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: {
        tokenHash: { in: [hashSessionToken(teacherToken), hashSessionToken(principalToken)] },
      },
    }),
  )

  // teacher1's appointed classes → her students' open fees (collection flow).
  const myClasses = await db.class.findMany({
    where: { schoolId, classTeacherId: t1.id },
    select: { id: true },
  })
  const myStudents = await db.student.findMany({
    where: { classId: { in: myClasses.map((c) => c.id) }, user: { status: 'ACTIVE' } },
    select: { id: true, user: { select: { name: true } } },
  })
  const myStudentIds = new Set(myStudents.map((s) => s.id))

  // Pending collections deliberately do NOT reduce outstanding — a fee with
  // pending money would trip the guard for honest reasons, so require room.
  const pendingOnFees = await db.feeTransaction.groupBy({
    by: ['feeId'],
    where: { schoolId, status: TXN_PENDING, feeId: { not: null } },
    _sum: { amount: true },
  })
  const pendingByFee = new Map(pendingOnFees.map((p) => [p.feeId ?? '', Number(p._sum.amount ?? 0)]))

  const openFees = await db.fee.findMany({
    where: { schoolId, status: { in: ['UNPAID', 'PARTIAL'] } },
    select: { id: true, studentId: true, amount: true, paid: true, title: true },
    orderBy: { createdAt: 'asc' },
  })
  // Money columns are Prisma.Decimal on PG — normalize to numbers at the
  // fixture boundary (8A parity corpus: ₹21,62,650.00 across 124 receipts).
  const collectCandidate = openFees.find(
    (f) => myStudentIds.has(f.studentId) && Number(f.amount) - Number(f.paid) - (pendingByFee.get(f.id) ?? 0) >= 200,
  )
  if (!collectCandidate) throw new Error('no open fee on a teacher1 student — seed state unexpected')
  collectFee = {
    ...collectCandidate,
    amount: Number(collectCandidate.amount),
    paid: Number(collectCandidate.paid),
    outstanding: Number(collectCandidate.amount) - Number(collectCandidate.paid),
  }

  const overpayCandidate = openFees.find((f) => !myStudentIds.has(f.studentId) && Number(f.amount) - Number(f.paid) > 0)
  if (!overpayCandidate) throw new Error('no open fee outside teacher1 roster — seed state unexpected')
  overpayFee = { ...overpayCandidate, amount: Number(overpayCandidate.amount), paid: Number(overpayCandidate.paid) }
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

// ── helpers ────────────────────────────────────────────────────────────────

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

/** The three-way ledger parity for one school (float tolerance 0.01). */
async function ledgerSums(sid: string): Promise<{ payments: number; txns: number; fees: number }> {
  const [pay, txn, fee] = await Promise.all([
    db.payment.aggregate({ where: { schoolId: sid, status: 'SUCCESS' }, _sum: { amount: true } }),
    db.feeTransaction.aggregate({ where: { schoolId: sid, status: 'SUCCESS' }, _sum: { amount: true } }),
    db.fee.aggregate({ where: { schoolId: sid }, _sum: { paid: true } }),
  ])
  // NUMERIC aggregates arrive as Prisma.Decimal — normalize for numeric equality.
  return { payments: Number(pay._sum.amount ?? 0), txns: Number(txn._sum.amount ?? 0), fees: Number(fee._sum.paid ?? 0) }
}

// ─────────────────────────────────────────────────────────────────────────
// 1-3. DB invariants (pre-mutation truth)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · fee ledger parity + receipt scheme (DB, demo tenant)', () => {
  test('Σ Payment(SUCCESS) == Σ FeeTransaction(SUCCESS) == Σ Fee.paid (tolerance 0.01)', async () => {
    const sums = await ledgerSums(schoolId)
    expect(sums.fees).toBeGreaterThan(0) // a non-trivial ledger, not empty equality
    expect(Math.abs(sums.payments - sums.txns)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sums.txns - sums.fees)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(sums.payments - sums.fees)).toBeLessThanOrEqual(0.01)
  }, T)

  test('every receipt is null-or-SCH-YYYY-NNNNNN; no duplicate receipt per school', async () => {
    const rows = await db.feeTransaction.findMany({
      where: { receiptNo: { not: null } },
      select: { receiptNo: true, schoolId: true },
    })
    expect(rows.length).toBeGreaterThan(0)

    const seen = new Map<string, string>()
    for (const r of rows) {
      expect(r.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)
      const key = `${r.schoolId}|${r.receiptNo}`
      expect(seen.has(key)).toBe(false) // uniqueness per school
      seen.set(key, r.receiptNo)
    }
  }, T)
})

describe('PIH-5 · attendance is day-level + midnight-UTC anchored (DB, all tenants)', () => {
  test('0 (studentId, calendar-day) groups with >1 row; every date % 86400000 == 0', async () => {
    const rows = await db.attendance.findMany({ select: { studentId: true, date: true } })
    expect(rows.length).toBeGreaterThan(0)

    const byDay = new Map<string, number>()
    for (const r of rows) {
      const t = r.date.getTime()
      expect(t % 86_400_000).toBe(0) // midnight-UTC anchor, no wall-clock drift
      const key = `${r.studentId}|${Math.floor(t / 86_400_000)}`
      byDay.set(key, (byDay.get(key) ?? 0) + 1)
    }
    const dupes = [...byDay.entries()].filter(([, count]) => count > 1)
    expect(dupes).toEqual([])
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. Overpay guard (live)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · manual fee transaction overpay guard (live)', () => {
  test('principal POST /api/fees/transactions with amount > outstanding → 409, ledger untouched', async () => {
    const outstanding = overpayFee.amount - overpayFee.paid
    expect(outstanding).toBeGreaterThan(0)

    const txnCountBefore = await db.feeTransaction.count({ where: { feeId: overpayFee.id } })

    const res = await as(principalToken, '/api/fees/transactions', {
      method: 'POST',
      body: JSON.stringify({
        studentId: overpayFee.studentId,
        feeId: overpayFee.id,
        amount: outstanding + 1,
        method: 'CASH',
      }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { ok: boolean; code: string; error?: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('CONFLICT')

    // The ledger did not move and no transaction row leaked.
    const feeAfter = await db.fee.findUnique({ where: { id: overpayFee.id }, select: { paid: true } })
    expect(Number(feeAfter?.paid)).toBe(overpayFee.paid)
    const txnCountAfter = await db.feeTransaction.count({ where: { feeId: overpayFee.id } })
    expect(txnCountAfter).toBe(txnCountBefore)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. Verify → (reject) — the settled-txn reject guard (live)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · verify settles atomically; rejecting a settled txn is refused (live)', () => {
  test('teacher collection → principal verify (SUCCESS + receipt + ledger credit) → reject → 409, ledger unchanged; full cleanup restores parity', async () => {
    const testStart = new Date()
    const amount = 100
    const reference = `PIH5-VERIFY-${MARKER}`

    // Fee ledger snapshot (restored verbatim in cleanup).
    const feeBefore = await db.fee.findUnique({
      where: { id: collectFee.id },
      select: { paid: true, status: true, method: true, paidDate: true },
    })
    expect(feeBefore).not.toBeNull()
    expect(collectFee.outstanding).toBeGreaterThanOrEqual(amount)

    // ── STAGE 1: the class teacher records the collection (PENDING) ──
    const post = await as(teacherToken, '/api/teacher/fee-collection', {
      method: 'POST',
      body: JSON.stringify({
        studentId: collectFee.studentId,
        feeId: collectFee.id,
        amount,
        method: 'CASH',
        referenceNumber: reference,
      }),
    })
    expect(post.status).toBe(200)
    const postBody = (await post.json()) as {
      ok: boolean
      data?: { txn?: { id: string; status: string; receiptNo: string | null } }
    }
    const txn = postBody.data?.txn
    expect(txn?.id).toBeTruthy()
    expect(txn?.status).toBe(TXN_PENDING)
    expect(txn?.receiptNo).toBeNull() // no receipt before verification

    // The pending collection deliberately did NOT touch the ledger.
    const midFee = await db.fee.findUnique({ where: { id: collectFee.id }, select: { paid: true } })
    expect(Number(midFee?.paid)).toBe(Number(feeBefore!.paid))

    try {
      // ── STAGE 2: the principal verifies → SUCCESS + receipt + credit ──
      const verify = await as(principalToken, '/api/fees/verification', {
        method: 'POST',
        body: JSON.stringify({ action: 'verify', txnId: txn!.id }),
      })
      expect(verify.status).toBe(200)
      const verifyBody = (await verify.json()) as {
        ok: boolean
        data?: { txn?: { status: string; receiptNo: string | null }; ledger?: { applied: number } }
      }
      expect(verifyBody.data?.txn?.status).toBe(TXN_SUCCESS)
      expect(verifyBody.data?.txn?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)
      expect(verifyBody.data?.ledger?.applied).toBe(amount)

      // DB truth: the ledger moved by exactly the amount + a Payment mirror.
      const verifiedFee = await db.fee.findUnique({ where: { id: collectFee.id }, select: { paid: true } })
      expect(Number(verifiedFee?.paid)).toBe(Number(feeBefore!.paid) + amount)
      const mirror = await db.payment.findUnique({
        where: { transactionId: txn!.id },
        select: { id: true, amount: true, status: true },
      })
      expect(mirror).not.toBeNull()
      expect(Number(mirror?.amount)).toBe(amount)
      expect(mirror?.status).toBe('SUCCESS')

      // ── STAGE 3: rejecting the SAME (settled) txn id → 4xx, no movement ──
      const paidAfterVerify = Number(verifiedFee!.paid)
      const reject = await as(principalToken, '/api/fees/verification', {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', txnId: txn!.id, reason: 'PIH-5 settled-txn reject probe' }),
      })
      expect([400, 403, 409]).toContain(reject.status)
      const rejectBody = (await reject.json()) as { ok: boolean; code: string }
      expect(rejectBody.ok).toBe(false)
      expect(rejectBody.code).toBe('CONFLICT')

      const afterReject = await db.fee.findUnique({ where: { id: collectFee.id }, select: { paid: true } })
      expect(Number(afterReject?.paid)).toBe(paidAfterVerify) // ledger did NOT move
      const txnRow = await db.feeTransaction.findUnique({ where: { id: txn!.id }, select: { status: true } })
      expect(txnRow?.status).toBe(TXN_SUCCESS) // still settled, never flipped to REJECTED
    } finally {
      // ── CLEANUP: leave the DB exactly as found ─────────────────────────
      await db.payment.deleteMany({ where: { transactionId: txn!.id } })
      await db.feeTransaction.deleteMany({ where: { id: txn!.id } })
      await db.fee.update({
        where: { id: collectFee.id },
        data: {
          paid: feeBefore!.paid,
          status: feeBefore!.status,
          method: feeBefore!.method,
          paidDate: feeBefore!.paidDate,
        },
      })
      // Workflow side-effects: verification pings + audit rows naming the txn.
      await db.message.deleteMany({
        where: {
          schoolId,
          createdAt: { gte: testStart },
          OR: [
            { subject: { contains: 'Fee collection awaiting verification' } },
            { subject: { contains: 'Payment verified' } },
          ],
        },
      })
      await db.activityLog.deleteMany({ where: { detail: { contains: txn!.id } } })

      // Parity restored (the invariant is re-provable after the probe).
      const sums = await ledgerSums(schoolId)
      expect(Math.abs(sums.payments - sums.txns)).toBeLessThanOrEqual(0.01)
      expect(Math.abs(sums.txns - sums.fees)).toBeLessThanOrEqual(0.01)
    }
  }, T)
})
