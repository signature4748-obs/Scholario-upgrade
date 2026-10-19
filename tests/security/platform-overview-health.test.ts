/**
 * PLATFORM HEALTH ROUTE — the system-health wire contract
 * (2026-10-19 overview system-health panel regression).
 *
 * docs/PLATFORM_CONTROL_PLANE.md §3/§11 document the control-plane
 * overview as "stats dashboard + system health (DB latency, counts,
 * memory, recent auth failures)", served by GET /api/platform/health.
 * The route shipped implemented but had NO console consumer and NO
 * test coverage — the Overview SystemHealthCard (this change) is the
 * first consumer, so the contract it renders against is now pinned:
 *
 *   1. The route requires a platform session — 401 without a token
 *      (the same authz-negative convention as every platform suite).
 *   2. An authenticated root GET returns the documented shape:
 *      status ∈ {healthy, degraded}; db.ok boolean + latencyMs;
 *      schools by-status counts; users/platformAdmins; live session
 *      counts (platform/school/support); security.recentAuthFailures
 *      with its 7-day window label; process health (uptime/memory/
 *      nodeEnv); a parseable checkedAt timestamp.
 *   3. The auth-failure signal is WINDOWED to the last 7 days (the
 *      createdAt-indexed count — "recent" must stay truthful as the
 *      audit log grows), and the window is returned alongside the
 *      count so the UI can label it honestly.
 *
 * Live-HTTP against the dev server (same style as
 * platform-support-sessions-revoked): root session via the login API
 * with the direct-row fallback when the login limiter is hot.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_ROOT_EMAIL, PLATFORM_ROOT_PASSWORD } from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const RUN_IP = `10.237.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const createdSessionHashes: string[] = []
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

interface HealthBody {
  ok: boolean
  data?: {
    status: string
    db: { ok: boolean; latencyMs: number | null }
    schools: { active: number; suspended: number; pending: number }
    users: number
    platformAdmins: number
    sessions: { platform: number; school: number; support: number }
    security: { recentAuthFailures: number; recentAuthFailuresWindowDays?: number }
    process: { uptimeSec: number; rssMb: number; nodeEnv: string }
    checkedAt: string
  }
}

async function getHealth(token: string | null): Promise<{ status: number; body: HealthBody | null }> {
  const res = await liveFetch(`${BASE}/api/platform/health`, {
    headers: token
      ? { 'x-platform-token': token, 'content-type': 'application/json' }
      : { 'content-type': 'application/json' },
  })
  let body: HealthBody | null = null
  try {
    body = (await res.json()) as HealthBody
  } catch {
    /* non-JSON error body — assertions below surface it */
  }
  return { status: res.status, body }
}

beforeAll(async () => {
  rootToken = await rootLogin()
}, 60_000)

afterAll(async () => {
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('PLATFORM HEALTH ROUTE — system-health contract', () => {
  test(
    'requires a platform session (401 without a token)',
    async () => {
      const { status } = await getHealth(null)
      expect(status).toBe(401)
    },
    T,
  )

  test(
    'authenticated GET returns the documented system-health shape with real values',
    async () => {
      const { status, body } = await getHealth(rootToken)
      expect(status).toBe(200)
      const d = body?.data
      expect(d).toBeTruthy()
      if (!d) return

      // Overall status derives from the DB probe only.
      expect(['healthy', 'degraded']).toContain(d.status)
      expect(typeof d.db.ok).toBe('boolean')
      if (d.db.ok) {
        expect(typeof d.db.latencyMs).toBe('number')
        expect(d.db.latencyMs).toBeGreaterThanOrEqual(0)
        expect(d.status).toBe('healthy')
      } else {
        expect(d.status).toBe('degraded')
      }

      // Entity counts — real numbers against the seeded corpus.
      for (const key of ['active', 'suspended', 'pending'] as const) {
        expect(typeof d.schools[key]).toBe('number')
        expect(d.schools[key]).toBeGreaterThanOrEqual(0)
      }
      expect(d.users).toBeGreaterThanOrEqual(1)
      expect(d.platformAdmins).toBeGreaterThanOrEqual(1)

      // Live session counts (non-negative integers).
      for (const key of ['platform', 'school', 'support'] as const) {
        expect(typeof d.sessions[key]).toBe('number')
        expect(d.sessions[key]).toBeGreaterThanOrEqual(0)
      }

      // Process health.
      expect(d.process.uptimeSec).toBeGreaterThanOrEqual(0)
      expect(d.process.rssMb).toBeGreaterThan(0)
      expect(typeof d.process.nodeEnv).toBe('string')
      expect(d.process.nodeEnv.length).toBeGreaterThan(0)

      // Freshness timestamp is a parseable ISO date.
      expect(Number.isNaN(new Date(d.checkedAt).getTime())).toBe(false)
    },
    T,
  )

  test(
    'the auth-failure security signal is windowed to the last 7 days and says so',
    async () => {
      const { status, body } = await getHealth(rootToken)
      expect(status).toBe(200)
      const d = body?.data
      expect(d).toBeTruthy()
      if (!d) return

      expect(typeof d.security.recentAuthFailures).toBe('number')
      expect(d.security.recentAuthFailures).toBeGreaterThanOrEqual(0)
      // THE window contract: the count is 7-day-scoped and the window
      // is returned so the UI label never lies about its span.
      expect(d.security.recentAuthFailuresWindowDays).toBe(7)

      // Cross-check the count against the DB with the same predicate
      // (read-only) — the route must not silently drift from it.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const expected = await db.platformAuditLog.count({
        where: {
          action: {
            in: ['platform.login.failed', 'platform.step_up.failed', 'platform.login.locked'],
          },
          createdAt: { gte: since },
        },
      })
      expect(d.security.recentAuthFailures).toBe(expected)
    },
    T,
  )
})
