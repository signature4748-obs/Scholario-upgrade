/**
 * BLANK-FORM-PDF — the REAL downloadable A4 artefact (jsPDF vector
 * drawing — NOT a browser-print screenshot).
 *
 * Invariants under test:
 *   1. It is a genuine PDF (magic bytes) with exact A4 page geometry.
 *   2. ONE-PAGE CONTRACT — the complete form renders EXACTLY ONE A4
 *      portrait page for every supported configuration, with the school
 *      identity + form version on the footer and NO page numbering.
 *   3. TENANT HONESTY — the tenant name is baked in; an unconfigured
 *      school prints NO contact particulars (nothing invented).
 *   4. ASTERISK CONVENTION — required fields print "label *"; the words
 *      "(Required)" / "(Optional)" NEVER appear anywhere on the form.
 *   5. Layout robustness — every document-policy variant (all documents
 *      collected, Aadhaar off, logo embed) stays on one page, never
 *      clips, never throws.
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

  test('ONE-PAGE CONTRACT: the complete form is exactly one A4 sheet', () => {
    expect(render().getNumberOfPages()).toBe(1)
    expect(render(NEUTRAL).getNumberOfPages()).toBe(1)
  })

  test('no page numbering — the single-sheet footer carries school + version only', () => {
    const text = decodedText(render())
    expect(text).not.toContain('Page 1 of')
    expect(text).not.toContain('Page 2 of')
    expect(text).not.toContain('of 2')
    expect(text).not.toContain('of 3')
    expect(text).toContain(`Form version ${BLANK_FORM_VERSION}`)
  })

  test('all six sections and the office-use block are printed', () => {
    const text = decodedText(render())
    expect(text).toContain('SECTION A')
    expect(text).toContain('SECTION B')
    expect(text).toContain('SECTION C')
    expect(text).toContain('SECTION D')
    expect(text).toContain('SECTION E')
    expect(text).toContain('SECTION F')
    expect(text).toContain('OFFICE USE ONLY')
    expect(text).toContain('ADMISSION APPLICATION FORM')
    expect(text).toContain('ACADEMIC SESSION 2026-2027')
  })

  test('asterisk convention: required fields print "label *", no "(Required)"/"(Optional)"', () => {
    const text = decodedText(render())
    expect(text).toContain('First Name *')
    expect(text).toContain('Last Name *')
    expect(text).toContain('Date of Birth *')
    expect(text).toContain("Father's Name *")
    expect(text).toContain('Current Address *')
    // the banned explanatory words never appear
    expect(text).not.toContain('(Required)')
    expect(text).not.toContain('(Optional)')
    expect(text).not.toContain('Required')
    expect(text).not.toContain('Optional')
    // optional fields stay bare: Nationality (prefilled) and Aadhaar print no marker
    expect(text).not.toContain('Aadhaar Number *')
    // required checklist entry carries the asterisk
    expect(text).toContain('Student Aadhaar Card *')
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

describe('blank-form-pdf: layout robustness (one page, never clipped)', () => {
  test('maximal document policy still renders exactly one page without exceptions', () => {
    const m = buildBlankFormModel({
      school: { ...TENANT, name: 'A Very Long School Name For Testing Wrapping Behaviour Vidyalaya Samiti' },
      session: '2026-2027',
      documentPolicy: DEFAULT_DOCUMENT_POLICY,
    })
    const doc = renderBlankAdmissionFormPdf(m)
    expect(doc.getNumberOfPages()).toBe(1)
    const text = decodedText(doc)
    expect(text).toContain('%PDF-')
    // every section survived the wrap-heavy letterhead
    expect(text).toContain('SECTION F')
    expect(text).toContain('OFFICE USE ONLY')
  })

  test('Aadhaar not-collected variant stays on one page', () => {
    const m = buildBlankFormModel({
      school: TENANT,
      session: '2026-2027',
      documentPolicy: { ...DEFAULT_DOCUMENT_POLICY, aadhaar: 'not-collected' },
    })
    expect(renderBlankAdmissionFormPdf(m).getNumberOfPages()).toBe(1)
  })

  test('logo data URL embeds without breaking the document or the page count', () => {
    // 1x1 transparent PNG
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const m = buildBlankFormModel({ school: TENANT, session: '2026-2027' })
    const doc = renderBlankAdmissionFormPdf(m, { logoDataUrl: png })
    expect(doc.getNumberOfPages()).toBe(1)
  })
})

describe('blank-form-pdf: office-use block geometry (two distinct rows, no overlap)', () => {
  const MM = 72 / 25.4 // pt per mm
  const PAGE_H_PT = 297 * (72 / 25.4)

  /** Text ops from the (uncompressed) content stream — y measured FROM THE PAGE TOP. */
  function textOps(stream: string): Array<{ label: string; x: number; yTop: number }> {
    const ops: Array<{ label: string; x: number; yTop: number }> = []
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) Td\s*\(([^)]*)\) Tj/g)) {
      ops.push({ label: m[3], x: parseFloat(m[1]), yTop: PAGE_H_PT - parseFloat(m[2]) })
    }
    return ops
  }

  /** Rect ops — yTop = top edge measured FROM THE PAGE TOP. */
  function rectOps(stream: string): Array<{ x: number; yTop: number; w: number; h: number }> {
    const ops: Array<{ x: number; yTop: number; w: number; h: number }> = []
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)) {
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])
      const w = Math.abs(parseFloat(m[3]))
      const h = Math.abs(parseFloat(m[4]))
      ops.push({ x, w, h, yTop: parseFloat(m[4]) < 0 ? PAGE_H_PT - y : PAGE_H_PT - y - h })
    }
    return ops
  }

  /** Straight line segments (m…l…S) — yTop measured FROM THE PAGE TOP. */
  function lineOps(stream: string): Array<{ x1: number; x2: number; yTop: number }> {
    const ops: Array<{ x1: number; x2: number; yTop: number }> = []
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\s*S/g)) {
      const y = Math.min(parseFloat(m[2]), parseFloat(m[4]))
      ops.push({ x1: parseFloat(m[1]), x2: parseFloat(m[3]), yTop: PAGE_H_PT - y })
    }
    return ops
  }

  test('office blanks share row 1; decision checkboxes sit on a lower row 2 and never touch row 1 lines', () => {
    const doc = render()
    // The office-use block is the LAST element painted — parse the FINAL
    // page's stream only (doc.internal.pages is 1-indexed per-page op
    // arrays) so ops from earlier pages can never be mistaken for it.
    const pageOps = (doc.internal as unknown as { pages: string[][] }).pages[doc.getNumberOfPages()]
    const stream = (pageOps as unknown as string[]).join('\n')
    const texts = textOps(stream)
    const at = (label: string) => {
      const op = texts.find((t) => t.label === label)
      expect(op, `text op "${label}" must be printed exactly once`).toBeDefined()
      return op!
    }
    const appNo = at('Application No.:')
    const dateRec = at('Date Received:')
    const verified = at('Verified by:')
    const decision = at('Principal Decision:')

    // Row 1 — the three office blanks share ONE baseline (single row).
    expect(Math.abs(dateRec.yTop - appNo.yTop)).toBeLessThan(0.2)
    expect(Math.abs(verified.yTop - appNo.yTop)).toBeLessThan(0.2)

    // Row 2 — Principal Decision baseline is ≥ 4.5 mm BELOW row 1: a clearly
    // distinct row (the old overlapping layout had only 3.0 mm and the
    // checkboxes crossed the row-1 lines).
    expect(decision.yTop - appNo.yTop).toBeGreaterThan(4.5 * MM)

    // The three decision checkboxes are the only 2.9 mm squares on the sheet
    // (section checkboxes are 3.1 mm), on one shared row, evenly pitched.
    const boxes = rectOps(stream)
      .filter((r) => Math.abs(r.w - 2.9 * MM) < 0.2 && Math.abs(r.h - 2.9 * MM) < 0.2)
      .sort((a, b) => a.x - b.x)
    expect(boxes.length).toBe(3)
    expect(Math.abs(boxes[1].yTop - boxes[0].yTop)).toBeLessThan(0.2)
    expect(Math.abs(boxes[2].yTop - boxes[0].yTop)).toBeLessThan(0.2)
    expect(Math.abs((boxes[1].x - boxes[0].x) / MM - 26)).toBeLessThan(1)
    expect(Math.abs((boxes[2].x - boxes[1].x) / MM - 26)).toBeLessThan(1)

    // The office-use box is the only 192 × 14.6 mm rect — everything above
    // must live inside it.
    const officeBox = rectOps(stream).find(
      (r) => Math.abs(r.w - 192 * MM) < 1 && Math.abs(r.h - 14.6 * MM) < 1,
    )
    expect(officeBox, 'office-use bordered box must be present').toBeDefined()
    const boxTop = officeBox!.yTop
    for (const b of boxes) {
      expect(b.yTop).toBeGreaterThan(boxTop)
      expect(b.yTop + 2.9 * MM).toBeLessThan(boxTop + 14.6 * MM)
    }

    // NON-OVERLAP REGRESSION LOCK: the Application No. writing line (the
    // ruled segment just below its label, inside the office box) must sit
    // ≥ 1.5 mm ABOVE every decision checkbox top — no intrusion, ever.
    const appNoLine = lineOps(stream).find(
      (l) =>
        l.yTop > boxTop + 5 * MM &&
        l.yTop < boxTop + 11 * MM &&
        Math.abs(l.yTop - (appNo.yTop + 1.0 * MM)) < 1.2 * MM &&
        l.x1 < appNo.x + 40 * MM,
    )
    expect(appNoLine, 'Application No. writing line must be present in the office box').toBeDefined()
    for (const b of boxes) {
      expect(b.yTop - appNoLine!.yTop).toBeGreaterThan(1.5 * MM)
    }
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
