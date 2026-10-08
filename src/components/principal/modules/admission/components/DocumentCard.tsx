'use client'

/**
 * Single document card used inside the Documents wizard step.
 *
 * Deliberately minimal (Wave 2 spec): document name, Required/Optional
 * tag, status, and clear actions — [Mark Received] when missing, or
 * [Verify] / [Remove] once received. No invented filenames, no invented
 * OCR scores, no description paragraphs.
 *
 * PHASE 7-H (admissions honesty): the upload action and the
 * preview/download links (which resolved through a phantom
 * signed-URL upload endpoint that never existed) are REMOVED. Digital
 * uploads are coming soon — until then the card records the office's
 * physical collection state only. Verification marking remains local
 * demo state for the review workspace.
 */
import {
  FileText, Inbox, ShieldCheck, Trash2,
  Clock, AlertTriangle, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DocStatus } from '../types'
import type { AdmissionDocumentDef } from '../lib/documents'

export type { AdmissionDocumentDef as DocDescriptor }

export function DocumentCard({
  doc,
  st,
  verificationEnabled,
  onMarkReceived,
  onVerify,
  onRemove,
}: {
  doc: AdmissionDocumentDef
  st: DocStatus
  verificationEnabled: boolean
  onMarkReceived: (key: string) => void
  onVerify: (key: string) => void
  onRemove: (key: string) => void
}) {
  // Legacy persisted records may still carry 'uploaded' — it means the
  // same thing the card records today: the office has the document.
  const isReceived = st.status === 'received' || st.status === 'uploaded'
  const vStatus = st.verificationStatus
  const isVerified = verificationEnabled && isReceived && vStatus === 'verified'
  const isRejected = verificationEnabled && isReceived && vStatus === 'rejected'
  const isPendingReview =
    verificationEnabled && isReceived && (!vStatus || vStatus === 'pending')

  // Status badge — the single most important signal on the card.
  let vBadge: { label: string; className: string; Icon: typeof CheckCircle2 }
  if (verificationEnabled && isReceived) {
    if (isVerified)
      vBadge = { label: 'Verified', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 }
    else if (isRejected)
      vBadge = { label: 'Rejected', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30', Icon: AlertTriangle }
    else
      vBadge = { label: 'Pending Review', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', Icon: Clock }
  } else if (isReceived) {
    vBadge = { label: 'Received', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 }
  } else {
    vBadge = { label: 'Not Received', className: 'bg-muted/40 text-muted-foreground border-border/60', Icon: AlertCircle }
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-3.5 py-3 transition-colors',
        isReceived ? 'border-border' : 'border-dashed border-border/70 bg-muted/10',
        doc.required && !isReceived && 'border-amber-500/40'
      )}
    >
      {/* Row 1: name + tags + status */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <FileText
          className={cn(
            'h-4 w-4 shrink-0',
            isReceived ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
          )}
        />
        <span className="text-sm font-semibold text-foreground min-w-0 truncate flex-1 basis-full sm:basis-auto">
          {doc.name}
        </span>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] px-2 py-0 font-semibold rounded-full border shrink-0',
            doc.required
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
              : 'bg-muted/40 text-muted-foreground border-border/60'
          )}
        >
          {doc.required ? 'Required' : 'Optional'}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] px-2 py-0 font-semibold rounded-full border flex items-center gap-1 shrink-0',
            vBadge.className
          )}
        >
          <vBadge.Icon className="h-3 w-3 shrink-0" />
          <span>{vBadge.label}</span>
        </Badge>
      </div>

      {/* Row 2: legacy filename (records created before uploads were
          removed) — display only, no file access exists */}
      {isReceived && st.fileName && (
        <p className="mt-1.5 pl-6 text-[11px] text-muted-foreground font-mono truncate">
          {st.fileName}
        </p>
      )}
      {isReceived && isRejected && st.rejectionReason && (
        <p className="mt-1 pl-6 text-[11px] text-rose-600 dark:text-rose-400 truncate">
          Reason: {st.rejectionReason}
        </p>
      )}

      {/* Row 3: clear actions */}
      <div className="mt-2 flex items-center gap-2">
        {!isReceived ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onMarkReceived(doc.key)}
              className="h-7 text-[11px] px-3 gap-1.5 font-semibold"
            >
              <Inbox className="h-3.5 w-3.5" />
              Mark Received
            </Button>
            <span
              className="text-[10px] text-muted-foreground"
              title="Document uploads are coming soon — no digital upload exists today"
            >
              Uploads coming soon
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {isPendingReview && (
              <Button
                type="button"
                size="sm"
                onClick={() => onVerify(doc.key)}
                className="h-7 text-[11px] px-3 gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Verify
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onRemove(doc.key)}
              className="h-7 text-[11px] px-2.5 gap-1 text-muted-foreground hover:text-rose-600 font-medium"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
