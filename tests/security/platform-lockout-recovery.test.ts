import { db } from '../helpers/db'
/**
 * ROOT-ADMIN LOGIN REPAIR — lockout recovery, bounded abuse extension,
 * and verified-email adoption suite.
 *
 * Trigger (production incident 2026-10-21): the platform root admin
 * exhausted the per-account login bucket (5/15min) and every further
 * attempt RESTARTED the shared window (count ≥ 2×limit), making the
 * lockout effectively permanent; the emailed recovery path could not
 * deliver to the placeholder account address; and a successful reset
 * never cleared the lockout — so even a verified recovery left the
 * administrator locked out.
 *
 * COVERAGE MAP (task §7 matrix items this file OWNS; the wider matrix
 * is covered by tests/security/platform-account-recovery.test.ts and
 * tests/security/platform-isolation.test.ts — see the final report):
 *
 *   3.  A locked account cannot bypass ordinary login       [PART H]
 *   8.  Concurrent token redemption resets exactly once     [PART H]
 *   12. Recovery works when normal login is locked
 *       (reset clears the per-account lockout)              [PART H]
 *   —   Recovery-bound email adoption is verified, atomic
 *       and duplicate-safe (issuance + consume-time guards) [PART L+H]
 *   —   School-plane lockouts cannot lock platform login
 *       (plane-separated account buckets)                   [PART H]
 *   —   Bounded shared-window abuse restart: sustained
 *       denied attempts can no longer extend a lockout
 *       indefinitely (restart fires exactly once per cycle) [PART L]
 *   16. Tokens/passwords never appear in audit rows          [PART H]
 *   —   Password-changed notification is attempted (honest
 *       EmailDelivery row)                                   [PART H]
 *
 * STYLE: the repo convention — PART U (pure units over exported libs,
 * hermetic injected clocks), PART L (lib-level over the shared DB),
 * PART H (live HTTP against the dev server). Every PART H test creates
 * its OWN fixture admins (never a corpus root); rate-limit buckets for
 * fixture emails/IPs are healed in beforeAll/afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { hashPassword, verifyPassword } from '@/lib/auth'
import {
  checkRateLimit,
  loginAccountKey,
  platformLoginAccountKey,
  resetAllRateLimits,
  RATE_LIMITS,
  checkRateLimitStrict,
} from '@/lib/security/rate-limit'
import {
  issuePasswordReset,
  consumePasswordReset,
  clearAccountLockout,
  maskedEmailDomain,
  RESET_TOKEN_TTL_MS,
} from '@/lib/platform/password-reset'
import { hashToken } from '@/lib/platform/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(5).toString('hex')
const SUITE_START = new Date()

// Dedicated IPs per section (the shared IP buckets must never cross-talk):
const FAIL_IP = `10.231.${randomInt(250)}.${randomInt(250)}`
const RECOVER_IP = `10.232.${randomInt(250)}.${randomInt(250)}`
const PLANE_IP = `10.233.${randomInt(250)}.${randomInt(250)}`
const SCHOOL_IP = `10.234.${randomInt(250)}.${randomInt(250)}`
const NEW_EMAIL_IP = `10.235.${randomInt(250)}.${randomInt(250)}`
const CONCUR_IP = `10.236.${randomInt(250)}.${randomInt(250)}`

function randomInt(max: number): number {
  return 1 + Math.floor(Math.random() * (max - 1))
}

// ── fixtures ─────────────────────────────────────────────────────────────

const LOCK_EMAIL = `lock-admin-${MARKER}@test.scholario`
const LOCK_PASSWORD = `L0ck!${MARKER}pw`
const ADOPT_EMAIL = `adopt-admin-${MARKER}@test.scholario`
const ADOPT_PASSWORD = `Ad0pt!${MARKER}pw`
const ADOPT2_EMAIL = `adopt2-admin-${MARKER}@test.scholario`
const ADOPT2_PASSWORD = `Ad0pt2!${MARKER}pw`
const CONCUR_EMAIL = `concur-admin-${MARKER}@test.scholario`
const CONCUR_PASSWORD = `C0ncur!${MARKER}pw`
const SUSPEND_EMAIL = `suspend-admin-${MARKER}@test.scholario`
const SUSPEND_PASSWORD = `Susp3nd!${MARKER}pw`
const CANDIDATE_GMAIL = `owner.${MARKER}@gmail.com`
const NEW_PASSWORD_A = `N3wPass!${MARKER}a`
const NEW_PASSWORD_B = `N3wPass!${MARKER}b`
const SUSPEND_NEW_PASSWORD = `Susp3nd!${MARKER}n`

const fixtureEmails = [LOCK_EMAIL, ADOPT_EMAIL, ADOPT2_EMAIL, CONCUR_EMAIL, SUSPEND_EMAIL]
const fixtureAdminIds: string[] = []
const mintedTokens: string[] = [] // raw tokens retained ONLY for the audit-hygiene assertions
const bucketKeysToSweep: string[] = []

async function createFixtureAdmin(email: string, password: string, isRoot = false): Promise<string> {
  const admin = await db.platformAdmin.create({
    data: {
      email,
      name: `Lockout Recovery ${MARKER}`,
      passwordHash: hashPassword(password),
      status: 'ACTIVE',
      isRoot,
      isDemo: false,
      totpSecret: 'JBSWY3DPEHPK3PXP', // fixture secret (MFA is policy-off)
    },
  })
  fixtureAdminIds.push(admin.id)
  return admin.id
}

async function platformLoginHttp(
  email: string,
  password: string,
  ip: string,
): Promise<{ status: number; code: string; token?: string }> {
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    code?: string
    data?: { sessionToken?: string }
  }
  return {
    status: res.status,
    code: body.code ?? (body.ok ? 'OK' : 'UNKNOWN'),
    token: body.data?.sessionToken,
  }
}

async function schoolLoginHttp(
  email: string,
  password: string,
  ip: string,
): Promise<{ status: number; code: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string }
  return { status: res.status, code: body.code ?? (body.ok ? 'OK' : 'UNKNOWN') }
}

async function resetPasswordHttp(
  token: string,
  newPassword: string,
  ip: string,
): Promise<{ status: number; code: string; message?: string }> {
  const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ token, newPassword }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    code?: string
    data?: { message?: string }
    error?: string
  }
  return { status: res.status, code: body.code ?? (body.ok ? 'OK' : 'UNKNOWN'), message: body.data?.message ?? body.error }
}

/** Delete the shared + local account-bucket rows for the fixture emails. */
async function healFixtureBuckets(): Promise<void> {
  const keys = fixtureEmails.flatMap((e) => [
    loginAccountKey(e.toLowerCase()),
    platformLoginAccountKey(e.toLowerCase()),
  ])
  bucketKeysToSweep.push(...keys)
  try {
    for (const key of keys) {
      await db.rateLimitBucket.deleteMany({ where: { key } })
    }
  } catch {
    // never block setup on hygiene
  }
  resetAllRateLimits()
}

