/**
 * PLATFORM SUPPORT SESSIONS REGISTRY — the includeRevoked contract
 * (2026-10-16 functional-audit fix batch, FIX 2 regression).
 *
 * The /platform/support registry copy promises "live, expired or
 * revoked" sessions and support-tools.tsx therefore fetches
 * /api/platform/support/sessions?includeRevoked=true. The API default
 * deliberately hides revoked rows (revokedAt != null); the param
 * re-includes them. This pins the wire contract both ways:
 *
 *   1. Default GET → 200, every returned session has revokedAt === null
 *      (the default list is never silently mixed with revoked rows).
 *   2. includeRevoked=true → 200, at least one revoked session is
 *      returned and every row carries the reason field (the registry
 *      renders it next to the revoked badge). SELF-SUFFICIENT since
 *      2026-10-26: the suite PLANTS its own revoked registry row in
 *      beforeAll (the same direct-row auth-fixture convention as
 *      directPlatformSession) and removes it in afterAll — previously
 *      the assertion leaned on corpus history ("the QA-audit fixture
 *      plus older isolation probes") or on an EARLIER suite in the
 *      same battery having created+revoked sessions, an unintended
 *      test-order dependency that failed on fresh corpora whenever
 *      the preceding suite's writes died in a dev-server restart
 *      window.
 *   3. Both calls require a platform session — 401 without a token
 *      (the same authz-negative convention as platform-isolation /
 *      subscription-entitlement's boundary block).
 *
 * Live-HTTP against the dev server (same style as
 * platform-schools-attention-filter): root session via the login API
 * with the direct-row fallback when the login limiter is hot.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import {
  PLATFORM_ROOT_EMAIL,
  PLATFORM_ROOT_PASSWORD,
} from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const RUN_IP = `10.237.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const createdSessionHashes: string[] = []
const plantedSupportTokenHashes: string[] = []
let rootToken = ''

/** Direct PlatformAdminSession row (auth fixture — bypasses only the
 *  login limiter, never an authorization gate). */
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

/** One support-session registry row as served by the route. */
interface SupportSessionRow {
  id: string
  reason: string | null
  revokedAt: string | null
  createdAt: string
  expiresAt: string
  live: boolean
}

interface SessionsBody {
  ok: boolean
  data?: { sessions?: SupportSessionRow[] }
}

async function listSessions(
  token: string | null,
  includeRevoked: boolean,
): Promise<{ status: number; sessions: SupportSessionRow[] }> {
  const res = await liveFetch(
    `${BASE}/api/platform/support/sessions${includeRevoked ? '?includeRevoked=true' : ''}`,
    {
      headers: token
        ? { 'x-platform-token': token, 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
    },
  )
  let body: SessionsBody | null = null
  try {
    body = (await res.json()) as SessionsBody
  } catch {
    /* non-JSON error body — assertions below surface it */
  }
  return { status: res.status, sessions: body?.data?.sessions ?? [] }
}

/** Plant ONE revoked support-session registry row (corpus fixture for
 *  the includeRevoked contract — same direct-row convention as the auth
 *  fixture above; the ROUTE under test is the registry read, which this
 *  row never bypasses). Removed again in afterAll: the suite is
 *  self-sufficient on fresh corpora and leaves no cross-run drift. */
async function plantRevokedSupportSession(): Promise<void> {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  const school = await db.school.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!admin || !school) throw new Error('plantRevokedSupportSession: corpus missing admin/school')
  const tokenHash = hashSessionToken(randomBytes(32).toString('hex'))
  await db.supportSession.create({
    data: {
      adminId: admin.id,
      schoolId: school.id,
      reason: 'includeRevoked contract self-sufficiency fixture (planted by the suite)',
      durationMinutes: 5,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: new Date(),
    },
  })
  plantedSupportTokenHashes.push(tokenHash)
}

beforeAll(async () => {
  rootToken = await rootLogin()
  await plantRevokedSupportSession()
}, 60_000)

afterAll(async () => {
  for (const hash of plantedSupportTokenHashes) {
    await db.supportSession.deleteMany({ where: { tokenHash: hash } })
  }
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('SUPPORT SESSIONS REGISTRY — includeRevoked contract', () => {
  test(
    'default GET returns ONLY non-revoked sessions (every row has revokedAt === null)',
    async () => {
      const { status, sessions } = await listSessions(rootToken, false)
      expect(status).toBe(200)
      expect(Array.isArray(sessions)).toBe(true)
      // THE default contract: revoked rows are filtered out, never
      // silently mixed into the plain registry list.
      for (const s of sessions) {
        expect(s.revokedAt).toBeNull()
      }
    },
    T,
  )

  test(
    'includeRevoked=true returns revoked sessions too, each carrying the reason field',
    async () => {
      const [plain, withRevoked] = await Promise.all([
        listSessions(rootToken, false),
        listSessions(rootToken, true),
      ])
      expect(withRevoked.status).toBe(200)
      expect(Array.isArray(withRevoked.sessions)).toBe(true)
      // The param must actually re-include the revoked registry rows —
      // the suite PLANTS its own revoked row in beforeAll, so this holds
      // on a fresh corpus with no other suite having run first.
      expect(withRevoked.sessions.some((s) => s.revokedAt !== null)).toBe(true)
      // The revoked registry renders a reason next to the revoked
      // badge — every row carries the field, and at least one revoked
      // row has a non-empty one.
      for (const s of withRevoked.sessions) {
        expect(s).toHaveProperty('reason')
      }
      const revoked = withRevoked.sessions.filter((s) => s.revokedAt !== null)
      expect(revoked.some((s) => typeof s.reason === 'string' && s.reason.length > 0)).toBe(true)
      // Superset relationship: the param only ADDS rows (the default
      // list is the includeRevoked list minus the revoked rows).
      expect(plain.status).toBe(200)
      expect(withRevoked.sessions.length).toBeGreaterThanOrEqual(plain.sessions.length)
    },
    T,
  )

  test(
    'both registry calls require a platform session (401 without a token)',
    async () => {
      const noAuthDefault = await listSessions(null, false)
      expect(noAuthDefault.status).toBe(401)
      const noAuthRevoked = await listSessions(null, true)
      expect(noAuthRevoked.status).toBe(401)
    },
    T,
  )
})
