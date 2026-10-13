/**
 * PHASE 3 (school provisioning completion) — RELIABILITY & RECOVERY.
 *
 * THE INVARIANTS UNDER TEST (mission §3–4 + §6 acceptance cases):
 *
 *   1. IDEMPOTENT REPLAY — retrying the exact same provision request
 *      (same slug/code/principal email, same admin, school still
 *      PENDING) returns the ORIGINAL school with `replayed: true` and
 *      creates NO duplicate School/Principal rows. The one-time
 *      tempPassword is NOT re-surfaced (only its hash exists).
 *   2. NON-REPLAY RETRIES STAY CONFLICTS — after activation, with a
 *      different payload, or from a different admin, the retry is an
 *      honest 409 CONFLICT (the DB uniques are the authority).
 *   3. PRINCIPAL INVITE — provisioning delivers a best-effort invite
 *      email through the shared pipeline (dev-log transport in the dev
 *      environment): an EmailDelivery row exists, the response carries
 *      the honest delivery state, and a FAILED delivery NEVER falsely
 *      reports the school as READY (provisioning state surfaces
 *      REQUIRES_ATTENTION with a recovery path).
 *   4. CREDENTIAL RE-ISSUE — the recovery route mints a FRESH one-time
 *      password (the old bootstrap value stops working), re-sends the
 *      invite, revokes sessions, audits, and is REFUSED once the
 *      principal owns their credential (no account-takeover vector).
 *   5. BOUNDARY — the re-issue route is platform-only (school sessions
 *      and anonymous callers are refused); the dead legacy
 *      POST /api/schools collection route is GONE (404).
 *
 * Live HTTP against the dev server, platform root admin (MFA login via
 * the seeded TOTP secret — same conventions as
 * platform-provisioning.test.ts). Every school/user/audit row created
 * here is marker-suffixed and removed in afterAll.
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
const OPS_EMAIL = 'ops@scholario.io'

const RUN_IP = `10.241.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

let rootToken = ''

const cleanup: Array<() => Promise<unknown>> = []

/** Platform root login with full MFA (the REAL path). */
async function platformRootLogin(): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  const code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, totpCode: code }),
  })
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (res.status === 429) {
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
    name: `Reliability Test ${suffix}`,
    slug: `reliab-${suffix}`,
    code: `RL${randomBytes(5).toString('hex').toUpperCase()}`,
    plan: 'STANDARD',
    principalName: 'Founding Principal',
    principalEmail: `principal-${suffix}@reliab.test`,
    principalPassword: 'Re1iability!9x-secure',
    ...overrides,
  }
}