beforeAll(async () => {
  await healFixtureBuckets()
  await createFixtureAdmin(LOCK_EMAIL, LOCK_PASSWORD)
  await createFixtureAdmin(ADOPT_EMAIL, ADOPT_PASSWORD)
  await createFixtureAdmin(ADOPT2_EMAIL, ADOPT2_PASSWORD)
  await createFixtureAdmin(CONCUR_EMAIL, CONCUR_PASSWORD)
  await createFixtureAdmin(SUSPEND_EMAIL, SUSPEND_PASSWORD)
})

afterAll(async () => {
  // Cascade: deleting each admin removes its sessions + password-reset rows.
  for (const id of fixtureAdminIds) {
    await db.platformAdmin.deleteMany({ where: { id } }).catch(() => {})
  }
  // Candidate-claimed fixture admins (consume-conflict test) are swept by
  // email too — they share the MARKER namespace.
  await db.platformAdmin
    .deleteMany({ where: { email: { contains: MARKER } } })
    .catch(() => {})
  // Rate-limit rows minted by this suite (fixture emails + the abuse probe).
  const abuseKey = `rl:test:abuse:${MARKER}`
  try {
    for (const key of [...bucketKeysToSweep, abuseKey]) {
      await db.rateLimitBucket.deleteMany({ where: { key } })
    }
  } catch {
    // hygiene only
  }
  resetAllRateLimits()
  // NOTE: no db.$disconnect() — the shared test client is process-wide
  // (tests/helpers/db.ts contract: teardown cleans ROWS, not the client).
})

