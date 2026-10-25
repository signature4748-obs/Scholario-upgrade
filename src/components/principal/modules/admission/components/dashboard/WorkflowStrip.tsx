import { FileDown, Printer, ScanLine, ClipboardCheck, UserCheck, ChevronRight } from 'lucide-react'

/**
 * WorkflowStrip — the one-glance admissions pipeline indicator:
 * Download → Print & Distribute → Scan Filled Form → Review & Confirm → Enroll.
 * Compact, muted, purely informational (the header carries the actions).
 */
const STEPS = [
  { icon: FileDown, label: 'Download Blank Form' },
  { icon: Printer, label: 'Print & Distribute' },
  { icon: ScanLine, label: 'Scan Filled Form' },
  { icon: ClipboardCheck, label: 'Review & Confirm' },
  { icon: UserCheck, label: 'Enroll' },
] as const

export function WorkflowStrip() {
  return (
    <div
      role="group"
      aria-label="Admissions workflow: download, print and distribute, scan, review, enroll"
      className="flex items-center gap-1 rounded-xl border border-border bg-card/50 px-3 py-2 overflow-x-auto no-scrollbar"
    >
      {STEPS.map((step, i) => {
        const Icon = step.icon
        return (
          <span key={step.label} className="flex items-center gap-1 shrink-0">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
              <Icon className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-border shrink-0" aria-hidden="true" />
            )}
          </span>
        )
      })}
    </div>
  )
}
