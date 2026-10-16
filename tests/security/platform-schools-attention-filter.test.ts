/**
 * PLATFORM SCHOOLS LIST — the ATTENTION status filter (2026-10-16
 * super-admin control-panel regression).
 *
 * The Overview metric "Needs attention" links to
 * /platform/schools?status=ATTENTION; the API must translate that
 * pseudo-status into the honest needs-attention rule (lifecycle is
 * PENDING — setup not completed — or TRIAL), the same two statuses the
 * Overview metric counts. This pins the wire contract:
 *
 *   1. status=ATTENTION → 200, every row PENDING|TRIAL, count == the
 *      summary's PENDING+TRIAL total (never a silent unfiltered dump).
 *   2. status=ATTENTION vs status=ACTIVE → disjoint row sets.
 *   3. An unknown status value stays a validation error (400/422) —
 *      the enum gate did not become a silent passthrough.
 *
 * Live-HTTP against the dev server (same style as platform-isolation);
 * root session with the direct-row fallback when the login limiter is hot.
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
  }, T)
  if (res.status === 429) return directPlatformSession()
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform login failed: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

interface SchoolsListBody {
  ok: boolean
  data: {
    total: number
    schools: Array<{ id: string; status: string }>
    summary?: { byStatus: Record<string, number> }
  }
}

async function listSchools(
  token: string,
  status: string,
): Promise<{ status: number; body: SchoolsListBody }> {
  const res = await liveFetch(
    `${BASE}/api/platform/schools?status=${encodeURIComponent(status)}&summary=1&pageSize=100`,
    { headers: { cookie: `scholario_platform_session=${token}` } },
    T,
  )
  let body: SchoolsListBody | null = null
  try {
    body = (await res.json()) as SchoolsListBody
  } catch {
    /* non-JSON error body — assertions below surface it */
  }
  return { status: res.status, body: body as SchoolsListBody }
}

beforeAll(async () => {
  rootToken = await rootLogin()
}, 60_000)

afterAll(async () => {
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('ATTENTION status filter — the Overview needs-attention rule', () => {
  test(
    'status=ATTENTION returns exactly the PENDING+TRIAL schools (summary-consistent)',
    async () => {
      const { status, body } = await listSchools(rootToken, 'ATTENTION')
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      const rows = body.data.schools
      for (const row of rows) {
        expect(['PENDING', 'TRIAL']).toContain(row.status)
      }
      const expected = (body.data.summary?.byStatus?.PENDING ?? 0) + (body.data.summary?.byStatus?.TRIAL ?? 0)
      expect(body.data.total).toBe(expected)
      expect(rows.length).toBe(Math.min(expected, 100))
    },
    T,
  )

  test(
    'ATTENTION and ACTIVE filters are disjoint',
    async () => {
      const attention = await listSchools(rootToken, 'ATTENTION')
      const active = await listSchools(rootToken, 'ACTIVE')
      expect(attention.status).toBe(200)
      expect(active.status).toBe(200)
      const aIds = new Set(attention.body.data.schools.map((s) => s.id))
      for (const s of active.body.data.schools) {
        expect(aIds.has(s.id)).toBe(false)
      }
    },
    T,
  )

  test(
    'an unknown status value is still rejected (validation gate intact)',
    async () => {
      const res = await liveFetch(
        `${BASE}/api/platform/schools?status=NOT_A_STATUS&summary=1`,
        { headers: { cookie: `scholario_platform_session=${rootToken}` } },
        T,
      )
      expect([400, 422]).toContain(res.status)
    },
    T,
  )
})
