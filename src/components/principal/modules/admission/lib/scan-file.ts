/**
 * scan-file — honest validation for scanned admission form files
 * (photos, image scans and PDF exports of scanned forms).
 *
 * SECURITY / HONESTY RULES:
 *   · The file NAME and the browser-reported MIME type are NEVER trusted —
 *     the actual magic bytes decide what the file is (a renamed .jpg that
 *     is really a PDF is treated as a PDF, and a fake ".pdf" that is really
 *     a text file is rejected as unsupported).
 *   · Limits are explicit and produce actionable, non-generic errors.
 *   · This module is pure (no DOM, no stores) so the rules are fully
 *     unit-tested; the OCR modal applies them before any processing.
 */

export type ScanFileKind = 'jpeg' | 'png' | 'webp' | 'pdf'

/** Max upload size for a single photo / image scan. */
export const MAX_SCAN_IMAGE_BYTES = 5 * 1024 * 1024
/** Max upload size for a PDF (rasterized page-by-page before OCR). */
export const MAX_SCAN_PDF_BYTES = 15 * 1024 * 1024
/** Max PDF pages scanned in one pass (multi-page forms stay tractable). */
export const MAX_SCAN_PDF_PAGES = 4

export type ScanFileRejectionCode =
  | 'EMPTY'
  | 'UNSUPPORTED'
  | 'TOO_LARGE'
  | 'PDF_TOO_MANY_PAGES'

export interface ScanFileRejection {
  code: ScanFileRejectionCode
  /** Human-readable, actionable error (shown verbatim in the modal). */
  message: string
}

export type ScanFileValidation =
  | { ok: true; kind: ScanFileKind; maxBytes: number }
  | { ok: false; rejection: ScanFileRejection }

/**
 * Identify a file by its magic bytes. Returns null when the header does
 * not match any supported format. `header` needs only the first 16 bytes.
 */
export function sniffScanFileKind(header: Uint8Array): ScanFileKind | null {
  if (header.length < 4) return null
  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'png'
  }
  // PDF: "%PDF"
  if (
    header[0] === 0x25 &&
    header[1] === 0x50 &&
    header[2] === 0x44 &&
    header[3] === 0x46
  ) {
    return 'pdf'
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

export interface ScanFileMetaInput {
  /** File name (display only — never used to decide the type). */
  name?: string
  /** Browser-reported MIME type (never trusted). */
  mimeType?: string
  /** File size in bytes. */
  size: number
  /** The first ≥16 bytes of the file. */
  header: Uint8Array
}

/**
 * Validate a scanned-form file by content. Name and MIME type are ignored
 * for typing decisions — only magic bytes and size decide.
 */
export function validateScanFileMeta(input: ScanFileMetaInput): ScanFileValidation {
  const { size, header } = input
  if (!size || size === 0) {
    return {
      ok: false,
      rejection: { code: 'EMPTY', message: 'The selected file is empty. Please choose the scanned form again.' },
    }
  }
  const kind = sniffScanFileKind(header)
  if (!kind) {
    return {
      ok: false,
      rejection: {
        code: 'UNSUPPORTED',
        message:
          'This file type is not supported. Upload a photo or scan of the filled form (JPG, PNG, WebP) or a PDF export of it.',
      },
    }
  }
  const maxBytes = kind === 'pdf' ? MAX_SCAN_PDF_BYTES : MAX_SCAN_IMAGE_BYTES
  if (size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024))
    return {
      ok: false,
      rejection: {
        code: 'TOO_LARGE',
        message: `This ${kind === 'pdf' ? 'PDF' : 'image'} is too large (limit ${maxMb} MB). Please compress or re-scan it.`,
      },
    }
  }
  return { ok: true, kind, maxBytes }
}

/** Policy check applied once the PDF page count is known. */
export function checkPdfPagePolicy(pageCount: number): ScanFileRejection | null {
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return {
      code: 'PDF_TOO_MANY_PAGES',
      message: 'The PDF could not be opened as a document. Please re-export or re-scan it.',
    }
  }
  if (pageCount > MAX_SCAN_PDF_PAGES) {
    return {
      code: 'PDF_TOO_MANY_PAGES',
      message: `This PDF has ${pageCount} pages. Scan up to ${MAX_SCAN_PDF_PAGES} pages at a time — export the form pages separately.`,
    }
  }
  return null
}

/** Read the first `n` bytes of a File/Blob as a Uint8Array (browser). */
export async function readFileHeader(file: Blob, n = 16): Promise<Uint8Array> {
  const buf = await file.slice(0, n).arrayBuffer()
  return new Uint8Array(buf)
}
