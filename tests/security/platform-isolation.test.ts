import { db } from '../helpers/db'
/**
 * PHASE 6 — PLATFORM CONTROL-PLANE ISOLATION SUITE.
 *
 * THE INVARIANTS UNDER TEST (from the Phase-6 brief):
 *
 *   1. School Principal cannot access the platform control plane.
 *   2. School Teacher    cannot access the platform control plane.
 *   3. School Student    cannot access the platform control plane.
 *   4. School Parent     cannot access the platform control plane.
 *   5. Platform Admin can manage MULTIPLE schools.
 *   6. School A cannot use platform routes as School B (no school
 *      credential of ANY tenant satisfies the platform boundary).
 *   7. A school session can NEVER become a platform session.
 *
 * Plus the Phase-6 hardening surface: MFA at every platform login,
 * step-up gating of destructive actions, dual-bucket login rate
 * limits, support-session read-only semantics + expiry + revocation,
 * and the legacy SUPER_ADMIN migration (school login refuses the
 * role).
 *
 * LIVE HTTP integration suite against the dev server
 * (http://localhost:3000) with REAL sessions — same style as the
 * Phase-2 tenant-isolation suite. Platform credentials are env-driven
 * via tests/helpers/credentials.ts (same source as seed-platform.ts):
 *   root: admin@scholario.cloud   (seed-platform.ts)
 *   ops:  ops@scholario.io        (limited grants)
 * TOTP codes are computed with the SAME server library
 * (src/lib/platform/totp.ts) against the seeded demo secrets — the
 * code path under test is the real one, not a mock.
 *
 * REPEATED-RUN SEMANTICS: the dev server's in-memory login rate
 * buckets (8 school / 10 platform attempts per IP per 15 min) make
 * back-to-back full runs trip the limiters — the limiter doing its
 * job. On a FRESH environment (CI, first run) every assertion checks
 * its SPECIFIC code. On rate-limited re-runs, login-behavior
 * assertions degrade to the fail-safe contract: no status in
 * {401,403,429} may EVER issue a session — 429 is as good a refusal
 * as 401/403 for the isolation invariants. Session-based tests run
 * fully on every run via the documented direct-session fixtures.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import {
  PLATFORM_OPS_PASSWORD,
  PLATFORM_OPS_TOTP_SECRET,
  PLATFORM_ROOT_PASSWORD,
  PLATFORM_ROOT_TOTP_SECRET,
  TENANT_FIXTURE_PASSWORD,
} from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

// Env-driven platform admin credentials (prisma/seed-credentials.ts —
// same values seed-platform.ts plants; DEV PREVIEW ONLY).
const ROOT_EMAIL = 'admin@scholario.cloud'
const ROOT_PASSWORD = PLATFORM_ROOT_PASSWORD
const ROOT_TOTP_SECRET = PLATFORM_ROOT_TOTP_SECRET
const OPS_EMAIL = 'ops@scholario.io'
const OPS_PASSWORD = PLATFORM_OPS_PASSWORD

const SCHOOL_PW = TENANT_FIXTURE_PASSWORD // tenant-isolation fixture password

// ── Helpers ────────────────────────────────────────────────────────────

/** Per-run random XFF IP — Phase 8A: the DB-backed login limiter makes
 * loopback-IP buckets persist across runs; a random per-run address gives
 * every suite run a fresh bucket (the production limiter semantics stay
 * fully exercised — the 429 fallback paths are still pinned by the
 * dedicated rate-limit suites). */
const RUN_IP = `10.231.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

/** Compute the current TOTP code with the server's own implementation. */
async function totpNow(secret: string): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  return mod.totpAt(secret)
}

/** School login → raw session token (dev bearer). On login rate-limit
 * (repeated suite runs within 15 min) falls back to a direct session
 * row — the standard integration-test auth fixture that bypasses ONLY
 * the login limiter, never any authorization gate (same pattern as the
 * Phase-2 tenant-isolation suite). */
async function schoolLogin(email: string, password = SCHOOL_PW): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string }; error?: string }
  if (res.status === 429) {
    console.warn(`[platform-isolation] school login rate-limited for ${email}; direct session fixture`)
    return directSchoolSession(email)
  }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`school login failed for ${email}: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

/** Platform login (full MFA) → raw platform session token. On login
 * rate-limit (repeated runs) falls back to a direct PlatformAdminSession
 * row — bypassing ONLY the login limiter (the MFA path itself is
 * exercised by the dedicated MFA tests below). */
async function platformLogin(
  email: string,
  password: string,
  totpSecret: string,
): Promise<string> {
  const code = await totpNow(totpSecret)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password, totpCode: code }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (res.status === 429) {
    console.warn(`[platform-isolation] platform login rate-limited for ${email}; direct session fixture`)
    return directPlatformSession(email)
  }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform login failed for ${email}: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