// ══ PART U · pure units (hermetic) ═══════════════════════════════════════

describe('ROOT-ADMIN LOGIN REPAIR · unit contracts', () => {
  test('platform account buckets live in their own namespace (plane separation)', () => {
    const email = `probe-${MARKER}@test.scholario`
    expect(platformLoginAccountKey(email)).toBe(`rl:pf-login:acct:${email}`)
    expect(platformLoginAccountKey(email)).not.toBe(loginAccountKey(email))
    expect(loginAccountKey(email)).toBe(`rl:login:acct:${email}`)
  })

  test('clearAccountLockout clears the LOCAL account buckets on every namespace', () => {
    const email = `clear-probe-${MARKER}@test.scholario`
    const t = Date.now()
    // Burn both local buckets to the denied state (injected clock).
    for (let i = 0; i < 5; i++) {
      checkRateLimit(platformLoginAccountKey(email), RATE_LIMITS.platformLoginAccount, t + i)
    }
    for (let i = 0; i < 5; i++) {
      checkRateLimit(loginAccountKey(email), RATE_LIMITS.loginAccount, t + i)
    }
    expect(checkRateLimit(platformLoginAccountKey(email), RATE_LIMITS.platformLoginAccount, t + 100).allowed).toBe(false)
    expect(checkRateLimit(loginAccountKey(email), RATE_LIMITS.loginAccount, t + 100).allowed).toBe(false)

    clearAccountLockout(email)

    const after = checkRateLimit(platformLoginAccountKey(email), RATE_LIMITS.platformLoginAccount, t + 101)
    const afterLegacy = checkRateLimit(loginAccountKey(email), RATE_LIMITS.loginAccount, t + 102)
    expect(after.allowed).toBe(true)
    expect(afterLegacy.allowed).toBe(true)
  })

  test('maskedEmailDomain keeps the domain only (PII-minimal audit metadata)', () => {
    expect(maskedEmailDomain('someone@gmail.com')).toBe('gmail.com')
    expect(maskedEmailDomain('root@scholario.cloud')).toBe('scholario.cloud')
    expect(maskedEmailDomain('malformed')).toBe('unknown-domain')
  })
})

// ══ PART L · lib-level DB contracts ══════════════════════════════════════

describe('ROOT-ADMIN LOGIN REPAIR · recovery token email binding', () => {
  test('issuePasswordReset binds the candidate email (single outstanding token preserved)', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: ADOPT_EMAIL } })
    const first = await issuePasswordReset(admin.id, { newEmail: CANDIDATE_GMAIL })
    expect(first.newEmail).toBe(CANDIDATE_GMAIL)
    mintedTokens.push(first.token)

    const row = await db.platformPasswordReset.findUnique({ where: { tokenHash: hashToken(first.token) } })
    expect(row?.newEmail).toBe(CANDIDATE_GMAIL)
    expect(row?.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(RESET_TOKEN_TTL_MS)
    expect(row?.usedAt).toBeNull()

    // Single outstanding token: a second issuance supersedes the first.
    const second = await issuePasswordReset(admin.id, {})
    expect(second.newEmail).toBeNull()
    const firstAfter = await db.platformPasswordReset.findUnique({ where: { tokenHash: hashToken(first.token) } })
    expect(firstAfter?.usedAt).not.toBeNull()
  })

  test('issuePasswordReset REFUSES a candidate already owned by another platform admin', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: ADOPT2_EMAIL } })
    let threw = false
    try {
      await issuePasswordReset(admin.id, { newEmail: ADOPT_EMAIL }) // owned by the adopt fixture
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // And nothing was minted for the admin in that failed call.
    const pending = await db.platformPasswordReset.findFirst({
      where: { adminId: admin.id, usedAt: null },
    })
    expect(pending).toBeNull()
  })

  test('consumePasswordReset returns the bound candidate email', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: CONCUR_EMAIL } })
    const issued = await issuePasswordReset(admin.id, { newEmail: CANDIDATE_GMAIL })
    mintedTokens.push(issued.token)
    const consumed = await consumePasswordReset(issued.token)
    expect(consumed.ok).toBe(true)
    expect(consumed.adminId).toBe(admin.id)
    expect(consumed.newEmail).toBe(CANDIDATE_GMAIL)
    expect(consumed.resetId).toBeDefined()
  })
})

