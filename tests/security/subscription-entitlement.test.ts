/**
 * tests/security/subscription-entitlement.test.ts
 *
 * SUBSCRIPTION & ENTITLEMENT SYSTEM — live acceptance suite.
 *
 * Covers the brief's acceptance criteria end-to-end against the dev
 * server (PAYMENTS_SANDBOX=1 lane + PLATFORM_PAYMENT_WEBHOOK_SECRET
 * fixture — the documented test contract in scripts/dev-keepalive.mjs):
 *
 *   · Model A school monthly/annual activation (online verified +
 *     code-gated offline).
 *   · Model B student annual activation (online verified + offline code).
 *   · Verified online payment activates EXACTLY ONCE (idempotent
 *     webhook replay + verify replay; provider-payment mismatch →
 *     conflict; nothing double-activates).
 *   · Failed/unverified payment NEVER activates (bad signature, bad
 *     confirmation, expired order).
 *   · Valid offline student code claims successfully; wrong student,
 *     wrong tenant, expired, revoked, malformed, already-claimed codes
 *     are rejected (generic responses — no oracle).
 *   · Concurrent claims cannot double-activate (conditional update +
 *     one-live-per-student partial unique index).
 *   · School-wide entitlement covers eligible members; an absent
 *     individual subscription never locks a covered student; an expired
 *     individual subscription denies access on a per-student tenant.
 *   · Manual complimentary requires the separate permission + is audited.
 *   · Revocation does not erase financial history.
 *   · API authn/authz/tenant isolation (platform transport vs school).
 *
 * Test-data discipline: every row this suite creates is tracked and
 * removed in afterAll; the tenant fixture billingModel is saved and
 * restored. Claim requests use per-request spoofed client IPs (the
 * documented live-suite convention) so the shared per-IP anti-guessing
 * budget is never exhausted by the suite itself.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, createHmac, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import { hashSessionToken } from '@/lib/auth'
import { evaluateStudentEntitlement } from '@/lib/entitlement/student'
import { normalizeCode, hashCode, addMonths } from '@/lib/subscription/codes'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const WEBHOOK_SECRET = process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET ?? 'platform-webhook-test-secret'
const T = 45_000

// ── fixtures / helpers ───────────────────────────────────────────────────

let schoolA = { id: '', slug: '' }
let rootToken = ''
let opsToken = ''
let originalSub: { billingModel: string; periodEnd: Date | null; status: string; plan: string } | null = null

const cleanup: Array<() => Promise<unknown>> = []
const RUN = randomBytes(4).toString('hex').toUpperCase() // plan codes require uppercase
let ipSeq = 0
// Per-run + per-request spoofed IPs (the documented live-suite convention):
// the run prefix keeps repeated suite runs from sharing per-IP budgets.
const RUN_IP_B1 = 16 + (parseInt(RUN.slice(0, 2), 16) % 200)
const RUN_IP_B2 = parseInt(RUN.slice(2), 16) % 256
const nextIp = () => `10.${RUN_IP_B1}.${(RUN_IP_B2 + (ipSeq >> 8)) % 256}.${1 + (ipSeq++ % 250)}`

interface TestStudent { userId: string; studentId: string; email: string; token: string }

async function makeTestStudent(schoolId: string, label: string, opts?: { locked?: boolean }): Promise<TestStudent> {
  const email = `sub.test.${label}.${RUN}@hawkings.test`
  const user = await db.user.create({
    data: {
      email,
      name: `Sub Test ${label}`,
      role: 'STUDENT',
      schoolId,
      status: 'ACTIVE',
      subscriptionStatus: opts?.locked ? 'LOCKED' : 'ACTIVE',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })
  const student = await db.student.create({ data: { schoolId, userId: user.id, admissionNo: `SUB-${RUN}-${label}` } })
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

/** Direct PlatformAdminSession row for an admin id (auth fixture). */
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

function signWebhook(raw: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')
}

async function sendWebhook(payload: object, opts?: { signature?: string }): Promise<Response> {
  const raw = JSON.stringify(payload)
  return liveFetch(`${BASE}/api/webhooks/platform-subscription`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-scholario-signature': opts?.signature ?? signWebhook(raw),
      'x-forwarded-for': nextIp(),
    },
    body: raw,
  }, { deadlineMs: 40_000 })
}

// ── setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' }, include: { subscription: true } })
  if (!a) throw new Error('fixture school missing (run seed:demo)')
  schoolA = { id: a.id, slug: a.slug }
  if (a.subscription) {
    originalSub = {
      billingModel: a.subscription.billingModel,
      periodEnd: a.subscription.periodEnd,
      status: a.subscription.status,
      plan: a.subscription.plan,
    }
  }

  // Per-run throwaway identities (fresh rate-limit budgets — the dev
  // server's in-memory limiter cache cannot be reset from the test
  // process, and repeated runs exhausted the fixture identities' shared
  // budgets; throwaway identities give every run identical semantics):
  //   · ROOT platform admin (isRoot → every capability incl.
  //     billing.complimentary),
  //   · non-root OPS admin (no billing.* grants — the negative cases),
  //   · a MANAGEMENT user in the fixture school (principal-surface
  //     actions: redeem/order/verify).
  const rootRow = await db.platformAdmin.create({
    data: {
      email: `sub.root.${RUN}@platform.test`, name: 'Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  const opsRow = await db.platformAdmin.create({
    data: {
      email: `sub.ops.${RUN}@platform.test`, name: 'Suite Ops', isRoot: false,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  rootToken = await sessionForAdmin(rootRow.id)
  opsToken = await sessionForAdmin(opsRow.id)
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: { in: [rootRow.id, opsRow.id] } } })
    await db.platformAdmin.deleteMany({ where: { id: { in: [rootRow.id, opsRow.id] } } })
  })

  // Plans used by the suite (created through the real API once).
  const mk = async (payload: object) => asPlatform(rootToken, '/api/platform/subscriptions/plans', { method: 'POST', body: JSON.stringify(payload) })
  await mk({ code: `TEST-STU-${RUN}`, name: 'Test Student Annual', scope: 'STUDENT', interval: 'ANNUAL', pricePerStudent: 500, currency: 'INR' })
  await mk({ code: `TEST-SCH-M-${RUN}`, name: 'Test School Monthly', scope: 'SCHOOL', interval: 'MONTHLY', priceMonthly: 2000, currency: 'INR' })
  await mk({ code: `TEST-SCH-A-${RUN}`, name: 'Test School Annual', scope: 'SCHOOL', interval: 'ANNUAL', priceAnnual: 20000, currency: 'INR' })
  cleanup.push(async () => {
    await db.subscriptionOrder.deleteMany({ where: { planCode: { contains: RUN } } })
    await db.subscriptionPlan.deleteMany({ where: { code: { contains: RUN } } })
  })
}, 120_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Restore the tenant's saved subscription posture.
  // Hard restore to the documented fixture posture (SCHOOL_WIDE — the
  // tenant default; originalSub alone is unreliable across polluted runs).
  await db.schoolSubscription.update({
    where: { schoolId: schoolA.id },
    data: {
      billingModel: 'SCHOOL_WIDE',
      periodEnd: originalSub?.periodEnd ?? null,
      status: originalSub?.status ?? 'ACTIVE',
      plan: originalSub?.plan ?? 'STANDARD',
      overrideStatus: null,
    },
  }).catch(() => {})
  // Remove suite platform payments (receipt marker not used — match by notes tag).
  await db.platformPayment.deleteMany({ where: { notes: { contains: RUN } } }).catch(() => {})
  await db.webhookEvent.deleteMany({ where: { eventId: { contains: RUN } } }).catch(() => {})
  await db.platformAuditLog.deleteMany({ where: { metadata: { path: ['$'], string_contains: RUN } } } as never).catch(() => {})
  await db.$disconnect()
})

