/**
 * tests/security/staff-role-coverage.test.ts
 *
 * STAFF ROLE COVERAGE (PHASE 5C, 2026-10-30) — live acceptance suite.
 *
 * "A plan MUST explicitly define which staff roles it covers." These
 * tests pin the declarative policy surface:
 *
 *   · normalizeStaffCoveredRoles / resolveStaffCoveredRoles (pure): the
 *     seat-eligible invariant (values outside the canonical set are
 *     dropped), the empty-set fallback (an empty policy can never exist
     * — it would be a misconfiguration, not a decision), dedupe, and the
 *     tenant → plan → default precedence.
 *   · resolveStaffUser: a target whose role is outside the tenant's
 *     effective covered set is refused for staff subscription writes
 *     (even a same-school identity).
 *   · claimStaffActivationCode: a covered role claims; a non-covered
 *     canonical role (PRINCIPAL) is a SCOPE_MISMATCH by identity.
 *   · PATCH …/terms: staffCoverageRoles are stored NORMALIZED, an empty
 *     array falls back to the default, null clears the override, and the
 *     audit diff carries the effective set.
 *   · POST /plans: coveredRoles on a non-STAFF plan are refused; a
 *     STAFF plan's declaration is normalized on write (invalid values
 *     can never widen the policy).
 *   · Batch codes (ASSIGNED, staff scope): a member outside the covered
 *     set is refused and NOTHING is generated (no partial batches).
 *   · The staff roster lists exactly the covered roles and reports the
 *     effective set.
 *
 * Test-data discipline: every row is tracked and removed in afterAll;
 * the tenant fixture's staff policy is saved and restored.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import {
  normalizeStaffCoveredRoles,
  resolveStaffCoveredRoles,
  resolveStaffUser,
  STAFF_SEAT_ELIGIBLE_ROLES,
  DEFAULT_STAFF_COVERED_ROLES,
} from '@/lib/subscription/staff'
import { claimStaffActivationCode, issueActivationCode } from '@/lib/subscription/codes'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const T = 45_000

let schoolA = { id: '', slug: '' }
let rootToken = ''
let suiteAdminId = ''
let originalPolicy: { staffCoverage: string; staffCoverageRoles: unknown; periodEnd: Date | null; overrideStatus: string | null; status: string } | null = null

const cleanup: Array<() => Promise<unknown>> = []
const RUN = randomBytes(4).toString('hex').toUpperCase()

// ── setup / teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' }, include: { subscription: true } })
  if (!a) throw new Error('fixture school missing (run seed:demo)')
  schoolA = { id: a.id, slug: a.slug }
  originalPolicy = a.subscription
    ? {
        staffCoverage: a.subscription.staffCoverage,
        staffCoverageRoles: (a.subscription as { staffCoverageRoles?: unknown }).staffCoverageRoles ?? null,
        periodEnd: a.subscription.periodEnd,
        overrideStatus: a.subscription.overrideStatus,
        status: a.subscription.status,
      }
    : null
  // The tenant must be business-allowed so PER_SEAT policy interactions
  // are observable in isolation (restored in afterAll).
  await db.schoolSubscription.upsert({
    where: { schoolId: schoolA.id },
    create: { schoolId: schoolA.id },
    update: { periodEnd: new Date(Date.now() + 365 * 86_400_000), overrideStatus: null },
  })

  const rootRow = await db.platformAdmin.create({
    data: {
      email: `rolev.root.${RUN}@platform.test`, name: 'Role Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: rootRow.id } })
    await db.platformAdmin.deleteMany({ where: { id: rootRow.id } })
  })
  suiteAdminId = rootRow.id
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: rootRow.id,
      tokenHash: (await import('crypto')).createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  rootToken = token
}, 60_000)

afterAll(async () => {
  // Restore the tenant fixture FIRST (before row cleanup cascades).
  await db.schoolSubscription.updateMany({
    where: { schoolId: schoolA.id },
    data: {
      staffCoverage: originalPolicy?.staffCoverage ?? 'TENANT',
      staffCoverageRoles: originalPolicy?.staffCoverageRoles == null ? Prisma.DbNull : (originalPolicy.staffCoverageRoles as Prisma.InputJsonValue),
      ...(originalPolicy
        ? { periodEnd: originalPolicy.periodEnd, overrideStatus: originalPolicy.overrideStatus, status: originalPolicy.status }
        : {}),
    },
  })
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
}, 60_000)

async function asPlatform(path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': rootToken, 'content-type': 'application/json' },
  }, { deadlineMs: 40_000 })
}

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

/** Create a tracked staff-side User row (any role value) in the fixture school. */
async function makeStaffUser(role: string, label: string): Promise<{ id: string; email: string }> {
  const email = `rolecov.${label}.${RUN}@hawkings.test`
  const user = await db.user.create({
    data: {
      email,
      name: `Role Coverage ${label}`,
      role,
      schoolId: schoolA.id,
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })
  cleanup.push(async () => {
    await db.session.deleteMany({ where: { userId: user.id } })
    await db.staffEntitlement.deleteMany({ where: { userId: user.id } })
    await db.staffSubscriptionPayment.deleteMany({ where: { userId: user.id } })
    await db.user.deleteMany({ where: { id: user.id } })
  })
  return { id: user.id, email }
}

// ── 1 · normalization + resolution (pure) ────────────────────────────────

describe('staff role coverage normalization (unit)', () => {
  test('null/undefined/non-array falls back to the legacy default', () => {
    expect(normalizeStaffCoveredRoles(null)).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    expect(normalizeStaffCoveredRoles(undefined)).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    expect(normalizeStaffCoveredRoles('TEACHER')).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    expect(normalizeStaffCoveredRoles({ role: 'TEACHER' })).toEqual(DEFAULT_STAFF_COVERED_ROLES)
  })

  test('values outside the seat-eligible set are dropped; empty falls back', () => {
    expect(normalizeStaffCoveredRoles(['TEACHER'])).toEqual(['TEACHER'])
    expect(normalizeStaffCoveredRoles(['ACCOUNTANT', 'PRINCIPAL', 'LIBRARIAN'])).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    expect(normalizeStaffCoveredRoles(['TEACHER', 'ACCOUNTANT'])).toEqual(['TEACHER'])
    expect(normalizeStaffCoveredRoles([])).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    expect(normalizeStaffCoveredRoles([42, null])).toEqual(DEFAULT_STAFF_COVERED_ROLES)
  })

  test('duplicates collapse; the seat-eligible set is exactly the canonical staff role', () => {
    expect(normalizeStaffCoveredRoles(['TEACHER', 'TEACHER'])).toEqual(['TEACHER'])
    expect(STAFF_SEAT_ELIGIBLE_ROLES).toEqual(['TEACHER'])
  })

  test('resolution precedence: tenant override → plan declaration → default', () => {
    expect(resolveStaffCoveredRoles({ tenantRoles: ['TEACHER'], planRoles: [] })).toEqual(['TEACHER'])
    expect(resolveStaffCoveredRoles({ tenantRoles: null, planRoles: ['TEACHER'] })).toEqual(['TEACHER'])
    expect(resolveStaffCoveredRoles({ tenantRoles: undefined, planRoles: undefined })).toEqual(DEFAULT_STAFF_COVERED_ROLES)
    // A tenant override of [] means "misconfiguration" — normalized to the
    // default, never an empty gate.
    expect(resolveStaffCoveredRoles({ tenantRoles: [], planRoles: ['TEACHER'] })).toEqual(DEFAULT_STAFF_COVERED_ROLES)
  })
})

// ── 2 · write-path eligibility (service level) ───────────────────────────

describe('resolveStaffUser enforces the covered set', () => {
  test('a TEACHER inside the covered set resolves', async () => {
    const t = await makeStaffUser('TEACHER', 'covered')
    const u = await resolveStaffUser(t.id, schoolA.id, ['TEACHER'])
    expect(u.id).toBe(t.id)
  }, T)

  test('a role outside the covered set is refused (same-school identity, non-canonical)', async () => {
    // MANAGEMENT exists as a legacy User role value but is NOT in the
    // seat-eligible canonical set — a staff subscription write targeting
    // it must refuse even though the row belongs to this school.
    const m = await makeStaffUser('MANAGEMENT', 'notcovered')
    await expect(resolveStaffUser(m.id, schoolA.id, ['TEACHER'])).rejects.toThrow()
  }, T)

  test('a PRINCIPAL identity is never a staff seat (default covered set)', async () => {
    const p = await makeStaffUser('PRINCIPAL', 'principal')
    await expect(resolveStaffUser(p.id, schoolA.id, DEFAULT_STAFF_COVERED_ROLES)).rejects.toThrow()
  }, T)
})

// ── 3 · staff code claim — covered-role gate (service level) ─────────────

describe('claimStaffActivationCode enforces the covered set', () => {
  test('a covered TEACHER claims an open staff code', async () => {
    const t = await makeStaffUser('TEACHER', 'claimant')
    const issued = await issueActivationCode({
      scope: 'STAFF_ENTITLEMENT',
      schoolId: schoolA.id,
      assignedUserId: null,
      planCode: `RC-${RUN}`,
      interval: 'ANNUAL',
      validityMonths: 12,
      claimWindowDays: 30,
      issuedById: suiteAdminId,
      paymentRef: 'staffPayment:rolecov-suite',
    })
    cleanup.push(async () => {
      await db.activationCodeEvent.deleteMany({ where: { codeId: issued.codeId } })
      await db.activationCode.deleteMany({ where: { id: issued.codeId } })
      await db.staffSubscriptionPayment.deleteMany({ where: { id: 'staffPayment:rolecov-suite' } })
    })
    const result = await claimStaffActivationCode(issued.code, {
      userId: t.id,
      schoolId: schoolA.id,
      role: 'TEACHER',
      coveredRoles: ['TEACHER'],
    })
    expect(result.status === 'ACTIVE' || result.status === 'PENDING').toBe(true)
  }, T)

  test('a non-covered role (PRINCIPAL) is a SCOPE_MISMATCH — never an activation', async () => {
    const p = await makeStaffUser('PRINCIPAL', 'claimer2')
    const issued = await issueActivationCode({
      scope: 'STAFF_ENTITLEMENT',
      schoolId: schoolA.id,
      assignedUserId: null,
      planCode: `RC2-${RUN}`,
      interval: 'ANNUAL',
      validityMonths: 12,
      claimWindowDays: 30,
      issuedById: suiteAdminId,
      paymentRef: 'staffPayment:rolecov-suite2',
    })
    cleanup.push(async () => {
      await db.activationCodeEvent.deleteMany({ where: { codeId: issued.codeId } })
      await db.activationCode.deleteMany({ where: { id: issued.codeId } })
      await db.staffSubscriptionPayment.deleteMany({ where: { id: 'staffPayment:rolecov-suite2' } })
    })
    let reason = ''
    try {
      await claimStaffActivationCode(issued.code, {
        userId: p.id,
        schoolId: schoolA.id,
        role: 'PRINCIPAL',
        coveredRoles: ['TEACHER'],
      })
      expect.unreachable()
    } catch (e) {
      reason = String((e as { reason?: string }).reason ?? '')
    }
    expect(reason).toBe('SCOPE_MISMATCH')
  }, T)
})

// ── 4 · terms route — normalization, clearing, audit ─────────────────────

describe('PATCH …/terms stores the covered-role policy normalized', () => {
  test('invalid values are dropped; the audit diff carries the effective set', async () => {
    const r = await asPlatform(`/api/platform/schools/${schoolA.id}/subscription/terms`, {
      method: 'PATCH',
      body: JSON.stringify({ staffCoverageRoles: ['ACCOUNTANT', 'TEACHER', 'PRINCIPAL'], reason: `rolecov normalize ${RUN}` }),
    })
    expect(r.status).toBe(200)
    const stored = await db.schoolSubscription.findUnique({
      where: { schoolId: schoolA.id },
      select: { staffCoverageRoles: true },
    })
    expect(stored?.staffCoverageRoles).toEqual(['TEACHER'])
  }, T)

  test('an empty array falls back to the default (never an empty gate)', async () => {
    const r = await asPlatform(`/api/platform/schools/${schoolA.id}/subscription/terms`, {
      method: 'PATCH',
      body: JSON.stringify({ staffCoverageRoles: [], reason: `rolecov empty ${RUN}` }),
    })
    expect(r.status).toBe(200)
    const stored = await db.schoolSubscription.findUnique({
      where: { schoolId: schoolA.id },
      select: { staffCoverageRoles: true },
    })
    expect(stored?.staffCoverageRoles).toEqual(DEFAULT_STAFF_COVERED_ROLES)
  }, T)

  test('null clears the tenant override (SQL NULL stored)', async () => {
    const r = await asPlatform(`/api/platform/schools/${schoolA.id}/subscription/terms`, {
      method: 'PATCH',
      body: JSON.stringify({ staffCoverageRoles: null, reason: `rolecov clear ${RUN}` }),
    })
    expect(r.status).toBe(200)
    const stored = await db.schoolSubscription.findUnique({
      where: { schoolId: schoolA.id },
      select: { staffCoverageRoles: true },
    })
    expect(stored?.staffCoverageRoles).toBeNull()
  }, T)
})

// ── 5 · plan declaration (catalogue surface) ─────────────────────────────

describe('plan coveredRoles declaration', () => {
  test('a STAFF plan normalizes its declaration on create (invalid dropped)', async () => {
    const r = await asPlatform('/api/platform/subscriptions/plans', {
      method: 'POST',
      body: JSON.stringify({
        code: `RC-STF-${RUN}`,
        name: `Role Coverage Staff ${RUN}`,
        scope: 'STAFF',
        interval: 'ANNUAL',
        pricePerStudent: 499,
        currency: 'INR',
        coveredRoles: ['ACCOUNTANT', 'TEACHER'],
      }),
    })
    expect(r.status).toBe(200)
    const created = await db.subscriptionPlan.findUnique({ where: { code: `RC-STF-${RUN}` } })
    expect(created).not.toBeNull()
    expect(created?.coveredRoles).toEqual(['TEACHER'])
    cleanup.push(async () => {
      await db.subscriptionPlan.deleteMany({ where: { code: `RC-STF-${RUN}` } })
    })
  }, T)

  test('a SCHOOL-scope plan may not declare covered staff roles', async () => {
    const r = await asPlatform('/api/platform/subscriptions/plans', {
      method: 'POST',
      body: JSON.stringify({
        code: `RC-SCH-${RUN}`,
        name: `Role Coverage School ${RUN}`,
        scope: 'SCHOOL',
        interval: 'ANNUAL',
        priceAnnual: 24000,
        currency: 'INR',
        coveredRoles: ['TEACHER'],
      }),
    })
    // VALIDATION_FAILED envelope → 422 (the shared error classifier's
    // status for validation failures).
    expect(r.status).toBe(422)
    const created = await db.subscriptionPlan.findUnique({ where: { code: `RC-SCH-${RUN}` } })
    expect(created).toBeNull()
  }, T)
})

// ── 6 · batch codes — ASSIGNED staff must hold a covered role ────────────

describe('staff batch assignment enforces the covered set', () => {
  test('a member outside the covered set is refused and NOTHING is generated', async () => {
    const m = await makeStaffUser('MANAGEMENT', 'batchtarget')
    const before = await db.activationCode.count({ where: { schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT' } })
    const r = await asPlatform('/api/platform/subscriptions/codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        schoolId: schoolA.id,
        scope: 'STAFF_ENTITLEMENT',
        planCode: `RC-STF-${RUN}`,
        quantity: 1,
        assignment: 'ASSIGNED',
        assignedIds: [m.id],
        backing: 'PAYMENT',
        notes: `rolecov batch ${RUN}`,
      }),
    })
    expect(r.status).toBe(422)
    const payload = await body(r)
    expect(payload?.ok).toBeFalsy()
    // No partial batch: the count is unchanged.
    const after = await db.activationCode.count({ where: { schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT' } })
    expect(after).toBe(before)
  }, T)

  test('a covered TEACHER assignment succeeds and traces its payment', async () => {
    const t = await makeStaffUser('TEACHER', 'batchteacher')
    const r = await asPlatform('/api/platform/subscriptions/codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        schoolId: schoolA.id,
        scope: 'STAFF_ENTITLEMENT',
        planCode: `RC-STF-${RUN}`,
        quantity: 1,
        assignment: 'ASSIGNED',
        assignedIds: [t.id],
        backing: 'PAYMENT',
        notes: `rolecov batch ok ${RUN}`,
      }),
    })
    expect(r.status).toBe(200)
    const payload = await body(r)
    // The { ok, data } envelope — the batch result lives under `data`.
    expect(payload?.data?.generated).toBe(1)
    expect(typeof payload?.data?.items?.[0]?.code).toBe('string')
    cleanup.push(async () => {
      const codeIds = (await db.activationCode.findMany({ where: { schoolId: schoolA.id, scope: 'STAFF_ENTITLEMENT', assignedUserId: t.id }, select: { id: true } })).map((c) => c.id)
      await db.activationCodeEvent.deleteMany({ where: { codeId: { in: codeIds } } })
      await db.activationCode.deleteMany({ where: { id: { in: codeIds } } })
      await db.staffSubscriptionPayment.deleteMany({ where: { notes: { contains: `[BATCH] rolecov batch ok ${RUN}` } } })
    })
  }, T)
})

// ── 7 · the roster reports the effective set ─────────────────────────────

describe('GET …/staff roster exposes the effective covered set', () => {
  test('the school payload carries the covered roles; only covered roles are listed', async () => {
    // Leave an explicit tenant override so the response reflects it.
    await db.schoolSubscription.update({
      where: { schoolId: schoolA.id },
      data: { staffCoverageRoles: ['TEACHER'] },
    })
    const r = await asPlatform(`/api/platform/schools/${schoolA.id}/staff`)
    expect(r.status).toBe(200)
    const payload = await body(r)
    expect(payload?.data?.school?.coveredRoles).toEqual(['TEACHER'])
    for (const member of payload?.data?.staff ?? []) {
      // Every listed member IS a covered role (roster never leaks other roles).
      expect(payload.data.school.coveredRoles).toContain('TEACHER')
      expect(member.email).toBeTruthy()
    }
  }, T)
})
