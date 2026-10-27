import { Plus, SlidersHorizontal, UploadCloud, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DashboardHeaderProps {
  total: number
  inReview: number
  approved: number
  onOpenSettingsModal: () => void
  onOpenOcrModal?: () => void
  /** Opens the official blank form (preview · download PDF · print). */
  onOpenBlankFormModal?: () => void
  onOpenWizard: () => void
}

/**
 * Admissions header — ONE row on desktop:
 *   left   · the application-count summary
 *   right  · New Application → Download Blank Form → Scan Filled Form →
 *            Settings (Settings always last, primary action first).
 *
 * Layout contract (responsive, no arbitrary offsets):
 *   - Root is a wrapping flex row: when the viewport is wide enough the
 *     summary and the action cluster share one row (justify-between keeps
 *     the summary left and the cluster right with no dead stretch beyond
 *     the natural gap); when it is tight, the WHOLE action cluster drops
 *     below the summary as one unit — buttons never strand one-per-row
 *     by accident.
 *   - The cluster itself wraps internally only when even a full row
 *     cannot fit four buttons (small phones) — a deliberate 2×2 reflow,
 *     never an overlap.
 *   - `whitespace-nowrap` keeps every button label on a single line and
 *     vertically centred with its siblings; text size is untouched.
 */
export function DashboardHeader({
  total,
  inReview,
  approved,
  onOpenSettingsModal,
  onOpenOcrModal,
  onOpenBlankFormModal,
  onOpenWizard,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3">
      {/* Brief PART 1: NO duplicate page title — topbar already shows "Admissions".
          NO generic purpose line — the WorkflowStrip directly below already tells
          the end-to-end story. Content begins with the contextual summary. */}
      <p className="text-xs text-muted-foreground sm:whitespace-nowrap">
        {total} applications · {inReview} pending review · {approved} ready for issuance
      </p>

      {/* Action cluster — grouped, right-aligned on desktop, wraps as a unit */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Single primary action — FIRST per the header layout contract */}
        <Button
          size="sm"
          onClick={() => onOpenWizard()}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          New Application
        </Button>
        {/* Download Blank Form — official A4 PDF, tenant-branded */}
        {onOpenBlankFormModal && (
          <Button variant="outline" size="sm" onClick={onOpenBlankFormModal} className="text-xs gap-1.5 whitespace-nowrap">
            <FileDown className="h-3.5 w-3.5" />
            Download Blank Form
          </Button>
        )}
        {/* Scan Filled Form — on-device OCR into a reviewable draft */}
        {onOpenOcrModal && (
          <Button variant="outline" size="sm" onClick={onOpenOcrModal} className="text-xs gap-1.5 whitespace-nowrap">
            <UploadCloud className="h-3.5 w-3.5" />
            Scan Filled Form
          </Button>
        )}
        {/* Settings — always LAST */}
        <Button variant="outline" size="sm" onClick={onOpenSettingsModal} className="text-xs gap-1.5 whitespace-nowrap">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Settings
        </Button>
      </div>
    </div>
  )
}
