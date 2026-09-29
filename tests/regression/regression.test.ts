/**
 * PHASE 4 (item 10) — REGRESSION suite: pins for historical bug fixes.
 *
 * Each check references the phase/incident that introduced the fix.
 * Where a regression is ALREADY exhaustively covered by an existing
 * Phase-1/2/3 suite, it is referenced in the comments below rather than
 * duplicated:
 *
 *   · Phase 3 — ledger idempotency (applyPaymentToLedger replay/clamp/
 *     overshoot), attendance double-POST idempotency, marks double-submit
 *     idempotency, marks bounds (≤ maxMarks), declared-exam deletion
 *     refusal, tenant teardown cascades → ALL covered by
 *     tests/security/database-integrity.test.ts (41 tests).
 *   · Phase 2 — cross-tenant reads/writes/deletes fail-safe (no existence
 *     oracle) → tests/security/tenant-isolation.test.ts.
 *   · Phase 1 — rate limiter behavior (429 + Retry-After), envelope
 *     sanitization internals, header hardening → tests/security/
 *     rate-limit.test.ts, errors.test.ts, headers.test.ts.
 *
 * The checks here are the Phase-4-relevant pins (canonical codes,
 * request-id correlation, middleware injection rejection, health shapes)
 * that previously had NO regression coverage.
 */
import { describe, test, expect } from 'bun:test'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const T = 45000

// ─────────────────────────────────────────────────────────────────────────
// 1. Phase 4 — canonical envelope codes on the live server
//    (incident: pre-Phase-4 code paths surfaced the legacy spellings
//     'UNAUTHORIZED'/'NOT_FOUND' and raw Error strings)
// ─────────────────────────────────────────────────────────────────────────