describe('ROOT-ADMIN LOGIN REPAIR · bounded shared-window abuse restart', () => {
  test('the restart fires EXACTLY ONCE per count cycle (sustained denied attempts cannot extend a lockout indefinitely)', async () => {
    const key = `rl:test:abuse:${MARKER}`
    bucketKeysToSweep.push(key)
    // Seed the shared row NEAR the 2×limit crossing, with an OLD window
    // start so the restart is observable when it fires.
    const seededStart = new Date(Date.now() - 10 * 60_000)
    await db.rateLimitBucket.create({
      data: { key, count: 9, windowStart: seededStart },
    })

    // Attempt #1: count 10 = 2×limit → denied + the ONE allowed restart.
    const deny1 = await checkRateLimitStrict(key, RATE_LIMITS.platformLoginAccount, { force: true })
    expect(deny1.allowed).toBe(false)
    let row = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } })
    expect(row.count).toBe(10)
    const restartedAt = row.windowStart
    // The restart DID fire: the window moved from the seeded past to ~now.
    expect(restartedAt.getTime() - seededStart.getTime()).toBeGreaterThan(5 * 60_000)

    // Attempts #2/#3: counts 11, 12 → denied, but NO further restart
    // (1.1s apart — a restart would advance windowStart by ≥1100ms).
    await checkRateLimitStrict(key, RATE_LIMITS.platformLoginAccount, { force: true })
    await new Promise((r) => setTimeout(r, 1100))
    await checkRateLimitStrict(key, RATE_LIMITS.platformLoginAccount, { force: true })
    row = await db.rateLimitBucket.findUniqueOrThrow({ where: { key } })
    expect(row.count).toBe(12)
    expect(row.windowStart.getTime()).toBe(restartedAt.getTime()) // byte-identical → no restart

    // The 250ms bounded-fallback path never applies here (real DB, fast).
    await db.rateLimitBucket.delete({ where: { key } }).catch(() => {})
  })
})

// ══ PART H · live HTTP (dev server) ═════════════════════════════════════

