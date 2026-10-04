/**
 * AUTH STABILIZATION GATE — the canonical authentication regression suite
 * (AUTH-01 … AUTH-14 + the Phase-13 role login matrix).
 *
 * Live HTTP against the dev server, exactly the surfaces a real browser
 * exercises. Every assertion is about OBSERVABLE behavior: envelope
 * shape, cookie contract, session authority, tenant derivation, TOTP
 * verification — never implementation details that can drift.
 *
 * Credentials come from the env-driven seed contract
 * (tests/helpers/credentials.ts ← prisma/seed-credentials.ts); TOTP codes
 * are computed with the SAME server library the routes use
 * (src/lib/platform/totp.ts) against the seeded demo secret.
 *
 * No secrets are printed. Fixtures created here (expired session probe)
 * are removed in afterAll; the canonical corpus is never mutated.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { hashSessionToken, isDevSessionBearerEnabled, sessionCookieOptions } from '@/lib/auth'
import {
  PLATFORM_ROOT_PASSWORD,
  PLATFORM_ROOT_TOTP_SECRET,
  TENANT_FIXTURE_PASSWORD,
} from '../helpers/credentials'
import { totpAt } from '@/lib/platform/totp'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

const HAWKINGS_PRINCIPAL = 'principal@hawkingshigh.edu'
const HAWKINGS_PRINCIPAL_PASSWORD = process.env.SEED_SHOWCASE_PRINCIPAL_PASSWORD ?? 'principal123'
const HAWKINGS_TEACHER = 'teacher1@hawkingshigh.edu'
const HAWKINGS_TEACHER_PASSWORD = process.env.SEED_SHOWCASE_TEACHER_PASSWORD ?? 'teacher123'
const HAWKINGS_STUDENT = 'aman.sah@hawkingshigh.edu'
const HAWKINGS_STUDENT_PASSWORD = process.env.SEED_SHOWCASE_STUDENT_PASSWORD ?? 'student123'
const GV_PRINCIPAL = 'principal@greenvalley.test'
const GV_TEACHER = 'teacher.b@greenvalley.test'
const GV_STUDENT = 'student.b@greenvalley.test'
const PLATFORM_ROOT = 'admin@scholario.cloud'

interface LoginEnvelope {
  ok: boolean
  error?: string
  code?: string
  requestId?: string
  data?: {
    id?: string
    email?: string
    name?: string
    role?: string
    schoolId?: string
    school?: { name?: string; slug?: string }
    sessionToken?: string
  }
}

/** Extract the erp_session cookie pair from a Set-Cookie header. */
function erpCookieFrom(res: Response): { cookie: string; raw: string; token: string } {
  const raw = res.headers.get('set-cookie') ?? ''
  const token = raw.includes('erp_session=') ? raw.split('erp_session=')[1].split(';')[0] : ''
  return { cookie: `erp_session=${token}`, raw, token }
}

/** School-plane login through the REAL front door. */
async function schoolLogin(email: string, password: string): Promise<{ res: Response; body: LoginEnvelope; cookie: ReturnType<typeof erpCookieFrom> }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json().catch(() => null)) as LoginEnvelope
  return { res, body, cookie: erpCookieFrom(res) }
}

/** Platform-plane MFA login through the REAL front door. */
async function platformLogin(
  email: string,
  password: string,
  totpCode?: string,
): Promise<{ res: Response; body: LoginEnvelope; cookieRaw: string }> {
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, totpCode }),
  })
  const body = (await res.json().catch(() => null)) as LoginEnvelope
  return { res, body, cookieRaw: res.headers.get('set-cookie') ?? '' }
}

async function meWith(cookie: string): Promise<{ res: Response; body: { ok: boolean; code?: string; data?: { user?: { role?: string; email?: string; school?: { name?: string } } } } }> {
  const res = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
  const body = (await res.json().catch(() => null)) as { ok: boolean; code?: string; data?: { user?: { role?: string; email?: string; school?: { name?: string } } } }
  return { res, body }
}

let hawkingsStudentId = ''
const probeSessions: string[] = []

/**
 * Heal the loopback IP budget before each test. Rationale: this suite
 * performs ~18 REAL logins from one loopback IP; the strict shared-budget
 * limiter (production semantics, DB-backed) would otherwise 429-shadow
 * later tests — exactly the pollution pattern tests/helpers/login-buckets
 * exists for. Account buckets are NOT healed per-test (each successful
 * login resets its own account bucket server-side; only the shared IP
 * budget accumulates across accounts). No disconnect: the db singleton is
 * process-wide shared.
 */
