/**
 * GATE E — upload-route authorization regression suite (HTTP-level).
 *
 * THE INVARIANT UNDER TEST:
 *   Every authenticated upload-family operation enforces the CANONICAL
 *   school-role invariant — exactly PRINCIPAL | TEACHER | STUDENT may hold
 *   a school session, and the teacher-onboarding media family
 *   (/api/teachers/upload*) is PRINCIPAL-only administrative access.
 *   A directly-minted session for ANY non-canonical role (MANAGEMENT,
 *   ACCOUNTANT, DRIVER, PARENT, a school-row SUPER_ADMIN) must receive
 *   NOTHING (Gate D finding A1 — these raw getCurrentUser() handlers
 *   previously granted MANAGEMENT through inline conditionals).
 *
 * This is a LIVE HTTP integration suite against the dev server (default
 * http://localhost:3000), the same harness as tenant-isolation.test.ts:
 *   · canonical personas from prisma/seed-tenant-isolation.ts (real login
 *     for the principal — the golden end-to-end path; direct session rows
 *     for teacher/student/principal-B, the established fixture technique
 *     that keeps this suite under the login IP budget);
 *   · GATE-E-LOCAL fixtures ONLY for the forged non-canonical roles:
 *     users `gate-e.<role>@hawkings.test` are created by this suite,
 *     never seeded, never used elsewhere, and fully purged in cleanup.
 *     No production user, session, or credential is ever created or
 *     modified.
 *
 * Storage note: the local dev environment intentionally runs WITHOUT
 * Supabase storage credentials (see .env — "ephemeral signing keys").
 * Every authorization gate in these routes runs BEFORE any storage call,
 * so all denial/pass-assertions below are deterministic; the few
 * post-authorization probes accept the documented storage-dependent
 * outcomes (302 with storage, 404 honest-missing with storage, 503 when
 * storage is unconfigured) — the assertion that matters is that the
 * AUTHORIZATION layer was passed (≠ 401/403), never the storage result.
 *
 * Signed-token contract (intentionally supported, must NOT regress):
 *   · POST /api/teachers/upload/access mints a 1h HMAC token that
 *     authorizes GET /api/teachers/upload/<fileId>?t=… WITHOUT any
 *     session (embed/iframe path);
 *   · the token binds to ONE fileId (cross-file replay fails);
 *   · the MINT is ownership-checked against the caller's tenant.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken, hashPassword } from '@/lib/auth'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { db } from '../helpers/db'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000
const PW = TENANT_FIXTURE_PASSWORD

/** Non-canonical role values probed with forged (directly-minted) sessions. */
const FORGED_ROLES = ['MANAGEMENT', 'ACCOUNTANT', 'DRIVER', 'PARENT', 'SUPER_ADMIN'] as const
const forgedEmail = (role: string) => `gate-e.${role.toLowerCase()}@hawkings.test`

interface FixtureUser {
  id: string
  email: string
}

const fx = {
  schoolA: { id: '' },
  schoolB: { id: '' },
  users: {
    principalA: { id: '', email: 'tenant.principal.a@hawkings.test' } as FixtureUser,
    teacherA: { id: '', email: 'tenant.teacher.a@hawkings.test' } as FixtureUser,
    studentA: { id: '', email: 'tenant.student.a@hawkings.test' } as FixtureUser,
    principalB: { id: '', email: 'principal.b@greenvalley.test' } as FixtureUser,
    forged: {} as Record<string, FixtureUser>,
  },
}

const tokens: Record<string, string> = {}
const mintedFileIds: string[] = []

// ─────────────────────────────────────────────────────────────────────────
// Auth + fixture helpers (mirrors tenant-isolation.test.ts)
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

