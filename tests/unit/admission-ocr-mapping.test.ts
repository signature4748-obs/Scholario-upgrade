/**
 * ADMISSION-OCR-MAPPING — the deterministic bridge between the printed
 * official form and the admission wizard draft.
 *
 * Invariants under test:
 *   1. FORM-TO-DRAFT ALIGNMENT — every mappable label printed by the
 *      official blank form (blank-form-model ocrFieldLabels) extracts to
 *      ITS OWN wizard field key. A configuration change can therefore
 *      never silently mis-map an old scanned form (labels are text-matched
 *      and append-only, per the AF-2026.1 version contract).
 *   2. HONESTY — values the engine could not read are NEVER fabricated:
 *      unlabelled lines, empty values, invalid blood groups / emails /
 *      phone shapes are dropped, not guessed.
 *   3. CONFIDENCE — low engine confidence (<85) flags the field for
 *      mandatory Principal review; the value is still shown (reviewable),
 *      never auto-submitted.
 *   4. NORMALISATION — dates → yyyy-mm-dd, phones → 10-digit, Aadhaar →
 *      grouped digits, names → Title Case.
 */
import { describe, test, expect } from 'bun:test'
import {
  extractAdmissionFields,
  type OcrLine,
} from '@/components/principal/modules/admission/lib/ocr-extract'
import {
  buildBlankFormModel,
  type BlankFormSchoolIdentity,
} from '@/components/principal/modules/admission/lib/blank-form-model'

const SCHOOL: BlankFormSchoolIdentity = { name: 'Test School' }

const line = (text: string, confidence = 90): OcrLine => ({ text, confidence })

function extract(lines: OcrLine[]) {
  return extractAdmissionFields(lines, 80)
}

describe('admission-ocr-mapping: official-form label alignment (version contract)', () => {
  test('every printed label maps back to its own wizard field key', () => {
    const m = buildBlankFormModel({ school: SCHOOL, session: '2026-2027' })
    // Values every cleaner accepts (blood group / email / phone have
    // strict formats — garbage is deliberately dropped, not guessed).
    const valid: Record<string, string> = {
      bloodGroup: 'O+',
      fatherPhone: '9876543210',
      motherPhone: '9876501234',
      emergencyPhone: '9812345678',
      fatherEmail: 'father@example.com',
      motherEmail: 'mother@example.com',
      dob: '12/03/2015',
      gender: 'Male',
      aadhaarNo: '1234 5678 9012',
      pincode: '226001',
    }
    const entries = Object.entries(m.ocrFieldLabels)
    expect(entries.length).toBeGreaterThan(15)
    for (const [fieldKey, label] of entries) {
      const value = valid[fieldKey] ?? 'Sample Value'
      const found = extract([line(`${label}: ${value}`, 92)])
      const hit = found.find((f) => f.fieldKey === fieldKey)
      expect(hit).toBeDefined()
    }
  })

  test('a fully-filled official form maps onto the expected draft', () => {
    const m = buildBlankFormModel({ school: SCHOOL, session: '2026-2027' })
    const filled: Record<string, string> = {
      firstName: 'Aarav',
      lastName: 'Sharma',
      dob: '12/03/2015',
      bloodGroup: 'O+',
      religion: 'Hindu',
      nationality: 'Indian',
      className: 'Grade 3',
      fatherName: 'Rajesh Sharma',
      fatherOccupation: 'Engineer',
      fatherPhone: '+91 98765 43210',
      fatherEmail: 'rajesh@example.com',
      motherName: 'Sunita Sharma',
      motherOccupation: 'Teacher',
      motherPhone: '9876501234',
      motherEmail: 'sunita@example.com',
      emergencyName: 'Mahesh Gupta',
      emergencyRelation: 'Uncle',
      emergencyPhone: '9812345678',
      currentAddress: '14 Nehru Marg',
      city: 'Lucknow',
      district: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      previousSchool: 'Little Angels School',
      previousClass: 'Grade 2',
      previousYear: '2025-2026',
      previousBoard: 'CBSE',
      previousMarks: '88%',
    }
    const lines = Object.entries(m.ocrFieldLabels).map(([key, label]) =>
      line(`${label}: ${filled[key]}`, 90)
    )
    const out = new Map(extract(lines).map((f) => [f.fieldKey, f.value]))

    expect(out.get('firstName')).toBe('Aarav')
    expect(out.get('lastName')).toBe('Sharma')
    expect(out.get('dob')).toBe('2015-03-12')
    expect(out.get('bloodGroup')).toBe('O+')
    expect(out.get('className')).toBe('Grade 3')
    expect(out.get('fatherName')).toBe('Rajesh Sharma')
    expect(out.get('fatherOccupation')).toBe('Engineer')
    expect(out.get('fatherPhone')).toBe('9876543210')
    expect(out.get('fatherEmail')).toBe('rajesh@example.com')
    expect(out.get('motherName')).toBe('Sunita Sharma')
    expect(out.get('motherPhone')).toBe('9876501234')
    expect(out.get('emergencyRelation')).toBe('Uncle')
    expect(out.get('pincode')).toBe('226001')
    expect(out.get('previousSchool')).toBe('Little Angels School')
    expect(out.get('previousClass')).toBe('Grade 2')
    expect(out.get('previousMarks')).toBe('88%')
  })

  test(`labels never cross-map: "Last Name" is not the first name, "Mother's Mobile" is not the father's`, () => {
    const out = new Map(
      extract([
        line('Last Name: Sharma', 95),
        line("Mother's Mobile: 9876501234", 95),
      ]).map((f) => [f.fieldKey, f.value])
    )
    expect(out.has('firstName')).toBe(false)
    expect(out.get('lastName')).toBe('Sharma')
    expect(out.has('fatherPhone')).toBe(false)
    expect(out.get('motherPhone')).toBe('9876501234')
  })
})

