import { db } from '../helpers/db'
/**
 * PR-3 · GATE 2 — the official fee-snapshot boundary under REAL HTTP.
 *
 * Live suite (dev server :3000, real sessions) proving the server
 * authority contract of POST /api/admissions/fee-snapshot:
 *
 *   1–4.  three-state money over the wire: configured ₹1500 → ₹1500,
 *         configured ₹0 → ₹0 (NOT flagged missing), missing head →
 *         0 contribution + unconfigured label, and NO fabricated
 *         1500/15000/60000/18000/45000 ever appears
 *   5.    a client schoolId/tenantId in the body is IGNORED — the
 *         response tenant is the session's
 *   6.    a client FeeConfig in the body (feeHeads / admissionFees /
 *         totals) is IGNORED — amounts stay the server row's
 *   7.    tenant isolation: another tenant's session gets its OWN
 *         (unconfigured) snapshot, never this tenant's money
 *   8.    the boundary reads the CANONICAL School.settings row (a DB
 *         change is reflected on the next call — no client cache)
 *   9.    Green Valley (the clean tenant) remains fee-unconfigured
 *   12.   selected-but-unconfigured optional services contribute 0 +
 *         label — never 18000/45000
 *   ·     PRINCIPAL-only (TEACHER refused 403); unauthenticated → 401;
 *         malformed payload → VALIDATION_FAILED (422)
 *
 * Fixtures: one throwaway school with a deliberate three-state fee row
 * (+ its PRINCIPAL and TEACHER users, sessions minted directly — the
 * auth fixture pattern from empty-school.test.ts), plus the two REAL
 * corpus tenants via real login. Everything throwaway is deleted in
 * afterAll; no financial ledger tables are touched.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import {
  DEMO_PRINCIPAL_EMAIL,
  DEMO_PRINCIPAL_PASSWORD,
  TENANT_FIXTURE_PASSWORD,
} from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000
const RUN_IP = `10.244.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const P = randomBytes(4).toString('hex')

// ── the throwaway three-state fixture tenant ─────────────────────────────
// Registration = configured ₹1500 (the mandate's exact case), Admission =
// explicit ₹0 (deliberate free), Tuition = ABSENT (missing), transport
// absent (selected in the request), no books/exams configured.
const SETTINGS_A = JSON.stringify({
  feeHeads: [
    { id: 'G2-FH-REG', name: 'Registration Fee', category: 'Registration', defaultAmount: 1500 },
    { id: 'G2-FH-ADM', name: 'Admission Fee', category: 'Admission', defaultAmount: 0 },
  ],
})
const schoolA = { id: `${P}-school-a`, slug: `${P}-slug-a`, name: `Gate2 A ${P}` }
const principalA = { id: `${P}-principal-a`, email: `gate2-principal-a.${P}@test.local` }
const teacherA = { id: `${P}-teacher-a`, email: `gate2-teacher-a.${P}@test.local` }

// ── real corpus tenants (read-mostly; sessions cleaned in afterAll) ─────
let gvToken = ''
let hawkingsToken = ''
let gvId = ''

interface SnapshotEnvelope {
  ok: boolean
  data?: { schoolId: string; snapshot: Record<string, unknown> }
  error?: string
  code?: string
}

const SELECTIONS = {
  className: 'Class 7',
  feeState: {
    transportSelected: true, // selected but NOT configured on the fixture
    hostelSelected: true,
    examGroups: { unitTest: true, termExam: true, customGroups: true },
    discountCode: 'NONE',
  },
  flags: { enableTransport: true, enableHostel: true },
}

function post(body: unknown, token: string | null): Promise<Response> {
  return fetch(`${BASE}/api/admissions/fee-snapshot`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      'x-forwarded-for': RUN_IP,
    },
    body: JSON.stringify(body),
  })
}

async function mintSession(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return raw
}

async function loginReal(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 429) return '' // handled by the direct-session fallback
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) return ''
  return body.data.sessionToken
}

async function directSessionFor(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) return ''
  return mintSession(u.id)
}

const mintedSessions: string[] = []

beforeAll(async () => {
  await db.school.create({
    data: { id: schoolA.id, name: schoolA.name, slug: schoolA.slug, code: `${P}-code-a`, settings: SETTINGS_A },
  })
  await db.user.createMany({
    data: [
      {
        id: principalA.id,
        schoolId: schoolA.id,
        email: principalA.email,
        name: 'Gate 2 Principal A',
        role: 'PRINCIPAL',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        mustChangePassword: false,
      },
      {
        id: teacherA.id,
        schoolId: schoolA.id,
        email: teacherA.email,
        name: 'Gate 2 Teacher A',
        role: 'TEACHER',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        mustChangePassword: false,
      },
    ],
  })
  mintedSessions.push(await mintSession(principalA.id))
  mintedSessions.push(await mintSession(teacherA.id))

  // Real logins for the corpus tenants (heal the limiter first).
  await resetLoginBuckets([DEMO_PRINCIPAL_EMAIL, 'principal.b@greenvalley.test'])
  gvToken = (await loginReal('principal.b@greenvalley.test', TENANT_FIXTURE_PASSWORD))
    || (await directSessionFor('principal.b@greenvalley.test'))
  hawkingsToken = (await loginReal(DEMO_PRINCIPAL_EMAIL, DEMO_PRINCIPAL_PASSWORD))
    || (await directSessionFor(DEMO_PRINCIPAL_EMAIL))
  if (gvToken) mintedSessions.push(gvToken)
  if (hawkingsToken) mintedSessions.push(hawkingsToken)

  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  gvId = gv?.id ?? ''
}, 60_000)

afterAll(async () => {
  for (const raw of mintedSessions) {
    await db.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } }).catch(() => {})
  }
  await db.user.deleteMany({ where: { id: { in: [principalA.id, teacherA.id] } } }).catch(() => {})
  await db.school.deleteMany({ where: { id: schoolA.id } }).catch(() => {})
  await db.$disconnect()
})

// ── the three-state money contract over the wire (1–4) ───────────────────

describe('POST /api/admissions/fee-snapshot · three-state money', () => {
  test('configured ₹1500 → ₹1500; explicit ₹0 → ₹0; missing → 0 + label; no legacy literals', async () => {
    const res = await post(SELECTIONS, mintedSessions[0])
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.ok).toBe(true)
    expect(body.data?.schoolId).toBe(schoolA.id)
    const s = body.data!.snapshot as Record<string, number | string[]>
    // 1. configured ₹1500 → ₹1500
    expect(s.registrationFee).toBe(1500)
    // 2. explicit ₹0 → ₹0, and NOT reported as unconfigured
    expect(s.admissionFee).toBe(0)
    expect((s.unconfigured as string[])).not.toContain('Admission Fee')
    // 3. missing Tuition → 0 contribution + honest label
    expect(s.tuitionFee).toBe(0)
    expect(s.unconfigured as string[]).toContain('Tuition Fee')
    // 4. no fabricated legacy literal anywhere in the response
    const legacy = [15000, 60000, 18000, 45000]
    for (const key of [
      'registrationFee', 'admissionFee', 'tuitionFee', 'otherHeadsTotal', 'examTotal',
      'booksTotal', 'uniformTotal', 'activityKitTotal', 'transportTotal', 'hostelTotal',
      'grossFee', 'discountAmount', 'netTotal',
    ]) {
      expect(legacy).not.toContain(s[key])
    }
    // 12. selected-but-unconfigured transport/hostel/exams → 0 + labels
    expect(s.transportTotal).toBe(0)
    expect(s.hostelTotal).toBe(0)
    expect(s.unconfigured as string[]).toContain('Transport Fee')
    expect(s.unconfigured as string[]).toContain('Hostel Fee')
    // gross = EXACTLY the server arithmetic (1500 + 0 + 0)
    expect(s.grossFee).toBe(1500)
    expect(s.netTotal).toBe(1500)
  }, T)
})

// ── the client cannot bring authority (5–6) ──────────────────────────────

describe('POST /api/admissions/fee-snapshot · client authority is impossible', () => {
  test('a body schoolId/tenantId is IGNORED — the session tenant answers', async () => {
    const res = await post(
      {
        ...SELECTIONS,
        schoolId: 'some-other-tenant-id',
        tenantId: 'tenant-b',
      },
      mintedSessions[0],
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.data?.schoolId).toBe(schoolA.id) // session-derived ONLY
    expect((body.data!.snapshot as Record<string, number>).registrationFee).toBe(1500)
  }, T)

  test('an injected FeeConfig / feeHeads / admissionFees / totals in the body is IGNORED', async () => {
    const res = await post(
      {
        ...SELECTIONS,
        feeHeads: [
          { id: 'ATTACK-1', name: 'Registration Fee', category: 'Registration', defaultAmount: 999999 },
          { id: 'ATTACK-2', name: 'Admission Fee', category: 'Admission', defaultAmount: 888888 },
        ],
        admissionFees: { transportFee: 777777, hostelFee: 666666 },
        examFeeConfig: { unitTestFee: 555555, termExamFee: 444444, customGroupsFee: 333333 },
        totals: { grossFee: 1234567, netTotal: 7654321 },
      },
      mintedSessions[0],
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotEnvelope
    const s = body.data!.snapshot as Record<string, number>
    expect(body.data?.schoolId).toBe(schoolA.id)
    expect(s.registrationFee).toBe(1500) // the DB row, not the injected 999999
    expect(s.admissionFee).toBe(0)
    expect(s.transportTotal).toBe(0)
    expect(s.hostelTotal).toBe(0)
    expect(s.grossFee).toBe(1500)
  }, T)
})

// ── the canonical source is the DB row (8) ───────────────────────────────

describe('POST /api/admissions/fee-snapshot · canonical School.settings source', () => {
  test('a change to the school’s settings row is reflected on the next call', async () => {
    const updated = JSON.stringify({
      feeHeads: [
        { id: 'G2-FH-REG', name: 'Registration Fee', category: 'Registration', defaultAmount: 1700 },
        { id: 'G2-FH-ADM', name: 'Admission Fee', category: 'Admission', defaultAmount: 0 },
        { id: 'G2-FH-TUI', name: 'Annual Tuition Fee', category: 'Tuition', defaultAmount: 22000 },
      ],
    })
    await db.school.update({ where: { id: schoolA.id }, data: { settings: updated } })
    try {
      const res = await post(SELECTIONS, mintedSessions[0])
      expect(res.status).toBe(200)
      const body = (await res.json()) as SnapshotEnvelope
      const s = body.data!.snapshot as Record<string, number | string[]>
      expect(s.registrationFee).toBe(1700)
      expect(s.tuitionFee).toBe(22000)
      expect(s.unconfigured as string[]).not.toContain('Tuition Fee')
      expect(s.grossFee).toBe(1700 + 0 + 22000)
    } finally {
      // restore the fixture state for any later assertions
      await db.school.update({ where: { id: schoolA.id }, data: { settings: SETTINGS_A } })
    }
  }, T)
})

// ── tenant isolation + the clean tenant (7, 9) ───────────────────────────

describe('POST /api/admissions/fee-snapshot · tenant isolation and the clean tenant', () => {
  test('Green Valley (clean tenant) remains fee-unconfigured over the wire', async () => {
    if (!gvToken || !gvId) return // corpus not present — environment skip
    const res = await post(SELECTIONS, gvToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.data?.schoolId).toBe(gvId)
    const s = body.data!.snapshot as Record<string, number | string[]>
    // every head is HONESTLY unconfigured — never zero-pretending, never
    // the demo tenant's money (700/9000/13200 must not leak in)
    expect(s.registrationFee).toBe(0)
    expect(s.admissionFee).toBe(0)
    expect(s.tuitionFee).toBe(0)
    expect(s.grossFee).toBe(0)
    expect(s.unconfigured as string[]).toContain('Registration Fee')
    expect(s.unconfigured as string[]).toContain('Admission Fee')
    expect(s.unconfigured as string[]).toContain('Tuition Fee')
    // Tenant-A's configured ₹1500 must never appear for the GV session
    expect([s.registrationFee, s.admissionFee, s.tuitionFee, s.grossFee]).not.toContain(1500)
  }, T)

  test('the demo tenant session receives its OWN seeded configuration', async () => {
    if (!hawkingsToken) return
    const res = await post(SELECTIONS, hawkingsToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotEnvelope
    const s = body.data!.snapshot as Record<string, number>
    expect(body.data?.schoolId).not.toBe(schoolA.id)
    expect(s.registrationFee).toBe(700) // the Hawkings seed value
    expect(s.admissionFee).toBe(9000)
    expect(s.tuitionFee).toBe(13200)
  }, T)
})

// ── the boundary's own guards ────────────────────────────────────────────

describe('POST /api/admissions/fee-snapshot · boundary guards', () => {
  test('unauthenticated → 401 AUTH_REQUIRED', async () => {
    const res = await post(SELECTIONS, null)
    expect(res.status).toBe(401)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('TEACHER is refused (issuance is the principal’s flow) → 403 FORBIDDEN', async () => {
    const res = await post(SELECTIONS, mintedSessions[1])
    expect(res.status).toBe(403)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('malformed payload → VALIDATION_FAILED (422), structured domain error', async () => {
    const res = await post({ feeState: 'junk' }, mintedSessions[0])
    expect(res.status).toBe(422)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(typeof body.error).toBe('string')
  }, T)

  test('malformed money (customDiscountValue out of bound) → VALIDATION_FAILED', async () => {
    const res = await post(
      { ...SELECTIONS, feeState: { customDiscountValue: 9999999 } },
      mintedSessions[0],
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as SnapshotEnvelope
    expect(body.code).toBe('VALIDATION_FAILED')
  }, T)

  test('a body the engine cannot read at all is still a VALIDATION shape error', async () => {
    const res = await post('not-an-object', mintedSessions[0])
    expect(res.status).toBe(422)
  }, T)
})