describe('ROOT-ADMIN LOGIN REPAIR · lockout + verified recovery (live HTTP)', () => {
  test('5 failed sign-ins lock the account; the 6th is ACCOUNT_LOCKED (no bypass through the login surface)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await platformLoginHttp(LOCK_EMAIL, 'definitely-wrong-password', FAIL_IP)
      expect(r.status).toBe(401)
      expect(r.code).toBe('AUTH_REQUIRED')
    }
    const sixth = await platformLoginHttp(LOCK_EMAIL, 'definitely-wrong-password', FAIL_IP)
    expect(sixth.status).toBe(429)
    expect(sixth.code).toBe('ACCOUNT_LOCKED')
    // Even the CORRECT password cannot bypass an active lockout.
    const withCorrect = await platformLoginHttp(LOCK_EMAIL, LOCK_PASSWORD, FAIL_IP)
    expect(withCorrect.status).toBe(429)
    expect(withCorrect.code).toBe('ACCOUNT_LOCKED')
  }, 30_000)

  test('verified recovery works WHILE login is locked: the reset clears the per-account lockout, the new password signs in, the old one is dead', async () => {
    // The account is locked by the previous test (shared DB row).
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: LOCK_EMAIL } })
    const issued = await issuePasswordReset(admin.id, {}) // ordinary self-service token (no email change)
    mintedTokens.push(issued.token)

    const reset = await resetPasswordHttp(issued.token, NEW_PASSWORD_A, RECOVER_IP)
    expect(reset.status).toBe(200)

    // Fresh IP → the account bucket must have been cleared by the
    // verified reset (count was ≥6 > limit; without clearing this
    // login would be 429 ACCOUNT_LOCKED).
    const login = await platformLoginHttp(LOCK_EMAIL, NEW_PASSWORD_A, RECOVER_IP)
    expect(login.status).toBe(200)
    expect(login.token).toBeDefined()

    // The old password no longer authenticates (fresh IP, fresh account bucket).
    const oldPw = await platformLoginHttp(LOCK_EMAIL, LOCK_PASSWORD, RECOVER_IP)
    expect(oldPw.status).toBe(401)
    expect(oldPw.code).toBe('AUTH_REQUIRED')
  }, 30_000)

  test('a consumed token cannot be reused (replay → generic refusal)', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: LOCK_EMAIL } })
    const issued = await issuePasswordReset(admin.id, {})
    mintedTokens.push(issued.token)
    const first = await resetPasswordHttp(issued.token, NEW_PASSWORD_B, RECOVER_IP)
    expect(first.status).toBe(200)
    const replay = await resetPasswordHttp(issued.token, NEW_PASSWORD_A, RECOVER_IP)
    expect(replay.status).toBe(401)
    // The password from the replay attempt was NOT applied.
    const row = await db.platformAdmin.findUniqueOrThrow({ where: { email: LOCK_EMAIL } })
    expect(verifyPassword(NEW_PASSWORD_B, row.passwordHash)).toBe(true)
    expect(verifyPassword(NEW_PASSWORD_A, row.passwordHash)).toBe(false)
  }, 30_000)

  test('CONCURRENT redemption of one token resets exactly once (atomic single-use claim)', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: CONCUR_EMAIL } })
    const issued = await issuePasswordReset(admin.id, {})
    mintedTokens.push(issued.token)
    const pwA = `C0ncur!${MARKER}a`
    const pwB = `C0ncur!${MARKER}b`
    const [a, b] = await Promise.all([
      resetPasswordHttp(issued.token, pwA, CONCUR_IP),
      resetPasswordHttp(issued.token, pwB, CONCUR_IP),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 401])
    const row = await db.platformAdmin.findUniqueOrThrow({ where: { email: CONCUR_EMAIL } })
    const isA = verifyPassword(pwA, row.passwordHash)
    const isB = verifyPassword(pwB, row.passwordHash)
    expect(isA !== isB).toBe(true) // exactly one password won
  }, 30_000)

  test('recovery-bound email adoption: the verified candidate becomes the account identity atomically; the old address is dead', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: ADOPT_EMAIL } })
    const issued = await issuePasswordReset(admin.id, { newEmail: CANDIDATE_GMAIL })
    mintedTokens.push(issued.token)

    // Pre-consume: the candidate is NOT yet the account email — an
    // unverified address never grants anything by itself.
    const beforeLogin = await platformLoginHttp(CANDIDATE_GMAIL, NEW_PASSWORD_A, NEW_EMAIL_IP)
    expect(beforeLogin.status).toBe(401)
    expect(beforeLogin.code).toBe('AUTH_REQUIRED')

    const reset = await resetPasswordHttp(issued.token, NEW_PASSWORD_A, NEW_EMAIL_IP)
    expect(reset.status).toBe(200)
    expect(reset.message).toContain('verified')

    // Atomic adoption: the account row now resolves by the candidate.
    const byOld = await db.platformAdmin.findUnique({ where: { email: ADOPT_EMAIL } })
    const byNew = await db.platformAdmin.findUnique({ where: { email: CANDIDATE_GMAIL } })
    expect(byOld).toBeNull()
    expect(byNew?.id).toBe(admin.id)

    // Sign-in with the VERIFIED address + new password works; the old
    // address no longer exists for the platform login.
    const viaNew = await platformLoginHttp(CANDIDATE_GMAIL, NEW_PASSWORD_A, NEW_EMAIL_IP)
    expect(viaNew.status).toBe(200)
    const viaOld = await platformLoginHttp(ADOPT_EMAIL, NEW_PASSWORD_A, NEW_EMAIL_IP)
    expect(viaOld.status).toBe(401)
    expect(viaOld.code).toBe('AUTH_REQUIRED')
  }, 30_000)

  test('consume-time conflict fails CLOSED: a candidate claimed by another admin after issuance changes nothing', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: ADOPT2_EMAIL } })
    const candidate = `claimed.${MARKER}@gmail.com`
    const issued = await issuePasswordReset(admin.id, { newEmail: candidate })
    mintedTokens.push(issued.token)

    // The candidate gets claimed by ANOTHER admin between issuance and
    // consumption (direct fixture row — never a real tenant's address).
    await createFixtureAdmin(candidate, `Cl4im!${MARKER}pw`)

    const reset = await resetPasswordHttp(issued.token, NEW_PASSWORD_A, NEW_EMAIL_IP)
    expect(reset.status).toBe(401) // generic refusal — no oracle
    // Fail-closed: password AND email unchanged.
    const row = await db.platformAdmin.findUniqueOrThrow({ where: { email: ADOPT2_EMAIL } })
    expect(verifyPassword(ADOPT2_PASSWORD, row.passwordHash)).toBe(true)
    expect(verifyPassword(NEW_PASSWORD_A, row.passwordHash)).toBe(false)
  }, 30_000)

  test('a suspended admin cannot consume a recovery token (generic refusal, hash unchanged)', async () => {
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { email: SUSPEND_EMAIL } })
    const issued = await issuePasswordReset(admin.id, {})
    mintedTokens.push(issued.token)
    await db.platformAdmin.update({ where: { id: admin.id }, data: { status: 'SUSPENDED' } })
    const reset = await resetPasswordHttp(issued.token, SUSPEND_NEW_PASSWORD, RECOVER_IP)
    expect(reset.status).toBe(401)
    const row = await db.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })
    expect(verifyPassword(SUSPEND_PASSWORD, row.passwordHash)).toBe(true)
    await db.platformAdmin.update({ where: { id: admin.id }, data: { status: 'ACTIVE' } })
  }, 30_000)

  test('school-plane lockouts cannot lock the platform login for the same address (plane-separated buckets)', async () => {
    const shared = `plane-probe-${MARKER}@test.scholario`
    bucketKeysToSweep.push(loginAccountKey(shared), platformLoginAccountKey(shared))
    // School plane: 5 failures lock the SCHOOL account bucket.
    for (let i = 0; i < 5; i++) {
      const r = await schoolLoginHttp(shared, 'wrong-password', SCHOOL_IP)
      expect(r.status).toBe(401)
    }
    const schoolLocked = await schoolLoginHttp(shared, 'wrong-password', SCHOOL_IP)
    expect(schoolLocked.status).toBe(429)
    expect(schoolLocked.code).toBe('ACCOUNT_LOCKED')

    // Platform plane, same address: its OWN bucket is untouched — the
    // attempt reaches the credential check (invalid credentials, NOT a
    // lockout) because no PlatformAdmin holds the address.
    const platformAttempt = await platformLoginHttp(shared, 'wrong-password', PLANE_IP)
    expect(platformAttempt.status).toBe(401)
    expect(platformAttempt.code).toBe('AUTH_REQUIRED')
    await db.rateLimitBucket.deleteMany({ where: { key: loginAccountKey(shared) } }).catch(() => {})
  }, 30_000)

  test('the password-changed notification is attempted with an honest delivery row', async () => {
    const row = await db.emailDelivery.findFirst({
      where: {
        template: 'platform-password-changed',
        createdAt: { gte: SUITE_START },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).not.toBeNull()
    expect(['sent', 'queued', 'skipped', 'failed']).toContain(row?.status ?? '')
    // The notification carries no credential material: the stored fields
    // are recipient + template (+ provider bookkeeping) only.
    for (const tok of mintedTokens) {
      expect(row?.lastError ?? '').not.toContain(tok)
    }
  })

  test('audit hygiene: reset/adoption rows carry no raw tokens or passwords', async () => {
    const rows = await db.platformAuditLog.findMany({
      where: {
        action: {
          in: [
            'platform.password_reset.completed',
            'platform.password_reset.failed',
            'platform.account_email.changed',
            'platform.account_recovery.initiated',
          ],
        },
        createdAt: { gte: SUITE_START },
      },
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const blob = JSON.stringify(row)
      for (const tok of mintedTokens) {
        expect(blob).not.toContain(tok)
      }
      expect(blob).not.toContain(NEW_PASSWORD_A)
      expect(blob).not.toContain(NEW_PASSWORD_B)
      expect(blob).not.toContain(CANDIDATE_GMAIL) // masked domains only
    }
  })
})