async function provision(token: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/api/platform/schools`, {
    method: 'POST',
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

async function reissue(token: string, schoolId: string) {
  return fetch(`${BASE}/api/platform/schools/${schoolId}/reissue-credential`, {
    method: 'POST',
    headers: { 'x-platform-token': token },
  })
}

async function dossier(token: string, schoolId: string) {
  const res = await fetch(`${BASE}/api/platform/schools/${schoolId}`, {
    headers: { 'x-platform-token': token },
  })
  return (await res.json()) as {
    ok: boolean
    data?: {
      school: { id: string; slug: string; status: string }
      access: {
        principal: {
          email: string
          credentialState: string
          invitation?: { state: string; errorClass?: string }
        } | null
      }
      provisioning?: { state: string; readiness: { requiredDone: number; requiredTotal: number } | null }
    }
  }
}

async function schoolLogin(email: string, password: string) {
  return fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
}

/** Full teardown of a marker school: sessions, users, email rows, then the school row. */
async function purgeSchool(schoolId: string) {
  if (!schoolId) return
  const principal = await db.user.findFirst({
    where: { schoolId, role: 'PRINCIPAL' },
    select: { id: true },
  })
  await db.session.deleteMany({ where: { user: { schoolId } } })
  await db.user.deleteMany({ where: { schoolId } })
  if (principal) {
    await db.emailDelivery.deleteMany({
      where: { dedupeKey: { startsWith: `principal-invite:${principal.id}` } },
    })
  }
  await db.platformAuditLog.deleteMany({ where: { schoolId } })
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

beforeAll(async () => {
  await resetLoginBuckets([ROOT_EMAIL])
  rootToken = await platformRootLogin()
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  const strays = await db.school.findMany({
    where: { slug: { contains: `reliab-${MARKER}` } },
    select: { id: true },
  })
  for (const s of strays) await purgeSchool(s.id)
  await db.user.deleteMany({ where: { email: { contains: '@reliab.test' } } })
  await db.$disconnect()
})

// ─── idempotent replay ──────────────────────────────────────────────────────

describe('PHASE 3 · idempotent provision replay', () => {
  test('retrying the exact same request returns the original school — no duplicates', async () => {
    const body = provisionBody()
    const first = await provision(rootToken, body)
    expect(first.status).toBe(200)
    const firstJson = (await first.json()) as {
      ok: boolean
      replayed?: boolean
      data: { school: { id: string; status: string }; principal: { id: string }; invitation?: { state: string } }
    }
    expect(firstJson.ok).toBe(true)
    expect(firstJson.replayed).toBeFalsy()
    const schoolId = firstJson.data.school.id
    const principalId = firstJson.data.principal.id
    cleanup.push(() => purgeSchool(schoolId))

    // A NEW principal email NOT claimed anywhere: the invite email went
    // out through the dev-log transport.
    expect(['SENT', 'QUEUED']).toContain(firstJson.data.invitation?.state ?? 'NONE')

    // The retry (identical payload, same admin, still PENDING).
    const retry = await provision(rootToken, body)
    expect(retry.status).toBe(200)
    const retryJson = (await retry.json()) as {
      ok: boolean
      data: {
        replayed?: boolean
        school: { id: string; status: string }
        principal: { id: string }
        tempPassword?: string
        replayNote?: string
        invitation?: { state: string }
      }
    }
    expect(retryJson.ok).toBe(true)
    expect(retryJson.data.replayed).toBe(true)
    expect(retryJson.data.school.id).toBe(schoolId)
    expect(retryJson.data.principal.id).toBe(principalId)
    // The one-time credential is NEVER re-surfaced on a replay.
    expect(retryJson.data.tempPassword).toBeUndefined()
    expect(retryJson.data.replayNote).toBeTruthy()

    // Exactly ONE school and ONE principal row — no duplicates.
    expect(await db.school.count({ where: { slug: body.slug } })).toBe(1)
    expect(await db.user.count({ where: { email: body.principalEmail } })).toBe(1)

    // The replay itself is audited.
    const replayAudit = await db.platformAuditLog.findFirst({
      where: { schoolId, action: 'platform.school.provision_replayed' },
    })
    expect(replayAudit).not.toBeNull()
  }, T)

  test('retry after ACTIVATION is an honest 409 (the PENDING replay window is closed)', async () => {
    const body = provisionBody()
    const first = await provision(rootToken, body)
    expect(first.status).toBe(200)
    const schoolId = ((await first.json()) as { data: { school: { id: string } } }).data.school.id
    cleanup.push(() => purgeSchool(schoolId))

    const act = await activate(rootToken, schoolId)
    expect(act.status).toBe(200)

    const retry = await provision(rootToken, body)
    expect(retry.status).toBe(409)
  }, T)

  test('retry with a DIFFERENT payload on the same slug is a 409, not a replay', async () => {
    const body = provisionBody()
    const first = await provision(rootToken, body)
    expect(first.status).toBe(200)
    const schoolId = ((await first.json()) as { data: { school: { id: string } } }).data.school.id
    cleanup.push(() => purgeSchool(schoolId))

    const retry = await provision(rootToken, { ...body, code: `RL${randomBytes(4).toString('hex').toUpperCase()}` })
    expect(retry.status).toBe(409)
  }, T)

  test('retry by a DIFFERENT admin is a 409 (replay is admin-scoped via the audit trail)', async () => {
    const body = provisionBody()
    const first = await provision(rootToken, body)
    expect(first.status).toBe(200)
    const schoolId = ((await first.json()) as { data: { school: { id: string } } }).data.school.id
    cleanup.push(() => purgeSchool(schoolId))

    // A second admin (the seeded ops account) granted schools.provision
    // ad hoc + a directly-minted platform session (boundary test — the
    // login path is not what is under test here).
    const ops = await db.platformAdmin.findUnique({ where: { email: OPS_EMAIL } })
    expect(ops).not.toBeNull()
    await db.platformPermission.create({
      data: { adminId: ops!.id, key: 'schools.provision' },
    })
    const opsToken = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: ops!.id, tokenHash: hashSessionToken(opsToken), expiresAt: new Date(Date.now() + 600_000) },
    })
    cleanup.push(() =>
      (async () => {
        await db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(opsToken) } })
        await db.platformPermission.deleteMany({ where: { adminId: ops!.id, key: 'schools.provision' } })
      })(),
    )

    const retry = await provision(opsToken, body)
    expect(retry.status).toBe(409)
  }, T)
})

// ─── principal invite + recovery ────────────────────────────────────────────

describe('PHASE 3 · principal invite delivery + failure recovery', () => {
  test('invite email lands (dev-log transport): EmailDelivery row + honest response state', async () => {
    // Generated password (no principalPassword in the body) → the email
    // carries the one-time credential.
    const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
    const body = provisionBody({
      slug: `reliab-${suffix}`,
      principalEmail: `principal-${suffix}@reliab.test`,
      principalPassword: undefined,
    })
    delete (body as Record<string, unknown>).principalPassword
    const res = await provision(rootToken, body)
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: { school: { id: string }; principal: { id: string }; tempPassword?: string; invitation?: { state: string; transport?: string } }
    }
    const schoolId = json.data.school.id
    const principalId = json.data.principal.id
    cleanup.push(() => purgeSchool(schoolId))

    // The generated one-time credential was surfaced ONCE in the response.
    expect(json.data.tempPassword).toBeTruthy()
    // The honest delivery state came back (dev-log transport = SENT).
    expect(json.data.invitation?.state).toBe('SENT')
    expect(json.data.invitation?.transport).toBe('dev-log')

    // The EmailDelivery audit row exists, is tenant-scoped, and carries
    // recipient+template ONLY (the schema has no body column — the
    // password cannot be persisted by construction).
    const row = await db.emailDelivery.findUnique({
      where: { dedupeKey: `principal-invite:${principalId}` },
    })
    expect(row).not.toBeNull()
    expect(row!.template).toBe('principal-invite')
    expect(row!.recipient).toBe(body.principalEmail)
    expect(row!.schoolId).toBe(schoolId)
    expect(['SENT', 'QUEUED']).toContain(row!.status)
  }, T)

  test('FAILED invite delivery is surfaced honestly and never reports READY — then recovers via re-issue', async () => {
    const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
    const body = provisionBody({
      slug: `reliab-${suffix}`,
      principalEmail: `principal-${suffix}@reliab.test`,
    })
    const res = await provision(rootToken, body)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { school: { id: string }; principal: { id: string } } }
    const schoolId = json.data.school.id
    const principalId = json.data.principal.id
    cleanup.push(() => purgeSchool(schoolId))

    // Simulate the delivery failure (the pipeline would write exactly
    // this shape on a provider-config outage): row → FAILED with a
    // machine-parseable [error-class] tag.
    await db.emailDelivery.update({
      where: { dedupeKey: `principal-invite:${principalId}` },
      data: { status: 'FAILED', lastError: '[provider-config] EMAIL_PROVIDER=resend but RESEND_API_KEY is not set' },
    })

    // While PENDING the state is PENDING_ACTIVATION (lifecycle first).
    const dos1 = await dossier(rootToken, schoolId)
    expect(dos1.data?.provisioning?.state).toBe('PENDING_ACTIVATION')

    // Activate → the honest state becomes REQUIRES_ATTENTION (the
    // principal's delivery failed and the bootstrap credential is still
    // pending) — NOT READY, never fabricated.
    const act = await activate(rootToken, schoolId)
    expect(act.status).toBe(200)
    const dos2 = await dossier(rootToken, schoolId)
    expect(dos2.data?.provisioning?.state).toBe('REQUIRES_ATTENTION')
    expect(dos2.data?.access.principal?.invitation?.state).toBe('FAILED')
    expect(dos2.data?.access.principal?.invitation?.errorClass).toBe('provider-config')

    // RECOVERY: re-issue the credential → a NEW one-time password (shown
    // once), a NEW invite email row (dev-log → SENT), audited — and the
    // dossier returns to the honest lifecycle vocabulary.
    const re = await reissue(rootToken, schoolId)
    expect(re.status).toBe(200)
    const reJson = (await re.json()) as {
      data: { tempPassword: string; invitation?: { state: string }; principal: { email: string } }
    }
    expect(reJson.data.tempPassword).toBeTruthy()
    expect(reJson.data.invitation?.state).toBe('SENT')
    expect(reJson.data.principal.email).toBe(body.principalEmail)

    const reRow = await db.emailDelivery.findFirst({
      where: { dedupeKey: { startsWith: `principal-invite:${principalId}:reissue:` } },
    })
    expect(reRow).not.toBeNull()
    expect(reRow!.status).toBe('SENT')

    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId, action: 'platform.school.credential_reissued' },
    })
    expect(audit).not.toBeNull()
    // The audit metadata NEVER contains the password.
    expect(audit?.metadata ?? '').not.toContain(reJson.data.tempPassword)

    // Delivery is healthy now; the school is ACTIVE with (probably)
    // incomplete setup — an honest NEEDS_SETUP/REQUIRES_ATTENTION/READY,
    // and the invitation state reads from the LATEST row (SENT).
    const dos3 = await dossier(rootToken, schoolId)
    expect(dos3.data?.access.principal?.invitation?.state).toBe('SENT')
    expect(dos3.data?.provisioning?.state).not.toBe('REQUIRES_ATTENTION')
  }, T)
})

// ─── credential re-issue semantics ──────────────────────────────────────────

describe('PHASE 3 · credential re-issue', () => {
  test('re-issue invalidates the old bootstrap password and admits the new one', async () => {
    const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
    const body = provisionBody({
      slug: `reliab-${suffix}`,
      principalEmail: `principal-${suffix}@reliab.test`,
      principalPassword: 'O1dBoot!5x-value',
    })
    const res = await provision(rootToken, body)
    expect(res.status).toBe(200)
    const schoolId = ((await res.json()) as { data: { school: { id: string } } }).data.school.id
    cleanup.push(() => purgeSchool(schoolId))

    expect((await activate(rootToken, schoolId)).status).toBe(200)

    // Old bootstrap password works pre-reissue.
    await resetLoginBuckets([body.principalEmail])
    const before = await schoolLogin(body.principalEmail, 'O1dBoot!5x-value')
    expect(before.status).toBe(200)

    // Re-issue → new one-time credential.
    const re = await reissue(rootToken, schoolId)
    expect(re.status).toBe(200)
    const reJson = (await re.json()) as { data: { tempPassword: string } }
    const newPassword = reJson.data.tempPassword
    expect(newPassword).toBeTruthy()
    expect(newPassword).not.toBe('O1dBoot!5x-value')

    // The OLD bootstrap password stops working immediately.
    await resetLoginBuckets([body.principalEmail])
    const oldLogin = await schoolLogin(body.principalEmail, 'O1dBoot!5x-value')
    expect(oldLogin.status).toBe(401)

    // The NEW one-time password admits the principal (forced change still armed).
    await resetLoginBuckets([body.principalEmail])
    const newLogin = await schoolLogin(body.principalEmail, newPassword)
    expect(newLogin.status).toBe(200)
    const loginJson = (await newLogin.json()) as { data?: { mustChangePassword?: boolean } }
    expect(loginJson.data?.mustChangePassword).toBe(true)
  }, T)

  test('re-issue is REFUSED once the principal owns their credential (no takeover vector)', async () => {
    const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
    const body = provisionBody({
      slug: `reliab-${suffix}`,
      principalEmail: `principal-${suffix}@reliab.test`,
      principalPassword: 'Boot!7x-own-me',
    })
    const res = await provision(rootToken, body)
    expect(res.status).toBe(200)
    const schoolId = ((await res.json()) as { data: { school: { id: string } } }).data.school.id
    cleanup.push(() => purgeSchool(schoolId))
    expect((await activate(rootToken, schoolId)).status).toBe(200)

    // Principal signs in (dev bearer token) and completes the forced
    // password change → the credential becomes OWNED.
    await resetLoginBuckets([body.principalEmail])
    const login = await schoolLogin(body.principalEmail, 'Boot!7x-own-me')
    expect(login.status).toBe(200)
    const loginJson = (await login.json()) as { data?: { sessionToken?: string } }
    const principalToken = loginJson.data?.sessionToken
    expect(principalToken).toBeTruthy()
    cleanup.push(() =>
      db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken ?? 'x') } }),
    )

    const changed = await fetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': RUN_IP,
        Authorization: `Bearer ${principalToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'Boot!7x-own-me',
        newPassword: 'My0wn!9z-password',
        confirmPassword: 'My0wn!9z-password',
      }),
    })
    expect(changed.status).toBe(200)

    // Re-issue against an OWNED credential → 409 CONFLICT, and the
    // password was NOT rotated.
    const re = await reissue(rootToken, schoolId)
    expect(re.status).toBe(409)
    const reJson = (await re.json()) as { ok: boolean; code?: string }
    expect(reJson.ok).toBe(false)
    expect(reJson.code).toBe('CONFLICT')

    // The principal's OWNED password still works.
    await resetLoginBuckets([body.principalEmail])
    const owned = await schoolLogin(body.principalEmail, 'My0wn!9z-password')
    expect(owned.status).toBe(200)
  }, T)
})

