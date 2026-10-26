/**
 * P0-A — platform admin in-session password change
 * (/api/platform/auth/change-password).
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. BOUNDARY — the route is platform-session-only: anonymous calls
 *      and SCHOOL sessions (in the platform bearer slot, cookie slot
 *      and Authorization header) are all refused. The two token
 *      spaces stay disjoint in both directions.
 *   2. CURRENT-PASSWORD PROOF — a live platform session alone cannot
 *      rotate the credential: a wrong current password is refused,
 *      audited (platform.password.change_failed) and leaves the
 *      stored hash untouched (the old password still signs in).
 *   3. POLICY — the new password must satisfy newPasswordSchema
 *      (≥8 chars, letter + digit), match its confirmation, and
 *      differ from the current password.
 *   4. EFFECT — a successful change: new hash active (old password
 *      stops working at login, new one works), every OTHER platform
 *      session revoked, the CURRENT session ROTATED (old token dead,
 *      fresh token issued + returned in dev preview mode), every
 *      pending emailed reset token for the admin invalidated, and a
 *      platform.password.changed audit row written (no secrets).
 *   5. LIST CONTRACT (P0-B) — the platform school ledger rows carry
 *      the access truth: isDemo marker, founding principal object,
 *      and both canonical doors (loginUrl/publicUrl).
 *
 * A DEDICATED marker-suffixed test admin is created per run (never the
 * seeded root — its credential must stay stable for every other suite)
 * and removed in afterAll together with every row created here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken, hashPassword, verifyPassword } from '@/lib/auth'
import { hashToken } from '@/lib/platform/auth'
import { PLATFORM_ROOT_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

// Live-HTTP against the dev server: every request here is server-side
// sub-100ms when unloaded, but CI-runner contention (webpack dev compile
// of sibling routes) has pushed individual requests past bun's 5s default
// (observed 2026-10-12: garbage-token 401 path timed out at 5000ms while
// the anonymous 401 on the SAME route answered in 41ms; the happy path
// measured 3127ms). 20s matches the observability suite's generosity and
// keeps these tests asserting BEHAVIOR, not runner scheduling luck.
const T = 20_000
const MARKER = randomBytes(4).toString('hex')
const TEST_EMAIL = `pwchange-${MARKER}@platform.test`
const ORIGINAL_PASSWORD = 'Original-Passw0rd'
const NEW_PASSWORD = 'Rotated-Passw0rd-9x'

let adminId = ''
let currentToken = '' // the x-platform-token of the (rotated) session
let originalHash = ''
let secondToken = '' // an "other device" session (must die on change)
let schoolSessionUserId = ''
let schoolSessionToken = ''

const cleanup: Array<() => Promise<unknown>> = []

async function json(res: Response): Promise<any> {
  return res.json().catch(() => null)
}

async function callChangePassword(body: unknown, token?: string, extraHeaders: Record<string, string> = {}) {
  return fetch(`${BASE}/api/platform/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-platform-token': token } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

/**
 * Transport-resilient re-issue for boundary probes that PROVABLY cannot
 * write (2026-10-26, CI run #169 attempt-1 flake: the garbage-token
 * boundary POST timed out on a hung dev-server socket and failed the
 * suite). The plain fetch wrapper deliberately never retries ambiguous
 * failures on non-idempotent methods — correct in general, over-strict
 * for probes whose credentials are rejected at the authz boundary
 * BEFORE any mutation. For those, a re-issue is side-effect-free by
 * construction, so transient transport errors are retried here.
 */
async function retryNoWriteProbe(fn: () => Promise<Response>, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? `${err.message} ${(err as NodeJS.ErrnoException).code ?? ''}` : String(err)
      const transient = /ECONNRESET|ECONNABORTED|EPIPE|EAI_AGAIN|socket|timed?[- ]?out|aborted|fetch failed/i.test(msg)
      if (!transient || attempt === maxAttempts) throw err
      await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)))
    }
  }
}

const VALID_BODY = {
  currentPassword: ORIGINAL_PASSWORD,
  newPassword: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
}

