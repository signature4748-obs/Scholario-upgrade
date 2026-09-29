import { describe, test, expect, beforeEach } from 'bun:test'
import {
  RATE_LIMITS,
  checkRateLimit,
  resetRateLimit,
  resetAllRateLimits,
  enforceRateLimit,
  clientIpFromHeaders,
  loginIpKey,
  loginAccountKey,
} from '@/lib/security/rate-limit'
import { AppError } from '@/lib/security/errors'

beforeEach(() => {
  resetAllRateLimits()
})

describe('central rate limiter — counting semantics', () => {
  test('allows events under the limit and reports remaining allowance', () => {
    const p = { name: 't', limit: 3, windowMs: 60_000 }
    const t0 = 1_000_000
    expect(checkRateLimit('k', p, t0).allowed).toBe(true)
    expect(checkRateLimit('k', p, t0 + 1).allowed).toBe(true)
    const r = checkRateLimit('k', p, t0 + 2)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(0)
  })

  test('blocks at the limit with a positive retry-after', () => {
    const p = { name: 't', limit: 2, windowMs: 60_000 }
    const t0 = 5_000_000
    checkRateLimit('k', p, t0)
    checkRateLimit('k', p, t0 + 1)
    const blocked = checkRateLimit('k', p, t0 + 2)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  test('window rollover resets the counter (no abuse escalation involved)', () => {
    const p = { name: 't', limit: 2, windowMs: 1_000 }
    const t0 = 10_000_000
    expect(checkRateLimit('k', p, t0).allowed).toBe(true) // 1 used, no rejection
    // past the plain window → fresh bucket
    expect(checkRateLimit('k', p, t0 + 1_001).allowed).toBe(true)
  })

  test('keys are isolated (account+IP aware buckets)', () => {
    const p = { name: 't', limit: 1, windowMs: 60_000 }
    const t0 = 1
    expect(checkRateLimit('a', p, t0).allowed).toBe(true)
    expect(checkRateLimit('b', p, t0).allowed).toBe(true)
    expect(checkRateLimit('a', p, t0).allowed).toBe(false)
    expect(checkRateLimit('b', p, t0).allowed).toBe(false)
  })

  test('resetRateLimit clears a bucket (successful login clears failures)', () => {
    const p = { name: 't', limit: 2, windowMs: 60_000 }
    checkRateLimit('acct', p, 1)
    checkRateLimit('acct', p, 2)
    expect(checkRateLimit('acct', p, 3).allowed).toBe(false)
    resetRateLimit('acct')
    expect(checkRateLimit('acct', p, 4).allowed).toBe(true)
  })

  test('abuse while blocked escalates the next window (progressive backoff)', () => {
    const p = { name: 't', limit: 1, windowMs: 1_000 }
    const t0 = 100
    checkRateLimit('k', p, t0) // allowed
    checkRateLimit('k', p, t0 + 10) // blocked (1st rejection escalates)
    const blockedLate = checkRateLimit('k', p, t0 + 999)
    expect(blockedLate.allowed).toBe(false)
    // extension = 1 → next window is 2× long; still blocked just past 1s
    expect(checkRateLimit('k', p, t0 + 1_001).allowed).toBe(false)
    // ...but open again after 2s
    expect(checkRateLimit('k', p, t0 + 2_100).allowed).toBe(true)
  })
})

describe('enforceRateLimit — guard behavior', () => {
  test('passes through when allowed', () => {
    expect(() =>
      enforceRateLimit('ok', { name: 't', limit: 5, windowMs: 60_000 })
    ).not.toThrow()
  })

  test('throws AppError RATE_LIMITED with Retry-After when exhausted', () => {
    const p = { name: 't', limit: 1, windowMs: 60_000 }
    enforceRateLimit('bl', p)
    try {
      enforceRateLimit('bl', p)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      const err = e as AppError
      expect(err.code).toBe('RATE_LIMITED')
      expect(err.status).toBe(429)
      expect(err.headers?.['Retry-After']).toBeDefined()
      expect(Number(err.headers!['Retry-After'])).toBeGreaterThan(0)
      // Public message must not leak the key or internals
      expect(err.publicMessage).not.toContain('bl')
    }
  })
})

describe('policy table + key helpers', () => {
  test('central policy table covers the Phase-1 mandated surfaces', () => {
    for (const surface of [
      'login',
      'loginAccount',
      'passwordChange',
      'sessionRevoke',
      'admissionPublic',
      'upload',
      'fileAccess',
      'ai',
      'message',
      'payment',
      'webhook',
    ]) {
      expect(RATE_LIMITS).toHaveProperty(surface)
    }
    // Login limits must be strict (brute-force economics)
    expect(RATE_LIMITS.login.limit).toBeLessThanOrEqual(10)
    expect(RATE_LIMITS.loginAccount.limit).toBeLessThanOrEqual(RATE_LIMITS.login.limit)
  })

  test('login keys are namespaced per IP and per account', () => {
    expect(loginIpKey('1.2.3.4')).toBe('rl:login:ip:1.2.3.4')
    expect(loginAccountKey('a@b.com')).toBe('rl:login:acct:a@b.com')
    expect(loginIpKey('1.2.3.4')).not.toBe(loginAccountKey('1.2.3.4'))
  })
})

describe('clientIpFromHeaders', () => {
  test('takes the first x-forwarded-for value', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
    expect(clientIpFromHeaders(h)).toBe('203.0.113.9')
  })
  test('falls back to x-real-ip, then unknown', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIpFromHeaders(new Headers())).toBe('unknown')
  })
})
