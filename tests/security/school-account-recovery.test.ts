/**
 * SCHOOL-PLANE ACCOUNT RECOVERY SUITE — Student & Staff forgot-password /
 * reset-password (docs/SCHOOL_ACCOUNT_RECOVERY.md, mirroring the platform
 * plane's contract in tests/security/platform-account-recovery.test.ts).
 *
 * COVERAGE:
 *   PART L — lib-level token contract (issue / consume / single-use /
 *            supersede / expiry / hash-at-rest / lockout-clear helper).
 *   PART H — live HTTP against the dev server:
 *            · forgot-password: generic anti-enumeration body for known
 *              + unknown + non-school-role addresses; EmailDelivery row
 *              (dev transport = the delivery in dev); hashed token rows.
 *            · reset-password: valid token changes the password (scrypt
 *              form verified), clears the bootstrap state, revokes EVERY
 *              live session (the pre-reset session stops authenticating),
 *              audits, and the new password signs in through the REAL
 *              school login endpoint; used / unknown / expired / malformed
 *              tokens all surface ONE generic refusal.
 *
 * SAFETY: fixtures are throwaway (unique marker email + school slug),
 * swept by the file-level afterAll (school delete cascades users →
 * sessions → reset rows). No production surface is touched; the
 * platform plane's recovery suite is untouched by definition.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashPassword, verifyPassword } from '@/lib/auth'
import {
  issuePasswordReset,
  consumePasswordReset,
  invalidateUserResetTokens,
  clearSchoolAccountLockout,
  RESET_TOKEN_TTL_MS,
} from '@/lib/school/password-reset'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const RUN_IP = `10.244.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const MARKER = randomBytes(5).toString('hex')
const SUITE_START = new Date()

// ── fixtures ─────────────────────────────────────────────────────────────

const PROBE_EMAIL = `school-recovery-probe-${MARKER}@test.scholario`
const PROBE_PASSWORD = `Pr0be!${MARKER}pw`
const NEW_PASSWORD = `N3w!${MARKER}pass`
const SCHOOL_SLUG = `recovery-t-${MARKER}`

let schoolId = ''
let probeId = ''

beforeAll(async () => {
  const school = await db.school.create({
    data: {
      name: `Recovery Test School ${MARKER}`,
      slug: SCHOOL_SLUG,
      code: `RT${MARKER.slice(0, 6).toUpperCase()}`,
      status: 'ACTIVE',
      plan: 'STANDARD',
    },
  })
  schoolId = school.id
  const user = await db.user.create({
    data: {
      email: PROBE_EMAIL,
      passwordHash: hashPassword(PROBE_PASSWORD),
      name: 'Recovery Probe',
      role: 'PRINCIPAL',
      status: 'ACTIVE',
      schoolId,
      passwordChangedAt: new Date(Date.now() - 86_400_000),
    },
  })
  probeId = user.id
})

afterAll(async () => {
  // School delete cascades User → Session + SchoolPasswordReset.
  await db.school.deleteMany({ where: { id: schoolId } })
  await db.user.deleteMany({ where: { email: PROBE_EMAIL } })
  await db.emailDelivery.deleteMany({ where: { recipient: PROBE_EMAIL } })
})

// ═════════════════════════════════ PART L ═════════════════════════════════

describe('SCHOOL-RECOVERY L · token contract (lib-level)', () => {
  test('issued token is 64-hex; at rest ONLY its sha256 is stored', async () => {
    const issued = await issuePasswordReset(probeId)
    expect(/^[0-9a-f]{64}$/.test(issued.token)).toBe(true)
    const rows = await db.schoolPasswordReset.findMany({ where: { userId: probeId } })
    expect(rows.length).toBe(1)
    // sha256 hex — never the raw token anywhere in the row.
    expect(rows[0].tokenHash).not.toBe(issued.token)
    expect(rows[0].usedAt).toBeNull()
  })

  test('consume: ok once, then USED on replay (single-use)', async () => {
    const issued = await issuePasswordReset(probeId)
    const first = await consumePasswordReset(issued.token)
    expect(first.ok).toBe(true)
    expect(first.userId).toBe(probeId)
    const replay = await consumePasswordReset(issued.token)
    expect(replay.ok).toBe(false)
    expect(replay.failure).toBe('USED')
  })

  test('supersede: a new request invalidates every previous pending token', async () => {
    const a = await issuePasswordReset(probeId)
    const b = await issuePasswordReset(probeId)
    const aConsume = await consumePasswordReset(a.token)
    expect(aConsume.ok).toBe(false)
    expect(aConsume.failure).toBe('USED')
    const bConsume = await consumePasswordReset(b.token)
    expect(bConsume.ok).toBe(true)
  })

  test('expiry: an expired token classifies EXPIRED and never consumes', async () => {
    const { createHash } = await import('crypto')
    const issued = await issuePasswordReset(probeId)
    const tokenHash = createHash('sha256').update(issued.token).digest('hex')
    await db.schoolPasswordReset.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const out = await consumePasswordReset(issued.token)
    expect(out.ok).toBe(false)
    expect(out.failure).toBe('EXPIRED')
  })

  test('malformed tokens classify NOT_FOUND without touching the DB', async () => {
    for (const bad of ['', 'short', 'xyz', `${'a'.repeat(63)}`, `${'g'.repeat(64)}`]) {
      const out = await consumePasswordReset(bad)
      expect(out.ok).toBe(false)
      expect(out.failure).toBe('NOT_FOUND')
    }
  })

  test('TTL is 30 minutes', () => {
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000)
  })

  test('invalidateUserResetTokens burns every pending token', async () => {
    const issued = await issuePasswordReset(probeId)
    await invalidateUserResetTokens(probeId)
    const out = await consumePasswordReset(issued.token)
    expect(out.ok).toBe(false)
    expect(out.failure).toBe('USED')
  })

  test('clearSchoolAccountLockout resets the school per-account login bucket', async () => {
    const { checkRateLimitStrict, loginAccountKey, RATE_LIMITS } = await import(
      '@/lib/security/rate-limit'
    )
    const key = loginAccountKey(`lockout-probe-${MARKER}@test.scholario`)
    // Drain the bucket.
    for (let i = 0; i < RATE_LIMITS.loginAccount.limit; i++) {
      await checkRateLimitStrict(key, RATE_LIMITS.loginAccount)
    }
    const drained = await checkRateLimitStrict(key, RATE_LIMITS.loginAccount)
    expect(drained.allowed).toBe(false)
    clearSchoolAccountLockout(`lockout-probe-${MARKER}@test.scholario`)
    const cleared = await checkRateLimitStrict(key, RATE_LIMITS.loginAccount)
    expect(cleared.allowed).toBe(true)
  })
})

// ═════════════════════════════════ PART H ═════════════════════════════════

describe('SCHOOL-RECOVERY H · forgot-password (anti-enumeration + email pipeline)', () => {
  test('existing ACTIVE school user: 200 generic body; email recorded (dev transport) + token rows hashed', async () => {
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL }),
    })
    const body = (await res.json()) as { ok: boolean; data: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const GENERIC =
      'If that address belongs to a school account, a password reset link has been sent.'
    expect(body.data.message).toBe(GENERIC)
    // EmailDelivery row (dev-log transport IS the delivery in dev).
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: PROBE_EMAIL, template: 'school-password-reset' },
      orderBy: { createdAt: 'desc' },
    })
    expect(delivery).not.toBeNull()
    expect(delivery!.status).toBe('SENT')
    // The reset rows exist, hashed.
    const resets = await db.schoolPasswordReset.findMany({ where: { userId: probeId } })
    expect(resets.length).toBeGreaterThan(0)
    expect(resets.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true)
    // Audit row bound to the user.
    const audit = await db.activityLog.findFirst({
      where: { userId: probeId, action: 'PASSWORD_RESET_REQUESTED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  test('UNKNOWN address: byte-identical response (anti-enumeration)', async () => {
    const known = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL }),
    })
    const unknown = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: `nobody-${MARKER}@nowhere.example` }),
    })
    expect(unknown.status).toBe(known.status)
    expect(await unknown.text()).toBe(await known.text())
    // No email for the unknown address.
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: `nobody-${MARKER}@nowhere.example` },
    })
    expect(delivery).toBeNull()
  })

  test('a PLATFORM identity email: same generic response (no cross-plane disclosure)', async () => {
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'admin@scholario.cloud' }),
    })
    const body = (await res.json()) as { ok: boolean; data: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.message).toContain('If that address belongs')
  })

  test('invalid body → 422 (validation gate)', async () => {
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'not-an-email', extra: 'field' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('SCHOOL-RECOVERY H · reset-password (consume + revoke + sign-in)', () => {
  test('login with the ORIGINAL password works before the reset (baseline)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
    })
    expect(res.status).toBe(200)
  })

  test('valid token: password changes, bootstrap state clears, every session revoked, audit written, new password signs in', async () => {
    // A live pre-reset session that must die with the reset.
    const preToken = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        userId: probeId,
        tokenHash: (await import('crypto')).createHash('sha256').update(preToken).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const issued = await issuePasswordReset(probeId)
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: NEW_PASSWORD }),
    })
    const body = (await res.json()) as { ok: boolean; data?: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    // Password actually changed (scrypt form) + bootstrap state cleared.
    const user = await db.user.findUnique({ where: { id: probeId } })
    expect(verifyPassword(PROBE_PASSWORD, user!.passwordHash!)).toBe(false)
    expect(verifyPassword(NEW_PASSWORD, user!.passwordHash!)).toBe(true)
    expect(user!.mustChangePassword).toBe(false)
    expect(user!.passwordChangedAt!.getTime()).toBeGreaterThan(SUITE_START.getTime())

    // Every live session is revoked — the pre-reset token no longer works.
    const live = await db.session.findMany({ where: { userId: probeId } })
    expect(live).toEqual([])

    // Audit trail: completion event.
    const audit = await db.activityLog.findFirst({
      where: { userId: probeId, action: 'PASSWORD_RESET_COMPLETED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()

    // Change notification (honest dev transport row).
    const notify = await db.emailDelivery.findFirst({
      where: { recipient: PROBE_EMAIL, template: 'school-password-changed' },
      orderBy: { createdAt: 'desc' },
    })
    expect(notify).not.toBeNull()
    expect(notify!.status).toBe('SENT')

    // New password signs in through the REAL school login endpoint.
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL, password: NEW_PASSWORD }),
    })
    expect(login.status).toBe(200)
    const loginBody = (await login.json()) as { data?: { role?: string; schoolId?: string } }
    expect(loginBody.data?.role).toBe('PRINCIPAL')
    expect(loginBody.data?.schoolId).toBe(schoolId)
  })

  test('USED token: ONE generic refusal (no oracle)', async () => {
    const issued = await issuePasswordReset(probeId)
    await consumePasswordReset(issued.token)
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: `An0ther!${MARKER}pw` }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe(
      'This password reset link is invalid or has expired. Request a new reset link and try again.',
    )
  })

  test('UNKNOWN and MALFORMED tokens: the same generic refusal', async () => {
    for (const token of [`${'a'.repeat(64)}`, 'garbage']) {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ token, newPassword: `An0ther!${MARKER}pw` }),
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('invalid or has expired')
    }
  })

  test('EXPIRED token: the same generic refusal', async () => {
    const { createHash } = await import('crypto')
    const issued = await issuePasswordReset(probeId)
    await db.schoolPasswordReset.update({
      where: { tokenHash: createHash('sha256').update(issued.token).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: `An0ther!${MARKER}pw` }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('invalid or has expired')
  })

  test('weak password → 422 (policy gate: 8+ chars, letter + digit)', async () => {
    const issued = await issuePasswordReset(probeId)
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: 'short' }),
    })
    expect(res.status).toBe(422)
    // The token stays pending (validation happens BEFORE consumption).
    const row = await db.schoolPasswordReset.findUnique({
      where: { tokenHash: (await import('crypto')).createHash('sha256').update(issued.token).digest('hex') },
    })
    expect(row!.usedAt).toBeNull()
  })

  test('mismatched passwords are rejected CLIENT-side; the API contract takes { token, newPassword } only', async () => {
    // The API has no confirm field (strict schema rejects unknown fields).
    const issued = await issuePasswordReset(probeId)
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({
        token: issued.token,
        newPassword: `An0ther!${MARKER}pw`,
        confirmPassword: 'different',
      }),
    })
    expect(res.status).toBe(422)
  })
})
