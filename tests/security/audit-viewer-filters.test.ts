/**
 * AUDIT VIEWER FILTERS (2026-10-28 Support & audit redesign) — the
 * extended /api/platform/audit query surface, live-HTTP against the dev
 * server, same conventions as platform-support-sessions-revoked:
 *
 *   1. Authz — no platform token → 401 (the plane boundary, re-checked
 *      because the route gained new query dimensions).
 *   2. Tenant scoping — schoolId=A never returns another school's rows
 *      (cross-tenant probe planted on purpose).
 *   3. Category — only that category's action prefixes survive.
 *   4. Outcome — failure/success classification, composed with q.
 *   5. Date range — from/to bound createdAt inclusively.
 *   6. Free-text — reaches targetId (and action/reason as before).
 *   7. Shape — requestId and PARSED metadata objects on every row.
 *
 * Rows are PLANTED directly (the route under test is the read; direct
 * rows bypass no authorization gate) with unique markers, and removed
 * in afterAll — self-sufficient on fresh corpora.
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
const MARKER = `zzq-audit-${randomBytes(4).toString('hex')}`

const createdSessionHashes: string[] = []
const plantedAuditIds: string[] = []
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

interface AuditEventRow {
  id: string
  at: string
  action: string
  admin: { id: string; name: string } | null
  targetType: string | null
  targetId: string | null
  schoolId: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  requestId: string | null
}

interface AuditBody {
  ok: boolean
  data?: { total: number; page: number; pageSize: number; events: AuditEventRow[] }
}

async function queryAudit(
  token: string | null,
  qs: string,
): Promise<{ status: number; total: number; events: AuditEventRow[] }> {
  const res = await liveFetch(`${BASE}/api/platform/audit?${qs}`, {
    headers: token
      ? { 'x-platform-token': token, 'content-type': 'application/json' }
      : { 'content-type': 'application/json' },
  })
  let body: AuditBody | null = null
  try {
    body = (await res.json()) as AuditBody
  } catch {
    /* non-JSON error body — surfaced by status assertions */
  }
  return { status: res.status, total: body?.data?.total ?? 0, events: body?.data?.events ?? [] }
}

async function plant(row: {
  action: string
  schoolId?: string | null
  targetId?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
  requestId?: string | null
  createdAt?: Date
}): Promise<string> {
  const created = await db.platformAuditLog.create({
    data: {
      adminId: null,
      action: row.action,
      targetType: row.targetId ? 'SCHOOL' : null,
      targetId: row.targetId ?? null,
      schoolId: row.schoolId ?? null,
      reason: row.reason ?? null,
      metadata: row.metadata ? JSON.stringify(row.metadata) : null,
      ip: null,
      requestId: row.requestId ?? null,
      createdAt: row.createdAt ?? new Date(),
    },
  })
  plantedAuditIds.push(created.id)
  return created.id
}

let schoolAId = ''
let schoolBId = ''

beforeAll(async () => {
  rootToken = await rootLogin()

  const schoolA = await db.school.findFirst({ where: { slug: 'hawkings-prithvipur' } })
  const schoolB = await db.school.findFirst({ where: { slug: 'green-valley' } })
  if (!schoolA || !schoolB) throw new Error('audit filters: corpus missing the two fixture schools')
  schoolAId = schoolA.id
  schoolBId = schoolB.id

  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error('audit filters: corpus missing the root admin')

  // Isolation pair — same marker, different tenants.
  await plant({ action: 'platform.school.updated', schoolId: schoolAId, targetId: MARKER, reason: MARKER })
  await plant({ action: 'platform.school.updated', schoolId: schoolBId, targetId: `${MARKER}-B`, reason: MARKER })

  // Category pair — support_access vs school_config, same marker.
  await plant({ action: 'platform.support_session.created', schoolId: schoolAId, targetId: MARKER })
  // (the school.updated rows above are the school_config side)

  // Outcome pair — explicit failure marker vs clean action, same marker.
  await plant({ action: 'platform.login.failed', schoolId: null, targetId: null, reason: MARKER })
  await plant({ action: 'platform.login.success', schoolId: null, targetId: null, reason: MARKER })

  // Date-range pair — one ancient, one current, same marker.
  await plant({
    action: 'platform.settings.updated',
    reason: `${MARKER}-ancient`,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
  })
  await plant({
    action: 'platform.settings.updated',
    reason: `${MARKER}-current`,
    createdAt: new Date(),
  })

  // Shape row — parsed metadata + requestId.
  await plant({
    action: 'platform.support_session.created',
    schoolId: schoolAId,
    targetId: MARKER,
    metadata: { durationMinutes: 15, schoolName: 'Marker School', '0': 'numeric-key-noise' },
    requestId: `req_${MARKER}`,
  })
}, 60_000)