async function healIpBudget(): Promise<void> {
  await db.rateLimitBucket
    .deleteMany({ where: { key: { in: ['rl:login:ip:127.0.0.1', 'rl:login:ip:::1'] } } })
    .catch(() => {})
}

beforeEach(healIpBudget)

beforeAll(async () => {
  await resetLoginBuckets([
    HAWKINGS_PRINCIPAL,
    HAWKINGS_TEACHER,
    HAWKINGS_STUDENT,
    GV_PRINCIPAL,
    GV_TEACHER,
    GV_STUDENT,
  ])
  // Heal the platform-plane buckets too (same rationale; the strict
  // limiter is DB-backed and a re-run can start inside a stale window).
  try {
    await db.rateLimitBucket.deleteMany({
      where: { key: { startsWith: 'rl:pf-login:' } },
    })
  } catch {
    /* hygiene only */
  }
  const hawk = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  const hawkStudent = await db.student.findFirst({
    where: { schoolId: hawk?.id },
    orderBy: { admissionNo: 'asc' },
  })
  hawkingsStudentId = hawkStudent?.id ?? ''
}, 60_000)

afterAll(async () => {
  for (const hash of probeSessions) {
    await db.session.deleteMany({ where: { tokenHash: hash } }).catch(() => {})
  }
})

// ─── AUTH-01 · valid principal login ───────────────────────────────────
describe('AUTH-01 valid principal login', () => {
  test(
    '200 envelope: correct identity, role, tenant + session cookie',
    async () => {
      const { res, body, cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.data?.role).toBe('PRINCIPAL')
      expect(body.data?.email).toBe(HAWKINGS_PRINCIPAL)
      expect(body.data?.school?.slug).toBe('hawkings-prithvipur')
      expect(body.data?.school?.name).toBe('Hawkings High School Prithvipur')
      expect(cookie.token).toMatch(/^[a-f0-9]{64}$/)
      // The session row exists, keyed by the HASH of the wire token.
      const row = await db.session.findUnique({ where: { tokenHash: hashSessionToken(cookie.token) } })
      expect(row?.userId).toBe(body.data?.id)
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
    },
    T,
  )
})

// ─── AUTH-02 · invalid password ────────────────────────────────────────
describe('AUTH-02 invalid password', () => {
  test(
    'clean 401, no session minted, no cookie, anti-enumeration message',
    async () => {
      const before = await db.session.count({ where: { user: { email: HAWKINGS_PRINCIPAL } } })
      const { res, body, cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, 'definitely-wrong-password')
      expect(res.status).toBe(401)
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
      expect(body.error).toBe('Invalid email or password')
      // Correlation: every failure carries a requestId (also the
      // X-Request-Id response header).
      expect(typeof body.requestId).toBe('string')
      expect(res.headers.get('x-request-id')).toBeTruthy()
      // No session, no cookie.
      expect(cookie.raw).toBe('')
      const after = await db.session.count({ where: { user: { email: HAWKINGS_PRINCIPAL } } })
      expect(after).toBe(before)
    },
    T,
  )
  test(
    'unknown email is indistinguishable from a wrong password',
    async () => {
      // Unique per run: the nonexistent account can never be "successfully
      // signed in", so its ACCOUNT bucket can only ever accumulate — a
      // fixed address would 429-shadow this test on suite re-runs.
      const ghost = `ghost.${Date.now()}@hawkingshigh.edu`
      const { res, body } = await schoolLogin(ghost, 'whatever123')
      expect(res.status).toBe(401)
      expect(body.error).toBe('Invalid email or password')
      expect(body.code).toBe('AUTH_REQUIRED')
    },
    T,
  )
})