// ── unit: the per-student state machine ─────────────────────────────────

describe('SUBSCRIPTION · per-student entitlement evaluation (unit)', () => {
  const tenantActive = { state: 'ACTIVE' as const, businessAllowed: true, loginAllowed: true, plan: 'STANDARD', periodEnd: null, graceUntil: null, renewalRequired: false, message: null }
  const now = new Date('2026-10-13T12:00:00Z')
  const inFuture = (days: number) => new Date(now.getTime() + days * 86400_000)

  test('school-wide coverage: absent individual subscription never locks a covered student', () => {
    const d = evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'SCHOOL_WIDE', entitlement: null, now })
    expect(d.state).toBe('COVERED_BY_SCHOOL')
    expect(d.businessAllowed).toBe(true)
  })

  test('per-student model with no row → NOT_SUBSCRIBED (denied)', () => {
    const d = evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'PER_STUDENT', entitlement: null, now })
    expect(d.state).toBe('NOT_SUBSCRIBED')
    expect(d.businessAllowed).toBe(false)
  })

  test('active window → ACTIVE (allowed); expiry computed LIVE from the window, not the stored status', () => {
    const live = evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'PER_STUDENT', entitlement: { status: 'ACTIVE', validityStart: inFuture(-30), validityEnd: inFuture(60), source: 'ONLINE' }, now })
    expect(live.state).toBe('ACTIVE')
    // stored status says ACTIVE but the window has passed → EXPIRED.
    const expired = evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'PER_STUDENT', entitlement: { status: 'ACTIVE', validityStart: inFuture(-400), validityEnd: inFuture(-10), source: 'ONLINE' }, now })
    expect(expired.state).toBe('EXPIRED')
    expect(expired.businessAllowed).toBe(false)
  })

  test('future start → PENDING; revoked/suspended deny; tenant restriction wins over individual entitlement', () => {
    expect(evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'PER_STUDENT', entitlement: { status: 'PENDING', validityStart: inFuture(10), validityEnd: inFuture(400), source: 'MANUAL' }, now }).state).toBe('PENDING')
    expect(evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: tenantActive, billingModel: 'PER_STUDENT', entitlement: { status: 'REVOKED', validityStart: inFuture(-10), validityEnd: inFuture(10), source: 'MANUAL' }, now }).businessAllowed).toBe(false)
    const restricted = { ...tenantActive, state: 'RESTRICTED' as const, businessAllowed: false }
    expect(evaluateStudentEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant: restricted, billingModel: 'PER_STUDENT', entitlement: { status: 'ACTIVE', validityStart: inFuture(-10), validityEnd: inFuture(10), source: 'ONLINE' }, now }).state).toBe('TENANT_RESTRICTED')
    expect(evaluateStudentEntitlement({ accountSubscriptionStatus: 'LOCKED', tenant: tenantActive, billingModel: 'SCHOOL_WIDE', entitlement: null, now }).state).toBe('ACCOUNT_LOCKED')
  })

  test('code normalization is unambiguous (case/whitespace insensitive)', () => {
    expect(normalizeCode('abcde-fghij-klmno-pqrst')).toBe(normalizeCode(' ABCDE FGHIJ KLMNO PQRST '))
    expect(hashCode(normalizeCode('ABCDE-FGHIJ-KLMNO-PQRST'))).toBe(hashCode('ABCDEFGHIJKLMNOPQRST'))
  })
})

// ── platform boundary ────────────────────────────────────────────────────

describe('SUBSCRIPTION · platform route authorization', () => {
  test('no platform session → 401 AUTH_REQUIRED', async () => {
    const r = await liveFetch(`${BASE}/api/platform/subscriptions/plans`, undefined, { deadlineMs: 40_000 })
    expect(r.status).toBe(401)
  }, T)

  test('a SCHOOL session token never satisfies the platform pipeline', async () => {
    const st = await makeTestStudent(schoolA.id, 'authz')
    const r = await asSchool(st, '/api/platform/subscriptions/plans')
    expect(r.status).toBe(401)
  }, T)

  test('non-root admin without billing.manage → 403 FORBIDDEN', async () => {
    const r = await asPlatform(opsToken, '/api/platform/subscriptions/plans')
    expect(r.status).toBe(403)
  }, T)

  test('root admin reads the registry (server-side status + summaries)', async () => {
    const r = await asPlatform(rootToken, '/api/platform/subscriptions/registry')
    expect(r.status).toBe(200)
    const b = await body(r)
    expect(b?.data?.summary).toBeTruthy()
  }, T)
})

// ── Model C: manual / complimentary assignment ───────────────────────────

describe('SUBSCRIPTION · Model C manual assignment + complimentary permission', () => {
  test('complimentary WITHOUT billing.complimentary → 403 (separate permission-protected workflow)', async () => {
    const st = await makeTestStudent(schoolA.id, 'comp-neg')
    const r = await asPlatform(opsToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'COMPLIMENTARY', amount: 0, paymentDate: new Date().toISOString(), validityMonths: 12 }),
    })
    expect(r.status).toBe(403)
  }, T)

  test('root assigns complimentary (audited); revoke keeps the financial row', async () => {
    const st = await makeTestStudent(schoolA.id, 'comp-pos')
    const r = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'COMPLIMENTARY', amount: 0, paymentDate: new Date().toISOString(), validityMonths: 12, notes: `suite ${RUN}` }),
    })
    expect(r.status).toBe(200)
    const b = await body(r)
    expect(b?.data?.entitlement?.statusAfter).toBe('ACTIVE')
    const entitlementId = b?.data?.entitlement?.id as string

    // Paid amount rejected for complimentary.
    const bad = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'COMPLIMENTARY', amount: 100, paymentDate: new Date().toISOString(), validityMonths: 12 }),
    })
    expect(bad.status).toBe(422)

    // Audit row exists.
    const audit = await db.platformAuditLog.findFirst({ where: { action: 'platform.billing.student_entitlement_assigned', targetId: st.studentId } })
    expect(audit).toBeTruthy()

    // Revoke: entitlement flips, payment rows stay.
    const rev = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'revoke', reason: `suite revoke ${RUN}` }),
    })
    expect(rev.status).toBe(200)
    const row = await db.studentEntitlement.findUnique({ where: { id: entitlementId } })
    expect(row?.status).toBe('REVOKED')
    expect(row?.revokeReason).toContain('suite revoke')
    const payments = await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })
    expect(payments).toBe(1) // financial history NOT erased
  }, T)
})

// ── Model B offline: activation codes ────────────────────────────────────

