import { db } from '../helpers/db'
/**
 * PHASE 8A — MONEY PRECISION PROOFS (mission §5): paise-exact NUMERIC
 * ledgers, LIVE against the API + the database.
 *
 * THE INVARIANTS UNDER TEST (Sunrise Academy demo tenant):
 *   1. Fee amounts survive the full API→Prisma→NUMERIC(12,2) round trip
 *      paise-exactly: ₹1.11, ₹999.99, ₹10,000.00, ₹1,00,000.00 echo back
 *      as EXACT numbers and the DB stores EXACT strings ('1.11' …).
 *   2. HONEST CONTRACT: POST /api/fees zod min(1) REJECTS sub-rupee fee
 *      CREATION (₹0.01 / ₹0.10 → 422) — so sub-rupee exactness is proven
 *      through direct DB-created fee rows + the canonical ledger
 *      workflow (class teacher collects → principal verifies), asserting
 *      paise-exact Fee.paid / FeeTransaction.amount / Payment.amount via
 *      Number() compares AND DB-level ::text string compares.
 *   3. PARTIAL payment: fee ₹1000, collect ₹333.33 → paid EXACTLY
 *      333.33, outstanding EXACTLY 666.67 (API echo + DB strings).
 *   4. OVERPAY guard: amount > outstanding → 409 CONFLICT, ledger
 *      untouched (the pre-existing guard, re-proven on NUMERIC math).
 *   5. AGGREGATE: DB SUM over the throwaway fees == the exact decimal
 *      sum as a STRING (no float drift in aggregation).
 *   6. PARITY PRESERVATION: the global 3-way ledger sums
 *      (Σ Payment(SUCCESS) == Σ FeeTransaction(SUCCESS) == Σ Fee.paid)
 *      are captured BEFORE the suite runs and are EXACTLY restored after
 *      cleanup — the probes leave no paise of drift anywhere.
 *
 * Live suite conventions (fee-lifecycle / tenant-isolation precedent):
 * dev server (default :3000), REAL logins for the demo principal + demo
 * class teacher with resetLoginBuckets + unique X-Forwarded-For RUN_IP
 * (DB-backed login limiter, Phase 8A). Throwaway student + fees are
 * fully deleted in afterAll; workflow messages + audit rows naming the
 * marker are swept; the receipt sequence is restored by deleting the
 * probe FeeTransaction rows (mintReceiptNo = MAX+1).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { DEMO_PRINCIPAL_EMAIL, DEMO_PRINCIPAL_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000

const MARKER = randomBytes(4).toString('hex')
const RUN_IP = `10.238.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const DEMO_PW = DEMO_PRINCIPAL_PASSWORD
const PRINCIPAL_EMAIL = DEMO_PRINCIPAL_EMAIL
const TEACHER_EMAIL = 'teacher1@sunriseacademy.edu'

const STUDENT_NAME = `Paise Probe ${MARKER}`
const STUDENT_EMAIL = `paise.${MARKER}@sunrise.test`
const STUDENT_PW = 'PaiseProbe2026'
const ADMISSION_NO = `PAISE-${MARKER}`

// ── resolved fixtures ───────────────────────────────────────────────────────

let schoolId = ''
let classId = ''
let studentId = ''
let studentUserId = ''
let principalToken = ''
let teacherToken = ''

/** Every Fee row this suite creates (API + DB) — cleanup scope. */
const feeIds: string[] = []
/** Every FeeTransaction id this suite creates — ledger assertions + cleanup. */
const txnIds: string[] = []

const testStart = new Date()

interface ParityRow {
  pay: string
  txn: string
  fee: string
}

/** Global 3-way ledger sums, EXACT (::text — NUMERIC scale preserved). */
async function globalParity(): Promise<ParityRow> {
  const rows = await db.$queryRaw<ParityRow[]>`
    SELECT (SELECT COALESCE(SUM(amount), 0) FROM "Payment" WHERE status = 'SUCCESS')::text AS pay,
           (SELECT COALESCE(SUM(amount), 0) FROM "FeeTransaction" WHERE status = 'SUCCESS')::text AS txn,
           (SELECT COALESCE(SUM(paid), 0) FROM "Fee")::text AS fee`
  return rows[0]
}

let parityBefore: ParityRow = { pay: '', txn: '', fee: '' }

// ── auth helpers (real login; direct-session fixture only on 429) ─────────

const tokens: Record<string, string> = {}