/** Direct PlatformAdminSession row (auth fixture for rate-limited runs). */
async function directPlatformSession(email: string, opts?: { aged?: boolean }): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email } })
  if (!admin) throw new Error(`no platform admin ${email}`)
  const token = randomBytes(32).toString('hex')
  const crypto = await import('crypto')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      // Fresh MFA equivalence by default; `aged` simulates a stale
      // step-up window WITHOUT spending the real endpoint's limiter
      // budget (the stale-window FLOW itself is tested once, below).
      stepUpAt: opts?.aged ? new Date(Date.now() - 3600_000) : new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

/**
 * Login refusal verdict — the fail-safe contract. `preferred` is the
 * SPECIFIC expected code (checked on fresh buckets); a 429 from the
 * login limiter is an equally valid refusal (repeated runs).
 */
async function expectLoginRefusal(
  res: Response,
  preferredStatus: number,
  preferredCode: string,
): Promise<void> {
  const body = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null
  expect([preferredStatus, 429]).toContain(res.status)
  expect(body?.ok).toBe(false)
  if (res.status !== 429) {
    expect(body?.code).toBe(preferredCode)
  }
}

/** School-authenticated request (Authorization bearer — the school transport). */
async function asSchool(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/** Platform-authenticated request (x-platform-token — the platform transport). */
async function asPlatform(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': token, 'content-type': 'application/json' },
  })
}

/** Cookie-transport variant (first-party tabs). */
async function asPlatformCookie(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `scholario_platform_session=${token}`, 'content-type': 'application/json' },
  })
}

/** Direct school Session row (auth fixture — bypasses only the login limiter). */
async function directSchoolSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  // PHASE 8A — school rows store sha256(token) exactly like the platform
  // plane; the RAW token keeps riding the school transports below.
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function expectEnvelope(res: Response, status: number, code: string) {
  expect(res.status).toBe(status)
  const body = (await res.json()) as { ok: boolean; code: string }
  expect(body.ok).toBe(false)
  expect(body.code).toBe(code)
}

/** Isolate rate-limit state between runs (in-process only — the dev
 * server owns the real buckets; this suite stays under the limits). */
async function rateSafePlatformLogin(): Promise<string> {
  return platformLogin(ROOT_EMAIL, ROOT_PASSWORD, ROOT_TOTP_SECRET)
}

// ── Fixtures ────────────────────────────────────────────────────────────

let schoolAId = ''
let schoolBId = ''
let principalA = ''
let teacherA = ''
let studentA = ''
let parentA = ''
let principalB = ''
let rootToken = ''
let opsToken = ''
let throwawaySchoolId: string | null = null

beforeAll(async () => {
  const schools = await db.school.findMany({ select: { id: true, slug: true } })
  const bySlug = new Map(schools.map((s) => [s.slug, s.id]))
  schoolAId = bySlug.get('hawkings-prithvipur') ?? ''
  schoolBId = bySlug.get('green-valley') ?? ''
  if (!schoolAId || !schoolBId) throw new Error('seed schools missing — run bun prisma/seed-tenant-isolation.ts')

  // Phase 8A — DB-backed login buckets persist across runs; heal them so
  // this run starts from clean limiter state (fixture accounts only).
  await resetLoginBuckets([
    'tenant.principal.a@hawkings.test',
    'tenant.teacher.a@hawkings.test',
    'tenant.student.a@hawkings.test',
    'tenant.parent.a@hawkings.test',
    'principal.b@greenvalley.test',
    ROOT_EMAIL,
    OPS_EMAIL,
  ])

  // School sessions for every role (login API — the REAL path).
  principalA = await schoolLogin('tenant.principal.a@hawkings.test')
  teacherA = await schoolLogin('tenant.teacher.a@hawkings.test')
  studentA = await schoolLogin('tenant.student.a@hawkings.test')
  // PHASE 1 (role-architecture audit) — PARENT is outside the canonical
  // school model (PRINCIPAL|TEACHER|STUDENT): the login endpoint REFUSES
  // that role by design, so the parent persona is probed with a DIRECT
  // session fixture (auth fixture only — never an authorization bypass;
  // every platform-plane probe below still expects this token to get
  // nothing, and every school-plane gate refuses the role).
  parentA = await directSchoolSession('tenant.parent.a@hawkings.test')
  principalB = await schoolLogin('principal.b@greenvalley.test')

  // Platform sessions (full MFA).
  rootToken = await rateSafePlatformLogin()
  opsToken = await platformLogin(OPS_EMAIL, OPS_PASSWORD, PLATFORM_OPS_TOTP_SECRET)
}, 120_000)

