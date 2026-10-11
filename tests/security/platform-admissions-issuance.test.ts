/**
 * BATCH 1 / WORKSTREAM C — platform admissions-issuance feature control
 * (GET/PATCH /api/platform/schools/[id]/admissions-issuance).
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. FAIL-CLOSED DEFAULT — no override anywhere ⇒ enabled=false, source
 *      'default'. The flag never fails open.
 *   2. AUDITED TRANSITIONS — every successful PATCH writes exactly one
 *      PlatformAuditLog row: actor (root admin), school, previous→next
 *      state, readiness summary. No sensitive data in the row.
 *   3. SCOPING — the PATCH touches ONLY the selected school's
 *      featureFlags (other keys preserved verbatim, other schools
 *      untouched — cross-school isolation).
 *   4. AUTHORIZATION — platform-only route: anonymous and SCHOOL
 *      sessions are refused (401); non-root admins WITHOUT
 *      schools.manage are forbidden from PATCH (403) but may GET.
 *      (The step-up policy rides the shared withPlatform convention:
 *      dormant while platform TOTP is stood down, re-arms with MFA.)
 *   5. VALIDATION — the body must be exactly { enabled: boolean };
 *      anything else is 422 INVALID_INPUT. Unknown school → 404.
 *   6. READINESS — the control reports the honest state (academic year,
 *      published fee structures) and never silently claims "ready";
 *      enabling an unconfigured school is allowed but recorded as
 *      such (the workflow itself fails closed at runtime).
 *   7. DOWNSTREAM EFFECT — after enabling, the SCHOOL-plane flag
 *      resolution (/api/admissions/config) actually turns on for that
 *      school's principal (and only that school's).
 *
 * Live HTTP against the dev server, platform root admin (MFA login via
 * the seeded TOTP secret — same conventions as platform-provisioning).
 * Fixture-school flags are captured in beforeAll and restored in
 * afterAll; every extra row (marker school, limited admin + session,
 * principal session, audit rows of this action) is marker-tagged and
 * removed. The demo corpus is left byte-identical.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken, hashPassword } from '@/lib/auth'
import { PLATFORM_ROOT_PASSWORD, PLATFORM_ROOT_TOTP_SECRET } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000
const MARKER = randomBytes(4).toString('hex')

const ROOT_EMAIL = 'admin@scholario.cloud'
const AUDIT_ACTION = 'platform.school.admissions_issuance_updated'

let rootToken = ''

let schoolA = { id: '', originalFlags: '', principalUserId: '' }
let schoolB = { id: '', originalFlags: '' }
let markerSchoolId = ''
let limitedAdminId = ''
let limitedAdminToken = ''
let principalToken = '' // school-A direct session (erp_session transport)

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
    // ONLY the login limiter — same convention as platform-provisioning).
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

const platformHeaders = (token: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-platform-token': token,
})

async function getIssuance(token: string, schoolId: string): Promise<Response> {
  return fetch(`${BASE}/api/platform/schools/${schoolId}/admissions-issuance`, {
    headers: platformHeaders(token),
  })
}

async function patchIssuance(
  token: string,
  schoolId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${BASE}/api/platform/schools/${schoolId}/admissions-issuance`, {
    method: 'PATCH',
    headers: platformHeaders(token),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

interface IssuanceState {
  ok: boolean
  data?: {
    enabled: boolean
    source: 'school' | 'platform' | 'default'
    readiness: {
      academicYear: string | null
      academicYearSet: boolean
      publishedFeeStructures: number
      ready: boolean
    }
  }
}

beforeAll(async () => {
  rootToken = await platformRootLogin()

  // Fixture schools — flags captured for exact-restore.
  const a = (await db.school.findFirst({ where: { isDemo: true } }))!
  const b = (await db.school.findFirst({ where: { slug: 'green-valley' } }))!
  schoolA = { id: a.id, originalFlags: a.featureFlags, principalUserId: '' }
  schoolB = { id: b.id, originalFlags: b.featureFlags }

  // School-A principal (direct session row — the config-route consumer).
  const principal = await db.user.findFirst({
    where: { role: 'PRINCIPAL', school: { id: schoolA.id } },
    select: { id: true },
  })
  if (!principal) throw new Error('school-A principal missing (seed corpus)')
  schoolA.principalUserId = principal.id
  principalToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: principal.id, tokenHash: hashSessionToken(principalToken), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))

  // MARKER school — no academic year, no fees: the readiness probe.
  const marker = await db.school.create({
    data: {
      name: `AdmCtl Probe ${MARKER}`,
      slug: `admctl-${MARKER}`,
      code: `AC${MARKER.slice(0, 6).toUpperCase()}`,
      plan: 'FREE',
      status: 'ACTIVE',
      featureFlags: '{}',
    },
  })
  markerSchoolId = marker.id
  cleanup.push(() => db.school.delete({ where: { id: markerSchoolId } }))

  // MARKER limited platform admin — schools.read ONLY (no schools.manage).
  const limited = await db.platformAdmin.create({
    data: {
      email: `admctl-${MARKER}@scholario.test`,
      passwordHash: hashPassword(`admctl-${MARKER}-pass-123`),
      name: `AdmCtl Limited ${MARKER}`,
      status: 'ACTIVE',
      isRoot: false,
      totpSecret: 'JBSWY3DPEHPK3PXP', // syntactically valid base32; never used (direct session)
      isDemo: false,
    },
  })
  limitedAdminId = limited.id
  await db.platformPermission.create({ data: { adminId: limited.id, key: 'schools.read', granted: true } })
  limitedAdminToken = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: { adminId: limited.id, tokenHash: hashSessionToken(limitedAdminToken), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(() => db.platformAdmin.delete({ where: { id: limitedAdminId } })) // cascades permission+session rows

  cleanup.push(() =>
    db.platformAuditLog.deleteMany({ where: { action: AUDIT_ACTION, schoolId: { in: [schoolA.id, schoolB.id, markerSchoolId] } } }),
  )
}, 120_000)

afterAll(async () => {
  // Exact-restore the fixture schools' flags (byte-identical corpus).
  await db.school.update({ where: { id: schoolA.id }, data: { featureFlags: schoolA.originalFlags } })
  await db.school.update({ where: { id: schoolB.id }, data: { featureFlags: schoolB.originalFlags } })
  for (const fn of cleanup) await fn().catch(() => undefined)
})

// ─── GET: default state, readiness, boundaries ─────────────────────────────

describe('admissions-issuance · GET (schools.read)', () => {
  test(
    'fail-closed default: fixture school reports enabled=false, source=default, honest readiness',
    async () => {
      const res = await getIssuance(rootToken, schoolA.id)
      expect(res.status).toBe(200)
      const json = (await res.json()) as IssuanceState
      expect(json.ok).toBe(true)
      expect(json.data!.enabled).toBe(false)
      expect(json.data!.source).toBe('default')
      // Corpus fixture: year set (2026-2027), zero published structures.
      expect(json.data!.readiness.academicYearSet).toBe(true)
      expect(json.data!.readiness.publishedFeeStructures).toBe(0)
      expect(json.data!.readiness.ready).toBe(false)
    },
    T,
  )

  test(
    'readiness is honest on an unconfigured school: no year, no fee structures',
    async () => {
      const res = await getIssuance(rootToken, markerSchoolId)
      expect(res.status).toBe(200)
      const json = (await res.json()) as IssuanceState
      expect(json.data!.readiness.academicYearSet).toBe(false)
      expect(json.data!.readiness.academicYear).toBeNull()
      expect(json.data!.readiness.publishedFeeStructures).toBe(0)
      expect(json.data!.readiness.ready).toBe(false)
    },
    T,
  )

  test('unknown school → 404 RESOURCE_NOT_FOUND', async () => {
    const res = await getIssuance(rootToken, 'nonexistent-school-id')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.code).toBe('RESOURCE_NOT_FOUND')
  }, T)

  test('anonymous → 401 AUTH_REQUIRED', async () => {
    const res = await fetch(`${BASE}/api/platform/schools/${schoolA.id}/admissions-issuance`)
    expect(res.status).toBe(401)
  }, T)

  test(
    'a SCHOOL session (erp_session cookie) cannot read or patch the control',
    async () => {
      // The platform route reads ONLY the platform transports; a school
      // cookie is invisible to it.
      const get = await fetch(`${BASE}/api/platform/schools/${schoolA.id}/admissions-issuance`, {
        headers: { cookie: `erp_session=${principalToken}` },
      })
      expect(get.status).toBe(401)
      const patch = await fetch(`${BASE}/api/platform/schools/${schoolA.id}/admissions-issuance`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: `erp_session=${principalToken}` },
        body: JSON.stringify({ enabled: true }),
      })
      expect(patch.status).toBe(401)
      // And the school flag row is untouched.
      const row = await db.school.findUnique({ where: { id: schoolA.id }, select: { featureFlags: true } })
      expect(row!.featureFlags).toBe(schoolA.originalFlags)
    },
    T,
  )

  test('limited admin (schools.read only) CAN read', async () => {
    const res = await getIssuance(limitedAdminToken, schoolA.id)
    expect(res.status).toBe(200)
    const json = (await res.json()) as IssuanceState
    expect(json.data!.enabled).toBe(false)
  }, T)
})

// ─── PATCH: audited transitions, scoping, validation ───────────────────────

describe('admissions-issuance · PATCH (schools.manage)', () => {
  test(
    'enable: 200, school override stored, audit row written with previous→next + readiness',
    async () => {
      const res = await patchIssuance(rootToken, schoolA.id, { enabled: true })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { ok: boolean; data?: { enabled: boolean; previous: boolean; source: string } }
      expect(json.ok).toBe(true)
      expect(json.data!.enabled).toBe(true)
      expect(json.data!.previous).toBe(false)
      expect(json.data!.source).toBe('school')

      // DB truth: the override is stored on the school row.
      const row = await db.school.findUnique({ where: { id: schoolA.id }, select: { featureFlags: true } })
      expect(JSON.parse(row!.featureFlags)).toMatchObject({ admissionsServerIssuance: true })

      // Audit truth: exactly one row, right actor/school/transition.
      const audits = await db.platformAuditLog.findMany({
        where: { action: AUDIT_ACTION, schoolId: schoolA.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(audits.length).toBe(1)
      const root = await db.platformAdmin.findUnique({ where: { email: ROOT_EMAIL } })
      expect(audits[0].adminId).toBe(root!.id)
      expect(audits[0].targetType).toBe('SCHOOL')
      const meta = JSON.parse(audits[0].metadata ?? '{}')
      expect(meta).toMatchObject({ previous: false, next: true, academicYearSet: true, publishedFeeStructures: 0 })
      expect(audits[0].createdAt).toBeTruthy() // the timestamp column exists/is set
    },
    T,
  )

  test(
    'downstream effect: the school-plane flag resolution turns ON for school A only',
    async () => {
      const res = await fetch(`${BASE}/api/admissions/config`, {
        headers: { cookie: `erp_session=${principalToken}` },
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { ok: boolean; data?: { enabled: boolean; academicYear: string | null } }
      expect(json.ok).toBe(true)
      expect(json.data!.enabled).toBe(true) // effective through the school override
      expect(json.data!.academicYear).toBeTruthy()

      // School B is untouched: default OFF, flags row byte-identical.
      const getB = await getIssuance(rootToken, schoolB.id)
      const jsonB = (await getB.json()) as IssuanceState
      expect(jsonB.data!.enabled).toBe(false)
      expect(jsonB.data!.source).toBe('default')
      const rowB = await db.school.findUnique({ where: { id: schoolB.id }, select: { featureFlags: true } })
      expect(rowB!.featureFlags).toBe(schoolB.originalFlags)
    },
    T,
  )

  test(
    'disable: previous=true → next=false, second audit row, downstream OFF',
    async () => {
      const res = await patchIssuance(rootToken, schoolA.id, { enabled: false })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { ok: boolean; data?: { enabled: boolean; previous: boolean } }
      expect(json.data!.enabled).toBe(false)
      expect(json.data!.previous).toBe(true)

      const audits = await db.platformAuditLog.findMany({
        where: { action: AUDIT_ACTION, schoolId: schoolA.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(audits.length).toBe(2)
      const meta = JSON.parse(audits[1].metadata ?? '{}')
      expect(meta).toMatchObject({ previous: true, next: false })

      const cfg = await fetch(`${BASE}/api/admissions/config`, {
        headers: { cookie: `erp_session=${principalToken}` },
      })
      const cfgJson = (await cfg.json()) as { ok: boolean; data?: { enabled: boolean } }
      expect(cfgJson.data!.enabled).toBe(false)
    },
    T,
  )

  test('limited admin WITHOUT schools.manage → 403 FORBIDDEN, no write, no audit', async () => {
    const res = await patchIssuance(limitedAdminToken, schoolA.id, { enabled: true })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.code).toBe('FORBIDDEN')
    const row = await db.school.findUnique({ where: { id: schoolA.id }, select: { featureFlags: true } })
    expect(JSON.parse(row!.featureFlags)).toMatchObject({ admissionsServerIssuance: false })
    const audits = await db.platformAuditLog.count({ where: { action: AUDIT_ACTION, adminId: limitedAdminId } })
    expect(audits).toBe(0)
  }, T)

  test.each([
    ['string value', { enabled: 'yes' }],
    ['number value', { enabled: 1 }],
    ['missing key', {}],
    ['extra key (strict)', { enabled: true, force: true }],
    ['non-JSON body', '{enabled:true'],
  ])('invalid body %s → 422 INVALID_INPUT, no write', async (_label, body) => {
    const res = await patchIssuance(rootToken, schoolA.id, body)
    expect(res.status).toBe(422)
    const json = (await res.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('INVALID_INPUT')
    const row = await db.school.findUnique({ where: { id: schoolA.id }, select: { featureFlags: true } })
    expect(JSON.parse(row!.featureFlags)).toMatchObject({ admissionsServerIssuance: false })
  }, T)

  test('unknown school → 404 (no write anywhere)', async () => {
    const res = await patchIssuance(rootToken, 'nonexistent-school-id', { enabled: true })
    expect(res.status).toBe(404)
  }, T)

  test(
    'enabling an unconfigured school is allowed but AUDITED as unready (not silent)',
    async () => {
      const res = await patchIssuance(rootToken, markerSchoolId, { enabled: true })
      expect(res.status).toBe(200)
      const json = (await res.json()) as IssuanceState & { data?: { readiness: { ready: boolean } } }
      expect(json.data!.enabled).toBe(true)
      expect(json.data!.readiness.ready).toBe(false)

      const audits = await db.platformAuditLog.findMany({
        where: { action: AUDIT_ACTION, schoolId: markerSchoolId },
      })
      expect(audits.length).toBe(1)
      const meta = JSON.parse(audits[0].metadata ?? '{}')
      expect(meta).toMatchObject({ next: true, academicYearSet: false, publishedFeeStructures: 0 })
    },
    T,
  )

  test(
    'missing key after restore ⇒ default OFF again (fail-closed round-trip)',
    async () => {
      // Remove the override entirely (the restore semantics) and confirm
      // resolution falls back to OFF — never open.
      await db.school.update({ where: { id: schoolA.id }, data: { featureFlags: '{}' } })
      const res = await getIssuance(rootToken, schoolA.id)
      const json = (await res.json()) as IssuanceState
      expect(json.data!.enabled).toBe(false)
      expect(json.data!.source).toBe('default')
    },
    T,
  )
})
