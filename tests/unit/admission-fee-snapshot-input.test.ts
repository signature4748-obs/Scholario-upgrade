/**
 * PR-3 · GATE 2 — focused unit tests for the fee-snapshot request
 * sanitizer (the narrow server boundary's input contract).
 *
 * Proves the boundary's payload can NEVER carry tenant authority or
 * fee configuration:
 *   · unknown authority keys (schoolId/tenantId/feeHeads/admissionFees/
 *     a full FeeConfig) are structurally dropped
 *   · per-entry junk (unknown ids, bad quantities) is dropped — never
 *     clamped into money
 *   · the ONLY client-entered money (customDiscountValue) is bounded
 *     and honestly rejected (VALIDATION_FAILED) outside 0..500000
 *   · eligibility flags accept booleans only
 */
import { describe, test, expect } from 'bun:test'
import { sanitizeFeeSnapshotRequest } from '@/lib/admission/fee-snapshot-input'
import { AppError } from '@/lib/security/errors'
import { defaultFeeDataState } from '@/lib/admission/fee-config'

describe('sanitizeFeeSnapshotRequest · shape validation', () => {
  test('non-object bodies are rejected with VALIDATION_FAILED', () => {
    for (const body of [null, 'string', 42, [], true]) {
      let err: unknown
      try {
        sanitizeFeeSnapshotRequest(body)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('VALIDATION_FAILED')
      expect((err as AppError).status).toBe(422)
    }
  })

  test('feeState that is not an object is rejected', () => {
    let err: unknown
    try {
      sanitizeFeeSnapshotRequest({ feeState: 'nope' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('VALIDATION_FAILED')
  })

  test('examGroups that is not an object is rejected', () => {
    let err: unknown
    try {
      sanitizeFeeSnapshotRequest({ feeState: { examGroups: 7 } })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('VALIDATION_FAILED')
  })

  test('an absent body object yields the honest defaults', () => {
    const req = sanitizeFeeSnapshotRequest({})
    expect(req.className).toBe('')
    expect(req.feeState).toEqual(defaultFeeDataState)
    expect(req.flags).toBeUndefined()
  })
})

describe('sanitizeFeeSnapshotRequest · authority keys cannot enter', () => {
  test('schoolId / tenantId / fee configuration keys are dropped, not read', () => {
    const req = sanitizeFeeSnapshotRequest({
      schoolId: 'tenant-b-id',
      tenantId: 'tenant-b-id',
      feeHeads: [{ id: 'X', category: 'Registration', defaultAmount: 999999 }],
      admissionFees: { transportFee: 888888, hostelFee: 777777 },
      feeConfig: { feeHeads: [], booksMaster: [] },
      totals: { grossFee: 123, netTotal: 456 },
      className: 'Class 7',
    })
    // Only the accepted input survived; the sanitized request has no
    // field through which any of the injected values could travel.
    expect(req.className).toBe('Class 7')
    expect(Object.keys(req).sort()).toEqual(['className', 'feeState', 'flags'])
    expect(req.flags).toBeUndefined()
  })
})

describe('sanitizeFeeSnapshotRequest · selections hygiene', () => {
  test('valid selections survive; junk quantities and ids are dropped', () => {
    const req = sanitizeFeeSnapshotRequest({
      feeState: {
        bookSelections: {
          'BK-1': 2, // valid
          'BK-0': 0, // zero → absent
          'BK-neg': -3, // negative → dropped
          'BK-frac': 1.5, // non-integer → dropped
          'BK-str': 'many', // non-number → dropped
          '': 1, // empty id → dropped
        },
        uniformSelections: { 'UN-1': 1 },
        examGroups: { unitTest: true, termExam: 'yes', customGroups: 1 },
        transportSelected: true,
        hostelSelected: 'true',
        discountCode: 'SIBLING',
        customDiscountValue: 2500,
      },
    })
    expect(req.feeState.bookSelections).toEqual({ 'BK-1': 2 })
    expect(req.feeState.uniformSelections).toEqual({ 'UN-1': 1 })
    // non-boolean exam/selection flags degrade to false (never truthy)
    expect(req.feeState.examGroups).toEqual({ unitTest: true, termExam: false, customGroups: false })
    expect(req.feeState.transportSelected).toBe(true)
    expect(req.feeState.hostelSelected).toBe(false)
    expect(req.feeState.discountCode).toBe('SIBLING')
    expect(req.feeState.customDiscountValue).toBe(2500)
  })

  test('selection maps are bounded (no unbounded attacker maps)', () => {
    const huge: Record<string, number> = {}
    for (let i = 0; i < 500; i++) huge[`id-${i}`] = 1
    const req = sanitizeFeeSnapshotRequest({ feeState: { bookSelections: huge } })
    expect(Object.keys(req.feeState.bookSelections).length).toBeLessThanOrEqual(200)
  })

  test('ids and strings are length-capped', () => {
    const longId = 'x'.repeat(500)
    const req = sanitizeFeeSnapshotRequest({
      className: 'C'.repeat(500),
      feeState: {
        bookSelections: { [longId]: 1 },
        discountCode: 'D'.repeat(500),
        customDiscountReason: 'R'.repeat(500),
      },
    })
    expect(req.className.length).toBeLessThanOrEqual(64)
    // overlong id is length-capped — a truncated id cannot match any
    // configured catalogue id, so it can never price money
    expect(Object.keys(req.feeState.bookSelections).length).toBe(1)
    expect(Object.keys(req.feeState.bookSelections)[0].length).toBeLessThanOrEqual(64)
    expect(req.feeState.discountCode.length).toBeLessThanOrEqual(32)
    expect(req.feeState.customDiscountReason.length).toBeLessThanOrEqual(200)
  })
})

describe('sanitizeFeeSnapshotRequest · the one client money field', () => {
  test('customDiscountValue inside 0..500000 passes through exactly', () => {
    const req = sanitizeFeeSnapshotRequest({ feeState: { customDiscountValue: 499999 } })
    expect(req.feeState.customDiscountValue).toBe(499999)
    const zero = sanitizeFeeSnapshotRequest({ feeState: { customDiscountValue: 0 } })
    expect(zero.feeState.customDiscountValue).toBe(0)
  })

  test('customDiscountValue outside the money bound is REJECTED, never silently zeroed', () => {
    for (const bad of [-1, 500001, Number.NaN, Number.POSITIVE_INFINITY, '5000' as unknown, null as unknown]) {
      let err: unknown
      try {
        sanitizeFeeSnapshotRequest({ feeState: { customDiscountValue: bad } })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('sanitizeFeeSnapshotRequest · eligibility flags', () => {
  test('boolean flags pass; junk flags are ignored', () => {
    const req = sanitizeFeeSnapshotRequest({
      flags: { enableTransport: true, enableHostel: 'yes', evil: 'x' },
    })
    expect(req.flags?.enableTransport).toBe(true)
    expect(req.flags?.enableHostel).toBeUndefined()
    expect((req.flags as Record<string, unknown> | undefined)?.evil).toBeUndefined()
  })

  test('a non-object flags value yields undefined (no crash)', () => {
    const req = sanitizeFeeSnapshotRequest({ flags: 'both' })
    expect(req.flags).toBeUndefined()
  })
})
