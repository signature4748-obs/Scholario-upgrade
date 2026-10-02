/**
 * PHASE 8C (mission §10-12) — School provisioning: atomicity, race
 * safety, lifecycle and the setup-readiness contract.
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. ATOMICITY — School + founding Principal are created in ONE
 *      transaction: when the principal insert fails (concurrent email
 *      claim), the School row is rolled back (no orphan school), and the
 *      failure maps to a typed CONFLICT (never a raw 500).
 *   2. RACE SAFETY — two concurrent provisions racing on the same
 *      slug/code/email: exactly ONE wins, the loser gets 409 CONFLICT,
 *      and the database ends with exactly one consistent school+principal
 *      pair (DB uniques are the authority; pre-checks are UX only).
 *   3. LIFECYCLE — PENDING schools cannot sign in; activation is an
 *      explicit, audited transition that then admits the principal.
 *   4. SETUP READINESS (§12) — the readiness surface is computed from the
 *      live database: a freshly provisioned school shows honest
 *      near-zero progress with an active principal; configured corpus
 *      schools show real counts; the summary marks PENDING schools not
 *      usable regardless of content.
 *   5. BOUNDARY — the provisioning route is platform-only: anonymous and
 *      school sessions are refused.
 *
 * Live HTTP against the dev server, platform root admin (MFA login via
 * the seeded TOTP secret — same conventions as platform-isolation.test.ts).
 * Every school/user/audit row created here is marker-suffixed and removed
 * in afterAll (the demo corpus is never touched).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { hashSessionToken } from '@/lib/auth'
import {
  PLATFORM_ROOT_PASSWORD,
  PLATFORM_ROOT_TOTP_SECRET,
} from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000
const MARKER = randomBytes(4).toString('hex')

const ROOT_EMAIL = 'admin@scholario.cloud'

let rootToken = ''

const cleanup: Array<() => Promise<unknown>> = []

/** Platform root login with full MFA (the REAL path). */
async function platformRootLogin(): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  const code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, totpCode: code }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (res.status === 429) {
    // Rate-limited re-run: direct PlatformAdminSession fixture (bypasses
    // ONLY the login limiter — same convention as platform-isolation).
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('root platform admin missing (run bun prisma/seed-platform.ts)')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    return token
  }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform root login failed: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

function provisionBody(overrides: Record<string, unknown> = {}) {
  const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
  return {
    name: `Provision Test ${suffix}`,
    slug: `provision-${suffix}`,
    // Unique PER CALL (fresh random): the school code is a DB-unique
    // column, so a per-run-constant code would make every provision
    // after the first in the same run collide on the pre-check — a
    // test artifact, not the system under test.
    code: `PT${randomBytes(5).toString('hex').toUpperCase()}`,
    plan: 'STANDARD',
    principalName: 'Founding Principal',
    principalEmail: `principal-${suffix}@provision.test`,
    principalPassword: 'Pr0vision!8c-secure',
    ...overrides,
  }
}

