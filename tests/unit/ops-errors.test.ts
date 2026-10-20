/**
 * PLATFORM OPERATIONS CENTER — error fingerprinting unit tests.
 *
 * The grouping contract (mission §7):
 *   · the SAME defect recurring must land on the SAME fingerprint
 *     (numbers/ids in messages and paths are normalized away);
 *   · DIFFERENT defects (different routes/statuses/categories) must
 *     NOT collapse into one group;
 *   · sanitized messages never carry credentials/long hex tokens
 *     (redactDetail is applied at capture time).
 */
import { describe, test, expect } from 'bun:test'
import {
  errorFingerprint,
  normalizeMessage,
  normalizeRouteShape,
  sanitizeErrorMessage,
} from '../../src/lib/ops/errors'

describe('normalizeRouteShape', () => {
  test('numeric path segments collapse to {id}', () => {
    expect(normalizeRouteShape('/api/students/123/fees')).toBe('/api/students/{id}/fees')
  })

  test('uuid segments collapse to {id}', () => {
    expect(normalizeRouteShape('/api/platform/schools/550e8400-e29b-41d4-a716-446655440000/suspend')).toBe(
      '/api/platform/schools/{id}/suspend',
    )
  })

  test('query strings are dropped', () => {
    expect(normalizeRouteShape('/api/students?page=2&x=1')).toBe('/api/students')
  })

  test('null route stays null', () => {
    expect(normalizeRouteShape(null)).toBeNull()
  })
})

describe('normalizeMessage', () => {
  test('numbers are normalized so timing jitter groups together', () => {
    expect(normalizeMessage('P2028: transaction timed out after 5001ms')).toBe(
      normalizeMessage('P2028: transaction timed out after 5002ms'),
    )
  })

  test('uuids in messages are normalized', () => {
    expect(normalizeMessage('user 550e8400-e29b-41d4-a716-446655440000 missing')).toBe(
      normalizeMessage('user 9c8d7e6f-5a4b-3c2d-1e0f-998877665544 missing'),
    )
  })

  test('different error classes stay different', () => {
    expect(normalizeMessage('P1001 cannot reach database')).not.toBe(normalizeMessage('P2002 unique constraint'))
  })
})

describe('errorFingerprint — stable grouping', () => {
  test('recurring occurrences of the same defect share one fingerprint', () => {
    const a = errorFingerprint({
      category: 'http',
      statusCode: 500,
      route: '/api/students/abc123def456ghi789jkl',
      provider: null,
      message: 'DATABASE_FAILURE: connection reset (took 5021ms)',
    })
    const b = errorFingerprint({
      category: 'http',
      statusCode: 500,
      route: '/api/students/zzz999yyy888xxx777www',
      provider: null,
      message: 'DATABASE_FAILURE: connection reset (took 5099ms)',
    })
    expect(a).toBe(b)
  })

  test('different status codes produce different groups', () => {
    const a = errorFingerprint({ category: 'http', statusCode: 500, message: 'boom' })
    const b = errorFingerprint({ category: 'http', statusCode: 503, message: 'boom' })
    expect(a).not.toBe(b)
  })

  test('different categories produce different groups', () => {
    const a = errorFingerprint({ category: 'http', statusCode: 500, message: 'boom' })
    const b = errorFingerprint({ category: 'provider_sync', statusCode: 500, message: 'boom' })
    expect(a).not.toBe(b)
  })

  test('different providers produce different groups', () => {
    const a = errorFingerprint({ category: 'provider_sync', statusCode: null, provider: 'vercel', message: 'x' })
    const b = errorFingerprint({ category: 'provider_sync', statusCode: null, provider: 'resend', message: 'x' })
    expect(a).not.toBe(b)
  })
})

describe('sanitizeErrorMessage — capture-time redaction', () => {
  test('long hex tokens are redacted', () => {
    const token = 'a'.repeat(80)
    const out = sanitizeErrorMessage(`auth failed with token ${token}`)
    expect(out).not.toContain(token)
    expect(out).toContain('[redacted-token]')
  })

  test('password= assignments are redacted', () => {
    const out = sanitizeErrorMessage('login failed password=hunter2 case')
    expect(out).not.toContain('hunter2')
  })

  test('Error objects keep name + message but no stack', () => {
    const e = new Error('specific failure')
    const out = sanitizeErrorMessage(e)
    expect(out).toContain('Error: specific failure')
    expect(out).not.toContain('at ')
  })

  test('non-error inputs degrade to strings safely', () => {
    expect(typeof sanitizeErrorMessage({ weird: true })).toBe('string')
    expect(sanitizeErrorMessage(null, 'fallback message')).toBe('fallback message')
  })
})