describe('SUBSCRIPTION · activation codes (offline delivery)', () => {
  test('issue (with payment) → student claims → ACTIVE; replay rejected; another student rejected generically', async () => {
    const st = await makeTestStudent(schoolA.id, 'code-ok')
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({
        planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(),
        validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}`,
      }),
    })
    expect(issue.status).toBe(200)
    const ib = await body(issue)
    const code = ib?.data?.activationCode?.code as string
    const publicRef = ib?.data?.activationCode?.publicRef as string
    expect(code).toBeTruthy()
    // The payment row exists BEFORE redemption (immutable financial record).
    const payment = await db.studentSubscriptionPayment.findFirst({ where: { studentId: st.studentId } })
    expect(payment?.verification).toBe('VERIFIED')
    // No entitlement yet (code-gated).
    expect(await db.studentEntitlement.count({ where: { studentId: st.studentId } })).toBe(0)

    // Claim succeeds.
    const claim = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(claim.status).toBe(200)
    const cb = await body(claim)
    expect(cb?.data?.entitlement?.status).toBe('ACTIVE')

    // Replaying the SAME code is rejected (already claimed) — generic message, no oracle.
    const replay = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect([403, 429]).toContain(replay.status)

    // Another student cannot claim a code destined for someone else —
    // (this code is claimed; a fresh one for the negative cross-student test below).
    const st2 = await makeTestStudent(schoolA.id, 'code-wrong-student')
    const issue2 = await asPlatform(rootToken, `/api/platform/students/${st2.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const code2 = (await body(issue2))?.data?.activationCode?.code as string
    const stranger = await makeTestStudent(schoolA.id, 'code-stranger')
    const wrongStudent = await asSchool(stranger, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: code2 }) }, nextIp())
    expect([403, 429]).toContain(wrongStudent.status)

    // Cross-tenant: a green-valley student cannot claim a hawkings code.
    const b = await db.school.findUnique({ where: { slug: 'green-valley' } })
    const crossUser = await db.user.create({ data: { email: `sub.cross.${RUN}@greenvalley.test`, name: 'Cross', role: 'STUDENT', schoolId: b!.id, status: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date() } })
    const crossStudent = await db.student.create({ data: { schoolId: b!.id, userId: crossUser.id } })
    const crossToken = randomBytes(32).toString('hex')
    await db.session.create({ data: { userId: crossUser.id, tokenHash: hashSessionToken(crossToken), expiresAt: new Date(Date.now() + 3600_000) } })
    cleanup.push(async () => {
      await db.session.deleteMany({ where: { userId: crossUser.id } })
      await db.student.deleteMany({ where: { id: crossStudent.id } })
      await db.user.deleteMany({ where: { id: crossUser.id } })
    })
    const cross = await asSchool({ token: crossToken }, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: code2 }) }, nextIp())
    expect([403, 429]).toContain(cross.status)
    // And the intended student still claims it fine afterwards.
    const right = await asSchool(st2, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: code2 }) }, nextIp())
    expect(right.status).toBe(200)
    void publicRef
  }, T)

  test('expired / revoked / malformed codes are rejected', async () => {
    const st = await makeTestStudent(schoolA.id, 'code-states')
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const data = (await body(issue))?.data?.activationCode as { codeId: string; code: string }
    // EXPIRED: force the window into the past.
    await db.activationCode.update({ where: { id: data.codeId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: data.code }) }, nextIp())
    expect([403, 429]).toContain(expired.status)

    // REVOKED: reissue a fresh code (revoking the old), claim the OLD one.
    const issue2 = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const data2 = (await body(issue2))?.data?.activationCode as { codeId: string; code: string }
    await asPlatform(rootToken, `/api/platform/subscriptions/codes/${data2.codeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'revoke', reason: `suite revoke ${RUN}` }),
    })
    const revoked = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: data2.code }) }, nextIp())
    expect([403, 429]).toContain(revoked.status)

    // MALFORMED.
    const malformed = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: 'NOT-A-REAL-CODE' }) }, nextIp())
    expect([403, 429, 422]).toContain(malformed.status)
  }, T)

  test('reissue: old code unusable, replacement works; operator reissue API', async () => {
    const st = await makeTestStudent(schoolA.id, 'code-reissue')
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const old = (await body(issue))?.data?.activationCode as { codeId: string; code: string; publicRef: string }
    const reissue = await asPlatform(rootToken, `/api/platform/subscriptions/codes/${old.codeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reissue', reason: `suite reissue ${RUN}` }),
    })
    expect(reissue.status).toBe(200)
    const fresh = (await body(reissue))?.data as { code: string }
    // The OLD code is replaced → rejected.
    const oldClaim = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: old.code }) }, nextIp())
    expect([403, 429]).toContain(oldClaim.status)
    // The NEW code works.
    const newClaim = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: fresh.code }) }, nextIp())
    expect(newClaim.status).toBe(200)
  }, T)

  test('concurrent claims cannot double-activate (exactly one wins)', async () => {
    const st = await makeTestStudent(schoolA.id, 'code-race')
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const data = (await body(issue))?.data?.activationCode as { code: string }
    const [a, b] = await Promise.all([
      asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: data.code }) }, nextIp()),
      asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: data.code }) }, nextIp()),
    ])
    const okCount = [a, b].filter((r) => r.status === 200).length
    expect(okCount).toBe(1)
    const rows = await db.studentEntitlement.count({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })
    expect(rows).toBe(1)
  }, T)
})

// ── Model B online: orders + verification + webhook idempotency ─────────

