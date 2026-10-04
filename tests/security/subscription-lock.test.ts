/**
 * FINAL-ACCEPTANCE Phase 10 — ACCOUNT-level subscription lock (LIVE HTTP).
 *
 * Proves the server-side enforcement contract:
 *
 *   1. A LOCKED account still AUTHENTICATES: the real login API issues a
 *      session and reports subscriptionStatus 'LOCKED' (login/session are
 *      never broken by the lock).
 *   2. Identity surfaces stay readable: /api/auth/me returns the full
 *      identity (name, guardian/father, contact, enrollment context).
 *   3. Every protected module API rejects the LOCKED account with 403
 *      SUBSCRIPTION_REQUIRED — student surfaces AND teacher surfaces.
 *   4. The gate is data-driven: unlocking the account restores access on
 *      the very next request (no cache, no restart).
 *   5. Unlocked accounts are unaffected (the featured student's dashboard
 *      works while the locked account is rejected).
 *
 * Fixtures: the corpus's own LOCKED accounts (4 students + 1 teacher,
 * planted by prisma/seed.ts from DEMO_SUBSCRIPTION_LOCKED_*). Sessions are
 * minted as direct rows (bypassing only the login limiter — never an
 * authorization gate), exactly like tests/security/salary-persistence.
 * The corpus lock state is RESTORED in afterAll (the suite flips it only
 * transiently for the unlock/restore proof).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const TEST_TIMEOUT = 45_000

import { DEMO_STUDENT_EMAIL } from '../helpers/credentials'

/** The corpus's LOCKED accounts (emails resolved from the DB, never guessed). */
const LOCKED_STUDENT_EMAILS = [
  'priya.dwivedi@hawkingshigh.edu',
  'md.kaif@hawkingshigh.edu',
  'nisha.alam@hawkingshigh.edu',
  'suresh.khan@hawkingshigh.edu',
]
const LOCKED_TEACHER_EMAIL = 'teacher3@hawkingshigh.edu'
const LOCKED_STUDENT_PASSWORD = 'password123' // SEED_DEMO_PASSWORD default family

let lockedStudent = { id: '', email: '', guardianName: '' }
let _lockedTeacher = { id: '', email: '' }
let _unlockedStudent = { id: '', email: '' }
let tokenLockedStudent = ''
let tokenLockedTeacher = ''
let tokenUnlockedStudent = ''

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const school = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!school) throw new Error('hawkings-prithvipur missing — run bun run seed:demo')

  const [ls, lt, us] = await Promise.all([
    db.user.findUnique({
      where: { email: LOCKED_STUDENT_EMAILS[0] },
      include: { student: { select: { guardianName: true, guardianPhone: true, rollNo: true } } },
    }),
    db.user.findUnique({ where: { email: LOCKED_TEACHER_EMAIL } }),
    db.user.findUnique({ where: { email: DEMO_STUDENT_EMAIL } }),
  ])
  if (!ls || !lt || !us) throw new Error('locked/unlocked fixtures missing — run bun run seed:demo')
  if (ls.subscriptionStatus !== 'LOCKED' || lt.subscriptionStatus !== 'LOCKED') {
    throw new Error('fixtures are not LOCKED — the corpus seed owns these rows')
  }
  lockedStudent = { id: ls.id, email: ls.email, guardianName: ls.student?.guardianName ?? '' }
  _lockedTeacher = { id: lt.id, email: lt.email }
  _unlockedStudent = { id: us.id, email: us.email }

  // Direct session rows (bypass ONLY the login limiter, never a gate).
  tokenLockedStudent = randomBytes(32).toString('hex')
  tokenLockedTeacher = randomBytes(32).toString('hex')
  tokenUnlockedStudent = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: ls.id, tokenHash: hashSessionToken(tokenLockedStudent), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: lt.id, tokenHash: hashSessionToken(tokenLockedTeacher), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: us.id, tokenHash: hashSessionToken(tokenUnlockedStudent), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: { tokenHash: { in: [hashSessionToken(tokenLockedStudent), hashSessionToken(tokenLockedTeacher), hashSessionToken(tokenUnlockedStudent)] } },
    }),
  )

  // One real-login probe needs a clean bucket (the strict limiter is
  // global per-IP in a suite run).
  await resetLoginBuckets([LOCKED_STUDENT_EMAILS[0]])
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Restore the canonical corpus lock state (the unlock/restore test
  // flips it transiently).
  await db.user.update({ where: { id: lockedStudent.id }, data: { subscriptionStatus: 'LOCKED' } }).catch(() => {})
  await db.$disconnect()
}, 60_000)

// ─── helpers ───────────────────────────────────────────────────────────────

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

// ─── the contract ──────────────────────────────────────────────────────────

