import { db } from '../helpers/db'
/**
 * PLATFORM PASSWORD-RESET ATOMICITY SUITE — the security invariant:
 *
 *   A successful platform password reset is ONE atomic database unit
 *   encompassing (1) the password update, (2) the revocation of EVERY
 *   live PlatformAdminSession and (3) the invalidation of EVERY
 *   outstanding PlatformPasswordReset token. The three writes either
 *   all commit or all roll back — a failure must never leave the
 *   password changed while old sessions or reusable reset tokens
 *   remain valid.
 *
 * COVERAGE MAP:
 *
 *   A. Successful reset — password changed, every live session revoked,
 *      every outstanding token burned, bystander admin untouched,
 *      completion audit carries the committed revocation count.
 *   B. Transaction rollback — a fixture-scoped PostgreSQL trigger
 *      injects a real write failure into session revocation (B1) and
 *      into token invalidation (B2): the WHOLE apply rolls back
 *      (password unchanged, revocation rolled back, generic 401, no
 *      completion audit, no notification), the presented token stays
 *      consumed (fail-closed contract, unchanged) while the OTHER
 *      outstanding token survives the rollback and stays usable.
 *   C. Replay — a consumed token can never be reused, and five
 *      CONCURRENT presentations of one token yield EXACTLY one
 *      successful reset (the DB-level usedAt-guarded claim).
 *   D. Isolation — one admin's reset never revokes another admin's
 *      session, never burns another admin's pending token, never
 *      touches another admin's password.
 *   E. Existing behavior — invalid / malformed / expired / consumed /
 *      weak-password requests keep their exact envelopes (generic 401
 *      no-oracle parity, 422 policy).
 *
 * STYLE: the repo convention — direct-DB fixtures + live HTTP against
 * the dev server (PART H pattern of platform-account-recovery.test.ts).
 *
 * ISOLATION & HYGIENE:
 *   · Every test provisions its OWN admins (fresh MARKER emails) —
 *     zero inter-test order dependence, no corpus identity is touched.
 *   · Every request carries a FRESH x-forwarded-for — the platform
 *     reset per-IP bucket is 10/hour and must never couple tests.
 *   · Fault injection is a REAL database trigger scoped to the fixture
 *     row (adminId / tokenHash guard), installed and ALWAYS dropped in
 *     finally + afterAll — idempotent re-runs cannot inherit one.
 *   · afterAll sweeps fixture admins (cascades sessions + reset rows),
 *     fixture emails and the suite-window audit rows.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { hashToken } from '@/lib/platform/auth'
import { consumePasswordReset } from '@/lib/platform/password-reset'
import { generateTotpSecret } from '@/lib/platform/totp'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(5).toString('hex')
const SUITE_START = new Date()

const createdAdminIds: string[] = []
const fixtureEmails: string[] = []

const TRIGGER_TABLES = ['PlatformAdminSession', 'PlatformPasswordReset'] as const
type TriggerTable = (typeof TRIGGER_TABLES)[number]

// ── fixtures ─────────────────────────────────────────────────────────────

interface FixtureAdmin {
  id: string
  email: string
  password: string
}

/** Fresh per-request source IP — the reset per-IP bucket is 10/hour. */
function freshIp(): string {
  return `10.${200 + Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 253)}`
}

function strongPassword(prefix: string): string {
  // newPasswordSchema: 8–128 chars, ≥1 letter, ≥1 digit (specials extra).
  return `${prefix}!${randomBytes(9).toString('hex')}Aa1`
}

async function createAdmin(label: string): Promise<FixtureAdmin> {
  const email = `reset-atomicity-${label}-${MARKER}@test.scholario`
  const password = strongPassword(`F1x${label}`)
  const admin = await db.platformAdmin.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      name: `Reset Atomicity ${label} ${MARKER}`,
      isRoot: false,
      totpSecret: generateTotpSecret(),
      status: 'ACTIVE',
    },
  })
  createdAdminIds.push(admin.id)
  fixtureEmails.push(email)
  return { id: admin.id, email, password }
}

/** Mint a live PlatformAdminSession; returns the raw bearer token. */
async function mintSession(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: 'reset-atomicity-test',
    },
  })
  return token
}

/**
 * Plant an OUTSTANDING reset token row directly (bypasses the
 * single-outstanding supersede of issuePasswordReset on purpose — the
 * burn of "every OTHER outstanding token" must be exercised against
 * genuinely multiple pending rows).
 */
