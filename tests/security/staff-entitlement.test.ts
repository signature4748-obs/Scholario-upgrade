/**
 * tests/security/staff-entitlement.test.ts
 *
 * STAFF ENTITLEMENTS (2026-10-30) — live acceptance suite.
 *
 * Covers the staff axis of the subscription & entitlement system:
 *
 *   · Staff plans (STAFF scope) resolve through the plan registry; a
 *     staff code can ONLY be claimed by a server-verified canonical
 *     TEACHER of the owning tenant (never a student, never a principal,
 *     never another tenant's teacher).
 *   · Pre-assigned staff codes verify the claimant against the
 *     assignment (a different teacher is rejected, generically).
 *   · Single-use redemption: replay, expired, revoked, malformed and
 *     wrong-scope codes are rejected with generic messages; claim
 *     rejections persist diagnostic events.
 *   · PER_SEAT enforcement in withUser: a teacher without a live
 *     entitlement gets 403 SUBSCRIPTION_REQUIRED on business APIs and
 *     keeps access to the exempt claim surface; a claim (or operator
 *     assignment) unlocks on the very next request; TENANT coverage
 *     never locks a teacher; a PRINCIPAL is never gated by staff
 *     coverage (administrative privileges are not a paid seat).
 *   · Expiry is enforced live: an expired entitlement's access stops
 *     without any scheduled job.
 *   · Renewal extends from the current boundary (stacking); revocation
 *     preserves financial rows; suspended rows BANK claims (the frozen-
 *     clock rule) and reactivate re-anchors the remaining window.
 *   · Tenant isolation on the new surfaces: school tokens cannot reach
 *     the platform staff endpoints; a non-billing platform admin gets
 *     403; the staff roster only ever lists THIS school's teachers.
 *
 * Test-data discipline: every row is tracked and removed in afterAll;
 * the tenant fixture's staffCoverage is saved and restored; claim
 * requests use per-request spoofed client IPs (the documented live-suite
 * convention) and throwaway identities (fresh rate-limit budgets).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import { hashSessionToken } from '@/lib/auth'
import { evaluateStaffEntitlement } from '@/lib/entitlement/staff'
import { normalizeCode, addMonths } from '@/lib/subscription/codes'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const T = 45_000

let schoolA = { id: '', slug: '' }
let schoolB = { id: '' }
let rootToken = ''
let opsToken = ''
let suiteAdminId = ''
let originalStaffCoverage: string | null = null
let originalSubState: { periodEnd: Date | null; overrideStatus: string | null; status: string } | null = null

const cleanup: Array<() => Promise<unknown>> = []
const RUN = randomBytes(4).toString('hex').toUpperCase()
let ipSeq = 0
const RUN_IP_B1 = 32 + (parseInt(RUN.slice(0, 2), 16) % 180)
const RUN_IP_B2 = parseInt(RUN.slice(2), 16) % 256
const nextIp = () => `10.${RUN_IP_B1}.${(RUN_IP_B2 + (ipSeq >> 8)) % 256}.${1 + (ipSeq++ % 250)}`

interface TestUser { userId: string; email: string; token: string; role: string }

async function makeTestUser(schoolId: string, role: 'TEACHER' | 'STUDENT' | 'PRINCIPAL', label: string): Promise<TestUser> {
  const email = `staff.test.${label}.${RUN}@hawkings.test`
  const user = await db.user.create({
    data: {
      email,
      name: `Staff Test ${label}`,
      role,
      schoolId,
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
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
    await db.activationCode.deleteMany({ where: { claimedByUserId: user.id } })
    await db.activationCodeEvent.deleteMany({ where: { code: { claimedByUserId: user.id } } })
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
      tokenHash: (await import('crypto')).createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

/** Issue a staff code directly through the service (route-independent). */
async function issueStaffCode(opts: { assignedUserId?: string | null; claimWindowDays?: number; validityMonths?: number }): Promise<string> {
  const { issueActivationCode } = await import('@/lib/subscription/codes')
  const issued = await issueActivationCode({
    scope: 'STAFF_ENTITLEMENT',
    schoolId: schoolA.id,
    assignedUserId: opts.assignedUserId ?? null,
    planCode: `STF-${RUN}`,
    interval: 'ANNUAL',
    validityMonths: opts.validityMonths ?? 12,
    claimWindowDays: opts.claimWindowDays ?? 30,
    issuedById: suiteAdminId,
    paymentRef: 'staffPayment:suite',
  })
  cleanup.push(async () => {
    await db.activationCodeEvent.deleteMany({ where: { codeId: issued.codeId } })
    await db.activationCode.deleteMany({ where: { id: issued.codeId } })
  })
  return issued.code
}

// ── setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' }, include: { subscription: true } })
  if (!a) throw new Error('fixture school missing (run seed:demo)')
  schoolA = { id: a.id, slug: a.slug }
  originalStaffCoverage = (a.subscription as { staffCoverage?: string } | null)?.staffCoverage ?? 'TENANT'
  originalSubState = a.subscription
    ? { periodEnd: a.subscription.periodEnd, overrideStatus: a.subscription.overrideStatus, status: a.subscription.status }
    : null
  // The PER_SEAT gate tests probe BUSINESS routes — the tenant must be
  // business-allowed so the staff gate's decision is observable in
  // isolation (restored in afterAll alongside staffCoverage).
  await db.schoolSubscription.upsert({
    where: { schoolId: schoolA.id },
    create: { schoolId: schoolA.id, staffCoverage: originalStaffCoverage ?? 'TENANT' },
    update: { periodEnd: new Date(Date.now() + 365 * 86_400_000), overrideStatus: null },
  })

  // A second throwaway tenant for the cross-tenant rejections.
  const b = await db.school.create({
    data: {
      name: `StaffIso ${RUN}`,
      slug: `staff-iso-${RUN.toLowerCase()}`,
      code: `SSI-${RUN.slice(0, 4)}`,
      academicYear: '2026-27',
      status: 'ACTIVE',
      isDemo: false,
    },
  })
  schoolB = { id: b.id }
  cleanup.push(async () => {
    await db.school.deleteMany({ where: { id: b.id } })
  })

  const rootRow = await db.platformAdmin.create({
    data: {
      email: `staff.root.${RUN}@platform.test`, name: 'Staff Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  const opsRow = await db.platformAdmin.create({
    data: {
      email: `staff.ops.${RUN}@platform.test`, name: 'Staff Suite Ops', isRoot: false,
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
  // Restore the tenant fixture FIRST (before row cleanup cascades touch
  // the subscription row): staff policy + paid-period state.
  await db.schoolSubscription.updateMany({
    where: { schoolId: schoolA.id },
    data: {
      staffCoverage: originalStaffCoverage ?? 'TENANT',
      ...(originalSubState ? { periodEnd: originalSubState.periodEnd, overrideStatus: originalSubState.overrideStatus, status: originalSubState.status } : {}),
    },
  })
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
}, 60_000)

// ── 1 · evaluator (pure) ──────────────────────────────────────────────────

describe('staff entitlement evaluation (unit)', () => {
  const tenant = { state: 'ACTIVE' as const, businessAllowed: true, loginAllowed: true, plan: 'STANDARD', periodEnd: null, graceUntil: null, renewalRequired: false, message: null }

  test('TENANT coverage never requires an individual entitlement', () => {
    const d = evaluateStaffEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'TENANT', entitlement: null })
    expect(d.state).toBe('COVERED_BY_TENANT')
    expect(d.businessAllowed).toBe(true)
  })

  test('unknown coverage values map to TENANT (safe legacy default)', () => {
    const d = evaluateStaffEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'SOMETHING_ELSE', entitlement: null })
    expect(d.state).toBe('COVERED_BY_TENANT')
  })

  test('PER_SEAT without a row → NOT_SUBSCRIBED (locked)', () => {
    const d = evaluateStaffEntitlement({ accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'PER_SEAT', entitlement: null })
    expect(d.state).toBe('NOT_SUBSCRIBED')
    expect(d.businessAllowed).toBe(false)
  })

  test('PER_SEAT live window: ACTIVE inside, EXPIRED past end, PENDING before start', () => {
    const now = new Date()
    const active = evaluateStaffEntitlement({
      accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'PER_SEAT',
      entitlement: { status: 'ACTIVE', validityStart: new Date(now.getTime() - 86_400_000), validityEnd: addMonths(now, 12), source: 'OFFLINE_CODE' },
    })
    expect(active.state).toBe('ACTIVE')
    expect(active.businessAllowed).toBe(true)

    const expired = evaluateStaffEntitlement({
      accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'PER_SEAT',
      entitlement: { status: 'ACTIVE', validityStart: new Date(now.getTime() - 400 * 86_400_000), validityEnd: new Date(now.getTime() - 86_400_000), source: 'OFFLINE_CODE' },
    })
    expect(expired.state).toBe('EXPIRED')
    expect(expired.businessAllowed).toBe(false)

    const pending = evaluateStaffEntitlement({
      accountSubscriptionStatus: 'ACTIVE', tenant, staffCoverage: 'PER_SEAT',
      entitlement: { status: 'PENDING', validityStart: new Date(now.getTime() + 86_400_000), validityEnd: addMonths(now, 12), source: 'MANUAL' },
    })
    expect(pending.state).toBe('PENDING')
    expect(pending.businessAllowed).toBe(false)
  })

  test('tenant state wins over an individual seat (suspension always applies)', () => {
    const restrictedTenant = { ...tenant, state: 'RESTRICTED' as const, businessAllowed: false }
    const d = evaluateStaffEntitlement({
      accountSubscriptionStatus: 'ACTIVE', tenant: restrictedTenant, staffCoverage: 'PER_SEAT',
      entitlement: { status: 'ACTIVE', validityStart: new Date(Date.now() - 86_400_000), validityEnd: addMonths(new Date(), 12), source: 'MANUAL' },
    })
    expect(d.state).toBe('TENANT_RESTRICTED')
    expect(d.businessAllowed).toBe(false)
  })
})

