/**
 * preload-live-fetch — deterministic state-machine unit tests.
 *
 * No network, no DB, no server: the original fetch is a scripted mock
 * and the wrapper (createLiveFetch) is exercised directly, mirroring
 * tests/unit/live-http-write.test.ts's approach for the per-suite rail.
 *
 * The preload itself is ALREADY installed globally via bunfig.toml the
 * moment this test process boots (that is the feature) — these tests
 * verify the wrapper's CONTRACT with their own injected mock + bases,
 * plus the global-install invariants (idempotence, kill switch never
 * re-wrapping, etc.).
 */
import { describe, test, expect } from 'bun:test'
import {
  createLiveFetch,
  classifyTransportError,
  eligibleOrigins,
  installLiveFetchPreload,
} from '../helpers/preload-live-fetch'

// ── test doubles ────────────────────────────────────────────────────────

const BASE = 'http://testsrv.local:3100'
const BASES = new Set([BASE])

function refusedError(): Error {
  const e = new Error('Unable to connect. Is the computer able to access the url?')
  ;(e as NodeJS.ErrnoException).code = 'ECONNREFUSED'
  return e
}
function resetError(): Error {
  const e = new Error('The socket connection was closed unexpectedly.')
  ;(e as NodeJS.ErrnoException).code = 'ECONNRESET'
  return e
}

/** Scriptable fake fetch: scripts[i] is a fn or Response for attempt i+1. */
function scriptableFetch(
  scripts: Array<Error | Response | (() => Error | Response)>,
  calls: { n: number; method?: string }[] = [],
) {
  let i = 0
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ n: i, method: (init?.method ?? 'GET').toUpperCase() })
    const s = scripts[Math.min(i, scripts.length - 1)]
    i++
    const v = typeof s === 'function' ? s() : s
    if (v instanceof Error) throw v
    return v
  }) as typeof fetch
  return { fn, calls }
}

