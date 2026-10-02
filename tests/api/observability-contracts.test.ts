import { db } from '../helpers/db'
/**
 * PHASE 4 (item 10) — API CONTRACT tests: observability surfaces.
 *
 * LIVE HTTP against the dev server (default http://localhost:3000).
 * No DB writes except the login-session fixture fallback (see
 * tests/security/tenant-isolation.test.ts — same pattern).
 *
 * Route-level contracts under test:
 *   · /health/live  — 200, {status ok, probe live}, Cache-Control no-store,
 *                      no dependency fields (a liveness probe that depends
 *                      on dependencies causes restart storms)
 *   · /health/ready — 200, {status ready, checks.database ok}, durations
 *   · X-Request-Id response header on success AND failure envelopes;
 *     the 401 envelope's requestId === the header value
 *   · inbound X-Request-Id honored when well-formed (correlation echo)
 *   · inbound X-Request-id REJECTED when hostile (spaces / unicode /
 *     control chars) — the server mints a fresh UUID (anti log-forgery)
 *   · unknown route → 404 (Next not-found page; still x-request-id
 *     correlated); known-route missing id → 404 RESOURCE_NOT_FOUND envelope
 *   · method-not-allowed → 405, empty/safe body
 *   · malformed JSON body → 422 VALIDATION_FAILED envelope (no internals)
 *   · success envelope {ok:true, data}
 *   · role gating: unauth → 401 AUTH_REQUIRED; STUDENT on a staff route →
 *     403 FORBIDDEN — all through the SAME safe envelope shape
 */
import { describe, test, expect, beforeAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const T = 45000 // generous: first-hit dev compilation

// ── auth fixture (login with rate-limit fallback — same pattern as the
// tenant-isolation suite; a unique X-Forwarded-For per run keeps the
// per-IP login bucket fresh for re-runs) ──────────────────────────────────

const RUN_IP = `10.244.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const PW = TENANT_FIXTURE_PASSWORD
const tokens: Record<string, string> = {}

async function login(email: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password: PW }),
  })
  if (res.status === 429) {
    // Rate-limited from repeated suite runs — fall back to a direct
    // session row (auth fixture, NOT an authorization bypass).
    console.warn(`[obs-contracts] login rate-limited for ${email}; using direct session fixture`)
    return (tokens[email] = await directSession(email))
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) throw new Error(`login failed for ${email}`)
  return (tokens[email] = body.data.sessionToken)
}

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no fixture user ${email}`)
  const token = randomBytes(32).toString('hex')
  // PHASE 8A — the row stores the hash; the RAW token keeps riding the
  // Authorization header (identical to a server-minted session).
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(email: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await login(email)
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

interface FailureEnvelope {
  ok: boolean
  error?: string
  code?: string
  requestId?: string
}

async function expectFailureEnvelope(res: Response): Promise<FailureEnvelope> {
  expect([401, 403, 404, 405, 409, 413, 415, 422, 429, 503]).toContain(res.status)
  const body = (await res.json()) as FailureEnvelope
  expect(body.ok).toBe(false)
  expect(typeof body.error).toBe('string')
  expect(body.error!.length).toBeGreaterThan(0)
  expect(typeof body.requestId).toBe('string')
  expect(body.requestId!.length).toBeGreaterThan(0)
  // no internals ever leak into a failure envelope
  const text = JSON.stringify(body).toLowerCase()
  expect(text).not.toContain('prisma')
  expect(text).not.toContain('sqlite')
  expect(text).not.toContain('/home/')
  return body
}

beforeAll(async () => {
  // warm the routes this suite exercises (first-hit compilation)
  await fetch(`${BASE}/health/live`)
  await fetch(`${BASE}/health/ready`)
  await fetch(`${BASE}/api/students`) // 401 — no compile dependency on auth
}, 60000)

// ══════════════════════════════════════════════════════════════════════
// 1. Health probes
// ══════════════════════════════════════════════════════════════════════

describe('GET /health/live — liveness', () => {
  test('200 with {status ok, probe live} and numeric uptime', async () => {
    const res = await fetch(`${BASE}/health/live`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; probe: string; uptimeSeconds: number; timestamp: string }
    expect(body.status).toBe('ok')
    expect(body.probe).toBe('live')
    expect(typeof body.uptimeSeconds).toBe('number')
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  }, T)

  test('no-store cache semantics (probes must never be cached)', async () => {
    const res = await fetch(`${BASE}/health/live`)
    expect(res.headers.get('cache-control')).toContain('no-store')
  }, T)

  test('liveness depends on NOTHING — no dependency check fields in the body', async () => {
    const res = await fetch(`${BASE}/health/live`)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.checks).toBeUndefined() // readiness-style dependency fields absent
    expect(body.database).toBeUndefined()
    const started = Date.now()
    await fetch(`${BASE}/health/live`)
    expect(Date.now() - started).toBeLessThan(5000) // answers immediately
  }, T)

  test('carries the X-Request-Id correlation header', async () => {
    const res = await fetch(`${BASE}/health/live`)
    const rid = res.headers.get('x-request-id')
    expect(rid).toBeTruthy()
    expect(rid!).toMatch(UUID_RE)
  }, T)
})