afterAll(async () => {
  await db.platformAuditLog.deleteMany({ where: { id: { in: plantedAuditIds } } })
  for (const hash of createdSessionHashes) {
    await db.platformAdminSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } })
  }
}, 30_000)

describe('AUDIT VIEWER — authorization & tenant scoping', () => {
  test('no platform token → 401 (the plane boundary still holds)', async () => {
    const { status } = await queryAudit(null, `q=${MARKER}`)
    expect(status).toBe(401)
  }, T)

  test('schoolId scope never returns another tenant’s rows (cross-tenant probe)', async () => {
    const { events } = await queryAudit(rootToken, `schoolId=${schoolAId}&q=${MARKER}`)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.schoolId).toBe(schoolAId)
    }
    const ids = new Set(events.map((e) => e.id))
    const bRow = await db.platformAuditLog.findFirst({ where: { targetId: `${MARKER}-B` } })
    expect(bRow).not.toBeNull()
    expect(ids.has(bRow!.id)).toBe(false)
  }, T)

  test('unfiltered total counts every planted marker row (pagination honesty)', async () => {
    const { total } = await queryAudit(rootToken, `q=${MARKER}`)
    expect(total).toBeGreaterThanOrEqual(8)
  }, T)
})

describe('AUDIT VIEWER — category filter', () => {
  test('category=support_access returns only support/school-session actions', async () => {
    const { events } = await queryAudit(rootToken, `category=support_access&q=${MARKER}`)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(
        e.action.startsWith('platform.support_session.') || e.action.startsWith('platform.school_session.'),
      ).toBe(true)
    }
  }, T)

  test('category=school_config returns only platform.school.* actions', async () => {
    const { events } = await queryAudit(rootToken, `category=school_config&q=${MARKER}`)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.action.startsWith('platform.school.')).toBe(true)
    }
    // The support_access marker rows must NOT leak in.
    expect(events.some((e) => e.action.startsWith('platform.support_session.'))).toBe(false)
  }, T)
})

describe('AUDIT VIEWER — outcome filter (derived from action markers)', () => {
  test('outcome=failure returns only failure-marked actions', async () => {
    const { events } = await queryAudit(rootToken, `outcome=failure&q=${MARKER}`)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.action).toMatch(/[._](failed|locked|refused)([._]|$)/)
    }
  }, T)

  test('outcome=success excludes every failure-marked action', async () => {
    const { events } = await queryAudit(rootToken, `outcome=success&q=${MARKER}`)
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.action).not.toMatch(/[._](failed|locked|refused)([._]|$)/)
    }
  }, T)
})

describe('AUDIT VIEWER — date range filter', () => {
  test('from=2021 excludes the ancient row, keeps the current one', async () => {
    const { events } = await queryAudit(
      rootToken,
      `q=${MARKER}-&from=2021-01-01T00:00:00.000Z&action=platform.settings.updated`,
    )
    const reasons = events.map((e) => e.reason)
    expect(reasons).toContain(`${MARKER}-current`)
    expect(reasons).not.toContain(`${MARKER}-ancient`)
  }, T)

  test('to=2020-06 excludes the current row, keeps the ancient one', async () => {
    const { events } = await queryAudit(
      rootToken,
      `q=${MARKER}-&to=2020-06-01T00:00:00.000Z&action=platform.settings.updated`,
    )
    const reasons = events.map((e) => e.reason)
    expect(reasons).toContain(`${MARKER}-ancient`)
    expect(reasons).not.toContain(`${MARKER}-current`)
  }, T)
})

describe('AUDIT VIEWER — search & response shape', () => {
  test('free-text q reaches targetId values', async () => {
    const { events } = await queryAudit(rootToken, `q=${MARKER}-B`)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.targetId === `${MARKER}-B`)).toBe(true)
  }, T)

  test('rows expose requestId and PARSED metadata (numeric keys dropped by the UI layer)', async () => {
    const { events } = await queryAudit(rootToken, `q=${MARKER}&category=support_access`)
    const shaped = events.find((e) => e.requestId === `req_${MARKER}`)
    expect(shaped).toBeDefined()
    expect(shaped!.metadata).toEqual({
      durationMinutes: 15,
      schoolName: 'Marker School',
      '0': 'numeric-key-noise',
    })
    expect(shaped!.metadata).not.toBeNull()
    expect(typeof shaped!.metadata).toBe('object')
  }, T)

  test('server-side pagination: page 1 and page 2 never overlap', async () => {
    const p1 = await queryAudit(rootToken, `q=${MARKER}&page=1`)
    const p2 = await queryAudit(rootToken, `q=${MARKER}&page=2`)
    const ids1 = new Set(p1.events.map((e) => e.id))
    for (const e of p2.events) {
      expect(ids1.has(e.id)).toBe(false)
    }
    expect(p1.events.length).toBeLessThanOrEqual(50)
  }, T)
})