describe('SUBSCRIPTION · student online payment lane', () => {
  test('order → sandbox confirm → verify settles exactly once; webhook replay is idempotent; UI status matches', async () => {
    // Model B context: the tenant is on the per-student model (restored
    // in afterAll + inline on failure paths).
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'PER_STUDENT' } })
    const st = await makeTestStudent(schoolA.id, 'online')
    const order = await asSchool(st, '/api/subscription/student/order', {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
    }, nextIp())
    expect(order.status).toBe(200)
    const ob = (await body(order))?.data as { order: { orderNo: string; amount: number; currency: string } }
    expect(ob.order.amount).toBe(500) // server-side price — never client input

    const verify = await asSchool(st, '/api/subscription/student/verify', {
      method: 'POST',
      body: JSON.stringify({ orderNo: ob.order.orderNo, sandbox: true }),
    }, nextIp())
    expect(verify.status).toBe(200)
    const vb = await body(verify)
    expect(vb?.data?.alreadyPaid).toBe(false)
    expect(vb?.data?.statusAfter).toBe('ACTIVE')

    // Replay the verification: idempotent, no second entitlement.
    const replay = await asSchool(st, '/api/subscription/student/verify', {
      method: 'POST',
      body: JSON.stringify({ orderNo: ob.order.orderNo, sandbox: true }),
    }, nextIp())
    expect(replay.status).toBe(200)
    expect((await body(replay))?.data?.alreadyPaid).toBe(true)
    expect(await db.studentEntitlement.count({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(1)

    // Webhook settlement lane on a FRESH order (the verified order above
    // is PAID — a different provider payment id on it is correctly a
    // conflict, not a duplicate).
    const order2 = await asSchool(st, '/api/subscription/student/order', {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
    }, nextIp())
    const ob2 = (await body(order2))?.data as { order: { orderNo: string } }
    const evtId = `evt-sub-dup-${RUN}`
    const wh1 = await sendWebhook({
      eventId: evtId,
      eventType: 'student_subscription.payment.captured',
      payment: { schoolId: schoolA.id, amount: 500, currency: 'INR', providerPaymentId: `pay_sbx_replay_${RUN}` },
      order: { orderNo: ob2.order.orderNo },
    })
    expect(wh1.status).toBe(200)
    const wh2 = await sendWebhook({
      eventId: evtId,
      eventType: 'student_subscription.payment.captured',
      payment: { schoolId: schoolA.id, amount: 500, currency: 'INR', providerPaymentId: `pay_sbx_replay2_${RUN}` },
      order: { orderNo: ob2.order.orderNo },
    })
    const wh2b = await body(wh2)
    expect(wh2b?.duplicate ?? wh2b?.data?.duplicate).toBeTruthy()
    // one payment from verify + one from the webhook = 2 (not 3: the
    // duplicate event added nothing).
    expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })).toBe(2)

    // Status surface agrees with the gate (UI status = server truth).
    const status = await asSchool(st, '/api/subscription/student')
    expect(status.status).toBe(200)
    const sb = (await body(status))?.data
    expect(sb?.entitlement?.state).toBe('ACTIVE')
    // Restore the tenant posture for subsequent suites.
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
  }, T)

  test('unverified payment NEVER activates (bad signature webhook; forged sandbox confirmation)', async () => {
    const st = await makeTestStudent(schoolA.id, 'unverified')
    // Unsigned/badly-signed webhook → 401, nothing recorded.
    const bad = await sendWebhook({ eventId: `evt-bad-sig-${RUN}`, eventType: 'subscription.payment.captured', payment: { schoolId: schoolA.id, amount: 500 } }, { signature: 'deadbeef' })
    expect(bad.status).toBe(401)

    // A forged confirmation (wrong signature) fails verification.
    const order = await asSchool(st, '/api/subscription/student/order', {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
    }, nextIp())
    const ob = (await body(order))?.data as { order: { orderNo: string } }
    const forged = await asSchool(st, '/api/subscription/student/verify', {
      method: 'POST',
      body: JSON.stringify({
        orderNo: ob.order.orderNo,
        paymentId: `pay_forged_${RUN}`,
        signature: createHmac('sha256', 'wrong-secret').update(`${ob.order.orderNo}|pay_forged_${RUN}`).digest('hex'),
      }),
    }, nextIp())
    expect([400, 422]).toContain(forged.status)
    // Nothing activated: order still PENDING, no entitlement, no payment row.
    const row = await db.subscriptionOrder.findUnique({ where: { orderNo: ob.order.orderNo } })
    expect(row?.status).toBe('PENDING')
    expect(await db.studentEntitlement.count({ where: { studentId: st.studentId } })).toBe(0)
    expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })).toBe(0)
  }, T)
})

// ── Model A online: school-wide renewal ──────────────────────────────────

describe('SUBSCRIPTION · school online renewal lane', () => {
  test('principal orders + verifies → tenant period extends; duplicate webhook idempotent; monthly and annual both work', async () => {
    const mgmt = await db.user.create({
      data: { email: `sub.mgmt.${RUN}@hawkings.test`, name: 'Suite Principal', role: 'PRINCIPAL', schoolId: schoolA.id, status: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date() },
    })
    const token = randomBytes(32).toString('hex')
    await db.session.create({ data: { userId: mgmt.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) } })
    cleanup.push(async () => {
      await db.session.deleteMany({ where: { userId: mgmt.id } })
      await db.user.deleteMany({ where: { id: mgmt.id } })
    })
    const principal = { token }

    // Annual plan order.
    const order = await asSchool(principal, '/api/subscription/order', { method: 'POST', body: JSON.stringify({ planCode: `TEST-SCH-A-${RUN}` }) }, nextIp())
    expect(order.status).toBe(200)
    const ob = (await body(order))?.data as { order: { orderNo: string; amount: number } }
    expect(ob.order.amount).toBe(20000)

    // Sandbox settle via the webhook (order-linked, signed).
    const evtId = `evt-sch-${RUN}`
    const wh = await sendWebhook({
      eventId: evtId,
      eventType: 'subscription.payment.captured',
      payment: { schoolId: schoolA.id, amount: 20000, currency: 'INR', providerPaymentId: `pay_sch_${RUN}` },
      order: { orderNo: ob.order.orderNo },
    })
    expect(wh.status).toBe(200)
    expect((await body(wh)).processed ?? (await body(wh)).data?.processed).toBeTruthy()

    const sub = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    expect(sub?.periodEnd).toBeTruthy()
    expect(sub?.planCode).toBe(`TEST-SCH-A-${RUN}`)
    expect(sub?.priceSnapshot?.toString()).toBe('20000')

    // Duplicate event id → duplicate, not re-processed.
    const wh2 = await sendWebhook({
      eventId: evtId,
      eventType: 'subscription.payment.captured',
      payment: { schoolId: schoolA.id, amount: 20000, currency: 'INR', providerPaymentId: `pay_sch2_${RUN}` },
      order: { orderNo: ob.order.orderNo },
    })
    expect((await body(wh2))?.duplicate ?? (await body(wh2))?.data?.duplicate).toBeTruthy()
  }, T)

  test('offline school payment + code → principal redeems → tenant activated exactly once', async () => {
    const mgmt2 = await db.user.create({
      data: { email: `sub.mgmt2.${RUN}@hawkings.test`, name: 'Suite Principal 2', role: 'PRINCIPAL', schoolId: schoolA.id, status: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date() },
    })
    const token = randomBytes(32).toString('hex')
    await db.session.create({ data: { userId: mgmt2.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) } })
    cleanup.push(async () => {
      await db.session.deleteMany({ where: { userId: mgmt2.id } })
      await db.user.deleteMany({ where: { id: mgmt2.id } })
    })

    const before = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    const record = await asPlatform(rootToken, `/api/platform/schools/${schoolA.id}/subscription/payments`, {
      method: 'POST',
      body: JSON.stringify({
        planCode: `TEST-SCH-M-${RUN}`, amount: 2000, currency: 'INR', mode: 'CASH',
        paymentDate: new Date().toISOString(), issueActivationCode: true, notes: `suite ${RUN}`,
      }),
    })
    expect(record.status).toBe(200)
    const rb = (await body(record))?.data?.activationCode as { code: string; publicRef: string }

    // Payment recorded but the period NOT extended (code-gated).
    const mid = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    expect(mid?.periodEnd?.toISOString()).toBe(before?.periodEnd?.toISOString())

    // Redeem as the principal.
    const redeem = await asSchool({ token }, '/api/subscription/redeem', { method: 'POST', body: JSON.stringify({ code: rb.code }) }, nextIp())
    expect(redeem.status).toBe(200)
    const after = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    expect(after?.periodEnd!.getTime()).toBeGreaterThan(before?.periodEnd?.getTime() ?? 0)
    expect(after?.planCode).toBe(`TEST-SCH-M-${RUN}`)

    // Replay: rejected.
    const replay = await asSchool({ token }, '/api/subscription/redeem', { method: 'POST', body: JSON.stringify({ code: rb.code }) }, nextIp())
    expect([403, 429]).toContain(replay.status)
  }, T)
})