async function platformMe(token: string): Promise<Response> {
  return fetch(`${BASE}/api/platform/auth/me`, { headers: { 'x-platform-token': token } })
}

/**
 * The per-account password-change throttle (5/hour) is CORRECT
 * production semantics but would exhaust mid-suite (each policy test
 * legitimately consumes one attempt). Deleting the shared row heals
 * the limiter within one request — same convention as
 * resetLoginBuckets, scoped to THIS suite's dedicated test admin.
 */
async function healPwChangeBucket(): Promise<void> {
  try {
    await db.rateLimitBucket.delete({ where: { key: `rl:pf-pwchange:${adminId}` } })
  } catch {
    // no bucket row yet — nothing to heal
  }
}

async function rootLogin(): Promise<string | null> {
  // Root login ONLY for the read-only list-contract test — never for a
  // password change (the root credential stays stable across suites).
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@scholario.cloud', password: PLATFORM_ROOT_PASSWORD }),
  })
  const body = await json(res)
  return body?.data?.sessionToken ?? null
}

beforeAll(async () => {
  // ── The dedicated test admin (ACTIVE, non-root) ────────────────────
  const admin = await db.platformAdmin.create({
    data: {
      email: TEST_EMAIL,
      name: `Password Change Test ${MARKER}`,
      passwordHash: hashPassword(ORIGINAL_PASSWORD),
      status: 'ACTIVE',
      isRoot: false,
      isDemo: false,
      totpSecret: 'JBSWY3DPEHPK3PXP', // fixture secret (MFA is policy-off)
    },
  })
  adminId = admin.id
  originalHash = admin.passwordHash
  cleanup.push(() => db.platformAdmin.delete({ where: { id: adminId } }).catch(() => {}))

  // ── Two platform sessions: the "current device" + an "other device" ─
  currentToken = randomBytes(32).toString('hex')
  secondToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 3600_000)
  await db.platformAdminSession.create({
    data: { adminId, tokenHash: hashToken(currentToken), expiresAt: expires, ipAddress: '127.0.0.1' },
  })
  await db.platformAdminSession.create({
    data: { adminId, tokenHash: hashToken(secondToken), expiresAt: expires, ipAddress: '10.0.0.9' },
  })
  cleanup.push(() =>
    db.platformAdminSession.deleteMany({ where: { adminId } }).catch(() => {}),
  )

  // ── A pending emailed reset token for the admin (must be invalidated) ─
  const resetRaw = randomBytes(32).toString('hex')
  await db.platformPasswordReset.create({
    data: {
      adminId,
      tokenHash: hashToken(resetRaw),
      expiresAt: new Date(Date.now() + 1800_000),
      requestIp: '127.0.0.1',
    },
  })
  cleanup.push(() =>
    db.platformPasswordReset.deleteMany({ where: { adminId } }).catch(() => {}),
  )

  // ── A SCHOOL session (any seeded ACTIVE school user) for the boundary ─
  const schoolUser = await db.user.findFirst({
    where: { role: 'PRINCIPAL', status: 'ACTIVE', school: { slug: 'green-valley' } },
  })
  if (schoolUser) {
    schoolSessionUserId = schoolUser.id
    schoolSessionToken = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        userId: schoolUser.id,
        tokenHash: hashSessionToken(schoolSessionToken),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    cleanup.push(() =>
      db.session.deleteMany({ where: { userId: schoolSessionUserId } }).catch(() => {}),
    )
  }
})

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn()
  await db.$disconnect()
})