describe('Phase 10 — account-level subscription lock (server-side)', () => {
  test('a LOCKED account still authenticates through the real login API', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lockedStudent.email, password: LOCKED_STUDENT_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.role).toBe('STUDENT')
    expect(body.data.subscriptionStatus).toBe('LOCKED')
    // The session was minted — logout immediately (leave no live session).
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${body.data.sessionToken ?? ''}` } }).catch(() => {})
  }, TEST_TIMEOUT)

  test('identity surfaces stay readable: /api/auth/me returns the full identity', async () => {
    const res = await as(tokenLockedStudent, '/api/auth/me')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const user = body.data.user
    expect(user.subscriptionStatus).toBe('LOCKED')
    expect(user.status).toBe('ACTIVE')
    expect(user.name).toBeTruthy()
    expect(user.phone).toBeTruthy()
    // The student context (father/guardian, enrollment) is the mission's
    // "name, father name, mobile, photo" identity set.
    expect(user.student).toBeTruthy()
    expect(user.student.guardianName).toBeTruthy()
    expect(user.student.guardianPhone).toBeTruthy()
    expect(user.student.classLabel).toMatch(/9-A/)
    expect(user.student.rollNo).toBeTruthy()
    expect(user.student.admissionNo).toMatch(/^HHSP-/)
  }, TEST_TIMEOUT)

  test('protected STUDENT module APIs reject the LOCKED account (403 SUBSCRIPTION_REQUIRED)', async () => {
    const probes: [string, RequestInit][] = [
      ['/api/dashboard', { method: 'POST', body: JSON.stringify({ scope: 'me' }) }],
      ['/api/students', { method: 'GET' }],
      ['/api/fees', { method: 'GET' }],
    ]
    for (const [path, init] of probes) {
      const res = await as(tokenLockedStudent, path, init)
      expect(res.status).toBe(403)
      const body = await res.json().catch(() => ({}))
      expect(body.code).toBe('SUBSCRIPTION_REQUIRED')
      // SaaS-HARDENING copy (stale-test fix): the account-level lock now
      // explains the ACCOUNT state honestly — sign-in works, business
      // modules are locked, contact the school/SCHOLARIO. (The old
      // 'Subscription required' wording belonged to the pre-reset
      // account-locked era.)
      expect(String(body.error).toLowerCase()).toContain('account is locked')
    }
  }, TEST_TIMEOUT)

  test('protected TEACHER module APIs reject the LOCKED teacher (403 SUBSCRIPTION_REQUIRED)', async () => {
    const probes: [string, RequestInit][] = [
      ['/api/teachers', { method: 'GET' }],
      ['/api/dashboard', { method: 'POST', body: JSON.stringify({ scope: 'me' }) }],
    ]
    for (const [path, init] of probes) {
      const res = await as(tokenLockedTeacher, path, init)
      expect(res.status).toBe(403)
      const body = await res.json().catch(() => ({}))
      expect(body.code).toBe('SUBSCRIPTION_REQUIRED')
    }
    // The teacher's identity surface still works.
    const me = await as(tokenLockedTeacher, '/api/auth/me')
    expect(me.status).toBe(200)
    const meBody = await me.json()
    expect(meBody.data.user.subscriptionStatus).toBe('LOCKED')
    expect(meBody.data.user.name).toBeTruthy()
  }, TEST_TIMEOUT)

  test('identity routes stay open for the LOCKED account (logout/sessions)', async () => {
    const sessions = await as(tokenLockedStudent, '/api/auth/sessions')
    expect(sessions.status).toBe(200)
    const body = await sessions.json().catch(() => null)
    // 200 OR a structured body — either way it is NOT the 403 lock code.
    if (body && body.code) expect(body.code).not.toBe('SUBSCRIPTION_REQUIRED')
  }, TEST_TIMEOUT)

  test('the gate is data-driven: unlocking restores access immediately', async () => {
    // A STUDENT-accessible module surface (the student dashboard scope).
    const probe = () => as(tokenLockedStudent, '/api/dashboard', { method: 'POST', body: JSON.stringify({ scope: 'me' }) })
    // While locked → 403 SUBSCRIPTION_REQUIRED.
    const lockedRes = await probe()
    expect(lockedRes.status).toBe(403)
    expect((await lockedRes.json().catch(() => ({}))).code).toBe('SUBSCRIPTION_REQUIRED')

    // Unlock (the platform/office action — DB state).
    await db.user.update({ where: { id: lockedStudent.id }, data: { subscriptionStatus: 'ACTIVE' } })

    // The very next request on the SAME session succeeds.
    const unlockedRes = await probe()
    expect(unlockedRes.status).toBe(200)
    const body = await unlockedRes.json().catch(() => ({}))
    expect(body.ok).toBe(true)

    // Re-lock (corpus state restored in afterAll belt-and-braces).
    await db.user.update({ where: { id: lockedStudent.id }, data: { subscriptionStatus: 'LOCKED' } })
    const relocked = await probe()
    expect(relocked.status).toBe(403)
    expect((await relocked.json().catch(() => ({}))).code).toBe('SUBSCRIPTION_REQUIRED')
  }, TEST_TIMEOUT)

  test('unlocked accounts are unaffected (featured student dashboard works)', async () => {
    const res = await as(tokenUnlockedStudent, '/api/dashboard', {
      method: 'POST',
      body: JSON.stringify({ scope: 'me' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.user?.subscriptionStatus ?? body.data.student?.user?.name).toBeTruthy()
  }, TEST_TIMEOUT)

  test('anonymous requests are still 401 (the lock never widens the surface)', async () => {
    const res = await fetch(`${BASE}/api/students`)
    expect(res.status).toBe(401)
  }, TEST_TIMEOUT)
})