async function login(email: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password: DEMO_PW }),
  })
  if (res.status === 429) {
    console.warn(`[pg-money] login rate-limited for ${email}; using direct session fixture`)
    return (tokens[email] = await directSession(email))
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) throw new Error(`login failed for ${email}`)
  return (tokens[email] = body.data.sessionToken)
}

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no fixture user ${email}`)
  const token = randomBytes(32).toString('hex')
  // PHASE 8A — the row stores the sha256 hash; the RAW token rides the
  // Authorization header (identical to a server-minted session).
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

interface FailureEnvelope {
  ok: boolean
  code?: string
  error?: string
}

// ── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing — run the canonical corpus seeds')
  schoolId = school.id

  const teacher = await db.user.findUnique({ where: { email: TEACHER_EMAIL } })
  if (!teacher) throw new Error(`fixture user missing: ${TEACHER_EMAIL}`)

  // The throwaway student joins one of teacher1's APPOINTED classes so the
  // two-stage collection workflow (class teacher → principal) is exercisable.
  const appointed = await db.class.findFirst({
    where: { schoolId, classTeacherId: teacher.id },
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  if (!appointed) throw new Error('teacher1 has no appointed class — seed state unexpected')
  classId = appointed.id

  // Phase 8A — DB-backed login buckets persist across runs; heal them so
  // this run starts from clean limiter state (fixture accounts only).
  await resetLoginBuckets([PRINCIPAL_EMAIL, TEACHER_EMAIL])

  // Baseline: the global 3-way ledger truth BEFORE any probe row exists.
  parityBefore = await globalParity()
  expect(parityBefore.pay).toBe(parityBefore.txn)
  expect(parityBefore.txn).toBe(parityBefore.fee)
  expect(Number(parityBefore.pay)).toBeGreaterThan(0) // a non-trivial ledger

  // Real logins (principal + class teacher).
  principalToken = await login(PRINCIPAL_EMAIL)
  teacherToken = await login(TEACHER_EMAIL)
}, 60_000)

afterAll(async () => {
  // ── leave the ledger EXACTLY as found ─────────────────────────────
  await db.payment.deleteMany({ where: { feeId: { in: feeIds } } }).catch(() => {})
  await db.feeTransaction.deleteMany({ where: { feeId: { in: feeIds } } }).catch(() => {})
  // Workflow messages + audit rows naming the probe (student name, email,
  // admission no, reference numbers and txn ids all carry the marker).
  await db.message
    .deleteMany({ where: { schoolId, createdAt: { gte: testStart }, OR: [{ subject: { contains: MARKER } }, { body: { contains: MARKER } }] } })
    .catch(() => {})
  await db.activityLog.deleteMany({ where: { detail: { contains: MARKER } } }).catch(() => {})
  await db.fee.deleteMany({ where: { id: { in: feeIds } } }).catch(() => {})
  if (studentId) await db.student.deleteMany({ where: { id: studentId } }).catch(() => {})
  if (studentUserId) await db.user.deleteMany({ where: { id: studentUserId } }).catch(() => {})
  // The session rows this suite minted.
  const hashes = Object.values(tokens).map((t) => hashSessionToken(t))
  if (hashes.length) await db.session.deleteMany({ where: { tokenHash: { in: hashes } } }).catch(() => {})

  // PARITY RE-ASSERTION: the three-way sums are EXACTLY the baseline —
  // the probes left zero paise of drift anywhere in the ledger.
  const after = await globalParity()
  expect(after.pay).toBe(parityBefore.pay)
  expect(after.txn).toBe(parityBefore.txn)
  expect(after.fee).toBe(parityBefore.fee)
  expect(after.pay).toBe(after.txn)
  expect(after.txn).toBe(after.fee)
  await db.$disconnect()
})

// ─────────────────────────────────────────────────────────────────────────
// 1. API round-trip paise exactness + the honest min(1) creation contract
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · /api/fees money round-trip is paise-exact', () => {
  test('throwaway student created (in teacher1\'s class) via POST /api/students', async () => {
    const res = await as(principalToken, '/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: STUDENT_NAME,
        email: STUDENT_EMAIL,
        password: STUDENT_PW,
        classId,
        admissionNo: ADMISSION_NO,
        rollNo: `P-${MARKER}`,
        guardianName: 'Probe Guardian',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data?: { id: string; schoolId: string; userId: string } }
    expect(body.ok).toBe(true)
    expect(body.data!.schoolId).toBe(schoolId)
    expect(body.data!.userId).toBeTruthy()
    studentId = body.data!.id
    studentUserId = body.data!.userId
  }, T)

  test('fee amounts ₹1.11 / ₹999.99 / ₹10000 / ₹100000 round-trip EXACTLY (API echo + DB string)', async () => {
    const cases: Array<{ amount: number; text: string; title: string }> = [
      { amount: 1.11, text: '1.11', title: `Paise probe fee 1.11 ${MARKER}` },
      { amount: 999.99, text: '999.99', title: `Paise probe fee 999.99 ${MARKER}` },
      { amount: 10000, text: '10000.00', title: `Paise probe fee 10000 ${MARKER}` },
      { amount: 100000, text: '100000.00', title: `Paise probe fee 100000 ${MARKER}` },
    ]
    for (const c of cases) {
      const res = await as(principalToken, '/api/fees', {
        method: 'POST',
        body: JSON.stringify({ studentId, amount: c.amount, title: c.title, type: 'TUITION' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data?: { id: string; amount: number; paid: number } }
      expect(body.ok).toBe(true)
      // JSON numbers, paise-exact (no float drift through the wire).
      expect(Number(body.data!.amount)).toBe(c.amount)
      expect(Number(body.data!.paid)).toBe(0)
      feeIds.push(body.data!.id)
    }

    // DB truth: NUMERIC(12,2) stores the exact decimal strings.
    const rows = await db.$queryRaw<Array<{ id: string; amount: string; paid: string }>>`
      SELECT id, amount::text AS amount, paid::text AS paid FROM "Fee" WHERE id IN (${feeIds[0]}, ${feeIds[1]}, ${feeIds[2]}, ${feeIds[3]})`
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (let i = 0; i < cases.length; i++) {
      const row = byId.get(feeIds[i])
      expect(row?.amount).toBe(cases[i].text) // '1.11' | '999.99' | '10000.00' | '100000.00'
      expect(row?.paid).toBe('0.00')
    }
  }, T)

  test('HONEST CONTRACT: ₹0.01 / ₹0.10 fee CREATION is refused 422 by the route\'s min(1) zod', async () => {
    for (const amount of [0.01, 0.1]) {
      const res = await as(principalToken, '/api/fees', {
        method: 'POST',
        body: JSON.stringify({ studentId, amount, title: `Sub-rupee probe ${MARKER}`, type: 'TUITION' }),
      })
      expect(res.status).toBe(422)
      const body = (await res.json()) as FailureEnvelope
      expect(body.ok).toBe(false)
      expect(body.code).toBe('VALIDATION_FAILED')
    }
    // Nothing leaked: no fee row was created for the refused amounts.
    const leaked = await db.fee.count({ where: { studentId, title: { contains: 'Sub-rupee probe' } } })
    expect(leaked).toBe(0)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Sub-rupee exactness through the canonical ledger workflow
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · sub-rupee fees (DB rows) settle paise-exactly via teacher-collect → principal-verify', () => {
  test('₹0.01: collect 0.01 → verify → Fee.paid/txn/Payment are EXACTLY 0.01', async () => {
    // Direct DB-created sub-rupee fee (NUMERIC stores paise exactly).
    const fee = await db.fee.create({
      data: {
        schoolId,
        studentId,
        title: `Paise DB fee 0.01 ${MARKER}`,
        amount: 0.01,
        paid: 0,
        type: 'TUITION',
        status: 'UNPAID',
      },
    })
    feeIds.push(fee.id)
    expect(String(fee.amount)).toBe('0.01') // Prisma Decimal read-back

    // STAGE 1 — the class teacher records the collection (PENDING).
    const post = await as(teacherToken, '/api/teacher/fee-collection', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        feeId: fee.id,
        amount: 0.01,
        method: 'CASH',
        referenceNumber: `PAISE-${MARKER}-001`,
      }),
    })
    expect(post.status).toBe(200)
    const postBody = (await post.json()) as { ok: boolean; data?: { txn?: { id: string; status: string; amount: number; receiptNo: string | null } } }
    const txn = postBody.data?.txn
    expect(txn?.id).toBeTruthy()
    expect(txn?.status).toBe('UNDER_VERIFICATION')
    expect(Number(txn?.amount)).toBe(0.01)
    expect(txn?.receiptNo).toBeNull()
    txnIds.push(txn!.id)

    // Pending money is NOT paid money.
    const midFee = await db.$queryRaw<Array<{ paid: string }>>`SELECT paid::text AS paid FROM "Fee" WHERE id = ${fee.id}`
    expect(midFee[0].paid).toBe('0.00')

    // STAGE 2 — the principal verifies → SUCCESS + receipt + ledger credit.
    const verify = await as(principalToken, '/api/fees/verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', txnId: txn!.id }),
    })
    expect(verify.status).toBe(200)
    const verifyBody = (await verify.json()) as {
      ok: boolean
      data?: { txn?: { status: string; receiptNo: string | null }; ledger?: { applied: number; paid: number; status: string } }
    }
    expect(verifyBody.data?.txn?.status).toBe('SUCCESS')
    expect(verifyBody.data?.txn?.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)
    expect(Number(verifyBody.data?.ledger?.applied)).toBe(0.01)
    expect(Number(verifyBody.data?.ledger?.paid)).toBe(0.01)
    expect(verifyBody.data?.ledger?.status).toBe('PAID')

    // DB truth — paise-exact on every ledger.
    const feeRow = await db.$queryRaw<Array<{ paid: string; amount: string; status: string }>>`
      SELECT paid::text AS paid, amount::text AS amount, status FROM "Fee" WHERE id = ${fee.id}`
    expect(feeRow[0].paid).toBe('0.01')
    expect(feeRow[0].amount).toBe('0.01')
    expect(feeRow[0].status).toBe('PAID')
    const txnRow = await db.$queryRaw<Array<{ amount: string; status: string }>>`
      SELECT amount::text AS amount, status FROM "FeeTransaction" WHERE id = ${txn!.id}`
    expect(txnRow[0].amount).toBe('0.01')
    expect(txnRow[0].status).toBe('SUCCESS')
    const payRow = await db.$queryRaw<Array<{ amount: string; status: string; transactionId: string | null }>>`
      SELECT amount::text AS amount, status, "transactionId" FROM "Payment" WHERE "transactionId" = ${txn!.id}`
    expect(payRow.length).toBe(1)
    expect(payRow[0].amount).toBe('0.01')
    expect(payRow[0].status).toBe('SUCCESS')
  }, T)

  test('₹0.10: same workflow — every ledger stores EXACTLY 0.10', async () => {
    const fee = await db.fee.create({
      data: {
        schoolId,
        studentId,
        title: `Paise DB fee 0.10 ${MARKER}`,
        amount: 0.1,
        paid: 0,
        type: 'TUITION',
        status: 'UNPAID',
      },
    })
    feeIds.push(fee.id)

    const post = await as(teacherToken, '/api/teacher/fee-collection', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        feeId: fee.id,
        amount: 0.1,
        method: 'CASH',
        referenceNumber: `PAISE-${MARKER}-010`,
      }),
    })
    expect(post.status).toBe(200)
    const postBody = (await post.json()) as { ok: boolean; data?: { txn?: { id: string; amount: number } } }
    const txnId = postBody.data?.txn?.id
    expect(txnId).toBeTruthy()
    expect(Number(postBody.data?.txn?.amount)).toBe(0.1)
    txnIds.push(txnId!)

    const verify = await as(principalToken, '/api/fees/verification', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', txnId }),
    })
    expect(verify.status).toBe(200)
    const verifyBody = (await verify.json()) as { ok: boolean; data?: { ledger?: { applied: number; paid: number } } }
    expect(Number(verifyBody.data?.ledger?.applied)).toBe(0.1)
    expect(Number(verifyBody.data?.ledger?.paid)).toBe(0.1)

    // DB strings — trailing paise preserved by NUMERIC(12,2).
    const feeRow = await db.$queryRaw<Array<{ paid: string }>>`SELECT paid::text AS paid FROM "Fee" WHERE id = ${fee.id}`
    expect(feeRow[0].paid).toBe('0.10')
    const txnRow = await db.$queryRaw<Array<{ amount: string }>>`SELECT amount::text AS amount FROM "FeeTransaction" WHERE id = ${txnId}`
    expect(txnRow[0].amount).toBe('0.10')
    const payRow = await db.$queryRaw<Array<{ amount: string }>>`SELECT amount::text AS amount FROM "Payment" WHERE "transactionId" = ${txnId}`
    expect(payRow[0].amount).toBe('0.10')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Partial payment + overpay guard (₹1000 fee)
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · partial payment 333.33 of a 1000 fee — exact on every surface', () => {
  test('principal manual txn 333.33 → paid EXACTLY 333.33, outstanding 666.67', async () => {
    const create = await as(principalToken, '/api/fees', {
      method: 'POST',
      body: JSON.stringify({ studentId, amount: 1000, title: `Paise partial fee 1000 ${MARKER}`, type: 'TUITION' }),
    })
    expect(create.status).toBe(200)
    const createBody = (await create.json()) as { ok: boolean; data?: { id: string } }
    const feeId = createBody.data!.id
    feeIds.push(feeId)

    const res = await as(principalToken, '/api/fees/transactions', {
      method: 'POST',
      body: JSON.stringify({ studentId, feeId, amount: 333.33, method: 'CASH' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      data?: { id: string; amount: number; status: string; receiptNo: string | null; ledger?: { applied: number; paid: number; outstanding: number; status: string } }
    }
    expect(Number(body.data!.amount)).toBe(333.33)
    expect(body.data!.status).toBe('SUCCESS')
    expect(body.data!.receiptNo).toMatch(/^SCH-\d{4}-\d{6}$/)
    expect(Number(body.data!.ledger?.applied)).toBe(333.33)
    expect(Number(body.data!.ledger?.paid)).toBe(333.33)
    expect(Number(body.data!.ledger?.outstanding)).toBe(666.67)
    expect(body.data!.ledger?.status).toBe('PARTIAL')
    txnIds.push(body.data!.id)

    // DB truth — exact decimal strings on all three ledgers.
    const feeRow = await db.$queryRaw<Array<{ paid: string; status: string }>>`
      SELECT paid::text AS paid, status FROM "Fee" WHERE id = ${feeId}`
    expect(feeRow[0].paid).toBe('333.33')
    expect(feeRow[0].status).toBe('PARTIAL')
    const txnRow = await db.$queryRaw<Array<{ amount: string; status: string }>>`
      SELECT amount::text AS amount, status FROM "FeeTransaction" WHERE id = ${body.data!.id}`
    expect(txnRow[0].amount).toBe('333.33')
    expect(txnRow[0].status).toBe('SUCCESS')
    const payRow = await db.$queryRaw<Array<{ amount: string; transactionId: string | null }>>`
      SELECT amount::text AS amount, "transactionId" FROM "Payment" WHERE "transactionId" = ${`manual:${body.data!.id}`}`
    expect(payRow.length).toBe(1)
    expect(payRow[0].amount).toBe('333.33')
  }, T)

  test('overpay 666.68 > outstanding 666.67 → 409 CONFLICT, ledger untouched', async () => {
    const partialFeeId = feeIds[feeIds.length - 1]
    const paidBefore = await db.$queryRaw<Array<{ paid: string }>>`SELECT paid::text AS paid FROM "Fee" WHERE id = ${partialFeeId}`
    const txnCountBefore = await db.feeTransaction.count({ where: { feeId: partialFeeId } })

    const res = await as(principalToken, '/api/fees/transactions', {
      method: 'POST',
      body: JSON.stringify({ studentId, feeId: partialFeeId, amount: 666.68, method: 'CASH' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as FailureEnvelope
    expect(body.ok).toBe(false)
    expect(body.code).toBe('CONFLICT')

    // The ledger did NOT move (Decimal comparison guard — no float epsilon).
    const paidAfter = await db.$queryRaw<Array<{ paid: string }>>`SELECT paid::text AS paid FROM "Fee" WHERE id = ${partialFeeId}`
    expect(paidAfter[0].paid).toBe(paidBefore[0].paid) // still exactly 333.33
    const txnCountAfter = await db.feeTransaction.count({ where: { feeId: partialFeeId } })
    expect(txnCountAfter).toBe(txnCountBefore)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. Aggregate exactness (DB SUM as strings)
// ─────────────────────────────────────────────────────────────────────────

describe('Phase 8A · aggregate SUM over the throwaway fees is paise-exact', () => {
  test('SUM(amount) == 112001.21 and SUM(paid) == 333.44 (exact decimal strings)', async () => {
    // 0.01 + 0.10 + 1.11 + 999.99 + 10000.00 + 100000.00 + 1000.00
    // paid: 0.01 + 0.10 + 333.33
    const rows = await db.$queryRaw<Array<{ total: string; paid: string }>>`
      SELECT COALESCE(SUM("amount"), 0)::text AS total, COALESCE(SUM("paid"), 0)::text AS paid
      FROM "Fee" WHERE "studentId" = ${studentId}`
    expect(rows[0].total).toBe('112001.21')
    expect(rows[0].paid).toBe('333.44')

    // Prisma aggregate agrees exactly (Decimal → Number, paise-exact for
    // 2-decimal NUMERIC sums of this magnitude).
    const agg = await db.fee.aggregate({ where: { studentId }, _sum: { amount: true, paid: true } })
    expect(Number(agg._sum.amount)).toBe(112001.21)
    expect(Number(agg._sum.paid)).toBe(333.44)
  }, T)
})