// ─── boundary + legacy-route removal ────────────────────────────────────────

describe('PHASE 3 · boundary + dead-route removal', () => {
  test('a SCHOOL session cannot re-issue credentials (disjoint token spaces)', async () => {
    const demoPrincipal = await db.user.findFirst({
      where: { role: 'PRINCIPAL', school: { slug: 'hawkings-prithvipur' } },
      select: { id: true },
    })
    expect(demoPrincipal).not.toBeNull()
    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: { userId: demoPrincipal!.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 600_000) },
    })
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))

    const res = await fetch(`${BASE}/api/platform/schools/hawkings/reissue-credential`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('an anonymous caller cannot re-issue credentials', async () => {
    const res = await fetch(`${BASE}/api/platform/schools/anything/reissue-credential`, { method: 'POST' })
    expect(res.status).toBe(401)
  }, T)

  test('the legacy school-plane collection route is GONE (404, not a divergent factory)', async () => {
    const post = await fetch(`${BASE}/api/schools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(post.status).toBe(404)
    const get = await fetch(`${BASE}/api/schools`)
    expect(get.status).toBe(404)
    // The live subroute the middleware probes is untouched.
    const pub = await fetch(`${BASE}/api/schools/public?slug=hawkings-prithvipur`)
    expect(pub.status).toBe(200)
  }, T)

  test('invalid provision input is rejected with useful, field-specific errors', async () => {
    // Zod body-validation failures surface as VALIDATION_FAILED (HTTP 422
    // in the platform error taxonomy) with the offending field in the
    // message.
    const badSlug = await provision(rootToken, provisionBody({ slug: 'Bad Slug!' }))
    expect(badSlug.status).toBe(422)
    const badSlugJson = (await badSlug.json()) as { ok: boolean; code: string; error?: string }
    expect(badSlugJson.ok).toBe(false)
    expect(badSlugJson.code).toBe('VALIDATION_FAILED')
    expect((badSlugJson.error ?? '').toLowerCase()).toContain('slug')

    const missingName = await provision(rootToken, { slug: 'missing-name-test' })
    expect(missingName.status).toBe(422)
  }, T)
})
