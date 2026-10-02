import { db } from '../helpers/db'
/**
 * PIH-5 — INVARIANT: session lifecycle hygiene.
 *
 * THE INVARIANTS UNDER TEST:
 *   1. EXPIRED SESSIONS never authenticate: a well-formed Session row with
 *      a past expiresAt is refused 401 by /api/auth/me AND is pruned from
 *      the Session table by the same read (fail-closed, self-cleaning).
 *   2. LOGOUT INVALIDATION: after POST /api/auth/logout the token is dead
 *      (401) — the DB row was destroyed, not just the cookie. (The
 *      login→logout→401 round-trip with a real login already lives in
 *      tests/api/domain-smoke.test.ts; this is the slim direct-session
 *      version so the suite never touches the login rate limiter.)
 *   3. PASSWORD-CHANGE ROTATION: after a successful change-password the
 *      caller's token is ROTATED and every other session for the account
 *      is revoked — both pre-change tokens 401 — while the NEW password
 *      logs in and the OLD one no longer does.
 *   4. NO-STORE: the three PIH-4c-sensitive surfaces (/api/auth/me,
 *      /api/students, /api/export) serve per-request data that no
 *      intermediary may cache.
 *
 * Conventions match tests/security/tenant-isolation.test.ts and
 * tests/security/phase75-product.test.ts: dev server (TENANT_TEST_BASE,
 * default :3000), sessions minted as DIRECT ROWS (bypasses ONLY the login
 * limiter — never an authorization gate), cookie transport via a manual
 * cookie jar. The ONE deliberate real login (new-password proof) is a
 * throwaway account created and deleted by this suite.
 *
 * The throwaway user's password hash is minted locally in the exact
 * src/lib/auth.ts hashPassword format (scrypt, `${salt}:${hash}` hex,
 * 16-byte salt, 64-byte key) so no fixture credential is ever mutated.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes, scryptSync } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { DEMO_STUDENT_EMAIL } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000 // generous: first-hit dev compilation (tenant-isolation precedent)

const MARKER = randomBytes(4).toString('hex')
const OLD_PW = 'Pih5OldPass1'
const NEW_PW = 'Pih5NewPass2'
// IP-bucket isolation per run (domain-smoke / observability-contracts
// convention): the login limiter keys the per-IP bucket on
// X-Forwarded-For — a unique RUN_IP per run keeps this suite's 2 real
// login POSTs out of the shared 'unknown' bucket (and immune to whatever
// ran in the previous 15-minute window).
const RUN_IP = `10.247.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

let schoolId = ''
let student1 = { id: '', email: DEMO_STUDENT_EMAIL }
let principal = { id: '', email: 'principal@hawkingshigh.edu' }
let principalToken = ''
const suiteStart = new Date()

const cleanup: Array<() => Promise<unknown>> = []

/** Mirrors hashPassword() in src/lib/auth.ts: `${salt}:${scrypt}` hex. */
function hashPasswordLocal(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing (run the canonical seeds)')
  schoolId = school.id

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`fixture user missing: ${email}`)
    return u
  }
  const [s1, p1] = await Promise.all([byEmail(student1.email), byEmail(principal.email)])
  student1 = { ...student1, id: s1.id }
  principal = { ...principal, id: p1.id }

  principalToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId: p1.id,
      // PHASE 8A — rows store sha256(token); the RAW token rides the
      // cookie jar below (createSession wire contract).
      tokenHash: hashSessionToken(principalToken),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))
  // The no-store probe's export writes one STUDENT_DATA_EXPORT audit row.
  cleanup.push(() =>
    db.activityLog.deleteMany({
      where: {
        action: 'STUDENT_DATA_EXPORT',
        userId: p1.id,
        createdAt: { gte: suiteStart },
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

// ── helpers ────────────────────────────────────────────────────────────────

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

/** Direct-mint a session row for an existing user (fresh 1h expiry).
 *  PHASE 8A — stores the hash, returns the RAW token (wire contract). */
async function mintSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
  return token
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Expired session
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · expired sessions are refused and pruned', () => {
  test('well-formed token with past expiresAt → /api/auth/me 401; the Session row is gone', async () => {
    const token = randomBytes(32).toString('hex') // exact createSession format
    await db.session.create({
      data: {
        userId: student1.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() - 60_000),
      },
    })
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))

    const res = await as(token, '/api/auth/me')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')

    // The same read PRUNED the expired row (fail-closed + self-cleaning).
    const row = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { id: true },
    })
    expect(row).toBeNull()
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Logout invalidation (slim — see domain-smoke for the login-based trip)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · logout destroys the session row', () => {
  test('minted session → logout 200 → me 401 and the row is deleted', async () => {
    const token = await mintSession(student1.id)

    const me = await as(token, '/api/auth/me')
    expect(me.status).toBe(200) // the session is genuinely valid first

    const logout = await as(token, '/api/auth/logout', { method: 'POST' })
    expect(logout.status).toBe(200)

    const meAfter = await as(token, '/api/auth/me')
    expect(meAfter.status).toBe(401)

    const row = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { id: true },
    })
    expect(row).toBeNull()
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Password change → rotation + revoke-others
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · change-password rotates the token and revokes every other session', () => {
  test('two live sessions → change password → both old tokens 401; new password logs in, old one does not', async () => {
    // Throwaway TEACHER account (created + deleted by this suite; its hash
    // is minted in the exact src/lib/auth.ts format).
    const email = `pih5.auth.${MARKER}@hawkings.test`
    const throwaway = await db.user.create({
      data: {
        schoolId,
        email,
        name: `PIH5 Auth Probe ${MARKER}`,
        role: 'TEACHER',
        status: 'ACTIVE',
        passwordHash: hashPasswordLocal(OLD_PW),
      },
    })
    cleanup.push(() => db.activityLog.deleteMany({ where: { userId: throwaway.id } }))
    cleanup.push(() => db.user.delete({ where: { id: throwaway.id } })) // sessions cascade

    const tokenA = await mintSession(throwaway.id)
    const tokenB = await mintSession(throwaway.id)
    expect((await as(tokenA, '/api/auth/me')).status).toBe(200)
    expect((await as(tokenB, '/api/auth/me')).status).toBe(200)

    // Change the password from session A with the CORRECT current password.
    const change = await as(tokenA, '/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: OLD_PW,
        newPassword: NEW_PW,
        confirmPassword: NEW_PW,
      }),
    })
    expect(change.status).toBe(200)
    const changeBody = (await change.json()) as {
      ok: boolean
      data?: { otherSessionsSignedOut?: number }
    }
    expect(changeBody.ok).toBe(true)
    expect(changeBody.data?.otherSessionsSignedOut).toBe(1) // session B revoked

    // BOTH pre-change tokens are dead: A rotated away, B revoked.
    expect((await as(tokenA, '/api/auth/me')).status).toBe(401)
    expect((await as(tokenB, '/api/auth/me')).status).toBe(401)
    const surviving = await db.session.count({ where: { userId: throwaway.id } })
    expect(surviving).toBe(1) // only the post-rotation row

    // The OLD password no longer authenticates (generic 401 — no oracle).
    const oldLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email, password: OLD_PW }),
    })
    expect(oldLogin.status).toBe(401)

    // The NEW password DOES (the suite's single real login — throwaway acct).
    const newLogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email, password: NEW_PW }),
    })
    expect(newLogin.status).toBe(200)
    const newLoginBody = (await newLogin.json()) as {
      ok: boolean
      data?: { sessionToken?: string; role?: string }
    }
    expect(newLoginBody.ok).toBe(true)
    expect(newLoginBody.data?.role).toBe('TEACHER')
    const freshToken = newLoginBody.data?.sessionToken
    expect(freshToken).toBeTruthy()
    expect((await as(freshToken!, '/api/auth/me')).status).toBe(200)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. no-store on the sensitive surfaces (PIH-4c §30)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · sensitive surfaces are served no-store', () => {
  test('/api/auth/me, /api/students, /api/export → Cache-Control: no-store', async () => {
    const me = await as(principalToken, '/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.headers.get('cache-control')).toBe('no-store')

    const students = await as(principalToken, '/api/students')
    expect(students.status).toBe(200)
    expect(students.headers.get('cache-control')).toBe('no-store')

    const exportRes = await as(principalToken, '/api/export?type=students')
    expect(exportRes.status).toBe(200)
    expect(exportRes.headers.get('cache-control')).toBe('no-store')
  }, 45_000) // generous: first-hit dev compilation of the export route
})
