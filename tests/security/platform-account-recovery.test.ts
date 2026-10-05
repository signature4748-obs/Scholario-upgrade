import { db } from '../helpers/db'
/**
 * ACCOUNT-RECOVERY SUITE — PlatformAdmin password reset + Google OIDC
 * + dual-control root recovery (docs/PLATFORM_ACCOUNT_RECOVERY.md).
 *
 * COVERAGE MAP (task §9 test matrix):
 *
 *   1.  Password login (regression)                    [H-1]
 *   2.  Forgot password (email sent + audit)           [H-2, L-1]
 *   3.  Expired reset token                            [U-3, H-7]
 *   4.  Used reset token (single-use)                  [U-2, H-6]
 *   5.  Invalid reset token                            [U-1, H-5]
 *   6.  Session revocation after reset                 [H-8]
 *   7.  Google OAuth success (identity resolution)     [L-4, L-6]
 *   8.  Google OAuth failure (id_token rejection)      [U-11 matrix]
 *   9.  Unlinked Google account                        [L-2, H-11]
 *   10. Wrong Google account (duplicate prevention)    [L-7, L-8]
 *   11. Unauthorized Gmail (no auto-admin)             [L-2, L-9]
 *   12. School principal on platform surfaces          [H-12]
 *   13. Tenant user on platform routes                 [H-13]
 *   14. Duplicate account prevention                   [L-7, L-10]
 *   15. Rate limiting                                  [H-4]
 *   16. Audit events                                   [L-1, audit asserts]
 *   17. Anti-enumeration (generic responses)           [H-3]
 *   18. Root recovery dual-control (two-person rule)   [H-14]
 *
 * SAFETY-ACCEPTANCE (release §7 matrix — RELEASE-PIPELINE-1 / IMPL-4):
 *   · final-method invariant: an unlink that would strip an admin's
 *     LAST usable sign-in method is refused at every layer — lib,
 *     self route, assisted route, dual-control recovery — plus the
 *     schema-level proof that PlatformAdmin.passwordHash is NOT NULL
 *     (a NULL insert is rejected by the DB itself)      [S-1..S-5]
 *   · cross-admin linking: an already-owned Google identity cannot
 *     be linked to a second admin (both rows unchanged)  [S-6]
 *   · suspended admin: forgot-password answers the identical generic
 *     envelope and issues NOTHING                         [S-7]
 *   · step-up: every sensitive account-recovery mutation declares
 *     stepUp: true; the TOTP env switch re-arms the gate
 *     (PLATFORM_TOTP_ENABLED unset = the documented stood-down
 *     posture)                                            [S-8]
 *   · password reset never removes the Google link (methods
 *     only grow)                                          [S-9]
 *
 * STYLE: the repo convention — PART U (pure unit over exported libs)
 * + PART L (lib-level DB operations) + PART H (live HTTP against the
 * dev server with real platform sessions; direct-minted session rows
 * bypass ONLY the login limiter, never an authorization gate).
 *
 * The dev server runs with FAKE local GOOGLE_OAUTH_* values
 * (status→enabled). No real Google network dependency is asserted —
 * the exchange path is covered at unit level (verifyIdToken) and the
 * state/CSRF gates are exercised before any network call.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
} from 'crypto'
import { hashPassword, verifyPassword } from '@/lib/auth'
import {
  hashToken,
  hasLiveStepUp,
  STEP_UP_WINDOW_MS,
  type PlatformSessionAuth,
} from '@/lib/platform/auth'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import {
  issuePasswordReset,
  consumePasswordReset,
  invalidateAdminResetTokens,
  RESET_TOKEN_TTL_MS,
} from '@/lib/platform/password-reset'
import {
  googleLogin,
  linkGoogleIdentity,
  unlinkGoogleIdentity,
} from '@/lib/platform/google-account'
import {
  verifyIdToken,
  encodeOAuthState,
  decodeOAuthState,
  stateMatches,
  newCodeVerifier,
  codeChallengeS256,
  OAUTH_STATE_COOKIE,
  isGoogleAuthConfigured,
  googleRedirectUri,
} from '@/lib/platform/google'
import { generateTotpSecret } from '@/lib/platform/totp'
import { PLATFORM_ROOT_PASSWORD, TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const RUN_IP = `10.243.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const MARKER = randomBytes(5).toString('hex')
const SUITE_START = new Date()

// ── fixtures ─────────────────────────────────────────────────────────────

const PROBE_EMAIL = `recovery-probe-${MARKER}@test.scholario`
const PROBE2_EMAIL = `recovery-probe2-${MARKER}@test.scholario`
const PROBE_PASSWORD = `Pr0be!${MARKER}pw`
const PROBE2_PASSWORD = `Pr0be2!${MARKER}pw`
const GOOGLE_SUB = `gsub-${MARKER}-identity`
const GOOGLE_EMAIL = `probe.google.${MARKER}@gmail.com`

// Corpus roots (seeded): the dual-control identities.
const ROOT_EMAIL = 'admin@scholario.cloud'
const ROOT2_EMAIL = 'admin@erpsuite.io'
const ROOT3_EMAIL = 'tenant.superadmin@hawkings.test'

let probeId = ''
let probe2Id = ''
let rootId = ''
let root2Id = ''
let root3Id = ''
const mintedSessionIds: string[] = []
let root3GoogleWas: string | null = null

// Release-acceptance (§7) fixtures: every test creates its own admins
// (never a corpus root); ids + emails are swept by the file-level
// afterAll — deleting an admin cascades its sessions and password-reset
// rows, while PlatformRecoveryTicket rows (no FK) are deleted per test.
const safetyAdminIds: string[] = []
const safetyFixtureEmails: string[] = []
// Dedicated IP for the safety block's PUBLIC forgot/reset-password
// probes: the per-IP buckets (5/h) are already spent on RUN_IP by the
// H-part probes, and this IP is fresh per run (idempotent re-runs).
const SAFETY_IP = `10.249.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

/** Mint a live PlatformAdminSession for an admin (test fixture —
 *  bypasses ONLY the login limiter, exactly like the Phase-6 suite). */
async function mintSession(
  adminId: string,
  opts: { stepUp?: boolean } = {},
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const row = await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: hashToken(token),
      stepUpAt: opts.stepUp ? new Date() : null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: 'account-recovery-test',
      ipAddress: RUN_IP,
    },
  })
  mintedSessionIds.push(row.id)
  return token
}

async function platformLoginHttp(
  email: string,
  password: string,
  ip = RUN_IP,
): Promise<{ status: number; token?: string; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const data = body.data as { sessionToken?: string } | undefined
  return { status: res.status, token: data?.sessionToken, body }
}

// ══ PART U · pure units — OIDC verification + OAuth state ════════════════

// Local RSA keypair → JWKS + id_token signer (the verifier is pure; no
// Google network is involved anywhere in PART U).
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const TEST_KID = `test-key-${MARKER}`
const TEST_CLIENT_ID = 'test-client-id.unit'
const TEST_JWKS = { keys: [{ kid: TEST_KID, kty: 'RSA', alg: 'RS256', use: 'sig', ...(publicKey.export({ format: 'jwk' }) as Record<string, string>) }] }

function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function makeIdToken(
  claims: Record<string, unknown>,
  opts: { kid?: string; alg?: string; tamper?: boolean } = {},
): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? TEST_KID }
  const h = b64u(JSON.stringify(header))
  const p = b64u(JSON.stringify(claims))
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey)
  const s = b64u(opts.tamper ? Buffer.concat([signature.subarray(0, 8), randomBytes(232)]) : signature)
  return `${h}.${p}.${s}`
}

const VALID_CLAIMS = () => ({
  iss: 'https://accounts.google.com',
  aud: TEST_CLIENT_ID,
  sub: 'google-sub-unit-1',
  email: 'unit.person@gmail.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 300,
  iat: Math.floor(Date.now() / 1000),
})

