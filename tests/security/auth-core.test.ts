import { describe, test, expect, beforeEach } from 'bun:test'
import { createHash } from 'crypto'
import {
  hashPassword,
  verifyPassword,
  generateToken,
  hashSessionToken,
  sessionCookieOptions,
  isDevSessionBearerEnabled,
  isCrossOriginRequest,
  burnPasswordTiming,
} from '@/lib/auth'

beforeEach(() => {
  // Normalize the env around each test (these flags are read at call time
  // by the exported pure helpers).
  process.env.SCHOLARIO_DEV_BEARER = undefined
})

describe('password primitives (scrypt + timing-safe)', () => {
  test('hash/verify roundtrip', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(stored).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })
  test('wrong password fails; malformed stored hash fails closed', () => {
    const stored = hashPassword('s3cretPass1')
    expect(verifyPassword('wrong', stored)).toBe(false)
    expect(verifyPassword('s3cretPass1', 'not-a-hash')).toBe(false)
    expect(verifyPassword('s3cretPass1', '')).toBe(false)
    expect(verifyPassword('s3cretPass1', 'deadbeef:zzzz')).toBe(false)
  })
  test('salts are per-call (no hash reuse)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })
  test('anti-enumeration timing equalizer runs without throwing', () => {
    expect(() => burnPasswordTiming()).not.toThrow()
  })
})

describe('session token + cookie policy', () => {
  test('tokens are 32-byte random hex (64 chars, unguessable)', () => {
    for (let i = 0; i < 5; i++) {
      const t = generateToken()
      expect(t).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(generateToken()).not.toBe(generateToken())
  })

  test('PHASE 8A · at-rest form is sha256 hex (the platform-plane convention), never the raw token', () => {
    const t = generateToken()
    const h = hashSessionToken(t)
    expect(h).toMatch(/^[a-f0-9]{64}$/) // sha256 digest, hex
    expect(h).toBe(createHash('sha256').update(t).digest('hex')) // exact convention (platform hashToken twin)
    expect(hashSessionToken(t)).toBe(h) // deterministic — it is a lookup key
    expect(h).not.toBe(t) // the stored form is never the wire token
  })

  test('cookie is HttpOnly + SameSite=Lax always; secure ONLY in production', () => {
    const dev = sessionCookieOptions(false)
    expect(dev.httpOnly).toBe(true) // never exposed to browser JavaScript
    expect(dev.sameSite).toBe('lax')
    expect(dev.secure).toBe(false) // http dev preview stays functional

    const prod = sessionCookieOptions(true)
    expect(prod.httpOnly).toBe(true)
    expect(prod.sameSite).toBe('lax')
    expect(prod.secure).toBe(true) // HTTPS-only transport in production
  })
})

describe('dev bearer fallback gating (production isolation)', () => {
  test('DISABLED in production — no env override can re-enable it', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      process.env.SCHOLARIO_DEV_BEARER = '1' // hostile/operator attempt
      expect(isDevSessionBearerEnabled()).toBe(false)
      process.env.SCHOLARIO_DEV_BEARER = undefined
      expect(isDevSessionBearerEnabled()).toBe(false)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
  test('enabled in development for the preview iframe; can be turned off', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(isDevSessionBearerEnabled()).toBe(true)
      process.env.SCHOLARIO_DEV_BEARER = '0'
      expect(isDevSessionBearerEnabled()).toBe(false)
    } finally {
      process.env.NODE_ENV = prev
      process.env.SCHOLARIO_DEV_BEARER = undefined
    }
  })
})

describe('cookie-auth CSRF origin guard', () => {
  test('same-origin requests pass', () => {
    expect(isCrossOriginRequest('https://app.school.io', 'app.school.io')).toBe(false)
    expect(isCrossOriginRequest('http://localhost:3000', 'localhost:3000')).toBe(false)
  })
  test('cross-origin cookie use is detected (host mismatch, incl. port)', () => {
    expect(isCrossOriginRequest('https://evil.example', 'app.school.io')).toBe(true)
    expect(isCrossOriginRequest('https://app.school.io:81', 'app.school.io')).toBe(true)
  })
  test('missing Origin/Host is not treated as cross-origin (non-browser callers)', () => {
    expect(isCrossOriginRequest(null, 'app.school.io')).toBe(false)
    expect(isCrossOriginRequest('https://x.io', null)).toBe(false)
  })
  test('unparseable Origin is treated as hostile', () => {
    expect(isCrossOriginRequest('not a url', 'app.school.io')).toBe(true)
  })
})
