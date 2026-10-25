import { Printer, X, FileText, FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Top control bar — title, PDF download, print and close (hidden on print). */
export function ModalTopBar({
  onPrint,
  onDownload,
  downloading,
  onClose,
}: {
  onPrint: () => void
  /** Downloads the genuine A4 PDF (jsPDF artefact — not a print screenshot). */
  onDownload: () => void
  downloading?: boolean
  onClose: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 no-print">
      <div className="flex items-center gap-2.5">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-base text-foreground">Admission Application Form</h3>
          <p className="text-xs text-muted-foreground">
            Official A4 blank form · Download as PDF or print · Filled copies can be scanned back
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onDownload}
          disabled={downloading}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs shadow-md gap-1.5"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          Download PDF (A4)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onPrint}
          className="text-xs font-semibold gap-1.5"
        >
          <Printer className="h-4 w-4" /> Print
        </Button>
        <button onClick={onClose} aria-label="Close application form" title="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
