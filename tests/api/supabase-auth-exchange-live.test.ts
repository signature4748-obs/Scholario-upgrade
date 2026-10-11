/**
 * SUPABASE AUTH PHASE 1 — LIVE END-TO-END: the exchange flows against the
 * REAL Supabase Auth provider and the running dev server
 * (TENANT_TEST_BASE, default :3000, flag SCHOLARIO_SUPABASE_AUTH=on in
 * the dev .env).
 *
 * This suite requires the real provider env (SUPABASE_URL + anon +
 * service-role keys). It SKIPS anywhere those are absent (CI never has
 * them — the same convention as the storage-dependent suites), so the
 * live evidence runs where the credentials exist.
 *
 * Coverage (the release-gating flows):
 *   · provider user creation (admin API) + REAL password-grant token
 *   · forged token → AUTH_REQUIRED (the provider rejects it server-side)
 *   · verified identity, no account → NO_SCHOLARIO_ACCOUNT (signup never
 *     provisions an account)
 *   · verified identity, matching account, no proof → LINK_PASSWORD_REQUIRED
 *   · WRONG current password → rejected + NO pointer written (takeover
 *     blocked — the crown-jewel negative)
 *   · correct password → 200, Scholario session minted, /api/auth/me
 *     resolves the SAME account (server-side identity of record), row
 *     linked
 *   · re-exchange (linked) → 200 without the password (steady state)
 *   · cross-plane negative: the school identity CANNOT exchange on the
 *     platform endpoint (Phase-6 boundary — NO_SCHOLARIO_ACCOUNT)
 *   · cross-role negative: the provider session gets NO role elevation
 *     (a STUDENT exchange is still a STUDENT for teacher-gated APIs)
 *   · suspended account → AUTH_REQUIRED (no status disclosure)
 *
 * Self-cleaning: provider users are DELETED via the admin API; local
 * fixture rows carry the test-sa2- prefix; login buckets are healed
 * (fixture accounts + loopback only — production semantics intact).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const P = 'test-sa2-'
const ts = Date.now()
const APP_PASS = 'LiveExchange123'
const PROVIDER_PASS = 'ProviderPass456' // deliberately different: the app password is the authority

const SUPABASE_URL = process.env.SUPABASE_URL?.trim()
const ANON = process.env.SUPABASE_ANON_KEY?.trim()
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const LIVE = Boolean(SUPABASE_URL && ANON && SERVICE)

interface JsonBody {
  ok?: boolean
  error?: string
  code?: string
  requestId?: string
  data?: {
    id?: string
    email?: string
    role?: string
    sessionToken?: string
    schoolId?: string
    user?: { email?: string; role?: string; schoolId?: string | null }
  }
}

async function j(res: Response): Promise<JsonBody> {
  return (await res.json().catch(() => ({}))) as JsonBody
}

// Provider REST helpers (the same surface supabase-js uses)
async function providerAdmin(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: { id?: string; message?: string; msg?: string } }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  const parsed = (await res.json().catch(() => ({}))) as { id?: string; message?: string; msg?: string }
  return { status: res.status, body: parsed }
}

async function providerPasswordToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string }
  if (!res.ok || !body.access_token) throw new Error(`provider password grant failed: HTTP ${res.status}`)
  return body.access_token
}

async function exchange(body: unknown, plane: 'school' | 'platform' = 'school'): Promise<{ status: number; body: JsonBody }> {
  const res = await fetch(
    `${BASE}${plane === 'school' ? '/api/auth/supabase/exchange' : '/api/platform/auth/supabase/exchange'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const parsed = await j(res)
  if (res.status === 422) {
    // Visible diagnostics: a VALIDATION_FAILED here means the request
    // body violated the strict schema (e.g. an empty token from an
    // aborted earlier test) — surface it, never guess.
    console.warn('[live-exchange] 422 body:', JSON.stringify(parsed).slice(0, 300))
  }
  return { status: res.status, body: parsed }
}

const providerUserIds: string[] = []
const fixtureEmail = `${P}${ts}@hawkings.test`
const strangerEmail = `${P}stranger-${ts}@hawkings.test`

// Every exchange consumes the loopback IP login bucket (8/15min) — with
// ~9 exchanges this suite legitimately exhausts it, so heal before each
// test (fixture accounts + loopback only).
async function heal(): Promise<void> {
  await resetLoginBuckets([fixtureEmail, strangerEmail])
}

beforeAll(async () => {
  if (!LIVE) return
  const school = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' }, select: { id: true } })
  if (!school) throw new Error('fixture school missing — run the canonical seed corpus first')
})

afterAll(async () => {
  if (!LIVE) return
  for (const id of providerUserIds) {
    await providerAdmin('DELETE', `/auth/v1/admin/users/${id}`).catch(() => undefined)
  }
  await db.user.deleteMany({ where: { email: { startsWith: `${P}` } } })
  await heal()
})

describe.skipIf(!LIVE)('SUPABASE AUTH exchange — live end-to-end (school plane)', () => {
  let fixtureUserId = ''
  let token = ''

  test('setup: fixture account + provider identity (admin-created, verified)', async () => {
    await heal()
    const school = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' }, select: { id: true } })
    const user = await db.user.create({
      data: {
        email: fixtureEmail,
        passwordHash: hashPassword(APP_PASS),
        name: 'Live Exchange Fixture',
        role: 'STUDENT',
        schoolId: school!.id,
        status: 'ACTIVE',
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    })
    fixtureUserId = user.id
    const created = await providerAdmin('POST', '/auth/v1/admin/users', {
      email: fixtureEmail,
      password: PROVIDER_PASS,
      email_confirm: true, // admin-verified fixture identity
    })
    // The live provider answers 200 (or 201 — both observed) for an
    // admin create; the important contract is the returned id.
    expect([200, 201]).toContain(created.status)
    expect(created.body.id).toBeTruthy()
    providerUserIds.push(created.body.id!)
    token = await providerPasswordToken(fixtureEmail, PROVIDER_PASS)
    expect(token.length).toBeGreaterThan(50)
  })

  test('forged token → AUTH_REQUIRED (the provider rejects it — the trust boundary)', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: 'forged-jwt-looking-token-abcdefghijklmnopqrstuvwxyz' })
    expect(status).toBe(401)
    expect(body.code).toBe('AUTH_REQUIRED')
  })

  test('verified identity with NO matching account → NO_SCHOLARIO_ACCOUNT (signup provisions nothing)', async () => {
    await heal()
    const created = await providerAdmin('POST', '/auth/v1/admin/users', {
      email: strangerEmail,
      password: PROVIDER_PASS,
      email_confirm: true,
    })
    providerUserIds.push(created.body.id!)
    const strangerToken = await providerPasswordToken(strangerEmail, PROVIDER_PASS)
    const { status, body } = await exchange({ accessToken: strangerToken })
    expect(status).toBe(403)
    expect(body.code).toBe('NO_SCHOLARIO_ACCOUNT')
  })

  test('matching account without ownership proof → LINK_PASSWORD_REQUIRED', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: token })
    expect(status).toBe(403)
    expect(body.code).toBe('LINK_PASSWORD_REQUIRED')
  })

  test('WRONG current password → rejected AND no pointer written (takeover blocked)', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: token, currentPassword: 'AttackerGuess999' })
    expect(status).toBe(401)
    expect(body.code).toBe('AUTH_REQUIRED')
    const row = await db.user.findUnique({ where: { id: fixtureUserId }, select: { authUserId: true } })
    expect(row?.authUserId).toBeNull()
  })

  // 20s timeout: the first full flow after a dev-server restart pays the
  // cold-compile of two routes (exchange + auth/me) plus the real provider
  // round trip — the documented first-hit cost, warm runs take <1s.
  test('correct current password → 200 + session + linked row + me() resolves the SAME account', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: token, currentPassword: APP_PASS })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data?.role).toBe('STUDENT')
    expect(body.data?.sessionToken).toBeTruthy() // dev bearer (production: HttpOnly cookie only)
    const row = await db.user.findUnique({ where: { id: fixtureUserId }, select: { authUserId: true, authLinkedAt: true } })
    expect(row?.authUserId).toBeTruthy()
    expect(row?.authLinkedAt).toBeTruthy()
    // The Scholario session resolves the canonical account (server-side
    // identity of record — never the provider id).
    const me = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${body.data?.sessionToken}` },
    })
    const meBody = await j(me)
    expect(me.status).toBe(200)
    expect(meBody.ok).toBe(true)
    expect(meBody.data?.user?.email ?? meBody.data?.email).toBe(fixtureEmail)
  }, 20000)

  test('re-exchange after linking → 200 WITHOUT the password (steady state)', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: token })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('cross-plane negative: the school identity CANNOT exchange on the platform endpoint (Phase 6)', async () => {
    await heal()
    const { status, body } = await exchange({ accessToken: token, currentPassword: APP_PASS }, 'platform')
    expect(status).toBe(403)
    expect(body.code).toBe('NO_SCHOLARIO_ACCOUNT')
  })

  test('cross-role negative: the provider session gets NO role elevation (STUDENT stays STUDENT)', async () => {
    await heal()
    const { body } = await exchange({ accessToken: token })
    const sessionToken = body.data?.sessionToken
    expect(sessionToken).toBeTruthy()
    // A teacher-gated API must reject the student session — the same
    // withUser role gate as any other session (the provider path mints
    // no privileges).
    const res = await fetch(`${BASE}/api/teachers`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    const rb = await j(res)
    expect(res.status).toBe(403)
    expect(rb.code).toBe('FORBIDDEN')
  })

  test('suspended account → AUTH_REQUIRED (generic — no status disclosure)', async () => {
    await heal()
    await db.user.update({ where: { id: fixtureUserId }, data: { status: 'SUSPENDED' } })
    try {
      const { status, body } = await exchange({ accessToken: token })
      expect(status).toBe(401)
      expect(body.code).toBe('AUTH_REQUIRED')
      expect(body.error?.toLowerCase()).not.toContain('suspend')
    } finally {
      await db.user.update({ where: { id: fixtureUserId }, data: { status: 'ACTIVE' } })
    }
  })
})