// ── server-side enforcement (withUser student gate) ──────────────────────

describe('SUBSCRIPTION · per-student enforcement (withUser gate)', () => {
  test('PER_STUDENT tenant: no entitlement → business API 403; claim activates → 200; SCHOOL_WIDE restored → covered again', async () => {
    // Switch the tenant to the per-student model (restored in afterAll).
    await db.schoolSubscription.upsert({
      where: { schoolId: schoolA.id },
      create: { schoolId: schoolA.id, billingModel: 'PER_STUDENT', plan: 'STANDARD' },
      update: { billingModel: 'PER_STUDENT' },
    })

    const st = await makeTestStudent(schoolA.id, 'gate')
    // No entitlement → business API denies with the student-scoped message.
    const denied = await asSchool(st, '/api/student/dashboard')
    expect(denied.status).toBe(403)
    const db_ = await body(denied)
    expect(db_?.code).toBe('SUBSCRIPTION_REQUIRED')
    expect(String(db_?.error)).toContain('student subscription')

    // The claim/status surface stays reachable (exempt renewal surface).
    const status = await asSchool(st, '/api/subscription/student')
    expect(status.status).toBe(200)

    // Activate via a paid code, then the business API opens.
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, notes: `suite ${RUN}` }),
    })
    expect(issue.status).toBe(200)
    const allowed = await asSchool(st, '/api/student/dashboard')
    expect(allowed.status).toBe(200)

    // Expire the entitlement → denied again (live window computation).
    const ent = await db.studentEntitlement.findFirst({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })
    await db.studentEntitlement.update({ where: { id: ent!.id }, data: { validityEnd: new Date(Date.now() - 86400_000) } })
    const expired = await asSchool(st, '/api/student/dashboard')
    expect(expired.status).toBe(403)

    // Restore school-wide → covered without any individual entitlement.
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
    const covered = await asSchool(st, '/api/student/dashboard')
    expect(covered.status).toBe(200)
  }, T)
  // NOTE: the billingModel flips inside the test above are restored
  // inline AND hard-restored in afterAll (SCHOOL_WIDE) — a failed
  // assertion mid-test must never leak PER_STUDENT into later suites.
})

// ── PR-30 REVIEW REGRESSIONS (2026-10-14) ─────────────────────────────────
// Each case pins a defect confirmed during the pre-merge review and fixed
// on the branch: cross-student verify oracle, rejection-event persistence,
// renewal stacking, adjust-validity extend-only, the Razorpay-webhook
// subscription settlement lane, the plan PATCH allowOnline merge bug, and
// the billingModel atomicity on failing payments.

