/**
 * SUPPORT SESSION REGISTRY FILTERS (2026-10-28 Support & audit redesign)
 * — the status / q query surface on /api/platform/support/sessions,
 * live-HTTP against the dev server:
 *
 *   1. status=live → every returned row is live (no revoked, no expired)
 *   2. status=ended → every returned row is ended (revoked or expired)
 *   3. q → matches reason text (case-insensitive)
 *   4. Authz — no platform token → 401 (re-checked: new dimensions)
 *
 * Composes with schoolId scoping (the school workspace's usage).
 * Rows are PLANTED directly (registry read under test; no gate
 * bypassed) with unique markers and removed in afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes, createHash } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_ROOT_EMAIL, PLATFORM_ROOT_PASSWORD } from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const RUN_IP = `10.237.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const MARKER = `zzq-registry-${randomBytes(4).toString('hex')}`

const createdSessionHashes: string[] = []
const plantedTokenHashes: string[] = []
let rootToken = ''

async function directPlatformSession(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error(`no platform admin ${PLATFORM_ROOT_EMAIL}`)
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  createdSessionHashes.push(hashSessionToken(token))
  return token
}

async function rootLogin(): Promise<string> {
  const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: PLATFORM_ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD }),
  })
  if (res.status === 429) return directPlatformSession()
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform login failed: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

interface RegistryRow {
  id: string
  reason: string | null
  revokedAt: string | null
  createdAt: string
  expiresAt: string
  live: boolean
  school: { id: string } | null
}

interface RegistryBody {
  ok: boolean
  data?: { sessions?: RegistryRow[] }
}

async function listSessions(
  token: string | null,
  qs: string,
): Promise<{ status: number; sessions: RegistryRow[] }> {
  const res = await liveFetch(`${BASE}/api/platform/support/sessions?${qs}`, {
    headers: token
      ? { 'x-platform-token': token, 'content-type': 'application/json' }
      : { 'content-type': 'application/json' },
  })
  let body: RegistryBody | null = null
  try {
    body = (await res.json()) as RegistryBody
  } catch {
    /* surfaced by assertions */
  }
  return { status: res.status, sessions: body?.data?.sessions ?? [] }
}

async function plant(opts: {
  reason: string
  revokedAt?: Date | null
  expiresAt: Date
  schoolId: string
}): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error('registry filters: corpus missing the root admin')
  const tokenHash = createHash('sha256').update(randomBytes(32).toString('hex')).digest('hex')
  await db.supportSession.create({
    data: {
      adminId: admin.id,
      schoolId: opts.schoolId,
      reason: opts.reason,
      durationMinutes: 15,
      tokenHash,
      expiresAt: opts.expiresAt,
      revokedAt: opts.revokedAt ?? null,
    },
  })
  plantedTokenHashes.push(tokenHash)
  return tokenHash
}

let schoolAId = ''

beforeAll(async () => {
  rootToken = await rootLogin()
  const schoolA = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' } })
  if (!schoolA) throw new Error('registry filters: corpus missing the demo school')
  schoolAId = schoolA.id

  // Live row (future expiry, never revoked).
  await plant({
    reason: `${MARKER} live row`,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    schoolId: schoolAId,
  })
  // Ended row — explicitly revoked.
  await plant({
    reason: `${MARKER} revoked row`,
    revokedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
    schoolId: schoolAId,
  })
  // Ended row — expired by time.
  await plant({
    reason: `${MARKER} expired row`,
    expiresAt: new Date(Date.now() - 60_000),
    schoolId: schoolAId,
  })
}, 60_000)

afterAll(async () => {
  await db.supportSession.deleteMany({ where: { tokenHash: { in: plantedTokenHashes } } })
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('SUPPORT SESSION REGISTRY — status & search filters', () => {
  test('no platform token → 401', async () => {
    const { status } = await listSessions(null, `status=live`)
    expect(status).toBe(401)
  }, T)

  test('status=live returns ONLY live rows (no revoked, no expired)', async () => {
    const { sessions } = await listSessions(rootToken, `status=live&q=${MARKER}`)
    expect(sessions.length).toBe(1)
    expect(sessions[0]!.live).toBe(true)
    expect(sessions[0]!.revokedAt).toBeNull()
    expect(sessions[0]!.reason).toBe(`${MARKER} live row`)
  }, T)

  test('status=ended returns ONLY ended rows (revoked or expired)', async () => {
    const { sessions } = await listSessions(rootToken, `status=ended&q=${MARKER}`)
    expect(sessions.length).toBe(2)
    for (const s of sessions) {
      expect(s.live).toBe(false)
    }
    const reasons = sessions.map((s) => s.reason)
    expect(reasons).toContain(`${MARKER} revoked row`)
    expect(reasons).toContain(`${MARKER} expired row`)
  }, T)

  test('status=all (or no status) sees every planted row', async () => {
    const { sessions } = await listSessions(rootToken, `status=all&q=${MARKER}`)
    expect(sessions.length).toBe(3)
  }, T)

  test('q is case-insensitive over the reason', async () => {
    const upper = MARKER.toUpperCase()
    const { sessions } = await listSessions(rootToken, `status=live&q=${upper}`)
    expect(sessions.length).toBe(1)
    expect(sessions[0]!.reason).toBe(`${MARKER} live row`)
  }, T)

  test('composes with schoolId scoping (the school workspace usage)', async () => {
    const { sessions } = await listSessions(
      rootToken,
      `status=all&q=${MARKER}&schoolId=${schoolAId}`,
    )
    expect(sessions.length).toBe(3)
    for (const s of sessions) {
      expect(s.school?.id).toBe(schoolAId)
    }
  }, T)

  test('legacy includeRevoked contract still honored (default hides revoked)', async () => {
    const def = await listSessions(rootToken, `q=${MARKER}`)
    // Default: revokedAt null → the revoked row is hidden; the expired
    // (never-revoked) row remains visible per the original contract.
    for (const s of def.sessions) {
      expect(s.revokedAt).toBeNull()
    }
    const incl = await listSessions(rootToken, `includeRevoked=true&q=${MARKER}`)
    expect(incl.sessions.length).toBe(3)
  }, T)
})