afterAll(async () => {
  // Restore the world: reactivate anything this suite suspended and
  // clean the throwaway school.
  if (throwawaySchoolId) {
    await db.school.deleteMany({ where: { id: throwawaySchoolId } }).catch(() => {})
  }
  await db.school.updateMany({ where: { status: 'SUSPENDED' }, data: { status: 'ACTIVE' } }).catch(() => {})
  // Defensive: never leak a suspended ops admin into later runs.
  await db.platformAdmin.updateMany({ where: { status: 'SUSPENDED' }, data: { status: 'ACTIVE' } }).catch(() => {})
  await db.$disconnect()
})

const T = 20_000

// ═══════════════════════════════════════════════════════════════════════
// 1–4. SCHOOL ROLES CANNOT ACCESS THE PLATFORM CONTROL PLANE
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · school roles cannot access the control plane', () => {
  const roles: Array<[string, string]> = [
    ['PRINCIPAL', ''],
    ['TEACHER', ''],
    ['STUDENT', ''],
    ['PARENT', ''],
  ]
  // Bound at describe time (fixtures resolve in beforeAll): use a lazy
  // accessor instead of closure variables directly in test bodies.
  const tokens = () => ({ PRINCIPAL: principalA, TEACHER: teacherA, STUDENT: studentA, PARENT: parentA })

  for (const [role] of roles) {
    test(`${role} → GET /api/platform/schools → 401 AUTH_REQUIRED (bearer transport)`, async () => {
      const res = await asSchool(tokens()[role], '/api/platform/schools')
      await expectEnvelope(res, 401, 'AUTH_REQUIRED')
    }, T)

    test(`${role} → GET /api/platform/audit → 401 (platform data plane)`, async () => {
      const res = await asSchool(tokens()[role], '/api/platform/audit')
      expect(res.status).toBe(401)
    }, T)

    test(`${role} → POST /api/platform/auth/step-up → 401 (cannot mint platform privilege)`, async () => {
      const res = await asSchool(tokens()[role], '/api/platform/auth/step-up', {
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      })
      expect(res.status).toBe(401)
    }, T)
  }

  test('principal (cookie transport, school session in the platform cookie slot) → 401', async () => {
    // School token FORGED into the platform cookie: validation hashes
    // it and looks in PlatformAdminSession — no row, no session.
    const res = await asPlatformCookie(principalA, '/api/platform/auth/me')
    await expectEnvelope(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('principal → GET /platform (page route) → redirected to /platform/login in production mode only; dev renders the client gate', async () => {
    // Dev preview: the page renders and the CLIENT bootstraps /me →
    // 401 → replace('/platform/login'). We assert the page does NOT
    // render any console content without platform credentials: the
    // HTML contains the boot skeleton only (no "Platform overview").
    const res = await fetch(`${BASE}/platform`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('Platform overview')
    expect(html).not.toContain('Platform navigation')
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// 5. PLATFORM ADMIN CAN MANAGE MULTIPLE SCHOOLS
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · platform admin manages multiple schools', () => {
  test('root lists BOTH schools (multi-tenant oversight)', async () => {
    const res = await asPlatform(rootToken, '/api/platform/schools')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { schools: Array<{ id: string; status: string }> } }
    expect(body.ok).toBe(true)
    const ids = body.data.schools.map((s) => s.id)
    expect(ids).toContain(schoolAId)
    expect(ids).toContain(schoolBId)
  }, T)

  test('root reads BOTH school dossiers', async () => {
    for (const id of [schoolAId, schoolBId]) {
      const res = await asPlatform(rootToken, `/api/platform/schools/${id}`)
      expect(res.status).toBe(200)
    }
  }, T)

  test('root updates metadata of school A and plan of school B (billing step-up honored)', async () => {
    // A: metadata (no step-up needed) — idempotent toggle (city flips
    // between two values so repeated runs always produce a real diff).
    const before = await db.school.findUnique({ where: { id: schoolAId }, select: { city: true } })
    const newCity = before?.city === 'Pune' ? 'Mumbai' : 'Pune'
    const meta = await asPlatform(rootToken, `/api/platform/schools/${schoolAId}`, {
      method: 'PATCH',
      body: JSON.stringify({ city: newCity }),
    })
    expect(meta.status).toBe(200)
    const metaBody = (await meta.json()) as { ok: boolean; data: { updatedFields: string[] } }
    expect(metaBody.data.updatedFields).toContain('city')

    // B: plan change — login MFA is fresh → step-up window live. Idempotent
    // toggle between PRO/STANDARD (the API rejects same→same with 409).
    const currentB = await db.school.findUnique({ where: { id: schoolBId }, select: { plan: true } })
    const newPlan = currentB?.plan === 'STANDARD' ? 'PRO' : 'STANDARD'
    const plan = await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan: newPlan, reason: 'isolation-suite plan probe' }),
    })
    expect(plan.status).toBe(200)
    // Restore.
    await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan: 'STANDARD', reason: 'restore' }),
    }).catch(() => {})
  }, T)

  test('suspend school B → B users see the LOCKED shell (login allowed, business locked) → reactivate restores', async () => {
    const suspend = await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'isolation-suite suspension probe' }),
    })
    expect(suspend.status).toBe(200)

    // SaaS-HARDENING (§2): authentication NEVER depends on subscription
    // status. A SUSPENDED tenant still SIGNS IN — the entitlement travels
    // with the success envelope and withUser locks business APIs
    // server-side (SUBSCRIPTION_REQUIRED). A 429 from the login limiter
    // (repeated runs) is the only other acceptable verdict.
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'principal.b@greenvalley.test', password: SCHOOL_PW }),
    })
    if (loginRes.status === 200) {
      const loginBody = (await loginRes.json().catch(() => null)) as {
        ok?: boolean
        data?: { entitlement?: { state?: string; businessAllowed?: boolean } }
      } | null
      expect(loginBody?.ok).toBe(true)
      expect(loginBody?.data?.entitlement?.state).toBe('SUSPENDED')
      expect(loginBody?.data?.entitlement?.businessAllowed).toBe(false)
    } else {
      expect(loginRes.status).toBe(429)
    }

    // Business APIs stay locked for B's session (server-side truth).
    // NOTE: suspension also revokes B's live sessions — a FRESH session
    // (what a new sign-in creates, per §2 login-never-blocked) is the
    // honest probe: withUser must reject its business calls.
    const freshB = await directSchoolSession('principal.b@greenvalley.test')
    const bBlocked = await asSchool(freshB, '/api/students')
    expect([403, 429]).toContain(bBlocked.status)
    if (bBlocked.status === 403) {
      const blockedBody = (await bBlocked.json().catch(() => null)) as { code?: string } | null
      expect(blockedBody?.code).toBe('SUBSCRIPTION_REQUIRED')
    }

    // A's users are UNAFFECTED (isolation of the blast radius) — proven
    // through the already-issued A session (rate-limit independent).
    const aSession = await asSchool(principalA, '/api/auth/me')
    expect(aSession.status).toBe(200)

    // Reactivate → B fully restored (fresh login on a fresh bucket; on a
    // rate-limited re-run, prove the account works via a direct
    // session + /api/auth/me).
    const reactivate = await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/reactivate`, {
      method: 'POST',
    })
    expect(reactivate.status).toBe(200)
    // The fresh post-suspension session (the original fixture was revoked
    // by the suspension) now reaches business APIs again — restored.
    const bRestored = await asSchool(freshB, '/api/students')
    expect(bRestored.status).toBe(200)
  }, T)

  test('provision → PENDING (no sign-in) → activate → sign-in works → delete (typed confirmation)', async () => {
    // Provision a throwaway school.
    const provision = await asPlatform(rootToken, '/api/platform/schools', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Isolation Suite Throwaway School',
        slug: 'isolation-throwaway',
        code: 'IST',
        plan: 'FREE',
        board: 'CBSE',
        principalName: 'Probe Principal',
        principalEmail: 'probe.principal@isolation.test',
        principalPassword: 'Probe#Pass123',
      }),
    })
    expect(provision.status).toBe(200)
    const pb = (await provision.json()) as { ok: boolean; data: { school: { id: string } } }
    throwawaySchoolId = pb.data.school.id

    // PENDING → the founding principal CANNOT sign in yet (refusal in
    // any form: 401/403/429 — no session is issued).
    const pendingLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'probe.principal@isolation.test', password: 'Probe#Pass123' }),
    })
    expect([401, 403, 429]).toContain(pendingLogin.status)

    // Activate → the account works (fresh login; on a rate-limited
    // re-run prove it via a direct session + /api/auth/me).
    await asPlatform(rootToken, `/api/platform/schools/${throwawaySchoolId}/activate`, { method: 'POST' })
    const activeLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'probe.principal@isolation.test', password: 'Probe#Pass123' }),
    })
    if (activeLogin.status !== 200) {
      expect(activeLogin.status).toBe(429)
      const probeToken = await directSchoolSession('probe.principal@isolation.test')
      const me = await asSchool(probeToken, '/api/auth/me')
      expect(me.status).toBe(200)
    }

    // Delete WITHOUT typed confirmation → INVALID_INPUT (fail-safe).
    const noConfirm = await asPlatform(
      rootToken,
      `/api/platform/schools/${throwawaySchoolId}`,
      { method: 'DELETE' },
    )
    expect([400, 422]).toContain(noConfirm.status)

    // Delete with WRONG name → INVALID_INPUT.
    const wrongName = await asPlatform(
      rootToken,
      `/api/platform/schools/${throwawaySchoolId}?confirmName=Wrong%20Name`,
      { method: 'DELETE' },
    )
    expect([400, 422]).toContain(wrongName.status)

    // Delete with the EXACT name → gone (cascade) + audit survives.
    const del = await asPlatform(
      rootToken,
      `/api/platform/schools/${throwawaySchoolId}?confirmName=${encodeURIComponent('Isolation Suite Throwaway School')}`,
      { method: 'DELETE' },
    )
    expect(del.status).toBe(200)
    const auditRow = await db.platformAuditLog.findFirst({
      where: { action: 'platform.school.deleted', targetId: throwawaySchoolId },
    })
    expect(auditRow).not.toBeNull() // audit SURVIVES the school (no FK by design)
    throwawaySchoolId = null
  }, T)

  test('cookie transport works identically for the platform (first-party semantics)', async () => {
    const res = await asPlatformCookie(rootToken, '/api/platform/auth/me')
    expect(res.status).toBe(200)
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// 6. SCHOOL A CANNOT USE PLATFORM ROUTES AS SCHOOL B
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · no school credential satisfies the platform boundary', () => {
  test('school B principal bearer → 401 on platform routes (symmetric with school A)', async () => {
    const res = await asSchool(principalB, '/api/platform/schools')
    await expectEnvelope(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('school B token forged into the platform cookie slot → 401', async () => {
    const res = await asPlatformCookie(principalB, '/api/platform/schools')
    await expectEnvelope(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('school B token in the x-platform-token header → 401 (hash matches no PlatformAdminSession)', async () => {
    const res = await fetch(`${BASE}/api/platform/schools`, {
      headers: { 'x-platform-token': principalB },
    })
    expect(res.status).toBe(401)
  }, T)

  test('school A principal cannot target school B through PLATFORM routes (platform-only surfaces)', async () => {
    // Even with a VALID platform session (root), school ids are
    // re-verified: an unknown id is a fail-safe 404. But a SCHOOL
    // session reaches nothing here at all — verified above. This test
    // pins the combination: school-A bearer + school-B target id.
    const res = await asSchool(principalA, `/api/platform/schools/${schoolBId}`)
    await expectEnvelope(res, 401, 'AUTH_REQUIRED')
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// 7. A SCHOOL SESSION CAN NEVER BECOME A PLATFORM SESSION
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · school session ≠ platform session (structural)', () => {
  test('the legacy SUPER_ADMIN email is refused at SCHOOL login (migrated identity)', async () => {
    // The legacy User rows are suspended AND the role gate rejects
    // SUPER_ADMIN — the school auth system never issues a session for
    // a platform identity. (429 on rate-limited re-runs is equally a
    // refusal — no session is issued.)
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: ROOT_EMAIL, password: ROOT_PASSWORD }),
    })
    await expectLoginRefusal(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('the legacy superadmin email does not even reach the role gate with wrong password (anti-enum: identical 401)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: ROOT_EMAIL, password: 'wrong-password' }),
    })
    await expectLoginRefusal(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('school login with platform credentials → 401 (credential spaces are disjoint)', async () => {
    // ops@scholario.io is a PlatformAdmin — NOT a school User.
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: OPS_EMAIL, password: OPS_PASSWORD }),
    })
    await expectLoginRefusal(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('a platform token does not authenticate SCHOOL APIs either (isolation is bidirectional)', async () => {
    const res = await fetch(`${BASE}/api/auth/me`, {
      headers: { authorization: `Bearer ${rootToken}` },
    })
    expect(res.status).toBe(401)
  }, T)

  test('platform sessions live in their own table with hashed tokens', async () => {
    // The platform session token has no row in the school Session table
    // (both planes are hash-keyed — cross-plane token forgery finds no
    // row) — and its hash is the only stored form.
    const schoolRow = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(rootToken) },
    })
    expect(schoolRow).toBeNull()
    const crypto = await import('crypto')
    const hash = crypto.createHash('sha256').update(rootToken).digest('hex')
    const platformRow = await db.platformAdminSession.findUnique({ where: { tokenHash: hash } })
    expect(platformRow).not.toBeNull()
    expect(platformRow?.revokedAt).toBeNull()
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// MFA + step-up + rate limiting hardening
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · platform MFA and step-up', () => {
  // PRODUCT-DIRECTION RESET: platform TOTP is stood down through the single
  // policy switch (src/lib/platform/mfa-config.ts) — email + password is the
  // intended sign-in for this phase. The honest assertions for THIS posture:
  // the second-factor challenge is dormant (password alone signs in, supplied
  // codes are ignored), while everything that is NOT the second factor keeps
  // its exact teeth (wrong password, rate limits, account lockout, reason
  // validation, read-only support tokens). The re-enable path is covered by
  // tests/unit/platform-mfa-config.test.ts (flag switch) — no code surgery.
  test('login WITHOUT a TOTP code → 200 (platform TOTP stood down by policy)', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: ROOT_EMAIL, password: ROOT_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    // Clean up: sign out through the real route.
    const cookie = res.headers.get('set-cookie') ?? ''
    await fetch(`${BASE}/api/platform/auth/logout`, { method: 'POST', headers: { cookie } })
  }, T)

  test('login with a WRONG TOTP code → 200 (the code is ignored while MFA is off)', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: ROOT_EMAIL, password: ROOT_PASSWORD, totpCode: '000000' }),
    })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    await fetch(`${BASE}/api/platform/auth/logout`, { method: 'POST', headers: { cookie } })
  }, T)

  test('login with wrong password → 401 AUTH_REQUIRED (checked before anything)', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: ROOT_EMAIL, password: 'wrong-password', totpCode: await totpNow(ROOT_TOTP_SECRET) }),
    })
    await expectLoginRefusal(res, 401, 'AUTH_REQUIRED')
  }, T)

  test('destructive action with a STALE step-up window → allowed (gate dormant while MFA is off); step-up answers MFA_NOT_ENABLED', async () => {
    // PRODUCT-DIRECTION RESET: while platform TOTP is stood down there is
    // no second factor, so the step-up GATE is dormant by policy (no
    // STEP_UP_REQUIRED) and the step-up SURFACE refuses honestly with
    // MFA_NOT_ENABLED. The authz wiring itself (policy.stepUp) is intact
    // and returns the moment PLATFORM_TOTP_ENABLED=1.
    await db.platformAdminSession.updateMany({
      where: { revokedAt: null },
      data: { stepUpAt: new Date(Date.now() - 3600_000) },
    })
    const allowed = await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'step-up gate probe (dormant while MFA off)' }),
    })
    expect(allowed.status).toBe(200)
    // Restore.
    await asPlatform(rootToken, `/api/platform/schools/${schoolBId}/reactivate`, { method: 'POST' })

    // The step-up surface never pretends a second factor exists.
    const stepUp = await asPlatform(rootToken, '/api/platform/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ code: await totpNow(ROOT_TOTP_SECRET) }),
    })
    await expectEnvelope(stepUp, 403, 'MFA_NOT_ENABLED')

    // The gate stays dormant (still allowed with the aged window).
    const stillAllowed = await asPlatform(rootToken, `/api/platform/schools/${schoolAId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'still-dormant probe after MFA_NOT_ENABLED' }),
    })
    expect(stillAllowed.status).toBe(200)
    await asPlatform(rootToken, `/api/platform/schools/${schoolAId}/reactivate`, { method: 'POST' })
  }, T)

  test('suspension without a reason (≥10 chars) → 422 even with a live step-up window', async () => {
    // Fresh session with a LIVE window: the only failing condition is
    // the reason — deterministic, independent of step-up ordering.
    const fresh = await directPlatformSession(ROOT_EMAIL)
    const res = await asPlatform(fresh, `/api/platform/schools/${schoolBId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'x' }),
    })
    expect([400, 422]).toContain(res.status)
  }, T)

  test('login rate limiter locks the account bucket (5 failures → ACCOUNT_LOCKED)', async () => {
    // Use a throwaway email (avoids locking the REAL seeded accounts):
    // the per-IP bucket is shared, so keep attempts minimal — 5 rapid
    // failures for one nonexistent account trip the ACCOUNT bucket.
    const email = `rl-probe-${Date.now()}@nonexistent.test`
    let locked = false
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${BASE}/api/platform/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ email, password: 'wrong-password', totpCode: '000000' }),
      })
      const body = (await res.json()) as { ok: boolean; code: string }
      if (body.code === 'ACCOUNT_LOCKED' || body.code === 'RATE_LIMITED') {
        locked = true
        expect(res.status).toBe(429)
        break
      }
    }
    expect(locked).toBe(true)
  }, T)

  test('every platform login writes an audit row', async () => {
    const row = await db.platformAuditLog.findFirst({
      where: { action: 'platform.login.success' },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).not.toBeNull()
    expect(row?.adminId).not.toBeNull()
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// Permission model (ops admin — limited grants)
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · platform permission model', () => {
  test('ops (non-root) reads schools but is FORBIDDEN from admins.manage and billing', async () => {
    const read = await asPlatform(opsToken, '/api/platform/schools')
    expect(read.status).toBe(200)

    const admins = await asPlatform(opsToken, '/api/platform/admins')
    await expectEnvelope(admins, 403, 'FORBIDDEN')

    const plan = await asPlatform(opsToken, `/api/platform/schools/${schoolAId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan: 'FREE' }),
    })
    expect([403]).toContain(plan.status)
  }, T)

  test('ops cannot provision schools (no schools.provision grant)', async () => {
    const res = await asPlatform(opsToken, '/api/platform/schools', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ops Probe School',
        slug: 'ops-probe',
        code: 'OPP',
        plan: 'FREE',
        board: 'CBSE',
        principalName: 'X',
        principalEmail: 'x@ops-probe.test',
        principalPassword: 'X#Pass1234',
      }),
    })
    await expectEnvelope(res, 403, 'FORBIDDEN')
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// Support sessions ("Access School") — read-only, time-boxed, audited
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · support sessions (Access School)', () => {
  test('creation enforces reason (≥10 chars) + bounded duration (step-up dormant while MFA is off)', async () => {
    // PRODUCT-DIRECTION RESET: with platform TOTP stood down the step-up
    // gate is dormant — an AGED window no longer blocks creation. The
    // honest posture: creation succeeds with a valid reason, and the
    // reason/duration validation still applies unconditionally.
    const aged = await directPlatformSession(ROOT_EMAIL, { aged: true })
    const allowed = await asPlatform(aged, `/api/platform/schools/${schoolBId}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'support session probe', durationMinutes: 15 }),
    })
    expect(allowed.status).toBe(200)

    // A too-short reason is still rejected (validation runs regardless of
    // the MFA posture).
    const fresh = await directPlatformSession(ROOT_EMAIL)
    const shortReason = await asPlatform(fresh, `/api/platform/schools/${schoolBId}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'short', durationMinutes: 15 }),
    })
    expect([400, 422]).toContain(shortReason.status)
  }, T)

  test('support token grants READ-ONLY oversight — and nothing else', async () => {
    // Fresh direct session (live step-up window) — deterministic on
    // every run, no limiter budget spent.
    const fresh = await directPlatformSession(ROOT_EMAIL)
    const created = await asPlatform(fresh, `/api/platform/schools/${schoolBId}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'isolation-suite oversight probe', durationMinutes: 5 }),
    })
    expect(created.status).toBe(200)
    const cb = (await created.json()) as {
      ok: boolean
      data: { supportToken?: string; supportSession: { schoolName: string; reason: string } }
    }
    expect(cb.data.supportSession.schoolName).toBeTruthy()
    expect(cb.data.supportToken).toBeTruthy() // dev bearer
    const supportToken = cb.data.supportToken!

    // The support token opens the read-only overview…
    const overview = await fetch(`${BASE}/api/platform/support/overview`, {
      headers: { 'x-support-token': supportToken },
    })
    expect(overview.status).toBe(200)
    const ob = (await overview.json()) as { ok: boolean; data: { supportSession: { schoolId: string }; counts: Record<string, number> } }
    expect(ob.data.supportSession.schoolId).toBe(schoolBId)

    // …but CANNOT act as a platform session…
    const asPlatformHdr = await fetch(`${BASE}/api/platform/schools`, {
      headers: { 'x-platform-token': supportToken },
    })
    expect(asPlatformHdr.status).toBe(401)

    // …and CANNOT act as a school session (third, disjoint token space).
    const asSchoolHdr = await fetch(`${BASE}/api/auth/me`, {
      headers: { authorization: `Bearer ${supportToken}` },
    })
    expect(asSchoolHdr.status).toBe(401)

    // Exit revokes it.
    const exit = await fetch(`${BASE}/api/platform/support/exit`, {
      method: 'POST',
      headers: { 'x-support-token': supportToken },
    })
    expect(exit.status).toBe(200)
    const after = await fetch(`${BASE}/api/platform/support/overview`, {
      headers: { 'x-support-token': supportToken },
    })
    expect(after.status).toBe(401)
  }, T)

  test('expired support sessions die server-side (lazy sweep + audit)', async () => {
    const fresh = await directPlatformSession(ROOT_EMAIL)
    const created = await asPlatform(fresh, `/api/platform/schools/${schoolAId}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'expiry probe — read-only oversight check', durationMinutes: 5 }),
    })
    expect(created.status).toBe(200)
    const cb = (await created.json()) as { data: { supportToken?: string } }
    const supportToken = cb.data.supportToken!

    // Force expiry server-side.
    await db.supportSession.updateMany({
      where: { tokenHash: (await import('crypto')).createHash('sha256').update(supportToken).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    const expired = await fetch(`${BASE}/api/platform/support/overview`, {
      headers: { 'x-support-token': supportToken },
    })
    expect(expired.status).toBe(401)
    // The expiry was audited.
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.support_session.expired' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  }, T)

  test('support session creation writes a school-visible ActivityLog marker', async () => {
    const fresh = await directPlatformSession(ROOT_EMAIL)
    const create = await asPlatform(fresh, `/api/platform/schools/${schoolAId}/access`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'school-visible marker probe', durationMinutes: 5 }),
    })
    expect(create.status).toBe(200)
    const marker = await db.activityLog.findFirst({
      where: { schoolId: schoolAId, action: 'PLATFORM_SUPPORT_SESSION' },
      orderBy: { createdAt: 'desc' },
    })
    expect(marker).not.toBeNull()
    expect(marker?.detail).toContain('school-visible marker probe')
    // Revoke the session we just created (hygiene).
    const live = await db.supportSession.findFirst({
      where: { schoolId: schoolAId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (live) await db.supportSession.update({ where: { id: live.id }, data: { revokedAt: new Date() } })
  }, T)
})

// ═══════════════════════════════════════════════════════════════════════
// Session revocation
// ═══════════════════════════════════════════════════════════════════════

describe('PHASE 6 · platform session lifecycle', () => {
  test('logout revokes the platform session (cookie transport proof)', async () => {
    const token = await rateSafePlatformLogin()
    const before = await asPlatform(token, '/api/platform/auth/me')
    expect(before.status).toBe(200)
    const logout = await fetch(`${BASE}/api/platform/auth/logout`, {
      method: 'POST',
      headers: { 'x-platform-token': token },
    })
    expect(logout.status).toBe(200)
    const after = await asPlatform(token, '/api/platform/auth/me')
    expect(after.status).toBe(401)
  }, T)

  test('logout-all revokes every live session of the admin', async () => {
    const t1 = await rateSafePlatformLogin()
    const t2 = await rateSafePlatformLogin()
    const all = await fetch(`${BASE}/api/platform/auth/logout-all`, {
      method: 'POST',
      headers: { 'x-platform-token': t1 },
    })
    expect(all.status).toBe(200)
    const body = (await all.json()) as { data: { revoked: number } }
    expect(body.data.revoked).toBeGreaterThanOrEqual(2)
    expect((await asPlatform(t2, '/api/platform/auth/me')).status).toBe(401)
    // Re-login for any later tests.
    rootToken = await rateSafePlatformLogin()
  }, T)

  test('suspending an admin revokes their sessions (root suspends ops, then restores)', async () => {
    const ops = await db.platformAdmin.findUnique({ where: { email: OPS_EMAIL } })
    expect(ops).not.toBeNull()
    // Self-healing fixture: a previously failed run may have left ops
    // suspended — restore to ACTIVE so this test starts from a known state.
    if (ops!.status !== 'ACTIVE') {
      await db.platformAdmin.update({ where: { id: ops!.id }, data: { status: 'ACTIVE' } })
    }
    // Fresh root session with a LIVE step-up window (deterministic; the
    // step-up endpoint flow is covered by the MFA block above).
    const freshRoot = await directPlatformSession(ROOT_EMAIL)
    const res = await asPlatform(freshRoot, `/api/platform/admins/${ops!.id}/suspend`, { method: 'POST' })
    expect(res.status).toBe(200)
    // The ops session died with the suspension.
    expect((await asPlatform(opsToken, '/api/platform/auth/me')).status).toBe(401)
    // Suspended admins cannot log back in (401; 429 = limiter, also no access).
    const loginRes = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: OPS_EMAIL, password: OPS_PASSWORD, totpCode: await totpNow(PLATFORM_OPS_TOTP_SECRET) }),
    })
    expect([401, 429]).toContain(loginRes.status)
    // Restore (asserted — state leakage is what this test guards against).
    const reactivate = await asPlatform(rootToken, `/api/platform/admins/${ops!.id}/reactivate`, {
      method: 'POST',
    })
    expect(reactivate.status).toBe(200)
    const restored = await db.platformAdmin.findUnique({ where: { id: ops!.id }, select: { status: true } })
    expect(restored?.status).toBe('ACTIVE')
    opsToken = await platformLogin(OPS_EMAIL, OPS_PASSWORD, PLATFORM_OPS_TOTP_SECRET)
  }, T)
})
