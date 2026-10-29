/**
 * tests/security/batch-codes.test.ts
 *
 * BATCH CODE GENERATION + KEYED VERIFIER + RECONCILE (2026-10-30) —
 * live acceptance suite.
 *
 *   · POST /api/platform/subscriptions/codes/batch: requested vs
 *     generated accounting, quantity caps, plan/scope binding, audited
 *     reason requirement, date boundaries (end after start), ASSIGNED
 *     pre-assignment (server-verified students/teachers of THIS tenant)
 *     and the permission-gated COMPLIMENTARY backing.
 *   · A batch is NEVER proof of payment by itself: the PAYMENT backing
 *     records VERIFIED financial rows in the SAME transaction (per-seat
 *     rows for ASSIGNED batches, one tenant-level row for OPEN batches);
 *     a failure rolls back every code with it.
 *   · One-time display: plaintexts appear exactly once in the POST
 *     response; the code registry GET never returns them.
 *   · Single-use under concurrency: two simultaneous claims of one batch
 *     code → exactly one 200, one live entitlement.
 *   · Keyed verifier transition: codes issued under the legacy sha256
 *     design still redeem (dual-lookup), codes issued under the peppered
 *     HMAC design verify without the plaintext ever being stored.
 *   · Reconciliation cron: unauthenticated → 401; authenticated run
 *     flips lapsed snapshots (codes ISSUED→EXPIRED, lapsed entitlement
 *     rows → EXPIRED, stale PENDING orders → EXPIRED) and is idempotent
 *     (second run changes nothing) — enforcement never depended on it.
 *
 * Test-data discipline: every row tracked and removed in afterAll; the
 * tenant fixture billingModel is saved/restored; per-request spoofed IPs.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import { hashSessionToken } from '@/lib/auth'
import { normalizeCode } from '@/lib/subscription/codes'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const T = 45_000

let schoolA = { id: '', slug: '' }
let rootToken = ''
let opsToken = ''
let suiteAdminId = ''
let originalBillingModel: string | null = null

const cleanup: Array<() => Promise<unknown>> = []
const RUN = randomBytes(4).toString('hex').toUpperCase()
let ipSeq = 0
const RUN_IP_B1 = 48 + (parseInt(RUN.slice(0, 2), 16) % 160)
const RUN_IP_B2 = parseInt(RUN.slice(2), 16) % 256
const nextIp = () => `10.${RUN_IP_B1}.${(RUN_IP_B2 + (ipSeq >> 8)) % 256}.${1 + (ipSeq++ % 250)}`

interface TestStudent { userId: string; studentId: string; email: string; token: string }
interface TestUser { userId: string; email: string; token: string; role: string }

async function makeTestStudent(schoolId: string, label: string): Promise<TestStudent> {
  const email = `batch.test.${label}.${RUN}@hawkings.test`
  const user = await db.user.create({
    data: {
      email, name: `Batch Test ${label}`, role: 'STUDENT', schoolId, status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date(),
    },
  })
  const student = await db.student.create({ data: { schoolId, userId: user.id, admissionNo: `BAT-${RUN}-${label}` } })
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) } })
  cleanup.push(async () => {
    await db.session.deleteMany({ where: { userId: user.id } })
    await db.studentEntitlement.deleteMany({ where: { studentId: student.id } })
    await db.studentSubscriptionPayment.deleteMany({ where: { studentId: student.id } })
    await db.activationCodeEvent.deleteMany({ where: { studentId: student.id } })
    await db.activationCode.deleteMany({ where: { studentId: student.id } })
    await db.student.deleteMany({ where: { id: student.id } })
    await db.user.deleteMany({ where: { id: user.id } })
  })
  return { userId: user.id, studentId: student.id, email, token }
}

async function makeTestUser(schoolId: string, role: 'TEACHER' | 'STUDENT', label: string): Promise<TestUser> {
  const email = `batch.u.${label}.${RUN}@hawkings.test`
  const user = await db.user.create({
    data: {
      email, name: `Batch U ${label}`, role, schoolId, status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date(),
    },
  })
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) } })
  cleanup.push(async () => {
    await db.session.deleteMany({ where: { userId: user.id } })
    await db.staffEntitlement.deleteMany({ where: { userId: user.id } })
    await db.staffSubscriptionPayment.deleteMany({ where: { userId: user.id } })
    await db.activationCodeEvent.deleteMany({ where: { userId: user.id } })
    await db.activationCode.deleteMany({ where: { assignedUserId: user.id } })
    await db.activationCodeEvent.deleteMany({ where: { code: { assignedUserId: user.id } } })
    await db.user.deleteMany({ where: { id: user.id } })
  })
  return { userId: user.id, email, token, role }
}

async function asSchool(st: { token: string }, path: string, init?: RequestInit, ip?: string): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${st.token}`,
      'content-type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
  }, { deadlineMs: 40_000 })
}

async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': token, 'content-type': 'application/json' },
  }, { deadlineMs: 40_000 })
}

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

async function sessionForAdmin(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

function trackCode(codeId: string) {
  cleanup.push(async () => {
    await db.activationCodeEvent.deleteMany({ where: { codeId } })
    await db.activationCode.deleteMany({ where: { id: codeId } })
  })
}

function trackBatch(items: Array<{ codeId: string }>) {
  for (const i of items) trackCode(i.codeId)
}

async function issueBatch(payload: Record<string, unknown>): Promise<{ status: number; b: any }> {
  const r = await asPlatform(rootToken, '/api/platform/subscriptions/codes/batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const b = await body(r)
  return { status: r.status, b: b?.data ?? b }
}

// ── setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' }, include: { subscription: true } })
  if (!a) throw new Error('fixture school missing (run seed:demo)')
  schoolA = { id: a.id, slug: a.slug }
  originalBillingModel = a.subscription?.billingModel ?? 'SCHOOL_WIDE'

  const rootRow = await db.platformAdmin.create({
    data: {
      email: `batch.root.${RUN}@platform.test`, name: 'Batch Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  const opsRow = await db.platformAdmin.create({
    data: {
      email: `batch.ops.${RUN}@platform.test`, name: 'Batch Suite Ops', isRoot: false,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: { in: [rootRow.id, opsRow.id] } } })
    await db.platformAdmin.deleteMany({ where: { id: { in: [rootRow.id, opsRow.id] } } })
  })
  rootToken = await sessionForAdmin(rootRow.id)
  opsToken = await sessionForAdmin(opsRow.id)
  suiteAdminId = rootRow.id
}, 60_000)

afterAll(async () => {
  await db.schoolSubscription.updateMany({
    where: { schoolId: schoolA.id },
    data: { billingModel: originalBillingModel ?? 'SCHOOL_WIDE' },
  })
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
}, 60_000)

// ── 1 · batch generation (live) ───────────────────────────────────────────

describe('batch code generation (live)', () => {
  let studentPlanCode = ''
  let staffPlanCode = ''

  beforeAll(async () => {
    studentPlanCode = `BAT-STU-${RUN}`
    staffPlanCode = `BAT-STF-${RUN}`
    await db.subscriptionPlan.createMany({
      data: [
        { code: studentPlanCode, name: 'Batch Student Plan', scope: 'STUDENT', interval: 'ANNUAL', pricePerStudent: 600, currency: 'INR', allowOffline: true, status: 'ACTIVE' },
        { code: staffPlanCode, name: 'Batch Staff Plan', scope: 'STAFF', interval: 'ANNUAL', pricePerStudent: 300, currency: 'INR', allowOffline: true, status: 'ACTIVE' },
      ],
    })
    cleanup.push(async () => {
      await db.subscriptionPlan.deleteMany({ where: { code: { in: [studentPlanCode, staffPlanCode] } } })
    })
  })

  test('authz: no session → 401; non-billing admin → 403', async () => {
    const anon = await liveFetch(`${BASE}/api/platform/subscriptions/codes/batch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, { deadlineMs: 40_000 })
    expect(anon.status).toBe(401)
    const forbidden = await asPlatform(opsToken, '/api/platform/subscriptions/codes/batch', {
      method: 'POST', body: JSON.stringify({}),
    })
    expect(forbidden.status).toBe(403)
  }, T)

  test('OPEN student batch (payment-backed): requested==generated, one deferred batch payment, codes bound to plan+tenant', async () => {
    const { status, b } = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 5, claimWindowDays: 14, validityMonths: 12, assignment: 'OPEN',
      backing: 'PAYMENT', notes: 'Term-2 student seat batch (suite)',
    })
    expect(status).toBe(200)
    expect(b.requested).toBe(5)
    expect(b.generated).toBe(5)
    expect(b.items.length).toBe(5)
    expect(b.batchPayment?.receiptNo).toMatch(/^SCH-RCP-/)
    trackBatch(b.items)

    for (const item of b.items) {
      const row = await db.activationCode.findUnique({ where: { id: item.codeId } })
      expect(row?.scope).toBe('STUDENT_ENTITLEMENT')
      expect(row?.schoolId).toBe(schoolA.id)
      expect(row?.planCode).toBe(studentPlanCode)
      expect(row?.claimWindowDays).toBe(14)
      expect(row?.paymentRef).toBe(`platformPayment:${b.batchPayment.receiptNo ? (await db.platformPayment.findFirst({ where: { receiptNo: b.batchPayment.receiptNo } }))?.id : ''}`)
      // The stored verifier is NOT the plaintext.
      expect(row?.codeHash).not.toBe(normalizeCode(item.code))
    }
    // The deferred batch payment: VERIFIED, amount = unit × quantity,
    // snapshots null until a claim applies the period.
    const payment = await db.platformPayment.findFirst({ where: { receiptNo: b.batchPayment.receiptNo } })
    expect(payment?.verification).toBe('VERIFIED')
    expect(Number(payment?.amount)).toBe(3000)
    expect(payment?.statusAfter).toBeNull()
    cleanup.push(async () => {
      if (payment) await db.platformPayment.deleteMany({ where: { id: payment.id } })
    })
  }, T)

  test('ASSIGNED student batch: per-seat deferred payments, order preserved', async () => {
    const students = await Promise.all([makeTestStudent(schoolA.id, `a1`), makeTestStudent(schoolA.id, `a2`)])
    const { status, b } = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 2, assignment: 'ASSIGNED', assignedIds: students.map((s) => s.studentId),
      backing: 'PAYMENT', amountPerCode: 550, notes: 'Assigned seats (suite)',
    })
    expect(status).toBe(200)
    trackBatch(b.items)
    for (let i = 0; i < 2; i++) {
      const row = await db.activationCode.findUnique({ where: { id: b.items[i].codeId } })
      expect(row?.studentId).toBe(students[i].studentId)
    }
    const receipts = await db.studentSubscriptionPayment.findMany({
      where: { studentId: { in: students.map((s) => s.studentId) }, notes: { contains: '[BATCH]' } },
    })
    expect(receipts.length).toBe(2)
    for (const p of receipts) {
      expect(p.verification).toBe('VERIFIED')
      expect(Number(p.amount)).toBe(550)
      cleanup.push(async () => {
        await db.studentSubscriptionPayment.deleteMany({ where: { id: p.id } })
      })
    }
  }, T)

  test('ASSIGNED staff batch: teacher pre-assignment verified server-side; principal assignment refused', async () => {
    const teacher = await makeTestUser(schoolA.id, 'TEACHER', `asg`)
    const principal = await makeTestUser(schoolA.id, 'PRINCIPAL', `asgp`)

    const ok = await issueBatch({
      schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT', planCode: staffPlanCode,
      quantity: 1, assignment: 'ASSIGNED', assignedIds: [teacher.userId],
      backing: 'COMPLIMENTARY', notes: 'Complimentary staff pilot (suite)',
    })
    expect(ok.status).toBe(200)
    trackBatch(ok.b.items)
    const row = await db.activationCode.findUnique({ where: { id: ok.b.items[0].codeId } })
    expect(row?.assignedUserId).toBe(teacher.userId)
    expect(row?.scope).toBe('STAFF_ENTITLEMENT')

    const refused = await issueBatch({
      schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT', planCode: staffPlanCode,
      quantity: 1, assignment: 'ASSIGNED', assignedIds: [principal.userId],
      backing: 'COMPLIMENTARY', notes: 'Refuse principal assignment (suite)',
    })
    expect(refused.status).toBe(422)
  }, T)

  test('validation: quantity cap, count mismatch, missing reason, bad dates', async () => {
    const tooMany = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 201, backing: 'PAYMENT', notes: 'over the cap (suite)',
    })
    expect(tooMany.status).toBe(422)

    const zero = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 0, backing: 'PAYMENT', notes: 'zero quantity (suite)',
    })
    expect(zero.status).toBe(422)

    const noReason = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 1, backing: 'PAYMENT', notes: 'short',
    })
    expect(noReason.status).toBe(422)

    const badDates = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 1, backing: 'PAYMENT', notes: 'inverted dates (suite)',
      validityStart: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      validityEnd: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    })
    expect(badDates.status).toBe(422)

    const countMismatch = await issueBatch({
      schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT', planCode: staffPlanCode,
      quantity: 2, assignment: 'ASSIGNED', assignedIds: [], backing: 'PAYMENT',
      notes: 'assignment mismatch (suite)',
    })
    expect(countMismatch.status).toBe(422)
  }, T)

  test('school-plan codes cannot ride the batch route (scope mismatch)', async () => {
    // A SCHOOL-scope plan is not a per-seat product.
    const schoolPlan = await db.subscriptionPlan.create({
      data: { code: `BAT-SCH-${RUN}`, name: 'Batch School Plan', scope: 'SCHOOL', interval: 'MONTHLY', priceMonthly: 500, currency: 'INR', allowOffline: true, status: 'ACTIVE' },
    })
    cleanup.push(async () => {
      await db.subscriptionPlan.deleteMany({ where: { id: schoolPlan.id } })
    })
    const r = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: schoolPlan.code,
      quantity: 1, backing: 'PAYMENT', notes: 'school plan on batch route (suite)',
    })
    expect(r.status).toBe(422)
  }, T)

  test('claim a batch code: entitlement lands, one-time display holds (registry never returns plaintexts)', async () => {
    const student = await makeTestStudent(schoolA.id, `claim`)
    // PER_STUDENT so the gate path exists; the claim itself is what matters.
    await db.schoolSubscription.upsert({
      where: { schoolId: schoolA.id },
      create: { schoolId: schoolA.id, billingModel: 'PER_STUDENT' },
      update: { billingModel: 'PER_STUDENT' },
    })
    const { status, b } = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 1, assignment: 'ASSIGNED', assignedIds: [student.studentId],
      backing: 'PAYMENT', notes: 'claim path (suite)',
    })
    expect(status).toBe(200)
    trackBatch(b.items)
    const code = b.items[0].code

    const claim = await asSchool(student, '/api/subscription/student/claim', {
      method: 'POST', body: JSON.stringify({ code }),
    }, nextIp())
    expect(claim.status).toBe(200)

    const live = await db.studentEntitlement.findFirst({ where: { studentId: student.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })
    expect(live).not.toBeNull()

    // Registry GET: publicRef present, plaintext NEVER present.
    const reg = await asPlatform(rootToken, `/api/platform/subscriptions/codes?schoolId=${schoolA.id}&pageSize=100`)
    expect(reg.status).toBe(200)
    const regText = await reg.text()
    expect(regText).toContain(b.items[0].publicRef)
    expect(regText).not.toContain(code)
  }, T)

  test('single-use under concurrency: two simultaneous claims → one 200, one entitlement', async () => {
    const student = await makeTestStudent(schoolA.id, `race`)
    const { b } = await issueBatch({
      schoolId: schoolA.id, scope: 'STUDENT_ENTITLEMENT', planCode: studentPlanCode,
      quantity: 1, assignment: 'ASSIGNED', assignedIds: [student.studentId],
      backing: 'PAYMENT', notes: 'race (suite)',
    })
    trackBatch(b.items)
    const code = b.items[0].code
    const [r1, r2] = await Promise.all([
      asSchool(student, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp()),
      asSchool(student, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp()),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 403])
    const rows = await db.studentEntitlement.findMany({ where: { studentId: student.studentId } })
    expect(rows.length).toBe(1)
  }, T)
})

// ── 2 · keyed verifier transition (in-process) ────────────────────────────

describe('keyed verifier transition', () => {
  test('a legacy sha256-at-rest code still redeems through the dual lookup', async () => {
    const { hashCode, claimStudentActivationCode } = await import('@/lib/subscription/codes')
    const student = await makeTestStudent(schoolA.id, `legacy`)
    const normalized = normalizeCode(`AAAAA-BBBBB-CCCCC-DDDDD`)
    // Plant a code row EXACTLY as the pre-2026-10-30 design stored it.
    const planted = await db.activationCode.create({
      data: {
        publicRef: `SCH-ACT-LEG-${RUN.slice(0, 8)}`,
        codeHash: hashCode(normalized),
        scope: 'STUDENT_ENTITLEMENT',
        schoolId: schoolA.id,
        studentId: student.studentId,
        planCode: 'LEGACY',
        validityMonths: 12,
        claimWindowDays: 30,
        status: 'ISSUED',
        issuedById: suiteAdminId,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        paymentRef: 'studentPayment:suite',
      },
    })
    trackCode(planted.id)
    // PER_STUDENT context so the claim path resolves the entitlement.
    await db.schoolSubscription.upsert({
      where: { schoolId: schoolA.id },
      create: { schoolId: schoolA.id, billingModel: 'PER_STUDENT' },
      update: { billingModel: 'PER_STUDENT' },
    })
    const result = await claimStudentActivationCode(`aaaaa-bbbbb-ccccc-ddddd`, {
      userId: student.userId, schoolId: schoolA.id, studentId: student.studentId, ip: nextIp(),
    })
    expect(result.entitlementId).toBeTruthy()
  }, T)

  test('a keyed-verifier code never stores the plaintext and claims cleanly', async () => {
    const { codeVerifier, normalizeCode, claimStudentActivationCode } = await import('@/lib/subscription/codes')
    const student = await makeTestStudent(schoolA.id, `keyed`)
    const { issueActivationCode } = await import('@/lib/subscription/codes')
    const issued = await issueActivationCode({
      scope: 'STUDENT_ENTITLEMENT', schoolId: schoolA.id, studentId: student.studentId,
      planCode: 'KEYED', validityMonths: 12, claimWindowDays: 30, issuedById: suiteAdminId,
    })
    trackCode(issued.codeId)
    const row = await db.activationCode.findUnique({ where: { id: issued.codeId } })
    // The at-rest verifier matches the CURRENT verifier design (keyed when
    // a pepper is configured, sha256 otherwise) — never the plaintext.
    expect(row?.codeHash).toBe(codeVerifier(normalizeCode(issued.code)))
    expect(row?.codeHash).not.toBe(normalizeCode(issued.code))
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/)

    await db.schoolSubscription.upsert({
      where: { schoolId: schoolA.id },
      create: { schoolId: schoolA.id, billingModel: 'PER_STUDENT' },
      update: { billingModel: 'PER_STUDENT' },
    })
    const result = await claimStudentActivationCode(issued.code, {
      userId: student.userId, schoolId: schoolA.id, studentId: student.studentId, ip: nextIp(),
    })
    expect(result.entitlementId).toBeTruthy()
  }, T)
})

// ── 3 · reconciliation cron (live) ────────────────────────────────────────

describe('subscription reconciliation cron', () => {
  test('unauthenticated requests are rejected (fail-closed)', async () => {
    const r = await liveFetch(`${BASE}/api/cron/subscription-reconcile`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    }, { deadlineMs: 40_000 })
    expect(r.status).toBe(401)
  }, T)

  test('an authenticated run closes lapsed snapshots and is idempotent', async () => {
    // Plant: an expired-window ISSUED code, a lapsed live entitlement, a
    // stale PENDING order — all snapshots the sweep must reconcile.
    const student = await makeTestStudent(schoolA.id, `rec`)
    const staleCode = await db.activationCode.create({
      data: {
        publicRef: `SCH-ACT-REC-${RUN.slice(0, 8)}`,
        codeHash: createHash('sha256').update(`REC-${RUN}`).digest('hex'),
        scope: 'STUDENT_ENTITLEMENT', schoolId: schoolA.id, studentId: student.studentId,
        planCode: 'REC', validityMonths: 12, claimWindowDays: 30, status: 'ISSUED',
        issuedById: suiteAdminId, expiresAt: new Date(Date.now() - 3_600_000),
      },
    })
    trackCode(staleCode.id)

    const lapsedEntitlement = await db.studentEntitlement.create({
      data: {
        schoolId: schoolA.id, studentId: student.studentId, planCode: 'REC',
        status: 'ACTIVE', validityStart: new Date(Date.now() - 400 * 86_400_000),
        validityEnd: new Date(Date.now() - 86_400_000), source: 'MANUAL',
      },
    })
    cleanup.push(async () => {
      await db.studentEntitlement.deleteMany({ where: { id: lapsedEntitlement.id } })
    })

    const staleOrder = await db.subscriptionOrder.create({
      data: {
        orderNo: `SCH-ORD-REC-${RUN.slice(0, 8)}`,
        scope: 'STUDENT_PLAN', schoolId: schoolA.id, studentId: student.studentId,
        planCode: 'REC', amount: 100, currency: 'INR', status: 'PENDING',
        provider: 'SANDBOX', validityMonths: 12,
        expiresAt: new Date(Date.now() - 25 * 3_600_000), // past TTL + 24h grace
      },
    })
    cleanup.push(async () => {
      await db.subscriptionOrder.deleteMany({ where: { id: staleOrder.id } })
    })

    const r1 = await asPlatform(rootToken, '/api/cron/subscription-reconcile', { method: 'POST' })
    expect(r1.status).toBe(200)
    const b1 = (await body(r1))?.data
    expect(b1?.codesExpired).toBeGreaterThanOrEqual(1)
    expect(b1?.studentEntitlementsExpired).toBeGreaterThanOrEqual(1)
    expect(b1?.ordersExpired).toBeGreaterThanOrEqual(1)

    const codeAfter = await db.activationCode.findUnique({ where: { id: staleCode.id } })
    expect(codeAfter?.status).toBe('EXPIRED')
    const entAfter = await db.studentEntitlement.findUnique({ where: { id: lapsedEntitlement.id } })
    expect(entAfter?.status).toBe('EXPIRED')
    const orderAfter = await db.subscriptionOrder.findUnique({ where: { id: staleOrder.id } })
    expect(orderAfter?.status).toBe('EXPIRED')

    // Idempotent: a second run in the same hour either skips (JobRun
    // short-circuit) or reports zero — never double-flips.
    const r2 = await asPlatform(rootToken, '/api/cron/subscription-reconcile', { method: 'POST' })
    expect(r2.status).toBe(200)
    const b2 = (await body(r2))?.data
    const codesExpired2 = b2?.codesExpired ?? 0
    expect(codesExpired2).toBe(0)
  }, T)
})