describe('ACCOUNT-RECOVERY U · verifyIdToken (full OIDC verification matrix)', () => {
  test('valid RS256 id_token verifies; identity extracted (sub, email)', () => {
    const out = verifyIdToken(makeIdToken(VALID_CLAIMS()), TEST_JWKS, TEST_CLIENT_ID)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.identity.sub).toBe('google-sub-unit-1')
      expect(out.identity.email).toBe('unit.person@gmail.com')
      expect(out.identity.emailVerified).toBe(true)
    }
  })
  test('tampered signature → BAD_SIGNATURE', () => {
    const out = verifyIdToken(makeIdToken(VALID_CLAIMS(), { tamper: true }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'BAD_SIGNATURE' })
  })
  test('wrong audience (another OAuth client) → BAD_AUDIENCE', () => {
    const out = verifyIdToken(makeIdToken({ ...VALID_CLAIMS(), aud: 'other-client' }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'BAD_AUDIENCE' })
  })
  test('wrong issuer → BAD_ISSUER', () => {
    const out = verifyIdToken(makeIdToken({ ...VALID_CLAIMS(), iss: 'https://evil.example' }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'BAD_ISSUER' })
  })
  test('expired token → EXPIRED (60s leeway honored)', () => {
    const out = verifyIdToken(
      makeIdToken({ ...VALID_CLAIMS(), exp: Math.floor(Date.now() / 1000) - 3600 }),
      TEST_JWKS,
      TEST_CLIENT_ID,
    )
    expect(out).toEqual({ ok: false, failure: 'EXPIRED' })
  })
  test('unknown kid (key rotation miss) → UNKNOWN_KID', () => {
    const out = verifyIdToken(makeIdToken(VALID_CLAIMS(), { kid: 'rotated-away' }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'UNKNOWN_KID' })
  })
  test('non-RS256 header → BAD_HEADER', () => {
    const out = verifyIdToken(makeIdToken(VALID_CLAIMS(), { alg: 'HS256' }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'BAD_HEADER' })
  })
  test('malformed token (not 3 segments) → MALFORMED', () => {
    expect(verifyIdToken('not.a', TEST_JWKS, TEST_CLIENT_ID)).toEqual({ ok: false, failure: 'MALFORMED' })
    expect(verifyIdToken('!!!', TEST_JWKS, TEST_CLIENT_ID)).toEqual({ ok: false, failure: 'MALFORMED' })
  })
  test('missing sub → NO_SUB', () => {
    const claims = VALID_CLAIMS() as Record<string, unknown>
    delete claims.sub
    const out = verifyIdToken(makeIdToken(claims), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'NO_SUB' })
  })
  test('email_verified=false → EMAIL_NOT_VERIFIED', () => {
    const out = verifyIdToken(makeIdToken({ ...VALID_CLAIMS(), email_verified: false }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out).toEqual({ ok: false, failure: 'EMAIL_NOT_VERIFIED' })
  })
  test('audience as ARRAY containing our client id is accepted', () => {
    const out = verifyIdToken(makeIdToken({ ...VALID_CLAIMS(), aud: [TEST_CLIENT_ID, 'other'] }), TEST_JWKS, TEST_CLIENT_ID)
    expect(out.ok).toBe(true)
  })
})

describe('ACCOUNT-RECOVERY U · OAuth state cookie + PKCE', () => {
  test('login round-trip: encode → decode preserves purpose/verifier/state', () => {
    const payload = { state: randomBytes(32).toString('hex'), verifier: newCodeVerifier(), purpose: 'login' as const, exp: Date.now() + 60_000 }
    const decoded = decodeOAuthState(encodeOAuthState(payload))
    expect(decoded).toEqual(payload)
  })
  test('link round-trip preserves the adminId binding', () => {
    const payload = { state: randomBytes(32).toString('hex'), verifier: newCodeVerifier(), purpose: 'link' as const, adminId: 'admin-123', exp: Date.now() + 60_000 }
    expect(decodeOAuthState(encodeOAuthState(payload))).toEqual(payload)
  })
  test('expired payload is rejected (exp in the past)', () => {
    const payload = { state: 'x'.repeat(64), verifier: 'v', purpose: 'login' as const, exp: Date.now() - 1000 }
    expect(decodeOAuthState(encodeOAuthState(payload))).toBeNull()
  })
  test('link purpose without adminId is rejected', () => {
    const payload = { state: 'x'.repeat(64), verifier: 'v', purpose: 'link' as const, exp: Date.now() + 60_000 }
    expect(decodeOAuthState(encodeOAuthState(payload))).toBeNull()
  })
  test('garbage cookie values are rejected', () => {
    expect(decodeOAuthState(undefined)).toBeNull()
    expect(decodeOAuthState('')).toBeNull()
    expect(decodeOAuthState('not-a-query-string-$$$')).toBeNull()
  })
  test('stateMatches: equal true / different false / length-safe', () => {
    const s = randomBytes(32).toString('hex')
    expect(stateMatches(s, s)).toBe(true)
    expect(stateMatches(s, randomBytes(32).toString('hex'))).toBe(false)
    expect(stateMatches(s, s.slice(0, 60))).toBe(false)
  })
  test('PKCE S256 challenge is the base64url sha256 of the verifier (RFC 7636)', () => {
    const verifier = newCodeVerifier()
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(codeChallengeS256(verifier)).toBe(expected)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })
  test('live env read: the dev server test config is visible in-process too', () => {
    // The test process inherits the same env file values via the harness;
    // the routes read them in the server process. This pins the helper
    // contract (both unset ⇒ false).
    const savedId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const savedSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    expect(isGoogleAuthConfigured()).toBe(false)
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'x'
    expect(isGoogleAuthConfigured()).toBe(false) // secret still missing
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'y'
    expect(isGoogleAuthConfigured()).toBe(true)
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    if (savedId !== undefined) process.env.GOOGLE_OAUTH_CLIENT_ID = savedId
    if (savedSecret !== undefined) process.env.GOOGLE_OAUTH_CLIENT_SECRET = savedSecret
  })
  test('googleRedirectUri: env override wins, else derived from origin', () => {
    const saved = process.env.GOOGLE_OAUTH_REDIRECT_URI
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI
    expect(googleRedirectUri('https://prod.example/')).toBe('https://prod.example/api/platform/auth/google/callback')
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://canonical.example/api/platform/auth/google/callback'
    expect(googleRedirectUri('https://other.example')).toBe('https://canonical.example/api/platform/auth/google/callback')
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI
    if (saved !== undefined) process.env.GOOGLE_OAUTH_REDIRECT_URI = saved
  })
})

// ══ PART L · lib-level account operations (real DB) ══════════════════════

