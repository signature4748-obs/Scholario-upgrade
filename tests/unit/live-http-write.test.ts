/**
 * liveWriteFetch — deterministic unit battery (2026-10-24, fee-gateway
 * transport-reliability fix).
 *
 * WHY THIS FILE EXISTS: liveWriteFetch is the write-side transport rail
 * that keeps fee-gateway.test.ts green through supervised dev-server
 * restart windows (the CI flake ledger: one in-flight request dies with
 * ECONNRESET, the next few fail with ECONNREFUSED until respawn) WITHOUT
 * ever blind-retrying a non-idempotent write. Its safety properties are
 * too important to verify only against a live server — this battery pins
 * each property deterministically with a scripted global fetch mock
 * (no network, no DB, no dev server, no timers beyond the explicit
 * per-attempt/deadline budgets).
 *
 * THE PROPERTIES UNDER TEST (each maps to a real failure mode):
 *   1. NEVER-DELIVERED failures (ECONNREFUSED / "Unable to connect" /
 *      EAI_AGAIN, incl. bun's aggregate-cause wrapping) re-issue the
 *      request VERBATIM — safe for ANY method, and the reconcile closure
 *      is never consulted.
 *   2. AMBIGUOUS failures (ECONNRESET / abandoned-socket timeout) NEVER
 *      blind-retry: the closure's DB truth decides — landed → the
 *      route's exact response synthesized ONCE (marked
 *      x-live-http-reconciled: 1, request never re-issued); not landed →
 *      a sound re-issue; probe broken → fail-closed with the ORIGINAL
 *      transport error.
 *   3. snapshot() runs BEFORE the first attempt — a pre-existing row can
 *      never false-green a reconciliation.
 *   4. EVERY HTTP status (500/409 included) is returned exactly once —
 *      product errors are never retried, never synthesized.
 *   5. Deterministic errors and caller aborts are never retried; the
 *      retry budget is deadline-bounded.
 *
 * The scripted outcomes mirror the exact CI signatures observed in runs
 * 39345157812 / 39372509050 / 39991519022-attempt-1 (see
 * tests/helpers/live-http.ts for the full root-cause narrative).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { liveWriteFetch, isNeverDeliveredError, isTransientNetworkError, type LiveWriteReconcile } from '../helpers/live-http'

// ── scripted fetch mock ──────────────────────────────────────────────────

type FetchOutcome =
  | { kind: 'respond'; status: number; body?: unknown }
  | { kind: 'throw'; err: unknown }
  | { kind: 'hang' } // never resolves; rejects on init.signal abort

/** Recorded fetch calls (url/method/signal) — the re-issue evidence. */
let calls: Array<{ url: string; method?: string }> = []
/** The script consumed left-to-right; an exhausted script serves 200s. */
let script: FetchOutcome[] = []

const realFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method })
    const next = script.shift() ?? { kind: 'respond' as const, status: 200, body: {} }
    if (next.kind === 'throw') throw next.err
    if (next.kind === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
        if (init?.signal?.aborted) onAbort()
        else init?.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    return new Response(JSON.stringify(next.body ?? { ok: true }), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
})

function reset(outcomes: FetchOutcome[]): void {
  calls = []
  script = [...outcomes]
}

// ── transport error factories (the exact CI / bun shapes) ────────────────

const refusedCode = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), { code: 'ECONNREFUSED' })
/** bun's fetch surfaces refused connections as this message shape. */
const refusedMsg = () => new TypeError('Unable to connect')
/** bun sometimes wraps the real cause in an aggregate "fetch failed". */
const refusedAggregate = () => Object.assign(new Error('fetch failed'), { cause: refusedCode() })
/** The CI signature: the in-flight request dying as the server is killed. */
const resetErr = () => Object.assign(new Error('The socket connection was closed unexpectedly'), { code: 'ECONNRESET' })
/** Deterministic DNS failure — NOT transient, NOT never-delivered-listed. */
const dnsErr = () => Object.assign(new Error('getaddrinfo ENOTFOUND no-such-host.test'), { code: 'ENOTFOUND' })