async function login(email: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  // Only the principal rides the REAL login door here (the golden path —
  // auth-gate.test.ts owns the full positive matrix). teacher/student/
  // principal-B use the direct-session fixture: identical Session rows,
  // keeps this suite's login-IP footprint at 1 real + 5 negative probes
  // (the shared loopback budget is 8 per 15 min).
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  })
  if (res.status === 429) {
    console.warn(`[upload-authz] login rate-limited for ${email}; using direct session fixture`)
    const token = await directSession(email)
    tokens[email] = token
    return token
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string }; error?: string }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`)
  }
  tokens[email] = body.data.sessionToken
  return body.data.sessionToken
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

/** Create a registered UploadedFile row (no storage bytes — none exist in
 *  this env; the registry row alone is what the ownership checks read). */
async function freshRow(schoolId: string, uploadedById: string): Promise<string> {
  const fileId = `gate-e-${randomBytes(6).toString('hex')}.png`
  await db.uploadedFile.create({
    data: { id: fileId, schoolId, scope: 'teachers', uploadedById, size: 1234 },
  })
  mintedFileIds.push(fileId)
  return fileId
}

/** PNG with an IHDR of exactly w×h (the dimension decoder reads the header). */
const pngWithDims = (w: number, h: number) =>
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    (w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff,
    (h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00,
  ])

const enc = encodeURIComponent

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

let rowA = '' // registered teacher-scope row, School A (Hawkings)
let rowB = '' // registered teacher-scope row, School B (Green Valley)

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

  const [pA, tA, sA, pB] = await Promise.all([
    byEmail(fx.users.principalA.email),
    byEmail(fx.users.teacherA.email),
    byEmail(fx.users.studentA.email),
    byEmail(fx.users.principalB.email),
  ])
  fx.users.principalA = { id: pA.id, email: pA.email }
  fx.users.teacherA = { id: tA.id, email: tA.email }
  fx.users.studentA = { id: sA.id, email: sA.email }
  fx.users.principalB = { id: pB.id, email: pB.email }

  // Heal the login limiter state for the fixture accounts (never production
  // accounts) so the real-login probes are not 429-shadowed by prior runs.
  await resetLoginBuckets([
    fx.users.principalA.email,
    fx.users.teacherA.email,
    fx.users.studentA.email,
    fx.users.principalB.email,
    ...FORGED_ROLES.map(forgedEmail),
  ])

  // GATE-E local fixtures — the forged non-canonical personas. Idempotent:
  // purge any leftovers from a crashed prior run first (deleting the users
  // cascades their sessions), then create fresh ACTIVE school-bound rows.
  await db.user.deleteMany({ where: { email: { in: FORGED_ROLES.map(forgedEmail) } } })
  for (const role of FORGED_ROLES) {
    const u = await db.user.create({
      data: {
        email: forgedEmail(role),
        name: `Gate E Forged ${role}`,
        role,
        // school-row binding is the point: these are SCHOOL-plane identities
        // holding a non-canonical role value (incl. the school-row
        // SUPER_ADMIN probe), never platform-plane identities.
        schoolId: fx.schoolA.id,
        status: 'ACTIVE',
        passwordHash: hashPassword(PW),
      },
    })
    fx.users.forged[role] = { id: u.id, email: u.email }
  }

  // Registry rows for the tenant/ownership probes.
  rowA = await freshRow(fx.schoolA.id, fx.users.principalA.id)
  rowB = await freshRow(fx.schoolB.id, fx.users.principalB.id)

  // Sessions: principal A rides the real login door; the rest are direct
  // session fixtures (identical rows, same server-side gates).
  await login(fx.users.principalA.email)
  await directSession(fx.users.teacherA.email)
  await directSession(fx.users.studentA.email)
  await directSession(fx.users.principalB.email)
  for (const role of FORGED_ROLES) await directSession(forgedEmail(role))
}, 120_000)

afterAll(async () => {
  // Best-effort: never let fixture hygiene mask a test failure.
  try {
    await db.uploadedFile.deleteMany({ where: { id: { in: mintedFileIds } } })
  } catch { /* rows already consumed by DELETE tests / cascade */ }
  try {
    await db.session.deleteMany({
      where: { tokenHash: { in: Object.values(tokens).map(hashSessionToken) } },
    })
  } catch { /* users cascade below anyway */ }
  try {
    await db.user.deleteMany({ where: { email: { in: FORGED_ROLES.map(forgedEmail) } } })
  } catch { /* idempotent re-run heals */ }
})

// ─────────────────────────────────────────────────────────────────────────
// 0. Login door (defense in depth — does NOT substitute for the raw-session
//    probes below: those prove the gates themselves, not just the door)
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · login door refuses non-canonical school roles', () => {
  for (const role of FORGED_ROLES) {
    test(`normal login with correct password for ${role} persona → 401, no session`, async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: forgedEmail(role), password: PW }),
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { ok?: boolean; data?: { sessionToken?: string } }
      expect(body.ok).toBe(false)
      expect(body.data?.sessionToken).toBeUndefined()
    }, T)
  }
})

// ─────────────────────────────────────────────────────────────────────────
// 1. POST /api/teachers/upload — administrative upload gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · POST /api/teachers/upload — authorization boundary', () => {
  test('anonymous → 401 (fail-closed)', async () => {
    const res = await anon('/api/teachers/upload', { method: 'POST', body: new FormData() })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Authentication required.')
  }, T)

  test('invalid bearer token → 401 (fail-closed)', async () => {
    const res = await fetch(`${BASE}/api/teachers/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${randomBytes(16).toString('hex')}` },
      body: new FormData(),
    })
    expect(res.status).toBe(401)
  }, T)

  test('teacher → 403 (not an administrative role)', async () => {
    const res = await asForm(fx.users.teacherA.email, '/api/teachers/upload', new FormData())
    expect(res.status).toBe(403)
    const body = (await res.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Not authorized for media uploads.')
  }, T)

  test('student → 403', async () => {
    const res = await asForm(fx.users.studentA.email, '/api/teachers/upload', new FormData())
    expect(res.status).toBe(403)
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 403 (Gate D finding A1 regression)`, async () => {
      const res = await asForm(forgedEmail(role), '/api/teachers/upload', new FormData())
      expect(res.status).toBe(403)
      const body = (await res.json()) as { success?: boolean; error?: string }
      expect(body.success).toBe(false)
      expect(body.error).toBe('Not authorized for media uploads.')
    }, T)
  }

  test('principal passes the boundary → 400 "No file received." (role gate cleared, body parsed)', async () => {
    const res = await asForm(fx.users.principalA.email, '/api/teachers/upload', new FormData())
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('No file received.')
  }, T)

  test('principal passes the whole validation stack → 415 too-small (magic bytes + dimensions reached)', async () => {
    const form = new FormData()
    form.append('file', new File([pngWithDims(32, 32)], 'probe.png', { type: 'image/png' }))
    form.append('kind', 'photo')
    const res = await asForm(fx.users.principalA.email, '/api/teachers/upload', form)
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('too small')
  }, T)

  test('principal with a policy-conforming image reaches storage (200 with storage; 500 = storage intentionally unconfigured locally)', async () => {
    const form = new FormData()
    form.append('file', new File([pngWithDims(200, 200)], 'probe.png', { type: 'image/png' }))
    form.append('kind', 'photo')
    const res = await asForm(fx.users.principalA.email, '/api/teachers/upload', form)
    expect([200, 500]).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. GET /api/teachers/upload/[fileId] — staff read gate + signed tokens
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · GET /api/teachers/upload/[fileId] — session path', () => {
  test('invalid file id shape → 400 (traversal-proof, before any authz)', async () => {
    const res = await anon(`/api/teachers/upload/${enc('../../etc/passwd')}`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('Invalid file id.')
  }, T)

  test('wrong-extension id → 400', async () => {
    const res = await anon(`/api/teachers/upload/${enc('gate-e-xyz123.exe')}`)
    expect(res.status).toBe(400)
  }, T)

  test('anonymous + registered file → 401', async () => {
    const res = await anon(`/api/teachers/upload/${enc(rowA)}`)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error?: string }).error).toBe('Authentication required to access this file.')
  }, T)

  test('teacher → 401 (staff read is administrative-only)', async () => {
    const res = await as(fx.users.teacherA.email, `/api/teachers/upload/${enc(rowA)}`)
    expect(res.status).toBe(401)
  }, T)

  test('student → 401', async () => {
    const res = await as(fx.users.studentA.email, `/api/teachers/upload/${enc(rowA)}`)
    expect(res.status).toBe(401)
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 401 (Gate D finding A1 regression: MANAGEMENT previously entered the allow path)`, async () => {
      const res = await as(forgedEmail(role), `/api/teachers/upload/${enc(rowA)}`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toBe('Authentication required to access this file.')
    }, T)
  }

  test('cross-tenant read: principal B → School A file → 404, existence not leaked', async () => {
    const res = await as(fx.users.principalB.email, `/api/teachers/upload/${enc(rowA)}`)
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).not.toContain(fx.schoolA.id)
    expect(text).not.toContain('Hawkings')
    expect((JSON.parse(text) as { error?: string }).error).toBe('File not found. It may have been removed.')
  }, T)

  test('cross-tenant read (symmetric): principal A → School B file → 404', async () => {
    const res = await as(fx.users.principalA.email, `/api/teachers/upload/${enc(rowB)}`)
    expect(res.status).toBe(404)
  }, T)

  test('principal A → own-tenant registered file passes authorization (storage decides the outcome)', async () => {
    const res = await as(fx.users.principalA.email, `/api/teachers/upload/${enc(rowA)}`)
    expect(res.status).not.toBe(401)
    expect([302, 404, 503]).toContain(res.status)
  }, T)

  test('legacy unregistered id: principal session keeps the documented Phase-1 compat read (authorization allow, storage decides)', async () => {
    const legacyId = `gate-e-legacy-${randomBytes(4).toString('hex')}.png`
    const res = await as(fx.users.principalA.email, `/api/teachers/upload/${enc(legacyId)}`)
    expect(res.status).not.toBe(401)
    expect([302, 404, 503]).toContain(res.status)
  }, T)
})

describe('GATE E · GET /api/teachers/upload/[fileId] — signed-token path (must NOT regress)', () => {
  test('garbage token → 401 (fail-closed)', async () => {
    const res = await anon(`/api/teachers/upload/${enc(rowA)}?t=garbage-token`)
    expect(res.status).toBe(401)
  }, T)

  test('tampered-token shape → 401', async () => {
    const res = await anon(`/api/teachers/upload/${enc(rowA)}?t=v1.abc.def`)
    expect(res.status).toBe(401)
  }, T)

  test('valid minted token authorizes WITHOUT any session (embed path preserved)', async () => {
    // Mint through the real access route as principal A, then GET with NO
    // Authorization header / cookie — the signed URL alone must carry the
    // read past the authorization layer (302 w/ storage, 404 honest-missing
    // w/ storage, 503 storage-unconfigured — anything but 401/403).
    const mint = await as(fx.users.principalA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(mint.status).toBe(200)
    const mintBody = (await mint.json()) as { ok?: boolean; data?: { url?: string } }
    expect(mintBody.ok).toBe(true)
    const url = mintBody.data?.url
    expect(typeof url).toBe('string')
    expect(url!.startsWith('/api/teachers/upload/')).toBe(true)

    const res = await anon(url!)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    expect([302, 404, 503]).toContain(res.status)
  }, T)

  test('token is bound to ONE file id — cross-file replay fails', async () => {
    const mint = await as(fx.users.principalA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(mint.status).toBe(200)
    const { url } = ((await mint.json()) as { data: { url: string } }).data
    const token = new URL(`${BASE}${url}`).searchParams.get('t')
    expect(token).toBeTruthy()
    // Replay the SAME valid token against School B's file id → binding
    // failure → no session fallback → 401.
    const res = await anon(`/api/teachers/upload/${enc(rowB)}?t=${token}`)
    expect(res.status).toBe(401)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. DELETE /api/teachers/upload/[fileId] — destructive gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · DELETE /api/teachers/upload/[fileId] — authorization boundary', () => {
  test('invalid file id shape → 400', async () => {
    const res = await anon(`/api/teachers/upload/${enc('../../etc/passwd')}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
  }, T)

  test('anonymous + valid id → 401 (fail-closed)', async () => {
    const res = await anon(`/api/teachers/upload/${enc(rowA)}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error?: string }).error).toBe('Authentication required to remove this file.')
  }, T)

  test('teacher → 401, registry row intact', async () => {
    const res = await as(fx.users.teacherA.email, `/api/teachers/upload/${enc(rowA)}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
    expect(await db.uploadedFile.findUnique({ where: { id: rowA } })).not.toBeNull()
  }, T)

  test('student → 401, registry row intact', async () => {
    const res = await as(fx.users.studentA.email, `/api/teachers/upload/${enc(rowA)}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
    expect(await db.uploadedFile.findUnique({ where: { id: rowA } })).not.toBeNull()
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 401, registry row INTACT (Gate D finding A1 regression: MANAGEMENT previously deleted)`, async () => {
      const res = await as(forgedEmail(role), `/api/teachers/upload/${enc(rowA)}`, { method: 'DELETE' })
      expect(res.status).toBe(401)
      expect(await db.uploadedFile.findUnique({ where: { id: rowA } })).not.toBeNull()
    }, T)
  }

  test('cross-tenant delete: principal B → School A file → 404, row intact, no existence leak', async () => {
    const res = await as(fx.users.principalB.email, `/api/teachers/upload/${enc(rowA)}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).not.toContain(fx.schoolA.id)
    expect(text).not.toContain('Hawkings')
    expect(await db.uploadedFile.findUnique({ where: { id: rowA } })).not.toBeNull()
  }, T)

  test('cross-tenant delete (symmetric): principal A → School B file → 404, row intact', async () => {
    const res = await as(fx.users.principalA.email, `/api/teachers/upload/${enc(rowB)}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await db.uploadedFile.findUnique({ where: { id: rowB } })).not.toBeNull()
  }, T)

  test('unregistered (legacy) id → ownership unverifiable → delete refused (404)', async () => {
    const res = await as(
      fx.users.principalA.email,
      `/api/teachers/upload/${enc(`gate-e-unreg-${randomBytes(4).toString('hex')}.png`)}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
  }, T)

  test('principal A deletes their OWN registered file → 200 { success: true } (positive control)', async () => {
    const own = await freshRow(fx.schoolA.id, fx.users.principalA.id)
    const res = await as(fx.users.principalA.email, `/api/teachers/upload/${enc(own)}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success?: boolean }).success).toBe(true)
    expect(await db.uploadedFile.findUnique({ where: { id: own } })).toBeNull()
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. POST /api/teachers/upload/access — signed-token mint gate
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · POST /api/teachers/upload/access — authorization boundary', () => {
  test('anonymous → 401 envelope', async () => {
    const res = await anon('/api/teachers/upload/access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok?: boolean; code?: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('teacher → 403 envelope (FORBIDDEN)', async () => {
    const res = await as(fx.users.teacherA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok?: boolean; code?: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('student → 403 envelope (FORBIDDEN)', async () => {
    const res = await as(fx.users.studentA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).toBe('FORBIDDEN')
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 403 envelope (withUser canonical gate — pinned)`, async () => {
      const res = await as(forgedEmail(role), '/api/teachers/upload/access', {
        method: 'POST',
        body: JSON.stringify({ fileId: rowA }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { ok?: boolean; code?: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('FORBIDDEN')
    }, T)
  }

  test('cross-tenant mint: principal B → School A file → 404 envelope, no leak', async () => {
    const res = await as(fx.users.principalB.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowA }),
    })
    expect(res.status).toBe(404)
    const text = await res.text()
    const body = JSON.parse(text) as { ok?: boolean; code?: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('RESOURCE_NOT_FOUND')
    expect(text).not.toContain(fx.schoolA.id)
  }, T)

  test('cross-tenant mint (symmetric): principal A → School B file → 404 envelope', async () => {
    const res = await as(fx.users.principalA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: rowB }),
    })
    expect(res.status).toBe(404)
  }, T)

  test('junk fileId shape → 404 envelope (fail-closed)', async () => {
    const res = await as(fx.users.principalA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: '../../etc/passwd' }),
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code?: string }).code).toBe('RESOURCE_NOT_FOUND')
  }, T)

  test('unregistered (legacy) id → mint refused (ownership unverifiable) → 404', async () => {
    const res = await as(
      fx.users.principalA.email,
      '/api/teachers/upload/access',
      { method: 'POST', body: JSON.stringify({ fileId: `gate-e-noreg-${randomBytes(4).toString('hex')}.png` }) },
    )
    expect(res.status).toBe(404)
  }, T)

  test('principal A mints for their OWN file → 200, documented 1h expiry, url binds the file', async () => {
    const own = await freshRow(fx.schoolA.id, fx.users.principalA.id)
    const res = await as(fx.users.principalA.email, '/api/teachers/upload/access', {
      method: 'POST',
      body: JSON.stringify({ fileId: own }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok?: boolean
      data?: { url?: string; expiresAt?: string }
    }
    expect(body.ok).toBe(true)
    expect(body.data?.url).toContain(`/api/teachers/upload/${enc(own)}?t=`)
    // Documented expiry: DEFAULT_FILE_TOKEN_TTL_SEC = 1h (±5 min slack).
    const ttl = new Date(body.data!.expiresAt!).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(55 * 60_000)
    expect(ttl).toBeLessThan(65 * 60_000)
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. POST /api/school/website/upload — CMS gate (NO source change in this
//    gate: withUser's canonical invariant already holds; these tests PIN it)
// ─────────────────────────────────────────────────────────────────────────

describe('GATE E · POST /api/school/website/upload — CMS authorization (unchanged contract, pinned)', () => {
  test('anonymous → 401 envelope (withUser)', async () => {
    const res = await anon('/api/school/website/upload', { method: 'POST', body: new FormData() })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code?: string }).code).toBe('AUTH_REQUIRED')
  }, T)

  test('teacher → 403 (inline principal-only check)', async () => {
    const res = await asForm(fx.users.teacherA.email, '/api/school/website/upload', new FormData())
    expect(res.status).toBe(403)
    const body = (await res.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Only the principal or management can upload website images.')
  }, T)

  test('student → 403 (inline principal-only check)', async () => {
    const res = await asForm(fx.users.studentA.email, '/api/school/website/upload', new FormData())
    expect(res.status).toBe(403)
    expect(((await res.json()) as { success?: boolean }).success).toBe(false)
  }, T)

  for (const role of FORGED_ROLES) {
    test(`forged ${role} session → 403 CANONICAL envelope (withUser gate — the CMS route is never weakened)`, async () => {
      const res = await asForm(forgedEmail(role), '/api/school/website/upload', new FormData())
      expect(res.status).toBe(403)
      const body = (await res.json()) as { ok?: boolean; code?: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('FORBIDDEN')
    }, T)
  }

  test('principal passes the CMS gate → 400 "No image received." (role gate cleared)', async () => {
    const res = await asForm(fx.users.principalA.email, '/api/school/website/upload', new FormData())
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('No image received.')
  }, T)
})