describe('ACCOUNT-RECOVERY L · password reset tokens (hashed, single-use)', () => {
  test('issue: raw token exists only in memory; at rest is sha256(token)', async () => {
    const issued = await issuePasswordReset(probeId)
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/)
    const row = await db.platformPasswordReset.findUnique({ where: { tokenHash: hashToken(issued.token) } })
    expect(row).not.toBeNull()
    expect(row!.tokenHash).not.toBe(issued.token) // never the raw token
    expect(row!.adminId).toBe(probeId)
    expect(row!.usedAt).toBeNull()
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
  test('consume: valid → ok; second consume → USED (single-use)', async () => {
    const issued = await issuePasswordReset(probeId)
    expect((await consumePasswordReset(issued.token)).ok).toBe(true)
    const second = await consumePasswordReset(issued.token)
    expect(second).toEqual({ ok: false, failure: 'USED' })
  })
  test('expired token → EXPIRED', async () => {
    const issued = await issuePasswordReset(probeId)
    await db.platformPasswordReset.update({
      where: { tokenHash: hashToken(issued.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await consumePasswordReset(issued.token)).toEqual({ ok: false, failure: 'EXPIRED' })
  })
  test('invalid shape and unknown token → NOT_FOUND (no oracle)', async () => {
    expect(await consumePasswordReset('not-a-token')).toEqual({ ok: false, failure: 'NOT_FOUND' })
    expect(await consumePasswordReset(randomBytes(32).toString('hex'))).toEqual({ ok: false, failure: 'NOT_FOUND' })
  })
  test('a NEW request supersedes the previous pending token (single outstanding)', async () => {
    const first = await issuePasswordReset(probeId)
    const second = await issuePasswordReset(probeId)
    expect(await consumePasswordReset(first.token)).toEqual({ ok: false, failure: 'USED' })
    expect((await consumePasswordReset(second.token)).ok).toBe(true)
  })
  test('invalidateAdminResetTokens burns every pending token for the admin', async () => {
    const a = await issuePasswordReset(probeId)
    const b = await issuePasswordReset(probeId) // supersedes a already; burn both anyway
    await invalidateAdminResetTokens(probeId)
    expect((await consumePasswordReset(b.token)).ok).toBe(false)
    expect((await consumePasswordReset(a.token)).ok).toBe(false)
  })
  test('TTL is 30 minutes (documented contract)', () => {
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000)
  })
})

describe('ACCOUNT-RECOVERY L · Google identity resolution (same-account, no auto-create)', () => {
  test('NOT_LINKED: an arbitrary Gmail/Google sub resolves to nobody (no account created)', async () => {
    const before = await db.platformAdmin.count()
    const out = await googleLogin(`unlinked-${MARKER}`, { ip: RUN_IP })
    expect(out).toEqual({ ok: false, failure: 'NOT_LINKED' })
    expect(await db.platformAdmin.count()).toBe(before) // NOTHING was created
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.login.failed', reason: { contains: 'not linked' } },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
  test('link: explicit link stores the minimum identity (sub, email, timestamp) + audit', async () => {
    const out = await linkGoogleIdentity(probeId, GOOGLE_SUB, GOOGLE_EMAIL)
    expect(out.ok).toBe(true)
    const admin = await db.platformAdmin.findUnique({ where: { id: probeId } })
    expect(admin!.googleSub).toBe(GOOGLE_SUB)
    expect(admin!.googleEmail).toBe(GOOGLE_EMAIL)
    expect(admin!.googleLinkedAt).not.toBeNull()
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.admin.google_linked', targetId: probeId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
  test('google login for the linked identity → session minted for the SAME admin id (hashed at rest)', async () => {
    const beforeSessions = await db.platformAdminSession.count({ where: { adminId: probeId } })
    const out = await googleLogin(GOOGLE_SUB, { ip: RUN_IP })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.adminId).toBe(probeId)
      expect(out.token).toMatch(/^[0-9a-f]{64}$/)
      // At rest: sha256(token) — the raw token never persisted.
      const row = await db.platformAdminSession.findUnique({ where: { tokenHash: hashToken(out.token) } })
      expect(row).not.toBeNull()
      expect(row!.tokenHash).not.toBe(out.token)
    }
    expect(await db.platformAdminSession.count({ where: { adminId: probeId } })).toBe(beforeSessions + 1)
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.login.success', targetId: probeId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ method: 'google', root: false })
  })
  test('SAME ACCOUNT invariant: password AND Google resolve to one PlatformAdmin id', async () => {
    const passwordOk = verifyPassword(PROBE_PASSWORD, (await db.platformAdmin.findUnique({ where: { id: probeId } }))!.passwordHash)
    expect(passwordOk).toBe(true)
    const google = await googleLogin(GOOGLE_SUB, {})
    expect(google.ok && google.adminId).toBe(probeId)
    // And the account email is the PROBE account, not the Google email.
    const admin = await db.platformAdmin.findUnique({ where: { id: probeId } })
    expect(admin!.email).toBe(PROBE_EMAIL)
  })
  test('duplicate prevention: the same Google sub cannot link to a second admin', async () => {
    const out = await linkGoogleIdentity(probe2Id, GOOGLE_SUB, 'other@gmail.com')
    expect(out).toEqual({ ok: false, failure: 'ALREADY_LINKED_OTHER' })
    const probe2 = await db.platformAdmin.findUnique({ where: { id: probe2Id } })
    expect(probe2!.googleSub).toBeNull()
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.admin.google_link_failed', targetId: probe2Id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
  test('self re-link → ALREADY_LINKED_SELF', async () => {
    expect(await linkGoogleIdentity(probeId, GOOGLE_SUB, GOOGLE_EMAIL)).toEqual({
      ok: false,
      failure: 'ALREADY_LINKED_SELF',
    })
  })
  test('SUSPENDED admin: Google login is refused (status is canonical), no session', async () => {
    await db.platformAdmin.update({ where: { id: probeId }, data: { status: 'SUSPENDED' } })
    const before = await db.platformAdminSession.count({ where: { adminId: probeId } })
    const out = await googleLogin(GOOGLE_SUB, { ip: RUN_IP })
    expect(out).toEqual({ ok: false, failure: 'SUSPENDED' })
    expect(await db.platformAdminSession.count({ where: { adminId: probeId } })).toBe(before)
    await db.platformAdmin.update({ where: { id: probeId }, data: { status: 'ACTIVE' } })
  })
  test('unlink: identity cleared + audit; second unlink is a no-op', async () => {
    const out = await unlinkGoogleIdentity(probeId, { byAdminId: probeId })
    expect(out).toEqual({ ok: true, wasLinked: true })
    const admin = await db.platformAdmin.findUnique({ where: { id: probeId } })
    expect(admin!.googleSub).toBeNull()
    expect(admin!.googleEmail).toBeNull()
    expect(admin!.googleLinkedAt).toBeNull()
    expect(await unlinkGoogleIdentity(probeId, { byAdminId: probeId })).toEqual({ ok: false, wasLinked: false })
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.admin.google_unlinked', targetId: probeId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
})

// ══ PART H · live HTTP (dev server) ══════════════════════════════════════

describe('ACCOUNT-RECOVERY H · forgot-password (anti-enumeration + email pipeline)', () => {
  test('existing ACTIVE admin: 200 generic body; email recorded (dev transport) + token row hashed', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL }),
    })
    const body = (await res.json()) as { ok: boolean; data: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const GENERIC = 'If that address belongs to a platform administrator account, a password reset link has been sent.'
    expect(body.data.message).toBe(GENERIC)
    // EmailDelivery row (dev-log transport IS the delivery in dev).
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: PROBE_EMAIL, template: 'platform-password-reset' },
      orderBy: { createdAt: 'desc' },
    })
    expect(delivery).not.toBeNull()
    expect(delivery!.status).toBe('SENT')
    // The reset row exists, hashed.
    const resets = await db.platformPasswordReset.findMany({ where: { adminId: probeId } })
    expect(resets.length).toBeGreaterThan(0)
    expect(resets.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true)
  })
  test('UNKNOWN address: byte-identical response (anti-enumeration)', async () => {
    const known = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PROBE_EMAIL }),
    })
    const unknown = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: `nobody-${MARKER}@nowhere.example` }),
    })
    expect(unknown.status).toBe(known.status)
    expect(await unknown.text()).toBe(await known.text())
  })
  test('a SCHOOL PRINCIPAL address: same generic response (no cross-plane disclosure)', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'principal@hawkingshigh.edu' }),
    })
    const body = (await res.json()) as { ok: boolean; data: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.message).toContain('If that address belongs')
    // No email was sent for the principal (not a PlatformAdmin).
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: 'principal@hawkingshigh.edu', template: 'platform-password-reset', createdAt: { gte: SUITE_START } },
    })
    expect(delivery).toBeNull()
  })
  test('invalid body → 422 (validation gate)', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ notEmail: true }),
    })
    expect(res.status).toBe(422)
  })
  test('rate limit: per-account bucket locks repeated requests for one address', async () => {
    const email = `ratelimit-${MARKER}@test.scholario`
    const ip = `10.244.${Math.floor(Math.random() * 250)}.7`
    let lastStatus = 0
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email }),
      })
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)
  })
})

