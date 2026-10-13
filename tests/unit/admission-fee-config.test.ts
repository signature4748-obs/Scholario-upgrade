import { describe, test, expect } from 'bun:test'
/**
 * PR-3 · GATE 1 — unit tests for the pure fee configuration/calculation
 * layer (src/lib/admission/fee-config.ts + fee-snapshot.ts).
 *
 * Pure-function scope: NO database, NO HTTP, NO stores. Every amount in
 * these fixtures is deliberately ODD (2222, 44444, 4321, …) so a leaked
 * demo literal (1500/15000/60000/18000/45000/850/1200/…) can never pass
 * by coincidence — the behavioral "no fabricated values" proof.
 *
 * Covers the Gate-1 matrix:
 *   A configured fee heads        E missing books
 *   B explicit zero               F missing optional transport/hostel/activity
 *   C missing fee heads           G configured discounts
 *   D configured books            H configured exam fees
 *   I adapter contract at the pure level (no self-declared provenance,
 *     determinism, untrusted-entry hygiene)
 *   J no forbidden fabricated values — validated BEHAVIORALLY
 */
import {
  amountOf,
  isConfiguredAmount,
  normalizeFeeConfig,
  resolveClassBooks,
  defaultFeeDataState,
  type FeeConfig,
  type FeeDataState,
} from '@/lib/admission/fee-config'
import { computeFeeSnapshot } from '@/lib/admission/fee-snapshot'

// ── fixtures ──────────────────────────────────────────────────────────────

const FULL_SETTINGS = {
  feeHeads: [
    { id: 'FH-01', name: 'Registration Fee', category: 'Registration', defaultAmount: 2222 },
    { id: 'FH-02', name: 'Admission Fee', category: 'Admission', defaultAmount: 22222 },
    { id: 'FH-03', name: 'Annual Tuition', category: 'Tuition', defaultAmount: 44444 },
    { id: 'FH-04', name: 'Development', category: 'Development', defaultAmount: 777 },
  ],
  booksMaster: [
    { id: 'BK-A', title: 'English', className: 'Class 1', price: 147 },
    { id: 'BK-B', title: 'Mathematics', className: 'Class 1', price: 131 },
  ],
  discountRules: [
    { id: 'D-1', code: 'FULL_YEAR', name: 'Full Year Advance', type: 'percentage', value: 10 },
    { id: 'D-2', code: 'FLAT', name: 'Flat Waiver', type: 'fixed', value: 501 },
  ],
  examFeeConfig: { unitTestFee: 333, termExamFee: 444, customGroupsFee: 555 },
  admissionFees: {
    transportFee: 4321,
    hostelFee: 54321,
    activityKit: [{ id: 'ak-1', name: 'Art & Craft Kit', price: 77 }],
  },
  uniforms: [{ id: 'U-1', name: 'Summer Set', price: 128 }],
}

const FULL_CONFIG: FeeConfig = normalizeFeeConfig(FULL_SETTINGS)

const FULL_SELECTION: FeeDataState = {
  ...defaultFeeDataState,
  bookSelections: { 'BK-A': 2 },
  uniformSelections: { 'U-1': 1 },
  activityKitSelections: { 'ak-1': 3 },
  examGroups: { unitTest: true, termExam: false, customGroups: false },
  transportSelected: true,
  hostelSelected: true,
  discountCode: 'FULL_YEAR',
}

const BOTH_ENABLED = { enableTransport: true, enableHostel: true }

/**
 * The demo-runtime fabricated literals (school-settings singleton,
 * FeeStructureStep constants, generated books). A snapshot computed from
 * an UNCONFIGURED school must contain NONE of these — and a snapshot
 * computed from odd configured values must equal the exact arithmetic.
 */
const FORBIDDEN_AMOUNTS = [
  1500, 15000, 60000, 18000, 45000, 850, 1200, 950, 600, // heads/transport/hostel/activity constants
  1000, 2000, 5000, 2400, 3000, 2000, // exam config / demo heads / fixed waivers
  180, 220, 240, 150, 280, 260, // generated + demo book prices
  25, // hardcoded SCHOLARSHIP_PERCENT
]