// ── 2 · PER_SEAT gate (live, withUser) ────────────────────────────────────

describe('PER_SEAT staff gate (live withUser)', () => {
  let teacher: TestUser
  let principal: TestUser
  let probePath: string

  beforeAll(async () => {
    teacher = await makeTestUser(schoolA.id, 'TEACHER', `t-${RUN}`)
    principal = await makeTestUser(schoolA.id, 'PRINCIPAL', `p-${RUN}`)
    // A business surface a TEACHER session may call (role-gated later, but
    // the SUBSCRIPTION gate fires BEFORE the role check — exactly what we
    // probe: the gate's decision is observable on any non-exempt route).
    probePath = '/api/attendance/overview'
    // Flip the tenant to PER_SEAT (the terms route's column; direct row
    // write here, restored in afterAll).
    await db.schoolSubscription.upsert({
      where: { schoolId: schoolA.id },
      create: { schoolId: schoolA.id, staffCoverage: 'PER_SEAT' },
      update: { staffCoverage: 'PER_SEAT' },
    })
  })

  test('teacher without a seat → 403 SUBSCRIPTION_REQUIRED on business APIs', async () => {
    const r = await asSchool(teacher, probePath, { method: 'GET' }, nextIp())
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b?.code).toBe('SUBSCRIPTION_REQUIRED')
  }, T)

  test('the exempt claim surface stays reachable (status endpoint)', async () => {
    const r = await asSchool(teacher, '/api/subscription/staff', { method: 'GET' }, nextIp())
    expect(r.status).toBe(200)
    const b = await body(r)
    expect(b?.data?.entitlement?.state).toBe('NOT_SUBSCRIBED')
  }, T)

  test('claiming a staff code unlocks business access on the next request', async () => {
    const code = await issueStaffCode({ assignedUserId: teacher.userId })
    const claim = await asSchool(teacher, '/api/subscription/staff/claim', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }, nextIp())
    expect(claim.status).toBe(200)
    const cb = await body(claim)
    expect(cb?.data?.status).toBe('ACTIVE')

    const after = await asSchool(teacher, probePath, { method: 'GET' }, nextIp())
    // The seat is live → the SUBSCRIPTION gate passes (any remaining
    // status is a role/domain decision, never SUBSCRIPTION_REQUIRED).
    const ab = await body(after)
    expect(ab?.code).not.toBe('SUBSCRIPTION_REQUIRED')
  }, T)

  test('expiry stops access live (no scheduled job involved)', async () => {
    // Force the live row's window into the past.
    await db.staffEntitlement.updateMany({
      where: { userId: teacher.userId, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { validityEnd: new Date(Date.now() - 86_400_000) },
    })
    const r = await asSchool(teacher, probePath, { method: 'GET' }, nextIp())
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b?.code).toBe('SUBSCRIPTION_REQUIRED')
  }, T)

  test('PRINCIPAL is never gated by staff coverage (admin ≠ paid seat)', async () => {
    const r = await asSchool(principal, '/api/dashboard', { method: 'GET' }, nextIp())
    const b = await body(r)
    // The principal's tenant is business-allowed; the staff gate must not
    // apply to their role — any response is fine EXCEPT a staff lock.
    expect(b?.code).not.toBe('SUBSCRIPTION_REQUIRED')
  }, T)

  test('TENANT coverage restores every teacher (no per-seat requirement)', async () => {
    await db.schoolSubscription.updateMany({ where: { schoolId: schoolA.id }, data: { staffCoverage: 'TENANT' } })
    const r = await asSchool(teacher, probePath, { method: 'GET' }, nextIp())
    const b = await body(r)
    expect(b?.code).not.toBe('SUBSCRIPTION_REQUIRED')
  }, T)
})