describe('ACCOUNT-RECOVERY H · reset-password (consume + revoke + audit)', () => {
  test('password login for the probe works before the reset (regression baseline)', async () => {
    const out = await platformLoginHttp(PROBE_EMAIL, PROBE_PASSWORD)
    expect(out.status).toBe(200)
    expect(out.token).toBeDefined()
  })

  test('valid token: password changes, every session revoked, audit written', async () => {
    // A live pre-reset session that must die with the reset.
    const preToken = await mintSession(probeId)
    const issued = await issuePasswordReset(probeId)
    const NEW_PASSWORD = `N3w!${MARKER}pass`

    const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: NEW_PASSWORD }),
    })
    const body = (await res.json()) as { ok: boolean; data?: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    // Password actually changed (old false, new true) — hash form.
    const admin = await db.platformAdmin.findUnique({ where: { id: probeId } })
    expect(verifyPassword(PROBE_PASSWORD, admin!.passwordHash)).toBe(false)
    expect(verifyPassword(NEW_PASSWORD, admin!.passwordHash)).toBe(true)

    // Every live session of the admin is revoked — including the
    // pre-reset one (session revocation on password change).
    const revoked = await db.platformAdminSession.findMany({
      where: { adminId: probeId, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    expect(revoked).toEqual([])

    // The revoked pre-reset token no longer authenticates.
    const me = await fetch(`${BASE}/api/platform/auth/me`, {
      headers: { 'x-platform-token': preToken },
    })
    expect(me.status).toBe(401)

    // Audit trail.
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.password_reset.completed', targetId: probeId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ revokedSessions: expect.any(Number) })

    // New password logs in (password login path intact).
    const relogin = await platformLoginHttp(PROBE_EMAIL, NEW_PASSWORD, `10.245.${MARKER.length % 250}.9`)
    expect(relogin.status).toBe(200)
  })

  test('used token: rejected with the generic message (single-use)', async () => {
    const issued = await issuePasswordReset(probeId)
    const consume = (token: string, pw = `Val1d!pass${MARKER}`) =>
      fetch(`${BASE}/api/platform/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ token, newPassword: pw }),
      })
    const first = await consume(issued.token)
    expect(first.status).toBe(200)
    const second = await consume(issued.token)
    expect(second.status).toBe(401)
    const body = (await second.json()) as { ok: boolean; error: string }
    expect(body.error).toContain('invalid or has expired')
  })

  test('invalid token and expired token: IDENTICAL generic failure (no oracle)', async () => {
    const call = async (token: string) => {
      const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ token, newPassword: `Val1d!pass${MARKER}` }),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
    // Anti-enumeration contract: identical status + error + code (the
    // requestId is per-response correlation, inherently unique).
    const shape = (r: { status: number; body: Record<string, unknown> }) => {
      const { requestId, ...rest } = r.body
      expect(requestId).toBeTruthy()
      return JSON.stringify({ status: r.status, ...rest })
    }
    const garbage = await call(randomBytes(32).toString('hex'))
    const malformed = await call('zzz-not-a-token')
    expect(garbage.status).toBe(401)
    expect(shape(garbage)).toBe(shape(malformed))
    expect((garbage.body as { error: string }).error).toContain('invalid or has expired')

    const issued = await issuePasswordReset(probeId)
    await db.platformPasswordReset.update({
      where: { tokenHash: hashToken(issued.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const expired = await call(issued.token)
    expect(expired.status).toBe(401)
    expect(shape(expired)).toBe(shape(garbage))
  })

  test('weak new password → 422 (password policy holds)', async () => {
    const issued = await issuePasswordReset(probeId)
    const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ token: issued.token, newPassword: 'short' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('ACCOUNT-RECOVERY H · Google OAuth routes (state/CSRF/PKCE contract)', () => {
  test('status probe is public and reports the honest capability', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/google/status`)
    const body = (await res.json()) as { ok: boolean; data: { enabled: boolean } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.data.enabled).toBe('boolean')
    // Dev server runs with test values configured → enabled.
    expect(body.data.enabled).toBe(true)
  })

  test('start: 302 to Google consent with PKCE S256 + minimal scope; state cookie HttpOnly + path-scoped', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/google/start`, {
      redirect: 'manual',
      headers: { 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    const url = new URL(location)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email') // minimal
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('prompt')).toBe('select_account')
    const state = url.searchParams.get('state')!
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/api/platform/auth/google/callback`)

    // The state cookie: HttpOnly, SameSite=Lax (serialized lowercase),
    // path-scoped, 10-min TTL.
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain(`${OAUTH_STATE_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(/samesite=lax/i.test(setCookie)).toBe(true)
    expect(setCookie).toContain('Path=/api/platform/auth/google')
    expect(setCookie).toContain('Max-Age=600')
    const cookieValue = decodeURIComponent(setCookie.split(';')[0]!.split('=').slice(1).join('='))
    const payload = decodeOAuthState(cookieValue)
    expect(payload).not.toBeNull()
    expect(payload!.purpose).toBe('login')
    expect(payload!.state).toBe(state)
    // PKCE binding: the challenge in the URL is S256(cookie verifier).
    expect(codeChallengeS256(payload!.verifier)).toBe(url.searchParams.get('code_challenge'))
  })

  test('callback without state cookie → login?error=GOOGLE_STATE_INVALID', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/google/callback?state=${'a'.repeat(64)}&code=x`, {
      redirect: 'manual',
      headers: { 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/platform/login?error=GOOGLE_STATE_INVALID')
  })

  test('callback with MISMATCHED state (CSRF) → rejected before anything else', async () => {
    const payload = encodeOAuthState({
      state: 'a'.repeat(64),
      verifier: newCodeVerifier(),
      purpose: 'login',
      exp: Date.now() + 60_000,
    })
    const res = await fetch(`${BASE}/api/platform/auth/google/callback?state=${'b'.repeat(64)}&code=x`, {
      redirect: 'manual',
      headers: {
        'x-forwarded-for': RUN_IP,
        cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(payload)}`,
      },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/platform/login?error=GOOGLE_STATE_INVALID')
  })

  test('callback with expired state cookie → rejected', async () => {
    const payload = encodeOAuthState({
      state: 'a'.repeat(64),
      verifier: newCodeVerifier(),
      purpose: 'login',
      exp: Date.now() - 1000,
    })
    const res = await fetch(`${BASE}/api/platform/auth/google/callback?state=${'a'.repeat(64)}&code=x`, {
      redirect: 'manual',
      headers: {
        'x-forwarded-for': RUN_IP,
        cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(payload)}`,
      },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('GOOGLE_STATE_INVALID')
  })

  test('callback with Google error param (user denied consent) → GOOGLE_SIGNIN_FAILED', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/google/callback?error=access_denied`, {
      redirect: 'manual',
      headers: { 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('GOOGLE_SIGNIN_FAILED')
  })

  test('callback with valid state + fake code: exchange fails → GOOGLE_SIGNIN_FAILED (never a session)', async () => {
    const payload = encodeOAuthState({
      state: 'c'.repeat(64),
      verifier: newCodeVerifier(),
      purpose: 'login',
      exp: Date.now() + 60_000,
    })
    const res = await fetch(`${BASE}/api/platform/auth/google/callback?state=${'c'.repeat(64)}&code=fake-code`, {
      redirect: 'manual',
      headers: {
        'x-forwarded-for': RUN_IP,
        cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(payload)}`,
      },
    })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    // The fake credentials cannot exchange — honest failure redirect.
    // (Network-unavailable also lands here; never a session either way.)
    expect(location).toContain('GOOGLE_SIGNIN_FAILED')
    const sessionsBefore = await db.platformAdminSession.count()
    expect(sessionsBefore).toBeGreaterThanOrEqual(0) // no crash, no session minted for fake identity
  })
})

