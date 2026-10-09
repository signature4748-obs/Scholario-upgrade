/**
 * GATE F — identity-surface canonical-role regression suite (HTTP-level).
 *
 * THE INVARIANT UNDER TEST (Gate D finding A2):
 *   /api/auth/me already hydrates a non-canonical school-role session as
 *   logged-out (401). The five identity routes must AGREE with it:
 *     1. POST/DELETE /api/profile/avatar        (own photo maintenance)
 *     2. GET     /api/profile/avatar/[userId]   (authorized avatar stream)
 *     3. GET/DELETE /api/auth/sessions          (own device list / bulk revoke)
 *     4. DELETE  /api/auth/sessions/[id]        (single-session revoke)
 *     5. POST    /api/auth/change-password      (own credential rotation)
 *   Every one of them requires an ACTIVE + CANONICAL school session
 *   (PRINCIPAL | TEACHER | STUDENT). A directly-minted session for ANY
 *   non-canonical role (MANAGEMENT, ACCOUNTANT, DRIVER, PARENT, a
 *   school-row SUPER_ADMIN, or an unknown/stray value like STAFF) must
 *   receive 401 — the same envelope /api/auth/me answers — while every
 *   legitimate self-service behavior of the canonical roles is preserved.
 *
 * This is a LIVE HTTP integration suite against the dev server (default
 * http://localhost:3000), the same harness as tenant-isolation.test.ts /
 * upload-authz.test.ts:
 *   · canonical personas from prisma/seed-tenant-isolation.ts are driven
 *     through DIRECT session rows (the established fixture technique — no
 *     login-door budget is consumed by this suite at all);
 *   · GATE-F-LOCAL fixtures ONLY for the forged/suspended/peer/pw personas:
 *     users `gate-f.*@hawkings.test` (and one School-B twin) are created by
 *     this suite, never seeded, never used elsewhere, and fully purged in
 *     cleanup. No production user, session, or credential is ever created
 *     or modified.
 *
 * Storage note: the local dev environment intentionally runs WITHOUT
 * Supabase storage credentials. Authorization gates run BEFORE any storage
 * call in all five routes, so denial assertions are deterministic; the few
 * post-authorization probes accept the documented storage-dependent
 * terminal statuses — the assertion that matters is that the AUTHORIZATION
 * layer was passed (≠ 401/403), never the storage result.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken, hashPassword, verifyPassword } from '@/lib/auth'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'
import { db } from '../helpers/db'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000
const PW = TENANT_FIXTURE_PASSWORD

/** Non-canonical role values probed with forged (directly-minted) sessions.
 * STAFF is the "unknown/stray role" probe (no login door, no seed, no
 * permission entry — pure fail-closed vocabulary). */
const FORGED_ROLES = ['MANAGEMENT', 'ACCOUNTANT', 'DRIVER', 'PARENT', 'SUPER_ADMIN', 'STAFF'] as const
const forgedEmail = (role: string) => `gate-f.${role.toLowerCase()}@hawkings.test`
const localEmail = (name: string) => `gate-f.${name}@hawkings.test`

interface FixtureUser {
  id: string
  email: string
}

const fx = {
  schoolA: { id: '' },
  schoolB: { id: '' },
  users: {
    teacherA: { id: '', email: 'tenant.teacher.a@hawkings.test' } as FixtureUser,
    studentA: { id: '', email: 'tenant.student.a@hawkings.test' } as FixtureUser,
    principalA: { id: '', email: 'tenant.principal.a@hawkings.test' } as FixtureUser,
    suspended: { id: '', email: localEmail('suspended') } as FixtureUser,
    peer: { id: '', email: localEmail('peer') } as FixtureUser,
    peerB: { id: '', email: 'gate-f.peer.b@greenvalley.test' } as FixtureUser,
    revoker: { id: '', email: localEmail('revoker') } as FixtureUser,
    pw: { id: '', email: localEmail('pw') } as FixtureUser,
    pw2: { id: '', email: localEmail('pw2') } as FixtureUser,
    forged: {} as Record<string, FixtureUser>,
  },
}

