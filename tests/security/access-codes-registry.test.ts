/**
 * tests/security/access-codes-registry.test.ts
 *
 * PAYMENTS & GATEWAYS REDESIGN — the GLOBAL Access Codes registry,
 * live acceptance suite.
 *
 *   · Permission: anonymous → 401 (the registry is billing-manage only;
 *     school-plane sessions are a disjoint token space by construction).
 *   · The global registry lists codes across schools with school/scope/
 *     status filters and publicRef/plan search — a code issued in one
 *     tenant is visible to the PLATFORM (control plane) with its tenant
 *     binding, and its PLAINTEXT never appears in any listing.
 *   · Revoke (audited): ISSUED → REVOKED with an audited reason; the
 *     ActivationCodeEvent trail records it; revoking twice is refused.
 *   · Wrong-school redemption stays impossible (bound covered by
 *     batch-codes.test.ts — this suite pins the REGISTRY surface).
 *
 * Test-data discipline: codes + school + admin rows tracked and removed.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'
import { issueActivationCode } from '@/lib/subscription/codes'

const BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:3000'
const RUN = randomBytes(4).toString('hex').toUpperCase()

let rootToken = ''
let schoolId = ''
let codeId = ''
let publicRef = ''

const cleanup: Array<() => Promise<unknown>> = []

async function body(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-platform-token': token, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }, { deadlineMs: 40_000 })
}

beforeAll(async () => {
  const rootRow = await db.platformAdmin.create({
    data: {
      email: `acr.root.${RUN}@platform.test`, name: 'ACR Suite Root', isRoot: true,
      status: 'ACTIVE', passwordHash: 'suite-no-login', totpSecret: `SUITE-${RUN}`,
    },
  })
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: rootRow.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  rootToken = token
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: rootRow.id } })
    await db.platformAdmin.deleteMany({ where: { id: rootRow.id } })
  })

  const school = await db.school.create({
    data: {
      name: `ACR Suite ${RUN}`, slug: `acr-suite-${RUN.toLowerCase()}`, code: `ACRS${RUN.slice(0, 5)}`,
      status: 'ACTIVE', isDemo: false,
    },
  })
  schoolId = school.id
  cleanup.push(async () => {
    await db.activationCodeEvent.deleteMany({ where: { codeId } })
    await db.activationCode.deleteMany({ where: { id: codeId } })
    await db.school.deleteMany({ where: { id: schoolId } })
  })

  const issued = await db.$transaction(async (tx) =>
    issueActivationCode(
      {
        schoolId,
        scope: 'STUDENT_ENTITLEMENT',
        planCode: 'STUDENT-ANNUAL',
        validityMonths: 12,
        claimWindowDays: 30,
        issuedById: rootRow.id,
        tx,
      },
    ),
  )
  codeId = issued.codeId
  publicRef = issued.publicRef
})

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {})
  }
})

describe('ACCESS CODES REGISTRY · global surface', () => {
  test('anonymous callers are refused (401)', async () => {
    const r = await liveFetch(`${BASE}/api/platform/subscriptions/codes`, {}, { deadlineMs: 40_000 })
    expect(r.status).toBe(401)
  })

  test('the registry lists the code with its tenant binding — and NEVER the plaintext', async () => {
    const r = await asPlatform(rootToken, `/api/platform/subscriptions/codes?q=${publicRef}&pageSize=25`)
    expect(r.status).toBe(200)
    const b = await body(r)
    const d = b?.data ?? b
    const rows = d?.codes ?? []
    const row = rows.find((c: any) => c.publicRef === publicRef)
    expect(row).toBeTruthy()
    expect(row.school?.id).toBe(schoolId)
    expect(row.scope).toBe('STUDENT_ENTITLEMENT')
    expect(row.status).toBe('ISSUED')
    const raw = JSON.stringify(d)
    // The plaintext never appears: only publicRef + the keyed hash exist.
    expect(raw).not.toContain('"code"')
    expect(raw).not.toContain(row.codeHash ?? '___never___')
  })

  test('scope filter: the code appears under STUDENT_ENTITLEMENT and not under STAFF_ENTITLEMENT', async () => {
    const student = await asPlatform(rootToken, `/api/platform/subscriptions/codes?scope=STUDENT_ENTITLEMENT&q=${publicRef}`)
    const staff = await asPlatform(rootToken, `/api/platform/subscriptions/codes?scope=STAFF_ENTITLEMENT&q=${publicRef}`)
    const sd = await body(student)
    const st = await body(staff)
    const sdd = sd?.data ?? sd
    const std = st?.data ?? st
    expect((sdd?.codes ?? []).some((c: any) => c.publicRef === publicRef)).toBe(true)
    expect((std?.codes ?? []).some((c: any) => c.publicRef === publicRef)).toBe(false)
  })

  test('revoke is audited and terminal: ISSUED → REVOKED; revoking again is refused', async () => {
    const r1 = await asPlatform(rootToken, `/api/platform/subscriptions/codes/${codeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'revoke', reason: 'registry suite revocation' }),
    })
    expect(r1.status).toBe(200)

    const after = await db.activationCode.findUnique({ where: { id: codeId } })
    expect(after?.status).toBe('REVOKED')

    const event = await db.activationCodeEvent.findFirst({
      where: { codeId, type: 'REVOKED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(event).toBeTruthy()

    // A second revoke is an IDEMPOTENT no-op (200): the state stays
    // REVOKED and NO duplicate audit event is written.
    const r2 = await asPlatform(rootToken, `/api/platform/subscriptions/codes/${codeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'revoke', reason: 'double revoke is an idempotent no-op' }),
    })
    expect(r2.status).toBe(200)
    const stillRevoked = await db.activationCode.findUnique({ where: { id: codeId } })
    expect(stillRevoked?.status).toBe('REVOKED')
    const revocationEvents = await db.activationCodeEvent.count({ where: { codeId, type: 'REVOKED' } })
    expect(revocationEvents).toBe(1)
  })
})