const SNAPSHOT_MONEY_FIELDS = [
  'registrationFee', 'admissionFee', 'tuitionFee', 'otherHeadsTotal', 'examTotal',
  'booksTotal', 'uniformTotal', 'activityKitTotal', 'transportTotal', 'hostelTotal',
  'grossFee', 'discountAmount', 'netTotal',
] as const

// ── normalization (three-state semantics + hygiene) ───────────────────────

describe('normalizeFeeConfig · three-state money semantics', () => {
  test('configured values survive normalization untouched', () => {
    expect(FULL_CONFIG.feeHeads).toHaveLength(4)
    expect(FULL_CONFIG.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount).toBe(2222)
    expect(FULL_CONFIG.examFees.unitTest).toEqual({ status: 'configured', amount: 333 })
    expect(FULL_CONFIG.transportFee).toEqual({ status: 'configured', amount: 4321 })
    expect(FULL_CONFIG.hostelFee).toEqual({ status: 'configured', amount: 54321 })
    expect(amountOf(FULL_CONFIG.transportFee)).toBe(4321)
    expect(isConfiguredAmount(FULL_CONFIG.transportFee)).toBe(true)
  })

  test('B · explicit zero is CONFIGURED (a deliberate free head, not missing)', () => {
    const config = normalizeFeeConfig({
      feeHeads: [
        { id: 'F-1', name: 'Free Registration', category: 'Registration', defaultAmount: 0 },
        { id: 'F-2', name: 'Admission', category: 'Admission', defaultAmount: 500 },
        { id: 'F-3', name: 'Tuition', category: 'Tuition', defaultAmount: 700 },
      ],
      admissionFees: { transportFee: 0 },
    })
    expect(config.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount).toBe(0)
    expect(config.transportFee).toEqual({ status: 'explicit-zero' })
    expect(isConfiguredAmount(config.transportFee)).toBe(true)
    expect(amountOf(config.transportFee)).toBe(0)

    const snap = computeFeeSnapshot(config, 'Class 1', {
      ...defaultFeeDataState,
      transportSelected: true,
    }, BOTH_ENABLED)
    expect(snap.registrationFee).toBe(0)
    expect(snap.transportTotal).toBe(0)
    // explicit zero ≠ missing: NO unconfigured labels for these
    expect(snap.unconfigured).not.toContain('Registration Fee')
    expect(snap.unconfigured).not.toContain('Transport Fee')
  })

  test('C · missing fee heads are UNCONFIGURED (flagged, never 1500/15000/60000)', () => {
    const config = normalizeFeeConfig({
      feeHeads: [{ id: 'F-1', name: 'Development', category: 'Development', defaultAmount: 777 }],
    })
    const snap = computeFeeSnapshot(config, 'Class 1', defaultFeeDataState)
    expect(snap.registrationFee).toBe(0)
    expect(snap.admissionFee).toBe(0)
    expect(snap.tuitionFee).toBe(0)
    expect(snap.otherHeadsTotal).toBe(777) // the one configured head still counts
    expect(snap.unconfigured).toContain('Registration Fee')
    expect(snap.unconfigured).toContain('Admission Fee')
    expect(snap.unconfigured).toContain('Tuition Fee')
  })

  test('empty / absent / null settings degrade to a fully unconfigured config', () => {
    for (const empty of [{}, null, undefined, 'not-an-object', 42, []]) {
      const config = normalizeFeeConfig(empty)
      expect(config.feeHeads).toEqual([])
      expect(config.booksMaster).toEqual([])
      expect(config.discountRules).toEqual([])
      expect(config.activityKit).toEqual([])
      expect(config.uniforms).toEqual([])
      expect(config.examFees.unitTest.status).toBe('unconfigured')
      expect(config.transportFee.status).toBe('unconfigured')
      expect(config.hostelFee.status).toBe('unconfigured')
    }
  })
})

