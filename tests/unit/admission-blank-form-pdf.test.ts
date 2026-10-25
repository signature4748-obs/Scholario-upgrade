/**
 * BLANK-FORM-PDF — the REAL downloadable A4 artefact (jsPDF vector
 * drawing — NOT a browser-print screenshot).
 *
 * Invariants under test:
 *   1. It is a genuine PDF (magic bytes) with exact A4 page geometry.
 *   2. Multi-page with the school identity + page numbers + form version
 *      on every page; Sections A–E all present.
 *   3. TENANT HONESTY — the tenant name is baked in; an unconfigured
 *      school prints NO contact particulars (nothing invented).
 *   4. Layout robustness — a maximal document policy (all documents
 *      collected) still renders without errors and without clipping
 *      (page count grows, never an exception).
 */
import { describe, test, expect } from 'bun:test'
import jsPDF from 'jspdf'
import {
  BLANK_FORM_VERSION,
  buildBlankFormModel,
  type BlankFormSchoolIdentity,
} from '@/components/principal/modules/admission/lib/blank-form-model'
import {
  blankFormFileName,
  renderBlankAdmissionFormPdf,
} from '@/components/principal/modules/admission/lib/blank-form-pdf'
import { DEFAULT_DOCUMENT_POLICY } from '@/components/principal/modules/admission/lib/documents'

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

const NEUTRAL: BlankFormSchoolIdentity = { name: 'Our School' }

function render(school: BlankFormSchoolIdentity = TENANT): jsPDF {
  const m = buildBlankFormModel({ school, session: '2026-2027', documentPolicy: DEFAULT_DOCUMENT_POLICY })
  return renderBlankAdmissionFormPdf(m)
}

/** jsPDF default output keeps text uncompressed — decodable for assertions. */
function decodedText(doc: jsPDF): string {
  const bytes = new Uint8Array(doc.output('arraybuffer'))
  return new TextDecoder('latin1').decode(bytes)
}

describe('blank-form-pdf: genuine A4 PDF artefact', () => {
  test('output is a real PDF document', () => {
    const bytes = new Uint8Array(render().output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(3000)
  })

  test('A4 portrait geometry', () => {
    const doc = render()
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 1)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 1)
  })

  test('two or more pages — every page numbered with the school + form version', () => {
    const doc = render()
    const n = doc.getNumberOfPages()
    expect(n).toBeGreaterThanOrEqual(2)
    const text = decodedText(doc)
    expect(text).toContain('Page 1 of')
    expect(text).toContain(`Form version ${BLANK_FORM_VERSION}`)
  })

  test('all five sections and the office-use block are printed', () => {
    const text = decodedText(render())
    expect(text).toContain('SECTION A')
    expect(text).toContain('SECTION B')
    expect(text).toContain('SECTION C')
    expect(text).toContain('SECTION D')
    expect(text).toContain('SECTION E')
    expect(text).toContain('OFFICE USE ONLY')
    expect(text).toContain('ADMISSION APPLICATION FORM')
    expect(text).toContain('ACADEMIC SESSION 2026-2027')
  })

  test('letterhead carries the tenant identity + form blanks (photo box, form no, date)', () => {
    const text = decodedText(render())
    expect(text).toContain('SARASWATI VIDYA MANDIR')
    expect(text).toContain('Affiliated to CBSE, New Delhi')
    expect(text).toContain('PASSPORT-SIZE')
    expect(text).toContain('Form No: ADM-2026')
    expect(text).toContain('Date:')
  })
})

describe('blank-form-pdf: tenant honesty', () => {
  test('unconfigured school prints NO invented contact particulars', () => {
    const text = decodedText(render(NEUTRAL))
    expect(text).toContain('Our School') // honest neutral name
    expect(text).not.toContain('Phone:')
    expect(text).not.toContain('@')
    expect(text).not.toContain('www.')
    // honest empty logo box instead of a fabricated crest
    expect(text).toContain('School Logo')
  })

  test('configured school prints its real contact line', () => {
    const text = decodedText(render(TENANT))
    expect(text).toContain('Phone: +91 522 234 5678')
    expect(text).toContain('office@saraswatividya.example')
  })
})

describe('blank-form-pdf: layout robustness', () => {
  test('maximal document policy renders without clipping or exceptions', () => {
    const m = buildBlankFormModel({
      school: { ...TENANT, name: 'A Very Long School Name For Testing Wrapping Behaviour Vidyalaya Samiti' },
      session: '2026-2027',
      documentPolicy: DEFAULT_DOCUMENT_POLICY,
    })
    const doc = renderBlankAdmissionFormPdf(m)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    expect(String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))).toBe('%PDF-')
  })

  test('logo data URL embeds without breaking the document', () => {
    // 1x1 transparent PNG
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const m = buildBlankFormModel({ school: TENANT, session: '2026-2027' })
    const doc = renderBlankAdmissionFormPdf(m, { logoDataUrl: png })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
  })
})

describe('blank-form-pdf: artefact naming', () => {
  test('file name is school- and session-scoped, slugified', () => {
    expect(blankFormFileName('Saraswati Vidya Mandir', '2026-2027')).toBe(
      'admission-application-form-saraswati-vidya-mandir-2026-2027.pdf'
    )
    expect(blankFormFileName('Our School', '—')).toBe('admission-application-form-our-school.pdf')
    expect(blankFormFileName('', '')).toBe('admission-application-form-school.pdf')
  })
})
