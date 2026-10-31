/**
 * PHASE 2 — SUPER ADMIN SCHOOL SETUP WIZARD — end-to-end acceptance.
 *
 * THE "FIRST 30 MINUTES OF A NEW SCHOOL" JOURNEY (the Phase 1 plan's
 * acceptance goal), now through the guided wizard:
 *
 *   1. Platform admin provisions a bare school (PENDING — nobody signs in).
 *   2. The wizard honestly reports what remains (strict checklist NOT ok).
 *   3. STRICT activation is refused until the required sections are truly
 *      persisted (identity + academic + principal).
 *   4. The operator saves the identity block and bootstraps the academic
 *      structure through the wizard's audited routes.
 *   5. Strict activation now succeeds (server-revalidated, audited).
 *   6. HANDOVER: the principal signs in with the one-time bootstrap
 *      credential, is forced to set a personal password, and the school
 *      plane responds — the Super Admin never touches routine work.
 *   7. Overview truth: the detail dossier reflects the activation and the
 *      readiness progression (the SAME document both planes share).
 *
 * Live HTTP against the dev server; the REAL login + forced-change APIs.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET } from '../helpers/credentials'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const T = 60_000

const MARKER = randomBytes(4).toString('hex')
const ROOT_EMAIL = 'admin@scholario.cloud'
const PRINCIPAL_EMAIL = `wizard-e2e-principal-${MARKER}@provision.test`
const PRINCIPAL_PASSWORD = 'WizardE2E!8c-2026'
const SLUG = `wizard-e2e-${MARKER}`

let rootToken = ''
let schoolId = ''
let principalToken = ''
const cleanup: Array<() => Promise<unknown>> = []

function platform(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': rootToken, ...(init.headers ?? {}) },
  })
}

async function okData<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: T }
  expect(body.ok).toBe(true)
  return body.data
}

beforeAll(async () => {
  // The REAL platform login (TOTP fixture path, like the acceptance suite).
  const mod = await import('../../src/lib/platform/totp')
  const code = mod.totpAt(PLATFORM_ROOT_TOTP_SECRET)
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD, totpCode: code }),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { sessionToken?: string } } | null
  if (!body?.data?.sessionToken) {
    const admin = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
    if (!admin) throw new Error('root platform admin missing (run the canonical seeds)')
    const token = randomBytes(32).toString('hex')
    await db.platformAdminSession.create({
      data: { adminId: admin.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    cleanup.push(() => db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }))
    rootToken = token
  } else {
    rootToken = body.data.sessionToken
  }
  await resetLoginBuckets([ROOT_EMAIL, PRINCIPAL_EMAIL])
}, 90_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  if (schoolId) {
    await db.session.deleteMany({ where: { user: { schoolId } } }).catch(() => {})
    await db.user.deleteMany({ where: { schoolId } }).catch(() => {})
    await db.platformAuditLog.deleteMany({ where: { schoolId } }).catch(() => {})
    await db.school.delete({ where: { id: schoolId } }).catch(() => {})
  }
  await db.$disconnect()
})

describe('§PHASE 2 · the guided setup journey', () => {
  test('STEP 1 — provision a bare school (PENDING, honest zero progress)', async () => {
    const data = await okData<{ school: { id: string; status: string } }>(
      await platform('/api/platform/schools', {
        method: 'POST',
        body: JSON.stringify({
          name: `Wizard E2E School ${MARKER}`,
          slug: SLUG,
          principalName: 'Wizard E2E Principal',
          principalEmail: PRINCIPAL_EMAIL,
          principalPassword: PRINCIPAL_PASSWORD,
        }),
      }),
    )
    schoolId = data.school.id
    expect(data.school.status).toBe('PENDING')

    const w = await okData<{
      steps: Array<{ id: string; status: string }>
      activation: { wizardChecklistOk: boolean; wizardMissing: Array<{ id: string }> }
    }>(await platform(`/api/platform/schools/${schoolId}/setup-wizard`))
    const byId = new Map(w.steps.map((s) => [s.id, s.status]))
    expect(byId.get('principal')).toBe('completed')
    expect(byId.get('identity')).toBe('not_started')
    expect(w.activation.wizardChecklistOk).toBe(false)
  }, T)

  test('STEP 2 — strict activation REFUSED before the required sections are persisted', async () => {
    const res = await platform(`/api/platform/schools/${schoolId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ requireComplete: true }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Cannot activate yet')
    expect((await db.school.findUnique({ where: { id: schoolId } }))?.status).toBe('PENDING')
  }, T)

  test('STEP 3 — the operator saves identity + academics through the wizard routes', async () => {
    await okData<{ updatedFields: string[] }>(
      await platform(`/api/platform/schools/${schoolId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          address: '1 Journey Way',
          city: 'Kanpur',
          phone: '+91 98765 00000',
          email: 'office@wizarde2e.test',
        }),
      }),
    )
    await okData<{ classesCreated: number; subjectsCreated: number }>(
      await platform(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
        method: 'POST',
        body: JSON.stringify({
          academicYear: '2026-2027',
          classes: [{ name: 'Class 1', sections: ['A'] }],
          subjects: ['English', 'Mathematics'],
        }),
      }),
    )
    const w = await okData<{
      steps: Array<{ id: string; status: string }>
      activation: { wizardChecklistOk: boolean }
      readiness: { summary: { requiredDone: number } }
    }>(await platform(`/api/platform/schools/${schoolId}/setup-wizard`))
    const byId = new Map(w.steps.map((s) => [s.id, s.status]))
    expect(byId.get('identity')).toBe('completed')
    expect(byId.get('academic')).toBe('completed')
    expect(w.activation.wizardChecklistOk).toBe(true)
    expect(w.readiness.summary.requiredDone).toBeGreaterThanOrEqual(3)
  }, T)

  test('STEP 4 — strict activation SUCCEEDS (server-revalidated + audited)', async () => {
    const data = await okData<{ status: string; activation: { wizardChecklistOk: boolean; strict: boolean } }>(
      await platform(`/api/platform/schools/${schoolId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ requireComplete: true }),
      }),
    )
    expect(data.status).toBe('ACTIVE')
    expect(data.activation.strict).toBe(true)
    expect((await db.school.findUnique({ where: { id: schoolId } }))?.status).toBe('ACTIVE')
    const audit = await db.platformAuditLog.findFirst({
      where: { schoolId, action: 'platform.school.activated' },
    })
    expect(audit).not.toBeNull()
  }, T)

  test('STEP 5 — HANDOVER: the principal signs in and owns the school plane', async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.77.0.9' },
      body: JSON.stringify({ email: PRINCIPAL_EMAIL, password: PRINCIPAL_PASSWORD }),
    })
    expect(login.status).toBe(200)
    const body = (await login.json()) as {
      ok: boolean
      data?: { sessionToken?: string; mustChangePassword?: boolean }
    }
    expect(body.ok).toBe(true)
    principalToken = body.data?.sessionToken ?? ''
    expect(principalToken).toBeTruthy()
    cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))
    expect(body.data?.mustChangePassword).toBe(true)

    // Forced first-password-change (the established credential contract).
    const newPassword = 'WizardE2EPrincipal!7d-own'
    const change = await fetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${principalToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: PRINCIPAL_PASSWORD, newPassword, confirmPassword: newPassword }),
    })
    expect(change.status).toBe(200)
    const changed = (await change.json()) as { data?: { sessionToken?: string } }
    if (changed.data?.sessionToken) {
      principalToken = changed.data.sessionToken
      cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))
    }

    // The school plane responds to its owner (the readiness document
    // through the SCHOOL transport — the same shared engine).
    const readiness = await fetch(`${BASE}/api/school/setup-readiness`, {
      headers: { Authorization: `Bearer ${principalToken}` },
    })
    expect(readiness.status).toBe(200)
    const rBody = (await readiness.json()) as { data: { school: { id: string }; summary: { requiredDone: number } } }
    expect(rBody.data.school.id).toBe(schoolId)
    expect(rBody.data.summary.requiredDone).toBeGreaterThanOrEqual(3)
  }, T)

  test('STEP 6 — Overview truth: the dossier reflects activation + readiness progression', async () => {
    const data = await okData<{
      school: { status: string }
      provisioning: { state: string; readiness: { requiredDone: number; requiredTotal: number } | null }
    }>(await platform(`/api/platform/schools/${schoolId}`))
    expect(data.school.status).toBe('ACTIVE')
    expect(data.provisioning.readiness?.requiredDone).toBeGreaterThanOrEqual(3)
    expect(data.provisioning.readiness?.requiredTotal).toBe(5)
  }, T)
})