const tokens: Record<string, string> = {}
/** gate-f.revoker's three sessions: r1 (current) / r2 / r3. */
const revokerSessions: Record<'r1' | 'r2' | 'r3', { id: string; token: string }> = {
  r1: { id: '', token: '' }, r2: { id: '', token: '' }, r3: { id: '', token: '' },
}
/** gate-f.pw's two sessions: pw1 (current) / pw2. */
const pwSessions: Record<'pw1' | 'pw2', { id: string; token: string }> = {
  pw1: { id: '', token: '' }, pw2: { id: '', token: '' },
}

// ─────────────────────────────────────────────────────────────────────────
// Auth + fixture helpers (mirrors tenant-isolation / upload-authz suites)
// ─────────────────────────────────────────────────────────────────────────

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(email: string, path: string, init?: RequestInit): Promise<Response> {
  const token = tokens[email] ?? (await directSession(email))
  tokens[email] = token
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/** Multipart probe (no JSON content-type — fetch derives the boundary). */
async function asForm(email: string, path: string, form: FormData): Promise<Response> {
  const token = tokens[email] ?? (await directSession(email))
  tokens[email] = token
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
}

const anon = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, init)

/** PNG header (magic bytes suffice for the avatar MIME sniff). */
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
])

/** api() envelope 401 (Error('UNAUTHORIZED') sentinel → AUTH_REQUIRED). */
async function expectApi401(res: Response) {
  expect(res.status).toBe(401)
  const body = (await res.json()) as { ok?: boolean; code?: string }
  expect(body.ok).toBe(false)
  expect(body.code).toBe('AUTH_REQUIRED')
}
/** Manual-envelope 401 (the avatar [userId] route's own unauthorized()). */
async function expectRaw401(res: Response) {
  expect(res.status).toBe(401)
  const body = (await res.json()) as { ok?: boolean; error?: string }
  expect(body.ok).toBe(false)
  expect(body.error).toBe('UNAUTHORIZED')
}

const enc = encodeURIComponent

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

/** Avatar column snapshot for the SHARED canonical personas (defensive
 * restore in cleanup — the storage-unconfigured environment means the
 * upload probe can never actually write, but hygiene is cheap). */
let teacherAvatarSnapshot: { avatar: string | null; avatarUrl: string | null } | null = null