describe('regression · Phase-4 canonical envelope codes', () => {
  const UNAUTH_ROUTES = ['/api/students', '/api/teachers', '/api/fees', '/api/dashboard']

  for (const route of UNAUTH_ROUTES) {
    test(`401 on ${route} carries code AUTH_REQUIRED (never 'UNAUTHORIZED')`, async () => {
      const res = await fetch(`${BASE}${route}`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { ok: boolean; code: string; error: string; requestId: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('AUTH_REQUIRED')
      expect(body.code).not.toBe('UNAUTHORIZED') // the legacy spelling is dead
      expect(typeof body.error).toBe('string') // never a raw thrown object
      expect(body.error.length).toBeGreaterThan(0)
    }, T)
  }

  test('validation failure carries code VALIDATION_FAILED (POST /api/auth/login, malformed JSON)', async () => {
    // regression pin: parseJsonBody failures are zod-path VALIDATION_FAILED
    // (422), never a bare 500 or a raw zod error dump
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json at all',
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok: boolean; code: string; error: string; requestId: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(typeof body.error).toBe('string')
    expect(JSON.stringify(body)).not.toContain('zod')
    expect(JSON.stringify(body)).not.toContain('ZodError')
  }, T)

  test('validation failure carries code VALIDATION_FAILED (schema-shaped body)', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: '' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION_FAILED')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Phase 4 — requestId correlation (the support/debugging contract)
//    (incident: failures used to be untraceable — no correlation id)
// ─────────────────────────────────────────────────────────────────────────

describe('regression · requestId correlation', () => {
  test('every failure envelope carries a UUID requestId when no inbound header was sent', async () => {
    for (const route of ['/api/students', '/api/exams', '/api/notifications']) {
      const res = await fetch(`${BASE}${route}`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { requestId?: string }
      expect(body.requestId).toMatch(UUID_RE) // present AND well-formed
    }
  }, T)

  test('the envelope requestId equals the X-Request-Id response header (one id end-to-end)', async () => {
    const res = await fetch(`${BASE}/api/students`)
    const headerId = res.headers.get('x-request-id')
    expect(headerId).toMatch(UUID_RE)
    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBe(headerId)
  }, T)

  test('a quoted bug-report id round-trips: inbound X-Request-Id is honored exactly', async () => {
    const res = await fetch(`${BASE}/api/students`, {
      headers: { 'x-request-id': 'bugreport-20260202-001' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBe('bugreport-20260202-001') // grep-able in the server log
    expect(res.headers.get('x-request-id')).toBe('bugreport-20260202-001')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Phase 4 — middleware injection hardening
//    (incident class: request ids appear inside log lines — an attacker-
//     controlled id must never become a log-forgery / spoofing vector)
// ─────────────────────────────────────────────────────────────────────────

describe('regression · spoofed x-request-id is never echoed', () => {
  const SPOOFS: Array<[string, string]> = [
    ['spaces', 'spoof attempt 1'],
    ['unicode', 'spööfed-id-123'],
    ['log-forgery separator', 'a || b || c'],
    ['oversized', 'x'.repeat(500)],
  ]

  for (const [label, spoof] of SPOOFS) {
    test(`spoofed id (${label}) is replaced by a fresh UUID — never echoed`, async () => {
      const res = await fetch(`${BASE}/api/students`, { headers: { 'x-request-id': spoof } })
      expect(res.status).toBe(401)
      const rid = res.headers.get('x-request-id')
      expect(rid).toMatch(UUID_RE)
      expect(rid).not.toBe(spoof)
      const body = (await res.json()) as { requestId: string }
      expect(body.requestId).toBe(rid)
    }, T)
  }

  test('the middleware route/op headers cannot be spoofed into the envelope', async () => {
    // x-scholario-route / x-scholario-op are INTERNAL (middleware-injected);
    // a client sending them directly must not change the envelope or status
    const res = await fetch(`${BASE}/api/students`, {
      headers: { 'x-scholario-route': '/api/teachers', 'x-scholario-op': 'DELETE /api/teachers' },
    })
    expect(res.status).toBe(401) // same gate — route spoofing changes nothing
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. Phase 4 — health probe contracts
//    (incident class: no readiness signal existed; a liveness probe that
//     depends on the DB causes restart storms when the DB degrades)
// ─────────────────────────────────────────────────────────────────────────

describe('regression · health probe shapes', () => {
  test('/health/ready success shape carries the failure-path fields (checks.database)', async () => {
    // GAP (documented): the 503 failure path (DB unreachable) cannot be
    // exercised against the shared dev server — the suite must not kill
    // the DB other suites depend on. The pure classification (503 +
    // status 'unavailable' + checks.database 'failed') is exercised by
    // the route's own branch; here we pin that the fields the failure
    // path populates exist on the success shape.
    const res = await fetch(`${BASE}/health/ready`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      checks: { database: string }
      durationMs: number
    }
    expect(body.status).toBe('ready')
    expect(body.checks).toBeDefined()
    expect(body.checks.database).toBe('ok')
    expect(typeof body.durationMs).toBe('number')
    expect(res.headers.get('cache-control')).toContain('no-store')
  }, T)

  test('/health/live never depends on the database (restart-storm guard)', async () => {
    const res = await fetch(`${BASE}/health/live`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; probe: string }
    expect(body.probe).toBe('live')
    expect(body.status).toBe('ok')
    // no dependency fields — liveness is process-only
    expect(JSON.stringify(body)).not.toContain('checks')
    expect(JSON.stringify(body)).not.toContain('database')
  }, T)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. Phase 1 — envelope hygiene re-pins (compact)
// ─────────────────────────────────────────────────────────────────────────

describe('regression · envelope hygiene (Phase-1 pins, compact)', () => {
  test('failure envelopes never leak internals (prisma/sqlite/paths)', async () => {
    const probes = [
      fetch(`${BASE}/api/students`), // 401
      fetch(`${BASE}/api/auth/login`, { // 422
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{broken',
      }),
      fetch(`${BASE}/api/nonexistent-xyz`), // 404 page
    ]
    for (const probe of probes) {
      const res = await probe
      expect(res.status).toBeGreaterThanOrEqual(400)
      const text = (await res.text()).toLowerCase()
      expect(text).not.toContain('prisma')
      expect(text).not.toContain('sqlite')
      expect(text).not.toContain('/home/z')
    }
  }, T)

  test('security headers ride every response (Phase-1 hardening)', async () => {
    const res = await fetch(`${BASE}/health/live`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  }, T)
})
