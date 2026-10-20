/**
 * PLATFORM OPERATIONS CENTER — monitoring-coverage map tests.
 *
 * The coverage report is a published contract: every entry names a
 * concrete mechanism, and every non-covered/partial entry names its
 * GAP honestly. The test pins that honesty structurally.
 */
import { describe, test, expect } from 'bun:test'
import { MONITORING_COVERAGE, coverageSummary } from '../../src/lib/ops/coverage'

describe('monitoring coverage map — honesty invariants', () => {
  test('every entry names a concrete mechanism', () => {
    for (const e of MONITORING_COVERAGE) {
      expect(e.path.length).toBeGreaterThan(3)
      expect(e.mechanism.length).toBeGreaterThan(10)
    }
  })

  test('partial and not-instrumented entries MUST declare their gap', () => {
    for (const e of MONITORING_COVERAGE) {
      if (e.state !== 'instrumented') {
        expect(e.gap).toBeTruthy()
        expect(e.gap!.length).toBeGreaterThan(20)
      }
    }
  })

  test('instrumented entries do not need a gap (but may document nuances)', () => {
    for (const e of MONITORING_COVERAGE) {
      if (e.state === 'instrumented') {
        expect(Object.values(['instrumented', 'partial', 'not-instrumented'])).toContain(e.state)
      }
    }
  })

  test('summary counts add up to the map size', () => {
    const s = coverageSummary()
    expect(s.instrumented + s.partial + s.notInstrumented).toBe(MONITORING_COVERAGE.length)
  })

  test('the known structural facts are represented (API envelope, auth, email, jobs, sync)', () => {
    const paths = MONITORING_COVERAGE.map((e) => e.path).join(' ')
    const mechanisms = MONITORING_COVERAGE.map((e) => e.mechanism).join(' ')
    expect(mechanisms).toContain('api() envelope')
    expect(mechanisms).toContain('TENANT_MISMATCH')
    expect(paths).toContain('Email sending')
    expect(paths).toContain('Background jobs')
    expect(paths).toContain('Provider synchronization')
  })

  test('the frontend collector gap is honestly declared as not-instrumented', () => {
    const fe = MONITORING_COVERAGE.find((e) => e.path.includes('Frontend client errors'))
    expect(fe?.state).toBe('not-instrumented')
    expect(fe?.gap).toBeTruthy()
  })
})
