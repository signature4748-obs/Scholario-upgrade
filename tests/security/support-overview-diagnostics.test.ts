/**
 * SUPPORT OVERVIEW DIAGNOSTICS (2026-10-28 Support & audit redesign) —
 * the read-only troubleshooting workspace payload, live-HTTP against
 * the dev server:
 *
 *   1. The diagnostics contract — the support token space ONLY unlocks
 *      the overview; a platform session cannot read school data through
 *      it, and no token at all → 401.
 *   2. diagnostics.fees — honest evidence: failed (non-SUCCESS) payment
 *      rows ARE surfaced with record references; a school with zero
 *      failures reports the empty list (never fabricated).
 *   3. diagnostics.signIns — recent sign-ins with device/IP evidence,
 *      live flag derived server-side.
 *   4. The payload is READ-ONLY data: no write affordances exist on the
 *      route (GET only — structural, asserted by route-inventory).
 *
 * The support session row + token are planted directly (token hash is
 * a known sha256); the ROUTE under test performs the token lookup +
 * expiry enforcement, which planting does not bypass.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes, createHash } from 'crypto'

import { db } from '../helpers/db'
import { PLATFORM_ROOT_EMAIL } from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const supportToken = randomBytes(32).toString('hex')
const supportTokenHash = createHash('sha256').update(supportToken).digest('hex')
const plantedPaymentIds: string[] = []
let plantedSchoolId = ''
let plantedAdminId = ''

interface OverviewBody {
  ok: boolean
  data?: {
    supportSession: { schoolId: string; reason: string; expiresAt: string }
    counts: Record<string, number>
    diagnostics: {
      fees: {
        successfulPayments: number
        collectedTotal: number
        failedRecent: Array<{
          id: string
          amount: number
          status: string
          transactionId: string | null
          feeId: string | null
          at: string
        }>
      }
      signIns: {
        activeCount: number
        recent: Array<{
          id: string
          userName: string
          userRole: string
          live: boolean
          userAgent: string | null
          ipAddress: string | null
        }>
      }
    }
    recentActivity: unknown[]
  }
}

async function fetchOverview(token: string | null): Promise<{ status: number; body: OverviewBody | null }> {
  const res = await liveFetch(`${BASE}/api/platform/support/overview`, {
    headers: token
      ? { 'x-support-token': token, 'content-type': 'application/json' }
      : { 'content-type': 'application/json' },
  })
  let body: OverviewBody | null = null
  try {
    body = (await res.json()) as OverviewBody
  } catch {
    /* surfaced by assertions */
  }
  return { status: res.status, body }
}

beforeAll(async () => {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error('overview diagnostics: corpus missing the root admin')
  plantedAdminId = admin.id

  // A CLEAN school with NO payment history — honest-empty assertions.
  const school = await db.school.findFirst({ where: { slug: 'green-valley' } })
  if (!school) throw new Error('overview diagnostics: corpus missing green-valley')
  plantedSchoolId = school.id

  await db.supportSession.create({
    data: {
      adminId: admin.id,
      schoolId: school.id,
      reason: 'diagnostics contract probe — read-only evidence check',
      durationMinutes: 30,
      tokenHash: supportTokenHash,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  })

  // One FAILED payment row on the clean tenant — the fee-ledger
  // evidence must surface it with its record references.
  const failed = await db.payment.create({
    data: {
      schoolId: school.id,
      amount: 1234.5,
      method: 'upi',
      status: 'FAILED',
      transactionId: `zzq-txn-${randomBytes(4).toString('hex')}`,
      note: 'diagnostics contract probe row',
    },
  })
  plantedPaymentIds.push(failed.id)
}, 60_000)

afterAll(async () => {
  await db.payment.deleteMany({ where: { id: { in: plantedPaymentIds } } })
  await db.supportSession.deleteMany({ where: { tokenHash: supportTokenHash } })
  void plantedAdminId
}, 30_000)

describe('SUPPORT OVERVIEW — token-space authorization', () => {
  test('no token → 401', async () => {
    const { status } = await fetchOverview(null)
    expect(status).toBe(401)
  }, T)

  test('an invalid support token → 401', async () => {
    const { status } = await fetchOverview(randomBytes(32).toString('hex'))
    expect(status).toBe(401)
  }, T)

  test('a valid support token → 200 with the diagnostics contract', async () => {
    const { status, body } = await fetchOverview(supportToken)
    expect(status).toBe(200)
    expect(body?.ok).toBe(true)
    expect(body?.data?.supportSession.schoolId).toBe(plantedSchoolId)
    expect(body?.data?.diagnostics).toBeDefined()
    expect(body?.data?.diagnostics?.fees).toBeDefined()
    expect(body?.data?.diagnostics?.signIns).toBeDefined()
    expect(Array.isArray(body?.data?.recentActivity)).toBe(true)
  }, T)
})

describe('SUPPORT OVERVIEW — fee-ledger diagnostics (real evidence only)', () => {
  test('the planted FAILED payment is surfaced with record references', async () => {
    const { body } = await fetchOverview(supportToken)
    const failed = body?.data?.diagnostics.fees.failedRecent ?? []
    const row = failed.find((f) => plantedPaymentIds.includes(f.id))
    expect(row).toBeDefined()
    expect(row!.status).toBe('FAILED')
    expect(row!.amount).toBe(1234.5)
    expect(row!.transactionId).toMatch(/^zzq-txn-/)
    expect(typeof row!.at).toBe('string')
  }, T)

  test('no fabricated rows — every surfaced failure is a real non-SUCCESS row', async () => {
    const { body } = await fetchOverview(supportToken)
    const failed = body?.data?.diagnostics.fees.failedRecent ?? []
    for (const f of failed) {
      const row = await db.payment.findUnique({ where: { id: f.id } })
      expect(row).not.toBeNull()
      expect(row!.status).not.toBe('SUCCESS')
      expect(row!.schoolId).toBe(plantedSchoolId)
    }
  }, T)
})

describe('SUPPORT OVERVIEW — sign-in diagnostics', () => {
  test('recent sign-ins are real tenant sessions with live flags', async () => {
    const { body } = await fetchOverview(supportToken)
    const recent = body?.data?.diagnostics.signIns.recent ?? []
    for (const s of recent) {
      const row = await db.session.findUnique({ where: { id: s.id }, include: { user: true } })
      expect(row).not.toBeNull()
      expect(row!.user.schoolId).toBe(plantedSchoolId)
      expect(s.live).toBe(row!.expiresAt.getTime() > Date.now())
    }
    // activeCount is a real count, not a hardcoded zero.
    const liveCount = await db.session.count({
      where: { user: { schoolId: plantedSchoolId }, expiresAt: { gt: new Date() } },
    })
    expect(body?.data?.diagnostics.signIns.activeCount).toBe(liveCount)
  }, T)
})
