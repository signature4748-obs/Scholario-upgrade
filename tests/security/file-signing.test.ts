import { describe, test, expect, beforeEach } from 'bun:test'
import { signFileToken, verifyFileToken } from '@/lib/security/file-signing'

beforeEach(() => {
  delete process.env.FILE_SIGNING_SECRET
})

describe('signed file-access tokens', () => {
  test('sign → verify roundtrip for the same file + scope', () => {
    const { token } = signFileToken('photo-abc123.jpg', 'teachers', 3600, 1_000_000)
    expect(verifyFileToken('photo-abc123.jpg', 'teachers', token, 1_000_001)).toBe(true)
  })

  test('expires after the TTL', () => {
    const t0 = 2_000_000
    const { token } = signFileToken('doc-1.pdf', 'admissions', 60, t0)
    expect(verifyFileToken('doc-1.pdf', 'admissions', token, t0 + 59_000)).toBe(true)
    expect(verifyFileToken('doc-1.pdf', 'admissions', token, t0 + 61_000)).toBe(false)
  })

  test('rejects absurdly far-future expiries (minted elsewhere)', () => {
    const far = Date.now() + 100 * 24 * 3600 * 1000
    const token = `v1.${far}.deadbeef`
    expect(verifyFileToken('x.pdf', 'admissions', token)).toBe(false)
  })

  test('token is bound to ONE file id (cross-file replay fails)', () => {
    const { token } = signFileToken('doc-1.pdf', 'admissions', 3600, 1_000_000)
    expect(verifyFileToken('doc-2.pdf', 'admissions', token, 1_000_001)).toBe(false)
  })

  test('token is bound to ONE scope family (cross-scope replay fails)', () => {
    const { token } = signFileToken('doc-1.pdf', 'admissions', 3600, 1_000_000)
    expect(verifyFileToken('doc-1.pdf', 'teachers', token, 1_000_001)).toBe(false)
  })

  test('tampered tokens fail (format, mac, garbage)', () => {
    const { token } = signFileToken('photo.png', 'teachers', 3600, 1_000_000)
    expect(verifyFileToken('photo.png', 'teachers', token.slice(0, -4) + '0000', 1_000_001)).toBe(false)
    expect(verifyFileToken('photo.png', 'teachers', 'garbage')).toBe(false)
    expect(verifyFileToken('photo.png', 'teachers', null)).toBe(false)
    expect(verifyFileToken('photo.png', 'teachers', undefined)).toBe(false)
    expect(verifyFileToken('photo.png', 'teachers', 'v1.abc.def')).toBe(false)
    expect(verifyFileToken('photo.png', 'teachers', '')).toBe(false)
  })

  test('tokens carry no session credential material', () => {
    const { token, expiresAt } = signFileToken('x.jpg', 'teachers', 3600, 1_000_000)
    // format is EXACTLY: v1.<epoch-ms expiry>.<64-hex mac> — no session
    // token, no user id, no bearer material embedded anywhere.
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('v1')
    expect(parts[1]).toBe(String(expiresAt))
    expect(parts[1]).toMatch(/^\d+$/)
    expect(parts[2]).toMatch(/^[a-f0-9]{64}$/)
    expect(token.length).toBeLessThan(120)
  })
})
