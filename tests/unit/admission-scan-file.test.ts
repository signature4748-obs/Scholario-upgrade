/**
 * ADMISSION-SCAN-FILE — content-first validation for scanned form
 * uploads (photo / image scan / PDF) feeding the on-device OCR flow.
 *
 * Invariants under test:
 *   1. MAGIC BYTES DECIDE — the file name and the browser MIME type are
 *      never trusted: a renamed file is typed by its content, and a fake
 *      extension is rejected as unsupported.
 *   2. EXPLICIT LIMITS — empty files, oversized images/PDFs and PDFs
 *      beyond the page cap fail with actionable errors BEFORE any OCR
 *      work runs.
 *   3. REAL PDF PARSING — the bundled pdfjs-dist build actually opens a
 *      generated multi-page PDF and reports its page count (the same
 *      build the scan modal uses).
 */
import { describe, test, expect } from 'bun:test'
import jsPDF from 'jspdf'
import {
  MAX_SCAN_IMAGE_BYTES,
  MAX_SCAN_PDF_BYTES,
  MAX_SCAN_PDF_PAGES,
  checkPdfPagePolicy,
  sniffScanFileKind,
  validateScanFileMeta,
  type ScanFileMetaInput,
} from '@/components/principal/modules/admission/lib/scan-file'
import { parsePdfPageCount } from '@/components/principal/modules/admission/lib/pdf-scan'

/* ─── Real magic-byte headers ────────────────────────────────────────── */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // %PDF-1.7
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
])
const TEXT = new TextEncoder().encode('hello, this is definitely not a pdf at all')

function meta(over: Partial<ScanFileMetaInput> & { header: Uint8Array }): ScanFileMetaInput {
  return { name: 'scan.jpg', mimeType: 'image/jpeg', size: 1000, ...over }
}

describe('admission-scan-file: magic-byte sniffing', () => {
  test('recognises JPEG, PNG, WebP and PDF by content', () => {
    expect(sniffScanFileKind(JPEG)).toBe('jpeg')
    expect(sniffScanFileKind(PNG)).toBe('png')
    expect(sniffScanFileKind(WEBP)).toBe('webp')
    expect(sniffScanFileKind(PDF_HEADER)).toBe('pdf')
  })

  test('rejects unknown content and too-short headers', () => {
    expect(sniffScanFileKind(TEXT)).toBeNull()
    expect(sniffScanFileKind(new Uint8Array([0x25, 0x50]))).toBeNull()
  })

  test('a PDF renamed to .jpg with an image MIME is still a PDF (content wins)', () => {
    const v = validateScanFileMeta(
      meta({ header: PDF_HEADER, name: 'photo.jpg', mimeType: 'image/jpeg', size: 500_000 })
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.kind).toBe('pdf')
  })

  test('a text file named .pdf is rejected as unsupported', () => {
    const v = validateScanFileMeta(
      meta({ header: TEXT, name: 'form.pdf', mimeType: 'application/pdf', size: 500_000 })
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.rejection.code).toBe('UNSUPPORTED')
  })
})

describe('admission-scan-file: size + empty policy', () => {
  test('empty file → EMPTY', () => {
    const v = validateScanFileMeta(meta({ header: JPEG, size: 0 }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.rejection.code).toBe('EMPTY')
  })

  test('image over 5 MB → TOO_LARGE', () => {
    const v = validateScanFileMeta(meta({ header: JPEG, size: MAX_SCAN_IMAGE_BYTES + 1 }))
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.rejection.code).toBe('TOO_LARGE')
      expect(v.rejection.message).toContain('5 MB')
    }
  })

  test('image at exactly the limit passes; PDF limit is higher', () => {
    expect(validateScanFileMeta(meta({ header: JPEG, size: MAX_SCAN_IMAGE_BYTES })).ok).toBe(true)
    const v = validateScanFileMeta(
      meta({ header: PDF_HEADER, mimeType: 'application/pdf', size: MAX_SCAN_IMAGE_BYTES + 1 })
    )
    expect(v.ok).toBe(true) // PDFs get the larger cap
    expect(
      validateScanFileMeta(
        meta({ header: PDF_HEADER, mimeType: 'application/pdf', size: MAX_SCAN_PDF_BYTES + 1 })
      ).ok
    ).toBe(false)
  })
})

describe('admission-scan-file: PDF page policy', () => {
  test('up to MAX_SCAN_PDF_PAGES pages are accepted', () => {
    expect(checkPdfPagePolicy(1)).toBeNull()
    expect(checkPdfPagePolicy(MAX_SCAN_PDF_PAGES)).toBeNull()
  })

  test('beyond the cap → actionable error naming the actual count', () => {
    const r = checkPdfPagePolicy(MAX_SCAN_PDF_PAGES + 3)
    expect(r).not.toBeNull()
    expect(r!.code).toBe('PDF_TOO_MANY_PAGES')
    expect(r!.message).toContain(String(MAX_SCAN_PDF_PAGES + 3))
    expect(r!.message).toContain('separately')
  })

  test('a non-document page count fails honestly', () => {
    expect(checkPdfPagePolicy(0)?.code).toBe('PDF_TOO_MANY_PAGES')
    expect(checkPdfPagePolicy(NaN)?.code).toBe('PDF_TOO_MANY_PAGES')
  })
})

describe('admission-scan-file: real PDF parsing (pdfjs-dist)', () => {
  test('a generated 3-page PDF parses to 3 pages', async () => {
    const doc = new jsPDF()
    doc.text('page one', 10, 10)
    doc.addPage()
    doc.text('page two', 10, 10)
    doc.addPage()
    doc.text('page three', 10, 10)
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(await parsePdfPageCount(bytes)).toBe(3)
  })

  test('corrupt bytes throw — the modal surfaces an honest error', async () => {
    const fake = new Uint8Array(64)
    fake.set([0x25, 0x50, 0x44, 0x46], 0) // %PDF magic then garbage
    let threw = false
    try {
      await parsePdfPageCount(fake)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