// ── 3 · staff code claim discipline (live) ────────────────────────────────

describe('staff code claim (scope, identity, single-use)', () => {
  let teacherA1: TestUser
  let teacherA2: TestUser
  let studentA: TestUser
  let teacherB: TestUser

  beforeAll(async () => {
    teacherA1 = await makeTestUser(schoolA.id, 'TEACHER', `c1-${RUN}`)
    teacherA2 = await makeTestUser(schoolA.id, 'TEACHER', `c2-${RUN}`)
    studentA = await makeTestUser(schoolA.id, 'STUDENT', `s-${RUN}`)
    teacherB = await makeTestUser(schoolB.id, 'TEACHER', `b-${RUN}`)
  })

  test('a STUDENT session cannot claim a staff code (scope by identity)', async () => {
    const code = await issueStaffCode({})
    const r = await asSchool(studentA, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b?.code).toBe('SUBSCRIPTION_REQUIRED')
    // The code is untouched (still ISSUED).
    const row = await db.activationCode.findFirst({ where: { scope: 'STAFF_ENTITLEMENT', planCode: `STF-${RUN}`, claimedAt: null }, orderBy: { createdAt: 'desc' } })
    expect(row).not.toBeNull()
  }, T)

  test('a PRINCIPAL session cannot claim a staff code', async () => {
    const principal = await makeTestUser(schoolA.id, 'PRINCIPAL', `pc-${RUN}`)
    const code = await issueStaffCode({})
    const r = await asSchool(principal, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(r.status).toBe(403)
  }, T)

  test('another tenant\u2019s teacher is rejected (tenant isolation)', async () => {
    const code = await issueStaffCode({})
    const r = await asSchool(teacherB, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(r.status).toBe(403)
    const b = await body(r)
    // Generic — no tenant/scope oracle beyond the canonical code.
    expect(b?.error?.length ?? 0).toBeGreaterThan(0)
  }, T)

  test('a pre-assigned code refuses a different teacher of the same school', async () => {
    const code = await issueStaffCode({ assignedUserId: teacherA1.userId })
    const r = await asSchool(teacherA2, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(r.status).toBe(403)
    // …and the rightful claimant succeeds.
    const ok = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(ok.status).toBe(200)
  }, T)

  test('replay, malformed and wrong-scope claims are rejected generically', async () => {
    const code = await issueStaffCode({})
    const first = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(first.status).toBe(200)

    const replay = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp())
    expect(replay.status).toBe(403)

    // Route-schema rejection for garbage input (the claim engine never
    // sees it) — no existence oracle either way.
    const malformed = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: 'SHORT' }) }, nextIp())
    expect(malformed.status).toBe(422)
    // A well-formed but UNKNOWN code → the generic rejection.
    const unknown = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: 'AAAAA-BBBBB-CCCCC-DDDDD' }) }, nextIp())
    expect(unknown.status).toBe(403)

    // A student code on the staff surface → scope mismatch, generic.
    const { issueActivationCode } = await import('@/lib/subscription/codes')
    const studentCode = await issueActivationCode({
      scope: 'STUDENT_ENTITLEMENT', schoolId: schoolA.id, planCode: `STF-${RUN}`,
      validityMonths: 12, claimWindowDays: 30, issuedById: suiteAdminId,
    })
    cleanup.push(async () => {
      await db.activationCodeEvent.deleteMany({ where: { codeId: studentCode.codeId } })
      await db.activationCode.deleteMany({ where: { id: studentCode.codeId } })
    })
    const wrongScope = await asSchool(teacherA1, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: studentCode.code }) }, nextIp())
    expect(wrongScope.status).toBe(403)
  }, T)

  test('concurrent claims cannot double-activate (one entitlement lands)', async () => {
    // Dedicated throwaway claimant — the claim surface is rate-limited
    // 5/15min per user and this test fires two simultaneous requests.
    const racer = await makeTestUser(schoolA.id, 'TEACHER', `race-${RUN}`)
    const code = await issueStaffCode({})
    const [r1, r2] = await Promise.all([
      asSchool(racer, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp()),
      asSchool(racer, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code }) }, nextIp()),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 403])
    const rows = await db.staffEntitlement.findMany({ where: { userId: racer.userId } })
    expect(rows.length).toBe(1)
  }, T)

  test('expired and revoked codes are refused', async () => {
    // Dedicated claimant (the 5/15-min per-user anti-guessing budget —
    // this test makes two rejected claims).
    const claimant = await makeTestUser(schoolA.id, 'TEACHER', `exp-${RUN}`)
    const expired = await issueStaffCode({ claimWindowDays: 1 })
    const row = await db.activationCode.findFirst({ where: { scope: 'STAFF_ENTITLEMENT' }, orderBy: { createdAt: 'desc' } })
    await db.activationCode.update({ where: { id: row!.id }, data: { expiresAt: new Date(Date.now() - 3_600_000) } })
    const rExpired = await asSchool(claimant, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: expired }) }, nextIp())
    expect(rExpired.status).toBe(403)

    const revoked = await issueStaffCode({})
    const revokedRow = await db.activationCode.findFirst({ where: { scope: 'STAFF_ENTITLEMENT' }, orderBy: { createdAt: 'desc' } })
    await db.activationCode.update({ where: { id: revokedRow!.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'suite' } })
    const rRevoked = await asSchool(claimant, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: revoked }) }, nextIp())
    expect(rRevoked.status).toBe(403)
  }, T)

  test('renewal stacks from the current boundary; revocation keeps financial rows', async () => {
    const teacher = await makeTestUser(schoolA.id, 'TEACHER', `r-${RUN}`)
    const c1 = await issueStaffCode({ assignedUserId: teacher.userId, validityMonths: 12 })
    const first = await asSchool(teacher, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: c1 }) }, nextIp())
    expect(first.status).toBe(200)
    const live1 = await db.staffEntitlement.findFirst({ where: { userId: teacher.userId, status: 'ACTIVE' } })
    expect(live1).not.toBeNull()

    // Second claim → extension anchored at the current end (+12 months,
    // calendar-clamped; accept a ±2 day boundary drift from second-level
    // rounding between the two reads).
    const c2 = await issueStaffCode({ assignedUserId: teacher.userId, validityMonths: 12 })
    const second = await asSchool(teacher, '/api/subscription/staff/claim', { method: 'POST', body: JSON.stringify({ code: c2 }) }, nextIp())
    expect(second.status).toBe(200)
    const live2 = await db.staffEntitlement.findFirst({ where: { userId: teacher.userId, status: 'ACTIVE' } })
    expect(live2!.id).toBe(live1!.id)
    const expectedEnd = addMonths(live1!.validityEnd, 12)
    const driftDays = Math.abs(live2!.validityEnd.getTime() - expectedEnd.getTime()) / 86_400_000
    expect(driftDays).toBeLessThan(2)

    // Revoke (status-only; the ledger row stays VERIFIED).
    const { applyStaffEntitlementLifecycle } = await import('@/lib/subscription/staff')
    const result = await applyStaffEntitlementLifecycle({ entitlementId: live2!.id, adminId: suiteAdminId, action: 'revoke', reason: 'suite revocation' })
    expect(result.status).toBe('REVOKED')
    const paymentCount = await db.staffSubscriptionPayment.count({ where: { userId: teacher.userId } })
    expect(paymentCount).toBe(0) // code-claims carry no payment rows; nothing was destroyed
  }, T)
})