const jsonResponse = (status = 200, body: unknown = { ok: true }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

// Fast budgets for tests.
const FAST = { deadlineMs: 2_000, perAttemptMs: 250, maxAttempts: 50, origins: BASES }

// ── classification primitives ───────────────────────────────────────────

describe('classifyTransportError', () => {
  test('refused family → never-delivered (any method safe to re-issue)', () => {
    const e = new Error('Unable to connect.')
    ;(e as NodeJS.ErrnoException).code = 'ECONNREFUSED'
    expect(classifyTransportError(e)).toBe('never-delivered')
    const dns = new Error('getaddrinfo EAI_AGAIN')
    ;(dns as NodeJS.ErrnoException).code = 'EAI_AGAIN'
    expect(classifyTransportError(dns)).toBe('never-delivered')
  })

  test('reset family → ambiguous (may have been delivered)', () => {
    const e = new Error('socket hang up')
    ;(e as NodeJS.ErrnoException).code = 'ECONNRESET'
    expect(classifyTransportError(e)).toBe('ambiguous')
    const agg = new Error('fetch failed')
    expect(classifyTransportError(agg)).toBe('ambiguous')
  })

  test('everything else → deterministic (HTTP statuses, validation, aborts)', () => {
    expect(classifyTransportError(new Error('boom'))).toBe('deterministic')
    expect(classifyTransportError('not an error')).toBe('deterministic')
    expect(classifyTransportError(new TypeError("Cannot read properties of undefined"))).toBe('deterministic')
  })
})

// ── wrapper state machine ───────────────────────────────────────────────

describe('createLiveFetch · transport state machine', () => {
  test('refused GET → retried until success, response passthrough intact', async () => {
    const { fn, calls } = scriptableFetch([refusedError(), refusedError(), jsonResponse(200, { ok: true, n: 1 })])
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/x`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, n: 1 })
    expect(calls.length).toBe(3)
  })

  test('refused POST with a string body → retried (never-delivered is safe for ANY method)', async () => {
    const { fn, calls } = scriptableFetch([refusedError(), jsonResponse(201, { id: 'abc' })])
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/orders`, {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST'])
  })

  test('reset GET → retried (idempotent method)', async () => {
    const { fn, calls } = scriptableFetch([resetError(), jsonResponse(200)])
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/y`)
    expect(res.status).toBe(200)
    expect(calls.length).toBe(2)
  })

  test('reset POST → rethrown IMMEDIATELY, exactly one attempt (fail-closed: the write may have landed)', async () => {
    const { fn, calls } = scriptableFetch([resetError(), jsonResponse(200, { never: 'used' })])
    await expect(
      createLiveFetch(fn, FAST)(`${BASE}/api/orders`, { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ code: 'ECONNRESET' })
    // One attempt only — the scripted second response was never consumed.
    expect(calls.length).toBe(1)
  })

  test('abandoned-socket timeout on GET → cut at perAttemptMs and retried', async () => {
    let n = 0
    // Signal-aware hang: like real fetch, an aborted attempt REJECTS
    // (mocks that ignore the signal would hang the wrapper forever).
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      n++
      if (n === 1) {
        await new Promise<never>((_r, reject) => {
          const t = setTimeout(() => reject(new Error('unreachable')), 5_000)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
          })
        })
      }
      return jsonResponse(200, { fresh: true })
    }) as typeof fetch
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/slow`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ fresh: true })
  })

  test('abandoned-socket timeout on POST → rethrown (ambiguous + non-idempotent)', async () => {
    // Signal-aware eternal hang — the per-attempt timeout must surface it.
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<never>((_r, reject) => {
        const t = setTimeout(() => reject(new Error('unreachable')), 60_000)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
        })
      })
    }) as typeof fetch
    const t0 = Date.now()
    await expect(
      createLiveFetch(fn, FAST)(`${BASE}/api/orders`, { method: 'POST', body: '{}' }),
    ).rejects.toBeTruthy()
    expect(Date.now() - t0).toBeLessThan(2_000) // per-attempt cut, no deadline burn
  })

  test('HTTP 500 → returned exactly once (product errors never retried, never synthesized)', async () => {
    const { fn, calls } = scriptableFetch([jsonResponse(500, { error: 'boom' })])
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/z`)
    expect(res.status).toBe(500)
    expect(calls.length).toBe(1)
  })

  test('non-eligible origin (deliberate dead port) → PASSES THROUGH, original error, one attempt', async () => {
    const { fn, calls } = scriptableFetch([refusedError()])
    const wrapped = createLiveFetch(fn, FAST)
    // :1 is NOT in BASES → the wrapper must not retry (dead-port probes
    // like supabase-auth-linking's http://127.0.0.1:1 keep instant failure).
    await expect(wrapped('http://127.0.0.1:1/token')).rejects.toBeTruthy()
    expect(calls.length).toBe(1)
  })

  test('stream body + refused → rethrown immediately (single-use body cannot be re-issued)', async () => {
    const { fn, calls } = scriptableFetch([refusedError()])
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close() } })
    await expect(
      createLiveFetch(fn, FAST)(`${BASE}/api/upload`, { method: 'POST', body: stream }),
    ).rejects.toBeTruthy()
    expect(calls.length).toBe(1)
  })

  test('Request object WITH a body + refused → fail-closed (no re-issue of a consumed-body request)', async () => {
    const { fn, calls } = scriptableFetch([refusedError()])
    const req = new Request(`${BASE}/api/orders`, { method: 'POST', body: '{"x":1}' })
    await expect(createLiveFetch(fn, FAST)(req)).rejects.toBeTruthy()
    expect(calls.length).toBe(1)
  })

  test('Request object WITHOUT a body (GET) + refused → retried', async () => {
    const { fn, calls } = scriptableFetch([refusedError(), jsonResponse(200)])
    const req = new Request(`${BASE}/api/q`)
    const res = await createLiveFetch(fn, FAST)(req)
    expect(res.status).toBe(200)
    expect(calls.length).toBe(2)
  })

  test('caller abort → rethrown immediately, no retry', async () => {
    const { fn, calls } = scriptableFetch([refusedError(), jsonResponse(200, { no: 'retry' })])
    const ac = new AbortController()
    ac.abort()
    await expect(
      createLiveFetch(fn, FAST)(`${BASE}/api/x`, { signal: ac.signal }),
    ).rejects.toBeTruthy()
    expect(calls.length).toBe(1)
  })

  test('deadline exhaustion → the ORIGINAL transport error is rethrown unchanged', async () => {
    const { fn, calls } = scriptableFetch([refusedError()])
    await expect(
      createLiveFetch(fn, { deadlineMs: 400, perAttemptMs: 100, maxAttempts: 50, origins: BASES })(
        `${BASE}/api/dead`,
      ),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    expect(calls.length).toBeGreaterThan(1) // it DID retry…
    expect(calls.length).toBeLessThan(50) // …but the deadline was the binding ceiling
  })

  test('success on first attempt → single call, response untouched', async () => {
    const { fn, calls } = scriptableFetch([jsonResponse(204)])
    const res = await createLiveFetch(fn, FAST)(`${BASE}/api/ok`)
    expect(res.status).toBe(204)
    expect(calls.length).toBe(1)
  })
})

// ── global-install invariants (the bunfig preload path) ─────────────────

describe('installLiveFetchPreload · global install invariants', () => {
  test('the preload is installed in THIS test process (bunfig.toml contract)', () => {
    expect(globalThis.__scholarioLiveFetchPreload).toBeDefined()
    expect(globalThis.__scholarioLiveFetchPreload!.version).toBe('1.0.0')
    // The default CI/dev base is always protected.
    expect(globalThis.__scholarioLiveFetchPreload!.origins).toContain('http://localhost:3000')
  })

  test('re-install is a NO-OP (idempotent — never double-wrap)', () => {
    const before = globalThis.fetch
    installLiveFetchPreload()
    installLiveFetchPreload()
    expect(globalThis.fetch).toBe(before)
  })

  test('eligibleOrigins reads the documented base-URL env contract', () => {
    const prev = process.env.TENANT_TEST_BASE
    process.env.TENANT_TEST_BASE = 'http://localhost:3100'
    try {
      expect(eligibleOrigins()).toContain('http://localhost:3100')
      expect(eligibleOrigins()).toContain('http://localhost:3000') // default kept
    } finally {
      if (prev === undefined) delete process.env.TENANT_TEST_BASE
      else process.env.TENANT_TEST_BASE = prev
    }
  })
})