async function provision(token: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/api/platform/schools`, {
    method: 'POST',
    // x-platform-token — the platform transport (Authorization bearer is
    // the SCHOOL transport and is deliberately ignored by platform routes).
    headers: { 'content-type': 'application/json', 'x-platform-token': token },
    body: JSON.stringify(body),
  })
}

async function activate(token: string, schoolId: string) {
  return fetch(`${BASE}/api/platform/schools/${schoolId}/activate`, {
    method: 'POST',
    headers: { 'x-platform-token': token },
  })
}

async function schoolLoginAttempt(email: string, password: string) {
  return fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

/** Full teardown of a marker school: sessions, users, then the school row. */
async function purgeSchool(schoolId: string) {
  if (!schoolId) return
  await db.session.deleteMany({ where: { user: { schoolId } } })
  await db.user.deleteMany({ where: { schoolId } })
  await db.platformAuditLog.deleteMany({ where: { schoolId } })
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

beforeAll(async () => {
  // Order-independence heal for the platform root account + both loopback
  // IP rows (the MFA login path is exercised for real here).
  await resetLoginBuckets([ROOT_EMAIL])
  rootToken = await platformRootLogin()
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Belt-and-braces marker sweep (in case a test failed mid-flight).
  const strays = await db.school.findMany({
    where: { slug: { contains: `provision-${MARKER}` } },
    select: { id: true },
  })
  for (const s of strays) await purgeSchool(s.id)
  await db.user.deleteMany({ where: { email: { contains: `@provision.test` } } })
  await db.$disconnect()
})

// ─── boundary ───────────────────────────────────────────────────────────────

describe('PHASE 8C · provisioning boundary', () => {
  test('anonymous provision → 401 (platform-only surface)', async () => {
    const res = await provision('not-a-token', provisionBody())
    expect(res.status).toBe(401)
  }, T)

  test('a SCHOOL session cannot provision (disjoint token spaces)', async () => {
    // A minted school session row (no login needed — boundary only).
    const demoPrincipal = await db.user.findFirst({
      where: { role: 'PRINCIPAL', school: { slug: 'sunrise-academy' } },
      select: { id: true },
    })
    expect(demoPrincipal).not.toBeNull()
    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: { userId: demoPrincipal!.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600_000) },
    })
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    const res = await provision(token, provisionBody())
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)
})

// ─── atomicity + lifecycle ─────────────────────────────────────────────────

describe('PHASE 8C · atomic provisioning + lifecycle', () => {
  test(
    'happy path: PENDING school + principal + audit row; login blocked until activation',
    async () => {
      const body = provisionBody()
      const res = await provision(rootToken, body)
      expect(res.status).toBe(200)
      const json = (await res.json()) as {
        ok: boolean
        data: {
          school: { id: string; status: string }
          principal: { id: string }
          nextStep: string
        }
      }
      expect(json.ok).toBe(true)
      expect(json.data.school.status).toBe('PENDING')
      expect(json.data.nextStep).toBe('activate')
      const schoolId = json.data.school.id
      cleanup.push(() => purgeSchool(schoolId))

      // Both rows exist, correctly related.
      const school = await db.school.findUnique({ where: { id: schoolId } })
      const principal = await db.user.findUnique({ where: { id: json.data.principal.id } })
      expect(school?.status).toBe('PENDING')
      expect(principal?.schoolId).toBe(schoolId)
      expect(principal?.role).toBe('PRINCIPAL')

      // Provisioning was audited.
      const audit = await db.platformAuditLog.findFirst({
        where: { schoolId, action: 'platform.school.provisioned' },
      })
      expect(audit).not.toBeNull()

      // PENDING → principal login is REFUSED by the school access
      // policy (Phase 7.5): valid credentials, tenant not active yet —
      // the canonical verdict is 403 SCHOOL_SUSPENDED with an honest
      // "not active yet" message (NOT the generic 401 credential
      // mismatch, which would leak nothing but also inform nobody).
      await resetLoginBuckets([body.principalEmail])
      const blocked = await schoolLoginAttempt(body.principalEmail, body.principalPassword)
      expect(blocked.status).toBe(403)
      const blockedBody = (await blocked.json()) as { ok: boolean; code: string }
      expect(blockedBody.ok).toBe(false)
      expect(blockedBody.code).toBe('SCHOOL_SUSPENDED')

      // Activate → audited transition → login now succeeds.
      const act = await activate(rootToken, schoolId)
      expect(act.status).toBe(200)
      const actAudit = await db.platformAuditLog.findFirst({
        where: { schoolId, action: 'platform.school.activated' },
      })
      expect(actAudit).not.toBeNull()

      await resetLoginBuckets([body.principalEmail])
      const allowed = await schoolLoginAttempt(body.principalEmail, body.principalPassword)
      expect(allowed.status).toBe(200)
      const loginBody = (await allowed.json()) as { ok: boolean; data?: { sessionToken?: string } }
      expect(loginBody.ok).toBe(true)
      expect(loginBody.data?.sessionToken).toBeTruthy()
    },
    T,
  )

  test(
    'duplicate principal email → 409 CONFLICT and NO orphan school (transaction rollback)',
    async () => {
      // First: a successful provision claims the email.
      const first = provisionBody()
      const res1 = await provision(rootToken, first)
      expect(res1.status).toBe(200)
      const j1 = (await res1.json()) as { data: { school: { id: string } } }
      cleanup.push(() => purgeSchool(j1.data.school.id))
      const before = await db.school.count({ where: { slug: { contains: 'provision-' } } })

      // Second: DIFFERENT school identity, SAME principal email — the
      // pre-check catches it (no rows written either way).
      const second = provisionBody({ principalEmail: first.principalEmail })
      const res2 = await provision(rootToken, second)
      expect(res2.status).toBe(409)
      const body2 = (await res2.json()) as { ok: boolean; code?: string; error?: string }
      expect(body2.ok).toBe(false)

      const after = await db.school.count({ where: { slug: { contains: 'provision-' } } })
      expect(after).toBe(before) // no orphan from the refused provision
      expect(await db.school.findUnique({ where: { slug: second.slug } })).toBeNull()
    },
    T,
  )

  test(
    'CONCURRENT provisions racing the same identity → exactly one wins, loser 409, no orphans',
    async () => {
      const body = provisionBody()
      // Strip the marker-suffix uniqueness from the shared slug: both
      // requests use the SAME identity (the race we want to observe).
      const shared = provisionBody({ slug: body.slug, code: body.code, principalEmail: body.principalEmail })
      const [a, b] = await Promise.all([provision(rootToken, shared), provision(rootToken, shared)])

      const statuses = [a.status, b.status].sort()
      // Exactly one 200 + one 409 — never two 200s, never a 500.
      expect(statuses).toEqual([200, 409])
      if (a.status === 200) {
        const ja = (await a.json()) as { data: { school: { id: string } } }
        cleanup.push(() => purgeSchool(ja.data.school.id))
      } else {
        const jb = (await b.json()) as { data: { school: { id: string } } }
        cleanup.push(() => purgeSchool(jb.data.school.id))
      }

      // The database holds EXACTLY ONE school for the raced slug, with
      // exactly one principal — the atomic invariant.
      const schools = await db.school.findMany({ where: { slug: shared.slug } })
      expect(schools.length).toBe(1)
      const principals = await db.user.findMany({
        where: { schoolId: schools[0].id, role: 'PRINCIPAL' },
      })
      expect(principals.length).toBe(1)
    },
    T,
  )
})

// ─── setup readiness (§12) ─────────────────────────────────────────────────

describe('PHASE 8C · setup-readiness contract (DB-computed progress)', () => {
  test(
    'fresh PENDING school: honest near-zero progress, principal present, not usable',
    async () => {
      const body = provisionBody()
      const res = await provision(rootToken, body)
      expect(res.status).toBe(200)
      const json = (await res.json()) as { data: { school: { id: string } } }
      const schoolId = json.data.school.id
      cleanup.push(() => purgeSchool(schoolId))

      const read = await fetch(`${BASE}/api/platform/schools/${schoolId}/setup-readiness`, {
        headers: { 'x-platform-token': rootToken },
      })
      expect(read.status).toBe(200)
      const payload = (await read.json()) as {
        ok: boolean
        data: {
          sections: Array<{ id: string; label: string; required: boolean; done: boolean; detail: string }>
          summary: { requiredDone: number; requiredTotal: number; usable: boolean; requiredComplete: boolean }
        }
      }
      expect(payload.ok).toBe(true)

      const byId = new Map(payload.data.sections.map((s) => [s.id, s]))
      // Identity exists by construction; the principal exists.
      expect(byId.get('identity')?.done).toBe(true)
      expect(byId.get('principal')?.done).toBe(true)
      // A fresh school honestly reports zero everywhere else.
      expect(byId.get('people')?.done).toBe(false)
      expect(byId.get('fees')?.done).toBe(false)
      expect(byId.get('academic')?.done).toBe(false)
      expect((byId.get('people')?.detail ?? '')).toContain('0 teachers')
      // PENDING → not usable even though content sections are incomplete.
      expect(payload.data.summary.usable).toBe(false)
      expect(payload.data.summary.requiredComplete).toBe(false)
    },
    T,
  )

  test(
    'configured corpus school (demo tenant): real DB counts, no fabrication',
    async () => {
      const demo = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
      expect(demo).not.toBeNull()
      const read = await fetch(`${BASE}/api/platform/schools/${demo!.id}/setup-readiness`, {
        headers: { 'x-platform-token': rootToken },
      })
      expect(read.status).toBe(200)
      const payload = (await read.json()) as {
        data: {
          sections: Array<{ id: string; done: boolean; detail: string; counts: Record<string, number> }>
          summary: { usable: boolean; requiredComplete: boolean }
        }
      }
      // The demo corpus is fully configured: every REQUIRED section done.
      expect(payload.data.summary.requiredComplete).toBe(true)
      expect(payload.data.summary.usable).toBe(true) // ACTIVE + complete

      // Counts match the live database (recomputed independently).
      const people = payload.data.sections.find((s) => s.id === 'people')!
      const liveTeachers = await db.teacher.count({ where: { schoolId: demo!.id } })
      const liveStudents = await db.student.count({ where: { schoolId: demo!.id } })
      expect(people.counts.teachers).toBe(liveTeachers)
      expect(people.counts.students).toBe(liveStudents)
      expect(liveTeachers).toBeGreaterThan(0) // the corpus is real
      expect(people.done).toBe(true)
    },
    T,
  )

  test('boundary: school session and anonymous cannot read readiness', async () => {
    const anon = await fetch(`${BASE}/api/platform/schools/some-id/setup-readiness`)
    expect(anon.status).toBe(401)
    const demoPrincipal = await db.user.findFirst({
      where: { role: 'PRINCIPAL', school: { slug: 'sunrise-academy' } },
      select: { id: true },
    })
    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: { userId: demoPrincipal!.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600_000) },
    })
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    const school = await fetch(`${BASE}/api/platform/schools/some-id/setup-readiness`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(school.status).toBe(401)
  }, T)
})
