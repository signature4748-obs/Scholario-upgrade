/**
 * BLANK-FORM-MODEL — the versioned, tenant-driven model behind the
 * official blank admission form.
 *
 * Invariants under test (the form contract):
 *   1. TENANT HONESTY — the model carries ONLY the given identity; no
 *      fabricated school names, addresses, contacts or approval claims.
 *   2. POLICY REFLECTION — the Aadhaar row and the document checklist
 *      follow the school's configurable document policy.
 *   3. STRUCTURE — Sections A–F exist in order (AF-2026.2 one-page
 *      contract); every mappable field has a stable OCR label (the
 *      scan-alignment contract).
 *   4. VERSIONING — the form schema version is stamped and stable, so a
 *      scanned old form still maps correctly after config changes
 *      (labels are matched by TEXT, and are append-only).
 *   5. ASTERISK CONVENTION — required fields are flagged via `required`
 *      (the painters print '*'); the words "(Required)"/"(Optional)"
 *      never enter the model's printable content.
 */
import { describe, test, expect } from 'bun:test'
import {
  BLANK_FORM_VERSION,
  buildBlankFormModel,
  type BlankFormSchoolIdentity,
} from '@/components/principal/modules/admission/lib/blank-form-model'
import { DEFAULT_DOCUMENT_POLICY } from '@/components/principal/modules/admission/lib/documents'
import type { AdmissionDocumentPolicy } from '@/lib/store/school-settings-store'

const TENANT: BlankFormSchoolIdentity = {
  name: 'Saraswati Vidya Mandir',
  shortName: 'SVM',
  affiliation: 'Affiliated to CBSE, New Delhi',
  address: '12 Station Road, Civil Lines',
  city: 'Lucknow',
  phone: '+91 522 234 5678',
  email: 'office@saraswatividya.example',
  website: 'https://saraswatividya.example',
  principal: 'Dr. A. Sharma',
  logoUrl: null,
  primaryColor: '#7c2d12',
}

const NEUTRAL: BlankFormSchoolIdentity = {
  name: 'Our School',
}

function model(
  school: BlankFormSchoolIdentity = TENANT,
  documentPolicy?: Partial<AdmissionDocumentPolicy> | null
) {
  return buildBlankFormModel({ school, session: '2026-2027', documentPolicy })
}