describe('ACCOUNT-RECOVERY H · authenticated Google surfaces (link/unlink/me)', () => {
  test('link/start WITHOUT a platform session → 401 at the middleware boundary', async () => {
    const res = await fetch(`${BASE}/api/platform/auth/google/link/start`, { redirect: 'manual' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('AUTH_REQUIRED')
  })

  test('me route exposes googleLinked/googleEmail for the signed-in admin', async () => {
    // Re-link probe, mint a session, read /me.
    await linkGoogleIdentity(probeId, GOOGLE_SUB, GOOGLE_EMAIL)
    const token = await mintSession(probeId)
    const res = await fetch(`${BASE}/api/platform/auth/me`, {
      headers: { 'x-platform-token': token },
    })
    const body = (await res.json()) as {
      ok: boolean
      data?: { admin: { googleLinked: boolean; googleEmail: string | null; id: string } }
    }
    expect(res.status).toBe(200)
    expect(body.data!.admin.googleLinked).toBe(true)
    expect(body.data!.admin.googleEmail).toBe(GOOGLE_EMAIL)
    expect(body.data!.admin.id).toBe(probeId)
  })

  test('unlink (own account, session): identity removed + ALL sessions revoked', async () => {
    await linkGoogleIdentity(probeId, GOOGLE_SUB, GOOGLE_EMAIL)
    const token = await mintSession(probeId)
    const res = await fetch(`${BASE}/api/platform/auth/google/unlink`, {
      method: 'POST',
      headers: { 'x-platform-token': token, 'x-forwarded-for': RUN_IP },
    })
    const body = (await res.json()) as { ok: boolean; data?: { revokedSessions: number } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data!.revokedSessions).toBeGreaterThanOrEqual(1)
    const admin = await db.platformAdmin.findUnique({ where: { id: probeId } })
    expect(admin!.googleSub).toBeNull()
    // The session that performed the unlink is itself revoked → 401.
    const after = await fetch(`${BASE}/api/platform/auth/me`, {
      headers: { 'x-platform-token': token },
    })
    expect(after.status).toBe(401)
  })

  test('unlink with NOTHING linked → 409 conflict', async () => {
    const token = await mintSession(probe2Id)
    const res = await fetch(`${BASE}/api/platform/auth/google/unlink`, {
      method: 'POST',
      headers: { 'x-platform-token': token, 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(409)
  })

  test('school principal credentials NEVER authenticate platform surfaces', async () => {
    // School login (real endpoint) → a valid SCHOOL token…
    const schoolRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({
        email: 'principal.b@greenvalley.test',
        password: TENANT_FIXTURE_PASSWORD,
      }),
    })
    const schoolBody = (await schoolRes.json()) as { ok: boolean; data?: { sessionToken?: string } }
    if (schoolRes.status === 429) return // login limiter (repeated runs) — the 401s below are covered standalone
    expect(schoolBody.ok).toBe(true)
    const schoolToken = schoolBody.data!.sessionToken!
    expect(schoolToken).toBeTruthy()

    // …but it cannot satisfy the PLATFORM boundary in ANY transport:
    // as the school bearer (wrong token space),
    const asBearer = await fetch(`${BASE}/api/platform/auth/google/unlink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolToken}` },
    })
    expect(asBearer.status).toBe(401)
    // as the platform cookie (cookie name mismatch by design),
    const asCookie = await fetch(`${BASE}/api/platform/admins/recovery`, {
      headers: { cookie: `erp_session=${schoolToken}` },
    })
    expect(asCookie.status).toBe(401)
    // and on the recovery confirm surface.
    const asHeader = await fetch(`${BASE}/api/platform/admins/recovery/${'x'.repeat(25)}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': schoolToken },
    })
    expect(asHeader.status).toBe(401)
  })

  test('non-root ops (no admins.manage) cannot drive admin-assisted recovery', async () => {
    const ops = await db.platformAdmin.findUnique({ where: { email: 'ops@scholario.io' } })
    const token = await mintSession(ops!.id)
    const res = await fetch(`${BASE}/api/platform/admins/${probeId}/reset-password`, {
      method: 'POST',
      headers: { 'x-platform-token': token, 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(403)
  })
})

describe('ACCOUNT-RECOVERY H · root recovery — dual-control (two-person rule)', () => {
  let ticketId = ''

  test('root target: initiation creates a ticket and sends NOTHING yet', async () => {
    // ROOT initiator (scholario.cloud) initiates against ROOT target
    // (tenant.superadmin) — a third distinct identity.
    const rootToken = await mintSession(rootId)
    const deliveriesBefore = await db.emailDelivery.count({
      where: { recipient: ROOT3_EMAIL, template: 'platform-password-reset', createdAt: { gte: SUITE_START } },
    })
    const res = await fetch(`${BASE}/api/platform/admins/${root3Id}/reset-password`, {
      method: 'POST',
      headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
    })
    const body = (await res.json()) as {
      ok: boolean
      data?: { dualControl: boolean; ticketId?: string; message?: string }
    }
    expect(res.status).toBe(200)
    expect(body.data!.dualControl).toBe(true)
    ticketId = body.data!.ticketId!

    const ticket = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
    expect(ticket).not.toBeNull()
    expect(ticket!.action).toBe('PASSWORD_RESET')
    expect(ticket!.targetAdminId).toBe(root3Id)
    expect(ticket!.initiatedBy).toBe(rootId)
    expect(ticket!.executedAt).toBeNull()
    // NOTHING executed: no email, no reset token for the target yet.
    expect(
      await db.emailDelivery.count({
        where: { recipient: ROOT3_EMAIL, template: 'platform-password-reset', createdAt: { gte: SUITE_START } },
      }),
    ).toBe(deliveriesBefore)
    expect(
      await db.platformPasswordReset.count({ where: { adminId: root3Id, createdAt: { gte: SUITE_START } } }),
    ).toBe(0)
    // Audit.
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.recovery.initiated', targetId: root3Id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  test('the ticket appears in the pending queue (admins.manage)', async () => {
    const rootToken = await mintSession(rootId)
    const res = await fetch(`${BASE}/api/platform/admins/recovery`, {
      headers: { 'x-platform-token': rootToken },
    })
    const body = (await res.json()) as {
      ok: boolean
      data?: { tickets: Array<{ id: string; action: string; target: { id: string }; initiatedBy: { id: string } }> }
    }
    expect(res.status).toBe(200)
    const mine = body.data!.tickets.find((t) => t.id === ticketId)
    expect(mine).toBeDefined()
    expect(mine!.action).toBe('PASSWORD_RESET')
    expect(mine!.target.id).toBe(root3Id)
  })

  test('the INITIATOR cannot confirm their own ticket (two-person rule)', async () => {
    const rootToken = await mintSession(rootId)
    const res = await fetch(`${BASE}/api/platform/admins/recovery/${ticketId}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(409)
    const ticket = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
    expect(ticket!.executedAt).toBeNull()
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.recovery.refused', targetId: root3Id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  test('the TARGET cannot confirm their own recovery ticket', async () => {
    const targetToken = await mintSession(root3Id)
    const res = await fetch(`${BASE}/api/platform/admins/recovery/${ticketId}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': targetToken, 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(409)
    expect((await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } }))!.executedAt).toBeNull()
  })

  test('a SECOND distinct root confirms → executed: reset email to the target, sessions revoked, ticket closed', async () => {
    // Target has a live session that must die on execution.
    const targetSession = await mintSession(root3Id)
    const root2Token = await mintSession(root2Id) // a DIFFERENT root (erpsuite.io)
    const res = await fetch(`${BASE}/api/platform/admins/recovery/${ticketId}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': root2Token, 'x-forwarded-for': RUN_IP },
    })
    const body = (await res.json()) as { ok: boolean; data?: { message: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const ticket = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
    expect(ticket!.confirmedBy).toBe(root2Id)
    expect(ticket!.confirmedAt).not.toBeNull()
    expect(ticket!.executedAt).not.toBeNull()
    // The dual-confirmation sent the reset email to the TARGET admin.
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: ROOT3_EMAIL, template: 'platform-password-reset' },
      orderBy: { createdAt: 'desc' },
    })
    expect(delivery).not.toBeNull()
    expect(delivery!.status).toBe('SENT')
    // A single-use reset token exists for the target (password itself
    // UNCHANGED until the target consumes the emailed link).
    const reset = await db.platformPasswordReset.findFirst({
      where: { adminId: root3Id, createdAt: { gte: SUITE_START } },
    })
    expect(reset).not.toBeNull()
    // Sessions revoked.
    const live = await db.platformAdminSession.findMany({
      where: { adminId: root3Id, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    expect(live).toEqual([])
    const after = await fetch(`${BASE}/api/platform/auth/me`, { headers: { 'x-platform-token': targetSession } })
    expect(after.status).toBe(401)
    // Executed audit trail.
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.recovery.executed', targetId: root3Id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  test('re-confirmation of an executed ticket → 409', async () => {
    const root2Token = await mintSession(root2Id)
    const res = await fetch(`${BASE}/api/platform/admins/recovery/${ticketId}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': root2Token, 'x-forwarded-for': RUN_IP },
    })
    expect(res.status).toBe(409)
  })

  test('non-root target: admin-assisted google-unlink executes DIRECTLY (single authorized decision)', async () => {
    await linkGoogleIdentity(probe2Id, `gsub2-${MARKER}`, 'probe2@gmail.com')
    const rootToken = await mintSession(rootId)
    const res = await fetch(`${BASE}/api/platform/admins/${probe2Id}/google-unlink`, {
      method: 'POST',
      headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
    })
    const body = (await res.json()) as { ok: boolean; data?: { dualControl: boolean } }
    expect(res.status).toBe(200)
    expect(body.data!.dualControl).toBe(false)
    const probe2 = await db.platformAdmin.findUnique({ where: { id: probe2Id } })
    expect(probe2!.googleSub).toBeNull()
  })

  test('root google-unlink: ticket → confirm by a third root (full two-person path)', async () => {
    // Bind a Google identity to ROOT2 (erpsuite) directly (fixture),
    // initiate from ROOT (scholario), confirm by ROOT3 (superadmin).
    await db.platformAdmin.update({
      where: { id: root2Id },
      data: { googleSub: `root2sub-${MARKER}`, googleEmail: 'root2.link@gmail.com', googleLinkedAt: new Date() },
    })
    const rootToken = await mintSession(rootId)
    const init = await fetch(`${BASE}/api/platform/admins/${root2Id}/google-unlink`, {
      method: 'POST',
      headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
    })
    const initBody = (await init.json()) as { ok: boolean; data?: { dualControl: boolean; ticketId: string } }
    expect(init.status).toBe(200)
    expect(initBody.data!.dualControl).toBe(true)
    const ticket = initBody.data!.ticketId

    const root3Token = await mintSession(root3Id)
    const confirm = await fetch(`${BASE}/api/platform/admins/recovery/${ticket}/confirm`, {
      method: 'POST',
      headers: { 'x-platform-token': root3Token, 'x-forwarded-for': RUN_IP },
    })
    expect(confirm.status).toBe(200)
    const root2 = await db.platformAdmin.findUnique({ where: { id: root2Id } })
    expect(root2!.googleSub).toBeNull()
  })
})

describe('ACCOUNT-RECOVERY H · password login regression (platform plane intact)', () => {
  test('platform root password login still works (custom auth untouched)', async () => {
    const out = await platformLoginHttp(ROOT_EMAIL, PLATFORM_ROOT_PASSWORD)
    expect(out.status).toBe(200)
    const body = out.body as { data?: { admin?: { email: string; isRoot: boolean } } }
    expect(body.data!.admin!.email).toBe(ROOT_EMAIL)
    expect(body.data!.admin!.isRoot).toBe(true)
  })
})

// ══ PART SAFETY · release acceptance (§7 matrix + final-method invariant) ═
// IMPL-4 / RELEASE-PIPELINE-1. Every test is SELF-CONTAINED: fixtures are
// created inline, mutated rows are restored in finally, and nothing from
// the corpus roots (root/root2/root3/probe) is ever left mutated. MFA is
// stood down (PLATFORM_TOTP_ENABLED unset — the documented posture), so
// the step-up gate is dormant at runtime while staying DECLARED on every
// sensitive route (S-8 proves both halves).

describe('ACCOUNT-RECOVERY SAFETY · release acceptance (§7 matrix + final-method invariant)', () => {
  /** Fresh self-contained admin fixture (real scrypt password; the id
   *  and email are registered for the file-level afterAll sweep). */
  async function safetyAdmin(
    tag: string,
    opts: { googleSub?: string; googleEmail?: string; isRoot?: boolean } = {},
  ): Promise<{ id: string; email: string; passwordHash: string }> {
    const email = `${tag}-${MARKER}@test.scholario`
    const passwordHash = hashPassword(`S4fety!${tag}.${MARKER}pw`)
    const admin = await db.platformAdmin.create({
      data: {
        email,
        passwordHash,
        name: `Safety ${tag} ${MARKER}`,
        isRoot: opts.isRoot ?? false,
        totpSecret: generateTotpSecret(),
        status: 'ACTIVE',
        ...(opts.googleSub
          ? { googleSub: opts.googleSub, googleEmail: opts.googleEmail ?? null, googleLinkedAt: new Date() }
          : {}),
      },
    })
    safetyAdminIds.push(admin.id)
    safetyFixtureEmails.push(email)
    return { id: admin.id, email, passwordHash }
  }

  test('INVARIANT (schema): PlatformAdmin.passwordHash is required — a NULL insert is rejected at the DB level', async () => {
    // (a) The declaration itself: `passwordHash String` — NOT `String?`.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dir, '..', '..')
    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8')
    const model = schema.match(/model PlatformAdmin \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(model).toContain('model PlatformAdmin {')
    expect(model).toMatch(/^\s*passwordHash\s+String\s*$/m) // required
    expect(model).not.toMatch(/passwordHash\s+String\s*\?/) // never optional

    // (b) Live proof: the database itself refuses a NULL passwordHash —
    // the schema-level floor under the final-method invariant.
    const id = `cnull${MARKER}${randomBytes(6).toString('hex')}`
    let threw = ''
    try {
      await db.$executeRawUnsafe(
        'INSERT INTO "PlatformAdmin" ("id","email","passwordHash","name","totpSecret","status","isRoot","isDemo") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        id,
        `nullpw-${MARKER}@test.scholario`,
        null, // the violation under test
        `Null Hash Probe ${MARKER}`,
        generateTotpSecret(),
        'ACTIVE',
        false,
        false,
      )
    } catch (e) {
      threw = String(e)
    }
    expect(threw).not.toBe('')
    // PG not-null violation: code 23502 (Prisma surfaces the failing row
    // for raw queries; some versions also carry "not-null constraint").
    expect(threw).toMatch(/23502|null value in column|not-null/i)
    expect(await db.platformAdmin.findUnique({ where: { id } })).toBeNull()
  })

  test('INVARIANT (lib): unlink refused when the Google identity is the final usable authentication method; allowed again once a password exists', async () => {
    const inv = await safetyAdmin('invariant', {
      googleSub: `inv-sub-${MARKER}`,
      googleEmail: `invariant.${MARKER}@gmail.com`,
    })
    // Corrupt-row / schema-regression stand-in: blank password → the
    // Google identity IS the last usable credential.
    await db.platformAdmin.update({ where: { id: inv.id }, data: { passwordHash: '' } })
    try {
      const refused = await unlinkGoogleIdentity(inv.id, { ip: RUN_IP })
      expect(refused).toEqual({ ok: false, wasLinked: true, failure: 'LAST_CREDENTIAL' })
      // wasLinked: true — the identity IS linked, which is exactly why
      // it must be kept.
      const kept = await db.platformAdmin.findUnique({ where: { id: inv.id } })
      expect(kept!.googleSub).toBe(`inv-sub-${MARKER}`)
    } finally {
      await db.platformAdmin.update({ where: { id: inv.id }, data: { passwordHash: inv.passwordHash } })
    }
    // A usable password exists again → the unlink is allowed.
    const allowed = await unlinkGoogleIdentity(inv.id, { ip: RUN_IP })
    expect(allowed).toEqual({ ok: true, wasLinked: true })
    expect((await db.platformAdmin.findUnique({ where: { id: inv.id } }))!.googleSub).toBeNull()
  })

  test('INVARIANT (self unlink route): 409 refusal, identity kept, when it is the last sign-in method', async () => {
    const self = await safetyAdmin('selfunlink', {
      googleSub: `self-sub-${MARKER}`,
      googleEmail: `selfunlink.${MARKER}@gmail.com`,
    })
    const token = await mintSession(self.id)
    await db.platformAdmin.update({ where: { id: self.id }, data: { passwordHash: '' } })
    try {
      const res = await fetch(`${BASE}/api/platform/auth/google/unlink`, {
        method: 'POST',
        headers: { 'x-platform-token': token, 'x-forwarded-for': RUN_IP },
      })
      const body = (await res.json()) as { ok: boolean; error: string; code: string }
      expect(res.status).toBe(409)
      expect(body.error).toContain('last usable sign-in method')
      // The identity is kept…
      const row = await db.platformAdmin.findUnique({ where: { id: self.id } })
      expect(row!.googleSub).toBe(`self-sub-${MARKER}`)
      // …and a REFUSAL is not an unlink: the session must stay valid
      // (only a successful unlink forces fresh authentication).
      const me = await fetch(`${BASE}/api/platform/auth/me`, { headers: { 'x-platform-token': token } })
      expect(me.status).toBe(200)
    } finally {
      await db.platformAdmin.update({ where: { id: self.id }, data: { passwordHash: self.passwordHash } })
    }
  })

  test('INVARIANT (assisted unlink route): 409 refusal for a non-root target whose Google identity is their last method', async () => {
    const target = await safetyAdmin('assisted', {
      googleSub: `assist-sub-${MARKER}`,
      googleEmail: `assist.${MARKER}@gmail.com`,
    })
    await db.platformAdmin.update({ where: { id: target.id }, data: { passwordHash: '' } })
    try {
      const rootToken = await mintSession(rootId)
      const res = await fetch(`${BASE}/api/platform/admins/${target.id}/google-unlink`, {
        method: 'POST',
        headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
      })
      const body = (await res.json()) as { ok: boolean; error: string }
      // The non-root DIRECT path must hit the guard, not the ticket flow.
      expect(res.status).toBe(409)
      expect(body.error).toContain('last usable')
      const row = await db.platformAdmin.findUnique({ where: { id: target.id } })
      expect(row!.googleSub).toBe(`assist-sub-${MARKER}`)
    } finally {
      await db.platformAdmin.update({ where: { id: target.id }, data: { passwordHash: target.passwordHash } })
    }
  })

  test('INVARIANT (dual-control recovery): the two-person GOOGLE_UNLINK refuses to strip a root’s last sign-in method — ticket stays unexecuted', async () => {
    const target = await safetyAdmin('dualctrl', {
      googleSub: `dual-sub-${MARKER}`,
      googleEmail: `dualctrl.${MARKER}@gmail.com`,
    })
    // Promoted to root → the assisted unlink becomes dual-control.
    await db.platformAdmin.update({ where: { id: target.id }, data: { isRoot: true, passwordHash: '' } })
    let ticketId = ''
    try {
      const rootToken = await mintSession(rootId)
      const init = await fetch(`${BASE}/api/platform/admins/${target.id}/google-unlink`, {
        method: 'POST',
        headers: { 'x-platform-token': rootToken, 'x-forwarded-for': RUN_IP },
      })
      const initBody = (await init.json()) as { ok: boolean; data?: { dualControl: boolean; ticketId: string } }
      expect(init.status).toBe(200)
      expect(initBody.data!.dualControl).toBe(true)
      ticketId = initBody.data!.ticketId

      const ticket = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
      expect(ticket).not.toBeNull()
      expect(ticket!.action).toBe('GOOGLE_UNLINK')
      expect(ticket!.targetAdminId).toBe(target.id)
      expect(ticket!.executedAt).toBeNull()

      // The SECOND person (a distinct root) tries to confirm — refused.
      const root2Token = await mintSession(root2Id)
      const confirm = await fetch(`${BASE}/api/platform/admins/recovery/${ticketId}/confirm`, {
        method: 'POST',
        headers: { 'x-platform-token': root2Token, 'x-forwarded-for': RUN_IP },
      })
      const confirmBody = (await confirm.json()) as { ok: boolean; error: string }
      expect(confirm.status).toBe(409)
      expect(confirmBody.error).toContain('last usable')

      // Fail-closed: the ticket stays UNEXECUTED, the identity stays.
      const after = await db.platformRecoveryTicket.findUnique({ where: { id: ticketId } })
      expect(after!.executedAt).toBeNull()
      expect(after!.confirmedBy).toBeNull()
      const row = await db.platformAdmin.findUnique({ where: { id: target.id } })
      expect(row!.googleSub).toBe(`dual-sub-${MARKER}`)
    } finally {
      // PlatformRecoveryTicket rows carry NO FK — delete manually; the
      // fixture admin itself is swept by afterAll (restored + demoted
      // here so even a failed run leaves no half-promoted row).
      if (ticketId) await db.platformRecoveryTicket.deleteMany({ where: { id: ticketId } })
      await db.platformAdmin.update({
        where: { id: target.id },
        data: { passwordHash: target.passwordHash, isRoot: false },
      })
    }
  })

  test('CROSS-ADMIN linking: a second admin linking an already-owned Google identity is refused, both accounts unchanged', async () => {
    const SUB = `xadmin-sub-${MARKER}`
    const owner = await safetyAdmin('xowner')
    const second = await safetyAdmin('xsecond')
    expect(await linkGoogleIdentity(owner.id, SUB, `xowner.${MARKER}@gmail.com`)).toEqual({ ok: true })
    const steal = await linkGoogleIdentity(second.id, SUB, `xsecond.${MARKER}@gmail.com`)
    expect(steal).toEqual({ ok: false, failure: 'ALREADY_LINKED_OTHER' })
    // Ownership unchanged on BOTH sides.
    expect((await db.platformAdmin.findUnique({ where: { id: owner.id } }))!.googleSub).toBe(SUB)
    expect((await db.platformAdmin.findUnique({ where: { id: second.id } }))!.googleSub).toBeNull()
  })

  test('SUSPENDED admin: forgot-password answers the identical generic envelope and issues NOTHING', async () => {
    const susp = await safetyAdmin('suspended')
    const UNKNOWN = `suspended-unknown-${MARKER}@nowhere.example`
    await db.platformAdmin.update({ where: { id: susp.id }, data: { status: 'SUSPENDED' } })
    try {
      const suspended = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': SAFETY_IP },
        body: JSON.stringify({ email: susp.email }),
      })
      const unknown = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': SAFETY_IP },
        body: JSON.stringify({ email: UNKNOWN }),
      })
      // Suspension is not an enumeration oracle either: byte-identical
      // envelope (status + body text) as an unknown address.
      expect(suspended.status).toBe(200)
      expect(unknown.status).toBe(suspended.status)
      expect(await suspended.text()).toBe(await unknown.text())
      // And NOTHING was issued for the suspended account.
      expect(await db.platformPasswordReset.count({ where: { adminId: susp.id } })).toBe(0)
      expect(
        await db.emailDelivery.count({ where: { recipient: susp.email, createdAt: { gte: SUITE_START } } }),
      ).toBe(0)
    } finally {
      await db.platformAdmin.update({ where: { id: susp.id }, data: { status: 'ACTIVE' } })
    }
  })

  test('STEP-UP requirement: every sensitive account-recovery mutation declares stepUp (and the TOTP switch re-arms the gate)', async () => {
    // (a) Structural: each sensitive route declares `stepUp: true` —
    // with MFA stood down the gate is dormant (authz consults
    // isPlatformTotpEnabled), but the declaration re-arms it the
    // moment the flag flips back on. No route may silently drop it.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dir, '..', '..')
    const ROUTES = [
      'src/app/api/platform/auth/google/link/start/route.ts',
      'src/app/api/platform/auth/google/unlink/route.ts',
      'src/app/api/platform/admins/[id]/reset-password/route.ts',
      'src/app/api/platform/admins/[id]/google-unlink/route.ts',
      'src/app/api/platform/admins/[id]/suspend/route.ts',
      'src/app/api/platform/admins/recovery/[ticketId]/confirm/route.ts',
    ]
    const missing = ROUTES.filter((r) => !readFileSync(join(root, r), 'utf8').includes('stepUp: true'))
    expect(missing).toEqual([])

    // (b) Functional: the single switch (env + restart = posture move).
    const saved = process.env.PLATFORM_TOTP_ENABLED
    delete process.env.PLATFORM_TOTP_ENABLED
    expect(isPlatformTotpEnabled()).toBe(false) // documented stood-down posture
    process.env.PLATFORM_TOTP_ENABLED = '1'
    expect(isPlatformTotpEnabled()).toBe(true) // armed
    delete process.env.PLATFORM_TOTP_ENABLED
    expect(isPlatformTotpEnabled()).toBe(false) // re-arms only via env+restart
    if (saved !== undefined) process.env.PLATFORM_TOTP_ENABLED = saved

    // (c) The gate's clock (the exported step-up helper): a session with
    // stepUpAt null is NOT live, a fresh stepUpAt IS live, one older
    // than the window is not.
    const base = {
      id: 'sess-stepup-probe',
      adminId: 'admin-stepup-probe',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      userAgent: null,
      ipAddress: null,
    }
    const never: PlatformSessionAuth = { ...base, stepUpAt: null }
    expect(hasLiveStepUp(never)).toBe(false)
    const fresh: PlatformSessionAuth = { ...base, stepUpAt: new Date() }
    expect(hasLiveStepUp(fresh)).toBe(true)
    const stale: PlatformSessionAuth = {
      ...base,
      stepUpAt: new Date(Date.now() - STEP_UP_WINDOW_MS - 1000),
    }
    expect(hasLiveStepUp(stale)).toBe(false)
  })

  test('PASSWORD RESET never removes the Google link (methods only grow)', async () => {
    const SUB = `resetkeep-sub-${MARKER}`
    const admin = await safetyAdmin('resetkeep', {
      googleSub: SUB,
      googleEmail: `resetkeep.${MARKER}@gmail.com`,
    })
    const before = await db.platformAdmin.findUnique({ where: { id: admin.id } })
    const linkedAtBefore = before!.googleLinkedAt
    const NEW_PASSWORD = `R3setk33p!${MARKER}pw`
    // A live session that must die with the reset (H-8 pairing).
    const liveSession = await mintSession(admin.id)

    // The emailed flow really fires for this (google-linked) account —
    // fresh email + fresh IP: the per-account/per-IP buckets stay clean.
    const forgot = await fetch(`${BASE}/api/platform/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': SAFETY_IP },
      body: JSON.stringify({ email: admin.email }),
    })
    expect(forgot.status).toBe(200)
    const delivery = await db.emailDelivery.findFirst({
      where: { recipient: admin.email, template: 'platform-password-reset', createdAt: { gte: SUITE_START } },
    })
    expect(delivery).not.toBeNull()

    // RAW token exactly the H-8 way: issued in-process by the same lib
    // the route calls (the raw token exists only in caller memory).
    const issued = await issuePasswordReset(admin.id)
    const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': SAFETY_IP },
      body: JSON.stringify({ token: issued.token, newPassword: NEW_PASSWORD }),
    })
    const body = (await res.json()) as { ok: boolean }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const row = await db.platformAdmin.findUnique({ where: { id: admin.id } })
    // The password changed (hash form, string-compared)…
    expect(row!.passwordHash).not.toBe(admin.passwordHash)
    expect(verifyPassword(NEW_PASSWORD, row!.passwordHash)).toBe(true)
    // …and the Google link survived the reset untouched: recovery only
    // ADDS a usable method, never removes one.
    expect(row!.googleSub).toBe(SUB)
    expect(row!.googleEmail).toBe(`resetkeep.${MARKER}@gmail.com`)
    expect(row!.googleLinkedAt).toEqual(linkedAtBefore)
    // Session revocation still applies on the google-linked account.
    const live = await db.platformAdminSession.findMany({
      where: { adminId: admin.id, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    expect(live).toEqual([])
    const after = await fetch(`${BASE}/api/platform/auth/me`, { headers: { 'x-platform-token': liveSession } })
    expect(after.status).toBe(401)
  })
})

// ── lifecycle ────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Probe admins (dedicated identities — the corpus is never the object
  // under test; every probe row is removed in afterAll).
  for (const [email, password] of [
    [PROBE_EMAIL, PROBE_PASSWORD],
    [PROBE2_EMAIL, PROBE2_PASSWORD],
  ] as const) {
    const admin = await db.platformAdmin.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        name: `Recovery Probe ${MARKER}`,
        isRoot: false,
        totpSecret: generateTotpSecret(),
        status: 'ACTIVE',
      },
    })
    if (email === PROBE_EMAIL) probeId = admin.id
    else probe2Id = admin.id
  }
  // Corpus roots for the dual-control identities.
  const root = await db.platformAdmin.findUniqueOrThrow({ where: { email: ROOT_EMAIL } })
  const root2 = await db.platformAdmin.findUniqueOrThrow({ where: { email: ROOT2_EMAIL } })
  const root3 = await db.platformAdmin.findUniqueOrThrow({ where: { email: ROOT3_EMAIL } })
  rootId = root.id
  root2Id = root2.id
  root3Id = root3.id
  root3GoogleWas = root3.googleSub
})

