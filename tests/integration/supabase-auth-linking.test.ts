/**
 * SUPABASE AUTH PHASE 1 — INTEGRATION: identity verification + account
 * resolution + linking (the anti-takeover core) against the real DB and
 * a local stub identity provider.
 *
 * The stub (started by this suite on an ephemeral port) implements the
 * GoTrue surface the server lib consumes: GET /auth/v1/user (token →
 * identity), the admin create/update endpoints, 401s for unknown
 * tokens. `SUPABASE_AUTH_API_BASE` points the lib at it IN THIS PROCESS
 * (the env is read per call — no import-order coupling), so the exact
 * HTTP contract is exercised with zero network and zero mocks of
 * internal logic.
 *
 * Self-cleaning: every row this suite creates carries the
 * `test-sa1-` prefix and is swept in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import {
  verifySupabaseAccessToken,
  validateE164Phone,
  resolveSchoolIdentity,
  resolvePlatformIdentity,
  linkSchoolAuthUser,
  linkPlatformAdminAuthUser,
  proveSchoolPasswordOwnership,
  provisionProviderPassword,
  type SupabaseVerifiedIdentity,
} from '@/lib/auth/supabase'
import { AppError } from '@/lib/security/errors'
import type { Server } from 'node:http'
import { createServer } from 'node:http'

const P = 'test-sa1-'
const TEST_PASS = 'ExchangePass123'
const ts = Date.now()

// ── Stub identity provider ────────────────────────────────────────────────

interface StubUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  phone?: string | null
  phone_confirmed_at?: string | null
}

const stubUsers = new Map<string, StubUser>() // token → user (mirrors a session)
const stubUsersById = new Map<string, StubUser>()
let stubServer: Server
let stubBase = ''

function stubToken(user: StubUser): string {
  const token = `stub-token-${user.id}-${Math.random().toString(36).slice(2)}`
  stubUsers.set(token, user)
  return token
}

beforeAll(async () => {
  stubServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      const user = stubUsers.get(token)
      if (!user) return send(401, { message: 'Invalid token' })
      return send(200, user)
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { email?: string; password?: string }
        if (!parsed.email) return send(422, { msg: 'email required' })
        const existing = [...stubUsersById.values()].find((u) => u.email === parsed.email)
        if (existing) return send(422, { msg: 'A user with this email address has already been registered' })
        const user: StubUser = { id: `stub-${Math.random().toString(36).slice(2, 12)}`, email: parsed.email, email_confirmed_at: null }
        stubUsersById.set(user.id, user)
        return send(201, user)
      })
      return
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      const user = stubUsersById.get(id)
      if (!user) return send(404, { msg: 'user not found' })
      return send(200, user)
    }
    return send(404, { message: 'not found' })
  })
  await new Promise<void>((resolve) => stubServer.listen(0, '127.0.0.1', resolve))
  const addr = stubServer.address() as { port: number }
  stubBase = `http://127.0.0.1:${addr.port}`
  process.env.SUPABASE_AUTH_API_BASE = stubBase
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'stub-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'stub-service-key'
})

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: `${P}` } } })
  await db.platformAdmin.deleteMany({ where: { email: { startsWith: `${P}` } } })
  await new Promise<void>((resolve) => stubServer.close(() => resolve()))
  delete process.env.SUPABASE_AUTH_API_BASE
})

// ── Fixtures ──────────────────────────────────────────────────────────────

async function schoolId(): Promise<string> {
  const s = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' }, select: { id: true } })
  if (!s) throw new Error('fixture school missing — run the canonical seed corpus first')
  return s.id
}

async function createTestUser(overrides: Partial<{ email: string; phone: string | null; role: string; passwordHash: string | null }> = {}) {
  const id = await schoolId()
  return db.user.create({
    data: {
      email: overrides.email ?? `${P}${ts}-${Math.random().toString(36).slice(2, 8)}@hawkings.test`,
      passwordHash: 'passwordHash' in overrides ? overrides.passwordHash : hashPassword(TEST_PASS),
      name: 'Supabase Auth Fixture',
      role: overrides.role ?? 'STUDENT',
      phone: overrides.phone ?? `+9198${Math.floor(100000000 + Math.random() * 899999999)}`,
      schoolId: id,
      status: 'ACTIVE',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })
}

const verifiedEmailUser = (email: string, id: string): StubUser => ({
  id,
  email,
  email_confirmed_at: new Date().toISOString(),
})

// ── Token verification (the trust boundary) ──────────────────────────────

describe('verifySupabaseAccessToken (server-side, via the provider contract)', () => {
  test('valid token → normalized identity with verification flags', async () => {
    const u = verifiedEmailUser(`${P}v@hawkings.test`, 'stub-id-1')
    const identity = await verifySupabaseAccessToken(stubToken(u))
    expect(identity.id).toBe('stub-id-1')
    expect(identity.email).toBe(u.email)
    expect(identity.emailVerified).toBe(true)
    expect(identity.phoneVerified).toBe(false)
  })

  test('unknown/invalid token → AUTH_REQUIRED (provider 401)', async () => {
    await expect(verifySupabaseAccessToken('forged-token-xyz')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    })
  })

  test('empty/oversized token → AUTH_REQUIRED before any network call', async () => {
    await expect(verifySupabaseAccessToken('')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(verifySupabaseAccessToken('x'.repeat(5000))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  test('provider payload without an identity id → AUTH_REQUIRED', async () => {
    const token = stubToken({ email: `${P}noid@hawkings.test`, email_confirmed_at: new Date().toISOString() } as StubUser)
    await expect(verifySupabaseAccessToken(token)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  test('provider unreachable → AUTH_PROVIDER_UNREACHABLE (honest 503, never a silent pass)', async () => {
    const saved = process.env.SUPABASE_AUTH_API_BASE
    process.env.SUPABASE_AUTH_API_BASE = 'http://127.0.0.1:1' // nothing listens
    try {
      await expect(verifySupabaseAccessToken('any-token-here-long-enough')).rejects.toMatchObject({
        code: 'AUTH_PROVIDER_UNREACHABLE',
      })
    } finally {
      process.env.SUPABASE_AUTH_API_BASE = saved
    }
  })
})

// ── E.164 phone validation ────────────────────────────────────────────────

describe('validateE164Phone', () => {
  test('accepts well-formed international numbers (normalized)', () => {
    expect(validateE164Phone('+919876543210')).toBe('+919876543210')
    expect(validateE164Phone('+1 (202) 555-0123')).toBe('+12025550123')
    expect(validateE164Phone('+44 20 7946 0958')).toBe('+442079460958')
  })
  test('rejects malformed numbers with INVALID_INPUT', () => {
    for (const bad of ['9876543210', '0123456789', '+0123456789', '+', '+9198', '+9198765432100000000']) {
      let code = ''
      try {
        validateE164Phone(bad)
      } catch (e) {
        code = (e as AppError).code
      }
      expect(code).toBe('INVALID_INPUT')
    }
  })
})

// ── Account resolution (server-only identity mapping) ─────────────────────

describe('resolveSchoolIdentity (school plane)', () => {
  test('linked pointer resolves directly — the steady state', async () => {
    const user = await createTestUser()
    await db.user.update({ where: { id: user.id }, data: { authUserId: 'stub-linked-1' } })
    const identity: SupabaseVerifiedIdentity = { id: 'stub-linked-1', email: user.email, emailVerified: true, phone: null, phoneVerified: false }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('linked')
    if (r.state === 'linked') expect(r.userId).toBe(user.id)
  })

  test('VERIFIED email on an unlinked account → linkable (ownership proof required)', async () => {
    const user = await createTestUser()
    const identity: SupabaseVerifiedIdentity = { id: `stub-${user.id}`, email: user.email, emailVerified: true, phone: null, phoneVerified: false }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('linkable')
    if (r.state === 'linkable') {
      expect(r.userId).toBe(user.id)
      expect(r.requireCurrentPassword).toBe(true)
    }
  })

  test('UNVERIFIED email NEVER links (anti-takeover: verification is the floor)', async () => {
    const user = await createTestUser()
    const identity: SupabaseVerifiedIdentity = { id: `stub-${user.id}`, email: user.email, emailVerified: false, phone: null, phoneVerified: false }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('none')
  })

  test('verified phone matching exactly ONE unlinked account → linkable', async () => {
    const phone = `+9198${Math.floor(100000000 + Math.random() * 899999999)}`
    const user = await createTestUser({ phone })
    const identity: SupabaseVerifiedIdentity = { id: `stub-${user.id}`, email: null, emailVerified: false, phone, phoneVerified: true }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('linkable')
  })

  test('verified phone shared by MULTIPLE accounts → safe ambiguous rejection (never a guess)', async () => {
    const phone = `+9197${Math.floor(100000000 + Math.random() * 899999999)}`
    await createTestUser({ phone })
    await createTestUser({ phone })
    const identity: SupabaseVerifiedIdentity = { id: 'stub-ambig', email: null, emailVerified: false, phone, phoneVerified: true }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('ambiguous-phone')
  })

  test('unknown identity → none (signup NEVER provisions an account)', async () => {
    const identity: SupabaseVerifiedIdentity = { id: 'stub-unknown', email: `${P}nobody@hawkings.test`, emailVerified: true, phone: null, phoneVerified: false }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state).toBe('none')
  })

  test('an account already linked to a DIFFERENT provider identity is not linkable by email', async () => {
    const user = await createTestUser()
    await db.user.update({ where: { id: user.id }, data: { authUserId: 'stub-owner-a' } })
    // A different provider identity holding the same verified email
    // (provider-side duplicate) must not steal the link.
    const identity: SupabaseVerifiedIdentity = { id: 'stub-attacker', email: user.email, emailVerified: true, phone: null, phoneVerified: false }
    const r = await resolveSchoolIdentity(identity)
    expect(r.state === 'none' || r.state === 'ambiguous-phone').toBe(true)
  })
})

describe('resolvePlatformIdentity (platform plane — disjoint store)', () => {
  test('verified email → linkable on PlatformAdmin; school users NEVER resolve here', async () => {
    const admin = await db.platformAdmin.create({
      data: {
        email: `${P}${ts}@platform.test`,
        passwordHash: hashPassword(TEST_PASS),
        name: 'SA Fixture Admin',
        status: 'ACTIVE',
        isRoot: false,
        totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      },
    })
    const identity: SupabaseVerifiedIdentity = { id: `stub-${admin.id}`, email: admin.email, emailVerified: true, phone: null, phoneVerified: false }
    const r = await resolvePlatformIdentity(identity)
    expect(r.state).toBe('linkable')

    // Phase-6 boundary: a SCHOOL user's email has no PlatformAdmin row →
    // the platform exchange would reject it (NO_SCHOLARIO_ACCOUNT).
    const schoolUser = await createTestUser()
    const schoolIdentity: SupabaseVerifiedIdentity = { id: `stub-${schoolUser.id}`, email: schoolUser.email, emailVerified: true, phone: null, phoneVerified: false }
    const r2 = await resolvePlatformIdentity(schoolIdentity)
    expect(r2.state).toBe('none')
  })
})

// ── Ownership proof (the anti-takeover gate) ──────────────────────────────

describe('proveSchoolPasswordOwnership', () => {
  test('correct current password → true', async () => {
    const user = await createTestUser()
    expect(await proveSchoolPasswordOwnership(user.id, TEST_PASS)).toBe(true)
  })
  test('WRONG current password → false (verified email alone never links)', async () => {
    const user = await createTestUser()
    expect(await proveSchoolPasswordOwnership(user.id, 'WrongPass999')).toBe(false)
    // and the takeover attempt left no pointer behind
    const row = await db.user.findUnique({ where: { id: user.id }, select: { authUserId: true } })
    expect(row?.authUserId).toBeNull()
  })
  test('missing hash → false (timing-burned)', async () => {
    const user = await createTestUser({ passwordHash: null })
    expect(await proveSchoolPasswordOwnership(user.id, TEST_PASS)).toBe(false)
  })
})

// ── Linking (race-safe) ───────────────────────────────────────────────────

describe('linkSchoolAuthUser', () => {
  test('first link writes pointer + timestamp', async () => {
    const user = await createTestUser()
    const link = await linkSchoolAuthUser(user.id, `stub-link-${user.id}`)
    expect(link.linked).toBe(true)
    const row = await db.user.findUnique({ where: { id: user.id }, select: { authUserId: true, authLinkedAt: true } })
    expect(row?.authUserId).toBe(`stub-link-${user.id}`)
    expect(row?.authLinkedAt).not.toBeNull()
  })
  test('guarded update: a second DIFFERENT identity cannot re-link the row', async () => {
    const user = await createTestUser()
    await linkSchoolAuthUser(user.id, 'stub-first')
    const second = await linkSchoolAuthUser(user.id, 'stub-second')
    expect(second.linked).toBe(false)
    if (!second.linked) expect(second.reason).toBe('conflict')
    const row = await db.user.findUnique({ where: { id: user.id }, select: { authUserId: true } })
    expect(row?.authUserId).toBe('stub-first')
  })
  test('UNIQUE index: one provider identity can never map to two accounts', async () => {
    const a = await createTestUser()
    const b = await createTestUser()
    const first = await linkSchoolAuthUser(a.id, 'stub-shared-id')
    expect(first.linked).toBe(true)
    const second = await linkSchoolAuthUser(b.id, 'stub-shared-id')
    expect(second.linked).toBe(false)
  })
})

describe('linkPlatformAdminAuthUser', () => {
  test('links and conflict-guards on the platform store', async () => {
    const admin = await db.platformAdmin.create({
      data: { email: `${P}${ts}-a@platform.test`, passwordHash: hashPassword(TEST_PASS), name: 'SA Admin 2', status: 'ACTIVE', isRoot: false, totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
    })
    expect((await linkPlatformAdminAuthUser(admin.id, 'stub-p-1')).linked).toBe(true)
    expect((await linkPlatformAdminAuthUser(admin.id, 'stub-p-2')).linked).toBe(false)
  })
})

// ── Provider provisioning (password-change cutover) ───────────────────────

describe('provisionProviderPassword (best-effort cutover)', () => {
  test('fresh email → provisioned with provider id', async () => {
    const out = await provisionProviderPassword({ email: `${P}${ts}-new@hawkings.test`, newPassword: 'NewPass1234' })
    expect(out.state).toBe('provisioned')
    if (out.state === 'provisioned') expect(out.authUserId).toMatch(/^stub-/)
  })
  test('existing unlinked provider email → honest skip (never a blind takeover)', async () => {
    const email = `${P}${ts}-exists@hawkings.test`
    await provisionProviderPassword({ email, newPassword: 'NewPass1234' })
    const out = await provisionProviderPassword({ email, newPassword: 'DifferentPass123' })
    expect(out.state).toBe('skipped')
  })
  test('linked account → provider password UPDATE', async () => {
    const out = await provisionProviderPassword({
      email: `${P}${ts}-upd@hawkings.test`,
      newPassword: 'NewPass1234',
      existingAuthUserId: 'stub-known-id',
    })
    // The stub PATCH only succeeds for known ids — register first.
    const made = await provisionProviderPassword({ email: `${P}${ts}-upd@hawkings.test`, newPassword: 'NewPass1234' })
    if (made.state === 'provisioned') {
      const upd = await provisionProviderPassword({ email: `${P}${ts}-upd@hawkings.test`, newPassword: 'Other12345', existingAuthUserId: made.authUserId })
      expect(upd.state).toBe('updated')
    } else {
      expect(out.state).toBe('failed')
    }
  })
  test('provider unreachable → honest failure (audited, never thrown)', async () => {
    const saved = process.env.SUPABASE_AUTH_API_BASE
    process.env.SUPABASE_AUTH_API_BASE = 'http://127.0.0.1:1'
    try {
      const out = await provisionProviderPassword({ email: `${P}${ts}-down@hawkings.test`, newPassword: 'NewPass1234' })
      expect(out.state).toBe('failed')
    } finally {
      process.env.SUPABASE_AUTH_API_BASE = saved
    }
  })
})
