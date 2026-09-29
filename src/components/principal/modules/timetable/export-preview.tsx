'use client'

/**
 * ExportPreview — full-screen preview overlay.
 *
 * Brief section 8: A dedicated clean view (not an ugly browser popup) that
 * shows the EXACT document the user will download. Preview HTML == PDF HTML.
 *
 * Controls (Brief 9):
 *   - Back     → closes the preview, returns to the timetable
 *   - Download → opens the print dialog (browser handles PDF export)
 *
 * Brief section 19: Premium minimal Scholario design language — green accent,
 * rounded borders, calm typography. No heavy toolbar.
 */
import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ExportPreviewProps {
  preview: { html: string; title: string; subtitle: string; orientation: 'portrait' | 'landscape' } | null
  onClose: () => void
}

export function ExportPreview({ preview, onClose }: ExportPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Esc-to-close for keyboard users
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, onClose])

  // Lock body scroll while preview is open
  useEffect(() => {
    if (!preview) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [preview])

  // Generate a blob URL for the iframe so the preview is fully isolated.
  // The SAME html string is what gets sent to print() — guaranteeing
  // Preview == PDF (Brief 8 + 15).
  const blobUrl = useMemo(() => {
    if (!preview) return null
    const blob = new Blob([preview.html], { type: 'text/html;charset=utf-8' })
    return URL.createObjectURL(blob)
  }, [preview])

  // Revoke blob URL on cleanup
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  if (!preview || !blobUrl) return null

  const handleDownload = () => {
    // Brief 8 + 15: open the SAME HTML in a hidden iframe + trigger print.
    // Browser print dialog lets user "Save as PDF" with the orientation
    // encoded in the @page rule from the HTML's CSS.
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) return
    doc.open()
    doc.write(preview.html)
    doc.close()

    // Give the browser a tick to layout before printing.
    iframe.contentWindow?.focus()
    setTimeout(() => {
      try {
        iframe.contentWindow?.print()
      } catch (e) {
        // Some browsers throw if print is interrupted; ignore.
      }
      // Cleanup after a short delay so the print spooler has the doc.
      setTimeout(() => {
        try { document.body.removeChild(iframe) } catch (e) { /* already removed */ }
      }, 1500)
    }, 350)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${preview.title} export preview`}
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col"
    >
      {/* Top bar — minimal, premium */}
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={onClose}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{preview.title}</h2>
              <p className="text-[10px] text-muted-foreground truncate">{preview.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-muted/30 capitalize">
              <Printer className="h-3 w-3" />
              {preview.orientation}
            </span>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </Button>
          </div>
        </div>
      </header>

      {/* Preview canvas */}
      <div className="flex-1 overflow-auto bg-muted/40">
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <iframe
              ref={iframeRef}
              src={blobUrl}
              title={preview.title}
              className="w-full h-[calc(100vh-7rem)] bg-white"
              style={{ border: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