// ── recording reconcile closure ──────────────────────────────────────────

function recorder(landed: unknown) {
  const state = { snapshotCalls: 0, detectCalls: 0, respondCalls: 0, lastBefore: undefined as unknown }
  const reconcile: LiveWriteReconcile<unknown, unknown> = {
    snapshot: async () => {
      state.snapshotCalls++
      return 'BASELINE'
    },
    detect: async (before) => {
      state.detectCalls++
      state.lastBefore = before
      return landed
    },
    respond: (l) => {
      state.respondCalls++
      const landed = l as { orderId: string; id: string }
      return {
        status: 200,
        body: { ok: true, data: { orderId: landed.orderId, txnId: landed.id } },
      }
    },
  }
  return { reconcile, state }
}

const URL_UNDER_TEST = 'http://localhost:3100/api/fees/orders'
const POST_INIT: RequestInit = { method: 'POST', body: '{"amount":300}' }

// ── classification sanity (the three-way split the rail depends on) ──────

describe('live-http-write · transport classification primitives', () => {
  test('isNeverDeliveredError: refused by code, by bun message shape, by aggregate cause — but never ECONNRESET', () => {
    expect(isNeverDeliveredError(refusedCode())).toBe(true)
    expect(isNeverDeliveredError(refusedMsg())).toBe(true)
    expect(isNeverDeliveredError(refusedAggregate())).toBe(true)
    expect(isNeverDeliveredError(Object.assign(new Error('lookup EAI_AGAIN'), { code: 'EAI_AGAIN' }))).toBe(true)
    expect(isNeverDeliveredError(resetErr())).toBe(false) // ambiguous, never provably undelivered
    expect(isNeverDeliveredError(dnsErr())).toBe(false)
    expect(isNeverDeliveredError(new Error('fetch failed'))).toBe(false) // unproven aggregate → ambiguous
    // every never-delivered error is also transient (retryable) — the split is by PROOF, not by retryability
    expect(isTransientNetworkError(refusedCode())).toBe(true)
    expect(isTransientNetworkError(resetErr())).toBe(true)
  })
})

// ── liveWriteFetch state machine (12 scenario tests + the 1 above = 13) ──

