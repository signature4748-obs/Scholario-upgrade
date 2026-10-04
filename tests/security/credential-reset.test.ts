/**
 * CREDENTIAL-RESET — the CRITICAL audit fix's dedicated contract tests.
 *
 * Mission: production must never run on seeded/default credentials.
 * Flow under test:
 *   1. Every provisioned principal starts with mustChangePassword=true
 *      (login works; business APIs reject with PASSWORD_CHANGE_REQUIRED).
 *   2. Completing /api/auth/change-password clears the flag, records
 *      passwordChangedAt and audits PASSWORD_CHANGED.
 *   3. The Super Admin reset endpoint (schools.manage + step-up):
 *      single-user mode retires the current password, surfaces a ONE-TIME
 *      temp password, re-arms mustChangePassword, revokes sessions, and
 *      audits BOTH planes (PlatformAuditLog + school ActivityLog).
 *   4. Bulk mode requires the typed school-name confirmation and resets
 *      the whole roster.
 *   5. The migration invariant: accounts that never changed their
 *      password would be flagged (reprised here by planting the flag on
 *      a fixture account directly — the migration's data step).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000
const T_COLD = 90_000 // first test pays the dev-server route compilation
const MARKER = randomBytes(4).toString('hex')
// Fresh random IP per login call (the limiter is per-IP; the suite logs
// in ~10 times, which would exhaust the 8/15min shared bucket on any
// single address).
function freshRunIp(): string {
  return `10.231.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
}

const ROOT_EMAIL = 'admin@scholario.cloud'

let rootToken = ''
let schoolId = ''
let principalEmail = ''
let principalPassword = ''
let principalId = ''

const cleanup: Array<() => Promise<unknown>> = []

async function platformRootLogin(): Promise<string> {
  const mod = await import('../../src/lib/platform/totp')
  const code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, totpCode: code }),
  })
  const body = (await res.json()) as { ok?: boolean; data?: { sessionToken?: string } }
  if (res.status === 429 || !body?.data?.sessionToken) {
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('root platform admin missing (run the canonical seeds)')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    return token
  }
  return body.data.sessionToken
}

function platform(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-platform-token': rootToken, 'content-type': 'application/json' },
  })
}

async function login(email: string, password: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshRunIp() },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

beforeAll(async () => {
  rootToken = await platformRootLogin()

  // Provision + activate a dedicated throwaway tenant (the REAL path).
  const email = `credreset-principal-${MARKER}@provision.test`
  const password = 'CredReset!8c-bootstrap'
  const res = await platform('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: `Credential Reset School ${MARKER}`,
      slug: `credreset-${MARKER}`,
      code: `CR${randomBytes(5).toString('hex').toUpperCase()}`,
      plan: 'STANDARD',
      principalName: 'Reset Principal',
      principalEmail: email,
      principalPassword: password,
    }),
  })
  if (res.status !== 200) throw new Error(`provision failed: ${res.status}`)
  const json = (await res.json()) as { data: { school: { id: string }; principal: { id: string } } }
  schoolId = json.data.school.id
  principalId = json.data.principal.id
  principalEmail = email
  principalPassword = password
  const act = await platform(`/api/platform/schools/${schoolId}/activate`, { method: 'POST' })
  if (act.status !== 200) throw new Error(`activate failed: ${act.status}`)

  cleanup.push(async () => {
    await db.session.deleteMany({ where: { user: { schoolId } } }).catch(() => {})
    await db.school.delete({ where: { id: schoolId } }).catch(() => {})
  })
}, T)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
})

describe('CREDENTIAL-RESET · forced first-password-change (provisioned principals)', () => {
  test('login succeeds and carries mustChangePassword=true; business APIs reject the bootstrap session', async () => {
    await resetLoginBuckets([principalEmail])
    const { status, body } = await login(principalEmail, principalPassword)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.mustChangePassword).toBe(true)

    // The exempt identity surface still works.
    const token = body.data.sessionToken as string
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { data?: { user?: { mustChangePassword?: boolean } } }
    expect(meBody.data?.user?.mustChangePassword).toBe(true)

    // A business API rejects with the typed code (the authority).
    const dash = await fetch(`${BASE}/api/dashboard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'SCHOOL' }),
    })
    expect(dash.status).toBe(403)
    const dashBody = (await dash.json().catch(() => ({}))) as { code?: string }
    expect(dashBody.code).toBe('PASSWORD_CHANGE_REQUIRED')
  }, T_COLD)

  test('completing the change clears the flag, records passwordChangedAt, audits, unlocks business APIs', async () => {
    await resetLoginBuckets([principalEmail])
    const { body } = await login(principalEmail, principalPassword)
    const token = body.data.sessionToken as string

    const newPassword = 'CredReset!9d-own-password'
    const change = await fetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: principalPassword,
        newPassword,
        confirmPassword: newPassword,
      }),
    })
    expect(change.status).toBe(200)

    const user = await db.user.findUnique({ where: { id: principalId } })
    expect(user?.mustChangePassword).toBe(false)
    expect(user?.passwordChangedAt).not.toBeNull()

    const audit = await db.activityLog.findFirst({
      where: { userId: principalId, action: 'PASSWORD_CHANGED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(String(audit?.detail)).toContain('forced first-password-change')

    // The OLD (bootstrap) password is dead.
    await resetLoginBuckets([principalEmail])
    const old = await login(principalEmail, principalPassword)
    expect(old.status).toBe(401)

    // The NEW credential runs the tenant normally.
    await resetLoginBuckets([principalEmail])
    const fresh = await login(principalEmail, newPassword)
    expect(fresh.status).toBe(200)
    expect(fresh.body.data.mustChangePassword).toBe(false)
    const dash = await fetch(`${BASE}/api/dashboard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fresh.body.data.sessionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'SCHOOL' }),
    })
    expect(dash.status).toBe(200)
    principalPassword = newPassword
  }, T)
})

describe('CREDENTIAL-RESET · Super Admin reset endpoint (single user)', () => {
  test('reset retires the current password, re-arms mustChange, revokes sessions, surfaces a one-time temp password', async () => {
    // A live session for the principal (must die with the reset).
    await resetLoginBuckets([principalEmail])
    const { body } = await login(principalEmail, principalPassword)
    const liveToken = body.data.sessionToken as string

    const res = await platform(`/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      body: JSON.stringify({
        email: principalEmail,
        reason: 'credential-reset contract test: single-account rotation',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        mode: string
        resetAccounts: number
        credentials: Array<{ email: string; role: string; tempPassword: string }>
      }
    }
    expect(json.data.mode).toBe('USER')
    expect(json.data.resetAccounts).toBe(1)
    expect(json.data.credentials[0].email).toBe(principalEmail)
    const tempPassword = json.data.credentials[0].tempPassword
    expect(typeof tempPassword).toBe('string')
    expect(tempPassword.length).toBeGreaterThanOrEqual(12)

    // Platform audit row (the authority trail) + school-visible marker.
    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId, action: 'platform.school.credentials_reset' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.reason).toContain('single-account rotation')
    const schoolLog = await db.activityLog.findFirst({
      where: { schoolId, action: 'PLATFORM_CREDENTIAL_RESET' },
      orderBy: { createdAt: 'desc' },
    })
    expect(schoolLog).not.toBeNull()

    // The pre-reset session is revoked (the token no longer resolves).
    const dead = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${liveToken}` } })
    expect(dead.status).toBe(401)

    // The previous password no longer authenticates.
    await resetLoginBuckets([principalEmail])
    const old = await login(principalEmail, principalPassword)
    expect(old.status).toBe(401)

    // The temp password signs in — straight into the forced-change state.
    await resetLoginBuckets([principalEmail])
    const temp = await login(principalEmail, tempPassword)
    expect(temp.status).toBe(200)
    expect(temp.body.data.mustChangePassword).toBe(true)
    principalPassword = tempPassword
  }, T)

  test('foreign-tenant email → 404 (no existence oracle)', async () => {
    const res = await platform(`/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      body: JSON.stringify({
        email: 'principal@greenvalley.test', // belongs to ANOTHER school
        reason: 'credential-reset contract test: cross-tenant probe',
      }),
    })
    expect(res.status).toBe(404)
  }, T)

  test('unauthenticated and school-session callers cannot reach the endpoint', async () => {
    const anon = await fetch(`${BASE}/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: principalEmail, reason: 'anonymous probe of reset endpoint' }),
    })
    expect(anon.status).toBe(401)

    // A SCHOOL session must never satisfy the platform pipeline.
    await resetLoginBuckets([principalEmail])
    const { body } = await login(principalEmail, principalPassword)
    const schoolSession = body.data.sessionToken as string
    const hijack = await fetch(`${BASE}/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${schoolSession}` },
      body: JSON.stringify({ email: principalEmail, reason: 'school-session probe of platform route' }),
    })
    expect(hijack.status).toBe(401)
  }, T)
})

describe('CREDENTIAL-RESET · Super Admin reset endpoint (bulk)', () => {
  test('bulk without the typed school-name confirmation → 422', async () => {
    const res = await platform(`/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'bulk reset attempt without confirmation' }),
    })
    expect(res.status).toBe(422)
  }, T)

  test('bulk with confirmation resets every account and audits the roster', async () => {
    const school = await db.school.findUniqueOrThrow({ where: { id: schoolId } })
    const res = await platform(`/api/platform/schools/${schoolId}/access/reset-credentials`, {
      method: 'POST',
      body: JSON.stringify({
        reason: 'credential-reset contract test: whole-roster rotation',
        confirmName: school.name,
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: { mode: string; resetAccounts: number; credentials: Array<{ email: string }> }
    }
    expect(json.data.mode).toBe('SCHOOL_BULK')
    expect(json.data.resetAccounts).toBeGreaterThanOrEqual(1)
    expect(json.data.credentials.some((c) => c.email === principalEmail)).toBe(true)
    // Keep the journey's notion of the principal's CURRENT credential in
    // step with the bulk handoff (the one-time temp password).
    const mine = json.data.credentials.find((c) => c.email === principalEmail)
    if (mine) principalPassword = (mine as { tempPassword?: string }).tempPassword ?? principalPassword

    // The flag is re-armed on every account.
    const rows = await db.user.findMany({ where: { schoolId }, select: { mustChangePassword: true } })
    expect(rows.length).toBe(json.data.resetAccounts)
    expect(rows.every((r) => r.mustChangePassword)).toBe(true)
  }, T)
})

describe('CREDENTIAL-RESET · migration invariant (never-changed accounts are flagged)', () => {
  test('an account planted with passwordChangedAt null + the migration flag is gated at login', async () => {
    // Reprise the migration's data step on the fixture principal: the
    // flag alone (whatever set it) enforces the forced change.
    await db.user.update({
      where: { id: principalId },
      data: { mustChangePassword: true, passwordChangedAt: null },
    })
    await resetLoginBuckets([principalEmail])
    const { status, body } = await login(principalEmail, principalPassword)
    expect(status).toBe(200)
    expect(body.data.mustChangePassword).toBe(true)
    const token = body.data.sessionToken as string
    const dash = await fetch(`${BASE}/api/dashboard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'SCHOOL' }),
    })
    expect(dash.status).toBe(403)
    expect(((await dash.json().catch(() => ({}))) as { code?: string }).code).toBe('PASSWORD_CHANGE_REQUIRED')
  }, T)
})