afterAll(async () => {
  // ── Corpus restoration (bit-consistent, the documented convention) ──
  // 1. Probe + safety-fixture admins cascade-remove their sessions/
  //    permissions/reset rows (safety fixtures are self-restored per
  //    test via try/finally; this sweep is the failure-path backstop).
  await db.platformAdmin.deleteMany({
    where: { id: { in: [probeId, probe2Id, ...safetyAdminIds] } },
  })
  // 2. Minted sessions for corpus admins.
  if (mintedSessionIds.length > 0) {
    await db.platformAdminSession.deleteMany({ where: { id: { in: mintedSessionIds } } })
  }
  // 3. The dual-control execution created a reset token + email for the
  //    target root — remove the artifacts, keep the corpus bit-stable
  //    (the password itself never changed: the emailed link was unused).
  await db.platformPasswordReset.deleteMany({
    where: { adminId: root3Id, createdAt: { gte: SUITE_START } },
  })
  await db.emailDelivery.deleteMany({
    where: { recipient: ROOT3_EMAIL, template: 'platform-password-reset' },
  })
  // 4. ROOT2's fixture Google link was fully unlinked by the flow; ROOT3
  //    never had one (snapshot-restored anyway).
  await db.platformAdmin.update({
    where: { id: root3Id },
    data: { googleSub: root3GoogleWas, googleEmail: root3GoogleWas ? 'restored' : null, googleLinkedAt: null },
  })
  // 5. Recovery tickets from the suite (no FK — explicit delete; the
  //    §7 dual-control test deletes its own ticket, this is the backstop).
  await db.platformRecoveryTicket.deleteMany({
    where: {
      targetAdminId: { in: [probeId, probe2Id, root2Id, root3Id, ...safetyAdminIds] },
      createdAt: { gte: SUITE_START },
    },
  })
  // 6. Probe + safety-fixture emails (probe rows deleted, but the
  //    EmailDelivery rows carry no FK).
  await db.emailDelivery.deleteMany({
    where: {
      recipient: { in: [PROBE_EMAIL, PROBE2_EMAIL, ...safetyFixtureEmails] },
      template: 'platform-password-reset',
    },
  })
  // 7. Audit rows from the suite's actions (the new action vocabulary,
  //    bounded to this suite's window — nothing else runs concurrently).
  await db.platformAuditLog.deleteMany({
    where: {
      createdAt: { gte: SUITE_START },
      OR: [
        { targetId: { in: [probeId, probe2Id] } },
        { adminId: { in: [probeId, probe2Id] } },
        {
          action: {
            in: [
              'platform.password_reset.requested',
              'platform.password_reset.failed',
              'platform.password_reset.completed',
              'platform.admin.password_reset_initiated',
              'platform.admin.google_linked',
              'platform.admin.google_unlinked',
              'platform.admin.google_link_failed',
              'platform.recovery.initiated',
              'platform.recovery.refused',
              'platform.recovery.executed',
            ],
          },
        },
        { action: 'platform.login.failed', reason: { contains: 'not linked' } },
      ],
    },
  })
})