describe('live-http-write · liveWriteFetch deterministic battery', () => {
  test('NEVER-DELIVERED (all three refused shapes) → the write is re-issued VERBATIM until delivered; the closure is never consulted', async () => {
    reset([
      { kind: 'throw', err: refusedCode() },
      { kind: 'throw', err: refusedMsg() },
      { kind: 'throw', err: refusedAggregate() },
      { kind: 'respond', status: 200, body: { ok: true, delivered: 1 } },
    ])
    const rec = recorder(null)
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 8_000, perAttemptMs: 1_000, maxAttempts: 10, reconcile: rec.reconcile })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, delivered: 1 })
    // four transport attempts, one delivery — the exact CI restart-gap shape
    expect(calls.length).toBe(4)
    expect(calls.every((c) => c.method === 'POST' && c.url === URL_UNDER_TEST)).toBe(true)
    // a refused failure needs no DB truth: the closure was never consulted
    expect(rec.state.snapshotCalls).toBe(1) // baseline captured once, before anything
    expect(rec.state.detectCalls).toBe(0)
    expect(rec.state.respondCalls).toBe(0)
  }, 15_000)

  test('AMBIGUOUS ECONNRESET with the write LANDED → the route response is synthesized from DB rows ONCE, marked, and the request is NEVER re-issued', async () => {
    reset([{ kind: 'throw', err: resetErr() }])
    const rec = recorder({ id: 'txn_1', orderId: 'order_x' })
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile: rec.reconcile })
    expect(calls.length).toBe(1) // never re-issued
    expect(res.headers.get('x-live-http-reconciled')).toBe('1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { orderId: 'order_x', txnId: 'txn_1' } })
    expect(rec.state.detectCalls).toBe(1)
    expect(rec.state.respondCalls).toBe(1)
  }, 10_000)

  test('AMBIGUOUS ECONNRESET with the write NOT landed (DB-verified) → exactly one re-issue delivers the write', async () => {
    reset([{ kind: 'throw', err: resetErr() }, { kind: 'respond', status: 200, body: { ok: true, delivered: 1 } }])
    const rec = recorder(null)
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile: rec.reconcile })
    expect(res.status).toBe(200)
    expect(calls.length).toBe(2)
    expect(rec.state.detectCalls).toBe(1)
    expect(rec.state.respondCalls).toBe(0) // nothing was synthesized — the live response was returned
    expect(res.headers.get('x-live-http-reconciled')).toBeNull()
  }, 10_000)

  test('snapshot() runs BEFORE the first attempt, and detect() receives that exact baseline (the no-false-green precondition)', async () => {
    reset([{ kind: 'throw', err: resetErr() }, { kind: 'respond', status: 200, body: { ok: true } }])
    const order: string[] = []
    const reconcile: LiveWriteReconcile<unknown, unknown> = {
      snapshot: async () => {
        order.push('snapshot')
        // the baseline must be captured before ANY request is issued
        expect(calls.length).toBe(0)
        return 'BASELINE-9f2'
      },
      detect: async (before) => {
        order.push('detect')
        expect(before).toBe('BASELINE-9f2') // detect sees the pre-request baseline, verbatim
        expect(calls.length).toBe(1) // …and runs after the (failed) first attempt
        return null
      },
      respond: () => ({ status: 200, body: {} }),
    }
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile })
    expect(res.status).toBe(200)
    expect(order).toEqual(['snapshot', 'detect'])
  }, 10_000)

  test('a PRE-EXISTING row (in the baseline) is never mistaken for the landed write — no false green, the request is re-issued', async () => {
    reset([{ kind: 'throw', err: resetErr() }, { kind: 'respond', status: 200, body: { ok: true, live: true } }])
    // the suite pattern: snapshot = the ids that existed BEFORE the request
    const dbRows = ['pre-existing-row']
    const reconcile: LiveWriteReconcile<Set<string>, unknown> = {
      snapshot: async () => new Set(dbRows),
      detect: async (before) => {
        const fresh = dbRows.filter((id) => !before.has(id))
        return fresh.length ? { id: fresh[0] } : null // the pre-existing row is NOT fresh
      },
      respond: () => ({ status: 200, body: { ok: true, data: { txnId: 'synthesized-should-not-happen' } } }),
    }
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, live: true }) // the LIVE response, not a synthesis
    expect(res.headers.get('x-live-http-reconciled')).toBeNull()
    expect(calls.length).toBe(2)
  }, 10_000)

  test('detect() THROWING → fail-closed: the ORIGINAL transport error is rethrown, never a re-issue, never a synthesized response', async () => {
    reset([{ kind: 'throw', err: resetErr() }])
    const reconcile: LiveWriteReconcile<unknown, unknown> = {
      snapshot: async () => 'BASELINE',
      detect: async () => {
        throw new Error('probe broken (e.g. DB unreachable)')
      },
      respond: () => ({ status: 200, body: { ok: true } }),
    }
    // the ORIGINAL ECONNRESET — not the probe error, not a fake green
    await expect(liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile })).rejects.toThrow(
      'The socket connection was closed unexpectedly',
    )
    expect(calls.length).toBe(1)
  }, 10_000)

  test('HTTP 500 and HTTP 409 are each returned EXACTLY ONCE — product errors are never retried and never reach the closure', async () => {
    reset([{ kind: 'respond', status: 500, body: { ok: false, code: 'INTERNAL' } }])
    const rec = recorder(null)
    const res500 = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile: rec.reconcile })
    expect(res500.status).toBe(500)
    expect(calls.length).toBe(1)
    expect(rec.state.detectCalls).toBe(0)

    reset([{ kind: 'respond', status: 409, body: { ok: false, code: 'CONFLICT' } }])
    const res409 = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile: rec.reconcile })
    expect(res409.status).toBe(409)
    expect(calls.length).toBe(1)
    expect(rec.state.detectCalls).toBe(0)
  }, 10_000)

  test('a DETERMINISTIC error (ENOTFOUND) is thrown immediately — no retry, no closure consultation', async () => {
    reset([{ kind: 'throw', err: dnsErr() }])
    const rec = recorder(null)
    await expect(liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, reconcile: rec.reconcile })).rejects.toThrow(
      'getaddrinfo ENOTFOUND',
    )
    expect(calls.length).toBe(1)
    expect(rec.state.detectCalls).toBe(0)
  }, 10_000)

  test('a CALLER ABORT is never retried — the abort wins, the closure is never consulted', async () => {
    reset([{ kind: 'hang' }])
    const rec = recorder(null)
    const ac = new AbortController()
    const pending = liveWriteFetch(
      URL_UNDER_TEST,
      { ...POST_INIT, signal: ac.signal },
      { deadlineMs: 10_000, perAttemptMs: 5_000, reconcile: rec.reconcile },
    )
    setTimeout(() => ac.abort(), 50)
    await expect(pending).rejects.toBeInstanceOf(Error)
    expect(calls.length).toBe(1) // never re-issued
    expect(rec.state.detectCalls).toBe(0)
  }, 10_000)

  test('an ABANDONED SOCKET (per-attempt timeout) is AMBIGUOUS: the cut request reconciles against DB truth and synthesizes when landed', async () => {
    reset([{ kind: 'hang' }])
    const rec = recorder({ id: 'txn_2', orderId: 'order_y' })
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000, perAttemptMs: 120, reconcile: rec.reconcile })
    expect(res.headers.get('x-live-http-reconciled')).toBe('1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { orderId: 'order_y', txnId: 'txn_2' } })
    expect(calls.length).toBe(1) // the abandoned attempt is never re-issued once the write is proven landed
    expect(rec.state.detectCalls).toBe(1)
  }, 10_000)

  test('an AMBIGUOUS failure with NO reconcile closure fails CLOSED — a write is never blind-retried', async () => {
    reset([{ kind: 'throw', err: resetErr() }])
    await expect(liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 5_000 })).rejects.toThrow(
      'The socket connection was closed unexpectedly',
    )
    expect(calls.length).toBe(1)
  }, 10_000)

  test('the retry budget is DEADLINE-BOUNDED: an always-refused server exhausts the budget and rethrows the transport error', async () => {
    const many: FetchOutcome[] = Array.from({ length: 30 }, () => ({ kind: 'throw' as const, err: refusedCode() }))
    reset(many)
    const startedAt = Date.now()
    await expect(
      liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 250, perAttemptMs: 50, maxAttempts: 30 }),
    ).rejects.toThrow('connect ECONNREFUSED')
    const elapsed = Date.now() - startedAt
    // retried within the budget, cut BY the budget (300ms first backoff > 250ms deadline → attempt 2 is the last)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.length).toBeLessThan(30)
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)

  test('the COMPOSED restart window: ECONNRESET (ambiguous, not landed) → ECONNREFUSED ×2 (respawn gap) → delivered — the full kill-cycle rail in miniature', async () => {
    reset([
      { kind: 'throw', err: resetErr() },
      { kind: 'throw', err: refusedCode() },
      { kind: 'throw', err: refusedMsg() },
      { kind: 'respond', status: 200, body: { ok: true, delivered: 1 } },
    ])
    const rec = recorder(null) // DB truth says the first delivery died with the server
    const res = await liveWriteFetch(URL_UNDER_TEST, POST_INIT, { deadlineMs: 8_000, perAttemptMs: 1_000, maxAttempts: 10, reconcile: rec.reconcile })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, delivered: 1 })
    expect(calls.length).toBe(4) // one ambiguous delivery + two refused re-issues + one delivered
    expect(rec.state.detectCalls).toBe(1) // the DB proof that gated the ONLY ambiguous re-issue
    expect(rec.state.respondCalls).toBe(0)
  }, 15_000)
})