// ─── AUTH-03 · tenant isolation (session-derived tenant) ───────────────
describe('AUTH-03 tenant isolation', () => {
  test(
    'authenticated tenant comes from the session, never from query/client state',
    async () => {
      const { body, cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      expect(body.ok).toBe(true)
      // Forge every client-side tenant selector: the ?schoolId= query, a
      // foreign slug, and a foreign-tenant resource id. The server must
      // derive the tenant ONLY from the session row.
      const forged = await fetch(`${BASE}/api/auth/me?schoolId=${'x'}&slug=green-valley`, {
        headers: { cookie: cookie.cookie },
      })
      const me = (await forged.json()) as { data?: { user?: { school?: { slug?: string } } } }
      expect(forged.status).toBe(200)
      expect(me.data?.user?.school?.slug).toBe('hawkings-prithvipur')
      // Foreign-tenant by-id lookup: a REAL Green Valley student row
      // (probe fixture — the clean tenant is deliberately empty) must be
      // 404 for the Hawkings principal (no existence oracle), never data.
      const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
      expect(gv).toBeTruthy()
      const probeUser = await db.user.create({
        data: {
          schoolId: gv!.id,
          email: `authgate-probe-${Date.now()}@greenvalley.test`,
          passwordHash: hashSessionToken(randomBytes(32).toString('hex')), // inert credential
          name: 'AUTH GATE PROBE',
          role: 'STUDENT',
        },
      })
      const probe = await db.student.create({
        data: {
          schoolId: gv!.id,
          userId: probeUser.id,
          admissionNo: `authgate-${Date.now()}`,
          rollNo: '1',
        },
      })
      try {
        const cross = await fetch(`${BASE}/api/students/${probe.id}`, {
          headers: { cookie: cookie.cookie },
        })
        expect(cross.status).toBe(404)
        const crossBody = (await cross.json().catch(() => null)) as { ok?: boolean } | null
        expect(crossBody?.ok).toBe(false)
      } finally {
        await db.student.delete({ where: { id: probe.id } }).catch(() => {})
        await db.user.delete({ where: { id: probeUser.id } }).catch(() => {})
        await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
      }
    },
    T,
  )
})

// ─── AUTH-04 · session persistence ─────────────────────────────────────
describe('AUTH-04 session persistence', () => {
  test(
    '/api/auth/me stays authenticated across repeated calls (cookie-only authority)',
    async () => {
      const { cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      const first = await meWith(cookie.cookie)
      const second = await meWith(cookie.cookie)
      expect(first.res.status).toBe(200)
      expect(second.res.status).toBe(200)
      expect(first.body.data?.user?.role).toBe('PRINCIPAL')
      expect(second.body.data?.user?.email).toBe(HAWKINGS_PRINCIPAL)
      expect(second.body.data?.user?.school?.name).toBe('Hawkings High School Prithvipur')
      // The cookie transport alone carries the session: no client-side
      // state, no bearer header — exactly the Safari/first-party contract.
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
    },
    T,
  )
})

// ─── AUTH-05 · logout invalidation ─────────────────────────────────────
describe('AUTH-05 logout', () => {
  test(
    'logout destroys the session: me → 401, protected school API → 401',
    async () => {
      const { cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      const tokenHash = hashSessionToken(cookie.token)
      expect(await db.session.findUnique({ where: { tokenHash } })).toBeTruthy()

      const out = await fetch(`${BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookie.cookie },
      })
      expect(out.status).toBe(200)

      // The session ROW is gone (server-side authority, not just a
      // cleared cookie).
      expect(await db.session.findUnique({ where: { tokenHash } })).toBeNull()
      // Even a REPLAYED cookie is dead:
      const me = await meWith(cookie.cookie)
      expect(me.res.status).toBe(401)
      expect(me.body.code).toBe('AUTH_REQUIRED')
      const guarded = await fetch(`${BASE}/api/students`, { headers: { cookie: cookie.cookie } })
      expect(guarded.status).toBe(401)
    },
    T,
  )
})

// ─── AUTH-06 · expired session ─────────────────────────────────────────
describe('AUTH-06 expired session', () => {
  test(
    'an expired session row is refused (401) even with its valid cookie',
    async () => {
      const principal = await db.user.findUnique({ where: { email: HAWKINGS_PRINCIPAL } })
      expect(principal).toBeTruthy()
      const token = randomBytes(32).toString('hex')
      const tokenHash = hashSessionToken(token)
      probeSessions.push(tokenHash)
      await db.session.create({
        data: {
          userId: principal!.id,
          tokenHash,
          expiresAt: new Date(Date.now() - 60_000), // already expired
        },
      })
      const me = await meWith(`erp_session=${token}`)
      expect(me.res.status).toBe(401)
      expect(me.body.ok).toBe(false)
      expect(me.body.code).toBe('AUTH_REQUIRED')
    },
    T,
  )
})

// ─── AUTH-07 · platform admin password ─────────────────────────────────
describe('AUTH-07 platform admin password', () => {
  test(
    'wrong platform password → 401 AUTH_REQUIRED, no platform session minted',
    async () => {
      const before = await db.platformAdminSession.count()
      const { res, body } = await platformLogin(PLATFORM_ROOT, 'not-the-platform-password', totpAt(PLATFORM_ROOT_TOTP_SECRET))
      expect(res.status).toBe(401)
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
      expect(typeof body.requestId).toBe('string')
      expect(await db.platformAdminSession.count()).toBe(before)
    },
    T,
  )
})

// ─── AUTH-08 · platform admin TOTP (the full MFA path) ──────────────────
describe('AUTH-08 platform admin TOTP', () => {
  test(
    'email + password + valid TOTP → session + HttpOnly cookie + auth/me ok',
    async () => {
      const { res, body, cookieRaw } = await platformLogin(
        PLATFORM_ROOT,
        PLATFORM_ROOT_PASSWORD,
        totpAt(PLATFORM_ROOT_TOTP_SECRET),
      )
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.data as { admin?: { isRoot?: boolean } } | undefined)?.admin?.isRoot).toBe(true)
      // Cookie contract on the platform plane:
      expect(cookieRaw).toContain('scholario_platform_session=')
      expect(cookieRaw).toContain('HttpOnly')
      expect(cookieRaw).toContain('SameSite=lax')
      expect(cookieRaw).toContain('Path=/')
      const me = await fetch(`${BASE}/api/platform/auth/me`, { headers: { cookie: cookieRaw } })
      const meBody = (await me.json()) as { ok: boolean; data?: { admin?: { email?: string } } }
      expect(me.status).toBe(200)
      expect(meBody.data?.admin?.email).toBe(PLATFORM_ROOT)
      // Clean up: sign out through the real route.
      const out = await fetch(`${BASE}/api/platform/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookieRaw },
      })
      expect(out.status).toBe(200)
      const meAfter = await fetch(`${BASE}/api/platform/auth/me`, { headers: { cookie: cookieRaw } })
      expect(meAfter.status).toBe(401)
    },
    T,
  )
})

// ─── AUTH-09 · invalid TOTP ────────────────────────────────────────────
describe('AUTH-09 invalid TOTP', () => {
  test(
    'valid password + wrong code → 401 MFA_INVALID, no session minted',
    async () => {
      const before = await db.platformAdminSession.count()
      const { res, body } = await platformLogin(PLATFORM_ROOT, PLATFORM_ROOT_PASSWORD, '000000')
      expect(res.status).toBe(401)
      expect(body.ok).toBe(false)
      expect(body.code).toBe('MFA_INVALID')
      expect(body.error).toBe('Invalid authenticator code')
      expect(await db.platformAdminSession.count()).toBe(before)
    },
    T,
  )
  test(
    'missing code → 401 MFA_REQUIRED (password alone NEVER signs in)',
    async () => {
      const { res, body } = await platformLogin(PLATFORM_ROOT, PLATFORM_ROOT_PASSWORD, undefined)
      expect(res.status).toBe(401)
      expect(body.code).toBe('MFA_REQUIRED')
      expect(body.error).toBe('Enter your authenticator code')
    },
    T,
  )
})

// ─── AUTH-10 · platform/school tenant-plane separation ──────────────────
describe('AUTH-10 platform tenant isolation (plane separation)', () => {
  test(
    'a SCHOOL session is refused by every platform endpoint; a PLATFORM session is refused by school endpoints',
    async () => {
      // School cookie → platform API: 401 (school identities can never
      // touch the control plane).
      const { cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      const asPlatform = await fetch(`${BASE}/api/platform/auth/me`, { headers: { cookie: cookie.cookie } })
      expect(asPlatform.status).toBe(401)
      const asPlatformList = await fetch(`${BASE}/api/platform/schools`, { headers: { cookie: cookie.cookie } })
      expect(asPlatformList.status).toBe(401)
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })

      // Platform cookie → school API: 401 (the two credential spaces are
      // disjoint by construction).
      const { cookieRaw } = await platformLogin(PLATFORM_ROOT, PLATFORM_ROOT_PASSWORD, totpAt(PLATFORM_ROOT_TOTP_SECRET))
      const asSchool = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: cookieRaw } })
      expect(asSchool.status).toBe(401)
      const asSchoolData = await fetch(`${BASE}/api/students`, { headers: { cookie: cookieRaw } })
      expect(asSchoolData.status).toBe(401)
      await fetch(`${BASE}/api/platform/auth/logout`, { method: 'POST', headers: { cookie: cookieRaw } })
    },
    T,
  )
})