describe('P0-A platform change-password — boundary', () => {
  test('anonymous → 401 AUTH_REQUIRED', async () => {
    const res = await callChangePassword(VALID_BODY)
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body?.code).toBe('AUTH_REQUIRED')
  }, T)

  test('garbage token → 401 AUTH_REQUIRED', async () => {
    // Garbage credentials die at the authz boundary before any write —
    // retryNoWriteProbe makes the boundary probe immune to transient
    // socket failures without weakening what it asserts.
    const res = await retryNoWriteProbe(() => callChangePassword(VALID_BODY, randomBytes(16).toString('hex')))
    expect(res.status).toBe(401)
  }, 35_000)

  test('SCHOOL session in the platform bearer slot → 401 (token spaces disjoint)', async () => {
    if (!schoolSessionToken) return // no seeded school user found — skip silently
    const res = await callChangePassword(VALID_BODY, schoolSessionToken)
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body?.code).toBe('AUTH_REQUIRED')
  }, T)

  test('SCHOOL session in the platform cookie slot → 401', async () => {
    if (!schoolSessionToken) return
    const res = await fetch(`${BASE}/api/platform/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `scholario_platform_session=${schoolSessionToken}` },
      body: JSON.stringify(VALID_BODY),
    })
    expect(res.status).toBe(401)
  }, T)
})

describe('P0-A platform change-password — current-password proof & policy', () => {
  test('wrong current password → 422, hash unchanged, failed audit row', async () => {
    await healPwChangeBucket()
    const before = await db.platformAuditLog.count({
      where: { adminId, action: 'platform.password.change_failed' },
    })
    const res = await callChangePassword(
      { ...VALID_BODY, currentPassword: 'Wrong-Passw0rd' },
      currentToken,
    )
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body?.code).toBe('INVALID_INPUT')
    expect(body?.error).toContain('Current password is incorrect')

    // Stored hash untouched — the original password still verifies.
    const row = await db.platformAdmin.findUnique({ where: { id: adminId } })
    expect(verifyPassword(ORIGINAL_PASSWORD, row!.passwordHash)).toBe(true)
    expect(row!.passwordHash).toBe(originalHash)

    const after = await db.platformAuditLog.count({
      where: { adminId, action: 'platform.password.change_failed' },
    })
    expect(after).toBe(before + 1)
  }, T)

  test('weak new password (no digit) → 422 policy violation', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword(
      { ...VALID_BODY, newPassword: 'nodigitshere', confirmPassword: 'nodigitshere' },
      currentToken,
    )
    expect(res.status).toBe(422)
  }, T)

  test('short new password → 422 policy violation', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword(
      { ...VALID_BODY, newPassword: 'Ab1', confirmPassword: 'Ab1' },
      currentToken,
    )
    expect(res.status).toBe(422)
  }, T)

  test('confirmation mismatch → 422', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword(
      { ...VALID_BODY, confirmPassword: 'Something-Else-99' },
      currentToken,
    )
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body?.error).toContain('do not match')
  }, T)

  test('new password identical to current → 422', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword(
      {
        currentPassword: ORIGINAL_PASSWORD,
        newPassword: ORIGINAL_PASSWORD,
        confirmPassword: ORIGINAL_PASSWORD,
      },
      currentToken,
    )
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body?.error).toContain('different')
  }, T)

  test('unknown extra field → 422 (strict body)', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword({ ...VALID_BODY, evil: 'x' }, currentToken)
    expect(res.status).toBe(422)
  }, T)
})

describe('P0-A platform change-password — effect', () => {
  test('happy path: rotate everything, honestly', async () => {
    await healPwChangeBucket()
    const res = await callChangePassword(VALID_BODY, currentToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body?.ok).toBe(true)
    // The "other device" session existed → at least one revocation.
    expect(body?.data?.otherSessionsSignedOut).toBeGreaterThanOrEqual(1)
    // Dev preview returns the rotated token.
    expect(typeof body?.data?.sessionToken).toBe('string')

    // 1. New hash active, old hash gone.
    const row = await db.platformAdmin.findUnique({ where: { id: adminId } })
    expect(verifyPassword(NEW_PASSWORD, row!.passwordHash)).toBe(true)
    expect(verifyPassword(ORIGINAL_PASSWORD, row!.passwordHash)).toBe(false)

    // 2. Old CURRENT token is dead; the rotated token works.
    const oldMe = await platformMe(currentToken)
    expect(oldMe.status).toBe(401)
    const rotated = body.data.sessionToken as string
    const newMe = await platformMe(rotated)
    expect(newMe.status).toBe(200)
    const meBody = await json(newMe)
    expect(meBody?.data?.admin?.email).toBe(TEST_EMAIL)
    currentToken = rotated // keep the suite honest for any later call

    // 3. The OTHER device session was revoked (row marked, not deleted).
    const secondRow = await db.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(secondToken) },
    })
    expect(secondRow).not.toBeNull()
    expect(secondRow!.revokedAt).not.toBeNull()

    // 4. The pending emailed reset token was invalidated.
    const resets = await db.platformPasswordReset.findMany({
      where: { adminId, usedAt: null },
    })
    expect(resets.length).toBe(0)

    // 5. Audit row written with the counts (never a secret).
    const audit = await db.platformAuditLog.findFirst({
      where: { adminId, action: 'platform.password.changed' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    const meta = JSON.parse(audit!.metadata ?? '{}')
    expect(meta.sessionRotated).toBe(true)
    expect(meta.otherSessionsRevoked).toBeGreaterThanOrEqual(1)
    expect(audit!.metadata ?? '').not.toContain(NEW_PASSWORD)

    // 6. Old password no longer signs in; the new one does.
    const oldLogin = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: ORIGINAL_PASSWORD }),
    })
    expect(oldLogin.status).toBe(401)
    const newLogin = await fetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: NEW_PASSWORD }),
    })
    expect(newLogin.status).toBe(200)
    const loginBody = await json(newLogin)
    expect(loginBody?.data?.admin?.email).toBe(TEST_EMAIL)
    // A login the tests created → clean its session rows up.
    cleanup.push(() =>
      db.platformAdminSession
        .deleteMany({ where: { adminId, tokenHash: hashToken(loginBody?.data?.sessionToken ?? '') } })
        .catch(() => {}),
    )
  }, T)
})

describe('P0-B schools ledger — access-truth contract (root, read-only)', () => {
  test('every row carries isDemo, the founding principal and both canonical doors', async () => {
    let token = await rootLogin()
    if (!token) {
      // Rate-limited re-run: read the contract through the shared admin
      // fallback (direct session fixture) instead of failing the suite.
      const root = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
      if (!root) throw new Error('root platform admin missing (run bun prisma/seed-platform.ts)')
      const direct = randomBytes(32).toString('hex')
      await db.platformAdminSession.create({
        data: { adminId: root.id, tokenHash: hashToken(direct), expiresAt: new Date(Date.now() + 600_000) },
      })
      cleanup.push(() =>
        db.platformAdminSession.deleteMany({ where: { tokenHash: hashToken(direct) } }).catch(() => {}),
      )
      token = direct
    }
    const res = await fetch(`${BASE}/api/platform/schools?page=1`, {
      headers: { 'x-platform-token': token },
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body?.ok).toBe(true)
    const schools: any[] = body?.data?.schools ?? []
    expect(schools.length).toBeGreaterThan(0)
    for (const s of schools) {
      expect(typeof s.isDemo).toBe('boolean')
      expect(s.principal === null || typeof s.principal?.email === 'string').toBe(true)
      if (s.principal) {
        expect(['BOOTSTRAP_PENDING', 'OWNED', 'UNKNOWN']).toContain(s.principal.credentialState)
      }
      expect(typeof s.loginUrl).toBe('string')
      expect(s.loginUrl).toContain(`/s/${s.slug}/login`)
      expect(typeof s.publicUrl).toBe('string')
    }
    // The seeded corpus classification truth (read-only assertion).
    const gv = schools.find((s) => s.slug === 'green-valley')
    if (gv) expect(gv.isDemo).toBe(false)
    const hh = schools.find((s) => s.slug === 'hawkings-prithvipur')
    if (hh) expect(hh.isDemo).toBe(true)
    // Root token hygiene (if it was a real login).
    cleanup.push(() =>
      db.platformAdminSession
        .deleteMany({ where: { tokenHash: hashToken(token ?? '') } })
        .catch(() => {}),
    )
  }, T)
})