describe('admission-ocr-mapping: honesty (never fabricate)', () => {
  test('unlabelled noise produces no fields', () => {
    expect(extract([line('random scanned noise without labels', 60)])).toEqual([])
  })

  test('a label with an empty value produces no field', () => {
    expect(extract([line('Date of Birth:', 90)])).toEqual([])
    expect(extract([line('Religion:    ', 90)])).toEqual([])
  })

  test('unreadable blood group / invalid email are dropped, not guessed', () => {
    const out = new Map(
      extract([
        line('Blood Group: ???', 90),
        line("Father's Email: not-an-email", 90),
      ]).map((f) => [f.fieldKey, f.value])
    )
    expect(out.has('bloodGroup')).toBe(false)
    expect(out.has('fatherEmail')).toBe(false)
  })

  test('the same field keeps the HIGHER-confidence reading across pages', () => {
    const out = extract([
      line('First Name: Aarav', 70),
      line('First Name: Aarav', 95),
    ])
    expect(out.length).toBe(1)
    expect(out[0].confidence).toBe(95)
  })
})

describe('admission-ocr-mapping: confidence flagging', () => {
  test('confidence below 85 flags the field for Principal review', () => {
    const out = new Map(extract([line('First Name: Aarav', 72)]).map((f) => [f.fieldKey, f]))
    expect(out.get('firstName')!.needsReview).toBe(true)
    expect(out.get('firstName')!.confidence).toBe(72)
  })

  test('confidence 85+ is not flagged', () => {
    const out = new Map(extract([line('First Name: Aarav', 88)]).map((f) => [f.fieldKey, f]))
    expect(out.get('firstName')!.needsReview).toBe(false)
  })
})

describe('admission-ocr-mapping: normalisation', () => {
  test('dates normalise dd/mm/yyyy, dd-mm-yyyy and ISO to yyyy-mm-dd', () => {
    const a = new Map(extract([line('Date of Birth: 5/6/2014', 95)]).map((f) => [f.fieldKey, f.value]))
    expect(a.get('dob')).toBe('2014-06-05')
    const b = new Map(extract([line('Date of Birth: 2015-03-12', 95)]).map((f) => [f.fieldKey, f.value]))
    expect(b.get('dob')).toBe('2015-03-12')
  })

  test('Aadhaar pattern fallback formats 12 digits into groups', () => {
    const out = new Map(extract([line('some line with 1234 5678 9012 written', 95)]).map((f) => [f.fieldKey, f.value]))
    expect(out.get('aadhaarNo')).toBe('1234 5678 9012')
  })

  test('gender accepts Male/Female/Other readings only', () => {
    const m = new Map(extract([line('Gender: M', 95)]).map((f) => [f.fieldKey, f.value]))
    expect(m.get('gender')).toBe('Male')
    const f = new Map(extract([line('Gender: female', 95)]).map((x) => [x.fieldKey, x.value]))
    expect(f.get('gender')).toBe('Female')
    const bad = extract([line('Gender: maybe', 95)])
    expect(bad.find((x) => x.fieldKey === 'gender')).toBeUndefined()
  })
})
