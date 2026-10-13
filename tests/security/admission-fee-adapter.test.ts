import { db } from '../helpers/db'
/**
 * PR-3 · GATE 1 — SERVER AUTHORITY PREPARATION tests.
 *
 * Proves the adapter boundary contract on the real database (model-level,
 * no HTTP — same convention as tenant-isolation-model.test.ts):
 *
 *   1. schoolId comes from the AUTHENTICATED SESSION identity only —
 *      `feeConfigForSession(user)` has no tenant/config parameter at all;
 *      the configuration content is exactly the session tenant's
 *      School.settings row.
 *   2. a client-supplied tenant cannot leak in: Tenant-A and Tenant-B
 *      sessions read their OWN configuration even when both exist with
 *      deliberately different money (cross-tenant isolation of money).
 *   3. client financial configuration cannot override the server's:
 *      fee selections cannot inject head amounts; every amount in the
 *      snapshot comes from the DB-read settings.
 *   4. platform identities (SUPER_ADMIN) and scope-less identities are
 *      refused FORBIDDEN — same fail-closed school-scoping as every API.
 *   5. the provenance stamp (config.schoolId) is session-derived, so a
 *      Tenant-A config can never masquerade as Tenant-B truth.
 *
 * Fixture discipline: two throwaway schools with distinct fee settings
 * (+ one malformed-settings school), created under a random marker and
 * fully deleted in afterAll. No financial ledger tables are touched.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { feeConfigForSession, computeFeeSnapshotForSession } from '@/lib/admission/server-fee-adapter'
import { normalizeFeeConfig, defaultFeeDataState } from '@/lib/admission/fee-config'
import { AppError } from '@/lib/security/errors'
import type { AuthUser } from '@/lib/auth'

const P = randomBytes(4).toString('hex')

// Deliberately distinct money per tenant: A=1111/2222, B=9999 — a leak
// across tenants would be numerically obvious.
const SETTINGS_A = JSON.stringify({
  feeHeads: [{ id: 'FHA-1', name: 'Registration Fee', category: 'Registration', defaultAmount: 1111 }],
  admissionFees: { transportFee: 2222 },
})
const SETTINGS_B = JSON.stringify({
  feeHeads: [{ id: 'FHB-1', name: 'Registration Fee', category: 'Registration', defaultAmount: 9999 }],
})

let schoolA = { id: `${P}-school-a`, name: `Gate1 A ${P}` }
let schoolB = { id: `${P}-school-b`, name: `Gate1 B ${P}` }
let schoolMalformed = { id: `${P}-school-m`, name: `Gate1 M ${P}` }

function sessionUser(schoolId: string | null, role = 'PRINCIPAL'): AuthUser {
  return {
    id: `u-${P}`,
    email: `gate1-${P}@test.local`,
    name: 'Gate 1 Session Identity',
    role,
    schoolId,
    avatarUrl: null,
    phone: null,
    status: 'ACTIVE',
    mustChangePassword: false,
    subscriptionStatus: 'ACTIVE',
    school: null,
  }
}

beforeAll(async () => {
  await db.school.create({
    data: { id: schoolA.id, name: schoolA.name, slug: `${P}-slug-a`, code: `${P}-code-a`, settings: SETTINGS_A },
  })
  await db.school.create({
    data: { id: schoolB.id, name: schoolB.name, slug: `${P}-slug-b`, code: `${P}-code-b`, settings: SETTINGS_B },
  })
  await db.school.create({
    data: { id: schoolMalformed.id, name: schoolMalformed.name, slug: `${P}-slug-m`, code: `${P}-code-m`, settings: '{malformed json' },
  })
})

afterAll(async () => {
  await db.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id, schoolMalformed.id] } } })
})

// ── 1. session is the ONLY tenant resolver ────────────────────────────────

describe('feeConfigForSession · session-scoped configuration', () => {
  test('the config content is EXACTLY the session tenant’s School.settings', async () => {
    const config = await feeConfigForSession(sessionUser(schoolA.id))
    expect(config).not.toBeNull()
    // provenance stamp — session-derived only
    expect(config?.schoolId).toBe(schoolA.id)
    // content parity with the shared normalizer over the same settings row
    expect(config?.feeHeads).toEqual(normalizeFeeConfig(JSON.parse(SETTINGS_A)).feeHeads)
    expect(config?.transportFee).toEqual({ status: 'configured', amount: 2222 })
    // B’s distinct value must NOT appear for an A-session
    const regA = config?.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount
    expect(regA).toBe(1111)
    expect(regA).not.toBe(9999)
  })

  test('a missing school row resolves to null (graceful, never fabricated)', async () => {
    const config = await feeConfigForSession(sessionUser(`${P}-nonexistent`))
    expect(config).toBeNull()
  })

  test('malformed settings JSON degrades to all-unconfigured (schoolId still stamped)', async () => {
    const config = await feeConfigForSession(sessionUser(schoolMalformed.id))
    expect(config?.schoolId).toBe(schoolMalformed.id)
    expect(config?.feeHeads).toEqual([])
    expect(config?.transportFee.status).toBe('unconfigured')
  })
})

// ── 2. cross-tenant isolation of money ────────────────────────────────────

describe('feeConfigForSession · cross-tenant money isolation', () => {
  test('Tenant-A and Tenant-B sessions each read their OWN configuration (interleaved)', async () => {
    const a1 = await feeConfigForSession(sessionUser(schoolA.id))
    const b1 = await feeConfigForSession(sessionUser(schoolB.id))
    const a2 = await feeConfigForSession(sessionUser(schoolA.id))

    const amount = (c: ReturnType<typeof normalizeFeeConfig> | null) =>
      c?.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount

    expect(a1?.schoolId).toBe(schoolA.id)
    expect(b1?.schoolId).toBe(schoolB.id)
    expect(amount(a1)).toBe(1111)
    expect(amount(b1)).toBe(9999)
    expect(amount(a2)).toBe(1111) // no cross-call contamination
    expect(a2?.schoolId).toBe(schoolA.id)
  })

  test('the provenance stamp cannot be transplanted: A-config stays A-stamped', async () => {
    const a = await feeConfigForSession(sessionUser(schoolA.id))
    const b = await feeConfigForSession(sessionUser(schoolB.id))
    // the stamp is the adapter contract — document boundaries verify it
    expect(a?.schoolId === b?.schoolId).toBe(false)
    expect(a?.schoolId).toBe(schoolA.id)
    expect(b?.schoolId).toBe(schoolB.id)
  })
})

// ── 3/4. authority: nothing client-side can override the server row ───────

describe('computeFeeSnapshotForSession · server authority', () => {
  test('every amount comes from the server row; fee selections cannot inject money', async () => {
    const result = await computeFeeSnapshotForSession(
      sessionUser(schoolA.id),
      'Class 1',
      {
        ...defaultFeeDataState,
        bookSelections: { 'BK-ATTACK': 5 }, // selections reference ids — never amounts
        transportSelected: true,
        hostelSelected: true,
        discountCode: 'NONE',
      },
      { enableTransport: true, enableHostel: true },
    )
    expect(result?.schoolId).toBe(schoolA.id)
    // registration = A's row (1111), transport = A's admissionFees (2222)
    expect(result?.snapshot.registrationFee).toBe(1111)
    expect(result?.snapshot.transportTotal).toBe(2222)
    // A has NO Admission head → honest 0 + reported, never the 15000 literal
    expect(result?.snapshot.admissionFee).toBe(0)
    expect(result?.snapshot.unconfigured).toContain('Admission Fee')
    // selections A's catalogue cannot price → 0 + reported, never book literals
    expect(result?.snapshot.booksTotal).toBe(0)
    expect(result?.snapshot.unconfigured).toContain('Books')
    // hostel unconfigured on A → 0 + reported, never 45000
    expect(result?.snapshot.hostelTotal).toBe(0)
    expect(result?.snapshot.unconfigured).toContain('Hostel Fee')
    // gross is exactly the server-derived arithmetic
    expect(result?.snapshot.grossFee).toBe(1111 + 2222)
  })

  test('client tenantId cannot enter: the adapter accepts ONLY the session user', async () => {
    // Architectural proof: feeConfigForSession(user) — there is no
    // schoolId/tenantId/config parameter to abuse. The session identity
    // is the sole resolver, and the result is stamped with it.
    const result = await computeFeeSnapshotForSession(sessionUser(schoolA.id), 'Class 1', defaultFeeDataState)
    expect(result?.schoolId).toBe(schoolA.id)
    expect(result?.snapshot.registrationFee).toBe(1111) // B's 9999 never appears
  })
})

describe('feeConfigForSession · fail-closed scope guards', () => {
  test('SUPER_ADMIN (platform identity) is refused FORBIDDEN', async () => {
    let err: unknown
    try {
      await feeConfigForSession(sessionUser('irrelevant', 'SUPER_ADMIN'))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('FORBIDDEN')
    expect((err as AppError).status).toBe(403)
  })

  test('an identity with no school scope is refused FORBIDDEN', async () => {
    let err: unknown
    try {
      await feeConfigForSession(sessionUser(null))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('FORBIDDEN')
  })
})
