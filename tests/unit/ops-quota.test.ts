/**
 * PLATFORM OPERATIONS CENTER — quota math unit tests.
 *
 * The honesty rules encoded here (mission §4/§5):
 *   · an UNKNOWN limit is never a zero quota, never a percentage, never
 *     a "0 remaining" — quotaMath must return nulls;
 *   · a known limit produces exact percentages + remaining allowance;
 *   · staleness: never-synced (null age) counts as stale; fresh data
 *     counts as fresh.
 */
import { describe, test, expect } from 'bun:test'
import { quotaMath, isStaleMetric } from '../../src/lib/ops/quota'

describe('quotaMath — unknown limits never masquerade as zero', () => {
  test('null limit → null percent + null remaining (NOT zero)', () => {
    expect(quotaMath(12345, null)).toEqual({ percentConsumed: null, remaining: null })
  })

  test('undefined limit → nulls', () => {
    expect(quotaMath(1, undefined)).toEqual({ percentConsumed: null, remaining: null })
  })

  test('zero limit → nulls (a zero "limit" is not a quota)', () => {
    expect(quotaMath(0, 0)).toEqual({ percentConsumed: null, remaining: null })
  })

  test('negative limit → nulls', () => {
    expect(quotaMath(5, -100)).toEqual({ percentConsumed: null, remaining: null })
  })

  test('non-finite value → nulls', () => {
    expect(quotaMath(Number.NaN, 100)).toEqual({ percentConsumed: null, remaining: null })
  })

  test('known limit → exact percentage (1-decimal rounding)', () => {
    expect(quotaMath(50, 200)).toEqual({ percentConsumed: 25, remaining: 150 })
    expect(quotaMath(1, 3)).toEqual({ percentConsumed: 33.3, remaining: 2 })
  })

  test('over-limit values report >100% (not clamped by the math)', () => {
    expect(quotaMath(150, 100)).toEqual({ percentConsumed: 150, remaining: -50 })
  })

  test('zero usage against a known limit → 0% (a real zero, not a missing one)', () => {
    expect(quotaMath(0, 100)).toEqual({ percentConsumed: 0, remaining: 100 })
  })
})

describe('isStaleMetric — freshness honesty', () => {
  test('never-synced (null age) is stale', () => {
    expect(isStaleMetric(null, 90)).toBe(true)
  })

  test('undefined age is stale', () => {
    expect(isStaleMetric(undefined, 90)).toBe(true)
  })

  test('age within threshold is fresh', () => {
    expect(isStaleMetric(89, 90)).toBe(false)
  })

  test('age BEYOND the threshold is stale (boundary itself is still fresh)', () => {
    expect(isStaleMetric(91, 90)).toBe(true)
    expect(isStaleMetric(1200, 90)).toBe(true)
  })
})
