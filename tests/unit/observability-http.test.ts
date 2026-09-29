/**
 * PHASE 4 (item 10) — UNIT tests: request-id utilities.
 *
 * Pure-function scope: NO database, NO HTTP.
 *
 * Contract under test (src/lib/observability/http.ts):
 *   · sanitizeRequestId accepts ONLY short opaque tokens
 *     ([A-Za-z0-9:_-]{8,128}) — the client correlation channel
 *   · everything else (spaces, unicode, control chars, newlines, quotes,
 *     too-short, too-long, empty, null) is rejected — request ids end up
 *     inside log lines, so they must never be an injection/forgery vector
 *   · newRequestId() mints a fresh UUID (v4) every call
 */
import { describe, test, expect } from 'bun:test'
import { sanitizeRequestId, newRequestId } from '@/lib/observability/http'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('sanitizeRequestId · valid correlation ids', () => {
  test('accepts an ordinary alphanumeric id', () => {
    expect(sanitizeRequestId('req12345')).toBe('req12345')
  })

  test('accepts the full allowed charset (letters, digits, colon, underscore, hyphen)', () => {
    expect(sanitizeRequestId('A-b_C:9xYZ0123')).toBe('A-b_C:9xYZ0123')
  })

  test('accepts the minimum length (8) and the maximum length (128)', () => {
    expect(sanitizeRequestId('abcd1234')).toBe('abcd1234')
    expect(sanitizeRequestId('i'.repeat(128))).toBe('i'.repeat(128))
  })

  test('accepts a UUID-shaped id', () => {
    const id = newRequestId()
    expect(sanitizeRequestId(id)).toBe(id)
  })
})

describe('sanitizeRequestId · rejection (log-forgery / injection defense)', () => {
  const REJECTED = [
    ['spaces', 'abc defgh'],
    ['leading space', ' abcdefgh'],
    ['unicode', 'ünïcode-1234'],
    ['emoji', '🙂1234567'],
    ['newline injection', 'abc\ndefgh'],
    ['carriage return', 'abcdef\rgh'],
    ['tab', 'abcd\tfgh'],
    ['nul byte', 'abcd\x00fgh'],
    ['ansi escape (log forgery)', 'abc\x1b[31mdefg'],
    ['quotes', 'abc"defgh'],
    ['angle brackets (HTML sink)', 'abcdef<gh>'],
    ['sql-ish punctuation', 'abcd;efgh'],
    ['equals sign', 'abcd=efgh'],
    ['too short (7)', 'abc1234'],
    ['too long (129)', 'x'.repeat(129)],
    ['empty string', ''],
  ] as const

  test('every hostile / malformed id is rejected with null', () => {
    for (const [label, raw] of REJECTED) {
      expect(sanitizeRequestId(raw)).toBeNull(`expected rejection for ${label}`)
    }
  })

  test('null / undefined input is rejected (not an error)', () => {
    expect(sanitizeRequestId(null)).toBeNull()
    expect(sanitizeRequestId(undefined)).toBeNull()
  })

  test('an over-long valid-charset id is rejected even though the charset is fine', () => {
    // 200 chars of allowed characters — must still be dropped (log-line hygiene)
    expect(sanitizeRequestId('a'.repeat(200))).toBeNull()
  })
})

describe('newRequestId', () => {
  test('mints a UUID v4', () => {
    const id = newRequestId()
    expect(id).toMatch(UUID_RE)
  })

  test('mints distinct ids on successive calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRequestId()))
    expect(ids.size).toBe(200)
  })
})
