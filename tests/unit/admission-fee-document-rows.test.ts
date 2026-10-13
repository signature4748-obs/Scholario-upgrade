/**
 * PR-3 · GATE 2 — focused tests for the OFFICIAL DOCUMENT row model and
 * the downloaded-letter renderer: the three-state money contract.
 *
 *   configured ₹1500  → prints ₹1,500
 *   configured ₹0     → prints ₹0 (a deliberate "free")
 *   MISSING           → prints "Not configured" — never ₹0, never a
 *                       fabricated 1500/15000/60000/18000/45000
 *
 * The row model (fee-rows.ts) is the ONE source consumed by the fee
 * receipt, the letter preview table and the downloaded letter HTML, so
 * these tests prove the missing-vs-zero semantics of every official
 * document surface at once (letter-html additionally proven by its
 * exact string output).
 */
import { describe, test, expect } from 'bun:test'
import {
  buildFeeDocumentRows,
  feeDocumentSourceFromLetterFees,
  FEE_NOT_CONFIGURED_NOTE,
  type FeeDocumentSource,
} from '@/components/principal/modules/OfficialAdmissionLetter/fee-rows'
import { buildAdmissionLetterHTML } from '@/components/principal/modules/OfficialAdmissionLetter/letter-html'
import type { AdmissionLetterData } from '@/components/principal/modules/OfficialAdmissionLetter/types'
import type { FeeSnapshot } from '@/lib/admission/fee-snapshot'

const baseSource = (over: Partial<FeeDocumentSource>): FeeDocumentSource => ({
  registrationFee: 0,
  admissionFee: 0,
  tuitionFee: 0,
  otherHeadsTotal: 0,
  examTotal: 0,
  booksTotal: 0,
  uniformTotal: 0,
  activityKitTotal: 0,
  transportTotal: 0,
  hostelTotal: 0,
  grossFee: 0,
  discountAmount: 0,
  netTotal: 0,
  unconfigured: [],
  ...over,
})

describe('buildFeeDocumentRows · the three-state contract', () => {
  test('configured ₹1500 renders ₹1500 (a real configuration, not a fallback)', () => {
    const m = buildFeeDocumentRows(baseSource({ registrationFee: 1500, grossFee: 1500, netTotal: 1500 }))
    const reg = m.rows.find((r) => r.key === 'registration')
    expect(reg?.amount).toBe(1500)
    expect(m.hasUnconfigured).toBe(false)
  })

  test('configured ₹0 renders ₹0 — a deliberate "free", NOT flagged as missing', () => {
    const m = buildFeeDocumentRows(baseSource({ admissionFee: 0 }))
    const adm = m.rows.find((r) => r.key === 'admission')
    expect(adm?.amount).toBe(0) // prints ₹0 — explicitly zero
    expect(m.hasUnconfigured).toBe(false)
  })

  test('MISSING renders amount=null ("Not configured"), never ₹0', () => {
    const m = buildFeeDocumentRows(
      baseSource({ registrationFee: 500, grossFee: 500, netTotal: 500, unconfigured: ['Registration Fee'] }),
    )
    const reg = m.rows.find((r) => r.key === 'registration')
    expect(reg?.amount).toBeNull()
    expect(m.hasUnconfigured).toBe(true)
  })

  test('missing heads never become 1500 / 15000 / 60000 / 18000 / 45000', () => {
    const m = buildFeeDocumentRows(
      baseSource({
        unconfigured: [
          'Registration Fee',
          'Admission Fee',
          'Tuition Fee',
          'Transport Fee',
          'Hostel Fee',
          'Books',
          'Activity Kit',
        ],
        grossFee: 0,
        netTotal: 0,
      }),
    )
    // every base row is "Not configured"; every amount-bearing field is
    // either null or exactly 0; NO legacy literal appears anywhere.
    const legacy = [1500, 15000, 60000, 18000, 45000]
    for (const row of m.rows) {
      if (row.amount !== null) expect(legacy).not.toContain(row.amount)
    }
    expect(m.grossFee).toBe(0)
    expect(m.netTotal).toBe(0)
    expect(m.unconfigured.length).toBe(7)
  })

  test('optional categories render only when they carry money or are usage-relevant + unconfigured', () => {
    // transport selected but not configured → honest row
    const a = buildFeeDocumentRows(baseSource({ unconfigured: ['Transport Fee'] }))
    expect(a.rows.find((r) => r.key === 'transport')?.amount).toBeNull()
    // transport NOT selected (no label) and no money → row omitted
    const b = buildFeeDocumentRows(baseSource({ transportTotal: 0 }))
    expect(b.rows.find((r) => r.key === 'transport')).toBeUndefined()
    // transport configured + selected → money row
    const c = buildFeeDocumentRows(baseSource({ transportTotal: 14400, grossFee: 14400, netTotal: 14400 }))
    expect(c.rows.find((r) => r.key === 'transport')?.amount).toBe(14400)
  })

  test('usage-relevant labels are exactly the snapshot’s unconfigured labels', () => {
    const m = buildFeeDocumentRows(baseSource({ unconfigured: ['Exam Fee: Term Exam'] }))
    expect(m.unconfigured).toEqual(['Exam Fee: Term Exam'])
    expect(m.rows.find((r) => r.key === 'exam')?.amount).toBeNull()
  })

  test('FeeSnapshot satisfies the document source contract (receipt path)', () => {
    const snap: FeeSnapshot = {
      registrationFee: 700,
      admissionFee: 9000,
      tuitionFee: 13200,
      otherHeadsTotal: 5450,
      examTotal: 1350,
      booksTotal: 575,
      uniformTotal: 0,
      activityKitTotal: 0,
      transportTotal: 0,
      hostelTotal: 0,
      grossFee: 30075,
      discountAmount: 0,
      netTotal: 30075,
      unconfigured: [],
    }
    const m = buildFeeDocumentRows(snap)
    expect(m.rows.find((r) => r.key === 'registration')?.amount).toBe(700)
    expect(m.rows.find((r) => r.key === 'admission')?.amount).toBe(9000)
  })
})

