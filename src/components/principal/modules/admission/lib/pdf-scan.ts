/**
 * pdf-scan — rasterize scanned-form PDFs into images for the existing
 * on-device Tesseract OCR workflow.
 *
 * The SAME pdfjs-dist build is used in the browser (scan modal) and in
 * the unit tests (page-count parsing): the legacy ESM build, which runs
 * in both environments. The worker is served locally from /pdfjs (no CDN
 * dependency — the same convention as the bundled Tesseract engine).
 *
 * Rasterization stays a THIN, browser-only step (canvas); everything
 * testable (page-count policy, magic-byte validation, field mapping)
 * lives in the pure modules (scan-file.ts, ocr-extract.ts).
 */

import type { PdfPageImage } from './scan-image-types'
export type { PdfPageImage }

const PDFJS_WORKER_SRC = '/pdfjs/pdf.worker.min.mjs'

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * Worker source: the locally bundled public asset in the BROWSER; in
 * Node (unit tests) the package's own worker file, resolved relative to
 * this checkout so parsing works without a web server.
 */
function resolveWorkerSrc(): string {
  if (typeof window !== 'undefined') return PDFJS_WORKER_SRC
  try {
    const resolved = import.meta.resolve?.('pdfjs-dist/build/pdf.worker.min.mjs')
    if (typeof resolved === 'string') return resolved
  } catch {
    // fall through to the browser path (tests that need it set the env)
  }
  return PDFJS_WORKER_SRC
}

let pdfjsPromise: Promise<PdfjsModule> | null = null

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      // Locally bundled worker — same-origin, no CDN.
      mod.GlobalWorkerOptions.workerSrc = resolveWorkerSrc()
      return mod
    })
  }
  return pdfjsPromise
}

/** Start loading a PDF; resolves to the pdfjs v6 loading task. */
async function loadPdfTask(bytes: Uint8Array) {
  const pdfjs = await getPdfjs()
  // Copy: pdfjs transfers (detaches) the buffer it receives.
  const data = bytes.slice()
  return pdfjs.getDocument({
    data,
    useSystemFonts: false,
  })
}

/**
 * Release a pdfjs v6 loading task. v6 exposes destroy() on the LOADING
 * TASK (not on the document proxy — doc.destroy is gone). Optional-chained
 * and error-swallowed so cleanup can NEVER mask the original result.
 */
async function destroyPdfTask(task: unknown) {
  try {
    const destroy = (task as { destroy?: () => Promise<void> } | null)?.destroy
    if (typeof destroy === 'function') await destroy.call(task)
  } catch {
    // cleanup failures are non-fatal by contract
  }
}

/**
 * Parse a PDF's page count. Works in the browser AND in Node (tests).
 * Throws for corrupt/non-PDF bytes — callers surface an honest error.
 */
export async function parsePdfPageCount(bytes: Uint8Array): Promise<number> {
  const task = await loadPdfTask(bytes)
  const doc = await task.promise
  try {
    return doc.numPages
  } finally {
    await destroyPdfTask(task)
  }
}

export interface RasterizeOptions {
  /** Hard page limit — checked by the caller before rasterizing too. */
  maxPages: number
  /** ~2.0 ≈ 144 DPI on A4 — comfortable for OCR of printed text. */
  scale?: number
  /** Progress callback: (pageIndex starting at 1, total pages). */
  onProgress?: (page: number, total: number) => void
}

/**
 * Rasterize the first `maxPages` pages of a scanned-form PDF into JPEG
 * data URLs for Tesseract. Browser-only (needs canvas).
 */
export async function rasterizePdfPages(
  bytes: Uint8Array,
  options: RasterizeOptions
): Promise<PdfPageImage[]> {
  const { maxPages, scale = 2.0, onProgress } = options
  const task = await loadPdfTask(bytes)
  const doc = await task.promise
  try {
    const total = Math.min(doc.numPages, maxPages)
    const pages: PdfPageImage[] = []
    for (let i = 1; i <= total; i++) {
      onProgress?.(i, total)
      const page = await doc.getPage(i)
      try {
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas 2D context unavailable on this device')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        }).promise
        pages.push({
          pageNumber: i,
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          width: canvas.width,
          height: canvas.height,
        })
      } finally {
        void page.cleanup()
      }
    }
    return pages
  } finally {
    await destroyPdfTask(task)
  }
}