async function createPendingToken(adminId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.platformPasswordReset.create({
    data: {
      adminId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  return raw
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

async function resetHttp(
  token: string,
  newPassword: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/platform/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
    body: JSON.stringify({ token, newPassword }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, body }
}

/** Envelope parity probe: status + body minus the per-request requestId. */
function envelopeShape(r: { status: number; body: Record<string, unknown> }): string {
  const { requestId, ...rest } = r.body
  expect(requestId).toBeTruthy()
  return JSON.stringify({ status: r.status, ...rest })
}

async function meStatus(bearerToken: string): Promise<number> {
  const res = await fetch(`${BASE}/api/platform/auth/me`, {
    headers: { 'x-platform-token': bearerToken },
  })
  return res.status
}

// ── fault injection (real DB triggers, fixture-scoped, always dropped) ────

function assertSafeSqlFragment(value: string): void {
  if (!/^[A-Za-z0-9]+$/.test(value)) {
    throw new Error(`unsafe fault-injection guard value: ${value.slice(0, 8)}…`)
  }
}

async function installBlockTrigger(table: TriggerTable, guard: string): Promise<void> {
  const fn = `atm_block_${table}`
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION "${fn}"() RETURNS trigger AS $atm$ ` +
      `BEGIN IF ${guard} THEN RAISE EXCEPTION ` +
      `'platform-reset-atomicity: simulated write failure on %', TG_TABLE_NAME; ` +
      `END IF; RETURN NEW; END; $atm$ LANGUAGE plpgsql`,
  )
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "${table}"`)
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "${fn}" BEFORE UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
  )
}

async function dropBlockTrigger(table: TriggerTable): Promise<void> {
  const fn = `atm_block_${table}`
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "${table}"`)
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`)
}

// ── PART A · the success path is one atomic unit ──────────────────────────

describe('PLATFORM-RESET-ATOMICITY A · successful reset commits the full security unit', () => {
  test('password changes; EVERY live session revoked; EVERY outstanding token burned; bystander untouched', async () => {
    const victim = await createAdmin('A-victim')
    const bystander = await createAdmin('A-bystander')

    const victimSession1 = await mintSession(victim.id)
    const victimSession2 = await mintSession(victim.id)
    const bystanderSession = await mintSession(bystander.id)

    const presented = await createPendingToken(victim.id)
    const otherOutstanding = await createPendingToken(victim.id)
    const bystanderToken = await createPendingToken(bystander.id)

    const newPassword = strongPassword('N3wA')
    const res = await resetHttp(presented, newPassword)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(((res.body.data as { message?: string })?.message ?? '')).toContain('signed out')

    // 1. Password actually changed (old gone, new live).
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    expect(verifyPassword(victim.password, admin.passwordHash)).toBe(false)
    expect(verifyPassword(newPassword, admin.passwordHash)).toBe(true)

    // 2. EVERY live session of the victim revoked — both pre-minted ones,
    //    and the revoked bearer tokens no longer authenticate.
    expect(
      await db.platformAdminSession.count({ where: { adminId: victim.id, revokedAt: null } }),
    ).toBe(0)
    expect(await meStatus(victimSession1)).toBe(401)
    expect(await meStatus(victimSession2)).toBe(401)

    // 3. EVERY outstanding reset token burned — the presented one AND the
    //    other outstanding one; neither can ever be consumed again.
    const rows = await db.platformPasswordReset.findMany({ where: { adminId: victim.id } })
    expect(rows.length).toBe(2)
    for (const row of rows) expect(row.usedAt).not.toBeNull()
    const otherConsume = await consumePasswordReset(otherOutstanding)
    expect(otherConsume).toMatchObject({ ok: false, failure: 'USED' })

    // 4. The bystander admin is COMPLETELY untouched.
    expect(await meStatus(bystanderSession)).toBe(200)
    const bystanderSessionRow = await db.platformAdminSession.findFirstOrThrow({
      where: { adminId: bystander.id },
    })
    expect(bystanderSessionRow.revokedAt).toBeNull()
    expect((await consumePasswordReset(bystanderToken)).ok).toBe(true)
    const bystanderAdmin = await db.platformAdmin.findUniqueOrThrow({
      where: { id: bystander.id },
    })
    expect(verifyPassword(bystander.password, bystanderAdmin.passwordHash)).toBe(true)

    // 5. Completion audit carries the COMMITTED revocation count.
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.password_reset.completed', targetId: victim.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ revokedSessions: 2 })
  })
})

// ── PART B · rollback: a cleanup failure rolls back the WHOLE apply ───────

describe('PLATFORM-RESET-ATOMICITY B · apply rollback under real write failures', () => {
  test('B1: session-revocation failure → password ROLLED BACK, sessions live, generic 401, fail-closed token', async () => {
    const victim = await createAdmin('B1-victim')
    const liveSession = await mintSession(victim.id)
    const presented = await createPendingToken(victim.id)
    const otherOutstanding = await createPendingToken(victim.id)
    const originalHash = (
      await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    ).passwordHash

    // Block ONLY the revokedAt transition of THIS victim's sessions.
    assertSafeSqlFragment(victim.id)
    await installBlockTrigger(
      'PlatformAdminSession',
      `NEW."adminId" = '${victim.id}' AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL`,
    )
    try {
      const res = await resetHttp(presented, strongPassword('B1new'))
      // Same generic refusal as every other apply failure — no oracle,
      // no 500, response contract intact.
      expect(res.status).toBe(401)
      expect(res.body.ok).toBe(false)
      expect(res.body.error as string).toContain('invalid or has expired')

      // The password update ROLLED BACK — the old hash is still
      // authoritative and still verifies.
      const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
      expect(admin.passwordHash).toBe(originalHash)
      expect(verifyPassword(victim.password, admin.passwordHash)).toBe(true)

      // The failure audit still fires (audit behavior preserved) and no
      // completion event exists for a rolled-back apply.
      const audit = await db.platformAuditLog.findFirst({
        where: { action: 'platform.password_reset.failed', targetId: victim.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect(
        await db.platformAuditLog.count({
          where: { action: 'platform.password_reset.completed', targetId: victim.id },
        }),
      ).toBe(0)
    } finally {
      await dropBlockTrigger('PlatformAdminSession')
    }

    // Post-rollback reality (trigger gone): the minted session is STILL
    // live — the revocation never committed.
    expect(await meStatus(liveSession)).toBe(200)
    expect(
      await db.platformAdminSession.count({ where: { adminId: victim.id, revokedAt: null } }),
    ).toBe(1)

    // The presented token stayed consumed (fail-closed contract —
    // unchanged), while the OTHER outstanding token survived the
    // rollback and is genuinely still usable (the reset never happened).
    const presentedRow = await db.platformPasswordReset.findUniqueOrThrow({
      where: { tokenHash: hashToken(presented) },
    })
    expect(presentedRow.usedAt).not.toBeNull()
    const otherRow = await db.platformPasswordReset.findUniqueOrThrow({
      where: { tokenHash: hashToken(otherOutstanding) },
    })
    expect(otherRow.usedAt).toBeNull()
    expect((await consumePasswordReset(otherOutstanding)).ok).toBe(true)
  })

  test('B2: token-invalidation failure → password AND session revocation ROLLED BACK', async () => {
    const victim = await createAdmin('B2-victim')
    const liveSession = await mintSession(victim.id)
    const presented = await createPendingToken(victim.id)
    const otherOutstanding = await createPendingToken(victim.id)
    const originalHash = (
      await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    ).passwordHash

    // Block ONLY the burn of the never-presented outstanding token. The
    // presented token was consumed BEFORE the transaction on a different
    // row (different tokenHash), so the claim itself is unaffected —
    // exactly the production ordering.
    const otherHash = hashToken(otherOutstanding)
    assertSafeSqlFragment(otherHash)
    await installBlockTrigger(
      'PlatformPasswordReset',
      `NEW."tokenHash" = '${otherHash}' AND OLD."usedAt" IS NULL AND NEW."usedAt" IS NOT NULL`,
    )
    try {
      const res = await resetHttp(presented, strongPassword('B2new'))
      expect(res.status).toBe(401)
      expect(res.body.ok).toBe(false)
      expect(res.body.error as string).toContain('invalid or has expired')

      // The password update ROLLED BACK.
      const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
      expect(admin.passwordHash).toBe(originalHash)
      expect(verifyPassword(victim.password, admin.passwordHash)).toBe(true)
    } finally {
      await dropBlockTrigger('PlatformPasswordReset')
    }

    // THE decisive assertion: the session revocation happened INSIDE the
    // same transaction — it rolled back WITH the password. (Before the
    // fix, revocation ran post-commit and the session would be dead.)
    expect(await meStatus(liveSession)).toBe(200)
    expect(
      await db.platformAdminSession.count({ where: { adminId: victim.id, revokedAt: null } }),
    ).toBe(1)

    // Presented token consumed (fail-closed); the blocked outstanding
    // token survived the rollback (still pending, still usable).
    const presentedRow = await db.platformPasswordReset.findUniqueOrThrow({
      where: { tokenHash: hashToken(presented) },
    })
    expect(presentedRow.usedAt).not.toBeNull()
    expect(
      (
        await db.platformPasswordReset.findUniqueOrThrow({
          where: { tokenHash: otherHash },
        })
      ).usedAt,
    ).toBeNull()
    expect((await consumePasswordReset(otherOutstanding)).ok).toBe(true)
  })
})

// ── PART C · replay + concurrency ─────────────────────────────────────────

describe('PLATFORM-RESET-ATOMICITY C · token replay cannot double-reset', () => {
  test('a consumed token cannot be reused; five CONCURRENT presentations yield EXACTLY one reset', async () => {
    const victim = await createAdmin('C-victim')
    const liveSession = await mintSession(victim.id)
    const token = await createPendingToken(victim.id)

    // Five simultaneous full-flow resets with the SAME raw token, each
    // from its own fresh source IP, each claiming a DISTINCT password.
    const passwords = Array.from({ length: 5 }, (_, i) => strongPassword(`R4c${i}`))
    const attempts = await Promise.all(passwords.map((pw) => resetHttp(token, pw)))

    const winnerIndex = attempts.findIndex((a) => a.status === 200)
    expect(winnerIndex).toBeGreaterThanOrEqual(0)
    const losers = attempts.filter((a, i) => i !== winnerIndex)
    for (const loser of losers) {
      expect(loser.status).toBe(401)
      expect(loser.body.ok).toBe(false)
      expect(loser.body.error as string).toContain('invalid or has expired')
    }

    // EXACTLY the winner's password is authoritative — the four losers
    // changed nothing.
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    for (let i = 0; i < passwords.length; i++) {
      expect(verifyPassword(passwords[i], admin.passwordHash)).toBe(i === winnerIndex)
    }

    // The token row is consumed; a sequential re-presentation is refused
    // with the same generic envelope.
    const row = await db.platformPasswordReset.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    })
    expect(row.usedAt).not.toBeNull()
    const replay = await resetHttp(token, strongPassword('R3play'))
    expect(replay.status).toBe(401)
    expect(replay.body.error as string).toContain('invalid or has expired')

    // The ONE successful reset revoked the live session — exactly once.
    expect(await meStatus(liveSession)).toBe(401)

    // Exactly ONE completion audit for the victim.
    expect(
      await db.platformAuditLog.count({
        where: { action: 'platform.password_reset.completed', targetId: victim.id },
      }),
    ).toBe(1)
  })
})

// ── PART D · cross-admin isolation ────────────────────────────────────────

describe('PLATFORM-RESET-ATOMICITY D · one admin’s reset never touches another admin', () => {
  test('bystander session stays live, pending token stays pending and consumable, password untouched', async () => {
    const victim = await createAdmin('D-victim')
    const bystander = await createAdmin('D-bystander')

    const victimSession = await mintSession(victim.id)
    const bystanderSession = await mintSession(bystander.id)
    const victimToken = await createPendingToken(victim.id)
    const bystanderToken = await createPendingToken(bystander.id)

    const newPassword = strongPassword('N3wD')
    const res = await resetHttp(victimToken, newPassword)
    expect(res.status).toBe(200)

    // The victim is fully rotated.
    expect(await meStatus(victimSession)).toBe(401)
    const victimAdmin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    expect(verifyPassword(newPassword, victimAdmin.passwordHash)).toBe(true)

    // The bystander is COMPLETELY untouched: the session still
    // authenticates, the pending token is still pending AND genuinely
    // consumable, the password is unchanged, no audit was written.
    expect(await meStatus(bystanderSession)).toBe(200)
    const bystanderSessionRow = await db.platformAdminSession.findFirstOrThrow({
      where: { adminId: bystander.id },
    })
    expect(bystanderSessionRow.revokedAt).toBeNull()
    const bystanderTokenRow = await db.platformPasswordReset.findUniqueOrThrow({
      where: { tokenHash: hashToken(bystanderToken) },
    })
    expect(bystanderTokenRow.usedAt).toBeNull()
    expect((await consumePasswordReset(bystanderToken)).ok).toBe(true)
    const bystanderAdmin = await db.platformAdmin.findUniqueOrThrow({
      where: { id: bystander.id },
    })
    expect(verifyPassword(bystander.password, bystanderAdmin.passwordHash)).toBe(true)
    expect(
      await db.platformAuditLog.count({
        where: { action: 'platform.password_reset.completed', targetId: bystander.id },
      }),
    ).toBe(0)
  })
})

// ── PART E · existing failure contracts (no regression) ───────────────────

describe('PLATFORM-RESET-ATOMICITY E · failure envelopes unchanged', () => {
  test('invalid / malformed / expired share ONE generic 401; weak password stays 422', async () => {
    const victim = await createAdmin('E-victim')

    const invalid = await resetHttp(randomBytes(32).toString('hex'), strongPassword('Inv1'))
    const malformed = await resetHttp('zzz-not-a-token', strongPassword('Inv2'))
    expect(invalid.status).toBe(401)
    expect(malformed.status).toBe(401)
    // Anti-enumeration contract: identical status + envelope (requestId
    // excluded — per-response correlation).
    expect(envelopeShape(invalid)).toBe(envelopeShape(malformed))
    expect(invalid.body.error as string).toContain('invalid or has expired')

    const issued = await createPendingToken(victim.id)
    await db.platformPasswordReset.update({
      where: { tokenHash: hashToken(issued) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const expired = await resetHttp(issued, strongPassword('Inv3'))
    expect(expired.status).toBe(401)
    expect(envelopeShape(expired)).toBe(envelopeShape(invalid))

    // Password policy holds on a fresh token (unchanged classification).
    const fresh = await createPendingToken(victim.id)
    const weak = await resetHttp(fresh, 'short')
    expect(weak.status).toBe(422)
  })

  test('consumed token → the SAME generic refusal, and the second password never takes effect', async () => {
    const victim = await createAdmin('E2-victim')
    const token = await createPendingToken(victim.id)

    const firstPassword = strongPassword('F1rs')
    const first = await resetHttp(token, firstPassword)
    expect(first.status).toBe(200)

    const secondPassword = strongPassword('S3cd')
    const second = await resetHttp(token, secondPassword)
    expect(second.status).toBe(401)
    expect(second.body.ok).toBe(false)
    expect(second.body.error as string).toContain('invalid or has expired')

    // The replayed presentation changed NOTHING.
    const admin = await db.platformAdmin.findUniqueOrThrow({ where: { id: victim.id } })
    expect(verifyPassword(firstPassword, admin.passwordHash)).toBe(true)
    expect(verifyPassword(secondPassword, admin.passwordHash)).toBe(false)
  })
})

// ── lifecycle ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Idempotent re-run backstop: a crashed earlier run must never leave a
  // fault-injection trigger behind for this suite (or any other).
  for (const table of TRIGGER_TABLES) await dropBlockTrigger(table)
})

afterAll(async () => {
  // 1. Fault-injection triggers/functions — ALWAYS removed.
  for (const table of TRIGGER_TABLES) await dropBlockTrigger(table)
  // 2. Fixture admins cascade-remove their sessions + reset rows.
  if (createdAdminIds.length > 0) {
    await db.platformAdmin.deleteMany({ where: { id: { in: createdAdminIds } } })
  }
  // 3. Fixture email deliveries (no FK on EmailDelivery).
  if (fixtureEmails.length > 0) {
    await db.emailDelivery.deleteMany({
      where: {
        recipient: { in: fixtureEmails },
        template: { in: ['platform-password-changed', 'platform-password-reset'] },
      },
    })
  }
  // 4. Suite-window audit rows (fixture-linked + the anonymous
  //    failure audits of the no-oracle probes; nothing else runs
  //    concurrently in the single-process bun suite).
  await db.platformAuditLog.deleteMany({
    where: {
      createdAt: { gte: SUITE_START },
      OR: [
        { adminId: { in: createdAdminIds } },
        { targetId: { in: createdAdminIds } },
        {
          action: {
            in: ['platform.password_reset.failed', 'platform.password_reset.completed'],
          },
        },
      ],
    },
  })
})