describe('normalizeFeeConfig · untrusted-entry hygiene (read-side bounds)', () => {
  test('out-of-range / non-numeric money entries are DROPPED, never clamped', () => {
    const config = normalizeFeeConfig({
      feeHeads: [
        { id: 'X-1', category: 'Registration', defaultAmount: 'abc' },
        { id: 'X-2', category: 'Registration', defaultAmount: -5 },
        { id: 'X-3', category: 'Registration', defaultAmount: 600001 },
        { id: 'X-4', category: 'Registration', defaultAmount: Number.NaN },
        { id: 'X-5', category: 'Registration' }, // amount missing
        { id: 'X-6', defaultAmount: 123 }, // category missing
        { id: 'X-7', category: 'Registration', defaultAmount: 1234 }, // valid
      ],
      booksMaster: [{ id: 'B-1', className: 'Class 1', price: 'NaN-string' }],
      discountRules: [{ id: 'R-1', code: 'WEIRD', type: 'bogus', value: 10 }],
    })
    expect(config.feeHeads).toHaveLength(1)
    expect(config.feeHeads[0]).toMatchObject({ id: 'X-7', defaultAmount: 1234 })
    expect(config.booksMaster).toEqual([])
    expect(config.discountRules).toEqual([])
  })

  test('numeric strings are accepted defensively (settings-sync convention)', () => {
    const config = normalizeFeeConfig({
      admissionFees: { transportFee: '4321' },
      examFeeConfig: { unitTestFee: '333' },
      uniforms: [{ id: 'U-1', price: '128' }],
    })
    expect(config.transportFee).toEqual({ status: 'configured', amount: 4321 })
    expect(config.examFees.unitTest).toEqual({ status: 'configured', amount: 333 })
    expect(config.uniforms[0].price).toBe(128)
  })

  test('duplicate ids count ONCE (first entry wins — no double counting)', () => {
    const config = normalizeFeeConfig({
      feeHeads: [
        { id: 'D-1', category: 'Development', defaultAmount: 100 },
        { id: 'D-1', category: 'Development', defaultAmount: 200 },
      ],
    })
    expect(config.feeHeads).toHaveLength(1)
    const snap = computeFeeSnapshot(config, 'Class 1', defaultFeeDataState)
    expect(snap.otherHeadsTotal).toBe(100)
  })
})

// ── the pure calculation ──────────────────────────────────────────────────

describe('computeFeeSnapshot · configured calculation (A, D, G, H)', () => {
  test('every configured input flows exactly into the snapshot (hand-computed)', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', FULL_SELECTION, BOTH_ENABLED)
    expect(snap.registrationFee).toBe(2222)
    expect(snap.admissionFee).toBe(22222)
    expect(snap.tuitionFee).toBe(44444)
    expect(snap.otherHeadsTotal).toBe(777)
    expect(snap.examTotal).toBe(333) // unitTest only
    expect(snap.booksTotal).toBe(147 * 2) // D · configured books
    expect(snap.uniformTotal).toBe(128)
    expect(snap.activityKitTotal).toBe(77 * 3)
    expect(snap.transportTotal).toBe(4321)
    expect(snap.hostelTotal).toBe(54321)
    expect(snap.grossFee).toBe(129293) // 2222+22222+44444+777+333+294+128+231+4321+54321
    expect(snap.discountName).toBe('Full Year Advance')
    expect(snap.discountAmount).toBe(12929) // G · percentage: round(129293 × 10 / 100)
    expect(snap.netTotal).toBe(116364)
    expect(snap.unconfigured).toEqual([]) // everything configured
  })

  test('H · all three exam groups toggle independently', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', {
      ...defaultFeeDataState,
      examGroups: { unitTest: true, termExam: true, customGroups: true },
    })
    expect(snap.examTotal).toBe(333 + 444 + 555)
  })

  test('G · fixed-amount discount rules apply their exact value', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', {
      ...FULL_SELECTION,
      discountCode: 'FLAT',
    }, BOTH_ENABLED)
    expect(snap.discountAmount).toBe(501)
    expect(snap.discountName).toBe('Flat Waiver')
    expect(snap.netTotal).toBe(129293 - 501)
  })

  test('G · CUSTOM concession is the only client-entered money (by design)', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', {
      ...FULL_SELECTION,
      discountCode: 'CUSTOM',
      customDiscountValue: 123,
      customDiscountReason: 'Sibling courtesy',
    }, BOTH_ENABLED)
    expect(snap.discountAmount).toBe(123)
    expect(snap.discountName).toBe('Sibling courtesy')
  })

  test('G · a discount code the school has NOT configured applies NOTHING (no SCHOLAR magic)', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', {
      ...FULL_SELECTION,
      discountCode: 'SCHOLAR', // legacy hardcoded 25% scholarship code
    }, BOTH_ENABLED)
    expect(snap.discountAmount).toBe(0)
    expect(snap.discountName).toBeUndefined()
    expect(snap.netTotal).toBe(129293) // full gross — NOT gross − 25%
  })

  test('class book matching resolves only CONFIGURED class books (no generation)', () => {
    const books = resolveClassBooks(FULL_CONFIG, 'Class 1')
    expect(books.map((b) => b.id).sort()).toEqual(['BK-A', 'BK-B'])
    const none = resolveClassBooks(FULL_CONFIG, 'Grade 9')
    expect(none).toEqual([]) // no fabricated 6-book fallback for Grade 9
  })
})