describe('SUBSCRIPTION · PR-30 review regressions', () => {
  test('student verify NEVER answers for another student\'s order — PAID or pending (no cross-student oracle)', async () => {
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'PER_STUDENT' } })
    const owner = await makeTestStudent(schoolA.id, 'verify-owner')
    const other = await makeTestStudent(schoolA.id, 'verify-other')
    try {
      const order = await asSchool(owner, '/api/subscription/student/order', {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
      }, nextIp())
      const ob = (await body(order))?.data as { order: { orderNo: string } }

      // Owner settles it (sandbox lane) — the order becomes PAID.
      const verify = await asSchool(owner, '/api/subscription/student/verify', {
        method: 'POST',
        body: JSON.stringify({ orderNo: ob.order.orderNo, sandbox: true }),
      }, nextIp())
      expect(verify.status).toBe(200)

      // ANOTHER student probes the SAME (now PAID) order number: must be
      // 403 — NOT the idempotent alreadyPaid payload (which leaks the
      // entitlement id / validity of the owner). This was the review
      // defect: the PAID fast-path ran before the ownership check.
      const probe = await asSchool(other, '/api/subscription/student/verify', {
        method: 'POST',
        body: JSON.stringify({ orderNo: ob.order.orderNo, sandbox: true }),
      }, nextIp())
      expect(probe.status).toBe(403)
      const probeBody = await body(probe)
      expect(probeBody?.data?.alreadyPaid ?? probeBody?.alreadyPaid).toBeUndefined()

      // A fresh PENDING order is likewise refused for the other student.
      const order2 = await asSchool(owner, '/api/subscription/student/order', {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
      }, nextIp())
      const ob2 = (await body(order2))?.data as { order: { orderNo: string } }
      const probe2 = await asSchool(other, '/api/subscription/student/verify', {
        method: 'POST',
        body: JSON.stringify({ orderNo: ob2.order.orderNo, sandbox: true }),
      }, nextIp())
      expect(probe2.status).toBe(403)
      expect((await db.studentSubscriptionPayment.count({ where: { studentId: other.studentId } }))).toBe(0)
    } finally {
      await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
    }
  }, T)

  test('claim rejections PERSIST their diagnostic event (post-transaction write)', async () => {
    const owner = await makeTestStudent(schoolA.id, 'rej-owner')
    const intruder = await makeTestStudent(schoolA.id, 'rej-intruder')
    const issue = await asPlatform(rootToken, `/api/platform/students/${owner.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN}` }),
    })
    const code = (await body(issue))?.data?.activationCode as { codeId: string; code: string }

    // The WRONG student claims → generic 403 …
    const attempt = await asSchool(intruder, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: code.code }) }, nextIp())
    expect([403, 429]).toContain(attempt.status)

    // … AND the CLAIM_REJECTED event survives (it used to be rolled back
    // with the rejected transaction — rejection forensics were blind).
    const events = await db.activationCodeEvent.findMany({ where: { codeId: code.codeId, type: 'CLAIM_REJECTED' } })
    expect(events.length).toBeGreaterThanOrEqual(1)
    const detail = JSON.parse(events[0]?.detail ?? '{}') as { reason?: string }
    expect(detail.reason).toBe('STUDENT_MISMATCH')
  }, T)

  test('sequential renewals STACK (validityEnd extends, one live row, financial rows accumulate)', async () => {
    const st = await makeTestStudent(schoolA.id, 'renew-stack')
    const claimCode = async (label: string) => {
      const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN} ${label}` }),
      })
      const c = (await body(issue))?.data?.activationCode as { code: string }
      const claim = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code: c.code }) }, nextIp())
      expect(claim.status).toBe(200)
    }
    await claimCode('first')
    const first = await db.studentEntitlement.findFirstOrThrow({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })
    await claimCode('second')
    const rows = await db.studentEntitlement.findMany({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })
    expect(rows.length).toBe(1) // one live row — the second claim EXTENDED it
    expect(rows[0].validityEnd.getTime()).toBeGreaterThan(first.validityEnd.getTime()) // stacked, never reset
    expect((await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } }))).toBe(2) // both financial rows kept
  }, T)

  test('adjust-validity is EXTEND-ONLY (a past or shortened end is rejected; revoke is the early-exit path)', async () => {
    const st = await makeTestStudent(schoolA.id, 'adjust')
    const assign = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'COMPLIMENTARY', amount: 0, paymentDate: new Date().toISOString(), validityMonths: 12, notes: `suite ${RUN} complimentary for review regression` }),
    })
    expect(assign.status).toBe(200)
    const live = await db.studentEntitlement.findFirstOrThrow({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })

    // A PAST end would silently expire the grant — rejected.
    const past = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'adjust-validity', reason: `suite adjust past ${RUN}`, validityEnd: new Date(Date.now() - 86_400_000).toISOString() }),
    })
    expect(past.status).toBeGreaterThanOrEqual(400)

    // An end EARLIER than the current one would shorten a paid grant — rejected.
    const shorter = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'adjust-validity', reason: `suite adjust short ${RUN}`, validityEnd: new Date(live.validityStart.getTime() + 30 * 86_400_000).toISOString() }),
    })
    expect(shorter.status).toBeGreaterThanOrEqual(400)
    const unchanged = await db.studentEntitlement.findUniqueOrThrow({ where: { id: live.id } })
    expect(unchanged.validityEnd.getTime()).toBe(live.validityEnd.getTime()) // nothing moved

    // An extension is accepted and recorded.
    const extended = new Date(live.validityEnd.getTime() + 30 * 86_400_000)
    const ok = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'adjust-validity', reason: `suite adjust extend ${RUN}`, validityEnd: extended.toISOString() }),
    })
    expect(ok.status).toBe(200)
    const after = await db.studentEntitlement.findUniqueOrThrow({ where: { id: live.id } })
    expect(after.validityEnd.getTime()).toBe(extended.getTime())
  }, T)

  test('razorpay webhook settles a SUBSCRIPTION order (native payment.captured lane, amount-gated)', async () => {
    const RZP_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'batch2-test-webhook-secret'
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'PER_STUDENT' } })
    const st = await makeTestStudent(schoolA.id, 'rzp-lane')
    try {
      const order = await asSchool(st, '/api/subscription/student/order', {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
      }, nextIp())
      const ob = (await body(order))?.data as { order: { orderNo: string; amount: number } }
      const row = await db.subscriptionOrder.findUniqueOrThrow({ where: { orderNo: ob.order.orderNo } })

      // A WRONG amount is an exception, never a settlement (BATCH2-B3 discipline).
      const rawBad = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: `pay_rzp_bad_${RUN}`, order_id: row.providerOrderId, amount: 1, currency: 'INR', status: 'captured' } } },
      })
      const bad = await liveFetch(`${BASE}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RZP_SECRET).update(rawBad).digest('hex'), 'x-razorpay-event-id': `evt-rzp-bad-${RUN}` },
        body: rawBad,
      }, { deadlineMs: 40_000 })
      expect(bad.status).toBe(200) // acked (the error is recorded on the event row)
      expect((await db.subscriptionOrder.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING') // NOT settled

      // The CORRECT signed capture settles the order exactly once.
      const raw = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: `pay_rzp_${RUN}`, order_id: row.providerOrderId, amount: Math.round(ob.order.amount * 100), currency: 'INR', status: 'captured' } } },
      })
      const wh = await liveFetch(`${BASE}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RZP_SECRET).update(raw).digest('hex'), 'x-razorpay-event-id': `evt-rzp-${RUN}` },
        body: raw,
      }, { deadlineMs: 40_000 })
      expect(wh.status).toBe(200)
      const settled = await db.subscriptionOrder.findUniqueOrThrow({ where: { id: row.id } })
      expect(settled.status).toBe('PAID')
      expect(settled.providerPaymentId).toBe(`pay_rzp_${RUN}`)
      expect(await db.studentEntitlement.count({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(1)

      // The same event replayed is a duplicate ack — nothing double-settles.
      const replay = await liveFetch(`${BASE}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RZP_SECRET).update(raw).digest('hex'), 'x-razorpay-event-id': `evt-rzp-${RUN}` },
        body: raw,
      }, { deadlineMs: 40_000 })
      const rb = await body(replay)
      expect(replay.status).toBe(200)
      expect(rb?.duplicate ?? rb?.data?.duplicate).toBeTruthy()
      expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })).toBe(1)
    } finally {
      await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
    }
  }, T)

  test('plan PATCH: a solo allowOnline change takes effect (merge no longer keyed off allowOffline)', async () => {
    const planCode = `TEST-MERGE-${RUN}`
    const created = await asPlatform(rootToken, '/api/platform/subscriptions/plans', {
      method: 'POST',
      body: JSON.stringify({ code: planCode, name: 'Merge Guard Plan', scope: 'STUDENT', interval: 'ANNUAL', pricePerStudent: 300, currency: 'INR' }),
    })
    expect(created.status).toBe(200)
    const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: planCode } })

    const patch = await asPlatform(rootToken, `/api/platform/subscriptions/plans/${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ allowOnline: false }),
    })
    expect(patch.status).toBe(200)
    const after = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: planCode } })
    expect(after.allowOnline).toBe(false) // previously silently ignored
    expect(after.allowOffline).toBe(true) // untouched
  }, T)

  test('plan PATCH edit flow: name + graceDays + price persist (registry + audit trail), then values are restored', async () => {
    // 2026-10-16 fix-batch regression (FIX 3 — the PlanEditDialog
    // backend contract). The dialog PATCHes an ACTIVE plan with the
    // resolved editable fields; this pins the multi-field edit end to
    // end on a plan the test itself owns (never the QATESTPLAN row
    // other flows depend on): PATCH → registry shows the persisted
    // values → platform.billing.plan_updated lands in the audit trail
    // → a second PATCH restores the original posture.
    const planCode = `EDITTEST-${RUN}`
    const created = await asPlatform(rootToken, '/api/platform/subscriptions/plans', {
      method: 'POST',
      body: JSON.stringify({ code: planCode, name: 'Edit Flow Plan', scope: 'SCHOOL', interval: 'MONTHLY', priceMonthly: 500, currency: 'INR' }),
    })
    expect(created.status).toBe(200)
    const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: planCode } })
    expect(plan.status).toBe('ACTIVE')
    // afterAll deletes every plan whose code contains RUN — the row is
    // suite-owned regardless of any assertion failure below.

    // EDIT: name + graceDays + the interval price in one PATCH (the
    // exact field trio the edit dialog's happy path sends).
    const edited = await asPlatform(rootToken, `/api/platform/subscriptions/plans/${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Edit Flow Plan Edited', graceDays: 30, priceMonthly: 600 }),
    })
    expect(edited.status).toBe(200)

    // The REGISTRY (what the plans table renders) persists all three.
    const registry = await asPlatform(rootToken, '/api/platform/subscriptions/plans')
    expect(registry.status).toBe(200)
    const plans = ((await body(registry))?.data?.plans ?? []) as Array<{
      code: string
      name: string
      graceDays: number
      priceMonthly: number | null
    }>
    const row = plans.find((p) => p.code === planCode)
    expect(row).toBeDefined()
    expect(row?.name).toBe('Edit Flow Plan Edited')
    expect(row?.graceDays).toBe(30)
    expect(Number(row?.priceMonthly)).toBe(600)

    // The AUDIT TRAIL records the edit (the route awaits the
    // fire-and-forget write before its 200, so the row is there).
    const audits = await db.platformAuditLog.findMany({
      where: { action: 'platform.billing.plan_updated', targetId: plan.id },
    })
    expect(audits.length).toBeGreaterThanOrEqual(1)

    // RESTORE the original values (the registry posture other flows
    // see is never disturbed by the regression).
    const restored = await asPlatform(rootToken, `/api/platform/subscriptions/plans/${plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Edit Flow Plan', graceDays: 14, priceMonthly: 500 }),
    })
    expect(restored.status).toBe(200)
    const afterRestore = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: planCode } })
    expect(afterRestore.name).toBe('Edit Flow Plan')
    expect(afterRestore.graceDays).toBe(14)
    expect(Number(afterRestore.priceMonthly)).toBe(500)
  }, T)

  test('billingModel switch is ATOMIC with the payment (a failing request never flips the tenant model)', async () => {
    const before = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    const modelBefore = before?.billingModel ?? 'SCHOOL_WIDE'

    // Failing plan-driven payment (unknown planCode) WITH a model change.
    const fail = await asPlatform(rootToken, `/api/platform/schools/${schoolA.id}/subscription/payments`, {
      method: 'POST',
      body: JSON.stringify({
        planCode: `NO-SUCH-PLAN-${RUN}`,
        amount: 2000,
        mode: 'CASH',
        paymentDate: new Date().toISOString(),
        billingModel: 'PER_STUDENT',
      }),
    })
    expect(fail.status).toBeGreaterThanOrEqual(400)

    const afterRow = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    expect(afterRow?.billingModel ?? 'SCHOOL_WIDE').toBe(modelBefore) // unchanged
  }, T)
})

// ── SUSPENSION FREEZE REGRESSIONS (PR-30 final review) ───────────────────
// The approved product rule, pinned end-to-end:
//   1. A suspended student CAN complete a payment — but a payment NEVER
//      lifts an admin suspension (no live row is minted; the single
//      entitlement row stays SUSPENDED; business APIs stay locked).
//   2. Validity purchased during suspension is NOT consumed: months BANK
//      onto the frozen window (validityEnd stacks in WINDOW time), and
//      start counting ONLY at the explicit authorized reactivation,
//      which re-anchors the remaining window at that moment.
//   3. Dated grants onto a suspended entitlement are refused (explicit
//      reactivation comes first); a code claim while suspended banks.

describe('SUBSCRIPTION · suspension freeze regressions', () => {
  const DAY = 86_400_000
  /** Directly plant a deterministic SUSPENDED entitlement row. */
  async function plantSuspended(studentId: string, label: string, opts: { startOffsetDays: number; endOffsetDays: number; suspendedOffsetDays: number }) {
    const now = Date.now()
    return db.studentEntitlement.create({
      data: {
        schoolId: schoolA.id,
        studentId,
        status: 'SUSPENDED',
        validityStart: new Date(now + opts.startOffsetDays * DAY),
        validityEnd: new Date(now + opts.endOffsetDays * DAY),
        source: 'MANUAL',
        suspendedAt: new Date(now + opts.suspendedOffsetDays * DAY),
        suspendReason: `suite ${RUN} ${label}`,
      },
    })
  }

  test('payment while suspended NEVER lifts the suspension — it BANKS (single row, no live row, business stays locked)', async () => {
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'PER_STUDENT' } })
    const st = await makeTestStudent(schoolA.id, 'frz-pay')
    try {
      // Base live entitlement (operator complimentary assignment).
      const assign = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'COMPLIMENTARY', amount: 0, paymentDate: new Date().toISOString(), validityMonths: 12, notes: `suite ${RUN} freeze base grant` }),
      })
      expect(assign.status).toBe(200)
      const entId = ((await body(assign))?.data?.entitlement as { id: string }).id
      const before = await db.studentEntitlement.findUniqueOrThrow({ where: { id: entId } })
      expect(before.status).toBe('ACTIVE')

      // Admin suspension — then the business API locks.
      const suspend = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'suspend', reason: `suite ${RUN} admin suspension for freeze test` }),
      })
      expect(suspend.status).toBe(200)
      expect((await asSchool(st, '/api/student/dashboard')).status).toBe(403)

      // The suspended student completes an ONLINE payment (sandbox lane).
      const order = await asSchool(st, '/api/subscription/student/order', {
        method: 'POST',
        body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
      }, nextIp())
      expect(order.status).toBe(200)
      const orderNo = ((await body(order))?.data?.order as { orderNo: string }).orderNo
      const orderRow = await db.subscriptionOrder.findUniqueOrThrow({ where: { orderNo } })

      const verify = await asSchool(st, '/api/subscription/student/verify', {
        method: 'POST',
        body: JSON.stringify({ orderNo, sandbox: true }),
      }, nextIp())
      expect(verify.status).toBe(200)
      const vb = await body(verify)
      // THE rule: the settled payment reports SUSPENDED — never ACTIVE.
      expect(vb?.data?.statusAfter).toBe('SUSPENDED')
      expect(vb?.data?.alreadyPaid).toBe(false)
      expect(String(vb?.data?.message)).toContain('suspended')

      // Still exactly ONE entitlement row — the suspended one; no live row
      // was minted (the payment did not unsuspend via a second row).
      const rows = await db.studentEntitlement.findMany({ where: { studentId: st.studentId } })
      expect(rows.length).toBe(1)
      expect(rows[0].status).toBe('SUSPENDED')
      expect(rows[0].id).toBe(entId)

      // The financial rows exist (the base complimentary grant + the settled
      // ONLINE payment — recorded VERIFIED, immutable).
      expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })).toBe(2)
      expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId, mode: 'ONLINE_PAYMENT', verification: 'VERIFIED' } })).toBe(1)

      // Business APIs STAY locked (payment never lifts the suspension).
      expect((await asSchool(st, '/api/student/dashboard')).status).toBe(403)
      // Status surface tells the student the truth.
      const status = await asSchool(st, '/api/subscription/student')
      const sb = (await body(status))?.data
      expect(sb?.entitlement?.state).toBe('SUSPENDED')

      // BANKING math: end = addMonths(before.end, order.validityMonths) —
      // window-time stacking, NOT anchored at payment time.
      expect(rows[0].validityEnd.getTime()).toBeGreaterThan(before.validityEnd.getTime())
      expect(Math.abs(rows[0].validityEnd.getTime() - addMonths(before.validityEnd, orderRow.validityMonths).getTime())).toBeLessThan(2_000)
    } finally {
      await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
    }
  }, T)

  test('reactivation starts the banked clock: the remaining window re-anchors at the reactivation moment', async () => {
    const st = await makeTestStudent(schoolA.id, 'frz-resume')
    // Deterministic frozen row: started 30d ago, ends in 60d, suspended 10d ago.
    const now = Date.now()
    const start = new Date(now - 30 * DAY)
    const end = new Date(now + 60 * DAY)
    const suspendedAt = new Date(now - 10 * DAY)
    const ent = await db.studentEntitlement.create({
      data: { schoolId: schoolA.id, studentId: st.studentId, status: 'SUSPENDED', validityStart: start, validityEnd: end, source: 'MANUAL', suspendedAt, suspendReason: `suite ${RUN} resume base` },
    })

    // A payment BANKS 12 months during the suspension (operator offline).
    const pay = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, notes: `suite ${RUN} banked payment` }),
    })
    expect(pay.status).toBe(200)
    expect((await body(pay))?.data?.entitlement?.statusAfter).toBe('SUSPENDED')
    const banked = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
    expect(banked.status).toBe('SUSPENDED')
    // Window-time stacking: banked end = addMonths(end, 12) — NOT from now.
    expect(Math.abs(banked.validityEnd.getTime() - addMonths(end, 12).getTime())).toBeLessThan(2_000)

    // Explicit authorized reactivation.
    const reactivate = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reactivate', reason: `suite ${RUN} authorized reactivation` }),
    })
    expect(reactivate.status).toBe(200)
    expect((await body(reactivate))?.data?.status).toBe('ACTIVE')

    const resumed = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
    expect(resumed.status).toBe('ACTIVE')
    expect(resumed.suspendedAt).toBeNull()
    expect(resumed.suspendReason).toBeNull()

    // FROZEN-CLOCK RESUME: remaining = bankedEnd − max(start, suspendedAt)
    //   = (end+12m) − suspendedAt  → the 20 consumed days are NOT refunded;
    //   the 70 unconsumed days + the banked 12 months start counting NOW.
    const frozenFrom = new Date(Math.max(start.getTime(), suspendedAt.getTime()))
    const expectedRemainingMs = addMonths(end, 12).getTime() - frozenFrom.getTime()
    const after = Date.now()
    expect(Math.abs(resumed.validityStart.getTime() - after)).toBeLessThan(120_000)
    expect(Math.abs(resumed.validityEnd.getTime() - (after + expectedRemainingMs))).toBeLessThan(120_000)
    // Purchased-during-suspension months are not consumed by suspension
    // time: the resumed window is ≥ 12 months longer than the 70-day
    // pre-existing remainder would alone give.
    expect(resumed.validityEnd.getTime() - resumed.validityStart.getTime()).toBeGreaterThan((70 + 360) * DAY * 0.99)
  }, T)

  test('reactivation with no remaining window is refused honestly (renewal required)', async () => {
    const st = await makeTestStudent(schoolA.id, 'frz-empty')
    const ent = await plantSuspended(st.studentId, 'empty', { startOffsetDays: -400, endOffsetDays: -40, suspendedOffsetDays: -30 })
    const r = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reactivate', reason: `suite ${RUN} empty reactivation attempt` }),
    })
    expect(r.status).toBe(409)
    const row = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
    expect(row.status).toBe('SUSPENDED') // untouched
  }, T)

  test('a DATED grant onto a suspended entitlement is refused (reactivation comes first)', async () => {
    const st = await makeTestStudent(schoolA.id, 'frz-dated')
    await plantSuspended(st.studentId, 'dated', { startOffsetDays: -10, endOffsetDays: 80, suspendedOffsetDays: -5 })
    const dated = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({
        planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(),
        validityMonths: 12, validityStart: new Date(Date.now() + 5 * DAY).toISOString(), notes: `suite ${RUN} dated grant attempt`,
      }),
    })
    expect(dated.status).toBe(409)
    const rows = await db.studentEntitlement.findMany({ where: { studentId: st.studentId } })
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('SUSPENDED')
  }, T)

  test('a CODE claim while suspended BANKS (never unsuspends); reactivation then delivers the banked period', async () => {
    const st = await makeTestStudent(schoolA.id, 'frz-claim')
    const ent = await plantSuspended(st.studentId, 'claim-base', { startOffsetDays: -30, endOffsetDays: 90, suspendedOffsetDays: -10 })

    // Operator records the offline payment and issues the code.
    const issue = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, mode: 'CASH', amount: 500, paymentDate: new Date().toISOString(), validityMonths: 12, issueActivationCode: true, notes: `suite ${RUN} claim bank` }),
    })
    expect(issue.status).toBe(200)
    const code = ((await body(issue))?.data?.activationCode as { code: string }).code

    // The suspended student claims — the claim SUCCEEDS (money was paid)
    // but BANKS: status stays SUSPENDED, no live row minted.
    const claim = await asSchool(st, '/api/subscription/student/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(claim.status).toBe(200)
    const cb = await body(claim)
    expect(cb?.data?.entitlement?.status).toBe('SUSPENDED')
    expect(String(cb?.data?.message)).toContain('suspended')

    const afterClaim = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
    expect(afterClaim.status).toBe('SUSPENDED')
    expect(Math.abs(afterClaim.validityEnd.getTime() - addMonths(ent.validityEnd, 12).getTime())).toBeLessThan(2_000)
    expect(await db.studentEntitlement.count({ where: { studentId: st.studentId, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(0)

    // Explicit reactivation delivers the banked period (starts now).
    const reactivate = await asPlatform(rootToken, `/api/platform/students/${st.studentId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reactivate', reason: `suite ${RUN} reactivation after banked claim` }),
    })
    expect(reactivate.status).toBe(200)
    const resumed = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
    expect(resumed.status).toBe('ACTIVE')
    expect(resumed.validityEnd.getTime() - resumed.validityStart.getTime()).toBeGreaterThan(360 * DAY)
  }, T)

  test('two concurrent payments during suspension both BANK (stacked window, single suspended row)', async () => {
    await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'PER_STUDENT' } })
    const st = await makeTestStudent(schoolA.id, 'frz-race')
    try {
      const ent = await plantSuspended(st.studentId, 'race-base', { startOffsetDays: -30, endOffsetDays: 60, suspendedOffsetDays: -5 })

      const mkOrder = async () => {
        const order = await asSchool(st, '/api/subscription/student/order', {
          method: 'POST',
          body: JSON.stringify({ planCode: `TEST-STU-${RUN}`, sandbox: true }),
        }, nextIp())
        return ((await body(order))?.data?.order as { orderNo: string }).orderNo
      }
      const [orderNoA, orderNoB] = await Promise.all([mkOrder(), mkOrder()])

      const settle = (orderNo: string) => asSchool(st, '/api/subscription/student/verify', {
        method: 'POST',
        body: JSON.stringify({ orderNo, sandbox: true }),
      }, nextIp())
      const [a, b] = await Promise.all([settle(orderNoA), settle(orderNoB)])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect((await body(a))?.data?.statusAfter).toBe('SUSPENDED')
      expect((await body(b))?.data?.statusAfter).toBe('SUSPENDED')

      // BOTH payments banked: the window stacks 24 months (2 × 12), one
      // suspended row, two financial rows — never a lost payment.
      const row = await db.studentEntitlement.findUniqueOrThrow({ where: { id: ent.id } })
      expect(row.status).toBe('SUSPENDED')
      expect(Math.abs(row.validityEnd.getTime() - addMonths(ent.validityEnd, 24).getTime())).toBeLessThan(2_000)
      expect(await db.studentEntitlement.count({ where: { studentId: st.studentId } })).toBe(1)
      expect(await db.studentSubscriptionPayment.count({ where: { studentId: st.studentId } })).toBe(2)
    } finally {
      await db.schoolSubscription.update({ where: { schoolId: schoolA.id }, data: { billingModel: 'SCHOOL_WIDE' } })
    }
  }, T)
})
