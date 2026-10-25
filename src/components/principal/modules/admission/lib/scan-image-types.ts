/** Shared shape for one rasterized scan page (image or PDF page). */
export interface PdfPageImage {
  pageNumber: number
  /** JPEG data URL ready for the Tesseract engine. */
  dataUrl: string
  width: number
  height: number
}