// ─── AUTH-11 · development bypass is production-hard-disabled ───────────
describe('AUTH-11 development bypass disabled in production', () => {
  test('the dev Bearer fallback hard-disables under NODE_ENV=production (no env can re-enable)', () => {
    const prev = process.env.NODE_ENV
    const prevFlag = process.env.SCHOLARIO_DEV_BEARER
    try {
      process.env.SCHOLARIO_DEV_BEARER = '1' // even with the flag ON
      process.env.NODE_ENV = 'production'
      expect(isDevSessionBearerEnabled()).toBe(false)
      process.env.SCHOLARIO_DEV_BEARER = undefined
      expect(isDevSessionBearerEnabled()).toBe(false)
    } finally {
      process.env.NODE_ENV = prev
      process.env.SCHOLARIO_DEV_BEARER = prevFlag
    }
  })
  test('no auth-bypass flag exists anywhere in the source tree (static contract)', async () => {
    // AUTH_BYPASS / SKIP_AUTH / DISABLE_AUTH must not exist as env flags.
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const root = join(import.meta.dir, '..', '..')
    const bad = /(?:AUTH_BYPASS|SKIP_AUTH|DISABLE_AUTH)\s*[:=]/i
    const found: string[] = []
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
        const p = join(dir, entry.name)
        if (entry.isDirectory()) await walk(p)
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          const text = await readFile(p, 'utf8')
          if (bad.test(text)) found.push(p)
        }
      }
    }
    await walk(join(root, 'src'))
    expect(found).toEqual([])
  })
})