describe('GET /health/ready — readiness', () => {
  test('200 with status ready and checks.database ok', async () => {
    const res = await fetch(`${BASE}/health/ready`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      probe: string
      checks: { database: string; dbDurationMs?: number }
      durationMs: number
    }
    expect(body.status).toBe('ready')
    expect(body.probe).toBe('ready')
    expect(body.checks.database).toBe('ok')
    expect(body.durationMs).toBeGreaterThanOrEqual(0)
    expect(body.checks.dbDurationMs ?? 0).toBeGreaterThanOrEqual(0)
  }, T)

  test('no-store cache semantics', async () => {
    const res = await fetch(`${BASE}/health/ready`)
    expect(res.headers.get('cache-control')).toContain('no-store')
  }, T)

  test('carries the X-Request-Id correlation header', async () => {
    const res = await fetch(`${BASE}/health/ready`)
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 2. Request-id propagation (middleware + envelope)
// ══════════════════════════════════════════════════════════════════════

describe('X-Request-Id propagation', () => {
  test('present on a 200 (GET /api/app-version)', async () => {
    const res = await fetch(`${BASE}/api/app-version`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toMatch(UUID_RE)
    const body = (await res.json()) as { version: string }
    expect(typeof body.version).toBe('string') // this route returns its own JSON shape
  }, T)

  test('present on a 401, and the envelope requestId === the header value', async () => {
    const res = await fetch(`${BASE}/api/students`)
    expect(res.status).toBe(401)
    const headerId = res.headers.get('x-request-id')
    expect(headerId).toMatch(UUID_RE)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.requestId).toBe(headerId)
  }, T)

  test('a well-formed inbound X-Request-Id is honored and echoed (correlation)', async () => {
    const res = await fetch(`${BASE}/api/students`, {
      headers: { 'x-request-id': 'test-correlation-12345' },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('x-request-id')).toBe('test-correlation-12345')
    const body = (await res.json()) as FailureEnvelope
    expect(body.requestId).toBe('test-correlation-12345')
  }, T)

  test('a well-formed inbound id is echoed on SUCCESS routes too', async () => {
    const res = await fetch(`${BASE}/api/app-version`, {
      headers: { 'x-request-id': 'correlate-success-0001' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('correlate-success-0001')
  }, T)

  // Values that PASS the HTTP transport but must be rejected by the app's
  // request-id sanitizer → the middleware mints a fresh UUID.
  const HOSTILE_IDS: Array<[string, string]> = [
    ['spaces', 'abc defgh'],
    ['unicode', 'ünïcödé-123'],
    ['quotes', 'abc"defgh'],
    ['too short', 'abc1234'],
    ['too long', 'x'.repeat(200)],
  ]

  for (const [label, hostile] of HOSTILE_IDS) {
    test(`hostile x-request-id (${label}) is rejected — a fresh UUID is minted`, async () => {
      const res = await fetch(`${BASE}/api/students`, { headers: { 'x-request-id': hostile } })
      expect(res.status).toBe(401)
      const rid = res.headers.get('x-request-id')
      expect(rid).toMatch(UUID_RE)
      expect(rid).not.toBe(hostile.trim())
      expect(rid!.includes('abc')).toBe(false)
      const body = (await res.json()) as FailureEnvelope
      expect(body.requestId).toBe(rid) // envelope agrees with the minted id
    }, T)
  }

  // Control characters are dropped BEFORE the app sees them: the HTTP
  // layer refuses them (client-side fetch error or a 4xx response). The
  // pure-function rejection of these values is pinned in the unit suite
  // (tests/unit/observability-http.test.ts).
  for (const [label, hostile] of [
    ['newline (log forging)', 'abc\ndefgh'],
    ['ansi escape', 'abc\x1b[31mdefg'],
    ['carriage return', 'abcdef\rgh'],
  ] as Array<[string, string]>) {
    test(`control characters in x-request-id (${label}) never reach the app`, async () => {
      let res: Response | null = null
      let transportRejected = false
      try {
        res = await fetch(`${BASE}/api/students`, { headers: { 'x-request-id': hostile } })
      } catch {
        transportRejected = true // the client/transport refuses the header outright
      }
      if (!transportRejected && res) {
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500) // rejected safely, no 5xx
        const rid = res.headers.get('x-request-id')
        if (rid) {
          expect(rid).not.toBe(hostile)
          expect(rid).toMatch(UUID_RE) // if correlated at all, only with a minted UUID
        }
      } else {
        expect(transportRejected).toBe(true)
      }
    }, T)
  }
})

// ══════════════════════════════════════════════════════════════════════
// 3. Route-level error envelopes
// ══════════════════════════════════════════════════════════════════════

describe('error envelopes', () => {
  test('unknown route → 404 (Next not-found page, still request-id correlated)', async () => {
    const res = await fetch(`${BASE}/api/nonexistent-xyz`)
    expect(res.status).toBe(404)
    // the 404 asset is the Next.js not-found page — still correlated:
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const text = await res.text()
    expect(text.toLowerCase()).not.toContain('prisma')
    expect(text).not.toContain('/home/')
  }, T)

  test('known route, missing resource → 404 RESOURCE_NOT_FOUND envelope', async () => {
    const res = await as('tenant.principal.a@hawkings.test', '/api/students/nonexistent-student-xyz')
    expect(res.status).toBe(404)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('RESOURCE_NOT_FOUND')
  }, T)

  test('method not allowed → 405 with an empty/safe body', async () => {
    const res = await fetch(`${BASE}/api/app-version`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const text = await res.text()
    expect(text.length).toBeLessThan(600) // no error page dump, no internals
    expect(text.toLowerCase()).not.toContain('prisma')
  }, T)

  test('malformed JSON body → 422 VALIDATION_FAILED envelope (no internals)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: '{bad json',
    })
    const body = await expectFailureEnvelope(res)
    expect([400, 422]).toContain(res.status)
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.error).toBe('Request body must be valid JSON')
  }, T)

  test('unknown fields in a strict-validated body → 422 VALIDATION_FAILED', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ foo: 'bar' }),
    })
    const body = await expectFailureEnvelope(res)
    expect(res.status).toBe(422)
    expect(body.code).toBe('VALIDATION_FAILED')
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 4. Success envelope + role gating (envelope shape on every path)
// ══════════════════════════════════════════════════════════════════════

describe('success envelope + role gating', () => {
  test('GET /api/fees as principal → {ok:true, data array}', async () => {
    const res = await as('tenant.principal.a@hawkings.test', '/api/fees')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  }, T)

  test('GET /api/students unauthenticated → 401 AUTH_REQUIRED (canonical code)', async () => {
    const res = await fetch(`${BASE}/api/students`)
    expect(res.status).toBe(401)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.error).toBe('Authentication required')
  }, T)

  test('STUDENT role on a staff route → 403 FORBIDDEN envelope (students use /api/student/*)', async () => {
    const res = await as('tenant.student.a@hawkings.test', '/api/students')
    expect(res.status).toBe(403)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('STUDENT on /api/teachers (staff read) → 403 FORBIDDEN', async () => {
    const res = await as('tenant.student.a@hawkings.test', '/api/teachers')
    expect(res.status).toBe(403)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('bad credentials → 401 AUTH_REQUIRED with a generic (non-enumerating) message', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'nobody.test-p4@hawkings.test', password: 'wrong-password-1' }),
    })
    expect(res.status).toBe(401)
    const body = await expectFailureEnvelope(res)
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.error).toBe('Invalid email or password') // no account-existence oracle
  }, T)
})