describe('feeDocumentSourceFromLetterFees · authority status mapping', () => {
  test('status ready maps the full numeric letter view', () => {
    const src = feeDocumentSourceFromLetterFees({
      admissionFee: 9000,
      tuitionFee: 13200,
      finalPayable: 22200,
      subtotal: 22200,
      status: 'ready',
      unconfigured: ['Registration Fee'],
      registrationFee: 0,
    })
    expect(src).not.toBeNull()
    expect(src?.admissionFee).toBe(9000)
    expect(src?.netTotal).toBe(22200)
    expect(src?.unconfigured).toEqual(['Registration Fee'])
  })

  test('loading / unavailable map to null (renderers print honest states, never numbers)', () => {
    expect(feeDocumentSourceFromLetterFees({ admissionFee: 0, tuitionFee: 0, finalPayable: 0, status: 'loading' })).toBeNull()
    expect(feeDocumentSourceFromLetterFees({ admissionFee: 0, tuitionFee: 0, finalPayable: 0, status: 'unavailable' })).toBeNull()
  })
})

/* ── the downloaded official letter (string-level honesty proof) ────────── */

const profile = {
  name: 'Hawkings High School Prithvipur',
  shortName: 'HHSP',
  affiliation: 'CBSE',
  address: 'Prithvipur, Ghazipur',
  phone: '+91-00000-00000',
  email: 'office@hawkingshigh.edu',
  website: 'https://hawkingshigh.edu',
  principal: 'Smt. Principal',
  academicYear: '2026–2027',
} as Parameters<typeof buildAdmissionLetterHTML>[1]

const letterData = (fees: AdmissionLetterData['fees']): AdmissionLetterData => ({
  admissionNo: 'SCH-ADM-2026-TEST-01',
  admissionDate: '2026-10-08',
  academicSession: '2026–2027',
  student: { firstName: 'Aarav', lastName: 'Test', dob: '2013-05-01' },
  parents: {
    fatherName: 'R. Test',
    fatherOccupation: '',
    fatherPhone: '',
    fatherEmail: '',
    motherName: '',
    motherOccupation: '',
    motherPhone: '',
  },
  academic: { className: 'Class 7', section: 'A' },
  fees,
})

describe('buildAdmissionLetterHTML · downloaded letter honesty', () => {
  test('configured values print as INR; explicit ₹0 prints ₹0; missing prints "Not configured"', () => {
    const html = buildAdmissionLetterHTML(
      letterData({
        registrationFee: 700,
        admissionFee: 0, // explicit zero — deliberate free
        tuitionFee: 13200,
        subtotal: 13900,
        finalPayable: 13900,
        status: 'ready',
        unconfigured: ['Registration Fee'], // registration is MISSING despite the field
      }),
      profile,
    )
    // registration missing → "Not configured" (the 700 in the field is
    // ignored because the authority reported the head unconfigured)
    expect(html).toContain('Not configured')
    expect(html).toContain('*') // the footnote marker
    expect(html).toContain(FEE_NOT_CONFIGURED_NOTE.slice(0, 40))
    // explicit zero renders ₹0 — not "Not configured", not hidden
    expect(html).toContain('₹0')
    // configured tuition renders
    expect(html).toContain('₹13,200')
    // no fabricated legacy literal anywhere in the money table
    for (const legacy of ['₹1,500', '₹15,000', '₹60,000', '₹18,000', '₹45,000']) {
      expect(html).not.toContain(legacy)
    }
  })

  test('unavailable authority prints the honest omission note and NO amounts', () => {
    const html = buildAdmissionLetterHTML(
      letterData({ admissionFee: 0, tuitionFee: 0, finalPayable: 0, status: 'unavailable' }),
      profile,
    )
    expect(html).toContain('Fee configuration not available')
    expect(html).not.toContain('Net Payable')
    expect(html).not.toContain('₹1,500')
  })

  test('loading authority prints the honest verifying note', () => {
    const html = buildAdmissionLetterHTML(
      letterData({ admissionFee: 0, tuitionFee: 0, finalPayable: 0, status: 'loading' }),
      profile,
    )
    expect(html).toContain('Verifying fee configuration')
  })
})