describe('blank-form-model: structure', () => {
  test('sections A–F exist in canonical order (one-page contract)', () => {
    const m = model()
    expect(m.sections.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(m.sections[0].title).toContain('STUDENT DETAILS')
    expect(m.sections[1].title).toContain('PARENT')
    expect(m.sections[2].title).toContain('ADDRESS & PREVIOUS ACADEMIC RECORD')
    expect(m.sections[3].title).toContain('FACILITIES & MEDICAL DETAILS')
    expect(m.sections[4].title).toContain('DOCUMENT CHECKLIST')
    expect(m.sections[5].title).toContain('DECLARATION')
  })

  test('Section A carries the student identity fields incl. class applying for', () => {
    const keys = model().sections[0].fields.map((f) => f.key)
    for (const k of ['firstName', 'lastName', 'dob', 'gender', 'bloodGroup', 'religion', 'nationality', 'className', 'section']) {
      expect(keys).toContain(k)
    }
  })

  test('Section D carries the facilities & medical fields (wizard-collected)', () => {
    const keys = model().sections[3].fields.map((f) => f.key)
    for (const k of ['transportRequired', 'transportRoute', 'hostelRequired', 'allergies', 'doctorName', 'doctorPhone', 'conditions']) {
      expect(keys).toContain(k)
    }
  })

  test('no printable content uses the words "(Required)" or "(Optional)"', () => {
    const m = model()
    for (const s of m.sections) {
      for (const f of s.fields) {
        const printed = `${f.label} ${f.note ?? ''} ${(f.options ?? []).join(' ')}`
        expect(printed).not.toContain('(Required)')
        expect(printed).not.toContain('(Optional)')
      }
    }
  })

  test('form number prefix derives from the academic session', () => {
    expect(model().formNoPrefix).toBe('ADM-2026')
    expect(buildBlankFormModel({ school: TENANT, session: '' }).formNoPrefix).toBe('ADM-____')
  })

  test('version stamp is stable and printed on the artefact', () => {
    expect(BLANK_FORM_VERSION).toBe('AF-2026.2')
    expect(model().version).toBe(BLANK_FORM_VERSION)
  })
})

describe('blank-form-model: tenant honesty', () => {
  test('carries the tenant identity verbatim — nothing invented', () => {
    const m = model()
    expect(m.school.name).toBe(TENANT.name)
    expect(m.school.address).toBe(TENANT.address)
    expect(m.school.phone).toBe(TENANT.phone)
    expect(m.school.email).toBe(TENANT.email)
  })

  test('neutral identity stays neutral (no fabricated particulars)', () => {
    const m = model(NEUTRAL)
    expect(m.school.name).toBe('Our School')
    expect(m.school.address).toBeUndefined()
    expect(m.school.phone).toBeUndefined()
  })

  test('declaration names the actual tenant school and makes no guarantee of admission', () => {
    const m = model()
    expect(m.declaration.text).toContain(TENANT.name)
    expect(m.declaration.text.toLowerCase()).toContain('does not by itself guarantee admission')
    expect(m.declaration.principalSignLabel).toBe('Principal')
  })

  test('a neutral school declares against the neutral name, never a fake one', () => {
    const m = model(NEUTRAL)
    expect(m.declaration.text).toContain('Our School')
    expect(m.declaration.text).not.toMatch(/Greenwood|St\.|Public School/)
  })
})

describe('blank-form-model: document policy reflection', () => {
  test('default policy: Aadhaar row present (school collects it), optional → NO asterisk flag', () => {
    const m = model(TENANT, DEFAULT_DOCUMENT_POLICY)
    const aadhaar = m.sections[0].fields.find((f) => f.key === 'aadhaarNo')
    expect(aadhaar).toBeDefined()
    // Asterisk convention: optional fields carry neither an asterisk nor a
    // printed "(Optional)" qualifier.
    expect(aadhaar!.required).toBeFalsy()
    expect(aadhaar!.note).toBeUndefined()
  })

  test('policy not-collected: Aadhaar row omitted entirely', () => {
    const m = model(TENANT, { ...DEFAULT_DOCUMENT_POLICY, aadhaar: 'not-collected' })
    expect(m.sections[0].fields.find((f) => f.key === 'aadhaarNo')).toBeUndefined()
  })

  test('checklist mirrors the policy: collected docs listed, required flagged, others omitted', () => {
    const policy: AdmissionDocumentPolicy = {
      ...DEFAULT_DOCUMENT_POLICY,
      aadhaar: 'not-collected',
      tc: 'required',
      birthCert: 'optional',
      marksheet: 'not-collected',
    }
    const m = model(TENANT, policy)
    const names = m.documents.map((d) => d.name)
    expect(names).toContain('Transfer Certificate (TC)')
    expect(names).toContain('Birth Certificate')
    expect(names).not.toContain('Student Aadhaar Card')
    expect(names).not.toContain('Previous Mark Sheet')
    expect(m.documents.find((d) => d.name === 'Transfer Certificate (TC)')!.required).toBe(true)
    expect(m.documents.find((d) => d.name === 'Birth Certificate')!.required).toBe(false)
  })

  test('no policy given → registry defaults seed the checklist (never empty-by-accident)', () => {
    const m = model(TENANT, null)
    expect(m.documents.length).toBe(Object.keys(DEFAULT_DOCUMENT_POLICY).length)
  })
})

describe('blank-form-model: OCR alignment contract', () => {
  test('every mappable printed label is stable, unique and non-empty', () => {
    const labels = Object.values(model().ocrFieldLabels)
    expect(labels.length).toBeGreaterThan(20)
    expect(new Set(labels).size).toBe(labels.length) // no duplicate labels
    for (const label of labels) expect(label.length).toBeGreaterThan(2)
  })

  test('the wizard field keys are the mapping targets (no second data model)', () => {
    const keys = Object.keys(model().ocrFieldLabels)
    for (const k of ['firstName', 'lastName', 'dob', 'fatherName', 'motherName', 'fatherPhone', 'motherPhone', 'currentAddress', 'pincode', 'previousSchool', 'className']) {
      expect(keys).toContain(k)
    }
  })

  test('label edits would break the versioned scan contract — pin the exact labels', () => {
    expect(model().ocrFieldLabels).toEqual({
      firstName: 'First Name',
      lastName: 'Last Name',
      dob: 'Date of Birth',
      bloodGroup: 'Blood Group',
      religion: 'Religion',
      nationality: 'Nationality',
      className: 'Class Applying For',
      section: 'Preferred Section',
      aadhaarNo: 'Aadhaar Number',
      fatherName: "Father's Name",
      fatherOccupation: "Father's Occupation",
      fatherPhone: "Father's Mobile",
      fatherEmail: "Father's Email",
      motherName: "Mother's Name",
      motherOccupation: "Mother's Occupation",
      motherPhone: "Mother's Mobile",
      motherEmail: "Mother's Email",
      emergencyName: 'Emergency Contact Name',
      emergencyRelation: 'Relationship',
      emergencyPhone: 'Emergency Phone',
      currentAddress: 'Current Address',
      permAddress: 'Permanent Address',
      city: 'City / Town',
      district: 'District',
      state: 'State',
      pincode: 'Pincode',
      previousSchool: 'Previous School Name',
      previousClass: 'Last Class Passed',
      previousYear: 'Previous Academic Year',
      previousBoard: 'Previous Board',
      previousMarks: 'Previous Marks',
      transportRoute: 'Transport Route / Landmark',
      allergies: 'Allergies',
      doctorName: 'Family Doctor',
      doctorPhone: 'Doctor Phone',
      conditions: 'Medical Conditions',
    })
  })
})