// ─── AUTH-12 · cookie security ─────────────────────────────────────────
describe('AUTH-12 cookie security', () => {
  test(
    'live login Set-Cookie: HttpOnly, SameSite=Lax, Path=/ (Secure only in production)',
    async () => {
      const { cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      expect(cookie.raw).toContain('erp_session=')
      expect(cookie.raw).toContain('HttpOnly')
      expect(cookie.raw).toContain('SameSite=lax')
      expect(cookie.raw).toContain('Path=/')
      expect(cookie.raw).toMatch(/Max-Age=\d+/)
      // The token is never marked readable by JavaScript: no `Secure` in
      // plain-HTTP dev, but the prod policy adds it (pure assertion):
      const dev = sessionCookieOptions(false)
      const prod = sessionCookieOptions(true)
      expect(dev.httpOnly && dev.sameSite === 'lax' && dev.path === '/').toBe(true)
      expect(dev.secure).toBe(false)
      expect(prod.secure).toBe(true)
      expect(prod.httpOnly).toBe(true)
      expect(prod.sameSite).toBe('lax')
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
    },
    T,
  )
})

// ─── AUTH-13 · duplicate login submission / idempotency ─────────────────
describe('AUTH-13 duplicate login submission', () => {
  test(
    'two parallel identical logins: both succeed, distinct tokens, both sessions valid',
    async () => {
      const [a, b] = await Promise.all([
        schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD),
        schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD),
      ])
      expect(a.res.status).toBe(200)
      expect(b.res.status).toBe(200)
      // Each sign-in mints its OWN session (rotation per sign-in; no
      // shared/merged state, no replay of one token).
      expect(a.cookie.token).not.toBe(b.cookie.token)
      const meA = await meWith(a.cookie.cookie)
      const meB = await meWith(b.cookie.cookie)
      expect(meA.res.status).toBe(200)
      expect(meB.res.status).toBe(200)
      expect(meA.body.data?.user?.email).toBe(HAWKINGS_PRINCIPAL)
      expect(meB.body.data?.user?.email).toBe(HAWKINGS_PRINCIPAL)
      await db.session.deleteMany({
        where: { tokenHash: { in: [hashSessionToken(a.cookie.token), hashSessionToken(b.cookie.token)] } },
      })
    },
    T,
  )
})

