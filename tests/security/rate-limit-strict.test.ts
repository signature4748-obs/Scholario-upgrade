/**
 * PHASE 8B (§21) — strict shared-budget rate-limit gate: unit contract.
 *
 * The strict gate (src/lib/security/rate-limit.ts, checkRateLimitStrict /
 * enforceRateLimitStrict) makes the ATOMIC shared row the DECISION for
 * credential profiles (login, login-account, platform-login variants,
 * platform-step-up, password-change). These tests exercise the gate with
 * an INJECTED atomic increment (a serialized counter that mirrors the DB
 * row-lock semantics) — no DB access, no flakiness:
 *
 *   1. allowed while the shared count ≤ limit (count includes this attempt)
 *   2. denied the moment the shared count exceeds the limit (retryAfter ≥ 1)
 *   3. EXACT global budget under a concurrent burst (row-lock semantics:
 *      exactly `limit` of N parallel checks pass)
 *   4. bounded fallback: shared-gate failure/timeout → local-budget decision
 *   5. hermetic degradation: injected clock OR non-strict profile never
 *      touches the shared increment
 *   6. local adoption: after a strict deny, the local bucket is reconciled
 *      so follow-up LOCAL checks on the same instance also deny
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  checkRateLimit,
  checkRateLimitStrict,
  enforceRateLimitStrict,
  resetAllRateLimits,
  RATE_LIMITS,
  type SharedIncrement,
} from '../../src/lib/security/rate-limit'

/** Serialized atomic counter — models the DB row lock exactly. */
function makeAtomicCounter(opts: { failAfter?: number; windowStart?: Date; startAt?: number } = {}): {
  inc: SharedIncrement
  getCalls: () => number
} {
  let count = opts.startAt ?? 0
  let chain: Promise<unknown> = Promise.resolve()
  const state = { calls: 0 }
  const inc: SharedIncrement = async () => {
    // serialize every increment (the row lock) — critical for the burst test
    const run = chain.then(async () => {
      state.calls++
      count++
      if (opts.failAfter !== undefined && count > opts.failAfter) {
        throw new Error('simulated backend outage')
      }
      return { count, windowStart: opts.windowStart ?? new Date() }
    })
    chain = run.catch(() => undefined)
    return run as Promise<{ count: number; windowStart: Date }>
  }
  return { inc, getCalls: () => state.calls }
}

beforeEach(() => {
  resetAllRateLimits()
})

describe('Phase 8B §21 · strict shared-budget gate', () => {
  test('allowed while shared count ≤ limit; remaining reflects the global truth', async () => {
    const counter = makeAtomicCounter({ startAt: 4 })
    // login limit = 8; this attempt is the 5th (count=5) → allowed, 3 remaining.
    const r = await checkRateLimitStrict('rl:test:login', RATE_LIMITS.login, {
      force: true,
      sharedIncrement: counter.inc,
    })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(RATE_LIMITS.login.limit - 5)
  })

  test('denied once the shared count exceeds the limit (retryAfter ≥ 1s)', async () => {
    const counter = makeAtomicCounter({ startAt: 8, windowStart: new Date(Date.now() - 1000) })
    const r = await checkRateLimitStrict('rl:test:login2', RATE_LIMITS.login, {
      force: true,
      sharedIncrement: counter.inc,
    })
    // this attempt is the 9th (count=9) > limit 8 → denied
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  test('EXACT global budget under a concurrent burst: exactly `limit` of 20 pass', async () => {
    const counter = makeAtomicCounter()
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkRateLimitStrict('rl:test:burst', RATE_LIMITS.login, {
          force: true,
          sharedIncrement: counter.inc,
        }),
      ),
    )
    const allowed = verdicts.filter((v) => v.allowed).length
    expect(allowed).toBe(RATE_LIMITS.login.limit) // 8 — not 8-per-instance
    expect(verdicts.length - allowed).toBe(12)
  })

  test('bounded fallback: shared-gate failure degrades to the local budget (first local attempt allowed)', async () => {
    const counter = makeAtomicCounter({ failAfter: 0 })
    const r = await checkRateLimitStrict('rl:test:fallback', RATE_LIMITS.login, {
      force: true,
      sharedIncrement: counter.inc,
    })
    expect(r.allowed).toBe(true) // local budget decided — availability kept
    // and the local bucket now counts it
    const local = checkRateLimit('rl:test:fallback', RATE_LIMITS.login)
    expect(local.allowed).toBe(true)
    expect(local.remaining).toBe(RATE_LIMITS.login.limit - 2)
  })

  test('hermetic: injected clock (now) never touches the shared increment', async () => {
    const counter = makeAtomicCounter()
    const r = await checkRateLimitStrict('rl:test:hermetic', RATE_LIMITS.login, {
      now: Date.now(),
      force: true,
      sharedIncrement: counter.inc,
    })
    expect(r.allowed).toBe(true)
    expect(counter.getCalls()).toBe(0) // clock-injected → local-only, always
  })

  test('hermetic: non-strict profile never touches the shared increment', async () => {
    const counter = makeAtomicCounter()
    const r = await checkRateLimitStrict('rl:test:export', RATE_LIMITS.export, {
      force: true,
      sharedIncrement: counter.inc,
    })
    expect(r.allowed).toBe(true)
    expect(counter.getCalls()).toBe(0) // export stays fire-and-forget
  })

  test('local adoption: a strict deny reconciles the local bucket (follow-up local check denies too)', async () => {
    const counter = makeAtomicCounter({ startAt: 8, windowStart: new Date(Date.now() - 2000) })
    const r = await checkRateLimitStrict('rl:test:adopt', RATE_LIMITS.login, {
      force: true,
      sharedIncrement: counter.inc,
    })
    expect(r.allowed).toBe(false) // count=9
    const local = checkRateLimit('rl:test:adopt', RATE_LIMITS.login)
    expect(local.allowed).toBe(false) // local bucket adopted ≥ limit
  })

  test('enforceRateLimitStrict throws RATE_LIMITED-shaped AppError on deny', async () => {
    const counter = makeAtomicCounter({ startAt: 8, windowStart: new Date(Date.now() - 2000) })
    let thrown: unknown
    try {
      await enforceRateLimitStrict('rl:test:throw', RATE_LIMITS.loginAccount, {
        force: true,
        sharedIncrement: counter.inc,
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeDefined()
    const err = thrown as { code?: string; headers?: Record<string, string> }
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.headers?.['Retry-After']).toBeDefined()
  })
})