describe('computeFeeSnapshot · unconfigured inputs (E, F) — honest zeros', () => {
  test('E · missing books catalogue prices NOTHING (not the generated 6-book list)', () => {
    const config = normalizeFeeConfig({}) // no booksMaster at all
    const snap = computeFeeSnapshot(config, 'Class 1', {
      ...defaultFeeDataState,
      bookSelections: { 'BK-ENG-Class 1': 1, 'BK-MATH-Class 1': 1 }, // stale ids from the legacy fabricated list
    })
    expect(snap.booksTotal).toBe(0)
    expect(snap.unconfigured).toContain('Books')
    // behavioral J: no generated-book price leaked
    expect([180, 220, 240, 150, 280, 260].some((p) => p === snap.booksTotal)).toBe(false)
  })

  test('E · books configured for another class do not price this class', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Grade 9', {
      ...defaultFeeDataState,
      bookSelections: { 'BK-A': 2 }, // Class 1 book selected for Grade 9
    })
    expect(snap.booksTotal).toBe(0)
    expect(snap.unconfigured).toContain('Books')
  })

  test('F · missing optional transport/hostel/activity configuration → 0 + labels (not 18000/45000)', () => {
    const config = normalizeFeeConfig({
      feeHeads: FULL_SETTINGS.feeHeads,
      booksMaster: FULL_SETTINGS.booksMaster,
      uniforms: FULL_SETTINGS.uniforms,
      // NO admissionFees slice at all
    })
    const snap = computeFeeSnapshot(config, 'Class 1', {
      ...FULL_SELECTION,
      activityKitSelections: { 'ak-1': 2 },
    }, BOTH_ENABLED)
    expect(snap.transportTotal).toBe(0)
    expect(snap.hostelTotal).toBe(0)
    expect(snap.activityKitTotal).toBe(0)
    expect(snap.unconfigured).toContain('Transport Fee')
    expect(snap.unconfigured).toContain('Hostel Fee')
    expect(snap.unconfigured).toContain('Activity Kit')
  })

  test('optional services not selected or not enabled stay silent (usage-relevant flags)', () => {
    const config = normalizeFeeConfig({}) // nothing configured
    const snap = computeFeeSnapshot(config, 'Class 1', {
      ...defaultFeeDataState,
      transportSelected: true, // selected…
    }, { enableTransport: false, enableHostel: true }) // …but feature disabled
    expect(snap.transportTotal).toBe(0)
    expect(snap.unconfigured).not.toContain('Transport Fee') // irrelevant → not flagged
    expect(snap.unconfigured).not.toContain('Hostel Fee') // not selected → not flagged
  })

  test('exam groups toggled OFF are never flagged, toggled ON + unconfigured are', () => {
    const config = normalizeFeeConfig({}) // no examFeeConfig
    const off = computeFeeSnapshot(config, 'Class 1', defaultFeeDataState)
    expect(off.unconfigured).not.toContain('Exam Fee: Unit Test')
    const on = computeFeeSnapshot(config, 'Class 1', {
      ...defaultFeeDataState,
      examGroups: { unitTest: true, termExam: true, customGroups: true },
    })
    expect(on.examTotal).toBe(0) // not 1000+2000+1000
    expect(on.unconfigured).toContain('Exam Fee: Unit Test')
    expect(on.unconfigured).toContain('Exam Fee: Term Exam')
    expect(on.unconfigured).toContain('Exam Fee: Custom Groups')
  })
})