beforeAll(async () => {
  const schoolA = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  const schoolB = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!schoolA || !schoolB) throw new Error('Fixtures missing — run: bun prisma/seed-tenant-isolation.ts')
  fx.schoolA.id = schoolA.id
  fx.schoolB.id = schoolB.id

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`Fixture user missing: ${email} — run: bun prisma/seed-tenant-isolation.ts`)
    return u
  }

  const [tA, sA, pA] = await Promise.all([
    byEmail(fx.users.teacherA.email),
    byEmail(fx.users.studentA.email),
    byEmail(fx.users.principalA.email),
  ])
  fx.users.teacherA = { id: tA.id, email: tA.email }
  fx.users.studentA = { id: sA.id, email: sA.email }
  fx.users.principalA = { id: pA.id, email: pA.email }
  teacherAvatarSnapshot = { avatar: tA.avatar, avatarUrl: tA.avatarUrl }

  // GATE-F local fixtures — idempotent: purge any leftovers from a crashed
  // prior run first (deleting the users cascades their sessions), then
  // create fresh rows.
  const allLocal = [
    ...FORGED_ROLES.map(forgedEmail),
    localEmail('suspended'),
    localEmail('peer'),
    'gate-f.peer.b@greenvalley.test',
    localEmail('revoker'),
    localEmail('pw'),
    localEmail('pw2'),
  ]
  await db.user.deleteMany({ where: { email: { in: allLocal } } })

  // Forged non-canonical personas — SCHOOL-bound rows with a non-canonical
  // role value (incl. the school-row SUPER_ADMIN and unknown STAFF probes).
  for (const role of FORGED_ROLES) {
    const u = await db.user.create({
      data: { email: forgedEmail(role), name: `Gate F Forged ${role}`, role, schoolId: fx.schoolA.id, status: 'ACTIVE' },
    })
    fx.users.forged[role] = { id: u.id, email: u.email }
  }

  // Suspended CANONICAL user (TEACHER, status SUSPENDED) — the active-account probe.
  {
    const u = await db.user.create({
      data: { email: localEmail('suspended'), name: 'Gate F Suspended Teacher', role: 'TEACHER', schoolId: fx.schoolA.id, status: 'SUSPENDED' },
    })
    fx.users.suspended = { id: u.id, email: u.email }
  }

  // Peer-avatar targets — avatar COLUMN set to a safe server-minted shape
  // (no storage bytes exist; an authorized read ends at the honest storage
  // error, which is exactly what the authorization-cleared probes assert).
  {
    const u = await db.user.create({
      data: {
        email: localEmail('peer'), name: 'Gate F Peer Student', role: 'STUDENT',
        schoolId: fx.schoolA.id, status: 'ACTIVE',
        avatar: `gatefpeer-${randomBytes(6).toString('hex')}.png`,
      },
    })
    fx.users.peer = { id: u.id, email: u.email }
  }
  {
    const u = await db.user.create({
      data: {
        email: 'gate-f.peer.b@greenvalley.test', name: 'Gate F Peer Student B', role: 'STUDENT',
        schoolId: fx.schoolB.id, status: 'ACTIVE',
        avatar: `gatefpeerb-${randomBytes(6).toString('hex')}.png`,
      },
    })
    fx.users.peerB = { id: u.id, email: u.email }
  }

  // revoker / pw / pw2 — canonical TEACHER personas for the session- and
  // password-mutation positives (NEVER the shared personas: the mutations
  // stay entirely inside Gate-F-local rows).
  for (const name of ['revoker', 'pw', 'pw2'] as const) {
    const u = await db.user.create({
      data: {
        email: localEmail(name), name: `Gate F ${name}`, role: 'TEACHER',
        schoolId: fx.schoolA.id, status: 'ACTIVE',
        passwordHash: hashPassword(PW),
      },
    })
    fx.users[name] = { id: u.id, email: u.email }
  }

  // Sessions — every token is REGISTERED in the map so `as()` reuses it
  // instead of lazily minting an extra row (the scope assertions count
  // rows). Canonical personas + forged + suspended + peer: 1 each; revoker
  // gets 3 (r1 = current); pw gets 2 (pw1 = current); pw2 gets 1.
  tokens[fx.users.teacherA.email] = await directSession(fx.users.teacherA.email)
  tokens[fx.users.studentA.email] = await directSession(fx.users.studentA.email)
  tokens[fx.users.principalA.email] = await directSession(fx.users.principalA.email)
  for (const role of FORGED_ROLES) tokens[forgedEmail(role)] = await directSession(forgedEmail(role))
  tokens[fx.users.suspended.email] = await directSession(fx.users.suspended.email)
  tokens[fx.users.peer.email] = await directSession(fx.users.peer.email)
  revokerSessions.r1.token = await directSession(fx.users.revoker.email)
  revokerSessions.r2.token = await directSession(fx.users.revoker.email)
  revokerSessions.r3.token = await directSession(fx.users.revoker.email)
  tokens[fx.users.revoker.email] = revokerSessions.r1.token
  pwSessions.pw1.token = await directSession(fx.users.pw.email)
  pwSessions.pw2.token = await directSession(fx.users.pw.email)
  tokens[fx.users.pw.email] = pwSessions.pw1.token
  tokens[fx.users.pw2.email] = await directSession(fx.users.pw2.email)

  // Resolve the session ROW ids the ownership assertions reference.
  for (const key of ['r1', 'r2', 'r3'] as const) {
    const row = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(revokerSessions[key].token) },
    })
    if (!row) throw new Error(`revoker ${key} session row missing`)
    revokerSessions[key].id = row.id
  }
  for (const key of ['pw1', 'pw2'] as const) {
    const row = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(pwSessions[key].token) },
    })
    if (!row) throw new Error(`pw ${key} session row missing`)
    pwSessions[key].id = row.id
  }

  // Warm-up: compile every in-scope route ONCE (anonymous 401 probes) so
  // the first real assertion does not pay the dev-server cold-compile cost
  // (the documented respawn/OOM flake family leaves a cold route cache).
  await anon('/api/auth/me')
  await anon('/api/profile/avatar', { method: 'POST', body: new FormData() })
  await anon('/api/profile/avatar', { method: 'DELETE' })
  await anon(`/api/profile/avatar/${enc(fx.users.teacherA.id)}`)
  await anon('/api/auth/sessions')
  await anon('/api/auth/sessions', { method: 'DELETE' })
  await anon('/api/auth/sessions/nonexistent-warmup', { method: 'DELETE' })
  await anon('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: PW, newPassword: 'WarmupProbe9', confirmPassword: 'WarmupProbe9' }),
  })
}, 120_000)

