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
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
      {/* Brief PART 1: NO duplicate page title — topbar already shows "Admissions".
          Content begins directly with the one-line purpose + contextual summary. */}
      <div>
        <p className="text-sm text-foreground">
          Manage applications from form submission to enrollment.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {total} applications · {inReview} pending review · {approved} ready for issuance
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Settings */}
        <Button variant="outline" size="sm" onClick={onOpenSettingsModal} className="text-xs gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Settings
        </Button>
        {/* Download Blank Form — official A4 PDF, tenant-branded */}
        {onOpenBlankFormModal && (
          <Button variant="outline" size="sm" onClick={onOpenBlankFormModal} className="text-xs gap-1.5">
            <FileDown className="h-3.5 w-3.5" />
            Download Blank Form
          </Button>
        )}
        {/* Scan Filled Form — on-device OCR into a reviewable draft */}
        {onOpenOcrModal && (
          <Button variant="outline" size="sm" onClick={onOpenOcrModal} className="text-xs gap-1.5">
            <UploadCloud className="h-3.5 w-3.5" />
            Scan Filled Form
          </Button>
        )}
        {/* Single primary action */}
        <Button size="sm" onClick={() => onOpenWizard()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5">
          <Plus className="h-4 w-4" />
          New Application
        </Button>
      </div>
    </div>
  )
}