describe('computeFeeSnapshot · J · no forbidden fabricated values (behavioral)', () => {
  test('fully-unconfigured school → every money field is exactly 0, reported as unconfigured', () => {
    const config = normalizeFeeConfig({})
    const snap = computeFeeSnapshot(config, 'Class 1', FULL_SELECTION, BOTH_ENABLED)
    for (const field of SNAPSHOT_MONEY_FIELDS) {
      expect(snap[field]).toBe(0)
    }
    expect(snap.unconfigured).toEqual(
      expect.arrayContaining([
        'Registration Fee', 'Admission Fee', 'Tuition Fee',
        'Exam Fee: Unit Test', 'Books', 'Uniforms', 'Activity Kit',
        'Transport Fee', 'Hostel Fee',
      ]),
    )
    // the behavioral core of PR-3: NONE of the legacy fabricated literals appears
    for (const field of SNAPSHOT_MONEY_FIELDS) {
      expect(FORBIDDEN_AMOUNTS).not.toContain(snap[field])
    }
  })

  test('configured snapshot contains ONLY the configured arithmetic', () => {
    const snap = computeFeeSnapshot(FULL_CONFIG, 'Class 1', FULL_SELECTION, BOTH_ENABLED)
    for (const field of SNAPSHOT_MONEY_FIELDS) {
      expect(FORBIDDEN_AMOUNTS).not.toContain(snap[field])
    }
    // and the totals are exactly the input arithmetic (purity by construction)
    expect(snap.grossFee).toBe(
      snap.registrationFee + snap.admissionFee + snap.tuitionFee + snap.otherHeadsTotal +
      snap.examTotal + snap.booksTotal + snap.uniformTotal + snap.activityKitTotal +
      snap.transportTotal + snap.hostelTotal,
    )
    expect(snap.netTotal).toBe(Math.max(0, snap.grossFee - snap.discountAmount))
  })

  test('deterministic: same config + inputs → deep-equal snapshot (twice)', () => {
    const a = computeFeeSnapshot(FULL_CONFIG, 'Class 1', FULL_SELECTION, BOTH_ENABLED)
    const b = computeFeeSnapshot(FULL_CONFIG, 'Class 1', FULL_SELECTION, BOTH_ENABLED)
    expect(a).toEqual(b)
  })
})

// ── adapter contract at the PURE level (I) ────────────────────────────────

describe('normalizeFeeConfig · provenance contract (pure level)', () => {
  test('the pure layer NEVER stamps schoolId — provenance is adapter-only', () => {
    const config = normalizeFeeConfig(FULL_SETTINGS)
    expect(config.schoolId).toBeUndefined()
  })

  test('a schoolId key INSIDE the settings JSON is ignored (no self-declared provenance)', () => {
    const config = normalizeFeeConfig({
      schoolId: 'attacker-tenant', // data cannot stamp itself
      feeHeads: [{ id: 'F-1', category: 'Registration', defaultAmount: 2222 }],
    })
    expect(config.schoolId).toBeUndefined()
    expect(config.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount).toBe(2222)
  })

  test('normalization is fully determined by its input (no ambient state)', () => {
    const a = normalizeFeeConfig(FULL_SETTINGS)
    const b = normalizeFeeConfig(FULL_SETTINGS)
    expect(a).toEqual(b)
    const other = normalizeFeeConfig({ feeHeads: [{ id: 'F-1', category: 'Registration', defaultAmount: 9999 }] })
    expect(other.feeHeads[0].defaultAmount).toBe(9999) // no cross-call contamination
    expect(a.feeHeads.find((f) => f.category === 'Registration')?.defaultAmount).toBe(2222)
  })
})