afterAll(async () => {
  // Best-effort: never let fixture hygiene mask a test failure.
  try {
    // Restore the shared persona's avatar columns (defensive no-op).
    if (teacherAvatarSnapshot) {
      await db.user.update({
        where: { id: fx.users.teacherA.id },
        data: { avatar: teacherAvatarSnapshot.avatar, avatarUrl: teacherAvatarSnapshot.avatarUrl },
      })
    }
  } catch { /* snapshot restore is defensive */ }
  try {
    await db.session.deleteMany({
      where: { tokenHash: { in: Object.values(tokens).map(hashSessionToken) } },
    })
  } catch { /* users cascade below anyway */ }
  try {
    await db.user.deleteMany({
      where: {
        email: {
          in: [
            ...FORGED_ROLES.map(forgedEmail),
            localEmail('suspended'),
            localEmail('peer'),
            'gate-f.peer.b@greenvalley.test',
            localEmail('revoker'),
            localEmail('pw'),
            localEmail('pw2'),
          ],
        },
      },
    })
  } catch { /* idempotent re-run heals */ }
})

// ─────────────────────────────────────────────────────────────────────────
// 0. /api/auth/me — the agreement anchor (its 401 is the contract the five
//    routes must reproduce for non-canonical sessions)
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · /api/auth/me — canonical identity anchor', () => {
  test('teacher / principal / student sessions all hydrate (positive controls)', async () => {
    for (const persona of [fx.users.teacherA, fx.users.principalA, fx.users.studentA]) {
      const res = await as(persona.email, '/api/auth/me')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok?: boolean; data?: { user?: { id?: string; role?: string } } }
      expect(body.ok).toBe(true)
      expect(body.data?.user?.id).toBe(persona.id)
      expect(['TEACHER', 'PRINCIPAL', 'STUDENT']).toContain(body.data?.user?.role)
    }
  }, T)

  test('suspended canonical session → 401 (active-account requirement)', async () => {
    await expectApi401(await as(fx.users.suspended.email, '/api/auth/me'))
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 401 (agreement anchor)`, async () => {
      await expectApi401(await as(forgedEmail(role), '/api/auth/me'))
    }, T)
  }
})

// ─────────────────────────────────────────────────────────────────────────
// 1. POST /api/profile/avatar — own-photo upload gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · POST /api/profile/avatar — authorization boundary', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(await anon('/api/profile/avatar', { method: 'POST', body: new FormData() }))
  }, T)

  test('suspended canonical session → 401 (active-account requirement)', async () => {
    await expectApi401(await asForm(fx.users.suspended.email, '/api/profile/avatar', new FormData()))
  }, T)

  test('canonical roles clear the role gate → 400 "A photo file is required" (body parsed, validation reached)', async () => {
    for (const persona of [fx.users.teacherA, fx.users.principalA, fx.users.studentA]) {
      const res = await asForm(persona.email, '/api/profile/avatar', new FormData())
      expect(res.status).toBe(400)
      const body = (await res.json()) as { ok?: boolean; error?: string }
      expect(body.ok).toBe(false)
      expect(body.error).toBe('A photo file is required')
    }
  }, T)

  test('canonical user with a valid image passes the whole authorization+validation stack (storage decides the terminal status)', async () => {
    const form = new FormData()
    form.append('file', new File([PNG_MAGIC], 'probe.png', { type: 'image/png' }))
    const res = await asForm(fx.users.teacherA.email, '/api/profile/avatar', form)
    // Local env: storage unconfigured → 503 EXTERNAL_SERVICE_FAILURE; with
    // storage → 200. The invariant: the AUTHORIZATION layer was cleared.
    expect([200, 500, 503]).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. DELETE /api/profile/avatar — own-photo removal gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · DELETE /api/profile/avatar — authorization boundary', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(await anon('/api/profile/avatar', { method: 'DELETE' }))
  }, T)

  test('suspended canonical session → 401 (active-account requirement — Gate F closes the gap DELETE previously had)', async () => {
    await expectApi401(await as(fx.users.suspended.email, '/api/profile/avatar', { method: 'DELETE' }))
  }, T)

  test('canonical roles remove their (unset) own photo → 200 (self-service preserved, no-op write)', async () => {
    for (const persona of [fx.users.teacherA, fx.users.principalA, fx.users.studentA]) {
      const res = await as(persona.email, '/api/profile/avatar', { method: 'DELETE' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok?: boolean; data?: { avatarUrl?: string | null } }
      expect(body.ok).toBe(true)
      expect(body.data?.avatarUrl).toBeNull()
    }
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. GET /api/profile/avatar/[userId] — authorized avatar stream
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · GET /api/profile/avatar/[userId] — viewer gate + peer visibility', () => {
  test('anonymous → 401 (manual envelope, fail-closed)', async () => {
    await expectRaw401(await anon(`/api/profile/avatar/${enc(fx.users.peer.id)}`))
  }, T)

  test('suspended canonical viewer → 401 (before any target lookup)', async () => {
    await expectRaw401(await as(fx.users.suspended.email, `/api/profile/avatar/${enc(fx.users.peer.id)}`))
  }, T)

  test(`forged non-canonical viewer → 401 even for a NONEXISTENT id (viewer gate runs before the target lookup — no existence disclosure)`, async () => {
    await expectRaw401(
      await as(forgedEmail('MANAGEMENT'), `/api/profile/avatar/${enc('nonexistent-user-id-123')}`),
    )
  }, T)

  test('self-view: peer reads its OWN avatar (authorization cleared, storage decides)', async () => {
    const res = await as(fx.users.peer.email, `/api/profile/avatar/${enc(fx.users.peer.id)}`)
    // Local env: storage unconfigured → the route's own 400 'Internal error'
    // after the ALLOW verdict; with storage + missing object → honest 404;
    // with storage + object → 200. Invariant: NOT 401/403.
    expect([200, 400, 404]).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  }, T)

  test('same-school peer: teacher reads a School-A student avatar (authorization cleared, storage decides)', async () => {
    const res = await as(fx.users.teacherA.email, `/api/profile/avatar/${enc(fx.users.peer.id)}`)
    expect([200, 400, 404]).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  }, T)

  test('cross-school: School-A viewer → School-B avatar → 403 with the exact bare envelope (existing contract, nothing leaked)', async () => {
    const res = await as(fx.users.teacherA.email, `/api/profile/avatar/${enc(fx.users.peerB.id)}`)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body).toEqual({ ok: false, error: 'FORBIDDEN' })
  }, T)

  test('cross-school (student viewer, symmetric): School-A student → School-B avatar → 403', async () => {
    const res = await as(fx.users.studentA.email, `/api/profile/avatar/${enc(fx.users.peerB.id)}`)
    expect(res.status).toBe(403)
  }, T)

  test('nonexistent user id → 404 (honest, no existence leak for a canonical viewer)', async () => {
    const res = await as(fx.users.teacherA.email, `/api/profile/avatar/${enc('nonexistent-user-id-456')}`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body).toEqual({ ok: false, error: 'NOT_FOUND' })
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. GET /api/auth/sessions — own device list
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · GET /api/auth/sessions — own-scope listing', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(await anon('/api/auth/sessions'))
  }, T)

  test('suspended canonical session → 401', async () => {
    await expectApi401(await as(fx.users.suspended.email, '/api/auth/sessions'))
  }, T)

  test('canonical user lists EXACTLY their own sessions; current flagged; no foreign rows', async () => {
    const res = await as(fx.users.revoker.email, '/api/auth/sessions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok?: boolean
      data?: { sessions?: Array<{ id: string; isCurrent: boolean }> }
    }
    expect(body.ok).toBe(true)
    const sessions = body.data?.sessions ?? []
    const ids = sessions.map((s) => s.id)
    // Exactly the three fixture sessions of the revoker persona.
    expect(new Set(ids)).toEqual(
      new Set([revokerSessions.r1.id, revokerSessions.r2.id, revokerSessions.r3.id]),
    )
    // The presented token's row is flagged current.
    const currentCount = sessions.filter((s) => s.isCurrent).length
    expect(currentCount).toBe(1)
    expect(sessions.find((s) => s.id === revokerSessions.r1.id)?.isCurrent).toBe(true)
    // Another user's session id must never appear.
    expect(ids).not.toContain(pwSessions.pw1.id)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. DELETE /api/auth/sessions/[id] — single-session revoke (runs BEFORE
//    the bulk DELETE so the bulk assertion "signedOut" stays exact)
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · DELETE /api/auth/sessions/[id] — ownership boundary', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(await anon(`/api/auth/sessions/${enc(revokerSessions.r3.id)}`, { method: 'DELETE' }))
  }, T)

  test('suspended canonical session → 401', async () => {
    await expectApi401(
      await as(fx.users.suspended.email, `/api/auth/sessions/${enc(revokerSessions.r3.id)}`, { method: 'DELETE' }),
    )
  }, T)

  test('cross-user revoke: another user\'s session id → 404 (SAME envelope as nonexistent — no existence leak)', async () => {
    const foreign = await as(fx.users.revoker.email, `/api/auth/sessions/${enc(pwSessions.pw1.id)}`, { method: 'DELETE' })
    expect(foreign.status).toBe(404)
    const foreignBody = (await foreign.json()) as { ok?: boolean; code?: string }
    expect(foreignBody.ok).toBe(false)
    expect(foreignBody.code).toBe('RESOURCE_NOT_FOUND')
    // The foreign row is untouched.
    expect(await db.session.findUnique({ where: { id: pwSessions.pw1.id } })).not.toBeNull()

    const ghost = await as(fx.users.revoker.email, `/api/auth/sessions/${enc('nonexistent-session-id-1')}`, { method: 'DELETE' })
    expect(ghost.status).toBe(404)
    const ghostBody = (await ghost.json()) as { ok?: boolean; code?: string }
    expect(ghostBody.code).toBe('RESOURCE_NOT_FOUND')
    expect(ghostBody.ok).toBe(foreignBody.ok)
  }, T)

  test('current-session protection: deleting the CURRENT session is refused and the row survives', async () => {
    const res = await as(fx.users.revoker.email, `/api/auth/sessions/${enc(revokerSessions.r1.id)}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await db.session.findUnique({ where: { id: revokerSessions.r1.id } })).not.toBeNull()
  }, T)

  test('canonical user revokes ONE of their OTHER sessions → 200, target gone, current intact (self-service preserved)', async () => {
    const res = await as(fx.users.revoker.email, `/api/auth/sessions/${enc(revokerSessions.r3.id)}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; data?: { ok?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data?.ok).toBe(true)
    expect(await db.session.findUnique({ where: { id: revokerSessions.r3.id } })).toBeNull()
    expect(await db.session.findUnique({ where: { id: revokerSessions.r1.id } })).not.toBeNull()
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 6. DELETE /api/auth/sessions — bulk "sign out other sessions"
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · DELETE /api/auth/sessions — bulk revoke scope', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(await anon('/api/auth/sessions', { method: 'DELETE' }))
  }, T)

  test('suspended canonical session → 401', async () => {
    await expectApi401(await as(fx.users.suspended.email, '/api/auth/sessions', { method: 'DELETE' }))
  }, T)

  test('canonical user signs out their OTHER sessions only (r2 revoked; current + foreign users untouched)', async () => {
    const res = await as(fx.users.revoker.email, '/api/auth/sessions', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; data?: { signedOut?: number } }
    expect(body.ok).toBe(true)
    // r3 was already revoked in the [id] section — only r2 remains.
    expect(body.data?.signedOut).toBe(1)
    expect(await db.session.findUnique({ where: { id: revokerSessions.r2.id } })).toBeNull()
    expect(await db.session.findUnique({ where: { id: revokerSessions.r1.id } })).not.toBeNull()
    // Another user's session survived the bulk revoke untouched.
    expect(await db.session.findUnique({ where: { id: pwSessions.pw1.id } })).not.toBeNull()
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 7. POST /api/auth/change-password — credential rotation gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · POST /api/auth/change-password — authorization + validation contract', () => {
  const pwBody = (current: string, next: string, confirm: string) =>
    JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm })

  test('anonymous → 401 (fail-closed)', async () => {
    await expectApi401(
      await anon('/api/auth/change-password', { method: 'POST', body: pwBody(PW, 'BrandNewPass99', 'BrandNewPass99') }),
    )
  }, T)

  test('suspended canonical session → 401', async () => {
    await expectApi401(
      await as(fx.users.suspended.email, '/api/auth/change-password', {
        method: 'POST', body: pwBody(PW, 'BrandNewPass99', 'BrandNewPass99'),
      }),
    )
  }, T)

  test('canonical user rotates their own password → 200; other sessions revoked; hash actually rotated', async () => {
    const NEW = 'GateFRotated77'
    const res = await as(fx.users.pw.email, '/api/auth/change-password', {
      method: 'POST', body: pwBody(PW, NEW, NEW),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; data?: { ok?: boolean; otherSessionsSignedOut?: number } }
    expect(body.ok).toBe(true)
    expect(body.data?.otherSessionsSignedOut).toBe(1)
    // pw2 (the other session) is revoked; the current one was rotated.
    expect(await db.session.findUnique({ where: { id: pwSessions.pw2.id } })).toBeNull()
    expect(
      await db.session.findUnique({ where: { tokenHash: hashSessionToken(pwSessions.pw1.token) } }),
    ).toBeNull()
    // Credential truth: old password dead, new password live.
    const row = await db.user.findUnique({ where: { id: fx.users.pw.id } })
    expect(row?.passwordHash).toBeTruthy()
    expect(verifyPassword(PW, row!.passwordHash!)).toBe(false)
    expect(verifyPassword(NEW, row!.passwordHash!)).toBe(true)
    expect(row?.mustChangePassword).toBe(false)
    // SESSION ROTATION: the presented token is dead now; the response
    // carries the rotated token in dev-bearer mode. Adopt it so the
    // follow-up validation probes on this persona stay authenticated.
    const rotated = body.data?.sessionToken
    if (typeof rotated === 'string' && rotated.length > 0) {
      tokens[fx.users.pw.email] = rotated
    }
  }, T)

  test('wrong current password → 422 "Current password is incorrect" (existing check preserved)', async () => {
    const res = await as(fx.users.pw.email, '/api/auth/change-password', {
      method: 'POST', body: pwBody('DefinitelyWrong1', 'AnotherNewPass8', 'AnotherNewPass8'),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Current password is incorrect')
  }, T)

  test('confirm mismatch → 422 (existing check preserved)', async () => {
    const res = await as(fx.users.pw2.email, '/api/auth/change-password', {
      method: 'POST', body: pwBody(PW, 'MismatchedPass1', 'DifferentPass2'),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('New passwords do not match')
  }, T)

  test('new password identical to current → 422 (existing check preserved)', async () => {
    const res = await as(fx.users.pw2.email, '/api/auth/change-password', {
      method: 'POST', body: pwBody(PW, PW, PW),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('The new password must be different from the current one')
  }, T)

  test('weak new password → 422 schema rejection (existing policy preserved)', async () => {
    const res = await as(fx.users.pw2.email, '/api/auth/change-password', {
      method: 'POST', body: pwBody(PW, 'short', 'short'),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 8. Agreement sweep — /api/auth/me and ALL five in-scope routes answer the
//    SAME 401 for every forged non-canonical session (Gate D finding A2)
// ─────────────────────────────────────────────────────────────────────────

describe('GATE F · /api/auth/me and the five identity routes AGREE on non-canonical sessions', () => {
  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 401 on me + avatar POST/DELETE/GET[userId] + sessions GET/DELETE/[id] + change-password`, async () => {
      // me (agreement anchor)
      await expectApi401(await as(forgedEmail(role), '/api/auth/me'))
      // 1a. avatar upload
      await expectApi401(await asForm(forgedEmail(role), '/api/profile/avatar', new FormData()))
      // 1b. avatar removal
      await expectApi401(await as(forgedEmail(role), '/api/profile/avatar', { method: 'DELETE' }))
      // 2. avatar stream (real target id; manual envelope)
      await expectRaw401(
        await as(forgedEmail(role), `/api/profile/avatar/${enc(fx.users.peer.id)}`),
      )
      // 3a. session list
      await expectApi401(await as(forgedEmail(role), '/api/auth/sessions'))
      // 3b. bulk sign-out
      await expectApi401(await as(forgedEmail(role), '/api/auth/sessions', { method: 'DELETE' }))
      // 4. single-session revoke
      await expectApi401(
        await as(forgedEmail(role), `/api/auth/sessions/${enc('nonexistent-session-id-2')}`, { method: 'DELETE' }),
      )
      // 5. password change
      await expectApi401(
        await as(forgedEmail(role), '/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: PW, newPassword: 'NopeNope99', confirmPassword: 'NopeNope99' }),
        }),
      )
    }, T)
  }
})