// ─── AUTH-14 · mobile/Safari-compatible session contract ────────────────
describe('AUTH-14 mobile/Safari session contract', () => {
  test(
    'session rides ONLY on a first-party SameSite=Lax cookie — no client-storage dependency',
    async () => {
      const { cookie } = await schoolLogin(HAWKINGS_PRINCIPAL, HAWKINGS_PRINCIPAL_PASSWORD)
      // Safari-compatible contract: the ONLY thing the server needs is the
      // cookie header. No localStorage token, no bearer, no client state —
      // a request carrying nothing but the cookie stays authenticated.
      const me = await fetch(`${BASE}/api/auth/me`, {
        headers: { cookie: cookie.cookie, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' },
      })
      expect(me.status).toBe(200)
      // SameSite=Lax (not None): works in every iOS Safari without
      // third-party cookie permissions; never depends on partitioned
      // storage or cross-site iframe cookies.
      expect(cookie.raw).toContain('SameSite=lax')
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
    },
    T,
  )
})

// ─── Phase-13 · role login matrix (both tenants, every school role) ─────
describe('role login matrix (Phase 13)', () => {
  const matrix = [
    { label: 'Hawkings principal', email: HAWKINGS_PRINCIPAL, password: HAWKINGS_PRINCIPAL_PASSWORD, role: 'PRINCIPAL', school: 'Hawkings High School Prithvipur' },
    { label: 'Hawkings teacher', email: HAWKINGS_TEACHER, password: HAWKINGS_TEACHER_PASSWORD, role: 'TEACHER', school: 'Hawkings High School Prithvipur' },
    { label: 'Hawkings student', email: HAWKINGS_STUDENT, password: HAWKINGS_STUDENT_PASSWORD, role: 'STUDENT', school: 'Hawkings High School Prithvipur' },
    { label: 'Green Valley principal', email: GV_PRINCIPAL, password: TENANT_FIXTURE_PASSWORD, role: 'PRINCIPAL', school: 'Green Valley Public School' },
    { label: 'Green Valley teacher', email: GV_TEACHER, password: TENANT_FIXTURE_PASSWORD, role: 'TEACHER', school: 'Green Valley Public School' },
    { label: 'Green Valley student', email: GV_STUDENT, password: TENANT_FIXTURE_PASSWORD, role: 'STUDENT', school: 'Green Valley Public School' },
  ]
  for (const m of matrix) {
    test(
      `${m.label}: login → correct role + tenant → refresh stays valid → logout kills`,
      async () => {
        const { res, body, cookie } = await schoolLogin(m.email, m.password)
        expect(res.status).toBe(200)
        expect(body.data?.role).toBe(m.role)
        expect(body.data?.school?.name).toBe(m.school)
        // "Refresh": a second, cookie-only /api/auth/me must return the
        // SAME server-side identity (role/tenant never client-derived).
        const me = await meWith(cookie.cookie)
        expect(me.res.status).toBe(200)
        expect(me.body.data?.user?.role).toBe(m.role)
        expect(me.body.data?.user?.school?.name).toBe(m.school)
        // Logout → guarded surface is closed again.
        await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: cookie.cookie } })
        const after = await meWith(cookie.cookie)
        expect(after.res.status).toBe(401)
      },
      T,
    )
  }
  test(
    'cross-tenant attack: Green Valley principal cannot read a Hawkings student (404, no oracle)',
    async () => {
      const { cookie } = await schoolLogin(GV_PRINCIPAL, TENANT_FIXTURE_PASSWORD)
      const probe = await fetch(`${BASE}/api/students/${hawkingsStudentId}`, {
        headers: { cookie: cookie.cookie },
      })
      expect(probe.status).toBe(404)
      const body = (await probe.json().catch(() => null)) as { ok?: boolean } | null
      expect(body?.ok).toBe(false)
      await db.session.deleteMany({ where: { tokenHash: hashSessionToken(cookie.token) } })
    },
    T,
  )
})

// ─── Envelope safety ────────────────────────────────────────────────────
describe('auth error envelope safety', () => {
  test(
    'failure envelopes expose ONLY {ok,error,code,requestId} — no internals',
    async () => {
      const { body } = await schoolLogin(HAWKINGS_PRINCIPAL, 'wrong')
      const serialized = JSON.stringify(body)
      for (const forbidden of ['passwordHash', 'totpSecret', 'tokenHash', 'stack', 'Prisma', 'database']) {
        expect(serialized.includes(forbidden)).toBe(false)
      }
      expect(body.ok).toBe(false)
      expect(Object.keys(body).sort()).toEqual(['code', 'error', 'ok', 'requestId'])
    },
    T,
  )
  test(
    'malformed bodies are rejected without crashing the route',
    async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: '', extra: 'field' }),
      })
      expect([400, 422]).toContain(res.status)
      const body = (await res.json()) as { ok?: boolean; code?: string }
      expect(body.ok).toBe(false)
      expect(['VALIDATION_FAILED', 'INVALID_INPUT']).toContain(body.code)
    },
    T,
  )
})