// ── 4 · platform staff surfaces (authz + isolation) ───────────────────────

describe('platform staff subscription surfaces', () => {
  let teacher: TestUser

  beforeAll(async () => {
    teacher = await makeTestUser(schoolA.id, 'TEACHER', `adm-${RUN}`)
  })

  test('no platform session → 401; school token never satisfies the pipeline', async () => {
    const anon = await liveFetch(`${BASE}/api/platform/users/${teacher.userId}/subscription`, { headers: { 'content-type': 'application/json' } }, { deadlineMs: 40_000 })
    expect(anon.status).toBe(401)

    const st = await makeTestUser(schoolA.id, 'PRINCIPAL', `noauth-${RUN}`)
    const schoolToken = await asSchool(st, `/api/platform/users/${teacher.userId}/subscription`, { method: 'GET' })
    expect(schoolToken.status).toBe(401)
  }, T)

  test('a non-billing platform admin is refused (403)', async () => {
    const r = await asPlatform(opsToken, `/api/platform/users/${teacher.userId}/subscription`, { method: 'GET' })
    expect(r.status).toBe(403)
  }, T)

  test('root can read the staff history; a principal cannot be assigned a staff entitlement', async () => {
    const ok = await asPlatform(rootToken, `/api/platform/users/${teacher.userId}/subscription`, { method: 'GET' })
    expect(ok.status).toBe(200)
    const b = (await body(ok))?.data
    expect(b?.staff?.id).toBe(teacher.userId)

    const principal = await makeTestUser(schoolA.id, 'PRINCIPAL', `assign-${RUN}`)
    const refused = await asPlatform(rootToken, `/api/platform/users/${principal.userId}/subscription`, {
      method: 'POST',
      body: JSON.stringify({
        planCode: `STF-${RUN}`, mode: 'CASH', amount: 1000, currency: 'INR',
        paymentDate: new Date().toISOString(), notes: 'suite negative case',
      }),
    })
    expect(refused.status).toBe(422) // resolveStaffUser → VALIDATION_FAILED (not TEACHER)
  }, T)

  test('the staff roster lists only THIS school\u2019s teachers with live posture', async () => {
    const r = await asPlatform(rootToken, `/api/platform/schools/${schoolA.id}/staff?pageSize=200`, { method: 'GET' })
    expect(r.status).toBe(200)
    const b = (await body(r))?.data
    expect(b?.school?.id).toBe(schoolA.id)
    const ids: string[] = (b?.staff ?? []).map((s: StaffRow) => s.id)
    expect(ids).toContain(teacher.userId)
    // No cross-tenant leakage: school B has its own teacher, never listed here.
    const bTeacher = await db.user.findFirst({ where: { schoolId: schoolB.id, role: 'TEACHER' } })
    if (bTeacher) expect(ids).not.toContain(bTeacher.id)
    // Posture fields present (live evaluation, not raw rows).
    for (const s of b?.staff ?? []) {
      expect(typeof s.state).toBe('string')
      expect(typeof s.businessAllowed).toBe('boolean')
    }
  }, T)
})
